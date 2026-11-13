-- #234: execute the final audit trigger in the regular full-schema pgTAP path.
-- This ports all 14 assertions from the standalone readiness fixture without
-- replacing public.classes or any product function, role, ACL, policy or trigger.
-- Source contract: 20260814115116 defines the writer and continuity guard;
-- 20261105073151 changes only predecessor lookup and pins this final body hash.
-- The nullable text probe reaches NULL/empty IDs that real UUID tables cannot.
-- Empty session claims use the real current_dashboard_role() viewer fallback
-- (20260316092000); no profile or authenticated user is fabricated. These are
-- postgres-driven trigger semantics tests, not evidence of user authorization.
-- Audit actor_profile_id is nullable; the probe has no class_id and empty audit
-- context avoids the actual class_id FK (20260728230427). All persistent writes
-- are synthetic audit rows for this probe, rolled back at the end. Sequence
-- advancement intentionally survives rollback, as it does in the real trigger.
begin;
set local search_path = public, extensions, pg_temp;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.email = '';
set local request.jwt.claims = '{}';
set local app.class_schedule_class_id = '';
set local app.class_schedule_request_key = '';
set local app.class_schedule_request_operation = '';
set local app.class_schedule_change_reason = '';

-- Fail before touching any audit row if this fixture's identity already exists.
do $probe_identity$
begin
  if exists(select 1 from public.dashboard_audit_logs
            where entity_table = 'issue234_audit_predecessor_probe') then
    raise exception 'issue234_audit_probe_identity_already_present';
  end if;
end
$probe_identity$;

create temporary table issue234_audit_predecessor_probe (
  id text, name text, payload jsonb
) on commit drop;
create trigger issue234_audit_predecessor_probe_trigger
after insert or update or delete on pg_temp.issue234_audit_predecessor_probe
for each row execute function dashboard_private.log_dashboard_audit_event_v2();

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
   from pg_trigger where tgrelid = 'pg_temp.issue234_audit_predecessor_probe'::regclass
     and tgname = 'issue234_audit_predecessor_probe_trigger'),
  'temporary probe writes invoke the actual final audit trigger');

insert into pg_temp.issue234_audit_predecessor_probe(id, name, payload) values
  (null, 'pgTAP NULL entity', '{}'),
  ('', 'pgTAP empty entity', '{}'),
  ('pgtap-no-history-update', 'pgTAP history boundary update', '{}'),
  ('pgtap-no-history-delete', 'pgTAP history boundary delete', '{}'),
  ('pgtap-corrupt', 'pgTAP hash protected', '{}');

create temporary table issue234_pgtap_initial_heads on commit drop as
select * from public.dashboard_audit_logs
where entity_table = 'issue234_audit_predecessor_probe';

update pg_temp.issue234_audit_predecessor_probe set payload = '{"step":1}' where id is null;
update pg_temp.issue234_audit_predecessor_probe set payload = '{"step":2}' where id = '';

select ok(
  (select c.record_format = 'diff_v2' and c.action = 'UPDATE'
      and c.chain_ordinal = 2 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash
      and c.after_hash = encode(extensions.digest(to_jsonb(b)::text, 'sha256'), 'hex')
   from public.dashboard_audit_logs c
   join pg_temp.issue234_pgtap_initial_heads p on p.entity_id is null
   join pg_temp.issue234_audit_predecessor_probe b on b.id is null
   where c.entity_table = 'issue234_audit_predecessor_probe' and c.entity_id is null and c.action = 'UPDATE'),
  'a real NULL-ID UPDATE continues its initial chain and before hash');

select ok(
  (select c.record_format = 'diff_v2' and c.action = 'UPDATE'
      and c.chain_ordinal = 2 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash
      and c.after_hash = encode(extensions.digest(to_jsonb(b)::text, 'sha256'), 'hex')
   from public.dashboard_audit_logs c
   join pg_temp.issue234_pgtap_initial_heads p on p.entity_id = ''
   join pg_temp.issue234_audit_predecessor_probe b on b.id = ''
   where c.entity_table = 'issue234_audit_predecessor_probe' and c.entity_id = '' and c.action = 'UPDATE'),
  'a real empty-ID UPDATE takes the non-NULL branch and continues its own chain');

select ok(
  (select count(*) = 4 and count(distinct audit_chain_id) = 2
   from public.dashboard_audit_logs where entity_table = 'issue234_audit_predecessor_probe'
     and (entity_id is null or entity_id = ''))
  and not exists(
    select 1 from public.dashboard_audit_logs c
    join public.dashboard_audit_logs p on p.id = c.predecessor_event_id
    where c.entity_table = 'issue234_audit_predecessor_probe' and (c.entity_id is null or c.entity_id = '')
      and c.entity_id is distinct from p.entity_id),
  'NULL and empty IDs remain separate despite sharing the existing lock key');

