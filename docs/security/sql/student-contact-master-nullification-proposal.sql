-- SEPARATE IRREVERSIBLE STAGE 11 PROPOSAL; NOT AN INSTALL MIGRATION.
-- Production target, only after separate approval: slnjqlzzhewblvttiidk.
-- Run only AFTER the reviewed application release and exact privacy audit
-- installation are confirmed. The six privacy install scripts do not invoke it.
-- Preparation is authorized; production permanent-deletion approval is pending.
--
-- Scope: every existing public.students row with contact OR parent_contact
-- non-NULL, including empty strings. Set ONLY those two master fields to NULL.
-- Preserve all other student fields exactly: UUID, display UID, name, status,
-- MakeEdu identifiers, class/waitlist arrays, timestamps and business facts.
-- No registration detail/task/contact-generation change, copied evidence cleanup,
-- historical audit rewrite, receipt/event deletion, export/backup download or
-- backup purge is included. In particular, an OPEN registration case's scoped
-- ops_registration_details.parent_phone remains available for its approved
-- level-test, observation and registration guidance lifecycle.
--
-- This removes live master values permanently. The new privacy_v3 contact-only
-- UPDATE event contains no contact diff or raw restoration snapshot. Old audit
-- records/backups/copies remain and are NOT purged by this proposal. A later
-- application/MakeEdu import may reintroduce a value; this is not a write ban.
--
-- BEFORE authorizing execution, capture read-only production catalogs for native
-- TimeZone, current_user/session_user, the exact installed writer/trigger/ACL,
-- table ACL/RLS, and count-only population. This file reads the current TimeZone
-- and NEVER changes it or retries UTC/Seoul to guess old v2 provenance. A legacy
-- boundary mismatch is native SQLSTATE 55000, audit_chain_continuity_invalid.
-- All student/audit ROW changes roll back on any error. The existing writer calls
-- nextval BEFORE its continuity check; a failed transaction can leave sequence
-- gaps. No rewind is attempted and no whole-database-unchanged claim is made.
--
-- Owner session only; no SET ROLE, actor/JWT minting, new grants, trigger disabling,
-- RLS weakening, audit writer replacement, keys or provider actions. Retain the
-- real operator/session audit context as supplied by the approved execution path.
-- The table lock stabilizes the all-nonnull population and blocks concurrent
-- student writes, including inserts, until commit. Ordered UUID row locks and
-- normal audit advisory locks remain; lock timeout fails closed. The 120s limit
-- bounds this DO statement, not proof that production fits the maintenance window.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = '';

do $student_master_contact_nullification$
declare
  v_writer_oid oid := pg_catalog.to_regprocedure('dashboard_private.log_dashboard_audit_event_v2()');
  v_writer pg_catalog.pg_proc%rowtype;
  v_students_oid oid := pg_catalog.to_regclass('public.students');
  v_table_before pg_catalog.pg_class%rowtype;
  v_table_after pg_catalog.pg_class%rowtype;
  v_trigger_catalog_before jsonb;
  v_trigger_catalog_after jsonb;
  v_guard record;
  v_guard_proc pg_catalog.pg_proc%rowtype;
  v_timezone text := pg_catalog.current_setting('TimeZone');
  v_target record;
  v_after_business jsonb;
  v_audit public.dashboard_audit_logs%rowtype;
  v_changed integer;
  v_rows bigint := 0;
  v_student_contact_rows bigint := 0;
  v_parent_contact_rows bigint := 0;
