begin;
select no_plan();

-- Synthetic fixtures only. Calls exercise the main Save RPC with its complete
-- expected source and unsaved draft, plus the same deferred final guard.
create function pg_temp.sid(n int) returns uuid language sql immutable as
$$select ('ad130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.day(n int) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date-n$$;
create function pg_temp.lesson(ident text,d date,teacher int,room int,a text default '09:30',b text default '10:30')
returns jsonb language sql immutable as $$
select jsonb_build_object('id',ident,'date',d,'state','active','scheduleState','active','isForced',false,
 'startTime',a,'endTime',b,'teacherCatalogId',pg_temp.sid(teacher),'classroomCatalogId',pg_temp.sid(room))
$$;
create function pg_temp.seed_baseline() returns void language plpgsql as $$begin
 update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1()
 where transaction_id=txid_current();
 set constraints all immediate;set constraints all deferred;
end$$;
create function pg_temp.try_save(sessions jsonb,expected jsonb default null) returns jsonb language plpgsql as $$
declare source jsonb; draft jsonb; code text; message text; detail text;
begin
 select schedule_plan into source from public.classes where id=pg_temp.sid(301);
 draft:=jsonb_set(source,'{sessions}',sessions);
 perform public.update_class_operational_v1(pg_temp.sid(301),jsonb_build_object('schedule_plan',draft),gen_random_uuid(),coalesce(expected,source));
 return jsonb_build_object('ok',true);
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('code',code,'message',message,'details',nullif(detail,''),'detail',case when detail<>'' then detail::jsonb end);
end$$;
create function pg_temp.try_direct(sessions jsonb,clear_actor boolean default false) returns jsonb language plpgsql as $$
declare code text; message text; detail text;
begin
 update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',sessions) where id=pg_temp.sid(301);
 if clear_actor then perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);end if;
 set constraints all immediate;set constraints all deferred;
 return jsonb_build_object('ok',true);
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('code',code,'message',message,'details',nullif(detail,''),'detail',case when detail<>'' then detail::jsonb end);
end$$;
create function pg_temp.try_weekly() returns jsonb language plpgsql as $$
declare code text; message text; detail text;
begin
 perform public.update_class_operational_v1(pg_temp.sid(301),jsonb_build_object('status','수강','schedule','월 09:30-10:30',
  'teacher','Synthetic shared teacher','room','Synthetic shared room'),gen_random_uuid());
 return jsonb_build_object('ok',true);
exception when others then
 get stacked diagnostics code=RETURNED_SQLSTATE,message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
 return jsonb_build_object('code',code,'message',message,'details',nullif(detail,''),'detail',case when detail<>'' then detail::jsonb end);
end$$;

insert into auth.users(id,instance_id,aud,role,email) select pg_temp.sid(n),
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated','save-detail-'||n||'@test.invalid'
 from generate_series(901,905) n;
insert into public.profiles(id,role,name) values
 (pg_temp.sid(901),'admin','Synthetic detail administrator'),(pg_temp.sid(902),'staff','Synthetic staff'),
 (pg_temp.sid(903),'teacher','Synthetic teacher'),(pg_temp.sid(904),'admin','Synthetic banned administrator'),
 (pg_temp.sid(905),'admin','Synthetic deleted administrator')
 on conflict(id) do update set role=excluded.role,name=excluded.name;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.sid(904);
