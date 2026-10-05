-- Synthetic pgTAP. Requires the final ordered domain migrations and
-- the separately reviewed agent-personal-dashboard-read DRAFT. No issuance RPC,
-- production credential, provider operation or operational installation is exercised here.
-- Execution requires a separately authorized isolated fixture; all changes roll back.
begin;
select plan(110);
create function pg_temp.pd_id(n integer) returns uuid language sql immutable as $$select ('ad050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.pd_hash(n integer) returns text language sql immutable as $$select encode(sha256(convert_to('synthetic-personal-dashboard-'||n::text,'UTF8')),'hex')$$;
create function pg_temp.pd_read(n integer,a text,i jsonb default '{}') returns jsonb language sql as $$select public.agent_personal_dashboard_read_v1(pg_temp.pd_hash(n),a,i)$$;
create function pg_temp.pd_class(cid integer default 201,key_number integer default 701) returns jsonb language sql as $$select pg_temp.pd_read(key_number,'class_context',jsonb_build_object('classId',pg_temp.pd_id(cid)))$$;
create function pg_temp.pd_calendar(sid integer default 501,key_number integer default 701) returns jsonb language sql as $$select pg_temp.pd_read(key_number,'calendar_context',jsonb_build_object('schoolId',pg_temp.pd_id(sid),'schoolYear',2099))$$;
insert into auth.users(id,instance_id,aud,role,email) select pg_temp.pd_id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dashboard-read-'||n||'@test.invalid' from generate_series(1,4)n;
insert into public.profiles(id,role,name) select pg_temp.pd_id(n),case n when 1 then 'admin' when 4 then 'viewer' else 'teacher' end,'Synthetic dashboard profile '||n from generate_series(1,4)n on conflict(id) do update set role=excluded.role;
-- Canonical Auth insertion creates catalogs. Keep that trigger enabled and
-- detach its links before seeding the explicit reciprocal UUIDs used here.
update public.teacher_catalogs set profile_id=null where profile_id in(pg_temp.pd_id(2),pg_temp.pd_id(3));
insert into public.teacher_catalogs(id,name,subjects,profile_id) values(pg_temp.pd_id(101),'Synthetic owner teacher',array['영어'],pg_temp.pd_id(2)),(pg_temp.pd_id(102),'Synthetic other teacher',array['영어'],pg_temp.pd_id(3));
update public.profiles set teacher_catalog_id=pg_temp.pd_id(case id when pg_temp.pd_id(2) then 101 else 102 end) where id in(pg_temp.pd_id(2),pg_temp.pd_id(3));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.pd_id(103),'Synthetic room',array['영어']);
insert into public.classes(id,name,class_type,subject,grade,status,schedule_storage_mode,teacher,room,schedule,schedule_plan,student_ids,waitlist_ids,capacity,fee) values
(pg_temp.pd_id(201),'Synthetic owned class','regular','영어','고1','수강','normalized','Synthetic owner teacher','Synthetic room','월 09:00-10:00','{"sessions":[],"privateNote":"PRIVATE_PLAN"}','["PRIVATE_STUDENT"]','["PRIVATE_WAITLIST"]',18,12345),
(pg_temp.pd_id(202),'Synthetic other class','regular','영어','고1','수강','normalized','Synthetic other teacher','Synthetic room','화 11:00-12:00','{}','[]','[]',18,12345),
(pg_temp.pd_id(203),'Synthetic legacy class','regular','영어','고1','수강','legacy','Synthetic owner teacher','Synthetic room','수 13:00-14:00','{}','[]','[]',18,12345),
(pg_temp.pd_id(204),'Synthetic name-only class','regular','영어','고1','수강','normalized','Synthetic owner teacher','Synthetic room','목 15:00-16:00','{}','[]','[]',18,12345);
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1) on conflict(singleton) do update set version=1;
-- Fixture domain write guard only: this does not supply callback identity or grants.
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order) values
(pg_temp.pd_id(301),pg_temp.pd_id(201),1,'09:00','10:00',pg_temp.pd_id(101),'Synthetic owner teacher',pg_temp.pd_id(103),'Synthetic room',0),
(pg_temp.pd_id(302),pg_temp.pd_id(202),2,'11:00','12:00',pg_temp.pd_id(102),'Synthetic other teacher',pg_temp.pd_id(103),'Synthetic room',0),
(pg_temp.pd_id(303),pg_temp.pd_id(204),4,'15:00','16:00',null,'Synthetic owner teacher',pg_temp.pd_id(103),'Synthetic room',0);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,source_schedule_slot_id,origin,memo,public_note,teacher_note) values(pg_temp.pd_id(401),pg_temp.pd_id(201),'synthetic-current','2099-10-05','active','09:00','10:00',pg_temp.pd_id(101),pg_temp.pd_id(103),pg_temp.pd_id(301),'default','PRIVATE_MEMO','PRIVATE_PUBLIC_NOTE','PRIVATE_TEACHER_NOTE');
insert into public.academic_schools(id,name,category) values(pg_temp.pd_id(501),'Synthetic granted school','high'),(pg_temp.pd_id(502),'Synthetic ungranted school','middle');
insert into public.academic_events(id,school_id,title,date,type,grade,note,content) values
(pg_temp.pd_id(601),pg_temp.pd_id(501),'Synthetic public exam','2099-10-01','시험기간','고1','PRIVATE_EVENT_NOTE','PRIVATE_EVENT_CONTENT'),
(pg_temp.pd_id(602),pg_temp.pd_id(501),'Synthetic makeup','2099-10-02','시험기간','고1','[[TIPS_MAKEUP]] PRIVATE_PERSONAL',null),
(pg_temp.pd_id(603),pg_temp.pd_id(501),'Synthetic unknown personal','2099-10-03','개인일정',null,'PRIVATE_PERSONAL',null),
(pg_temp.pd_id(604),pg_temp.pd_id(502),'Synthetic other school exam','2099-10-04','시험기간','고1',null,null);
-- Flush only this transaction's synthetic scheduling baseline, leaving guards active.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
insert into dashboard_private.agent_personal_dashboard_credentials(id,created_by,owner_profile_id,label,token_hash,scopes,class_ids,school_ids,expires_at) values
(pg_temp.pd_id(701),pg_temp.pd_id(1),pg_temp.pd_id(2),'Synthetic explicit reads',pg_temp.pd_hash(701),array['class-details:read','calendar:read'],array[pg_temp.pd_id(201),pg_temp.pd_id(202),pg_temp.pd_id(203),pg_temp.pd_id(204)],array[pg_temp.pd_id(501)],clock_timestamp()+interval '1 day'),
(pg_temp.pd_id(702),pg_temp.pd_id(1),pg_temp.pd_id(2),'Synthetic class only',pg_temp.pd_hash(702),array['class-details:read'],array[pg_temp.pd_id(201)],'{}',clock_timestamp()+interval '1 day'),
(pg_temp.pd_id(703),pg_temp.pd_id(1),pg_temp.pd_id(2),'Synthetic calendar only',pg_temp.pd_hash(703),array['calendar:read'],'{}',array[pg_temp.pd_id(501)],clock_timestamp()+interval '1 day'),
(pg_temp.pd_id(704),pg_temp.pd_id(1),pg_temp.pd_id(2),'Synthetic already expired',pg_temp.pd_hash(704),array['class-details:read'],array[pg_temp.pd_id(201)],'{}',clock_timestamp()-interval '1 minute');
create temp table pd_evidence(k text primary key,v jsonb not null);grant all on pd_evidence to authenticated,service_role;
create temp table pd_unchanged as select
(select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.pd_id(201),pg_temp.pd_id(202),pg_temp.pd_id(203),pg_temp.pd_id(204))) classes,
(select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.pd_id(401)) session,
(select jsonb_agg(to_jsonb(e) order by id) from public.academic_events e where school_id in(pg_temp.pd_id(501),pg_temp.pd_id(502))) events,
(select count(*) from dashboard_private.notification_events) notifications,
(select count(*) from dashboard_private.notification_deliveries) deliveries,
(select count(*) from public.student_class_enrollment_history) enrollments,
(select count(*) from dashboard_private.agent_credentials) central_keys,
(select count(*) from dashboard_private.ai_agent_credentials) inbox_keys,
pg_get_functiondef('public.agent_api_v2(text,text,jsonb)'::regprocedure) central_definition,
pg_get_functiondef('public.agent_calendar_api_v1(text,text,jsonb)'::regprocedure) calendar_definition;

