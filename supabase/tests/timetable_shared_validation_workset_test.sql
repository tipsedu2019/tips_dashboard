begin;
set local statement_timeout='8s';
set local timezone='Asia/Seoul';
set local datestyle='ISO, MDY';
set local track_functions='all';
select no_plan();
-- Narrow semantic regression, not a benchmark. Real fixtures and their gateway /
-- fresh-deferred / role checks below use unmodified production functions.
-- Pin the 20261020134458 body; its nullable-room diagnostic change retains the
-- shared workset, collision checks, concurrency guards and comparison oracles.
select is(md5((select prosrc from pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure)),
 '170a6f87d5d590cc432377d33fc7d485','final validator body matches the optional-room shared-workset migration');

-- Exact operational fe872 validator, frozen before this native-day experiment. Both paths
-- call the REAL complete reader and REAL effective-date helper. No production
-- function is replaced, renamed or instrumented by this test.
create or replace function pg_temp.historical_equal_original_validator()
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
 old_dates jsonb; new_dates jsonb; old_date_reference jsonb; new_date_reference jsonb;
 diagnostic_mode text; diagnostic_message text; diagnostic_detail text;
 diagnostic_confirmed jsonb:='[]'; diagnostic_unresolved jsonb:='[]';
 diagnostic_confirmed_count int:=0; diagnostic_unresolved_count int:=0;
 diagnostic_missing text[]; diagnostic_row jsonb; diagnostic_class_name text;
 diagnostic_teacher_name text; diagnostic_classroom_name text;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return null;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then return newref;end if;
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select b-'label' from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
           except select ob-'label' from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob) then
 diagnostic_mode:='introduced_unknown';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then diagnostic_mode:='weekly';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- A dated-only change cannot alter effective occupancy on any other date.
 -- Compare BOTH sides with multiplicity: removals can expose weekly defaults.
 -- Weekly/as-of changes still require every actual date, including history and
 -- closed/preparing classes. Each selected date uses the COMPLETE reference.
 -- Index all dated rows once, retaining order and multiplicity within each date.
 -- The effective-date helper consumes only these three reference fields. Keep
 -- the complete newref for blocker checks, diagnostics and the returned receipt;
 -- passing a compact date reference avoids copying the full history per date.
 select coalesce(jsonb_object_agg(dt, sessions),'{}'::jsonb) into old_dates
 from (select (v->>'date')::date::text dt,jsonb_agg(v order by ord) sessions
       from jsonb_array_elements(oldref->'datedSessions') with ordinality entries(v,ord)
       where v->>'date' is not null group by 1) grouped;
 select coalesce(jsonb_object_agg(dt, sessions),'{}'::jsonb) into new_dates
 from (select (v->>'date')::date::text dt,jsonb_agg(v order by ord) sessions
       from jsonb_array_elements(newref->'datedSessions') with ordinality entries(v,ord)
       where v->>'date' is not null group by 1) grouped;
 old_date_reference:=jsonb_build_object('asOfDate',oldref->'asOfDate','shadowSlots',oldref->'shadowSlots');
 new_date_reference:=jsonb_build_object('asOfDate',newref->'asOfDate','shadowSlots',newref->'shadowSlots');
 for d in
 with old_sessions as materialized (select value from jsonb_array_elements(oldref->'datedSessions')),
      new_sessions as materialized (select value from jsonb_array_elements(newref->'datedSessions')),
      changed as (
        (select value from old_sessions except all select value from new_sessions)
        union all
        (select value from new_sessions except all select value from old_sessions)
      )
 select distinct (value->>'date')::date from (
   select value from changed
   where oldref->'shadowSlots'=newref->'shadowSlots' and oldref->'asOfDate'=newref->'asOfDate'
   union all
   select value from old_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
   union all
   select value from new_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
 ) affected loop
 select coalesce(jsonb_agg(v),'[]') into oldday from dashboard_private.timetable_effective_date_v1(old_date_reference||jsonb_build_object('datedSessions',coalesce(old_dates->d::text,'[]'::jsonb)),d) v;
 select coalesce(jsonb_agg(v),'[]') into newday from dashboard_private.timetable_effective_date_v1(new_date_reference||jsonb_build_object('datedSessions',coalesce(new_dates->d::text,'[]'::jsonb)),d) v;
 -- Multiplicity, not mere existence: newly exposed defaults and duplicate keys
 -- must still be checked. Compute each day's counts once against all its rows.
 for x in
 with old_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n
   from jsonb_array_elements(oldday) v group by 1
 ), new_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n,
          (jsonb_agg(v order by ord))->0 representative,min(ord) first_ordinal
   from jsonb_array_elements(newday) with ordinality entries(v,ord) group by 1
 )
 select representative from new_counts n left join old_counts o using(key)
 where n.n>coalesce(o.n,0) order by first_ordinal loop
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d) and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b) and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then diagnostic_mode:='dated';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
return newref;
exception when exclusion_violation then
 -- PostgREST forwards DETAIL through the existing writer RPC. The diagnostic is
 -- optional: formatter/authentication failures retain the conflict. Database
 -- cancellation still propagates normally and rolls the rejected write back.
 -- Require the actual API role, not a client-set JWT role or agent impersonation.
 get stacked diagnostics diagnostic_message=MESSAGE_TEXT;
 if diagnostic_message<>'timetable_resource_conflict'
 or current_setting('role',true) is distinct from 'authenticated' then raise;end if;
 begin
 perform dashboard_private.agent_require_admin_v1();
 -- Only the candidate rejected by the unchanged checks above is explained.
 -- Use the complete already-read final reference, never an old saved draft,
 -- a client-provided comparison, a scoped snapshot, or a second database read.
 if diagnostic_mode in('weekly','dated') then
 for y in select value from jsonb_array_elements(case when diagnostic_mode='weekly'
            then newref->'shadowSlots' else newday end)
          where (diagnostic_mode<>'weekly' or value->>'weekday'=x->>'weekday')
          and dashboard_private.timetable_intersects_v1(x,value)
          order by value->>'classId',value->>'id' loop
 -- NULL wildcard blockers never become confirmed resource overlaps. Both rows
 -- here must have the complete known occupancy contract before disclosing it.
 if x->>'teacherId' is null or x->>'classroomId' is null
 or y->>'teacherId' is null or y->>'classroomId' is null
 or x->>'startMinute' is null or x->>'endMinute' is null
 or y->>'startMinute' is null or y->>'endMinute' is null then continue;end if;
 diagnostic_confirmed_count:=diagnostic_confirmed_count+1;
 if diagnostic_confirmed_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_teacher_name:=null;diagnostic_classroom_name:=null;
 if x->>'teacherId'=y->>'teacherId' then
 select name into diagnostic_teacher_name from public.teacher_catalogs where id=(y->>'teacherId')::uuid;end if;
 if x->>'classroomId'=y->>'classroomId' then
 select name into diagnostic_classroom_name from public.classroom_catalogs where id=(y->>'classroomId')::uuid;end if;
 diagnostic_row:=jsonb_strip_nulls(jsonb_build_object('className',diagnostic_class_name,
 'date',case when diagnostic_mode='dated' then to_jsonb(d) end,
 'weekday',case when diagnostic_mode='weekly' then y->'weekday' end,
 'startMinute',(y->>'startMinute')::int,'endMinute',(y->>'endMinute')::int,
 'overlapStartMinute',greatest((x->>'startMinute')::int,(y->>'startMinute')::int),
 'overlapEndMinute',least((x->>'endMinute')::int,(y->>'endMinute')::int),
 'teacherName',diagnostic_teacher_name,'classroomName',diagnostic_classroom_name,
 'sameClass',case when x->>'classId'=y->>'classId' then true end));
 diagnostic_confirmed:=diagnostic_confirmed||jsonb_build_array(diagnostic_row);
 end loop;
 end if;
 for y in
 select b from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
 where case when diagnostic_mode='introduced_unknown' then
 not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')
 when diagnostic_mode='weekly' then
 (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date)
 and dashboard_private.timetable_blocker_intersects_v2(x,b)
 when diagnostic_mode='dated' then
 (b->>'date' is null or (b->>'date')::date=d)
 and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b)
 and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)
 else false end
 order by b->>'classId',b->>'date',b->>'occupancyFingerprint' loop
 diagnostic_unresolved_count:=diagnostic_unresolved_count+1;
 if diagnostic_unresolved_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_missing:='{}';
 if y->>'date' is null and y->>'weekday' is null then diagnostic_missing:=array_append(diagnostic_missing,'date');end if;
 if y->>'startMinute' is null or y->>'endMinute' is null then diagnostic_missing:=array_append(diagnostic_missing,'time');end if;
 if y->>'teacherId' is null then diagnostic_missing:=array_append(diagnostic_missing,'teacher');end if;
 if y->>'classroomId' is null then diagnostic_missing:=array_append(diagnostic_missing,'classroom');end if;
 if cardinality(diagnostic_missing)=0 then diagnostic_missing:=array['schedule'];end if;
 diagnostic_unresolved:=diagnostic_unresolved||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
 'className',diagnostic_class_name,'date',y->'date','weekday',y->'weekday',
 'missingFields',to_jsonb(diagnostic_missing))));
 end loop;
 diagnostic_detail:=jsonb_build_object('version',1,'confirmed',diagnostic_confirmed,'unresolved',diagnostic_unresolved,
 'confirmedCount',diagnostic_confirmed_count,'unresolvedCount',diagnostic_unresolved_count,
 'truncated',diagnostic_confirmed_count>20 or diagnostic_unresolved_count>20)::text;
 exception when others then diagnostic_detail:=null;
 end;
 if diagnostic_detail is null then raise;end if;
 raise exception using errcode='23P01',message='timetable_resource_conflict',detail=diagnostic_detail;