update auth.users set deleted_at=now() where id=pg_temp.sid(905);
insert into public.teacher_catalogs(id,name,subjects) values
 (pg_temp.sid(101),'Synthetic shared teacher',array['영어']),
 (pg_temp.sid(102),'Synthetic other teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.sid(201),'Synthetic shared room',array['영어']),
 (pg_temp.sid(202),'Synthetic other room',array['영어']);
-- Owner-only historical fixture seeding. No tested authenticated call receives
-- the private atomic-close context or the baseline seeding capability.
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) values
 (pg_temp.sid(301),'Synthetic draft target','영어','개강 준비','legacy',jsonb_build_object('sessions',
  jsonb_build_array(pg_temp.lesson('retained-same-class',pg_temp.day(5),102,202,'09:00','10:00')),
  'privateNote','NEVER_RETURN_PRIVATE','history',jsonb_build_array('NEVER_RETURN_HISTORY'))),
 (pg_temp.sid(302),'Synthetic teacher collision','영어','개강 준비','legacy',jsonb_build_object('sessions',
  jsonb_build_array(pg_temp.lesson('teacher-proof',pg_temp.day(2),101,202,'09:00','10:00')))),
 (pg_temp.sid(303),'Synthetic room collision','영어','종강','legacy',jsonb_build_object('sessions',
  jsonb_build_array(pg_temp.lesson('room-proof',pg_temp.day(3),102,201,'09:00','10:00')))),
 (pg_temp.sid(304),'Synthetic both collision','영어','개강 준비','legacy',jsonb_build_object('sessions',
  jsonb_build_array(pg_temp.lesson('both-proof',pg_temp.day(4),101,201,'09:00','10:00'))));
select set_config('app.class_close_mutation','',true);
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1)
 on conflict(singleton) do update set version=1;
select pg_temp.seed_baseline();
create temp table original as select schedule_plan plan from public.classes where id=pg_temp.sid(301);
create temp table no_send as select (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.student_class_enrollment_history) history;
create temp table ev(k text primary key,v jsonb);
grant all on ev to authenticated,service_role,anon;
grant select on original to authenticated;

select ok(not has_function_privilege('authenticated','dashboard_private.assert_timetable_operational_conflicts_v1()','EXECUTE'),
 'guard remains private to authenticated clients');
select ok(not has_function_privilege('anon','dashboard_private.assert_timetable_operational_conflicts_v1()','EXECUTE'),
 'guard remains private to anonymous clients');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),
 'postgres','existing guard owner remains unchanged');