-- Store shape and immutable authority: no empty/all, duplicates, role escalation,
-- other audience, owner rebinding or silent expiration extension.
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),null,'Missing owner',pg_temp.pd_hash(800),array['class-details:read'],array[pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23502',null,'missing owner cannot be stored');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,credential_kind,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'central','Wrong kind',pg_temp.pd_hash(801),array['class-details:read'],array[pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23514',null,'different credential kind cannot enter personal store');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,audience,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'tips_agent','Wrong audience',pg_temp.pd_hash(802),array['class-details:read'],array[pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23514',null,'central token audience cannot enter personal store');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Write scope',pg_temp.pd_hash(803),array['schedule:write'],array[pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23514',null,'business write scope cannot enter read-only store');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Empty all',pg_temp.pd_hash(804),array['class-details:read'],'{}',now()+interval '1 day')$q$,'23514',null,'empty class grant never means all');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Null class grant',pg_temp.pd_hash(805),array['class-details:read'],array[null::uuid],now()+interval '1 day')$q$,'23514',null,'null UUID cannot enter class grant');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Duplicate class grant',pg_temp.pd_hash(806),array['class-details:read'],array[pg_temp.pd_id(201),pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23514',null,'duplicate UUID class grants rejected');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,school_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Duplicate school grant',pg_temp.pd_hash(807),array['calendar:read'],array[pg_temp.pd_id(501),pg_temp.pd_id(501)],now()+interval '1 day')$q$,'23514',null,'duplicate UUID school grants rejected');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Oversized class grant',pg_temp.pd_hash(808),array['class-details:read'],array(select pg_temp.pd_id(1000+n) from generate_series(1,51)n),now()+interval '1 day')$q$,'23514',null,'class grant cannot exceed fifty explicit UUIDs');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,school_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Empty school all',pg_temp.pd_hash(809),array['calendar:read'],'{}',now()+interval '1 day')$q$,'23514',null,'empty school grant never means all');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,school_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Oversized school grant',pg_temp.pd_hash(810),array['calendar:read'],array(select pg_temp.pd_id(2000+n) from generate_series(1,51)n),now()+interval '1 day')$q$,'23514',null,'school grant cannot exceed fifty explicit UUIDs');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,class_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Duplicate scope',pg_temp.pd_hash(811),array['class-details:read','class-details:read'],array[pg_temp.pd_id(201)],now()+interval '1 day')$q$,'23514',null,'duplicate read scopes rejected');
select throws_ok($q$insert into dashboard_private.agent_personal_dashboard_credentials(created_by,owner_profile_id,label,token_hash,scopes,school_ids,expires_at) values(pg_temp.pd_id(1),pg_temp.pd_id(2),'Null school grant',pg_temp.pd_hash(812),array['calendar:read'],array[null::uuid],now()+interval '1 day')$q$,'23514',null,'null UUID cannot enter school grant');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set owner_profile_id=pg_temp.pd_id(3) where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','credential owner cannot be rebound');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set created_by=pg_temp.pd_id(3) where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','issuer identity cannot be rebound');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set credential_kind='central' where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','kind cannot be reclassified');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set token_hash=pg_temp.pd_hash(999) where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','digest cannot be rebound');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set scopes=array['class-details:read'] where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','scopes cannot be changed in place');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set class_ids=array[pg_temp.pd_id(202)] where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','class grants cannot be changed in place');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set school_ids=array[pg_temp.pd_id(502)] where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','school grants cannot be changed in place');
select throws_ok($q$update dashboard_private.agent_personal_dashboard_credentials set expires_at=clock_timestamp()+interval '2 days' where id=pg_temp.pd_id(701)$q$,'55000','agent_personal_identity_immutable','expiry cannot be extended in place');
select ok((select relrowsecurity from pg_class where oid='dashboard_private.agent_personal_dashboard_credentials'::regclass),'new credential store has RLS enabled');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%personal_dashboard%' and p.proname<>'agent_personal_dashboard_read_v1'),'no public issuance or additional personal action RPC is supplied');