end $f$;

select is(md5((select prosrc from pg_proc where oid='pg_temp.historical_equal_original_validator()'::regprocedure)),
 '23930d704f99b99ea763a04e51f871ef','oracle is exact operational fe872 validator body');
create function pg_temp.hid(n int) returns uuid language sql immutable as
$$select ('ae130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.hday(delta int) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date+delta$$;
create function pg_temp.effective_calls() returns bigint language sql volatile as
$$select coalesce((select sum(calls) from pg_stat_xact_user_functions
 where funcid in('dashboard_private.timetable_effective_date_v1(jsonb,date)'::regprocedure,'dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])'::regprocedure)),0)::bigint$$;
create temp table production_functions as select p.oid,md5(p.prosrc) body,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','dashboard_private');
create temp table no_send_before as select (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.student_class_enrollment_history) history;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.hid(901),
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','historical-equal-guard@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.hid(901),'admin','Historical equal administrator')
 on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
 on conflict(singleton) do update set version=1;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.hid(101),'Historical equal teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.hid(201),'Historical equal room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids)
 values(pg_temp.hid(301),'Historical equal target','영어','수강','normalized','월 06:00-07:00',
 'Historical equal teacher','Historical equal room','{}','[]','[]');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name)
 values(pg_temp.hid(401),pg_temp.hid(301),1,'06:00','07:00',pg_temp.hid(101),'Historical equal teacher',pg_temp.hid(201),'Historical equal room');
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 select pg_temp.hid(600+n),pg_temp.hid(301),'historical-'||n,pg_temp.hday(-n),'active','09:00','10:00',pg_temp.hid(101),pg_temp.hid(201),'manual'
 from generate_series(1,3) n;
select set_config('app.class_schedule_mutation','',true);
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub',pg_temp.hid(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hid(901),'role','authenticated')::text,true);
create temp table seed_class as select to_jsonb(c) value from public.classes c where id=pg_temp.hid(301);
select is((select count(*) from dashboard_private.timetable_operating_write_baselines),0::bigint,'fixture arrangement finalized before measured write');
select is((select count(*) from public.ops_registration_enrollments where class_id=pg_temp.hid(301)),0::bigint,'canonical component class has zero total claims');

savepoint real_historical_close;
create temp table original_reference as select dashboard_private.read_timetable_operating_reference_v1() value;
select set_config('app.class_close_mutation','v1',true);
with changed as(update public.classes set status='종강',closed_at=now(),closed_by=pg_temp.hid(901)
 where id=pg_temp.hid(301) and closed_at is null and closed_by is null returning id)
select is((select count(*) from changed),1::bigint,'three-field close-shaped write changes exactly one unstamped class');
select set_config('app.class_close_mutation','',true);
create temp table prepared_reference as select dashboard_private.read_timetable_operating_reference_v1() value;
select ok((select value->'shadowSlots' from original_reference)<>(select value->'shadowSlots' from prepared_reference),
 'weekly removal defeats the unchanged-occupancy early return');
select is((select value->'datedSessions' from original_reference),(select value->'datedSessions' from prepared_reference),
 'real producer retains all three historical buckets exactly');
select is((select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),
 (select value from original_reference),'before-statement trigger captured original complete baseline');
create temp table measured_before as select pg_temp.effective_calls() calls;
create temp table measured_candidate as select dashboard_private.validate_timetable_operating_reference_v1() value;
create temp table measured_after as select pg_temp.effective_calls() calls;
-- Exact unchanged past inputs need no effective comparison; the frozen oracle
-- still evaluates them and must return the exact same complete reference.
select is((select calls from measured_after)-(select calls from measured_before),0::bigint,
 'canonical unchanged historical dates avoid both redundant helper calls');
create temp table measured_oracle as select pg_temp.historical_equal_original_validator() value;
create temp table oracle_after as select pg_temp.effective_calls() calls;
select is((select calls from oracle_after)-(select calls from measured_after),6::bigint,
 'frozen validator really expands both sides of three historical dates');
select is((select value from measured_candidate),(select value from measured_oracle),'full returned reference equals frozen validator');
select is((select value::text from measured_candidate),(select value::text from measured_oracle),'complete JSON text/order/fingerprints equal frozen validator');
select is((select value from measured_candidate),(select value from prepared_reference),'real validator returns complete fresh post-write reference');
select is((select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),
 (select value from original_reference),'validation and oracle never advance original baseline');
set constraints all immediate;
set constraints all deferred;
select is((select count(*) from dashboard_private.timetable_operating_write_baselines),0::bigint,'fresh deferred validator cleans original baseline');
rollback to real_historical_close;
release real_historical_close;
select is((select to_jsonb(c) from public.classes c where id=pg_temp.hid(301)),(select value from seed_class),'savepoint rollback restores complete class row');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.hid(901)),0::bigint,'component-only write invents no receipts');

