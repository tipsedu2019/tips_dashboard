-- Authorized isolated synthetic DB only. Every fixture rolls back.
begin;
select no_plan();
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000005';
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000005');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000005','admin') on conflict(id) do update set role=excluded.role;
create temporary table calendar_range_cases (
  ordinal integer primary key,
  title text not null,
  event_type text not null default '시험기간',
  starts_on date not null,
  metadata jsonb not null,
  expected_end text not null,
  expected_date_label text not null
) on commit drop;
insert into calendar_range_cases(ordinal, title, starts_on, metadata, expected_end, expected_date_label)
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
insert into calendar_range_cases(ordinal, title, event_type, starts_on, metadata, expected_end, expected_date_label)
values (12, 'actual subject range', '수학시험일', '2196-10-06', '{"rangeEnd":"2196-10-08"}', '2196-10-08', '2196-10-06 ~ 2196-10-08');

insert into public.academic_schools(id, name, category)
values ('93990000-0000-4000-8000-000000000001', '__calendar_range_synthetic__', 'high');
insert into public.academic_events(id, title, school_id, type, date, grade, note)
select
  ('93991000-0000-4000-8000-' || pg_catalog.lpad(cases.ordinal::text, 12, '0'))::uuid,
  cases.title,
  '93990000-0000-4000-8000-000000000001',
  cases.event_type,
  cases.starts_on,
  '고1, 고2, 고3',
  E'합성 메모\n\n[[TIPS_META]] ' || cases.metadata::text
from calendar_range_cases as cases;

