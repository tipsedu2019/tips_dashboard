-- pgTAP coverage for an authorized disposable synthetic test database.
-- Fixtures roll back and do not create credentials or mutate stored production data.
begin;
select no_plan();
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000005';

-- Only synthetic identities are created; no password, email or provider is supplied.
create temporary table annual_range_actors (
  actor_id uuid primary key,
  expected_role text not null
) on commit drop;
insert into annual_range_actors(actor_id, expected_role) values
  ('92993000-0000-4000-8000-000000000001', 'viewer'),
  ('92993000-0000-4000-8000-000000000002', 'teacher'),
  ('92993000-0000-4000-8000-000000000003', 'assistant'),
  ('92993000-0000-4000-8000-000000000004', 'staff'),
  ('92993000-0000-4000-8000-000000000005', 'admin');
insert into auth.users(id) select actor_id from annual_range_actors;
insert into public.profiles(id, role)
select actor_id, expected_role from annual_range_actors
on conflict (id) do update set role = excluded.role;

select has_function('public', 'get_operations_annual_board_v1', array['integer'], 'annual RPC exists in the final applied definition');
select ok(
  not (select proc.prosecdef from pg_catalog.pg_proc proc where proc.oid = 'public.get_operations_annual_board_v1(integer)'::pg_catalog.regprocedure)
  and (select proc.proconfig in (array['search_path=']::text[], array['search_path=""']::text[]) from pg_catalog.pg_proc proc where proc.oid = 'public.get_operations_annual_board_v1(integer)'::pg_catalog.regprocedure)
  and pg_catalog.has_function_privilege('authenticated', 'public.get_operations_annual_board_v1(integer)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.get_operations_annual_board_v1(integer)', 'EXECUTE')
  and not exists (
    select 1
    from pg_catalog.pg_proc proc
    cross join lateral pg_catalog.aclexplode(coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) as acl
    where proc.oid = 'public.get_operations_annual_board_v1(integer)'::pg_catalog.regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'annual RPC retains fixed search path, invoker security, and authenticated-only execute ACL'
);
select throws_ok(
  $$select public.get_operations_annual_board_v1(1999)$$,
  '22023', 'operations_academic_year_invalid', 'annual RPC preserves the exact invalid-year SQLSTATE'
);

select throws_ok(
  $$select public.get_operations_annual_board_v1(2201)$$,
  '22023', 'operations_academic_year_invalid', 'annual RPC preserves the exact upper invalid-year SQLSTATE'
);

create temporary table annual_range_cases (
  ordinal integer primary key,
  title text not null,
  event_type text not null default '시험기간',
  starts_on date not null,
  metadata jsonb not null,
  expected_end text not null,
  expected_date_label text not null
) on commit drop;
insert into annual_range_cases(ordinal, title, starts_on, metadata, expected_end, expected_date_label)
values
  (1, 'inclusive range', '2196-10-06', '{"rangeEnd":"2196-10-08"}', '2196-10-08', '2196-10-06 ~ 2196-10-08'),
  (2, 'missing end', '2196-10-06', '{}', '2196-10-06', '2196-10-06'),
  (3, 'same end', '2196-10-06', '{"rangeEnd":"2196-10-06"}', '2196-10-06', '2196-10-06'),
  (4, 'end before start', '2196-10-06', '{"rangeEnd":"2196-10-05"}', '2196-10-06', '2196-10-06'),
  (5, 'invalid day', '2196-02-28', '{"rangeEnd":"2196-02-30"}', '2196-02-28', '2196-02-28'),
  (6, 'invalid format', '2196-02-28', '{"rangeEnd":"2196-2-29"}', '2196-02-28', '2196-02-28'),
  (7, 'null end', '2196-10-06', '{"rangeEnd":null}', '2196-10-06', '2196-10-06'),
  (8, 'numeric end', '2196-10-06', '{"rangeEnd":21961008}', '2196-10-06', '2196-10-06'),
  (9, 'month boundary', '2196-09-30', '{"rangeEnd":"2196-10-02"}', '2196-10-02', '2196-09-30 ~ 2196-10-02'),
  (10, 'year boundary', '2196-12-31', '{"rangeEnd":"2197-01-02"}', '2197-01-02', '2196-12-31 ~ 2197-01-02'),
  (11, 'valid leap day', '2196-02-28', '{"rangeEnd":"2196-02-29"}', '2196-02-29', '2196-02-28 ~ 2196-02-29');
insert into annual_range_cases(ordinal, title, event_type, starts_on, metadata, expected_end, expected_date_label)
values (12, 'actual subject range', '수학시험일', '2196-10-06', '{"rangeEnd":"2196-10-08"}', '2196-10-08', '2196-10-06 ~ 2196-10-08');

insert into public.academic_schools(id, name, category)
values ('92990000-0000-4000-8000-000000000001', '__annual_range_synthetic__', 'middle');
insert into public.academic_events(id, title, school_id, type, date, grade, note)
select
  ('92991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0'))::uuid,
  cases.title,
  '92990000-0000-4000-8000-000000000001',
  cases.event_type,
  cases.starts_on,
  '중2',
  E'합성 메모\n\n[[TIPS_META]] ' || cases.metadata::text