-- Expanded cases preserve the initial RED/GREEN proof above. These temp helpers
-- observe the real functions; none replaces a production reader or validator.
create function pg_temp.validation_outcome(original boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; code text; msg text; detail text;
begin
 if original then r:=pg_temp.historical_equal_original_validator();
 else r:=dashboard_private.validate_timetable_operating_reference_v1();end if;
 return jsonb_build_object('sqlstate','00000','message',null,'detail',null,'value',r);
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,msg=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('sqlstate',code,'message',msg,'detail',nullif(detail,''));
end$$;
create function pg_temp.validation_pair() returns jsonb language plpgsql security definer set search_path='' as $$
declare before_calls bigint; candidate_calls bigint; after_calls bigint; c jsonb; o jsonb;
begin
 before_calls:=pg_temp.effective_calls();c:=pg_temp.validation_outcome(false);
 candidate_calls:=pg_temp.effective_calls();o:=pg_temp.validation_outcome(true);after_calls:=pg_temp.effective_calls();
 return jsonb_build_object('candidate',c,'oracle',o,'candidateCalls',candidate_calls-before_calls,'oracleCalls',after_calls-candidate_calls);
end$$;
create function pg_temp.assert_validation_pair(p jsonb,label text,expected_code text,expected_calls bigint default null,omitted_calls bigint default 0)
returns setof text language plpgsql as $$begin
 return next is(p#>>'{candidate,sqlstate}',expected_code,label||': actual SQLSTATE');
 return next is(p->'candidate',p->'oracle',label||': complete result/error message/DETAIL equals frozen oracle');
 if expected_code='00000' then
  return next is((p#>'{candidate,value}')::text,(p#>'{oracle,value}')::text,label||': JSON text/order/fingerprints equal oracle');
 end if;
 if expected_calls is not null then
  return next is((p->>'candidateCalls')::bigint,(p->>'oracleCalls')::bigint-omitted_calls,label||': helper count excludes only proven-equal date inputs');
 end if;
end$$;
create function pg_temp.close_shape(cid uuid) returns void language plpgsql as $$
declare previous_context text:=coalesce(current_setting('app.class_close_mutation',true),'');n int;
begin
 perform set_config('app.class_close_mutation','v1',true);
 update public.classes set status='종강',closed_at=now(),closed_by=pg_temp.hid(901)
 where id=cid and closed_at is null and closed_by is null;
 get diagnostics n=ROW_COUNT;
 perform set_config('app.class_close_mutation',previous_context,true);
 if n<>1 then raise exception 'test_close_shape_rowcount' using errcode='23514';end if;
end$$;
create function pg_temp.owner_baseline_pair(old_reference jsonb) returns jsonb language plpgsql as $$begin
 -- Deliberate owner-forged BASELINE metadata, never a client capability or a
 -- production baseline advance. Every such block rolls back to its savepoint.
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
 values(txid_current(),old_reference) on conflict(transaction_id) do update set reference=excluded.reference;
 return pg_temp.validation_pair();
end$$;
create function pg_temp.try_close(key uuid) returns jsonb language plpgsql as $$
declare r jsonb;code text;msg text;detail text;
begin
 r:=public.update_class_operational_v1(pg_temp.hid(303),jsonb_build_object('status','종강'),key);
 return jsonb_build_object('sqlstate','00000','value',r);
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,msg=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('sqlstate',code,'message',msg,'detail',nullif(detail,''));
end$$;
create function pg_temp.guard_counts() returns jsonb language sql volatile as $$
 select jsonb_build_object(
 'reader',coalesce((select calls from pg_stat_xact_user_functions where funcid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),0),
 'validator',coalesce((select calls from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure),0),
 'assert',coalesce((select calls from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),0))
$$;

-- Today and tomorrow join three historical dates. Only changed Monday weekly
-- inputs on or after the cutoff require comparison; nonfinite dates always do.
-- Derive the exact omitted count independently from these five known dates.
create temp table omitted_finite as select 2*count(*) n from generate_series(-3,1) delta
 where delta<0 or extract(dow from pg_temp.hday(delta))<>1;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 select pg_temp.hid(604+n),pg_temp.hid(301),'boundary-'||n,pg_temp.hday(n),'active','09:00','10:00',pg_temp.hid(101),pg_temp.hid(201),'manual'
 from generate_series(0,1) n;
select set_config('app.class_schedule_mutation','',true);
set constraints all immediate;set constraints all deferred;
savepoint mixed_close;
create temp table mixed_original as select dashboard_private.read_timetable_operating_reference_v1() value;
select pg_temp.close_shape(pg_temp.hid(301));
create temp table mixed_pair as select pg_temp.validation_pair() p;
select line from mixed_pair cross join lateral pg_temp.assert_validation_pair(p,'historical/current/future mixed close','00000',4,(select n from omitted_finite)) as check_line(line);
select is((select (p->>'oracleCalls')::bigint from mixed_pair),10::bigint,'frozen oracle expands both sides of all five mixed dates');
select is((select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),
 (select value from mixed_original),'mixed boundary comparison retains original transaction baseline');
rollback to mixed_close;release mixed_close;

-- Infinity is accepted by the typed normalized date column; both infinities
-- must retain the original effective evaluator. No constraint is disabled.
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 values(pg_temp.hid(607),pg_temp.hid(301),'negative-infinity','-infinity','active','09:00','10:00',pg_temp.hid(101),pg_temp.hid(201),'manual'),
 (pg_temp.hid(608),pg_temp.hid(301),'positive-infinity','infinity','active','09:00','10:00',pg_temp.hid(101),pg_temp.hid(201),'manual');
select set_config('app.class_schedule_mutation','',true);
set constraints all immediate;set constraints all deferred;
savepoint infinite_close;
select pg_temp.close_shape(pg_temp.hid(301));
create temp table infinite_pair as select pg_temp.validation_pair() p;
select line from infinite_pair cross join lateral pg_temp.assert_validation_pair(p,'real normalized nonfinite dates','00000',8,(select n from omitted_finite)) as check_line(line);
select is((select (p->>'oracleCalls')::bigint from infinite_pair),14::bigint,'oracle expands seven dates including both infinities');
rollback to infinite_close;release infinite_close;
savepoint german_dates;
set local datestyle='German, DMY';
select pg_temp.close_shape(pg_temp.hid(301));
create temp table german_pair as select pg_temp.validation_pair() p;
select line from german_pair cross join lateral pg_temp.assert_validation_pair(p,'German DMY normalized full reference','00000',8,(select n from omitted_finite)) as check_line(line);
rollback to german_dates;release german_dates;
set local datestyle='ISO, MDY';

-- Separate semantic instrumentation verifies actual RPC boundaries, never a
-- timed benchmark. Both assertions and fresh deferred validation remain real.
savepoint real_public_close;
create temp table rpc_counts_before as select pg_temp.guard_counts() n;
set local role authenticated;
create temp table rpc_close as select public.update_class_operational_v1(pg_temp.hid(301),'{"status":"종강"}',pg_temp.hid(701)) value;
reset role;
create temp table rpc_counts_return as select pg_temp.guard_counts() n;
-- e43 gateway proof reuse removes only the redundant outer validation. The
-- unchanged inner assertion reads afresh; the outer assertion consumes its
-- private one-use proof. The gateway suite separately rejects invalid proof
-- contexts and checks that real residual edits take the full validation path.
select is(jsonb_build_object('reads',(select (n->>'reader')::bigint from rpc_counts_return)-(select (n->>'reader')::bigint from rpc_counts_before),
 'unconsumedProofs',(select count(*) from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current())),
 '{"reads":2,"unconsumedProofs":0}'::jsonb,'actual RPC reads baseline and inner validation and consumes the outer proof');
select is(jsonb_build_object('validations',(select (n->>'validator')::bigint from rpc_counts_return)-(select (n->>'validator')::bigint from rpc_counts_before),
 'pendingBaselines',(select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current() and ready)),
 '{"validations":1,"pendingBaselines":1}'::jsonb,'actual RPC validates inner state and retains its pending fresh finalizer');
select is((select (n->>'assert')::bigint from rpc_counts_return)-(select (n->>'assert')::bigint from rpc_counts_before),2::bigint,'actual RPC retains both real assertion invocations');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.hid(901) and request_key=pg_temp.hid(701)),2::bigint,'real public close writes both operation receipts');
set constraints all immediate;set constraints all deferred;
create temp table rpc_counts_final as select pg_temp.guard_counts() n;
select is(jsonb_build_object('total',(select (n->>'reader')::bigint from rpc_counts_final)-(select (n->>'reader')::bigint from rpc_counts_before),
 'deferredIncrement',(select (n->>'reader')::bigint from rpc_counts_final)-(select (n->>'reader')::bigint from rpc_counts_return)),
 '{"total":3,"deferredIncrement":1}'::jsonb,'fresh deferred validation adds exactly one complete reader call');
select is(jsonb_build_object('total',(select (n->>'validator')::bigint from rpc_counts_final)-(select (n->>'validator')::bigint from rpc_counts_before),
 'deferredIncrement',(select (n->>'validator')::bigint from rpc_counts_final)-(select (n->>'validator')::bigint from rpc_counts_return)),
 '{"total":2,"deferredIncrement":1}'::jsonb,'fresh deferred validation adds exactly one complete validator call');
select is((select (n->>'assert')::bigint from rpc_counts_final)-(select (n->>'assert')::bigint from rpc_counts_before),2::bigint,'deferred finalizer remains direct validator boundary');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines),0::bigint,'real close finalizer removes original baseline');
set local role authenticated;
create temp table rpc_replay as select public.update_class_operational_v1(pg_temp.hid(301),'{"status":"종강"}',pg_temp.hid(701)) value;
reset role;
select is((select value from rpc_replay),(select value from rpc_close),'outer idempotent replay returns exact stored response');
select is(pg_temp.guard_counts(),(select n from rpc_counts_final),'outer replay adds no timetable assertion/read/validation');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.hid(901) and request_key=pg_temp.hid(701)),2::bigint,'idempotent replay creates no extra receipts');
rollback to real_public_close;release real_public_close;
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.hid(901)),0::bigint,'rollback removes real inner and outer receipts');
select is((select status from public.classes where id=pg_temp.hid(301)),'수강','rollback restores original open class');

