-- STAGE 2 REVIEW DRAFT; not a migration and not authorized for production.
-- Baseline main: 6a6d7abe4f45e366beccc14efbbcce0534f0370f.
-- Apply only after independent exact-source review and the owned synthetic tests.
-- This transaction adds an EMPTY optional MakeEdu URL identifier and changes only
-- FUTURE student audit writes. No historical row UPDATE/DELETE/backfill, grants,
-- policies, roles, secrets, finalizer changes, or provider sends are included.
--
-- makeedu_detail_id is separate from internal id, displayed uid and the payment
-- sync makeedu_student_no. A bounded opaque token is syntax, NOT verified student
-- association, tenant authorization, uniqueness, login access, or URL stability.
-- NULL remains NULL; no UID/phone inference or automatic mapping is performed.
-- Existing table/column privilege inheritance is retained, not an assurance that
-- every authorized writer has independently verified an external association.
-- Table-wide SELECT/INSERT/UPDATE privileges can cover this new column. Actual
-- column visibility/write scope and a verified association writer are blockers;
-- an empty nullable column alone does not enforce the intended mapping contract.
--
-- privacy_v3 is CONTACT-IRREVERSIBLE: INSERT/DELETE store projected full rows;
-- UPDATE stores projected diffs. The physical contact fields cannot be restored
-- directly from those snapshots/patches. This describes field omission, NOT
-- cryptographic erasure: the boundary keeps the verified legacy raw SHA-256 in
-- predecessor_after_hash. That contact-derived, unkeyed commitment remains;
-- this draft adds no HMAC, key provisioning, or resistance-to-guessing claim.
-- Remaining fields (names, free notes, etc.) are not redacted; a phone
-- pasted into a note remains a separate minimization concern. Old raw v1/v2 audit
-- rows, receipts, exports and backups remain; this draft is NOT permanent purge.
-- Current app audit views read summary metadata only; generic v2 reconstruction
-- or future restore consumers must dispatch on privacy_v3 and preserve omission.
-- Applying a privacy diff to an old full row with the generic v2 helper would
-- retain that base row's contact values. Unchanged helpers do not enforce this
-- format boundary; unresolved external/reconstruction consumers block install.
--
-- Legacy boundary hash comparison uses raw OLD minus ONLY the newly-added column
-- in the current session TimeZone. An unknown/different historical v2 TimeZone
-- can block a valid first write with 55000; it is never guessed or bypassed.
-- Actual legacy timezone/population is unknown; passing synthetic cases would
-- not establish a safe first-write rate for the deployed audit population.
-- After the boundary, created_at has canonical UTC six-microsecond precision;
-- infinity/-infinity and NULL are preserved. Unsupported finite years fail closed.
-- Old audit helper definitions and the existing nonstudent v2 index are untouched.
-- A separate student index includes the new format without weakening v2 lookup.
-- This non-CONCURRENT index and ALTER TABLE acquire transaction-held locks.
-- Production size/build time/lock contention are unknown. The 2s lock/30s
-- statement limits bound attempts, not evidence of an acceptable install window.
-- Both CHECKs are NOT VALID: old data is not scanned, but new/changed rows must
-- satisfy the expanded shape. Existing live writer/role/policy behavior, restore
-- consumers, and the final pgTAP runtime remain unresolved install blockers.
-- This file remains NOT INSTALLABLE until those conditions are resolved.
-- One-shot candidate: replay rejects the changed preimage and rolls back; future
-- migration packaging must use its own ledger rather than silently reapply this.
-- Audit context/request-key recording is preserved; this trigger neither owns
-- mutation receipts nor adds a request replay/HMAC/dispatch protocol.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $student_privacy_install$
declare
  v_target pg_catalog.regprocedure := 'dashboard_private.log_dashboard_audit_event_v2()'::pg_catalog.regprocedure;
  v_before pg_catalog.pg_proc%rowtype;
  v_after pg_catalog.pg_proc%rowtype;
  v_shape_definition text;
  v_shape_expression text;
  v_shape_fingerprint text;
