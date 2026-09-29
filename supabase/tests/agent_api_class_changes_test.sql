begin;
select no_plan();
-- Real JS compiler output; asserted against the producer by agent-class-edit.test.mjs.
create temp table compiler_fixture(v jsonb);
insert into compiler_fixture values ('{"plan":{"version":2,"subject":"영어","className":"Synthetic","selectedDays":[1],"globalSessionCount":4,"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2099-10-01","endDate":"2099-10-31","totalSessions":0,"color":"#216e4e"}],"sessionStates":{},"sessionSchedules":{},"textbooks":[],"sessions":[{"id":"ab290000-0000-4000-8000-000000000100","sessionKey":"ab290000-0000-4000-8000-000000000100","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":1,"date":"2099-10-05","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_0","teacherNote":"SECRET_TEACHER_0","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000101","sessionKey":"ab290000-0000-4000-8000-000000000101","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":2,"date":"2099-10-12","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_1","teacherNote":"SECRET_TEACHER_1","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000102","sessionKey":"ab290000-0000-4000-8000-000000000102","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":3,"date":"2099-10-19","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_2","teacherNote":"SECRET_TEACHER_2","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000103","sessionKey":"ab290000-0000-4000-8000-000000000103","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":4,"date":"2099-10-26","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_3","teacherNote":"SECRET_TEACHER_3","textbookEntries":[],"customField":"KEEP_CUSTOM"}],"history":[{"private":"SECRET_HISTORY"}],"generatedAt":"2099-01-01T00:00:00Z","privateNote":"SECRET_ROOT"},"command":{"reason":"synthetic test","window":{"from":"2099-10-01","to":"2099-10-31"},"requiredScopes":["class-details:read","class-info:write","lesson-plan:write"],"patch":{"name":"Changed by agent","schedule_plan":{"version":2,"subject":"영어","className":"Synthetic","selectedDays":[1],"globalSessionCount":4,"billingPeriods":[{"id":"oct","month":10,"label":"10월","startDate":"2099-10-01","endDate":"2099-10-31","totalSessions":0,"color":"#216e4e"}],"sessionStates":{"2099-10-05":{"state":"exception","makeupDate":"2099-10-06"}},"sessionSchedules":{"2099-10-06":{"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ab290000-0000-4000-8000-000000000001","classroomCatalogId":"ab290000-0000-4000-8000-000000000002","teacherName":"T","classroomName":"R"}},"textbooks":[],"sessions":[{"id":"ab290000-0000-4000-8000-000000000100","sessionKey":"ab290000-0000-4000-8000-000000000100","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":null,"date":"2099-10-05","scheduleState":"exception","state":"exception","memo":"","makeupDate":"2099-10-06","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_0","teacherNote":"SECRET_TEACHER_0","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000800","sessionKey":"ab290000-0000-4000-8000-000000000801","date":"2099-10-06","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":1,"scheduleState":"makeup","state":"makeup","makeupDate":"","originalDate":"2099-10-05","isForced":false,"startTime":"10:00","endTime":"11:00","teacherCatalogId":"ab290000-0000-4000-8000-000000000001","classroomCatalogId":"ab290000-0000-4000-8000-000000000002","teacherName":"T","classroomName":"R"},{"id":"ab290000-0000-4000-8000-000000000101","sessionKey":"ab290000-0000-4000-8000-000000000101","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":2,"date":"2099-10-12","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_1","teacherNote":"SECRET_TEACHER_1","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000102","sessionKey":"ab290000-0000-4000-8000-000000000102","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":3,"date":"2099-10-19","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_2","teacherNote":"SECRET_TEACHER_2","textbookEntries":[],"customField":"KEEP_CUSTOM"},{"id":"ab290000-0000-4000-8000-000000000103","sessionKey":"ab290000-0000-4000-8000-000000000103","billingId":"oct","billingLabel":"10월","billingColor":"#216e4e","sessionNumber":4,"date":"2099-10-26","scheduleState":"active","state":"active","memo":"","makeupDate":"","originalDate":"","isForced":false,"progressStatus":"pending","publicNote":"KEEP_3","teacherNote":"SECRET_TEACHER_3","textbookEntries":[],"customField":"KEEP_CUSTOM"}],"history":[{"private":"SECRET_HISTORY"}],"generatedAt":"2099-01-01T00:00:00Z","privateNote":"SECRET_ROOT"}},"changedDates":["2099-10-05","2099-10-06"]},"source":"2099-10-05","target":"2099-10-06"}'::jsonb);
create function pg_temp.eid(n int) returns uuid language sql immutable as $$select ('ab290000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.eid(10),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','agent-edit@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.eid(10),'admin','Synthetic editor') on conflict(id) do update set role=excluded.role;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.eid(1),'T',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.eid(2),'R',array['영어']);
insert into public.classes(id,name,class_type,subject,grade,capacity,fee,status,schedule_storage_mode,teacher,room,schedule,schedule_plan,student_ids) values
(pg_temp.eid(3),'Synthetic','regular','영어','고1',10,100000,'수강','legacy','T','R','월 10:00-11:00',(select v->'plan' from compiler_fixture),'["KEEP_STUDENT"]'),
(pg_temp.eid(30),'Normalized','regular','영어','고1',10,100000,'수강','normalized','T','R','수 10:00-11:00','{}','[]'),
(pg_temp.eid(31),'Other','regular','영어','고1',10,100000,'수강','legacy','T','R','목 10:00-11:00','{}','[]');
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1) on conflict(singleton) do update set version=1;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order) values(pg_temp.eid(4),pg_temp.eid(30),3,'10:00','11:00',pg_temp.eid(1),'T',pg_temp.eid(2),'R',0);
set constraints all immediate;set constraints all deferred;
create temp table ev(k text primary key,v jsonb);
grant all on ev,compiler_fixture to authenticated,service_role;
create temp table no_send as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries,(select count(*) from public.student_class_enrollment_history) enrollments,(select count(*) from public.makeup_request_events) approvals;
select set_config('request.jwt.claim.sub',pg_temp.eid(10)::text,true);
set local role authenticated;
insert into ev values('write',public.create_agent_credential_v1('Muse edit',array['classes:read','class-details:read','class-info:write','weekly-plan:write','lesson-plan:write'],array[pg_temp.eid(3),pg_temp.eid(30)],now()+interval '1 day'));
insert into ev values('read',public.create_agent_credential_v1('Muse read',array['classes:read','class-details:read'],array[pg_temp.eid(3)],now()+interval '1 day'));
insert into ev values('basic',public.create_agent_credential_v1('Muse basic',array['classes:read','class-details:read','class-info:write'],array[pg_temp.eid(3)],now()+interval '1 day'));
insert into ev values('old',public.create_agent_credential_v1('Muse old',array['classes:read','schedule:preview','schedule:write'],array[pg_temp.eid(3)],now()+interval '1 day'));
select throws_ok($q$select public.create_agent_credential_v1('invalid',array['classes:read','lesson-plan:write'],array[pg_temp.eid(3)],now()+interval '1 day')$q$,'22023','agent_invalid','write scope cannot omit detailed read');
select throws_ok($q$select * from dashboard_private.agent_edit_previews$q$,'42501',null,'private snapshots cannot be read by authenticated');
select throws_ok($q$select public.agent_api_v2(repeat('a',64),'health')$q$,'42501',null,'v2 gateway is service-only');
reset role;
create function pg_temp.api2(a text,i jsonb default '{}',label text default 'write') returns jsonb language sql as $$select public.agent_api_v2(encode(sha256(convert_to((select v->>'token' from ev where k=label),'UTF8')),'hex'),a,i)$$;
create function pg_temp.preview_input(cid int,cmd jsonb) returns jsonb language sql as $$select jsonb_build_object('classId',pg_temp.eid(cid),'expectedVersion',pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(cid)))#>>'{data,version}','command',cmd)$$;
create function pg_temp.commit_input(label text,k int) returns jsonb language sql as $$select jsonb_build_object('previewToken',(select v#>>'{data,previewToken}' from ev where ev.k=label),'requestKey',pg_temp.eid(k),'sourceReference','synthetic')$$;
set local role service_role;
select throws_ok($q$select pg_temp.api2('health','{}','old')$q$,'42501','agent_scope_forbidden','v1 key has no implicit v2 authority');
select throws_ok($q$select pg_temp.api2('context',jsonb_build_object('classId',pg_temp.eid(31)))$q$,'42501','agent_scope_forbidden','class boundary enforced');
select is(pg_temp.api2('health')#>>'{data,apiVersion}','2','v2 health verified');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(3,(select v->'command' from compiler_fixture)),'read')$q$,'42501','agent_scope_forbidden','read scope cannot preview writes');
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(3,(select v->'command' from compiler_fixture)),'basic')$q$,'42501','agent_scope_forbidden','basic scope cannot hide a dated edit in a batch');
insert into ev values('legacy',pg_temp.api2('preview',pg_temp.preview_input(3,(select v->'command' from compiler_fixture))));
reset role;
select is((select name from public.classes where id=pg_temp.eid(3)),'Synthetic','preview rolls back metadata');
select is((select schedule_plan from public.classes where id=pg_temp.eid(3)),(select v->'plan' from compiler_fixture),'preview rolls back full plan');
set local role service_role;
insert into ev values('saved',pg_temp.api2('commit',pg_temp.commit_input('legacy',500)));
select is((select v#>>'{data,state}' from ev where k='saved'),'applied','real compiler batch applies');
select is(pg_temp.api2('commit',pg_temp.commit_input('legacy',500))#>>'{data,replayed}','true','same key replays without another business mutation');
select throws_ok($q$select pg_temp.api2('commit',pg_temp.commit_input('legacy',501))$q$,'22023','agent_preview_consumed','preview cannot be consumed with another key');
select is(pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.eid(500)))#>>'{data,state}','applied','receipt recovers lost response');
select is(pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.eid(500)),'read')#>>'{data,state}','unknown','receipt is credential-specific');
select is(pg_temp.api2('operations')#>>'{data,total}','1','bounded operation discovery supported');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.eid(3)),(select v#>'{command,patch,schedule_plan}' from compiler_fixture),'exact plan persisted without private content loss');
select is((select student_ids from public.classes where id=pg_temp.eid(3)),'["KEEP_STUDENT"]'::jsonb,'student history untouched');
select is((select name from public.classes where id=pg_temp.eid(3)),'Changed by agent','metadata applied with same batch');
-- Normalized future cancellation + makeup, with a pre-existing teacher note.
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin,teacher_note) values(pg_temp.eid(50),pg_temp.eid(30),'synthetic',pg_temp.eid(4),'2099-10-07','active','10:00','11:00',pg_temp.eid(1),'T',pg_temp.eid(2),'R','manual','KEEP_PRIVATE_NOTE');
set constraints all immediate;set constraints all deferred;
insert into ev values('normalized-command',jsonb_build_object('reason','synthetic','window',jsonb_build_object('from','2099-10-01','to','2099-10-31'),'changedDates',jsonb_build_array('2099-10-07','2099-10-09'),'patch',jsonb_build_object('capacity',12),'sessions',jsonb_build_array(
jsonb_build_object('id',pg_temp.eid(50),'date','2099-10-07','state','skipped','sourceSlotId',pg_temp.eid(4),'makeupOf',null,'startTime','10:00','endTime','11:00','teacherCatalogId',pg_temp.eid(1),'classroomCatalogId',pg_temp.eid(2)),
jsonb_build_object('id',pg_temp.eid(51),'date','2099-10-09','state','makeup','sourceSlotId',null,'makeupOf',pg_temp.eid(50),'startTime','10:00','endTime','11:00','teacherCatalogId',pg_temp.eid(1),'classroomCatalogId',pg_temp.eid(2)))));
set local role service_role;
insert into ev values('normalized',pg_temp.api2('preview',pg_temp.preview_input(30,(select v from ev where k='normalized-command'))));
select is(pg_temp.api2('commit',pg_temp.commit_input('normalized',502))#>>'{data,state}','applied','normalized linked makeup batch applies');
reset role;
select is((select teacher_note from public.class_lesson_sessions where id=pg_temp.eid(50)),'KEEP_PRIVATE_NOTE','normalized private note preserved');
select is((select makeup_of_session_id from public.class_lesson_sessions where id=pg_temp.eid(51)),pg_temp.eid(50),'makeup is linked to exact source');
select is((select capacity from public.classes where id=pg_temp.eid(30)),12,'same normalized batch changes basics');
-- Competing class changes after preview: exact domain SQLSTATE and full rollback.
set local role service_role;
insert into ev values('race',pg_temp.api2('preview',pg_temp.preview_input(30,jsonb_set(jsonb_set(jsonb_set((select v from ev where k='normalized-command'),'{patch,capacity}','14'),'{sessions,1,startTime}','"12:00"'),'{sessions,1,endTime}','"13:00"'))));
reset role;
update public.classes set schedule='금 12:00-13:00' where id=pg_temp.eid(31);
-- This is free against the currently saved 10:00 makeup, but conflicts with
-- the previewed 12:00 target. The commit must roll back the whole batch.
set constraints all immediate;set constraints all deferred;
set local role service_role;
select is(pg_temp.api2('commit',pg_temp.commit_input('race',503))#>>'{data,error,sqlstate}','23P01','commit rechecks competing weekly resource with exact SQLSTATE');
reset role;
select is((select capacity from public.classes where id=pg_temp.eid(30)),12,'failed commit rolls back metadata as well');
set local role service_role;
select is(pg_temp.api2('operation',jsonb_build_object('requestKey',pg_temp.eid(503)))#>>'{data,state}','failed','atomic failure is durable');
reset role;
-- Stale metadata participates in version checking, not only schedule revision.
update public.classes set schedule='목 10:00-11:00' where id=pg_temp.eid(31);
set constraints all immediate;set constraints all deferred;
set local role service_role;
insert into ev values('stale',pg_temp.api2('preview',pg_temp.preview_input(3,jsonb_build_object('reason','synthetic','window',jsonb_build_object('from','2099-10-01','to','2099-10-31'),'patch',jsonb_build_object('name','Stale attempt')))));
reset role;
update public.classes set capacity=15 where id=pg_temp.eid(3);
set local role service_role;
select is(pg_temp.api2('commit',pg_temp.commit_input('stale',504))#>>'{data,error,code}','agent_stale','basic changes invalidate an old preview');
reset role;
-- Existing approval work owns its transition; an agent cannot bypass it.
insert into public.makeup_requests(id,class_id,subject,approval_group,class_name,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom) values(pg_temp.eid(900),pg_temp.eid(3),'영어','english','Synthetic','2099-10-01','2099-10-02 10:00+09','2099-10-02 11:00+09','R');
set local role service_role;
select throws_ok($q$select pg_temp.api2('preview',pg_temp.preview_input(3,(select v->'command' from compiler_fixture)))$q$,'P0001','agent_approval_workflow_required','pending approval prevents direct plan edits');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.eid(10);
set local role service_role;
select throws_ok($q$select pg_temp.api2('health')$q$,'42501','agent_forbidden','issuer suspension immediately removes v2 authority');
reset role;
update auth.users set banned_until=null where id=pg_temp.eid(10);
update dashboard_private.agent_credentials set rate_window=date_trunc('minute',clock_timestamp()),rate_count=60 where id=(select (v->>'id')::uuid from ev where k='read');
set local role service_role;
select is(pg_temp.api2('health','{}','read')#>>'{error,code}','agent_rate_limited','v2 shares rate limit with v1');
reset role;
update dashboard_private.agent_credentials set revoked_at=now() where id=(select (v->>'id')::uuid from ev where k='write');
set local role service_role;
select throws_ok($q$select pg_temp.api2('health')$q$,'28000','agent_unauthorized','revoked v2 key is rejected');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'no provider deliveries');
select is((select count(*) from public.student_class_enrollment_history),(select enrollments from no_send),'no enrollment history changes');
select is((select count(*) from public.makeup_request_events),(select approvals from no_send),'approval workflow never bypassed');
select * from finish();
rollback;
