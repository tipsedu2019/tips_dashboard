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
create temp table pc_result(name text primary key, input jsonb, result jsonb);grant all on pc_result to authenticated,service_role;
create function pg_temp.pc_issue(n integer,cs uuid[] default array[pg_temp.pd_id(201)],ss uuid[] default array[pg_temp.pd_id(501)]) returns jsonb language sql as $$select jsonb_build_object('requestId',pg_temp.pd_id(n),'label','Synthetic personal connection','expiresAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'classIds',to_jsonb(cs),'schoolIds',to_jsonb(ss),'featureIds',to_jsonb((case when cardinality(cs)>0 then array['class.schedule.read'] else '{}'::text[] end)||(case when cardinality(ss)>0 then array['calendar.schools.read','calendar.events.read'] else '{}'::text[] end)))$$;
select ok(has_function_privilege('authenticated','public.agent_personal_connection_v1(text,jsonb)','execute'),'authenticated can enter guarded RPC');
select ok(not has_function_privilege('anon','public.agent_personal_connection_v1(text,jsonb)','execute'),'anonymous cannot invoke lifecycle');
select ok(not has_function_privilege('service_role','public.agent_personal_connection_v1(text,jsonb)','execute'),'service callback cannot issue');
select ok((select relrowsecurity from pg_class where oid='dashboard_private.agent_personal_connection_operations'::regclass),'operation ledger RLS');
select set_config('request.jwt.claim.sub',pg_temp.pd_id(2)::text,true);
set local role authenticated;
select throws_ok($$select * from dashboard_private.agent_personal_connection_operations$$,'42501',null,'ledger never exposed');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900)||jsonb_build_object('ownerId',pg_temp.pd_id(3)))$$,'22023','personal_connection_invalid','owner injection rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900,'{}','{}'))$$,'22023','personal_connection_invalid','empty grants rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900,array[pg_temp.pd_id(201),pg_temp.pd_id(201)]))$$,'22023','personal_connection_invalid','duplicate grants rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900,array[pg_temp.pd_id(202)]))$$,'42501','personal_connection_target_forbidden','other teacher target rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900,array[pg_temp.pd_id(204)]))$$,'42501','personal_connection_target_forbidden','matching display name does not grant');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900,array(select pg_temp.pd_id(n) from generate_series(1000,1050)n)))$$,'22023','personal_connection_invalid','51 class selection rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900)||'{"expiresAt":"infinity"}')$$,'22023','personal_connection_invalid','infinite expiry rejected');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(900)||'{"requestId":"bad"}')$$,'22023','personal_connection_invalid','invalid request exact SQLSTATE');
insert into pc_result(name,input) values('issued',pg_temp.pc_issue(901));
update pc_result set result=public.agent_personal_connection_v1('issue',input) where name='issued';
select ok((select result->>'secret' ~ '^tips_dashboard_personal_[a-f0-9]{64}$' from pc_result where name='issued'),'first response contains one secret');
select is((select result#>>'{credential,ownerId}' from pc_result where name='issued'),pg_temp.pd_id(2)::text,'actual actor owns issued key');
select is((select public.agent_personal_connection_v1('issue',input)->'secret' from pc_result where name='issued'),'null'::jsonb,'same request never repeats secret');
select throws_ok($$select public.agent_personal_connection_v1('issue',input||'{"label":"changed"}') from pc_result where name='issued'$$,'22023','personal_connection_request_conflict','same ID different intent denied');
select is(public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(901),'kind','issue')))#>>'{operation,state}','applied','lost response resolves applied');
select is(public.agent_personal_connection_v1('snapshot',jsonb_build_object('page',1,'pageSize',10,'pending',jsonb_build_object('requestId',pg_temp.pd_id(902),'kind','issue')))#>>'{operation,state}','failed','absent request closed durably');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(902))$$,'55000','personal_connection_request_closed','delayed original cannot mint after recovery tombstone');
reset role;
select ok((select c.created_by=c.owner_profile_id and c.issuer_kind='self_teacher' and c.token_hash=encode(sha256(convert_to(p.result->>'secret','UTF8')),'hex') from dashboard_private.agent_personal_dashboard_credentials c join pc_result p on c.id=(p.result#>>'{credential,id}')::uuid where p.name='issued'),'only hash stored, immutable self identity');
select throws_ok($$update dashboard_private.agent_personal_dashboard_credentials set issuer_kind='administrator' where id=(select (result#>>'{credential,id}')::uuid from pc_result where name='issued')$$,'55000','agent_personal_identity_immutable','issuer kind cannot be rebound');
set local role service_role;
select lives_ok($$select public.agent_personal_dashboard_read_v1(encode(sha256(convert_to(result->>'secret','UTF8')),'hex'),'class_context',jsonb_build_object('classId',pg_temp.pd_id(201))) from pc_result where name='issued'$$,'self key reads currently assigned class');
select lives_ok($$select public.agent_personal_dashboard_read_v1(encode(sha256(convert_to(result->>'secret','UTF8')),'hex'),'calendar_context',jsonb_build_object('schoolId',pg_temp.pd_id(501),'schoolYear',2099)) from pc_result where name='issued'$$,'self key reads selected school calendar');
select lives_ok($$select public.agent_personal_dashboard_read_v1(encode(sha256(convert_to(result->>'secret','UTF8')),'hex'),'schools','{"page":1}') from pc_result where name='issued'$$,'self key reads selected schools');
reset role;
update public.profiles set role='staff' where id=pg_temp.pd_id(1);
set local role service_role;
select throws_ok($$select pg_temp.pd_class()$$,'42501','agent_forbidden','old administrator-issued key still requires active admin issuer');
reset role;
update public.profiles set role='admin' where id=pg_temp.pd_id(1);
select set_config('request.jwt.claim.sub',pg_temp.pd_id(3)::text,true);
set local role authenticated;
select is(public.agent_personal_connection_v1('snapshot','{"page":1,"pageSize":10}')->>'total','0','foreign owner sees no metadata');
select throws_ok($$select public.agent_personal_connection_v1('revoke',jsonb_build_object('requestId',pg_temp.pd_id(910),'credentialId',result#>>'{credential,id}')) from pc_result where name='issued'$$,'42501','personal_connection_target_forbidden','foreign revoke denied');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.pd_id(2)::text,true);
set local role authenticated;
insert into pc_result(name,input) select 'revoked',jsonb_build_object('requestId',pg_temp.pd_id(911),'credentialId',result#>>'{credential,id}') from pc_result where name='issued';
update pc_result set result=public.agent_personal_connection_v1('revoke',input) where name='revoked';
select ok((select result#>>'{credential,revokedAt}' is not null from pc_result where name='revoked'),'own revoke metadata confirmed');
select is((select public.agent_personal_connection_v1('revoke',input) from pc_result where name='revoked'),(select result from pc_result where name='revoked'),'revoke replay is stable');
reset role;
set local role service_role;
select throws_ok($$select public.agent_personal_dashboard_read_v1(encode(sha256(convert_to(result->>'secret','UTF8')),'hex'),'schools','{}') from pc_result where name='issued'$$,'28000','agent_unauthorized','revoked key immediately rejected');
reset role;
-- More than fifty selectable targets; page count and row set share one statement snapshot.
insert into public.academic_schools(id,name,category) select pg_temp.pd_id(2000+n),'Synthetic paged school '||lpad(n::text,3,'0'),'high' from generate_series(1,61)n;
set local role authenticated;
select is(public.agent_personal_connection_v1('targets','{"kind":"schools","search":"Synthetic paged school","page":6,"pageSize":10}')->>'total','61','catalog total is not limited to fifty');
select is(jsonb_array_length(public.agent_personal_connection_v1('targets','{"kind":"schools","search":"Synthetic paged school","page":6,"pageSize":10}')->'items'),10,'page six includes rows 51 to 60');
select is(public.agent_personal_connection_v1('targets','{"kind":"schools","search":"061","page":1,"pageSize":10}')#>>'{items,0,id}',pg_temp.pd_id(2061)::text,'last target searchable');
select throws_ok($$select public.agent_personal_connection_v1('targets','{"kind":"schools","search":"","page":1,"pageSize":50}')$$,'22023','personal_connection_invalid','invalid page size denied');
select lives_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(950,'{}',array(select pg_temp.pd_id(n) from generate_series(2001,2050)n)))$$,'exact fifty selected schools accepted');
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(951,'{}',array(select pg_temp.pd_id(n) from generate_series(2001,2051)n)))$$,'22023','personal_connection_invalid','fifty-one selected schools rejected');
reset role;
update public.profiles set role='staff' where id=pg_temp.pd_id(2);
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('snapshot','{"page":1,"pageSize":10}')$$,'42501','personal_connection_forbidden','current role removal rejects lifecycle');
reset role;
update public.profiles set role='teacher' where id=pg_temp.pd_id(2);
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=pg_temp.pd_id(2);
set local role authenticated;
select throws_ok($$select public.agent_personal_connection_v1('issue',pg_temp.pc_issue(952))$$,'42501','personal_connection_forbidden','banned owner cannot mint');
reset role;
select * from finish();
rollback;