begin
  select * into strict v_before from pg_catalog.pg_proc where oid = v_target;
  if pg_catalog.encode(extensions.digest(v_before.prosrc, 'sha256'), 'hex') <> '120c0dc4a4ba275fcebe4aba905fc4072a084c325df8f7644a7211b3107bca50'
     or v_before.proowner is distinct from (select oid from pg_catalog.pg_roles where rolname = 'dashboard_audit_writer_v2')
     or not v_before.prosecdef or v_before.proconfig is distinct from array['search_path=""']::text[] then
    raise exception 'student_privacy_audit_preimage_drift' using errcode = '55000';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.students'::pg_catalog.regclass
      and attname = 'makeedu_detail_id' and not attisdropped) then
    raise exception 'student_privacy_link_column_already_present' using errcode = '55000';
  end if;
  select pg_catalog.pg_get_constraintdef(con.oid, true),
    pg_catalog.encode(extensions.digest(
      pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(con.oid, true))::text,
      'sha256'), 'hex')
    into v_shape_definition, v_shape_fingerprint
  from pg_catalog.pg_constraint con
  where con.conrelid = 'public.dashboard_audit_logs'::pg_catalog.regclass
    and con.conname = 'dashboard_audit_logs_v2_shape_check' and con.contype = 'c';
  if v_shape_fingerprint is distinct from '6645dc141c4468b26d71b7f475a00ad2bfa2b4fe327667f7f9df97d0b2e0aacb' then
    raise exception 'student_privacy_audit_shape_preimage_drift' using errcode = '55000';
  end if;
  v_shape_definition := pg_catalog.regexp_replace(v_shape_definition, ' NOT VALID$', '');
  if pg_catalog.left(v_shape_definition, 7) <> 'CHECK (' or pg_catalog.right(v_shape_definition, 1) <> ')' then
    raise exception 'student_privacy_audit_shape_definition_drift' using errcode = '55000';
  end if;
  v_shape_expression := pg_catalog.substr(v_shape_definition, 8, pg_catalog.length(v_shape_definition) - 8);

  alter table public.students add column makeedu_detail_id text;
  alter table public.students add constraint students_makeedu_detail_id_shape_check check (
    makeedu_detail_id is null or (
      pg_catalog.length(makeedu_detail_id) between 1 and 256
      and makeedu_detail_id !~ '[^A-Za-z0-9_+/=-]'
      and not (
        makeedu_detail_id !~ '[^+0-9-]'
        and pg_catalog.regexp_replace(makeedu_detail_id, '[^0-9]', '', 'g') ~ '^(0[0-9]{8,10}|82[0-9]{9,10})$'
      )
    )
  ) not valid;

  alter table public.dashboard_audit_logs drop constraint dashboard_audit_logs_v2_shape_check;
  execute 'alter table public.dashboard_audit_logs add constraint dashboard_audit_logs_v2_shape_check check (('
    || v_shape_expression || ') or ((' || $student_privacy_shape$record_format = 'privacy_v3' and entity_table = 'students'
      and event_sequence is not null and audit_chain_id is not null and chain_ordinal >= 1
      and (
        (action = 'INSERT' and chain_ordinal = 1 and chain_start_kind = 'insert'
          and predecessor_event_id is null and predecessor_after_hash is null)
        or (action in ('UPDATE', 'DELETE') and (
          (chain_ordinal = 1 and chain_start_kind = 'migration_boundary'
            and predecessor_event_id is null and predecessor_after_hash is null)
          or (chain_ordinal = 1 and chain_start_kind = 'privacy_boundary_v3'
            and predecessor_event_id is not null and pg_catalog.length(predecessor_after_hash) = 64
            and predecessor_after_hash ~ '^[0-9a-f]{64}$')
          or (chain_ordinal > 1 and chain_start_kind is null
            and predecessor_event_id is not null and pg_catalog.length(predecessor_after_hash) = 64
            and predecessor_after_hash ~ '^[0-9a-f]{64}$')
        ))
      )
      and (
        (action = 'INSERT' and before_record is null and before_hash is null
          and pg_catalog.jsonb_typeof(after_record) = 'object'
          and pg_catalog.length(after_hash) = 64 and after_hash ~ '^[0-9a-f]{64}$' and change_patch is null
          and not (after_record ?| array['contact', 'parent_contact']))
        or (action = 'DELETE' and after_record is null and after_hash is null
          and pg_catalog.jsonb_typeof(before_record) = 'object'
          and pg_catalog.length(before_hash) = 64 and before_hash ~ '^[0-9a-f]{64}$' and change_patch is null
          and not (before_record ?| array['contact', 'parent_contact']))
        or (action = 'UPDATE' and before_record is null and after_record is null
          and pg_catalog.jsonb_typeof(change_patch) = 'object'
          and pg_catalog.length(before_hash) = 64 and before_hash ~ '^[0-9a-f]{64}$'
          and pg_catalog.length(after_hash) = 64 and after_hash ~ '^[0-9a-f]{64}$'
          and not (change_patch ?| array['contact', 'parent_contact'])
          and ((change_patch = '{}'::jsonb and before_hash = after_hash) or change_patch <> '{}'::jsonb))
      )$student_privacy_shape$ || ') is true)) not valid';

  execute $student_privacy_writer$
