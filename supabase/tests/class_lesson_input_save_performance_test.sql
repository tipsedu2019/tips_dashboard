-- Reuses the synthetic 70-to-79 data contract from the held performance investigation;
-- neither held performance migration is part of this policy candidate.
begin;
set local track_functions='all';
select no_plan();

-- Entirely synthetic: 84 background classes x 128 dated lessons, plus one
-- target with 54 historical + 8 November + 8 December lessons. No production
-- identities, rows or learning content are copied. The nine October dates are
-- literal calendar dates; neither now() nor the validator cutoff is replaced.
create function pg_temp.append_id(n int) returns uuid language sql immutable as $$
 select ('af220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.append_id(1),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','append-month-performance@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.append_id(1),'admin','Synthetic append administrator')
 on conflict(id) do update set role='admin';
select set_config('request.jwt.claim.sub',pg_temp.append_id(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.append_id(1),'role','authenticated')::text,true);
insert into public.teacher_catalogs(id,name,subjects)
 select pg_temp.append_id(100+n),'Synthetic append teacher '||n,array['영어'] from generate_series(0,84)n;
insert into public.classroom_catalogs(id,name,subjects)
 select pg_temp.append_id(200+n),'Synthetic append room '||n,array['영어'] from generate_series(0,84)n;

-- Every background class occupies the SAME Tue/Thu interval on all nine
-- requested dates, with distinct valid teachers/rooms. Unlike a Friday makeup
-- on an otherwise empty day, every new target row has a dense peer bucket.
-- Planner-shaped synthetic IDs retain realistic identity width in the reference;
-- memo padding alone is discarded by the reader's occupancy projection.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan)
 select pg_temp.append_id(1000+n),'Synthetic dense background '||n,'영어','수강','legacy',
 E'화 19:30-21:30\n목 19:30-21:30','Synthetic append teacher '||n,'Synthetic append room '||n,
 jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object(
  'id','session:'||lpad((w*2+day_offset/2+1)::text,3,'0')||':'||
   (date '2026-02-03'+w*7+day_offset)::text||':'||pg_temp.append_id(10000+n)::text||':active',
  'date',date '2026-02-03'+w*7+day_offset,'scheduleState','active','state','active',
  'isForced',false,'originalDate','','makeupDate','','memo',repeat('synthetic history ',40)) order by w,day_offset)
  from generate_series(0,63)w cross join (values(0),(2))days(day_offset)))
 from generate_series(1,84)n;

create temp table append_old_dates as
 with historical as (
  select date '2025-01-01'+n d from generate_series(0,211)n
  where extract(dow from date '2025-01-01'+n) in(2,4) order by n limit 54
 )
 select d from historical union all
 select d from unnest(array[
  date '2026-11-03',date '2026-11-05',date '2026-11-10',date '2026-11-12',
  date '2026-11-17',date '2026-11-19',date '2026-11-24',date '2026-11-26',
  date '2026-12-01',date '2026-12-03',date '2026-12-08',date '2026-12-10',
  date '2026-12-15',date '2026-12-17',date '2026-12-22',date '2026-12-24'])dates(d);
create temp table append_october_dates as
 select d,row_number() over(order by d)::int session_number from unnest(array[
  date '2026-10-01',date '2026-10-06',date '2026-10-08',date '2026-10-13',date '2026-10-15',
  date '2026-10-20',date '2026-10-22',date '2026-10-27',date '2026-10-29'])dates(d);