-- Legacy future exposure is deliberately arranged as grandfathered conflicting
-- occupancy. Only fixture arrangement advances its baseline; tested writes do
-- not. Existing physical overlap must not excuse a new inherited identity.
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.hid(202),'Future peer room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids)
 values(pg_temp.hid(303),'Future inherited close target','영어','수강','legacy',
 (array['일','월','화','수','목','금','토'])[extract(dow from pg_temp.hday(7))::int+1]||' 09:00-10:00',
 'Historical equal teacher','Historical equal room',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object(
 'id','future-inherited','date',pg_temp.hday(7),'scheduleState','active','isForced',false))),'[]','[]'),
 (pg_temp.hid(304),'Future retained peer','영어','개강 준비','legacy','목 14:00-15:00',
 'Historical equal teacher','Future peer room',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object(
 'id','future-peer','date',pg_temp.hday(7),'scheduleState','active','isForced',false,'startTime','09:30','endTime','10:30',
 'teacherCatalogId',pg_temp.hid(101),'classroomCatalogId',pg_temp.hid(202)))),'[]','[]');
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
savepoint inherited_shape;
create temp table inherited_before as select dashboard_private.read_timetable_operating_reference_v1() value;
select pg_temp.close_shape(pg_temp.hid(303));
create temp table inherited_after as select dashboard_private.read_timetable_operating_reference_v1() value;
select is((select value->'datedSessions' from inherited_before),(select value->'datedSessions' from inherited_after),'future inherited bucket is unchanged by bare close');
select ok(exists(select 1 from dashboard_private.timetable_effective_date_v1((select value from inherited_after),pg_temp.hday(7)) s
 where s->>'classId'=pg_temp.hid(303)::text and not exists(select 1 from dashboard_private.timetable_effective_date_v1((select value from inherited_before),pg_temp.hday(7)) old
 where dashboard_private.timetable_occupancy_key_v1(old)=dashboard_private.timetable_occupancy_key_v1(s))),
 'pure close introduces the retained future inherited exact key');
set local role authenticated;
create temp table inherited_outcome as select pg_temp.validation_pair() p;
reset role;
select line from inherited_outcome cross join lateral pg_temp.assert_validation_pair(p,'future inherited new-key collision','23P01') as check_line(line);
select is((select p#>>'{candidate,message}' from inherited_outcome),'timetable_resource_conflict','future collision retains exact conflict message');
select ok((select p#>>'{candidate,detail}' from inherited_outcome) is not null,'actual authenticated administrator retains conflict DETAIL');
rollback to inherited_shape;release inherited_shape;
savepoint inherited_rpc;
set local role authenticated;
create temp table inherited_rpc_outcome as select pg_temp.try_close(pg_temp.hid(702)) p;
reset role;
select is((select p->>'sqlstate' from inherited_rpc_outcome),'23P01','real gateway rejects future inherited peer collision');
select is((select p->>'message' from inherited_rpc_outcome),'timetable_resource_conflict','real gateway retains exact conflict message');
select ok((select p->>'detail' from inherited_rpc_outcome) is not null,'real gateway retains authenticated conflict DETAIL');
select is((select status from public.classes where id=pg_temp.hid(303)),'수강','rejected public close rolls back status');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=pg_temp.hid(702)),0::bigint,'rejected public close rolls back both receipts');
rollback to inherited_rpc;release inherited_rpc;


-- Changing order in an otherwise equal historical raw bucket retains ordinal semantics. A simultaneous real weekly removal makes that bucket selected.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids)
 values(pg_temp.hid(305),'Historical order target','영어','개강 준비','legacy','월 16:00-17:00',
 'Historical equal teacher','Historical equal room',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','order-a','date',pg_temp.hday(-8),'scheduleState','active','startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.hid(101),'classroomCatalogId',pg_temp.hid(201)),
 jsonb_build_object('id','order-b','date',pg_temp.hday(-8),'scheduleState','active','startTime','10:00','endTime','11:00','teacherCatalogId',pg_temp.hid(101),'classroomCatalogId',pg_temp.hid(201)))),'[]','[]');
set constraints all immediate;set constraints all deferred;
savepoint changed_historical_order;
create temp table order_original as select dashboard_private.read_timetable_operating_reference_v1() value;
select pg_temp.close_shape(pg_temp.hid(301));
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',
 jsonb_build_array(schedule_plan#>'{sessions,1}',schedule_plan#>'{sessions,0}')) where id=pg_temp.hid(305);
create temp table order_pair as select pg_temp.validation_pair() p;
select line from order_pair cross join lateral pg_temp.assert_validation_pair(p,'changed real historical order','00000',12) as check_line(line);
select is((select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),
 (select value from order_original),'multi-write order change keeps immutable original baseline');
rollback to changed_historical_order;release changed_historical_order;

-- Real legacy inheritance retains multiplicity from identical weekly tokens.
-- A preparing class has no global weekly rows, so increasing its repeated token
-- count changes one historical dated bucket from two to three identical keys.
create temp table duplicate_schedule as select
 (array['일','월','화','수','목','금','토'])[extract(dow from pg_temp.hday(-10))::int+1]||' 09:00-10:00' piece;
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids)
 values(pg_temp.hid(307),'Historical duplicate inherited target','영어','개강 준비','legacy',
 (select piece||';'||piece from duplicate_schedule),'Historical equal teacher','Historical equal room',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','historical-duplicate-inherited','date',pg_temp.hday(-10),'scheduleState','active','isForced',false))),'[]','[]'),
 (pg_temp.hid(308),'Historical duplicate retained peer','영어','개강 준비','legacy','수 18:00-19:00',
 'Historical equal teacher','Future peer room',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object(
 'id','historical-duplicate-peer','date',pg_temp.hday(-10),'scheduleState','active','startTime','09:30','endTime','10:30',
 'teacherCatalogId',pg_temp.hid(101),'classroomCatalogId',pg_temp.hid(202)))),'[]','[]');
