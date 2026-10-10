-- Synthetic only. Apply both lifecycle and feature-permissions proposals after the ordered baseline. All changes roll back.
begin;
select no_plan();
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
create temp table fp_result(name text primary key,input jsonb,result jsonb);grant all on fp_result to authenticated,service_role;
create function pg_temp.fp_change(n integer,rev integer,features jsonb) returns jsonb language sql as $$select jsonb_build_object('requestId',pg_temp.pd_id(n),'credentialId',(select result#>>'{credential,id}' from fp_result where name='issued'),'expectedRevision',rev,'featureIds',features)$$;
create function pg_temp.fp_read(a text) returns jsonb language sql as $$select public.agent_personal_dashboard_read_v1(encode(sha256(convert_to(result->>'secret','UTF8')),'hex'),a,case a when 'class_context' then jsonb_build_object('classId',pg_temp.pd_id(201)) when 'calendar_context' then jsonb_build_object('schoolId',pg_temp.pd_id(501),'schoolYear',2099) else '{"page":1}'::jsonb end) from fp_result where name='issued'$$;
select is((select feature_ids from dashboard_private.agent_personal_dashboard_credentials where id=pg_temp.pd_id(701)),'{}'::text[],'new keys never receive implicit features');
select ok(not has_function_privilege('authenticated','dashboard_private.agent_personal_feature_policy_v1()','execute'),'feature policy private');
select set_config('request.jwt.claim.sub',pg_temp.pd_id(2)::text,true);
set local role authenticated;
insert into fp_result(name,input)values('issued',jsonb_build_object('requestId',pg_temp.pd_id(980),'label','Synthetic feature selection','expiresAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'classIds',jsonb_build_array(pg_temp.pd_id(201)),'schoolIds',jsonb_build_array(pg_temp.pd_id(501)),'featureIds',jsonb_build_array('class.schedule.read','calendar.events.read','calendar.schools.read')));
select throws_ok($$select public.agent_personal_connection_v1('issue',input-'featureIds') from fp_result$$,'22023','personal_connection_invalid','old UI cannot accidentally grant all');
select throws_ok($$select public.agent_personal_connection_v1('issue',input||'{"featureIds":["class.commit"]}') from fp_result$$,'22023','personal_connection_invalid','personal write feature rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',input||'{"featureIds":["internal.students"]}') from fp_result$$,'22023','personal_connection_invalid','internal RPC feature rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',input||'{"featureIds":["future.feature"]}') from fp_result$$,'22023','personal_connection_invalid','unknown feature rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',input||'{"featureIds":["class.schedule.read","class.schedule.read"]}') from fp_result$$,'22023','personal_connection_invalid','duplicate feature rejected');
update fp_result set result=public.agent_personal_connection_v1('issue',input) where name='issued';
select is((select result#>>'{credential,featureRevision}' from fp_result where name='issued'),'1','initial explicit grant revision');
select is(public.agent_personal_connection_v1('snapshot','{"page":1,"pageSize":10}')->>'permissionVersion','1','backend declares permission protocol');
reset role;
set local role service_role;
select lives_ok($$select pg_temp.fp_read('schools')$$,'explicit school list works');
select lives_ok($$select pg_temp.fp_read('calendar_context')$$,'explicit calendar read works');
select lives_ok($$select pg_temp.fp_read('class_context')$$,'explicit class read works');
reset role;
set local role authenticated;
insert into fp_result(name,input)values('disable',pg_temp.fp_change(981,1,'["calendar.events.read"]'));
update fp_result set result=public.agent_personal_connection_v1('permissions',input)where name='disable';
select is((select result#>>'{change,revision}'from fp_result where name='disable'),'2','permission update increments version once');
select is((select result#>'{change,afterFeatures}'from fp_result where name='disable'),'["calendar.events.read"]'::jsonb,'audit records selected features');
select is((select jsonb_array_length(result#>'{change,beforeFeatures}')from fp_result where name='disable'),3,'audit records previous grant');
select is((select public.agent_personal_connection_v1('permissions',input)from fp_result where name='disable'),(select result from fp_result where name='disable'),'exact retry returns same receipt');
select throws_ok($$select public.agent_personal_connection_v1('permissions',input||'{"featureIds":[]}') from fp_result where name='disable'$$,'22023','personal_connection_request_conflict','same ID changed permission body rejected');
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(982,1,'[]'))$$,'55000','personal_connection_stale','stale tab cannot overwrite later permissions');
select is(public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(981),'kind','permissions')))#>>'{operation,change,revision}','2','lost update response recovers audit revision');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.fp_read('schools')$$,'42501','agent_scope_forbidden','unchecked school list blocked by actual callback');
select throws_ok($$select pg_temp.fp_read('class_context')$$,'42501','agent_scope_forbidden','unchecked class read blocked by actual callback');
select lives_ok($$select pg_temp.fp_read('calendar_context')$$,'calendar read is independent of school-list permission');
reset role;
select is((select count(*)from dashboard_private.agent_personal_connection_operations where owner_id=pg_temp.pd_id(2)and kind='permissions'),1::bigint,'retry does not duplicate audit');
select set_config('request.jwt.claim.sub',pg_temp.pd_id(3)::text,true);
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(983,2,'[]'))$$,'42501','personal_connection_target_forbidden','foreign owner cannot alter permissions');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.pd_id(2)::text,true);
set local role authenticated;
select is(public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(984),'kind','permissions')))#>>'{operation,state}','failed','absent update is durably closed before recovery');
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(984,2,'[]'))$$,'55000','personal_connection_request_closed','late original cannot alter grants after tombstone');
select lives_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(985,2,'[]'))$$,'all features can be unchecked');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.fp_read('calendar_context')$$,'42501','agent_scope_forbidden','empty feature set denies remaining callback');
reset role;
-- Current dashboard ownership still intersects selected grants.
update public.class_schedule_slots set teacher_catalog_id=pg_temp.pd_id(102) where id=pg_temp.pd_id(301);
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(986,3,'["class.schedule.read"]'))$$,'42501','personal_connection_target_forbidden','lost assignment prevents enabling class feature');
select lives_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(987,3,'["calendar.events.read"]'))$$,'remaining current school scope can be enabled');
select is((select public.agent_personal_connection_v1('permissions',input)#>>'{change,revision}'from fp_result where name='disable'),'2','old retry reports original audit revision after later changes');
select is((select public.agent_personal_connection_v1('permissions',input)#>>'{credential,featureRevision}'from fp_result where name='disable'),'4','old retry returns current metadata without rolling grants back');
reset role;
update public.profiles set role='staff' where id=pg_temp.pd_id(2);
set local role service_role;
select throws_ok($$select pg_temp.fp_read('calendar_context')$$,'42501','agent_forbidden','current dashboard role withdrawal blocks selected feature');
reset role;
update public.profiles set role='teacher' where id=pg_temp.pd_id(2);
set local role authenticated;
select lives_ok($$select public.agent_personal_connection_v1('revoke',pg_temp.fp_change(988,4,'[]')-array['expectedRevision','featureIds'])$$,'whole credential revoke remains available');
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(989,4,'["calendar.events.read"]'))$$,'55000','personal_connection_inactive','permission change cannot revive revoked key');
reset role;

-- Completed mutation quota must not consume the independent recovery budget.
update public.class_schedule_slots set teacher_catalog_id=pg_temp.pd_id(101) where id=pg_temp.pd_id(301);
set local role authenticated;
update fp_result set name='old-issued' where name='issued';
insert into fp_result(name,input)select 'issued',input||jsonb_build_object('requestId',pg_temp.pd_id(990))from fp_result where name='old-issued';
update fp_result set result=public.agent_personal_connection_v1('issue',input)where name='issued';
reset role;
insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,input_hash,state,credential_id)
select pg_temp.pd_id(2),pg_temp.pd_id(9000+n),'permissions',repeat('a',64),'applied',(select (result#>>'{credential,id}')::uuid from fp_result where name='issued')from generate_series(1,100)n;
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('permissions',pg_temp.fp_change(991,1,'[]'))$$,'54000','personal_connection_change_limit','permission quota rejects mutation exactly');
select is(public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(991),'kind','permissions')))#>>'{operation,state}','failed','completed mutation quota still permits recovery tombstone');
reset role;
insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,state)
select pg_temp.pd_id(2),pg_temp.pd_id(9200+n),'permissions','failed'from generate_series(1,100)n;
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(992),'kind','permissions')))$$,'54000','personal_connection_recovery_limit','recovery abuse budget remains bounded');
select is(public.agent_personal_connection_v1('snapshot','{"page":1,"pageSize":10}')->>'status','ready','inventory remains available when both budgets exhausted');
select lives_ok($$select public.agent_personal_connection_v1('revoke',pg_temp.fp_change(993,1,'[]')-array['expectedRevision','featureIds'])$$,'revoke remains available when both budgets exhausted');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.fp_read('calendar_context')$$,'28000','agent_unauthorized','quota-safe revoke blocks actual API callback');
reset role;
select * from finish();
rollback;
