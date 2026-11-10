-- Standalone pgTAP supplement for the isolated #234 audit-trigger diagnostic.
-- Prerequisites: only the setup section of issue-234-audit-trigger.sql, the
-- unmodified 20260814115116 audit migration, the reviewed 20261105073151 forward
-- migration, and real pgTAP installed in public. Run as the synthetic setup's
-- postgres owner. This is not a full Supabase schema or authorization test.
-- No product functions, triggers, ownership, privileges, or policies are changed.
-- Test rows roll back; sequence advancement intentionally does not roll back.
\set ON_ERROR_STOP on
begin;
set local search_path = public, pg_temp;

do $isolated_setup_only$
begin
  if to_regnamespace('issue234_fixture') is null
    or (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
        from pg_attribute a where a.attrelid = 'public.classes'::regclass
          and a.attnum > 0 and not a.attisdropped)
       is distinct from array['id:text', 'name:text', 'payload:jsonb']::text[]
    or exists(select 1 from public.classes)
    or exists(select 1 from public.dashboard_audit_logs) then
    raise exception 'issue234_pgtap_requires_empty_synthetic_setup';
  end if;
end
$isolated_setup_only$;

select plan(14);

select is(
  (select md5(prosrc) from pg_proc
   where oid = 'dashboard_private.log_dashboard_audit_event_v2()'::regprocedure),
  '1a0d2be77da0876869cfa21505419988',
  'the final installed audit trigger has the reviewed candidate body');

select ok(
  (select strpos(prosrc, $source$if audit_entity_id is null then
      select * into audit_predecessor
        from public.dashboard_audit_logs
        where entity_table = tg_table_name and entity_id is null
          and record_format in ('full_v2', 'diff_v2')
        order by event_sequence desc limit 1;$source$) > 0
   from pg_proc where oid = 'dashboard_private.log_dashboard_audit_event_v2()'::regprocedure),
  'the final NULL branch retains the format filter and sequence ordering');

select ok(
  (select strpos(prosrc, $source$else
      select * into audit_predecessor
        from public.dashboard_audit_logs
        where entity_table = tg_table_name and entity_id = audit_entity_id
          and record_format in ('full_v2', 'diff_v2')
        order by event_sequence desc limit 1;
    end if;
    if not found then$source$) > 0
   from pg_proc where oid = 'dashboard_private.log_dashboard_audit_event_v2()'::regprocedure),
  'the final non-NULL branch retains the immediate FOUND boundary');

select ok(
  (select tgfoid = 'dashboard_private.log_dashboard_audit_event_v2()'::regprocedure
      and tgenabled = 'O' and not tgisinternal
   from pg_trigger where tgrelid = 'public.classes'::regclass
     and tgname = 'dashboard_audit_classes'),
  'synthetic business writes invoke the actual final audit trigger');

insert into public.classes(id, name, payload) values
  (null, 'pgTAP NULL entity', '{}'),
  ('', 'pgTAP empty entity', '{}'),
  ('pgtap-no-history-update', 'pgTAP history boundary update', '{}'),
  ('pgtap-no-history-delete', 'pgTAP history boundary delete', '{}'),
  ('pgtap-corrupt', 'pgTAP hash protected', '{}');

create temporary table issue234_pgtap_initial_heads on commit drop as
select * from public.dashboard_audit_logs;

update public.classes set payload = '{"step":1}' where id is null;
update public.classes set payload = '{"step":2}' where id = '';

select ok(
  (select c.record_format = 'diff_v2' and c.action = 'UPDATE'
      and c.chain_ordinal = 2 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash
      and c.after_hash = encode(extensions.digest(to_jsonb(b)::text, 'sha256'), 'hex')
   from public.dashboard_audit_logs c
   join issue234_pgtap_initial_heads p on p.entity_id is null
   join public.classes b on b.id is null
   where c.entity_table = 'classes' and c.entity_id is null and c.action = 'UPDATE'),
  'a real NULL-ID UPDATE continues its initial chain and before hash');

select ok(
  (select c.record_format = 'diff_v2' and c.action = 'UPDATE'
      and c.chain_ordinal = 2 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash
      and c.after_hash = encode(extensions.digest(to_jsonb(b)::text, 'sha256'), 'hex')
   from public.dashboard_audit_logs c
   join issue234_pgtap_initial_heads p on p.entity_id = ''
   join public.classes b on b.id = ''
   where c.entity_table = 'classes' and c.entity_id = '' and c.action = 'UPDATE'),
  'a real empty-ID UPDATE takes the non-NULL branch and continues its own chain');