create temp table append_original_plan as
 with old_rows as (
  select d,row_number() over(partition by to_char(d,'YYYY-MM') order by d)::int session_number from append_old_dates
 ), periods as (
  select to_char(d,'YYYY-MM') month_key,min(d) first_date,max(d) last_date,count(*) lesson_count
  from append_old_dates group by 1
 )
 select jsonb_build_object('version',2,'subject','영어','className','Synthetic October append',
  'selectedDays',jsonb_build_array(2,4),'globalSessionCount',8,'textbooks','[]'::jsonb,
  'history',jsonb_build_array(jsonb_build_object('id','synthetic-retained-history','memo','Preserve this complete synthetic history')),
  'billingPeriods',(select jsonb_agg(jsonb_build_object('id','synthetic-'||month_key,
   'month',extract(month from first_date)::int,'label',extract(month from first_date)::int||'월',
   'startDate',first_date,'endDate',last_date,'totalSessions',lesson_count) order by first_date) from periods),
  'sessions',(select jsonb_agg(jsonb_build_object('id','old-'||d,'sessionKey','old-'||d,'date',d,
   'billingId','synthetic-'||to_char(d,'YYYY-MM'),'billingLabel',extract(month from d)::int||'월',
   'sessionNumber',session_number,'state','active','scheduleState','active','isForced',false,
   'originalDate','','makeupDate','','memo','Preserve synthetic memo '||d,
   'teacherNote','Preserve synthetic learning note '||d,
   'rawHistoryMarker',jsonb_build_object('date',d,'unchanged',true)) order by d) from old_rows)) plan;
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan)
 select pg_temp.append_id(1000),'Synthetic October append','영어','수강','legacy',
 E'화 19:30-21:30\n목 19:30-21:30','Synthetic append teacher 0','Synthetic append room 0',plan
 from append_original_plan;

-- Fixture arrangement ONLY: establish the inherited legacy baseline, then leave
-- all real reader/validator bodies, locks, RLS, receipts and triggers enabled.
update dashboard_private.timetable_operating_write_baselines
 set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table append_before as select schedule_plan plan,to_jsonb(c)-'schedule_plan'-'updated_at' other_fields
 from public.classes c where id=pg_temp.append_id(1000);
create temp table append_background_before as select id,to_jsonb(c) row_snapshot
 from public.classes c where id in(select pg_temp.append_id(1000+n) from generate_series(1,84)n);
create temp table append_no_send as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
create temp table append_proposed as select plan||jsonb_build_object(
 'billingPeriods',(plan->'billingPeriods')||jsonb_build_array(jsonb_build_object(
  'id','synthetic-2026-10','month',10,'label','10월','startDate','2026-10-01','endDate','2026-10-29','totalSessions',9)),
 'sessions',(select jsonb_agg(s order by s->>'date',s->>'id') from jsonb_array_elements((plan->'sessions')||
  (select jsonb_agg(jsonb_build_object('id','new-'||d,'sessionKey','new-'||d,'date',d,
   'billingId','synthetic-2026-10','billingLabel','10월','sessionNumber',session_number,
   'state','active','scheduleState','active','isForced',false,'originalDate','','makeupDate','','memo','') order by d)
   from append_october_dates)) rows(s))) plan from append_before;

