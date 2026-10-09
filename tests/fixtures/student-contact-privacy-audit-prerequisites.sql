-- OWNED SYNTHETIC FIXTURE ONLY. Never run on a provider or populated DB.
-- Run before the Stage2 draft, under postgres, on root's network-disabled PG17.
-- Commit makes these synthetic preimages available to subsequent psql sessions.
begin;
set local timezone = 'UTC';
create schema privacy_audit_qa;
create table privacy_audit_qa.baseline_writer as
select proowner, proacl, proconfig, prosecdef, provolatile, proparallel,
  proisstrict, proleakproof, prolang, procost, prorows, prosupport, proretset, prorettype
from pg_catalog.pg_proc where oid = 'dashboard_private.log_dashboard_audit_event_v2()'::regprocedure;
create table privacy_audit_qa.baseline_helpers as
select oid::regprocedure::text identity, pg_catalog.encode(extensions.digest(prosrc, 'sha256'), 'hex') source_hash,
  proowner, proacl, proconfig, prosecdef
from pg_catalog.pg_proc where oid in (
  'dashboard_private.dashboard_audit_forward_patch_v2(jsonb,jsonb)'::regprocedure,
  'dashboard_private.dashboard_audit_reverse_patch_v2(jsonb,jsonb)'::regprocedure
);
create table privacy_audit_qa.baseline_access as
select relname, relacl, relrowsecurity, relforcerowsecurity
from pg_catalog.pg_class where oid in ('public.students'::regclass, 'public.dashboard_audit_logs'::regclass);
create table privacy_audit_qa.baseline_policies as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies where schemaname = 'public' and tablename in ('students', 'dashboard_audit_logs');
create table privacy_audit_qa.baseline_v2_index as
select pg_catalog.pg_get_indexdef('public.dashboard_audit_logs_v2_entity_sequence_idx'::regclass) definition;
create table privacy_audit_qa.baseline_security_catalog as
select (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name', r.rolname, 'superuser', r.rolsuper, 'inherit', r.rolinherit,
  'createRole', r.rolcreaterole, 'createDb', r.rolcreatedb,
  'login', r.rolcanlogin, 'replication', r.rolreplication, 'bypassRls', r.rolbypassrls
) order by r.rolname)
  from pg_catalog.pg_roles r) roles,
 (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.roleid, m.member, m.grantor)
  from pg_catalog.pg_auth_members m) memberships,
 (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) order by d.oid)
  from pg_catalog.pg_default_acl d) defaults;

insert into public.students(id, name, uid, school, grade, contact, parent_contact, created_at)
select ('99490000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  '__privacy_audit__ ' || n::text, 'PRIVACY-SYN-' || n::text, '__privacy_audit__ school', '중1',
  '010-0000-0101', '010-0000-0102',
  case when n = 106 then 'infinity'::timestamptz
       when n = 107 then '-infinity'::timestamptz
       when n = 108 then '10000-01-01 00:00:00+00'::timestamptz
       else '2026-01-02 03:04:05.123456+00'::timestamptz end
from pg_catalog.generate_series(101, 110) n;
set local timezone = 'Asia/Seoul';
insert into public.students(id, name, uid, school, grade, contact, parent_contact, created_at)
values ('99490000-0000-4000-8000-000000000111',
  '__privacy_audit__ Seoul legacy', 'PRIVACY-SYN-111', '__privacy_audit__ school', '중1',
  '010-0000-0111', '010-0000-0112', '2026-01-02 03:04:05.123456+00');
set local timezone = 'UTC';
insert into public.textbooks(id, name)
values ('99490000-0000-4000-8000-000000000901', '__privacy_audit__ textbook');
-- Deliberate semantic corruption is confined to one owned synthetic preimage.
update public.dashboard_audit_logs set after_hash = pg_catalog.repeat('f', 64)
where entity_table = 'students' and entity_id = '99490000-0000-4000-8000-000000000103';
-- Two owned synthetic v1 histories model rows without a v2 predecessor.
update public.dashboard_audit_logs set record_format = 'full_v1', change_patch = null,
  before_hash = null, after_hash = null, event_sequence = null, audit_chain_id = null,
  chain_ordinal = null, chain_start_kind = null, predecessor_event_id = null,
  predecessor_after_hash = null
where entity_table = 'students' and entity_id in (
  '99490000-0000-4000-8000-000000000102', '99490000-0000-4000-8000-000000000105'
);

create table privacy_audit_qa.baseline_students as
select id, pg_catalog.to_jsonb(s) snapshot from public.students s;
create table privacy_audit_qa.baseline_history as
select id, pg_catalog.to_jsonb(a) snapshot from public.dashboard_audit_logs a;
commit;