-- Remove only the two audit events just created above to model source rows
-- without v2 history. The business trigger stays enabled throughout.
delete from public.dashboard_audit_logs where entity_table = 'issue234_audit_predecessor_probe'
  and entity_id in ('pgtap-no-history-update', 'pgtap-no-history-delete');
update pg_temp.issue234_audit_predecessor_probe set payload = '{"changed":true}' where id = 'pgtap-no-history-update';
delete from pg_temp.issue234_audit_predecessor_probe where id = 'pgtap-no-history-delete';

select ok(
  (select c.action = 'UPDATE' and c.record_format = 'diff_v2'
      and c.chain_start_kind = 'migration_boundary' and c.chain_ordinal = 1
      and c.predecessor_event_id is null and c.predecessor_after_hash is null
      and c.audit_chain_id <> p.audit_chain_id
   from public.dashboard_audit_logs c
   join pg_temp.issue234_pgtap_initial_heads p on p.entity_id = c.entity_id
   where c.entity_table = 'issue234_audit_predecessor_probe' and c.entity_id = 'pgtap-no-history-update'),
  'a real UPDATE without history preserves FOUND=false and starts ordinal one');

select ok(
  (select c.action = 'DELETE' and c.record_format = 'full_v2'
      and c.chain_start_kind = 'migration_boundary' and c.chain_ordinal = 1
      and c.predecessor_event_id is null and c.predecessor_after_hash is null
      and c.audit_chain_id <> p.audit_chain_id and c.after_hash is null
   from public.dashboard_audit_logs c
   join pg_temp.issue234_pgtap_initial_heads p on p.entity_id = c.entity_id
   where c.entity_table = 'issue234_audit_predecessor_probe' and c.entity_id = 'pgtap-no-history-delete'),
  'a real DELETE without history preserves the same boundary');

-- Corrupt only the isolated synthetic head. A valid row-shape hash value with
-- the wrong content must be rejected by the actual trigger's continuity guard.
update public.dashboard_audit_logs set after_hash = repeat('0', 64)
where entity_table = 'issue234_audit_predecessor_probe' and entity_id = 'pgtap-corrupt';
create temporary table issue234_pgtap_failure_snapshot on commit drop as
select
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(c) order by c.id nulls first, c.name))
   from pg_temp.issue234_audit_predecessor_probe c) as business_state,
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(a) order by a.event_sequence, a.id))
   from public.dashboard_audit_logs a
   where a.entity_table = 'issue234_audit_predecessor_probe') as audit_state,
  (select last_value from dashboard_private.dashboard_audit_event_sequence_v2) as sequence_before;

select throws_ok(
  $sql$update pg_temp.issue234_audit_predecessor_probe set name = 'must roll back' where id = 'pgtap-corrupt'$sql$,
  '55000', 'audit_chain_continuity_invalid',
  'the final trigger rejects a mismatched before hash with the exact SQLSTATE and message');

select is(
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(c) order by c.id nulls first, c.name))::text
   from pg_temp.issue234_audit_predecessor_probe c),
  (select business_state::text from pg_temp.issue234_pgtap_failure_snapshot),
  'rejected UPDATE leaves every probe row and its row count unchanged');

select is(
  (select jsonb_build_object('count', count(*), 'rows',
      jsonb_agg(to_jsonb(a) order by a.event_sequence, a.id))::text
   from public.dashboard_audit_logs a
   where a.entity_table = 'issue234_audit_predecessor_probe'),
  (select audit_state::text from pg_temp.issue234_pgtap_failure_snapshot),
  'rejected UPDATE leaves every probe audit row and its row count unchanged');

select is(
  (select last_value from dashboard_private.dashboard_audit_event_sequence_v2),
  (select sequence_before + 1 from pg_temp.issue234_pgtap_failure_snapshot),
  'the rejected write retains the existing nontransactional sequence gap');

delete from pg_temp.issue234_audit_predecessor_probe where id is null;
select ok(
  (select c.action = 'DELETE' and c.record_format = 'full_v2'
      and c.chain_ordinal = 3 and c.audit_chain_id = p.audit_chain_id
      and c.predecessor_event_id = p.id and c.predecessor_after_hash = p.after_hash
      and c.before_hash = p.after_hash and c.after_hash is null
      and c.before_record = '{"id":null,"name":"pgTAP NULL entity","payload":{"step":1}}'::jsonb
      and c.after_record is null
   from public.dashboard_audit_logs c
   join public.dashboard_audit_logs p on p.id = c.predecessor_event_id
   where c.entity_table = 'issue234_audit_predecessor_probe' and c.entity_id is null and c.action = 'DELETE'),
  'a real NULL-ID DELETE retains its preimage, predecessor and ordinal');

select * from finish();
rollback;