select set_config('request.jwt.claim.sub',pg_temp.pd_id(1)::text,true);
set local role authenticated;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501',null,'logged-in issuer cannot invoke service-only callback directly');
select throws_ok($q$select * from dashboard_private.agent_personal_dashboard_credentials$q$,'42501',null,'authenticated cannot read personal digest or policy rows');
reset role;
set local role anon;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501',null,'anonymous cannot invoke service-only callback');
reset role;
set local role service_role;
select throws_ok($q$select * from dashboard_private.agent_personal_dashboard_credentials$q$,'42501',null,'service gateway cannot select personal store directly');
select throws_ok($q$select public.agent_personal_dashboard_read_v1('not-a-digest','class_context','{}')$q$,'28000','agent_unauthorized','malformed digest denied');
select throws_ok($q$select pg_temp.pd_class(201,999)$q$,'28000','agent_unauthorized','unregistered digest never falls through to central authentication');
select throws_ok($q$select pg_temp.pd_class(201,704)$q$,'28000','agent_unauthorized','already expired key denied');
select throws_ok($q$select pg_temp.pd_read(701,'commit','{}')$q$,'22023','agent_invalid','write action absent from fixed callback action set');
select throws_ok($q$select pg_temp.pd_read(701,'class_context',jsonb_build_object('classId',pg_temp.pd_id(201),'ownerProfileId',pg_temp.pd_id(1)))$q$,'22023','agent_invalid','caller cannot override stored owner');
select throws_ok($q$select pg_temp.pd_read(701,'class_context','{"classId":"invalid"}')$q$,'22023','agent_invalid','malformed resource UUID rejected');
select throws_ok($q$select pg_temp.pd_read(701,'class_context','{"classId":null}')$q$,'22023','agent_invalid','null resource UUID rejected');
select throws_ok($q$select pg_temp.pd_read(701,'class_context','[]')$q$,'22023','agent_invalid','nonobject input rejected');
select throws_ok($q$select pg_temp.pd_calendar(501,702)$q$,'42501','agent_scope_forbidden','class-only credential does not imply calendar scope');
select throws_ok($q$select pg_temp.pd_class(201,703)$q$,'42501','agent_scope_forbidden','calendar-only credential does not imply class scope');
insert into pd_evidence values('class',pg_temp.pd_class()),('calendar',pg_temp.pd_calendar()),('schools',pg_temp.pd_read(701,'schools','{"page":1,"search":""}'));
select is((select v#>>'{data,authorization,ownerProfileId}' from pd_evidence where k='class'),pg_temp.pd_id(2)::text,'authority is stored teacher owner even when caller JWT is issuer admin');
select is((select v#>>'{data,authorization,credentialId}' from pd_evidence where k='class'),pg_temp.pd_id(701)::text,'callback proof names exact personal credential');
select is((select v#>>'{data,authorization,credentialKind}' from pd_evidence where k='class'),'personal_dashboard_read','callback proof has separate read audience kind');
select is((select v#>>'{data,authorization,ownerRole}' from pd_evidence where k='class'),'teacher','current teacher role is reflected in proof');
select is((select v#>>'{data,authorization,scope}' from pd_evidence where k='class'),'class-details:read','scope is derived from stored credential and action');
select is((select (v#>'{data,authorization}')-'credentialId'-'credentialKind'-'ownerProfileId'-'ownerRole'-'scope' from pd_evidence where k='class'),'{}'::jsonb,'authorization exposes no issuer identity or raw grant');
select is((select (v->'data')-'authorization'-'resource'-'context' from pd_evidence where k='class'),'{}'::jsonb,'producer envelope exposes only agreed proof/resource/context');
select is((select v#>>'{data,resource,id}' from pd_evidence where k='class'),pg_temp.pd_id(201)::text,'resource proof matches current authorized class');
select is((select (v#>'{data,context}')-'id'-'version'-'basic'-'storageMode'-'schedule'-'weeklySlots'-'plan'-'sessions'-'catalogs'-'weeklyScheduleComplete' from pd_evidence where k='class'),'{}'::jsonb,'class context contains exactly safe producer fields');
select is((select (v#>'{data,context,basic}')-'name'-'classType'-'subject'-'subjectAreaKey'-'grade' from pd_evidence where k='class'),'{}'::jsonb,'basic projection excludes fee/capacity/roster');
select is((select v#>'{data,context,plan}' from pd_evidence where k='class'),'{}'::jsonb,'raw class plan is never returned');
select is((select v#>'{data,context,catalogs}' from pd_evidence where k='class'),'{"teachers":[],"classrooms":[]}'::jsonb,'no unrelated teacher/classroom catalog is disclosed');
select is(jsonb_array_length((select v#>'{data,context,weeklySlots}' from pd_evidence where k='class')),1,'owned normalized slot is nonempty in producer');
select is((select (v#>'{data,context,weeklySlots,0}')-'id'-'weekday'-'startMinute'-'endMinute'-'teacherId'-'classroomId'-'sortOrder' from pd_evidence where k='class'),'{}'::jsonb,'weekly slot contains scheduling fields only');
select is((select (v#>'{data,context,sessions,0}')-'id'-'session_date'-'schedule_state'-'start_time'-'end_time'-'teacher_catalog_id'-'classroom_catalog_id'-'source_schedule_slot_id'-'makeup_of_session_id' from pd_evidence where k='class'),'{}'::jsonb,'session excludes notes/content/student data');
select ok((select v::text not like '%PRIVATE_%' from pd_evidence where k='class'),'private sentinel values never reach class producer');
select throws_ok($q$select pg_temp.pd_class(202)$q$,'42501','agent_scope_forbidden','explicit grant plus admin caller cannot read other teacher class');
select throws_ok($q$select pg_temp.pd_class(203)$q$,'42501','agent_scope_forbidden','legacy display-name assignment fails closed');
select throws_ok($q$select pg_temp.pd_class(204)$q$,'42501','agent_scope_forbidden','normalized name-only slot cannot substitute current UUID assignment');
select throws_ok($q$select pg_temp.pd_class(202,702)$q$,'42501','agent_scope_forbidden','current assignment never expands an explicit class grant');
select is((select v#>>'{data,context,total}' from pd_evidence where k='schools'),'1','school list authority filter precedes total and pagination');
select is((select v#>>'{data,context,items,0,id}' from pd_evidence where k='schools'),pg_temp.pd_id(501)::text,'school list contains only explicit granted school');
select is(pg_temp.pd_read(701,'schools','{"page":2}')#>'{data,context,items}','[]'::jsonb,'second page cannot leak ungranted schools');
select is(pg_temp.pd_read(701,'schools','{"search":"ungranted"}')#>>'{data,context,total}','0','search cannot expand school grant');
select throws_ok($q$select pg_temp.pd_calendar(502)$q$,'42501','agent_scope_forbidden','shared dashboard calendar never implies all-school credential grant');
select throws_ok($q$select pg_temp.pd_read(701,'schools','{"page":0}')$q$,'22023','agent_invalid','pagination lower bound enforced');
select throws_ok($q$select pg_temp.pd_read(701,'schools','{"page":10001}')$q$,'22023','agent_invalid','pagination upper bound enforced');
select throws_ok($q$select pg_temp.pd_read(701,'schools','{"page":"1"}')$q$,'22023','agent_invalid','string pagination rejected');
select throws_ok($q$select pg_temp.pd_read(701,'schools','{"all":true}')$q$,'22023','agent_invalid','caller cannot request all-school mode');
select throws_ok($q$select pg_temp.pd_read(701,'calendar_context',jsonb_build_object('schoolId',pg_temp.pd_id(501),'schoolYear',1999))$q$,'22023','agent_invalid_range','school year bound enforced');
select is((select v#>>'{data,authorization,scope}' from pd_evidence where k='calendar'),'calendar:read','calendar proof has exact read scope');
select is((select (v#>'{data,context}')-'school'-'schoolYear'-'version'-'events'-'scienceAreas' from pd_evidence where k='calendar'),'{}'::jsonb,'calendar context exposes exactly safe producer fields');
select is(jsonb_array_length((select v#>'{data,context,events}' from pd_evidence where k='calendar')),1,'public event retained while makeup/unknown/other-school events excluded');
select is((select (v#>'{data,context,events,0}')-'id'-'title'-'type'-'date'-'grade' from pd_evidence where k='calendar'),'{}'::jsonb,'calendar event has no note/source/free description');
select ok((select v::text not like '%PRIVATE_%' from pd_evidence where k='calendar'),'private calendar sentinel values do not reach producer');
reset role;
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.pd_id(201),pg_temp.pd_id(202),pg_temp.pd_id(203),pg_temp.pd_id(204))),(select classes from pd_unchanged),'successful and denied reads leave class rows unchanged');
select is((select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.pd_id(401)),(select session from pd_unchanged),'reads leave lesson content and schedule rows unchanged');
select is((select jsonb_agg(to_jsonb(e) order by id) from public.academic_events e where school_id in(pg_temp.pd_id(501),pg_temp.pd_id(502))),(select events from pd_unchanged),'reads leave academic events unchanged');
select is((select count(*) from dashboard_private.notification_events),(select notifications from pd_unchanged),'reads create no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from pd_unchanged),'reads create no deliveries');
select is((select count(*) from public.student_class_enrollment_history),(select enrollments from pd_unchanged),'reads create no student enrollment history');

-- A version changes only with visible scheduling/calendar data, never private
-- learning notes, price, capacity, content or source snapshots.
update public.classes set fee=54321,capacity=19,schedule_plan='{"sessions":[],"privateNote":"PRIVATE_CHANGED"}' where id=pg_temp.pd_id(201);
update public.class_lesson_sessions set memo='PRIVATE_CHANGED',teacher_note='PRIVATE_CHANGED' where id=pg_temp.pd_id(401);
set local role service_role;
select is(pg_temp.pd_class()#>>'{data,context,version}',(select v#>>'{data,context,version}' from pd_evidence where k='class'),'private class edits cannot leak through visible version hash');
reset role;
update public.class_lesson_sessions set schedule_state='exception' where id=pg_temp.pd_id(401);
set local role service_role;
select isnt(pg_temp.pd_class()#>>'{data,context,version}',(select v#>>'{data,context,version}' from pd_evidence where k='class'),'safe scheduling change changes visible version');
reset role;
update public.academic_events set note='PRIVATE_CHANGED',content='PRIVATE_CHANGED' where id=pg_temp.pd_id(601);
set local role service_role;
select is(pg_temp.pd_calendar()#>>'{data,context,version}',(select v#>>'{data,context,version}' from pd_evidence where k='calendar'),'private event edits cannot leak through calendar version');
reset role;
update public.academic_events set title='Synthetic visible title change' where id=pg_temp.pd_id(601);
set local role service_role;
select isnt(pg_temp.pd_calendar()#>>'{data,context,version}',(select v#>>'{data,context,version}' from pd_evidence where k='calendar'),'safe public event change changes visible version');
reset role;

-- Every retry authenticates current owner/issuer and row authority again. The
-- previous successful response supplies no durable permission receipt.
update public.profiles set role='viewer' where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_forbidden','retry denies owner role loss');
select throws_ok($q$select pg_temp.pd_read(701,'schools')$q$,'42501','agent_forbidden','owner role loss also blocks school enumeration');
reset role;
update public.profiles set role='admin' where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($q$select pg_temp.pd_calendar()$q$,'42501','agent_forbidden','promotion to admin does not enlarge teacher credential authority');
reset role;
update public.profiles set role='teacher' where id=pg_temp.pd_id(2);
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_forbidden','retry denies current owner ban');
select throws_ok($q$select pg_temp.pd_calendar()$q$,'42501','agent_forbidden','owner ban blocks calendar data as well');
reset role;
update auth.users set banned_until=null,deleted_at=clock_timestamp() where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_forbidden','retry denies current owner auth deletion');
reset role;
update auth.users set deleted_at=null where id=pg_temp.pd_id(2);
update public.profiles set teacher_catalog_id=null where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_scope_forbidden','missing reciprocal teacher catalog link cannot read class');
reset role;
update public.profiles set teacher_catalog_id=pg_temp.pd_id(101) where id=pg_temp.pd_id(2);
update public.teacher_catalogs set profile_id=null where id=pg_temp.pd_id(101);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_scope_forbidden','one-sided profile catalog pointer cannot grant class authority');
reset role;
update public.teacher_catalogs set profile_id=pg_temp.pd_id(2) where id=pg_temp.pd_id(101);
update public.profiles set name='Synthetic renamed owner' where id=pg_temp.pd_id(2);
update public.teacher_catalogs set name='Synthetic renamed owner teacher',is_visible=false where id=pg_temp.pd_id(101);
set local role service_role;
select is(pg_temp.pd_class()#>>'{data,authorization,ownerProfileId}',pg_temp.pd_id(2)::text,'display rename and catalog visibility never rebind owner identity');
reset role;
update public.profiles set role='teacher' where id=pg_temp.pd_id(1);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_forbidden','current issuer admin loss is a fail-closed additional bound');
reset role;
update public.profiles set role='admin' where id=pg_temp.pd_id(1);
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=pg_temp.pd_id(1);
set local role service_role;
select throws_ok($q$select pg_temp.pd_calendar()$q$,'42501','agent_forbidden','current issuer ban blocks a retry');
reset role;
update auth.users set banned_until=null,deleted_at=clock_timestamp() where id=pg_temp.pd_id(1);
set local role service_role;
select throws_ok($q$select pg_temp.pd_read(701,'schools')$q$,'42501','agent_forbidden','current issuer deletion blocks enumeration');
reset role;
update auth.users set deleted_at=null where id=pg_temp.pd_id(1);

update public.class_schedule_slots set teacher_catalog_id=pg_temp.pd_id(102) where id=pg_temp.pd_id(301);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_scope_forbidden','retry after UUID reassignment denies historical teacher');
reset role;
select is((select teacher_catalog_id from public.class_lesson_sessions where id=pg_temp.pd_id(401)),pg_temp.pd_id(101),'retained dated session proves history is not current assignment authority');
update public.class_schedule_slots set teacher_catalog_id=pg_temp.pd_id(101) where id=pg_temp.pd_id(301);
update public.classes set status='개강 준비' where id=pg_temp.pd_id(201);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_class_not_active','preparing class is unsupported initial personal scope');
reset role;
-- Only this synthetic lifecycle fixture uses the canonical close context.
-- Restore its prior value before testing service-role reads; no guard is changed.
set local role postgres;
do $pd_close_fixture$
declare previous_context text:=coalesce(current_setting('app.class_close_mutation',true),'');
begin
 perform set_config('app.class_close_mutation','v1',true);
 update public.classes set status='수강',closed_at=clock_timestamp() where id=pg_temp.pd_id(201);
 perform set_config('app.class_close_mutation',previous_context,true);
end
$pd_close_fixture$;
reset role;
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_class_not_active','closed class remains denied despite UUID assignment');
reset role;
-- Only this synthetic lifecycle fixture uses the canonical close context.
-- Restore its prior value before testing service-role reads; no guard is changed.
set local role postgres;
do $pd_close_fixture$
declare previous_context text:=coalesce(current_setting('app.class_close_mutation',true),'');
begin
 perform set_config('app.class_close_mutation','v1',true);
 update public.classes set closed_at=null,status='종강' where id=pg_temp.pd_id(201);
 perform set_config('app.class_close_mutation',previous_context,true);
end
$pd_close_fixture$;
reset role;
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_class_not_active','completed class remains denied without closed timestamp');
reset role;
-- Only this synthetic lifecycle fixture uses the canonical close context.
-- Restore its prior value before testing service-role reads; no guard is changed.
set local role postgres;
do $pd_close_fixture$
declare previous_context text:=coalesce(current_setting('app.class_close_mutation',true),'');
begin
 perform set_config('app.class_close_mutation','v1',true);
 update public.classes set status='수강' where id=pg_temp.pd_id(201);
 perform set_config('app.class_close_mutation',previous_context,true);
end
$pd_close_fixture$;
reset role;
update public.class_schedule_slots set start_time='09:00:01' where id=pg_temp.pd_id(301);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_scope_forbidden','unsupported seconds are denied rather than silently rounded');
reset role;
update public.class_schedule_slots set start_time='09:00' where id=pg_temp.pd_id(301);
delete from public.class_schedule_slots where id=pg_temp.pd_id(301);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class()$q$,'42501','agent_scope_forbidden','deleting the current own slot invalidates retry despite retained history');
reset role;
update dashboard_private.agent_personal_dashboard_credentials set revoked_at=clock_timestamp() where id=pg_temp.pd_id(701);
set local role service_role;
select throws_ok($q$select pg_temp.pd_calendar()$q$,'28000','agent_unauthorized','revoked key cannot recover cached context');
reset role;
-- The quota fixture has no class assignment left: exact rate error demonstrates
-- quota check occurs before a domain existence/assignment read, without hooks.
update dashboard_private.agent_personal_dashboard_credentials set rate_window=date_trunc('minute',clock_timestamp()),rate_count=60 where id=pg_temp.pd_id(702);
set local role service_role;
select throws_ok($q$select pg_temp.pd_class(201,702)$q$,'54000','agent_rate_limited','exhausted minute budget is denied before domain projection');
reset role;
select is((select rate_count from dashboard_private.agent_personal_dashboard_credentials where id=pg_temp.pd_id(702)),60::bigint,'failed rate-limited read does not increment successful-use count');
update dashboard_private.agent_personal_dashboard_credentials set rate_window=date_trunc('minute',clock_timestamp())-interval '1 minute',rate_count=60 where id=pg_temp.pd_id(703);
set local role service_role;
select lives_ok($q$select pg_temp.pd_calendar(501,703)$q$,'old minute quota resets on a fresh authorized read');
reset role;
select is((select rate_count from dashboard_private.agent_personal_dashboard_credentials where id=pg_temp.pd_id(703)),1::bigint,'successful new-window read is accounted exactly once');
select is((select count(*) from dashboard_private.agent_credentials),(select central_keys from pd_unchanged),'no central key is copied/reclassified or minted');
select is((select count(*) from dashboard_private.ai_agent_credentials),(select inbox_keys from pd_unchanged),'no inbox key is expanded into business read authority');
select is(pg_get_functiondef('public.agent_api_v2(text,text,jsonb)'::regprocedure),(select central_definition from pd_unchanged),'central class API definition remains unchanged');
select is(pg_get_functiondef('public.agent_calendar_api_v1(text,text,jsonb)'::regprocedure),(select calendar_definition from pd_unchanged),'central calendar API definition remains unchanged');
-- Authorized local harness may privately consume these three safe real-producer
-- snapshots. They contain no digest/token/credential grant, only synthetic IDs.
select 'AGENT_PERSONAL_DASHBOARD_READ_CAPTURE:'||jsonb_build_object('class',(select v from pd_evidence where k='class'),'calendar',(select v from pd_evidence where k='calendar'),'schools',(select v from pd_evidence where k='schools'))::text;
select * from finish();
rollback;