begin
  if current_user <> 'postgres' or v_students_oid is null or v_writer_oid is null then
    raise exception 'student_master_contact_owner_or_install_required' using errcode = '55000';
  end if;
  if pg_catalog.current_setting('row_security') <> 'on'
    or pg_catalog.current_setting('session_replication_role') <> 'origin' then
    raise exception 'student_master_contact_execution_context_drift' using errcode = '55000';
  end if;

  -- Stabilize the population without weakening existing row security or guards.
  lock table public.students in share row exclusive mode;
  select * into strict v_table_before from pg_catalog.pg_class where oid = v_students_oid;
  if v_table_before.relowner is distinct from pg_catalog.to_regrole('postgres')
    or v_table_before.relkind <> 'r'
    or not v_table_before.relrowsecurity then
    raise exception 'student_master_contact_table_metadata_drift' using errcode = '55000';
  end if;
  if (select count(*) from pg_catalog.pg_attribute
      where attrelid = v_students_oid and not attisdropped
        and attname in ('contact', 'parent_contact')
        and atttypid = 'text'::pg_catalog.regtype and not attnotnull) <> 2 then
    raise exception 'student_master_contact_columns_drift' using errcode = '55000';
  end if;

  select * into strict v_writer from pg_catalog.pg_proc where oid = v_writer_oid;
  if pg_catalog.encode(extensions.digest(v_writer.prosrc, 'sha256'), 'hex')
      <> 'bf06f829f4fa07f7aeea90dccc34d18452933cea7e75ee01b03ec46d42b17119'
    or v_writer.proowner is distinct from pg_catalog.to_regrole('dashboard_audit_writer_v2')
    or not v_writer.prosecdef
    or v_writer.proconfig is distinct from array['search_path=""']::text[]
    or v_writer.prokind <> 'f' or v_writer.provolatile <> 'v'
    or v_writer.proparallel <> 'u' or v_writer.pronargs <> 0
    or v_writer.proisstrict or v_writer.proleakproof or v_writer.proretset
    or v_writer.prorettype <> 'trigger'::pg_catalog.regtype
    or (select lanname from pg_catalog.pg_language where oid = v_writer.prolang) <> 'plpgsql'
    or exists (select 1 from pg_catalog.pg_roles
      where oid = v_writer.proowner and (rolcanlogin or rolsuper or rolcreatedb
        or rolcreaterole or rolinherit or rolreplication or rolbypassrls))
    or exists (select 1 from pg_catalog.aclexplode(
        case when pg_catalog.array_ndims(coalesce(v_writer.proacl,
          pg_catalog.acldefault('f', v_writer.proowner))) > 0
          then coalesce(v_writer.proacl, pg_catalog.acldefault('f', v_writer.proowner))
          else null end) acl
      where acl.grantee <> v_writer.proowner or acl.grantor <> v_writer.proowner
        or acl.privilege_type <> 'EXECUTE' or acl.is_grantable)
    or pg_catalog.has_function_privilege('anon', v_writer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_writer_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_writer_oid, 'EXECUTE') then
    raise exception 'student_master_contact_privacy_writer_drift' using errcode = '55000';
  end if;

  -- Current ordered-source guards match the read-only production catalog
  -- observed 2026-10-09T16:23:46Z. Four triggers share these three functions.
  for v_guard in select * from (values
    ('dashboard_private.prevent_direct_student_roster_array_write()', '734ae9d8d5a76393b42510714aabb08f8fcdea0707a70d46fbf41f6c13fb1799'),
    ('dashboard_private.prevent_direct_student_status_write()', '9375164e54e686ce0b2e29683f4d227270418d7ef49b2ffb49c634fc5288dbcb'),
    ('dashboard_private.prevent_linked_roster_entity_delete()', '9d38d52a7e0dbf100fe69a02c20ce29ecaa5b78e788d74bbeebfb54b54676976')
  ) expected(signature, body_sha256) loop
    select * into v_guard_proc from pg_catalog.pg_proc
      where oid = pg_catalog.to_regprocedure(v_guard.signature);
    if not found or pg_catalog.encode(extensions.digest(v_guard_proc.prosrc, 'sha256'), 'hex')
        is distinct from v_guard.body_sha256
      or v_guard_proc.proowner is distinct from pg_catalog.to_regrole('postgres')
      or v_guard_proc.prosecdef
      or v_guard_proc.proconfig is distinct from array['search_path=""']::text[]
      or v_guard_proc.prorettype <> 'trigger'::pg_catalog.regtype
      or (select lanname from pg_catalog.pg_language where oid = v_guard_proc.prolang) <> 'plpgsql' then
      raise exception 'student_master_contact_business_guard_drift' using errcode = '55000';
    end if;
  end loop;

  -- Pin the final students trigger set, not an earlier source definition. The
  -- three guarded non-contact operations remain present; this UPDATE names none
  -- of their protected columns and never bypasses any trigger.
  if (select count(*) from pg_catalog.pg_trigger where tgrelid = v_students_oid
        and not tgisinternal) <> 5
    or exists (
      select 1 from (values
        ('dashboard_audit_students', 'dashboard_private.log_dashboard_audit_event_v2()', 29, array[]::text[]),
        ('prevent_linked_student_delete', 'dashboard_private.prevent_linked_roster_entity_delete()', 11, array[]::text[]),
        ('prevent_direct_student_roster_insert', 'dashboard_private.prevent_direct_student_roster_array_write()', 7, array[]::text[]),
        ('prevent_direct_student_roster_array_write', 'dashboard_private.prevent_direct_student_roster_array_write()', 19, array['class_ids', 'waitlist_class_ids']::text[]),
        ('prevent_direct_student_status_write', 'dashboard_private.prevent_direct_student_status_write()', 19, array['status']::text[])
      ) expected(name, signature, trigger_type, columns)
      left join pg_catalog.pg_trigger t on t.tgrelid = v_students_oid and t.tgname = expected.name
      where t.oid is null or t.tgisinternal or t.tgenabled <> 'O'
        or t.tgfoid is distinct from pg_catalog.to_regprocedure(expected.signature)::oid
        or t.tgtype <> expected.trigger_type or t.tgnargs <> 0 or pg_catalog.octet_length(t.tgargs) <> 0
        or t.tgqual is not null or t.tgconstraint <> 0 or t.tgparentid <> 0
        or t.tgdeferrable or t.tginitdeferred or t.tgoldtable is not null or t.tgnewtable is not null
        or coalesce((select pg_catalog.array_agg(a.attname::text order by keys.ordinality)
          from pg_catalog.unnest(t.tgattr::smallint[]) with ordinality keys(attnum, ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = v_students_oid and a.attnum = keys.attnum),
          array[]::text[]) is distinct from expected.columns
    ) then
    raise exception 'student_master_contact_trigger_drift' using errcode = '55000';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.tgname)
    into v_trigger_catalog_before from pg_catalog.pg_trigger t
    where t.tgrelid = v_students_oid and not t.tgisinternal;

  -- No raw phone enters an in-memory preservation snapshot or diagnostic. The
  -- per-row snapshot contains only the remaining existing student business row.
  for v_target in
    select s.id, pg_catalog.to_jsonb(s) - array['contact', 'parent_contact']::text[] as business,
      s.contact is not null as had_student_contact,
      s.parent_contact is not null as had_parent_contact
    from public.students s
    where s.contact is not null or s.parent_contact is not null
    order by s.id
    for update of s
  loop
    update public.students set contact = null, parent_contact = null where id = v_target.id;
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'student_master_contact_row_scope_changed' using errcode = '55000';
    end if;
    select pg_catalog.to_jsonb(s) - array['contact', 'parent_contact']::text[]
      into strict v_after_business from public.students s where s.id = v_target.id;
    if v_after_business is distinct from v_target.business
      or exists (select 1 from public.students s where s.id = v_target.id
        and (s.contact is not null or s.parent_contact is not null)) then
      raise exception 'student_master_contact_business_row_changed' using errcode = '55000';
    end if;
    select * into strict v_audit from public.dashboard_audit_logs a
      where a.entity_table = 'students' and a.entity_id = v_target.id::text
      order by a.event_sequence desc nulls last limit 1;
    if v_audit.action <> 'UPDATE' or v_audit.record_format <> 'privacy_v3'
      or v_audit.before_record is not null or v_audit.after_record is not null
      or v_audit.change_patch is distinct from '{}'::jsonb
      or v_audit.before_hash is null or v_audit.before_hash is distinct from v_audit.after_hash then
      raise exception 'student_master_contact_privacy_event_invalid' using errcode = '55000';
    end if;
    v_rows := v_rows + 1;
    v_student_contact_rows := v_student_contact_rows + v_target.had_student_contact::integer;
    v_parent_contact_rows := v_parent_contact_rows + v_target.had_parent_contact::integer;
  end loop;
  if exists (select 1 from public.students where contact is not null or parent_contact is not null) then
    raise exception 'student_master_contact_population_not_cleared' using errcode = '55000';
  end if;
  select * into strict v_table_after from pg_catalog.pg_class where oid = v_students_oid;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.tgname)
    into v_trigger_catalog_after from pg_catalog.pg_trigger t
    where t.tgrelid = v_students_oid and not t.tgisinternal;
  if v_table_after.relacl is distinct from v_table_before.relacl
    or v_table_after.relowner <> v_table_before.relowner
    or v_table_after.relrowsecurity <> v_table_before.relrowsecurity
    or v_table_after.relforcerowsecurity <> v_table_before.relforcerowsecurity
    or v_trigger_catalog_after is distinct from v_trigger_catalog_before
    or pg_catalog.current_setting('TimeZone') is distinct from v_timezone
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_writer_oid
      and pg_catalog.to_jsonb(p) is not distinct from pg_catalog.to_jsonb(v_writer)) then
    raise exception 'student_master_contact_security_metadata_changed' using errcode = '55000';
  end if;
  -- This NOTICE is aggregate preparation evidence. Success requires COMMIT too.
  raise notice 'student_master_contact_prepared rows=%, student_contact_rows=%, parent_contact_rows=%, native_timezone=%',
    v_rows, v_student_contact_rows, v_parent_contact_rows, v_timezone;
end;
$student_master_contact_nullification$;

commit;