from annual_range_cases as cases;
insert into public.academic_event_exam_details(id, academic_event_id, school_id, grade, subject, exam_date, exam_date_status, sort_order)
values (
  '92992000-0000-4000-8000-000000000001',
  '92991000-0000-4000-8000-000000000001',
  '92990000-0000-4000-8000-000000000001',
  '중2', '수학', '2196-10-07', 'exact', 0
);
create temporary table annual_range_stored_before on commit drop as
select id, date, note from public.academic_events
where school_id = '92990000-0000-4000-8000-000000000001';

create temporary table annual_range_snapshot_utc on commit drop as
select public.get_operations_annual_board_v1(2196) as snapshot;
select is((select snapshot ->> 'ok' from annual_range_snapshot_utc), 'true', 'invalid stored range metadata does not abort the annual RPC');
create temporary table annual_range_entries on commit drop as
select entry.value as entry
from annual_range_snapshot_utc as snapshots
cross join lateral pg_catalog.jsonb_array_elements(snapshots.snapshot #> '{data,rows}') as row
cross join lateral pg_catalog.jsonb_each(row.value -> 'typeBuckets') as bucket
cross join lateral pg_catalog.jsonb_array_elements(bucket.value) as entry
where row.value ->> 'schoolId' = '92990000-0000-4000-8000-000000000001';

select is(
  (select entry ->> 'end' from annual_range_entries where entry ->> 'id' = '92991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0')),
  cases.expected_end,
  cases.title || ' returns the expected inclusive end'
) from annual_range_cases as cases;
select is(
  (select entry ->> 'dateLabel' from annual_range_entries where entry ->> 'id' = '92991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0')),
  cases.expected_date_label,
  cases.title || ' returns the expected date label'
) from annual_range_cases as cases;
select is(
  (select entry #>> '{displayMeta,rangeEnd}' from annual_range_entries where entry ->> 'id' = '92991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0')),
  cases.metadata ->> 'rangeEnd',
  cases.title || ' retains the stored display metadata envelope'
) from annual_range_cases as cases;
select is(
  (select entry ->> 'end' from annual_range_entries where entry ->> 'id' = 'exam-detail:92992000-0000-4000-8000-000000000001'),
  '2196-10-07', 'an actual subject detail retains its independent single exam date'
);
select is(
  (select entry ->> 'examDateLabel' from annual_range_entries where entry ->> 'id' = 'exam-detail:92992000-0000-4000-8000-000000000001'),
  '2196-10-07', 'subject detail date label retains its independent date'
);
select is(
  (select entry #>> '{displayMeta,rangeEnd}' from annual_range_entries where entry ->> 'id' = 'exam-detail:92992000-0000-4000-8000-000000000001'),
  '2196-10-08', 'subject detail retains its parent metadata without changing the actual exam date'
);
select is(
  (select pg_catalog.count(*)::integer
   from pg_catalog.jsonb_array_elements(public.get_operations_annual_board_v1(2197) #> '{data,rows}') as row
   where row.value ->> 'schoolId' = '92990000-0000-4000-8000-000000000001'),
  0, 'a range crossing New Year keeps the existing start-year filter'
);

set local timezone = 'America/Los_Angeles';
select is(
  public.get_operations_annual_board_v1(2196),
  (select snapshot from annual_range_snapshot_utc),
  'date-only annual RPC output is unchanged across timezone settings'
);
select is(
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', event.id, 'date', event.date, 'note', event.note) order by event.id)
   from public.academic_events as event where event.school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', saved.id, 'date', saved.date, 'note', saved.note) order by saved.id)
   from annual_range_stored_before as saved),
  'annual reads leave saved event dates and notes unchanged'
);
-- Capture results while each actual DB role is active, then assert as the test
-- owner. This avoids changing pgTAP/production function ACLs for the role probes.
create function pg_temp.capture_annual_range_rpc(p_year integer)
returns jsonb language plpgsql security invoker as $capture$
declare
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  v_result := public.get_operations_annual_board_v1(p_year);
  return pg_catalog.jsonb_build_object('result', v_result);
exception when others then
  get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  return pg_catalog.jsonb_build_object('sqlstate', v_sqlstate, 'message', v_message);
end
$capture$;

create function pg_temp.annual_range_school_rows(p_snapshot jsonb)
returns jsonb language sql immutable security invoker as $rows$
  select coalesce(pg_catalog.jsonb_agg(row.value order by row.value ->> 'id'), '[]'::jsonb)
  from pg_catalog.jsonb_array_elements(p_snapshot #> '{data,rows}') as row
  where row.value ->> 'schoolId' = '92990000-0000-4000-8000-000000000001'
$rows$;

create temporary table annual_range_role_results (
  actor_role text primary key,
  resolved_profile_role text,
  rpc_result jsonb not null,
  base_event_count integer,
  school_count integer,
  subject_detail_count integer
) on commit drop;
-- These are grants on one local temporary evidence table only, rolled back below.
grant insert on annual_range_role_results to authenticated, anon;

set local role anon;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
insert into annual_range_role_results(actor_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'anon', pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
insert into annual_range_role_results(actor_role, rpc_result)
values ('authenticated-no-sub', pg_temp.capture_annual_range_rpc(2196));
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000001';
insert into annual_range_role_results(actor_role, resolved_profile_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'viewer', public.current_dashboard_role(), pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000002';
insert into annual_range_role_results(actor_role, resolved_profile_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'teacher', public.current_dashboard_role(), pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000003';
insert into annual_range_role_results(actor_role, resolved_profile_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'assistant', public.current_dashboard_role(), pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000004","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000004';
insert into annual_range_role_results(actor_role, resolved_profile_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'staff', public.current_dashboard_role(), pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"92993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '92993000-0000-4000-8000-000000000005';
insert into annual_range_role_results(actor_role, resolved_profile_role, rpc_result, base_event_count, school_count, subject_detail_count)
values (
  'admin', public.current_dashboard_role(), pg_temp.capture_annual_range_rpc(2196),
  (select pg_catalog.count(*)::integer from public.academic_events where school_id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_schools where id = '92990000-0000-4000-8000-000000000001'),
  (select pg_catalog.count(*)::integer from public.academic_event_exam_details where school_id = '92990000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select rpc_result ->> 'sqlstate' from annual_range_role_results where actor_role = 'anon'),
  '42501', 'anon receives the actual RPC EXECUTE permission SQLSTATE'
);
select is((select base_event_count from annual_range_role_results where actor_role = 'anon'), 0, 'anon RLS hides the synthetic base events');
select is((select school_count from annual_range_role_results where actor_role = 'anon'), 0, 'anon RLS hides the synthetic school');
select is((select subject_detail_count from annual_range_role_results where actor_role = 'anon'), 0, 'anon RLS hides the synthetic subject detail');
select is(
  (select rpc_result from annual_range_role_results where actor_role = 'authenticated-no-sub'),
  '{"sqlstate":"42501","message":"science_subject_areas_authentication_required"}'::jsonb,
  'authenticated without UID preserves the existing exact science authentication failure'
);
select is(
  results.resolved_profile_role, actors.expected_role,
  actors.expected_role || ' resolves its actual database-backed profile role'
)
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(
  results.rpc_result #>> '{result,ok}', 'true',
  actors.expected_role || ' executes the annual RPC as authenticated'
)
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(
  pg_temp.annual_range_school_rows(results.rpc_result -> 'result'),
  (select pg_temp.annual_range_school_rows(snapshot) from annual_range_snapshot_utc),
  actors.expected_role || ' reads exactly the owner snapshot of the synthetic school, including dates and metadata'
)
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(results.base_event_count, 12, actors.expected_role || ' retains exact base event RLS scope')
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(results.school_count, 1, actors.expected_role || ' retains exact school RLS scope')
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(results.subject_detail_count, 1, actors.expected_role || ' retains exact subject detail RLS scope')
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;
select is(
  (select pg_catalog.count(*)::integer
   from pg_catalog.jsonb_array_elements(pg_temp.annual_range_school_rows(results.rpc_result -> 'result')) as row
   cross join lateral pg_catalog.jsonb_each(row.value -> 'typeBuckets') as bucket
   cross join lateral pg_catalog.jsonb_array_elements(bucket.value) as entry),
  13, actors.expected_role || ' retains exactly twelve base entries and one independent subject detail'
)
from annual_range_actors as actors
join annual_range_role_results as results on results.actor_role = actors.expected_role;

select finish();
rollback;
