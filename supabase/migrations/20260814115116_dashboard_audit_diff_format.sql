begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table public.dashboard_audit_logs
  add column if not exists record_format text not null default 'full_v1',
  add column if not exists change_patch jsonb,
  add column if not exists before_hash text,
  add column if not exists after_hash text,
  add column if not exists event_sequence bigint,
  add column if not exists audit_chain_id uuid,
  add column if not exists chain_ordinal bigint,
  add column if not exists chain_start_kind text,
  add column if not exists predecessor_event_id uuid,
  add column if not exists predecessor_after_hash text;

create index if not exists dashboard_audit_logs_v2_entity_sequence_idx
  on public.dashboard_audit_logs (entity_table, entity_id, event_sequence desc)
  include (id, action, audit_chain_id, chain_ordinal, after_hash)
  where record_format in ('full_v2', 'diff_v2');

create sequence if not exists dashboard_private.dashboard_audit_event_sequence_v2;
revoke all on sequence dashboard_private.dashboard_audit_event_sequence_v2 from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'dashboard_audit_writer_v2') then
    create role dashboard_audit_writer_v2 nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  elsif exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'dashboard_audit_writer_v2'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls)
  ) then
    raise exception 'dashboard_audit_writer_v2_role_drift';
  end if;
end
$$;

grant usage on schema dashboard_private to dashboard_audit_writer_v2;
grant usage on schema extensions to dashboard_audit_writer_v2;
grant usage on schema auth to dashboard_audit_writer_v2;
grant usage, select on sequence dashboard_private.dashboard_audit_event_sequence_v2 to dashboard_audit_writer_v2;
grant select, insert on table public.dashboard_audit_logs to dashboard_audit_writer_v2;
grant execute on function extensions.digest(text, text) to dashboard_audit_writer_v2;
grant execute on function extensions.gen_random_uuid() to dashboard_audit_writer_v2;
grant execute on function public.current_dashboard_role() to dashboard_audit_writer_v2;