create or replace function dashboard_private.log_dashboard_audit_event_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $student_privacy_body$
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
  audit_claims jsonb;
  audit_actor_profile_id uuid;
  audit_actor_email text;
  audit_student_privacy boolean;
  audit_privacy_boundary boolean := false;
  audit_legacy_before_hash text;
begin
  begin
    audit_claims := coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    audit_actor_profile_id := nullif(coalesce(
      pg_catalog.current_setting('request.jwt.claim.sub', true),
      audit_claims ->> 'sub'
    ), '')::uuid;
  exception when invalid_text_representation then
    audit_claims := '{}'::jsonb;
    audit_actor_profile_id := null;
  end;
  audit_actor_email := pg_catalog.lower(coalesce(audit_claims ->> 'email', ''));

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

  audit_student_privacy := tg_table_schema = 'public' and tg_table_name = 'students';
  if audit_student_privacy then
    -- The OLD raw preimage is checked only at the v2 boundary. Do not normalize
    -- it or guess its historical TimeZone: a mismatch remains a 55000 blocker.
    if tg_op <> 'INSERT' then
      audit_legacy_before_hash := pg_catalog.encode(
        extensions.digest((pg_catalog.to_jsonb(old) - 'makeedu_detail_id')::text, 'sha256'), 'hex'
      );
      audit_before := audit_before - array['contact', 'parent_contact'];
      if old.created_at is null then
        audit_before := pg_catalog.jsonb_set(audit_before, '{created_at}', 'null'::jsonb, false);
      elsif not pg_catalog.isfinite(old.created_at) then
        audit_before := pg_catalog.jsonb_set(audit_before, '{created_at}', pg_catalog.to_jsonb(old.created_at::text), false);
      elsif extract(year from old.created_at at time zone 'UTC') not between 1 and 9999 then
        raise exception 'student_privacy_created_at_unrepresentable' using errcode = '55000';
      else
        audit_before := pg_catalog.jsonb_set(audit_before, '{created_at}', pg_catalog.to_jsonb(
          pg_catalog.to_char(old.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ), false);
      end if;
    end if;
    if tg_op <> 'DELETE' then
      audit_after := audit_after - array['contact', 'parent_contact'];
      if new.created_at is null then
        audit_after := pg_catalog.jsonb_set(audit_after, '{created_at}', 'null'::jsonb, false);
      elsif not pg_catalog.isfinite(new.created_at) then
        audit_after := pg_catalog.jsonb_set(audit_after, '{created_at}', pg_catalog.to_jsonb(new.created_at::text), false);
      elsif extract(year from new.created_at at time zone 'UTC') not between 1 and 9999 then
        raise exception 'student_privacy_created_at_unrepresentable' using errcode = '55000';
      else
        audit_after := pg_catalog.jsonb_set(audit_after, '{created_at}', pg_catalog.to_jsonb(
          pg_catalog.to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ), false);
      end if;
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(pg_catalog.jsonb_object_agg(key, pg_catalog.jsonb_build_object(
        'before', audit_before -> key, 'after', audit_after -> key
      )), '{}'::jsonb)
      into audit_patch
      from (
        select key from pg_catalog.jsonb_object_keys(audit_before || audit_after) as key
        where audit_before -> key is distinct from audit_after -> key
      ) changed;
    end if;
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
    if audit_student_privacy then
      select * into audit_predecessor
        from public.dashboard_audit_logs
        where entity_table = 'students' and entity_id is not distinct from audit_entity_id
          and record_format in ('full_v2', 'diff_v2', 'privacy_v3')
        order by event_sequence desc limit 1;
      if not found then
        audit_chain_id := extensions.gen_random_uuid(); audit_ordinal := 1; audit_start_kind := 'migration_boundary';
      else
        if audit_predecessor.action = 'DELETE'
          or audit_predecessor.audit_chain_id is null
          or audit_predecessor.chain_ordinal is null then
          raise exception 'audit_chain_continuity_invalid' using errcode = '55000';
        end if;
        if audit_predecessor.record_format = 'privacy_v3' then
          if audit_predecessor.after_hash is distinct from audit_before_hash then
            raise exception 'audit_chain_continuity_invalid' using errcode = '55000';
          end if;
          audit_chain_id := audit_predecessor.audit_chain_id;
          audit_ordinal := audit_predecessor.chain_ordinal + 1; audit_start_kind := null;
        else
          if audit_predecessor.after_hash is distinct from audit_legacy_before_hash then
            raise exception 'audit_chain_continuity_invalid' using errcode = '55000';
          end if;
          audit_chain_id := extensions.gen_random_uuid(); audit_ordinal := 1;
          audit_start_kind := 'privacy_boundary_v3'; audit_privacy_boundary := true;
        end if;
      end if;
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
  end if;

  insert into public.dashboard_audit_logs (
    actor_profile_id, actor_email, actor_role, action, entity_table, entity_id, entity_label,
    before_record, after_record, class_id, request_key, request_operation, change_reason,
    record_format, change_patch, before_hash, after_hash, event_sequence, audit_chain_id,
    chain_ordinal, chain_start_kind, predecessor_event_id, predecessor_after_hash
  ) values (
    audit_actor_profile_id, audit_actor_email, public.current_dashboard_role(), tg_op,
    tg_table_name, audit_entity_id, audit_entity_label,
    case when tg_op = 'DELETE' then audit_before else null end,
    case when tg_op = 'INSERT' then audit_after else null end,
    audit_class_id, audit_request_key, audit_request_operation, audit_change_reason,
    case when audit_student_privacy then 'privacy_v3' when tg_op = 'UPDATE' then 'diff_v2' else 'full_v2' end,
    case when tg_op = 'UPDATE' then audit_patch else null end,
    audit_before_hash, audit_after_hash, audit_sequence, audit_chain_id, audit_ordinal, audit_start_kind,
    case when audit_ordinal > 1 or audit_privacy_boundary then audit_predecessor.id else null end,
    case when audit_ordinal > 1 or audit_privacy_boundary then audit_predecessor.after_hash else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$student_privacy_body$;
$student_privacy_writer$;
  select * into strict v_after from pg_catalog.pg_proc where oid = v_target;
  if v_after.proowner is distinct from v_before.proowner
    or v_after.proacl is distinct from v_before.proacl
    or v_after.proconfig is distinct from v_before.proconfig
    or v_after.prosecdef is distinct from v_before.prosecdef
    or v_after.provolatile is distinct from v_before.provolatile
    or v_after.proparallel is distinct from v_before.proparallel
    or v_after.proisstrict is distinct from v_before.proisstrict
    or v_after.proleakproof is distinct from v_before.proleakproof
    or v_after.prolang is distinct from v_before.prolang
    or v_after.procost is distinct from v_before.procost
    or v_after.prorows is distinct from v_before.prorows
    or v_after.prosupport is distinct from v_before.prosupport
    or v_after.proretset is distinct from v_before.proretset
    or v_after.prorettype is distinct from v_before.prorettype then
    raise exception 'student_privacy_audit_attributes_changed' using errcode = '55000';
  end if;
end;
$student_privacy_install$;

create index dashboard_audit_logs_student_privacy_v3_sequence_idx
  on public.dashboard_audit_logs (entity_id, event_sequence desc)
  include (id, action, record_format, audit_chain_id, chain_ordinal, after_hash)
  where entity_table = 'students' and record_format in ('full_v2', 'diff_v2', 'privacy_v3');

commit;
