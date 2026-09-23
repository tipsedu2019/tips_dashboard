begin;
select no_plan();
create temp table guard_fixture(value jsonb);
create function pg_temp.fixture_reference() returns jsonb language sql stable as $$select value from guard_fixture$$;
create or replace function pg_temp.original_guard()
returns void language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return;end if;
 newref:=pg_temp.fixture_reference();
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where b->>'date' is null or ((b->>'date')::date >= (newref->>'asOfDate')::date and extract(dow from (b->>'date')::date)::int=(x->>'weekday')::int)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- All actual dates are checked, including sessions under closed/preparing classes.
 -- Comparing effective occupancy also detects a removed skipped override which
 -- newly exposes a weekly default at that date.
 for d in select distinct (value->>'date')::date from jsonb_array_elements((oldref->'datedSessions')||(newref->'datedSessions')) loop
 select coalesce(jsonb_agg(v),'[]') into oldday from dashboard_private.timetable_effective_date_v1(oldref,d) v;
 select coalesce(jsonb_agg(v),'[]') into newday from dashboard_private.timetable_effective_date_v1(newref,d) v;
 for x in select value from jsonb_array_elements(newday) loop
 if (select count(*) from jsonb_array_elements(oldday) b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) >= (select count(*) from jsonb_array_elements(newday) b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
end $f$;
do $$begin execute replace(replace(pg_get_functiondef('dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),'dashboard_private.assert_timetable_operational_conflicts_v1()','pg_temp.final_guard()'),'dashboard_private.read_timetable_operating_reference_v1()','pg_temp.fixture_reference()');end$$;
create function pg_temp.ref(weekly jsonb,dated jsonb,unknown_rows jsonb default '[]') returns jsonb language sql as $$select jsonb_build_object('asOfDate','2026-01-01','shadowSlots',weekly,'datedSessions',dated,'unresolvedOccupancies','[]'::jsonb,'datedUnresolvedOccupancies',unknown_rows)$$;
create function pg_temp.slot(id text,c text,t text,r text,d text default '2026-01-05',state text default 'active',source text default null) returns jsonb language sql as $$select jsonb_build_object('id',id,'classId',c,'sourceSlotId',source,'weekday',1,'date',d,'state',state,'startMinute',600,'endMinute',660,'teacherId',t,'classroomId',r)$$;
create function pg_temp.outcomes(before_ref jsonb,after_ref jsonb) returns jsonb language plpgsql as $$declare old_result text:='00000';new_result text:='00000';begin
 delete from guard_fixture;insert into guard_fixture values(after_ref);
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference) values(txid_current(),before_ref) on conflict(transaction_id) do update set reference=excluded.reference;
 begin perform pg_temp.original_guard();exception when others then old_result:=sqlstate||'/'||sqlerrm;end;
 begin perform pg_temp.final_guard();exception when others then new_result:=sqlstate||'/'||sqlerrm;end;
 return jsonb_build_array(old_result,new_result);end$$;
create function pg_temp.check_case(label text,b jsonb,a jsonb,code text) returns text language sql as $$select is(pg_temp.outcomes(b,a),jsonb_build_array(code,code),label)$$;
create temp table g as select pg_temp.slot('a','a','t','r') a,pg_temp.slot('b','b','t','r2') teacher,pg_temp.slot('c','c','t2','r') room,pg_temp.slot('sibling','a','t3','r3') sibling,pg_temp.slot('dup1','d','t4','r4','2026-01-05','active','source') d1,pg_temp.slot('dup2','d','t4','r4','2026-01-05','active','source') d2;
select pg_temp.check_case('unchanged existing conflict is repairable',pg_temp.ref('[]',jsonb_build_array(a,teacher)),pg_temp.ref('[]',jsonb_build_array(a,teacher)),'00000') from g;
select pg_temp.check_case('new dated teacher collision',pg_temp.ref('[]',jsonb_build_array(a)),pg_temp.ref('[]',jsonb_build_array(a,teacher)),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('new dated room collision',pg_temp.ref('[]',jsonb_build_array(a)),pg_temp.ref('[]',jsonb_build_array(a,room)),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('same class sibling collision',pg_temp.ref('[]',jsonb_build_array(a)),pg_temp.ref('[]',jsonb_build_array(a,sibling)),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('deleting conflicting row repairs history',pg_temp.ref('[]',jsonb_build_array(a,teacher)),pg_temp.ref('[]',jsonb_build_array(a)),'00000') from g;
select pg_temp.check_case('duplicate source key multiplicity increase',pg_temp.ref('[]',jsonb_build_array(d1)),pg_temp.ref('[]',jsonb_build_array(d1,d2)),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('duplicate source key multiplicity unchanged',pg_temp.ref('[]',jsonb_build_array(d1,d2)),pg_temp.ref('[]',jsonb_build_array(d1,d2)),'00000') from g;
select pg_temp.check_case('past actual collision still checked',pg_temp.ref('[]',jsonb_build_array(a||'{"date":"2025-01-06"}')),pg_temp.ref('[]',jsonb_build_array(a||'{"date":"2025-01-06"}',teacher||'{"date":"2025-01-06"}')),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('new unknown occupancy rejected',pg_temp.ref('[]','[]'),pg_temp.ref('[]','[]','[{"date":"2026-01-05","reason":"incomplete_read"}]'),'23P01/timetable_resource_conflict');
select pg_temp.check_case('existing unknown with no new occupancy allowed',pg_temp.ref('[]','[]','[{"date":"2026-01-05","reason":"incomplete_read"}]'),pg_temp.ref('[]','[]','[{"date":"2026-01-05","reason":"incomplete_read"}]'),'00000');
-- Skipped source override removal exposes a future weekly default; before asOfDate it does not.
select pg_temp.check_case('removed skipped override exposes conflicting future default',pg_temp.ref(jsonb_build_array((a-'date')||'{"sourceSlotId":"source"}'),jsonb_build_array(a||'{"sourceSlotId":"source","state":"skipped"}',teacher)),pg_temp.ref(jsonb_build_array((a-'date')||'{"sourceSlotId":"source"}'),jsonb_build_array(teacher)),'23P01/timetable_resource_conflict') from g;
select pg_temp.check_case('past skipped override removal cannot expose a default',pg_temp.ref(jsonb_build_array((a-'date')||'{"sourceSlotId":"source"}'),jsonb_build_array(a||'{"sourceSlotId":"source","state":"skipped","date":"2025-01-06"}',teacher||'{"date":"2025-01-06"}')),pg_temp.ref(jsonb_build_array((a-'date')||'{"sourceSlotId":"source"}'),jsonb_build_array(teacher||'{"date":"2025-01-06"}')),'00000') from g;
select * from finish();
rollback;