create or replace function dashboard_private.dashboard_audit_forward_patch_v2(record_value jsonb, patch jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select record_value || coalesce(
    (select pg_catalog.jsonb_object_agg(entry.key, entry.value -> 'after') from pg_catalog.jsonb_each(patch) as entry),
    '{}'::jsonb
  )
$$;

create or replace function dashboard_private.dashboard_audit_reverse_patch_v2(record_value jsonb, patch jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select record_value || coalesce(
    (select pg_catalog.jsonb_object_agg(entry.key, entry.value -> 'before') from pg_catalog.jsonb_each(patch) as entry),
    '{}'::jsonb
  )
$$;

revoke all on function dashboard_private.dashboard_audit_forward_patch_v2(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_audit_reverse_patch_v2(jsonb, jsonb) from public, anon, authenticated, service_role;

create or replace function dashboard_private.log_dashboard_audit_event_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_before jsonb;
  audit_after jsonb;
  audit_subject jsonb;
  audit_patch jsonb := '{}'::jsonb;
  audit_entity_id text;
  audit_entity_label text;
  audit_class_id uuid;
  audit_request_key uuid;
  audit_request_operation text;
  audit_change_reason text;
  audit_before_hash text;
  audit_after_hash text;
  audit_predecessor public.dashboard_audit_logs%rowtype;
  audit_chain_id uuid;
  audit_ordinal bigint;
  audit_start_kind text;
  audit_sequence bigint;
begin
  if tg_op = 'DELETE' then
    audit_before := pg_catalog.to_jsonb(old);
    audit_after := null;
  elsif tg_op = 'UPDATE' then
    audit_before := pg_catalog.to_jsonb(old);
    audit_after := pg_catalog.to_jsonb(new);
    select coalesce(pg_catalog.jsonb_object_agg(key, pg_catalog.jsonb_build_object('before', audit_before -> key, 'after', audit_after -> key)), '{}'::jsonb)
      into audit_patch
      from (
        select key from pg_catalog.jsonb_object_keys(audit_before || audit_after) as key
        where audit_before -> key is distinct from audit_after -> key
      ) changed;
  else
    audit_before := null;
    audit_after := pg_catalog.to_jsonb(new);
  end if;

  audit_subject := coalesce(audit_after, audit_before, '{}'::jsonb);
  audit_entity_id := audit_subject ->> 'id';
  audit_entity_label := coalesce(audit_subject ->> 'name', audit_subject ->> 'title', audit_subject ->> 'email', audit_subject ->> 'login_id', audit_entity_id);
  audit_before_hash := case when audit_before is null then null else pg_catalog.encode(extensions.digest(audit_before::text, 'sha256'), 'hex') end;
  audit_after_hash := case when audit_after is null then null else pg_catalog.encode(extensions.digest(audit_after::text, 'sha256'), 'hex') end;

  begin
    audit_class_id := nullif(pg_catalog.current_setting('app.class_schedule_class_id', true), '')::uuid;
    audit_request_key := nullif(pg_catalog.current_setting('app.class_schedule_request_key', true), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid continuous class schedule audit context' using errcode = '22023';
  end;
  audit_request_operation := nullif(pg_catalog.current_setting('app.class_schedule_request_operation', true), '');
  audit_change_reason := nullif(pg_catalog.current_setting('app.class_schedule_change_reason', true), '');
  if audit_class_id is null then
    begin audit_class_id := nullif(audit_subject ->> 'class_id', '')::uuid; exception when invalid_text_representation then audit_class_id := null; end;
  end if;
  if audit_class_id is null and tg_table_name = 'classes' then
    begin audit_class_id := nullif(audit_entity_id, '')::uuid; exception when invalid_text_representation then audit_class_id := null; end;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(tg_table_name), pg_catalog.hashtext(coalesce(audit_entity_id, '')));
  audit_sequence := pg_catalog.nextval('dashboard_private.dashboard_audit_event_sequence_v2'::pg_catalog.regclass);
  if tg_op = 'INSERT' then
    audit_chain_id := extensions.gen_random_uuid(); audit_ordinal := 1; audit_start_kind := 'insert';
  else
    select * into audit_predecessor
      from public.dashboard_audit_logs
      where entity_table = tg_table_name and entity_id is not distinct from audit_entity_id
        and record_format in ('full_v2', 'diff_v2')
      order by event_sequence desc limit 1;
    if not found then
      audit_chain_id := extensions.gen_random_uuid(); audit_ordinal := 1; audit_start_kind := 'migration_boundary';
    else
      if audit_predecessor.action = 'DELETE'
        or audit_predecessor.after_hash is distinct from audit_before_hash
        or audit_predecessor.audit_chain_id is null
        or audit_predecessor.chain_ordinal is null then
        raise exception 'audit_chain_continuity_invalid' using errcode = '55000';
      end if;
      audit_chain_id := audit_predecessor.audit_chain_id; audit_ordinal := audit_predecessor.chain_ordinal + 1; audit_start_kind := null;
    end if;
  end if;

  insert into public.dashboard_audit_logs (
    actor_profile_id, actor_email, actor_role, action, entity_table, entity_id, entity_label,
    before_record, after_record, class_id, request_key, request_operation, change_reason,
    record_format, change_patch, before_hash, after_hash, event_sequence, audit_chain_id,
    chain_ordinal, chain_start_kind, predecessor_event_id, predecessor_after_hash
  ) values (
    auth.uid(), pg_catalog.lower(coalesce(auth.jwt() ->> 'email', '')), public.current_dashboard_role(), tg_op,
    tg_table_name, audit_entity_id, audit_entity_label,
    case when tg_op = 'DELETE' then audit_before else null end,
    case when tg_op = 'INSERT' then audit_after else null end,
    audit_class_id, audit_request_key, audit_request_operation, audit_change_reason,
    case when tg_op = 'UPDATE' then 'diff_v2' else 'full_v2' end,
    case when tg_op = 'UPDATE' then audit_patch else null end,
    audit_before_hash, audit_after_hash, audit_sequence, audit_chain_id, audit_ordinal, audit_start_kind,
    case when audit_ordinal > 1 then audit_predecessor.id else null end,
    case when audit_ordinal > 1 then audit_predecessor.after_hash else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter function dashboard_private.log_dashboard_audit_event_v2() owner to dashboard_audit_writer_v2;
alter function dashboard_private.dashboard_audit_forward_patch_v2(jsonb, jsonb) owner to dashboard_audit_writer_v2;
alter function dashboard_private.dashboard_audit_reverse_patch_v2(jsonb, jsonb) owner to dashboard_audit_writer_v2;
alter sequence dashboard_private.dashboard_audit_event_sequence_v2 owner to dashboard_audit_writer_v2;
revoke all on function dashboard_private.log_dashboard_audit_event_v2() from public, anon, authenticated, service_role;

alter table public.dashboard_audit_logs
  add constraint dashboard_audit_logs_v2_shape_check check (
    (record_format = 'full_v1' and change_patch is null and before_hash is null and after_hash is null and event_sequence is null and audit_chain_id is null and chain_ordinal is null and chain_start_kind is null and predecessor_event_id is null and predecessor_after_hash is null)
    or (record_format = 'diff_v2' and action = 'UPDATE' and before_record is null and after_record is null and pg_catalog.jsonb_typeof(change_patch) = 'object' and before_hash is not null and after_hash is not null and event_sequence is not null and audit_chain_id is not null and chain_ordinal is not null and ((change_patch = '{}'::jsonb and before_hash = after_hash) or change_patch <> '{}'::jsonb))
    or (record_format = 'full_v2' and event_sequence is not null and audit_chain_id is not null and chain_ordinal is not null and ((action = 'INSERT' and before_record is null and after_record is not null and before_hash is null and after_hash is not null) or (action = 'DELETE' and before_record is not null and after_record is null and before_hash is not null and after_hash is null)))
  ) not valid;

drop policy if exists dashboard_audit_logs_authenticated_insert on public.dashboard_audit_logs;
revoke insert on table public.dashboard_audit_logs from public, authenticated;
grant insert, select on table public.dashboard_audit_logs to dashboard_audit_writer_v2;
drop policy if exists dashboard_audit_logs_writer_insert on public.dashboard_audit_logs;
create policy dashboard_audit_logs_writer_insert on public.dashboard_audit_logs for insert to dashboard_audit_writer_v2 with check (true);
drop policy if exists dashboard_audit_logs_writer_select on public.dashboard_audit_logs;
create policy dashboard_audit_logs_writer_select on public.dashboard_audit_logs for select to dashboard_audit_writer_v2 using (true);

drop trigger if exists dashboard_audit_teacher_catalogs on public.teacher_catalogs;
create trigger dashboard_audit_teacher_catalogs after insert or update or delete on public.teacher_catalogs
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_profiles on public.profiles;
create trigger dashboard_audit_profiles after insert or update or delete on public.profiles
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_students on public.students;
create trigger dashboard_audit_students after insert or update or delete on public.students
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_classes on public.classes;
create trigger dashboard_audit_classes after insert or update or delete on public.classes
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_textbooks on public.textbooks;
create trigger dashboard_audit_textbooks after insert or update or delete on public.textbooks
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_class_schedule_slots on public.class_schedule_slots;
create trigger dashboard_audit_class_schedule_slots after insert or update or delete on public.class_schedule_slots
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();
drop trigger if exists dashboard_audit_class_lesson_sessions on public.class_lesson_sessions;
create trigger dashboard_audit_class_lesson_sessions after insert or update or delete on public.class_lesson_sessions
  for each row execute function dashboard_private.log_dashboard_audit_event_v2();

do $$
begin
  if pg_catalog.to_regprocedure('public.log_dashboard_audit_event()') is not null then
    execute 'revoke all on function public.log_dashboard_audit_event() from public, anon, authenticated, service_role';
    execute 'drop function public.log_dashboard_audit_event()';
  end if;
end
$$;

commit;