select is((select count(*) from append_old_dates),70::bigint,'baseline is exactly 54 historical plus November 8 and December 8');
select is((select count(*) from append_old_dates where d<date '2026-10-01'),54::bigint,'exactly 54 old lessons precede October');
select ok(not (select plan ? 'sessionSchedules' from append_before),'old plan has no sessionSchedules override map');
select ok(not exists(select 1 from append_before,jsonb_array_elements(plan->'sessions')s
 where s ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','sourceSlotId','occupancy']),
 'all old 70 rows retain date-only inherited occupancy');
select is((select count(*) from append_october_dates),9::bigint,'nine literal October dates');
select ok((select bool_and(extract(dow from d) in(2,4)) from append_october_dates),'every requested October date is Tuesday or Thursday');
select ok(not exists(select 1 from append_october_dates d where
 (select count(*) from append_background_before b,jsonb_array_elements(b.row_snapshot->'schedule_plan'->'sessions')s
  where s->>'date'=d.d::text)<>84),'each new October date has 84 same-time background lessons');
select is((select sum(jsonb_array_length(row_snapshot->'schedule_plan'->'sessions')) from append_background_before),
 10752::bigint,'background contains 84 times 128 materialized lessons');

create temp table append_replies(kind text primary key,response jsonb);
grant select on append_before,append_proposed to authenticated;
grant select,insert on append_replies to authenticated;
create function pg_temp.append_month() returns jsonb language plpgsql as $$
declare result jsonb;
begin
 result:=public.update_class_operational_v1(pg_temp.append_id(1000),
  jsonb_build_object('schedule_plan',(select plan from append_proposed)),pg_temp.append_id(3000),(select plan from append_before));
 set constraints all immediate;
 set constraints all deferred;
 return result;
end$$;
create temp table append_reader_calls_before as select coalesce(sum(calls),0)::bigint n from pg_stat_xact_user_functions where funcid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure;
create temp table append_timing(started timestamptz);
insert into append_timing values(clock_timestamp());
set local statement_timeout='8s';
set local role authenticated;
select lives_ok($q$insert into append_replies values('first',pg_temp.append_month())$q$,
 'actual authenticated 70-to-79 append plus fresh deferred validation completes within 8 seconds');
reset role;
select diag('append_and_deferred_ms='||(extract(epoch from clock_timestamp()-(select started from append_timing))*1000)::numeric(12,2));
create temp table append_reader_delta as select (coalesce(sum(calls),0)-(select n from append_reader_calls_before))::bigint n from pg_stat_xact_user_functions where funcid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure;
select is((select n from append_reader_delta),0::bigint,'lesson input RPC and deferred completion do not construct a global operating reference');
select diag('operating_reference_calls='||n) from append_reader_delta;
select is((select schedule_plan from public.classes where id=pg_temp.append_id(1000)),(select plan from append_proposed),
 'complete proposed plan reads back exactly');
select is((select jsonb_array_length(schedule_plan->'sessions') from public.classes where id=pg_temp.append_id(1000)),79,'stored target has exactly 79 sessions');
select is((select count(distinct s->>'id') from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions')s where c.id=pg_temp.append_id(1000)),79::bigint,'no duplicate stored session identities');
select is((select count(distinct s->>'date') from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions')s where c.id=pg_temp.append_id(1000)),79::bigint,'no duplicate stored dates');
select is((select jsonb_agg(s order by s->>'date',s->>'id') from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions')s
 where c.id=pg_temp.append_id(1000) and s->>'id' like 'old-%'),(select plan->'sessions' from append_before),
 'all original 70 full rows, memo and learning history remain byte-value equivalent');
select is((select schedule_plan->'history' from public.classes where id=pg_temp.append_id(1000)),(select plan->'history' from append_before),'plan history remains exact');
select is((select jsonb_agg(p order by p->>'startDate') from public.classes c,jsonb_array_elements(c.schedule_plan->'billingPeriods')p
 where c.id=pg_temp.append_id(1000) and p->>'id'<>'synthetic-2026-10'),(select plan->'billingPeriods' from append_before),'all old billing periods including November and December remain exact');
select is((select jsonb_agg(jsonb_build_array(s->>'date',s->>'billingId',s->>'billingLabel',s->'sessionNumber',s->>'scheduleState') order by s->>'date')
 from public.classes c,jsonb_array_elements(c.schedule_plan->'sessions')s where c.id=pg_temp.append_id(1000) and s->>'id' like 'new-%'),
 (select jsonb_agg(jsonb_build_array(d::text,'synthetic-2026-10','10월',session_number,'active') order by d) from append_october_dates),
 'each of the exact nine dates retains October billing key, ordinal and active state');
select is((select p from public.classes c,jsonb_array_elements(c.schedule_plan->'billingPeriods')p where c.id=pg_temp.append_id(1000) and p->>'id'='synthetic-2026-10'),
 '{"id":"synthetic-2026-10","month":10,"label":"10월","startDate":"2026-10-01","endDate":"2026-10-29","totalSessions":9}'::jsonb,'October billing month is 10, never January');

-- The version-1 UI writes date-only lessons and resolves weekly defaults on
-- read. These checks run AFTER the timed writer/deferred boundary above.
create temp table append_stored_context as
 select c.schedule_plan plan,dashboard_private.legacy_effective_context_v1(c) context
 from public.classes c where c.id=pg_temp.append_id(1000);
select is((select context->'version' from append_stored_context),'1'::jsonb,'stored class exposes the version-1 inheritance context');
select ok((select not (plan ? 'sessionSchedules') and not exists(
 select 1 from jsonb_array_elements(plan->'sessions')s where s->>'id' like 'new-%'
 and s ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName','sourceSlotId','occupancy'])
 from append_stored_context),'all nine new rows use date-only v1 inheritance without resource snapshots or date overrides');
select is((select jsonb_agg(jsonb_build_array(s->>'date',effective->>'kind',effective->'values',effective->'provenance') order by s->>'date')
 from append_stored_context c cross join lateral jsonb_array_elements(c.plan->'sessions')s
 cross join lateral (select dashboard_private.resolve_legacy_effective_schedule_v1(
  dashboard_private.legacy_effective_input_v1(c.plan,s,c.context,1,1)) effective) resolved
 where s->>'id' like 'new-%'),
 (select jsonb_agg(jsonb_build_array(d::text,'resolved',
  jsonb_build_object('startTime','19:30','endTime','21:30','teacherCatalogId',pg_temp.append_id(100),'classroomCatalogId',pg_temp.append_id(200)),
  jsonb_build_object('startTime','basic_weekday','endTime','basic_weekday','teacherCatalogId','basic_weekday','classroomCatalogId','basic_weekday')) order by d)
 from append_october_dates),'v1 context resolves every new date to the exact inherited teacher, room and times with weekly provenance');
create temp table append_stored_reference as select dashboard_private.read_timetable_operating_reference_v1() reference;
select is((select jsonb_agg(jsonb_build_array(s->>'date',s->'startMinute',s->'endMinute',s->>'teacherId',s->>'classroomId',s->>'state',
 s->>'inheritedWeeklySlotId' is not null) order by s->>'date')
 from append_stored_reference r cross join lateral jsonb_array_elements(r.reference->'datedSessions')s
 where s->>'classId'=pg_temp.append_id(1000)::text and s->>'date' between '2026-10-01' and '2026-10-29'),
 (select jsonb_agg(jsonb_build_array(d::text,1170,1290,pg_temp.append_id(100)::text,pg_temp.append_id(200)::text,'active',true) order by d)
 from append_october_dates),'complete operating reader emits exactly nine correctly resolved inherited October occupancies');
select ok(not exists(select 1 from append_stored_reference r,
 jsonb_array_elements((r.reference->'unresolvedOccupancies')||(r.reference->'datedUnresolvedOccupancies'))b
 where b->>'classId'=pg_temp.append_id(1000)::text),'target inheritance introduces no weekly or dated unresolved occupancy');

set local role authenticated;
select lives_ok($q$insert into append_replies values('replay',pg_temp.append_month())$q$,'identical request replays with the original expected plan');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.append_id(1000),
 jsonb_build_object('schedule_plan',(select plan from append_proposed)),pg_temp.append_id(3001),(select plan from append_before))$q$,
 'P0001','class_schedule_stale','a new request cannot reuse the now-stale original plan');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.append_id(1000),
 jsonb_build_object('schedule_plan',(select plan from append_before)),pg_temp.append_id(3000),(select plan from append_before))$q$,
 '22023','idempotency_key_reused','the accepted request key cannot carry a different plan');
reset role;
select is((select response from append_replies where kind='replay'),(select response from append_replies where kind='first'),'replay returns the exact stored response');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.append_id(1)
 and operation='update_class_operational_v1'),1::bigint,'one receipt only; replay and rejected requests create none');
select is((select response_payload from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.append_id(1)
 and operation='update_class_operational_v1' and request_key=pg_temp.append_id(3000)),(select response from append_replies where kind='first'),'receipt stores the actual writer response');
select is((select schedule_plan from public.classes where id=pg_temp.append_id(1000)),(select plan from append_proposed),'replay and rejected writes preserve all 79 rows');
select is((select to_jsonb(c)-'schedule_plan'-'updated_at' from public.classes c where id=pg_temp.append_id(1000)),(select other_fields from append_before),'non-plan target fields are unchanged');
select ok(not exists(select 1 from append_background_before b join public.classes c using(id) where b.row_snapshot<>to_jsonb(c)),'all 84 background class rows are unchanged');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),0::bigint,'fresh deferred validation removed the transaction baseline');
select is((select count(*) from dashboard_private.notification_events),(select events from append_no_send),'append creates no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from append_no_send),'append sends no notification');
select ok(not has_function_privilege('authenticated','dashboard_private.validate_timetable_operating_reference_v1()','execute'),'validator remains private');
select ok(not has_table_privilege('authenticated','dashboard_private.timetable_operating_write_baselines','UPDATE'),'authenticated callers cannot forge the baseline');
select * from finish();
rollback;