select ok(
  (select count(*) = 4 and count(distinct audit_chain_id) = 2
   from public.dashboard_audit_logs where entity_table = 'classes'
     and (entity_id is null or entity_id = ''))
  and not exists(
    select 1 from public.dashboard_audit_logs c
    join public.dashboard_audit_logs p on p.id = c.predecessor_event_id
    where c.entity_table = 'classes' and (c.entity_id is null or c.entity_id = '')
      and c.entity_id is distinct from p.entity_id),
  'NULL and empty IDs remain separate despite sharing the existing lock key');

-- Remove only the two audit events just created above to model source rows
-- without v2 history. The business trigger stays enabled throughout.
delete from public.dashboard_audit_logs where entity_table = 'classes'
  and entity_id in ('pgtap-no-history-update', 'pgtap-no-history-delete');
update public.classes set payload = '{"changed":true}' where id = 'pgtap-no-history-update';
delete from public.classes where id = 'pgtap-no-history-delete';

select ok(
  (select c.action = 'UPDATE' and c.record_format = 'diff_v2'
      and c.chain_start_kind = 'migration_boundary' and c.chain_ordinal = 1
      and c.predecessor_event_id is null and c.predecessor_after_hash is null
      and c.audit_chain_id <> p.audit_chain_id
   from public.dashboard_audit_logs c
   join issue234_pgtap_initial_heads p on p.entity_id = c.entity_id
   where c.entity_table = 'classes' and c.entity_id = 'pgtap-no-history-update'),
  'a real UPDATE without history preserves FOUND=false and starts ordinal one');

select ok(
  (select c.action = 'DELETE' and c.record_format = 'full_v2'
      and c.chain_start_kind = 'migration_boundary' and c.chain_ordinal = 1
      and c.predecessor_event_id is null and c.predecessor_after_hash is null
      and c.audit_chain_id <> p.audit_chain_id and c.after_hash is null
   from public.dashboard_audit_logs c
   join issue234_pgtap_initial_heads p on p.entity_id = c.entity_id
   where c.entity_table = 'classes' and c.entity_id = 'pgtap-no-history-delete'),
  'a real DELETE without history preserves the same boundary');

-- Corrupt only the isolated synthetic head. A valid row-shape hash value with
-- the wrong content must be rejected by the actual trigger's continuity guard.
update public.dashboard_audit_logs set after_hash = repeat('0', 64)
where entity_table = 'classes' and entity_id = 'pgtap-corrupt';
create temporary table issue234_pgtap_failure_snapshot on commit drop as
select
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(c) order by c.id nulls first, c.name))
   from public.classes c) as business_state,
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(a) order by a.event_sequence, a.id))
   from public.dashboard_audit_logs a) as audit_state,
  (select last_value from dashboard_private.dashboard_audit_event_sequence_v2) as sequence_before;

select throws_ok(
  $sql$update public.classes set name = 'must roll back' where id = 'pgtap-corrupt'$sql$,
  '55000', 'audit_chain_continuity_invalid',
  'the final trigger rejects a mismatched before hash with the exact SQLSTATE and message');

select is(
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(c) order by c.id nulls first, c.name))::text
   from public.classes c),
  (select business_state::text from issue234_pgtap_failure_snapshot),
  'rejected UPDATE leaves every business row and its row count unchanged');

select is(
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(a) order by a.event_sequence, a.id))::text
   from public.dashboard_audit_logs a),
  (select audit_state::text from issue234_pgtap_failure_snapshot),
  'rejected UPDATE leaves every audit row and its row count unchanged');

select is(
  (select last_value from dashboard_private.dashboard_audit_event_sequence_v2),
  (select sequence_before + 1 from issue234_pgtap_failure_snapshot),
  'the rejected write retains the existing nontransactional sequence gap');

delete from public.classes where id is null;
select ok(
  (select c.action = 'DELETE' and c.record_format = 'full_v2'
      and c.chain_ordinal = 3 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash and c.after_hash is null
      and c.before_record = '{"id":null,"name":"pgTAP NULL entity","payload":{"step":1}}'::jsonb
      and c.after_record is null
   from public.dashboard_audit_logs c
   join public.dashboard_audit_logs p on p.id = c.predecessor_event_id
   where c.entity_table = 'classes' and c.entity_id is null and c.action = 'DELETE'),
  'a real NULL-ID DELETE retains its preimage, predecessor and ordinal');

select * from finish();
rollback;