-- Grandfathered conflicting historical fixture arrangement only.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
savepoint increased_historical_multiplicity;
create temp table duplicate_original as select dashboard_private.read_timetable_operating_reference_v1() value;
update public.classes set schedule=(select piece||';'||piece||';'||piece from duplicate_schedule) where id=pg_temp.hid(307);
set local role authenticated;
create temp table duplicate_pair as select pg_temp.validation_pair() p;
reset role;
select line from duplicate_pair cross join lateral pg_temp.assert_validation_pair(p,'real historical increased inherited key multiplicity','23P01',2) as check_line(line);
select is((select count(*) from jsonb_array_elements((select value->'datedSessions' from duplicate_original)) x where x->>'classId'=pg_temp.hid(307)::text),2::bigint,'old real inherited bucket has two copies');
select is((select count(*) from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedSessions') x where x->>'classId'=pg_temp.hid(307)::text),3::bigint,'new real inherited bucket has three copies');
select is((select count(distinct dashboard_private.timetable_occupancy_key_v1(x)) from jsonb_array_elements((select value->'datedSessions' from duplicate_original)) x where x->>'classId'=pg_temp.hid(307)::text),1::bigint,'two old inherited copies share exactly one canonical key');
select is((select count(distinct dashboard_private.timetable_occupancy_key_v1(x)) from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedSessions') x where x->>'classId'=pg_temp.hid(307)::text),1::bigint,'three new inherited copies still share exactly one canonical key');
select is((select p#>>'{candidate,message}' from duplicate_pair),'timetable_resource_conflict','increased inherited multiplicity retains exact conflict message');
rollback to increased_historical_multiplicity;release increased_historical_multiplicity;

insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.hid(102),'Different same-class teacher',array['영어']);
set constraints all immediate;set constraints all deferred;
savepoint same_class_different_resources;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 values(pg_temp.hid(609),pg_temp.hid(301),'same-class-other-resources',pg_temp.hday(-1),'active','09:30','10:30',pg_temp.hid(102),pg_temp.hid(202),'manual');
select set_config('app.class_schedule_mutation','',true);
set local role authenticated;
create temp table same_class_pair as select pg_temp.validation_pair() p;
reset role;
select line from same_class_pair cross join lateral pg_temp.assert_validation_pair(p,'same-class peer with different resources','23P01',2) as check_line(line);
select is((select ((p#>>'{candidate,detail}')::jsonb)#>>'{confirmed,0,sameClass}' from same_class_pair),'true','same-class diagnostic survives different teacher and room');
rollback to same_class_different_resources;release same_class_different_resources;

-- Existing past wildcard uncertainty is owner-arranged fixture history. Tested
-- known writes use ordinary captured baselines and retain the whole blocker set.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids)
 values(pg_temp.hid(306),'Historical wildcard source','영어','개강 준비','legacy','수 20:00-21:00',
 'Historical equal teacher','Historical equal room',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object(
 'id','past-wildcard','date',pg_temp.hday(-6),'scheduleState','active','startTime',null,'endTime',null,'teacherCatalogId',null,'classroomCatalogId',null))),'[]','[]');
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
savepoint existing_past_wildcard;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 values(pg_temp.hid(609),pg_temp.hid(301),'past-wildcard-candidate',pg_temp.hday(-6),'active','09:00','10:00',pg_temp.hid(101),pg_temp.hid(201),'manual');
select set_config('app.class_schedule_mutation','',true);
set local role authenticated;
create temp table wildcard_pair as select pg_temp.validation_pair() p;
reset role;
select line from wildcard_pair cross join lateral pg_temp.assert_validation_pair(p,'existing historical wildcard blocker','23P01',2) as check_line(line);
select is((select ((p#>>'{candidate,detail}')::jsonb)#>>'{unresolvedCount}' from wildcard_pair),'1','whole current historical blocker remains visible');
rollback to existing_past_wildcard;release existing_past_wildcard;
savepoint introduced_unknown_date;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',(schedule_plan->'sessions')||jsonb_build_array(jsonb_build_object(
 'id','introduced-null-date','scheduleState','active','startTime',null,'endTime',null,'teacherCatalogId',null,'classroomCatalogId',null))) where id=pg_temp.hid(306);
set local role authenticated;
create temp table introduced_pair as select pg_temp.validation_pair() p;
reset role;
select line from introduced_pair cross join lateral pg_temp.assert_validation_pair(p,'introduced NULL-date wildcard','23P01',0) as check_line(line);
rollback to introduced_unknown_date;release introduced_unknown_date;

create function pg_temp.try_flush() returns jsonb language plpgsql as $$
declare code text;msg text;detail text;
begin
 set constraints all immediate;set constraints all deferred;return jsonb_build_object('sqlstate','00000');
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,msg=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('sqlstate',code,'message',msg,'detail',nullif(detail,''));
end$$;
savepoint fresh_deferred_conflict;
create temp table deferred_original as select dashboard_private.read_timetable_operating_reference_v1() value;
update public.classes set room=room where id=pg_temp.hid(301);
select lives_ok('select dashboard_private.assert_timetable_operational_conflicts_v1()','early assertion accepts captured unchanged occupancy');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 values(pg_temp.hid(609),pg_temp.hid(301),'late-conflicting-write',pg_temp.hday(-1),'active','09:30','10:30',pg_temp.hid(102),pg_temp.hid(202),'manual');
select set_config('app.class_schedule_mutation','',true);
create temp table deferred_error as select pg_temp.try_flush() p;
select is((select p->>'sqlstate' from deferred_error),'23P01','fresh deferred validator rejects later conflicting historical write');
select is((select p->>'message' from deferred_error),'timetable_resource_conflict','fresh deferred conflict retains exact message');
select is((select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),
 (select value from deferred_original),'successful early assertion never advances baseline for later write');
rollback to fresh_deferred_conflict;release fresh_deferred_conflict;
select is((select count(*) from public.class_lesson_sessions where id=pg_temp.hid(609)),0::bigint,'rollback removes rejected late session');

-- Actual role denial, RLS and private execution controls remain separate from
-- owner-only observer functions. No authenticated call gets the owner GUCs.
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.hid(902),
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','historical-equal-teacher@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.hid(902),'teacher','Historical equal denied teacher')
 on conflict(id) do update set role=excluded.role,name=excluded.name;
-- The real signup trigger can write teacher_catalogs; finalize this setup before
-- testing role denial/no-baseline behavior. All operating guards stay enabled.
set constraints all immediate;set constraints all deferred;
select set_config('request.jwt.claim.sub',pg_temp.hid(902)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hid(902),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.hid(301),'{"status":"종강"}',pg_temp.hid(703))$q$,
 '42501','class_schedule_forbidden','actual teacher cannot close through gateway');
select throws_ok('select dashboard_private.validate_timetable_operating_reference_v1()','42501',null,'authenticated role cannot call private validator');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.hid(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hid(901),'role','authenticated')::text,true);
select ok((select relrowsecurity from pg_class where oid='public.classes'::regclass),'class RLS remains enabled');
select is(dashboard_private.validate_timetable_operating_reference_v1(),null::jsonb,'no-baseline validator remains NULL');
savepoint unchanged_reference;
update public.classes set room=room where id=pg_temp.hid(301);
create temp table unchanged_pair as select pg_temp.validation_pair() p;
select line from unchanged_pair cross join lateral pg_temp.assert_validation_pair(p,'unchanged four occupancy arrays','00000',0) as check_line(line);
rollback to unchanged_reference;release unchanged_reference;

select ok(not has_function_privilege('anon','dashboard_private.validate_timetable_operating_reference_v1()','EXECUTE'),'validator remains private from anon');
select ok(not has_function_privilege('authenticated','dashboard_private.validate_timetable_operating_reference_v1()','EXECUTE'),'validator remains private from authenticated');
select ok(not has_function_privilege('service_role','dashboard_private.validate_timetable_operating_reference_v1()','EXECUTE'),'validator remains private from service role');
select ok(not has_table_privilege('authenticated','dashboard_private.timetable_operating_write_baselines','UPDATE'),'clients cannot forge or advance baseline');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines),0::bigint,'all test savepoints leave no baseline');

select is((select count(*) from dashboard_private.notification_events),(select events from no_send_before),'no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send_before),'no notification deliveries');
select is((select count(*) from public.student_class_enrollment_history),(select history from no_send_before),'zero-roster case writes no enrollment history');
select is((select count(*) from production_functions old join pg_proc p using(oid)
 where (old.body,old.proowner,old.proacl,old.proconfig,old.provolatile,old.prosecdef)
 is distinct from (md5(p.prosrc),p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef)),0::bigint,
 'test leaves every production function body and security contract intact');
-- SYNTHETIC CONTRACT PROBES ONLY. The live public/private functions above remain
-- unmodified. These temp copies replace baseline/reader inputs and instrument
-- effective/intersects calls; they are not evidence of real RPC call counts.
create temp table native_inputs(before_reference jsonb,after_reference jsonb,probe_mode text);
create temp table native_trace(ord bigserial,event jsonb);
create temp table workset_raw_reads(side text);
create function pg_temp.workset_raw(side text,doc jsonb) returns table(value jsonb) language plpgsql volatile as $$begin
 insert into pg_temp.workset_raw_reads values(side);
 return query select j.value from jsonb_array_elements(doc) j;
end$$;

create temp sequence native_helper_steps;
create function pg_temp.native_reader() returns jsonb language sql stable as
$$select after_reference from pg_temp.native_inputs$$;
create function pg_temp.native_effective(r jsonb,d date) returns setof jsonb language plpgsql volatile as $$
declare v jsonb;n bigint;m text;
begin
 n:=nextval('pg_temp.native_helper_steps');
 select probe_mode into m from pg_temp.native_inputs;
 insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','effective','call',n,'date',d,'asOf',r->'asOfDate'));
 if m='date-order-probe' then
  raise exception using errcode='22007',message='date-order-probe:'||coalesce(d::text,'NULL')||':'||n::text;
 end if;
 if m='sql-and-json-null' then
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',true));
  return next null::jsonb;
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',false,'row','null'::jsonb));
  return next 'null'::jsonb;
 end if;
 for v in select value from dashboard_private.timetable_effective_date_v1(r,d) value loop
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',v is null,'row',v));
  return next v;
 end loop;
end$$;
create function pg_temp.native_workset_effective(r jsonb,d date,rows dashboard_private.timetable_validation_row_v1[])
returns setof dashboard_private.timetable_validation_effective_row_v1 language plpgsql volatile as $$
declare e dashboard_private.timetable_validation_effective_row_v1;n bigint;m text;
begin
 n:=nextval('pg_temp.native_helper_steps');
 select probe_mode into m from pg_temp.native_inputs;
 insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','effective','call',n,'date',d,'asOf',r->'asOfDate'));
 if m='date-order-probe' then
  raise exception using errcode='22007',message='date-order-probe:'||coalesce(d::text,'NULL')||':'||n::text;
 end if;
 if m='sql-and-json-null' then
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',true));
  return next row(null,dashboard_private.timetable_occupancy_key_v1('null'))::dashboard_private.timetable_validation_effective_row_v1;
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',false,'row','null'::jsonb));
  return next row('null'::jsonb,dashboard_private.timetable_occupancy_key_v1('null'))::dashboard_private.timetable_validation_effective_row_v1;
 end if;
 for e in select * from dashboard_private.timetable_effective_workset_date_v1(r,d,rows) loop
  insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','returned','sqlNull',e.v is null,'row',e.v));
  return next e;
 end loop;
end$$;
create function pg_temp.native_intersects(a jsonb,b jsonb) returns boolean language plpgsql volatile as $$begin
 insert into pg_temp.native_trace(event) values(jsonb_build_object('kind','witness','candidate',a,'peer',b));
 return dashboard_private.timetable_intersects_v1(a,b);
end$$;
create temp table native_copy_provenance(label text,source_md5 text,copy_md5 text);
do $copy$
declare is_original boolean;b text;source_hash text;fn text;
begin
 foreach is_original in array array[true,false] loop
  if is_original then
   select prosrc into b from pg_proc where oid='pg_temp.historical_equal_original_validator()'::regprocedure;
   fn:='native_original';
  else
   select prosrc into b from pg_proc where oid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure;
   fn:='native_candidate';
  end if;
  source_hash:=md5(b);
  if position('select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();' in b)=0 then
   raise exception 'synthetic baseline substitution did not match';
  end if;
  b:=replace(b,'select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();',
    'select before_reference into oldref from pg_temp.native_inputs;');
  b:=replace(b,'dashboard_private.read_timetable_operating_reference_v1()','pg_temp.native_reader()');
  b:=replace(b,'dashboard_private.timetable_effective_date_v1(','pg_temp.native_effective(');
  b:=replace(b,'dashboard_private.timetable_effective_workset_date_v1(','pg_temp.native_workset_effective(');

  b:=replace(b,'dashboard_private.timetable_intersects_v1(','pg_temp.native_intersects(');
  execute format('create function pg_temp.%I() returns jsonb language plpgsql security definer set search_path='''' as %L',fn,b);
  insert into pg_temp.native_copy_provenance values(fn,source_hash,md5(b));
 end loop;
end$copy$;
select is((select source_md5 from native_copy_provenance where label='native_original'),'23930d704f99b99ea763a04e51f871ef','synthetic oracle copied exact fe body');
select is((select source_md5 from native_copy_provenance where label='native_candidate'),'170a6f87d5d590cc432377d33fc7d485','synthetic candidate copied exact fixed prototype');
create function pg_temp.native_outcome(original boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;c text;m text;det text;
begin
 if original then r:=pg_temp.native_original();else r:=pg_temp.native_candidate();end if;
 return jsonb_build_object('sqlstate','00000','message',null,'detail',null,'value',r);
exception when others then
 get stacked diagnostics c=RETURNED_SQLSTATE,m=MESSAGE_TEXT,det=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('sqlstate',c,'message',m,'detail',nullif(det,''));
end$$;
create function pg_temp.native_run(original boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;n bigint;t jsonb;
begin
 truncate pg_temp.native_trace,pg_temp.workset_raw_reads;
 perform setval('pg_temp.native_helper_steps',1,false);
 result:=pg_temp.native_outcome(original);
 select case when is_called then last_value else 0 end into n from pg_temp.native_helper_steps;
 select coalesce(jsonb_agg(event order by ord),'[]') into t from pg_temp.native_trace;
 return jsonb_build_object('outcome',result,'calls',n,'trace',t,'rawReads',(select coalesce(jsonb_object_agg(a.side,a.n),'{}'::jsonb) from (select side,count(*) n from pg_temp.workset_raw_reads group by side) a));
end$$;
create function pg_temp.native_ref(slots jsonb,dated jsonb,cutoff jsonb default '"2026-10-13"') returns jsonb language sql immutable as $$
 select jsonb_build_object('asOfDate',cutoff,'shadowSlots',slots,'datedSessions',dated,
 'unresolvedOccupancies','[]'::jsonb,'datedUnresolvedOccupancies','[]'::jsonb,'retainedFullReference',jsonb_build_object('history','keep','revision',7))
$$;
create function pg_temp.native_row(rowid text,daytext text) returns jsonb language sql stable as $$
 select jsonb_build_object('id',rowid,'classId',pg_temp.hid(301),'date',daytext,'state','active','startMinute',540,'endMinute',600,
 'teacherId',pg_temp.hid(101),'classroomId',pg_temp.hid(201))
$$;
create temp table native_cases(label text primary key,before_ref jsonb,after_ref jsonb,expected_code text,expected_message text,expected_calls bigint,mode text default 'real',omitted_calls bigint default 0);
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls) values
 ('complete metadata-only return',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]','[]')||'{"extra":"preserve"}','00000',0),
 ('dated multiset permutation zero affected',pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','2026-10-11'),pg_temp.native_row('b','2026-10-12'))),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('b','2026-10-12'),pg_temp.native_row('a','2026-10-11'))),'00000',0),
 ('three selected dates emitted order',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','2026-10-15'),pg_temp.native_row('b','2026-10-11'),pg_temp.native_row('c','2026-10-14'))),'00000',6),
 ('JSON null and missing date rows',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array('null'::jsonb,'{}'::jsonb,pg_temp.native_row('a','2026-10-11'))),'00000',4),
 ('empty dated different invalid cutoffs',pg_temp.native_ref('[]','[]','"old-bad-cutoff"')||'{"unresolvedOccupancies":[{"id":"same","label":"old"}]}',
 pg_temp.native_ref('[]','[]','"new-bad-cutoff"')||'{"unresolvedOccupancies":[{"id":"same","label":"new"}]}','00000',0),
 ('raw numeric source identity',pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('old','2026-10-11')||'{"sourceSlotId":1}')),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('new','2026-10-11')||'{"sourceSlotId":1.0}')),'00000',2),
 ('same key ordinal representative',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array(
 pg_temp.native_row('first','2026-10-11')||'{"sourceSlotId":"one","classId":null,"teacherId":null,"classroomId":null}',
 pg_temp.native_row('second','2026-10-11')||'{"sourceSlotId":"one","classId":null,"teacherId":null,"classroomId":null}')),'00000',2);
insert into native_cases(label,before_ref,after_ref,expected_code,expected_message,expected_calls) values
 ('both malformed cutoffs old wins empty weekly',pg_temp.native_ref('[]','[]','"old-bad-cutoff"'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','2026-10-11')),'"new-bad-cutoff"'),'22007','%old-bad-cutoff%',1),
 ('new malformed cutoff after old completion',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','2026-10-11')),'"new-bad-cutoff"'),'22007','%new-bad-cutoff%',2),
 ('old global index error before new global index',pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','old-bad-date'))),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('b','new-bad-date'))),'22007','%old-bad-date%',0),
 ('new global index error before old cutoff',pg_temp.native_ref('[]','[]','"old-bad-cutoff"'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('b','new-bad-date'))),'22007','%new-bad-date%',0),
 ('old weekday error before new cutoff',pg_temp.native_ref(jsonb_build_array((pg_temp.native_row('weekly','2026-10-14')-'date')||'{"weekday":"old-bad-weekday"}'),'[]'),
 pg_temp.native_ref(jsonb_build_array((pg_temp.native_row('weekly','2026-10-14')-'date')||'{"weekday":"old-bad-weekday"}'),jsonb_build_array(pg_temp.native_row('a','2026-10-14')),'"new-bad-cutoff"'),'22P02','%old-bad-weekday%',1);
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls,mode) values
 ('SQL NULL and JSON null helper rows',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('null-control','2026-10-11'))),'00000',2,'sql-and-json-null');
create temp table native_weekly as select (pg_temp.native_row('weekly','2026-10-13')-'date')||'{"weekday":2}' w;
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls)
 select 'inherited row suppressed by weekly identity',
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('inherited','2026-10-13')||'{"inheritedWeeklySlotId":"weekly"}')),
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('inherited','2026-10-13')||'{"inheritedWeeklySlotId":"weekly"}')),'00000',2 from native_weekly
 union all select 'cancelled same-class weekly override',pg_temp.native_ref(jsonb_build_array(w),'[]'),
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('cancelled','2026-10-13')||'{"state":"skipped","overriddenWeeklySlotId":"weekly"}')),'00000',2 from native_weekly
 union all select 'cutoff boundary changes inherited exposure',
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('inherited','2026-10-13')||'{"inheritedWeeklySlotId":"weekly"}'),'"2026-10-14"'),
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('inherited','2026-10-13')||'{"inheritedWeeklySlotId":"weekly","probeRevision":2}'),'"2026-10-13"'),'00000',2 from native_weekly;
-- Explicit synthetic fault on the FIRST entered date; complete error equality
-- compares the emitted date itself, not only successful trace ordering.
insert into native_cases(label,before_ref,after_ref,expected_code,expected_message,expected_calls,mode) values
 ('first selected date error ordinal',pg_temp.native_ref('[]','[]'),pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('a','2026-10-15'),pg_temp.native_row('b','2026-10-11'),pg_temp.native_row('c','2026-10-14'))),'22007','date-order-probe:%:1',1,'date-order-probe');

-- Current-cutoff cases exercise the new guarded path against the frozen oracle.
-- Only the two explicit zero-work cases omit helper traces; all other cases
-- preserve both result/error and every observed helper/witness boundary.
create temp table current_guard_data as select
 (pg_temp.native_row('weekly',null)-'date')||'{"weekday":1,"sourceSlotId":"slot"}' w,
 to_jsonb(pg_temp.hday(0)) cutoff,
 pg_temp.hday(7+(1-extract(dow from pg_temp.hday(0))::int+7)%7)::text monday,
 pg_temp.hday(7+(2-extract(dow from pg_temp.hday(0))::int+7)%7)::text tuesday,
 pg_temp.hday(-1)::text past;
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls,omitted_calls)
 select 'canonical unchanged past omission',pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('past',past)),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('past',past)),cutoff),'00000',0,2 from current_guard_data
 union all select 'canonical unchanged future weekday omission',pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('future',tuesday)),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('future',tuesday)),cutoff),'00000',0,2 from current_guard_data;
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls)
 select 'old weekday removal exposes inherited conflict',
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('inherited',monday)||'{"inheritedWeeklySlotId":"weekly"}',pg_temp.native_row('peer',monday)||jsonb_build_object('classId',pg_temp.hid(304))),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('inherited',monday)||'{"inheritedWeeklySlotId":"weekly"}',pg_temp.native_row('peer',monday)||jsonb_build_object('classId',pg_temp.hid(304))),cutoff),'23P01',2 from current_guard_data
 union all select 'numeric dated serialization requires fallback',
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('past',past)||'{"sourceSlotId":1}'),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('past',past)||'{"sourceSlotId":1.0}'),cutoff),'00000',2 from current_guard_data
 union all select 'canonical changed historical conflict',
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('past',past)),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('past',past),pg_temp.native_row('peer',past)),cutoff),'23P01',2 from current_guard_data
 union all select 'numeric weekly identity preserves inherited exposure',
 pg_temp.native_ref(jsonb_build_array(w||'{"id":1}',w||'{"id":"other-weekly","weekday":2,"sourceSlotId":"other-slot","revision":1}'),jsonb_build_array(pg_temp.native_row('inherited',monday)||'{"inheritedWeeklySlotId":"1"}'),cutoff),
 pg_temp.native_ref(jsonb_build_array(w||'{"id":1.0}',w||'{"id":"other-weekly","weekday":2,"sourceSlotId":"other-slot","revision":2}'),jsonb_build_array(pg_temp.native_row('inherited',monday)||'{"inheritedWeeklySlotId":"1"}'),cutoff),'23P01',2 from current_guard_data
 union all select 'noncanonical matching cutoff preserves history',
 pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('past',past)),to_jsonb(pg_temp.hday(-7))),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('past',past)),to_jsonb(pg_temp.hday(-7))),'00000',2 from current_guard_data
 union all select 'old empty retains original new date evaluation',pg_temp.native_ref('[]','[]',cutoff),
 pg_temp.native_ref(jsonb_build_array(w||'{"date":"invalid-new-date"}'),'[]',cutoff),'22007',0 from current_guard_data
 union all select 'new empty must not expand scalar old weekly',pg_temp.native_ref('1','[]',cutoff),
 pg_temp.native_ref('[]','[]',cutoff),'00000',0 from current_guard_data
 union all select 'matching old key precedes invalid old date',pg_temp.native_ref(jsonb_build_array(w,w||'{"date":"invalid-later-date"}'),'[]',cutoff),
 pg_temp.native_ref(jsonb_build_array(w),'[]',cutoff),'00000',0 from current_guard_data
 union all select 'duplicate and scalar old keys keep existence semantics',pg_temp.native_ref(jsonb_build_array(null,'scalar',w,w),'[]',cutoff),
 pg_temp.native_ref(jsonb_build_array(w),'[]',cutoff),'00000',0 from current_guard_data;
insert into native_cases(label,before_ref,after_ref,expected_code,expected_calls)
 select 'canonical NULL date keeps helper boundary',pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('null-date',null)),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('null-date',null)),cutoff),'00000',2 from current_guard_data
 union all select 'canonical infinite date keeps helper boundary',pg_temp.native_ref(jsonb_build_array(w),jsonb_build_array(pg_temp.native_row('infinite','infinity')),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('infinite','infinity')),cutoff),'00000',2 from current_guard_data
 union all select 'string weekday retains original path',pg_temp.native_ref(jsonb_build_array(w||'{"weekday":"1"}'),jsonb_build_array(pg_temp.native_row('future',monday)),cutoff),
 pg_temp.native_ref('[]',jsonb_build_array(pg_temp.native_row('future',monday)),cutoff),'00000',2 from current_guard_data;
insert into native_cases(label,before_ref,after_ref,expected_code,expected_message,expected_calls)
 select 'numeric decimal weekday retains cast error',pg_temp.native_ref(jsonb_build_array(w||'{"weekday":1.0}'),jsonb_build_array(pg_temp.native_row('future',monday)),cutoff),
 pg_temp.native_ref(jsonb_build_array(w||'{"weekday":1.0,"revision":2}'),jsonb_build_array(pg_temp.native_row('future',monday)),cutoff),'22P02','%1.0%',1 from current_guard_data
 union all select 'weekly conflict before later new date error',pg_temp.native_ref(jsonb_build_array(w),'[]',cutoff),
 pg_temp.native_ref(jsonb_build_array(w||'{"id":"new-first","sourceSlotId":"new-first-slot"}',w||'{"id":"new-second","date":"invalid-later-date"}'),'[]',cutoff),'23P01','timetable_resource_conflict',0 from current_guard_data
 union all select 'introduced unknown before malformed weekly',pg_temp.native_ref(jsonb_build_array(w),'[]',cutoff),
 pg_temp.native_ref(jsonb_build_array(w||'{"date":"invalid-new-date"}'),'[]',cutoff)||'{"unresolvedOccupancies":[{"id":"new-unknown"}]}','23P01','timetable_resource_conflict',0 from current_guard_data;

create temp table native_results(label text,original jsonb,candidate jsonb);
do $run$
declare c record;o jsonb;n jsonb;
begin
 for c in select * from pg_temp.native_cases order by label loop
  truncate pg_temp.native_inputs;
  insert into pg_temp.native_inputs values(c.before_ref,c.after_ref,c.mode);
  o:=pg_temp.native_run(true);n:=pg_temp.native_run(false);
  insert into pg_temp.native_results values(c.label,o,n);
 end loop;
end$run$;
select is(r.candidate#>>'{outcome,sqlstate}',c.expected_code,'synthetic '||r.label||': actual SQLSTATE') from native_results r join native_cases c using(label) order by label;
select is(r.candidate->'outcome',r.original->'outcome','synthetic '||r.label||': complete output/message/DETAIL parity') from native_results r order by label;
select is((r.candidate->>'calls')::bigint,c.expected_calls,'synthetic '||r.label||': entered helper count including errors') from native_results r join native_cases c using(label) order by label;
select is((r.candidate->>'calls')::bigint,(r.original->>'calls')::bigint-c.omitted_calls,'synthetic '||r.label||': exact helper count against oracle and proven omissions') from native_results r join native_cases c using(label) order by label;
select is(r.candidate->'trace',case when c.omitted_calls=0 then r.original->'trace' else '[]'::jsonb end,'synthetic '||r.label||': emitted date / helper / representative witness order parity') from native_results r join native_cases c using(label) order by label;
select ok(r.candidate#>>'{outcome,message}' like c.expected_message,'synthetic '||r.label||': specific first error') from native_results r join native_cases c using(label) where c.expected_message is not null order by label;
select is((candidate#>'{outcome,value}')::text,c.after_ref::text,'synthetic '||r.label||': exact complete fresh reference text') from native_results r join native_cases c using(label) where c.expected_code='00000' order by label;
select is((select count(*) from native_results r cross join lateral jsonb_array_elements(r.candidate->'trace') t where r.label='SQL NULL and JSON null helper rows' and t->>'kind'='returned' and t->>'sqlNull'='true'),2::bigint,'synthetic NULL transport actually includes one SQL NULL from each helper');
select ok(exists(select 1 from native_results r cross join lateral jsonb_array_elements(r.candidate->'trace') t where r.label='same key ordinal representative' and t->>'kind'='witness'), 'synthetic representative case actually exercises peer predicate');
select ok(not exists(select 1 from native_results r cross join lateral jsonb_array_elements(r.candidate->'trace') t where r.label='same key ordinal representative' and t->>'kind'='witness' and t#>>'{candidate,id}' is distinct from 'first'),'synthetic duplicate-key representative remains first source ordinal');
select is((select jsonb_agg(t#>'{row,id}' order by ord) from native_results r cross join lateral jsonb_array_elements(r.candidate->'trace') with ordinality entries(t,ord)
 where r.label='cutoff boundary changes inherited exposure' and t->>'kind'='returned'), '["inherited","weekly"]'::jsonb,
 'synthetic cutoff boundary actually changes effective inherited exposure after bypassing the unchanged-occupancy return');
select isnt(dashboard_private.timetable_occupancy_key_v1(pg_temp.native_row('x','2026-10-11')||'{"sourceSlotId":1}'),dashboard_private.timetable_occupancy_key_v1(pg_temp.native_row('x','2026-10-11')||'{"sourceSlotId":1.0}'),'numeric source text identity is not silently deduplicated');
select is((select count(*) from production_functions old join pg_proc p using(oid)
 where (old.body,old.proowner,old.proacl,old.proconfig,old.provolatile,old.prosecdef)
 is distinct from (md5(p.prosrc),p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef)),0::bigint,
 'synthetic probes leave every real function body and security contract intact');

select is(md5((select prosrc from pg_proc where oid='dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])'::regprocedure)),
 'caa986ad9b43c567d3d4e27c76c6b583','shared effective helper exact source');
select ok(not has_function_privilege(role_name,'dashboard_private.timetable_effective_workset_date_v1(jsonb,date,dashboard_private.timetable_validation_row_v1[])','EXECUTE'),
 'workset helper stays private from '||role_name) from (values('anon'),('authenticated'),('service_role')) roles(role_name);
select ok(not has_type_privilege(role_name,'dashboard_private.'||type_name,'USAGE'),'internal type stays private from '||role_name||': '||type_name)
 from (values('anon'),('authenticated'),('service_role')) roles(role_name)
 cross join (values('timetable_validation_row_v1'),('timetable_validation_effective_row_v1')) types(type_name);

select * from finish();
rollback;