insert into public.academic_events(id,title,school_id,type,date,grade,note) values
('93991000-0000-4000-8000-000000000013','separate single grade','93990000-0000-4000-8000-000000000001','시험기간','2196-10-02','고2','합성 메모'),
('93991000-0000-4000-8000-000000000014','long range','93990000-0000-4000-8000-000000000001','시험기간','2196-10-01','all','[[TIPS_META]] {"rangeEnd":"9999-12-31"}');
create temporary table calendar_stored_before as select id,date,grade,note from public.academic_events where school_id='93990000-0000-4000-8000-000000000001';
select is(public.get_academic_event_detail_v1(('93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid)->>'endsAt',expected_end,title || ' exact detail inclusive end') from calendar_range_cases;
select is((select row->>'endsAt' from jsonb_array_elements(public.get_operations_calendar_range_v1(starts_on,starts_on)->'rows') row where row->>'id'='93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0')),expected_end,title || ' calendar inclusive end') from calendar_range_cases;
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000001'),1,'end equals viewport start remains visible');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-09','2196-10-09')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000001'),0,'day after inclusive end is absent');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2197-01-01','2197-01-02')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000010'),1,'prior year start overlaps January viewport');
select is((select count(*)::int from jsonb_array_elements(public.get_operations_calendar_range_v1('2196-10-01','2196-10-02')->'rows') row where row->>'id'='93991000-0000-4000-8000-000000000009'),1,'prior month start overlaps October viewport');
select is(public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000001')->>'grade','고1, 고2, 고3','multi-grade identity is preserved');
select is(public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000013')->>'grade','고2','separate single grade identity is preserved');
select is(public.get_operations_calendar_range_v1('2196-10-01','2196-11-11')->>'ok','true','42 inclusive days allowed');
select throws_ok($$select public.get_operations_calendar_range_v1('2196-10-01','2196-11-12')$$,'22023','operations_visible_range_invalid','43 days rejected with exact SQLSTATE');
create temporary table calendar_snapshot as select public.get_operations_calendar_range_v1('2196-09-25','2196-11-05') as payload;
select diag('CALENDAR_RANGE_CAPTURE=' || jsonb_build_object('calendar',(select payload from calendar_snapshot),'details',(select jsonb_agg(public.get_academic_event_detail_v1(id) order by id) from calendar_stored_before))::text);
set local timezone = 'America/Los_Angeles';
select is(public.get_operations_calendar_range_v1('2196-09-25','2196-11-05'),(select payload from calendar_snapshot),'date-only output independent of timezone');
select is((select jsonb_agg(to_jsonb(e) order by id) from (select id,date,grade,note from public.academic_events where school_id='93990000-0000-4000-8000-000000000001') e),(select jsonb_agg(to_jsonb(e) order by id) from calendar_stored_before e),'reads never mutate saved data');
create temporary table calendar_role_results(actor text, calendar jsonb, detail jsonb, visible_ids jsonb) on commit drop;
grant insert on calendar_role_results to authenticated, anon;
create function pg_temp.calendar_capture(p_detail boolean) returns jsonb language plpgsql security invoker as $capture$
begin
  if p_detail then return public.get_academic_event_detail_v1('93991000-0000-4000-8000-000000000001'); end if;
  return public.get_operations_calendar_range_v1('2196-09-25','2196-11-05');
exception when others then return jsonb_build_object('sqlstate',sqlstate);
end $capture$;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000001');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000001','viewer') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000002');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000002','teacher') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000003');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000003','assistant') on conflict(id) do update set role=excluded.role;
insert into auth.users(id) values ('93993000-0000-4000-8000-000000000004');
insert into public.profiles(id,role) values ('93993000-0000-4000-8000-000000000004','staff') on conflict(id) do update set role=excluded.role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000001';
insert into calendar_role_results values ('viewer',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000002';
insert into calendar_role_results values ('teacher',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000003","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000003';
insert into calendar_role_results values ('assistant',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000004","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000004';
insert into calendar_role_results values ('staff',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93993000-0000-4000-8000-000000000005","role":"authenticated"}';
set local request.jwt.claim.sub = '93993000-0000-4000-8000-000000000005';
insert into calendar_role_results values ('admin',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),(select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb) from public.academic_events where school_id='93990000-0000-4000-8000-000000000001' and date<='2196-11-05' and (case when id::text in ('93991000-0000-4000-8000-000000000001','93991000-0000-4000-8000-000000000012') then '2196-10-08'::date when id::text='93991000-0000-4000-8000-000000000014' then '9999-12-31'::date else date end)>='2196-09-25'));
reset role;
set local role anon;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
insert into calendar_role_results values ('anon',pg_temp.calendar_capture(false),pg_temp.calendar_capture(true),null);
reset role;
select is(calendar->>'sqlstate','42501','anon calendar denied') from calendar_role_results where actor='anon';
select is(detail->>'sqlstate','42501','anon detail denied') from calendar_role_results where actor='anon';
select is((select coalesce(jsonb_agg(row->>'id' order by row->>'id'),'[]'::jsonb) from jsonb_array_elements(calendar->'rows') row where row->>'schoolId'='93990000-0000-4000-8000-000000000001'),visible_ids,actor || ' calendar matches RLS visible source identities') from calendar_role_results where actor<>'anon';
select is(detail->>'endsAt',case when visible_ids @> '["93991000-0000-4000-8000-000000000001"]'::jsonb then '2196-10-08' else null end,actor || ' exact detail respects visible source') from calendar_role_results where actor<>'anon';
select is(public.get_academic_event_detail_v1(('93991000-0000-4000-8000-' || lpad(ordinal::text,12,'0'))::uuid)->>'durationLabel',case when expected_end=starts_on::text then '하루 일정' else expected_date_label end,title || ' detail duration label') from calendar_range_cases;
insert into public.academic_events(id,title,school_id,type,date,grade,note)
select ('93994000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'overlap dense ' || n,'93990000-0000-4000-8000-000000000001','팁스','2196-09-01','all','[[TIPS_META]] {"rangeEnd":"2196-10-08"}' from generate_series(1,2001) n;
select is(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->>'code','visible_range_too_dense','2001 overlapping prior starts preserve density rejection');
select is(public.get_operations_calendar_range_v1('2196-10-08','2196-10-08')->'rows','[]'::jsonb,'dense response never returns partial rows');
select * from finish();
rollback;
