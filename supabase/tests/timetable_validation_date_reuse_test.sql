begin;
select no_plan();

-- Synthetic references isolate the final validator's computational cost and
-- semantics. These transaction-local probe replacements roll back afterwards.
-- Pin the final per-date validator without replacing its workset logic.
select is(encode(extensions.digest((select prosrc from pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure),'sha256'),'hex'),
 '5f0c7dbfa493acd25fcad3677ce9031ee5898e65edab65e6795b8dbbd888248d',
 'date coverage assertions execute the exact final shared-workset validator');
select is(encode(extensions.digest((select prosrc from pg_proc where oid='dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])'::regprocedure),'sha256'),'hex'),
 '3d456b6b5af3469e8ed5e00dd0641e0a4afca12b5eb61e37d4833611195b6956',
 'date coverage probe delegates to the exact final workset evaluator');
create temp table validation_probe(next_reference jsonb,calls bigint default 0,dated_rows bigint default 0);
insert into validation_probe(next_reference) values('{}');
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language sql stable security definer set search_path='' as $$
select next_reference from pg_temp.validation_probe
$$;
-- The final validator passes a typed date bucket, not r.datedSessions. Count
-- the actual helper invocations and input rows while executing its real body.
alter function dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])
 rename to timetable_effective_workset_date_probe_original_v1;
create function dashboard_private.timetable_effective_workset_date_v1(r jsonb,d date,rows dashboard_private.timetable_validation_row_v1[])
returns setof dashboard_private.timetable_validation_effective_row_v1 language plpgsql volatile set search_path='' as $$begin
 update pg_temp.validation_probe set calls=calls+1,dated_rows=dated_rows+coalesce(cardinality(rows),0);
 return query select * from dashboard_private.timetable_effective_workset_date_probe_original_v1(r,d,rows);
end$$;
revoke all on function dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])
 from public,anon,authenticated,service_role;
create function pg_temp.reference(weekly jsonb,dated jsonb,blockers jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('asOfDate','2026-10-12','shadowSlots',weekly,'datedSessions',dated,
 'unresolvedOccupancies','[]'::jsonb,'datedUnresolvedOccupancies',blockers)
$$;
create function pg_temp.slot(ident text,dt text default null) returns jsonb language sql as $$
 select jsonb_build_object('id',ident,'classId','11111111-1111-4111-8111-111111111111',
 'sourceSlotId',null,'weekday',1,'state','active','startMinute',540,'endMinute',600,
 'teacherId','22222222-2222-4222-8222-222222222222','classroomId','33333333-3333-4333-8333-333333333333')
 ||case when dt is null then '{}'::jsonb else jsonb_build_object('date',dt) end
$$;
create function pg_temp.compare(before_ref jsonb,after_ref jsonb) returns jsonb language plpgsql as $$begin
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
 values(txid_current(),before_ref) on conflict(transaction_id) do update set reference=excluded.reference;
 update pg_temp.validation_probe set next_reference=after_ref,calls=0,dated_rows=0;
 return dashboard_private.validate_timetable_operating_reference_v1();
end$$;

-- A close removes a weekly slot but retains all dated history. The old validator
-- scans all 3,600 rows on each side for every one of the 1,200 dates.
create temp table probe_history as select jsonb_agg(pg_temp.slot('historical-'||n,(date '2000-01-01'+n/3)::text)
 ||jsonb_build_object('startMinute',540+(n%3)*60,'endMinute',600+(n%3)*60) order by n) dated
 from generate_series(0,3599) n;
select is(pg_temp.compare(pg_temp.reference(jsonb_build_array(pg_temp.slot('weekly')),dated),
 pg_temp.reference('[]',dated)),pg_temp.reference('[]',dated),'weekly removal retains all historical occupancy') from probe_history;
select is((select calls from validation_probe),2400::bigint,'both sides still validate every historical date');
select is((select dated_rows from validation_probe),7200::bigint,
 'each dated row enters the effective-date evaluator once per side, not once per date');

select throws_ok($q$select pg_temp.compare(pg_temp.reference('[]','[]'),pg_temp.reference('[]',
 jsonb_build_array(pg_temp.slot('a','2000-01-01'),pg_temp.slot('b','2000-01-01'))))$q$,
 '23P01','timetable_resource_conflict','historical teacher/room conflict still fails');
select throws_ok($q$select pg_temp.compare(pg_temp.reference('[]','[]'),pg_temp.reference('[]','[]',
 '[{"classId":"11111111-1111-4111-8111-111111111111","scope":"all","date":null,"reason":"incomplete_read"}]'))$q$,
 '23P01','timetable_resource_conflict','new unknown occupancy still fails');

-- Removing a skipped override may expose a weekly slot that collides with a
-- different class. Never replace the date comparison with a removal shortcut.
select throws_ok($q$select pg_temp.compare(
 pg_temp.reference(jsonb_build_array(pg_temp.slot('weekly')||jsonb_build_object('sourceSlotId','slot')),
 jsonb_build_array(pg_temp.slot('skip','2026-10-19')||jsonb_build_object('sourceSlotId','slot','state','skipped'),
 pg_temp.slot('other','2026-10-19')||jsonb_build_object('classId','44444444-4444-4444-8444-444444444444'))),
 pg_temp.reference(jsonb_build_array(pg_temp.slot('weekly')||jsonb_build_object('sourceSlotId','slot')),
 jsonb_build_array(pg_temp.slot('other','2026-10-19')||jsonb_build_object('classId','44444444-4444-4444-8444-444444444444'))))$q$,
 '23P01','timetable_resource_conflict','removing an override still checks newly exposed weekly defaults');
select throws_ok($q$select pg_temp.compare(pg_temp.reference('[]',jsonb_build_array(pg_temp.slot('first','2000-01-01')
 ||jsonb_build_object('sourceSlotId','same'))),pg_temp.reference('[]',jsonb_build_array(
 pg_temp.slot('first','2000-01-01')||jsonb_build_object('sourceSlotId','same'),
 pg_temp.slot('duplicate','2000-01-01')||jsonb_build_object('sourceSlotId','same'))))$q$,
 '23P01','timetable_resource_conflict','duplicate occupancy multiplicity still fails');
select lives_ok($q$select pg_temp.compare(pg_temp.reference('[]',jsonb_build_array(pg_temp.slot('first','2000-01-01'),
 pg_temp.slot('duplicate','2000-01-01'))),pg_temp.reference('[]',jsonb_build_array(pg_temp.slot('first','2000-01-01'))))$q$,
 'removing an existing collision remains allowed');
select is(pg_temp.compare(pg_temp.reference('[]','[]'),pg_temp.reference('[]','[]')),
 pg_temp.reference('[]','[]'),'unchanged occupancy remains a no-op');
select * from finish();
rollback;
