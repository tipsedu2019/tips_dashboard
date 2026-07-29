begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The legacy schedule_plan remains authoritative while runtime version is 0.
-- This migration only establishes the audited, private mutation boundary for R2.
alter table public.dashboard_audit_logs
  add column if not exists class_id uuid references public.classes(id) on delete set null,
  add column if not exists request_key uuid,
  add column if not exists request_operation text,
  add column if not exists change_reason text;

create index if not exists dashboard_audit_logs_class_id_created_at_idx
  on public.dashboard_audit_logs (class_id, changed_at desc, id desc)
  where class_id is not null;

drop policy if exists dashboard_audit_logs_authenticated_insert
  on public.dashboard_audit_logs;
revoke insert on table public.dashboard_audit_logs from authenticated;

create table if not exists dashboard_private.continuous_class_schedule_runtime (
  singleton boolean primary key default true,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint continuous_class_schedule_runtime_singleton_check
    check (singleton),
  constraint continuous_class_schedule_runtime_version_check
    check (version in (0, 1))
);

insert into dashboard_private.continuous_class_schedule_runtime (singleton, version)
values (true, 0)
on conflict (singleton) do nothing;

create table if not exists dashboard_private.class_schedule_cutovers (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  from_runtime_version integer not null,
  to_runtime_version integer not null,
  request_key uuid,
  status text not null default 'prepared',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  constraint class_schedule_cutovers_runtime_version_check
    check (from_runtime_version in (0, 1) and to_runtime_version in (0, 1)),
  constraint class_schedule_cutovers_status_check
    check (status in ('prepared', 'applied', 'rolled_back', 'failed'))
);

create unique index if not exists class_schedule_cutovers_request_key_key
  on dashboard_private.class_schedule_cutovers (request_key)
  where request_key is not null;

revoke all on table dashboard_private.continuous_class_schedule_runtime
  from public, anon, authenticated;
revoke all on table dashboard_private.class_schedule_cutovers
  from public, anon, authenticated;

create or replace function public.continuous_class_schedule_runtime_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select version
  from dashboard_private.continuous_class_schedule_runtime
  where singleton = true;
$$;

revoke all on function public.continuous_class_schedule_runtime_version()
  from public, anon;
grant execute on function public.continuous_class_schedule_runtime_version()
  to authenticated;

create or replace function public.log_dashboard_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_before jsonb;
  audit_after jsonb;
  audit_subject jsonb;
  audit_entity_id text;
  audit_entity_label text;
  audit_class_id uuid;
  audit_request_key uuid;
  audit_request_operation text;
  audit_change_reason text;
begin
  if tg_op = 'DELETE' then
    audit_before := to_jsonb(old);
    audit_after := null;
  elsif tg_op = 'UPDATE' then
    audit_before := to_jsonb(old);
    audit_after := to_jsonb(new);
  else
    audit_before := null;
    audit_after := to_jsonb(new);
  end if;

  audit_subject := coalesce(audit_after, audit_before, '{}'::jsonb);
  audit_entity_id := audit_subject ->> 'id';
  audit_entity_label := coalesce(
    audit_subject ->> 'name',
    audit_subject ->> 'title',
    audit_subject ->> 'email',
    audit_subject ->> 'login_id',
    audit_entity_id
  );

  begin
    audit_class_id := nullif(
      pg_catalog.current_setting('app.class_schedule_class_id', true), ''
    )::uuid;
    audit_request_key := nullif(
      pg_catalog.current_setting('app.class_schedule_request_key', true), ''
    )::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid continuous class schedule audit context'
        using errcode = '22023';
  end;

  audit_request_operation := nullif(
    pg_catalog.current_setting('app.class_schedule_request_operation', true), ''
  );
  audit_change_reason := nullif(
    pg_catalog.current_setting('app.class_schedule_change_reason', true), ''
  );

  if audit_class_id is null then
    begin
      audit_class_id := nullif(audit_subject ->> 'class_id', '')::uuid;
    exception
      when invalid_text_representation then
        audit_class_id := null;
    end;
  end if;

  if audit_class_id is null and tg_table_name = 'classes' then
    begin
      audit_class_id := nullif(audit_entity_id, '')::uuid;
    exception
      when invalid_text_representation then
        audit_class_id := null;
    end;
  end if;

  insert into public.dashboard_audit_logs (
    actor_profile_id,
    actor_email,
    actor_role,
    action,
    entity_table,
    entity_id,
    entity_label,
    before_record,
    after_record,
    class_id,
    request_key,
    request_operation,
    change_reason
  )
  values (
    auth.uid(),
    lower(coalesce(auth.jwt() ->> 'email', '')),
    public.current_dashboard_role(),
    tg_op,
    tg_table_name,
    audit_entity_id,
    audit_entity_label,
    audit_before,
    audit_after,
    audit_class_id,
    audit_request_key,
    audit_request_operation,
    audit_change_reason
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.continuous_class_schedule_direct_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('app.class_schedule_mutation', true)
    is distinct from 'release2-rpc'
  then
    raise exception 'continuous class schedule direct write is not allowed'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.continuous_class_schedule_direct_write_guard()
  from public, anon, authenticated;

drop trigger if exists continuous_class_schedule_slots_direct_write_guard
  on public.class_schedule_slots;
create trigger continuous_class_schedule_slots_direct_write_guard
  before insert or update or delete on public.class_schedule_slots
  for each row execute function public.continuous_class_schedule_direct_write_guard();

drop trigger if exists continuous_class_lesson_sessions_direct_write_guard
  on public.class_lesson_sessions;
create trigger continuous_class_lesson_sessions_direct_write_guard
  before insert or update or delete on public.class_lesson_sessions
  for each row execute function public.continuous_class_schedule_direct_write_guard();

commit;