select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
set local role authenticated;
insert into ev values('teacher',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('unsaved-teacher',pg_temp.day(2),101,201))));
select is((select v->>'code' from ev where k='teacher'),'23P01','actual main Save retains exact business SQLSTATE');
select is((select v->>'message' from ev where k='teacher'),'timetable_resource_conflict','actual main Save retains exact conflict message');
select is((select v#>>'{detail,version}' from ev where k='teacher'),'1','PostgREST DETAIL uses versioned JSON');
select is((select v#>>'{detail,confirmed,0,className}' from ev where k='teacher'),'Synthetic teacher collision','unsaved candidate explains actual existing counterpart');
select is((select v#>>'{detail,confirmed,0,date}' from ev where k='teacher'),pg_temp.day(2)::text,'historical exact date remains proven');
select is((select v#>>'{detail,confirmed,0,startMinute}' from ev where k='teacher'),'540','counterpart start is preserved');
select is((select v#>>'{detail,confirmed,0,endMinute}' from ev where k='teacher'),'600','counterpart end is preserved');
select is((select v#>>'{detail,confirmed,0,overlapStartMinute}' from ev where k='teacher'),'570','overlap start uses current unsaved candidate');
select is((select v#>>'{detail,confirmed,0,overlapEndMinute}' from ev where k='teacher'),'600','overlap end uses the exact common interval');
select is((select v#>>'{detail,confirmed,0,teacherName}' from ev where k='teacher'),'Synthetic shared teacher','teacher-only collision identifies the matched teacher');
select ok(not (select v#>'{detail,confirmed,0}' ? 'classroomName' from ev where k='teacher'),'teacher-only collision does not claim unmatched room');
select is((select v#>>'{detail,unresolvedCount}' from ev where k='teacher'),'0','fully known collision has no uncertainty');
select is((select schedule_plan from public.classes where id=pg_temp.sid(301)),(select plan from original),'rejected main Save preserves complete saved source');

insert into ev values('room',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('unsaved-room',pg_temp.day(3),101,201))));
select is((select v#>>'{detail,confirmed,0,className}' from ev where k='room'),'Synthetic room collision','closed-class dated reservation is still checked');
select is((select v#>>'{detail,confirmed,0,classroomName}' from ev where k='room'),'Synthetic shared room','room-only collision identifies matched room');
select ok(not (select v#>'{detail,confirmed,0}' ? 'teacherName' from ev where k='room'),'room-only collision does not claim unmatched teacher');
insert into ev values('both',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('unsaved-both',pg_temp.day(4),101,201))));
select is((select v#>>'{detail,confirmed,0,teacherName}' from ev where k='both'),'Synthetic shared teacher','both-resource collision identifies teacher');
select is((select v#>>'{detail,confirmed,0,classroomName}' from ev where k='both'),'Synthetic shared room','both-resource collision identifies room');
insert into ev values('same-class',pg_temp.try_save((select plan->'sessions' from original)||jsonb_build_array(pg_temp.lesson('unsaved-same-class',pg_temp.day(5),101,201))));
select is((select v#>>'{detail,confirmed,0,sameClass}' from ev where k='same-class'),'true','same-class simultaneous lessons preserve independent guard rule');
select ok(not (select v#>'{detail,confirmed,0}' ?| array['teacherName','classroomName'] from ev where k='same-class'),'same-class collision invents no matched resource');
insert into ev values('stale',pg_temp.try_save('[]','{}'));
select is((select v->>'code' from ev where k='stale'),'P0001','full expected-source mismatch remains a stale-domain failure');
select ok((select v->'detail'='null'::jsonb from ev where k='stale'),'technical/stale error gets no collision detail');
select is(pg_temp.try_save(jsonb_build_array(pg_temp.lesson('adjacent',pg_temp.day(2),101,201,'10:00','11:00')))->>'ok','true',
 'adjacent exact minute intervals remain saveable');
select is((select pg_temp.try_save(jsonb_build_array(pg_temp.lesson('nonoverlap',pg_temp.day(2),101,201,'11:00','12:00')))->>'ok'),'true','safe corrected draft commits through real main Save');
reset role;
select pg_temp.seed_baseline();
update public.classes set schedule_plan=(select plan from original) where id=pg_temp.sid(301);
select pg_temp.seed_baseline();

-- Role restriction is evaluated on the server, including stale admin JWTs and
-- live deleted/banned actors; claims never grant disclosure by themselves.
select set_config('request.jwt.claim.sub',pg_temp.sid(902)::text,true);
set local role authenticated;
insert into ev values('staff',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('staff-draft',pg_temp.day(2),101,201))));
select is((select v->>'code' from ev where k='staff'),'23P01','staff retains conflict blocking');
select ok((select v->'detail'='null'::jsonb from ev where k='staff'),'staff receives no cross-class detail or counts');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.sid(903)::text,true);
set local role authenticated;
insert into ev values('teacher-denied',pg_temp.try_direct(jsonb_build_array(pg_temp.lesson('teacher-direct',pg_temp.day(2),101,201))));
select is((select v->>'code' from ev where k='teacher-denied'),'23P01','existing teacher direct-write path still reaches deferred conflict guard');
select ok((select v->'detail'='null'::jsonb from ev where k='teacher-denied'),'teacher direct write cannot disclose other class names');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.sid(904)::text,true);
set local role authenticated;
insert into ev values('banned',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('banned-draft',pg_temp.day(2),101,201))));
select ok((select v->'detail'='null'::jsonb from ev where k='banned'),'banned administrator receives no detail');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.sid(905)::text,true);
set local role authenticated;
insert into ev values('deleted',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('deleted-draft',pg_temp.day(2),101,201))));
select ok((select v->'detail'='null'::jsonb from ev where k='deleted'),'deleted administrator receives no detail');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role service_role;
insert into ev values('service',pg_temp.try_direct(jsonb_build_array(pg_temp.lesson('service-draft',pg_temp.day(2),101,201))));
select is((select v->>'code' from ev where k='service'),'42501','service-role existing table ACL continues to deny direct writes');
select ok((select v->'detail'='null'::jsonb from ev where k='service'),'service role cannot disclose using an impersonated authenticated JWT claim');
reset role;
insert into ev values('owner-claims',pg_temp.try_direct(jsonb_build_array(pg_temp.lesson('owner-claims-draft',pg_temp.day(2),101,201))));
select is((select v->>'code' from ev where k='owner-claims'),'23P01','privileged direct writer still reaches the same deferred guard');
select ok((select v->'detail'='null'::jsonb from ev where k='owner-claims'),'authenticated JWT claims alone cannot enable owner-role disclosure');

insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
 (pg_temp.sid(307),'Synthetic weekly collision','영어','수강','legacy','월 09:00-10:00','Synthetic shared teacher','Synthetic other room','{}');
select pg_temp.seed_baseline();
set local role authenticated;
insert into ev values('weekly',pg_temp.try_weekly());
select is((select v->>'code' from ev where k='weekly'),'23P01','weekly recurrence conflict preserves exact SQLSTATE');
select is((select v#>>'{detail,confirmed,0,className}' from ev where k='weekly'),'Synthetic weekly collision','weekly recurrence identifies actual counterpart');
select is((select v#>>'{detail,confirmed,0,weekday}' from ev where k='weekly'),'1','weekly recurrence retains independently proven weekday');
select ok(not (select v#>'{detail,confirmed,0}' ? 'date' from ev where k='weekly'),'weekly collision never invents an exact date');
reset role;

set local role authenticated;
insert into ev values('restored-jwt',pg_temp.try_direct(jsonb_build_array(pg_temp.lesson('deferred-draft',pg_temp.day(2),101,201)),true));
select is((select v->>'code' from ev where k='restored-jwt'),'23P01','deferred guard still blocks after caller restores JWT context');
select ok((select v->'detail'='null'::jsonb from ev where k='restored-jwt'),'restored JWT context cannot inherit another actor disclosure');
reset role;

-- Existing historical uncertainty cannot be converted into a proven overlap.
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) values
 (pg_temp.sid(305),'Synthetic past missing snapshots','영어','종강','legacy',jsonb_build_object('sessions',jsonb_build_array(
  jsonb_build_object('id','past-unknown','date',pg_temp.day(1),'state','active'))));
select set_config('app.class_close_mutation','',true);
select pg_temp.seed_baseline();
set local role authenticated;
insert into ev values('unknown-past',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('past-draft',pg_temp.day(1),101,201))));
select is((select v->>'code' from ev where k='unknown-past'),'23P01','unknown historical occupancy still blocks');
select is((select v#>>'{detail,confirmedCount}' from ev where k='unknown-past'),'0','NULL wildcard never claims an actual overlap');
select is((select v#>>'{detail,unresolvedCount}' from ev where k='unknown-past'),'1','missing historical snapshots are a separate uncertainty');
select is((select v#>>'{detail,unresolved,0,date}' from ev where k='unknown-past'),pg_temp.day(1)::text,'independently known historical date is retained');
select is((select v#>'{detail,unresolved,0,missingFields}' from ev where k='unknown-past'),'["time","teacher","classroom"]'::jsonb,'missing snapshots identify only independently missing fields');
select ok(not (select v#>'{detail,unresolved,0}' ?| array['teacherName','classroomName','overlapStartMinute','overlapEndMinute'] from ev where k='unknown-past'),
 'unknown blocker includes no resource or overlap claim');
insert into ev values('introduced',pg_temp.try_save(jsonb_build_array(jsonb_build_object('id','new-unknown','date',pg_temp.day(6),'state','active'))));
select is((select v#>>'{detail,confirmedCount}' from ev where k='introduced'),'0','introducing incomplete occupancy remains separate from collision');
select is((select v#>>'{detail,unresolved,0,className}' from ev where k='introduced'),'Synthetic draft target','new incomplete draft identifies its own source');
reset role;

insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) values
 (pg_temp.sid(306),'Synthetic concurrent uncertainty','영어','개강 준비','legacy',jsonb_build_object('sessions',jsonb_build_array(
  jsonb_build_object('id','mixed-unknown','date',pg_temp.day(2),'state','active'))));
select pg_temp.seed_baseline();
set local role authenticated;
insert into ev values('mixed',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('mixed-draft',pg_temp.day(2),101,201))));
select is((select v#>>'{detail,confirmedCount}' from ev where k='mixed'),'1','confirmed overlap remains separate when uncertainty also blocks');
select is((select v#>>'{detail,unresolvedCount}' from ev where k='mixed'),'1','same rejected candidate separately reports unknown blocker');
reset role;

-- Unknown dates stay unknown; bounded output preserves the actual total.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan)
select pg_temp.sid(400+n),'Synthetic wildcard '||n,'영어','개강 준비','legacy',jsonb_build_object('sessions',jsonb_build_array(null::jsonb))
from generate_series(1,23) n;
select pg_temp.seed_baseline();
set local role authenticated;
insert into ev values('wildcards',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('wildcard-draft',pg_temp.day(7),101,201))));
select is((select v#>>'{detail,confirmedCount}' from ev where k='wildcards'),'0','unknown-date blockers remain unconfirmed');
select is((select v#>>'{detail,unresolvedCount}' from ev where k='wildcards'),'23','complete source sees every unknown-date blocker');
select is((select jsonb_array_length(v#>'{detail,unresolved}') from ev where k='wildcards'),20,'disclosed rows are bounded');
select is((select v#>>'{detail,truncated}' from ev where k='wildcards'),'true','bounded output reports truncation');
select ok(not exists(select 1 from ev,jsonb_array_elements(v#>'{detail,unresolved}') z where k='wildcards' and z ? 'date'),
 'unknown dates are never filled from the attempted save');
select ok(not exists(select 1 from ev,jsonb_array_elements(v#>'{detail,unresolved}') z where k='wildcards' and z::text~'classId|teacherId|classroomId|occupancyFingerprint|NEVER_RETURN'),
 'error payload exports no IDs, fingerprints or private saved fields');
reset role;
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan)
select pg_temp.sid(500+n),'Synthetic confirmed '||n,'영어','개강 준비','legacy',jsonb_build_object('sessions',jsonb_build_array(
 pg_temp.lesson('retained-proof-'||n,pg_temp.day(8),101,201,'09:00','10:00')))
from generate_series(1,23) n;
select pg_temp.seed_baseline();
set local role authenticated;
insert into ev values('many-confirmed',pg_temp.try_save(jsonb_build_array(pg_temp.lesson('bounded-draft',pg_temp.day(8),101,201))));
select is((select v#>>'{detail,confirmedCount}' from ev where k='many-confirmed'),'23','known-pair count uses complete source');
select is((select jsonb_array_length(v#>'{detail,confirmed}') from ev where k='many-confirmed'),20,'confirmed rows are bounded');
select is((select v#>>'{detail,truncated}' from ev where k='many-confirmed'),'true','confirmed truncation is explicit');
select ok(not exists(select 1 from ev,jsonb_array_elements(v#>'{detail,confirmed}') z where k='many-confirmed' and z::text~'classId|teacherId|classroomId|occupancyFingerprint|NEVER_RETURN'),
 'confirmed payload exports no IDs, fingerprints or private fields');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.sid(301)),(select plan from original),'all rejected drafts preserve complete original plan');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines),0::bigint,'rejected writes and deferred checks leave no private baseline');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'details emit no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'details enqueue no delivery');
select is((select count(*) from public.student_class_enrollment_history),(select history from no_send),'details preserve enrollment history');
do $$begin
 raise notice 'C13_SQL_PRODUCER_FIXTURES %',(select jsonb_object_agg(k,v-'detail' order by k) from ev where k in('teacher','both','unknown-past','same-class'));
end$$;
select * from finish();
rollback;
