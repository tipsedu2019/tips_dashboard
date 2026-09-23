begin isolation level repeatable read;
select no_plan();
select is(current_setting('transaction_isolation'),'repeatable read','isolation fixture is actually repeatable read');
create temporary table isolation_before as select count(*) n from public.classes;
select lives_ok($q$select dashboard_private.read_timetable_operating_reference_v1()$q$,'repeatable read snapshot reads remain allowed');
set local role authenticated;
select throws_ok($q$select public.save_class_schedule_defaults_v1('ad240000-0000-4000-8000-000000000301',0,'[]','ad240000-0000-4000-8000-000000000999')$q$,'25001','timetable_isolation_not_supported','repeatable read actual public RPC cannot write pinned snapshot');
reset role;
select throws_ok($q$update public.classes set schedule='blocked' where false$q$,'25001','timetable_isolation_not_supported','repeatable read direct bypass cannot write pinned snapshot');
select is((select count(*) from public.classes),(select n from isolation_before),'repeatable read rejected writes preserve rows');
select * from finish();
rollback;
begin isolation level serializable;
select no_plan();
select is(current_setting('transaction_isolation'),'serializable','isolation fixture is actually serializable');
create temporary table isolation_before as select count(*) n from public.classes;
select lives_ok($q$select dashboard_private.read_timetable_operating_reference_v1()$q$,'serializable snapshot reads remain allowed');
set local role authenticated;
select throws_ok($q$select public.save_class_schedule_defaults_v1('ad240000-0000-4000-8000-000000000301',0,'[]','ad240000-0000-4000-8000-000000000999')$q$,'25001','timetable_isolation_not_supported','serializable actual public RPC cannot write pinned snapshot');
reset role;
select throws_ok($q$update public.classes set schedule='blocked' where false$q$,'25001','timetable_isolation_not_supported','serializable direct bypass cannot write pinned snapshot');
select is((select count(*) from public.classes),(select n from isolation_before),'serializable rejected writes preserve rows');
select * from finish();
rollback;
begin;
select no_plan();
update public.classes set textbook_ids='[]' where false;
select ok(not exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'),'unrelated textbook metadata takes no operating lock');
create temporary table no_send_before as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_deliveries) deliveries,(select count(*) from public.student_class_enrollment_history) history;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1) on conflict(singleton) do update set version=1;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ('ad240000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000','authenticated','authenticated','task4@test.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name) values('ad240000-0000-4000-8000-000000000901','admin','운영 검증') on conflict(id) do update set role='admin';
insert into public.teacher_catalogs(id,name,subjects) values ('ad240000-0000-4000-8000-000000000101','운영 A',array['영어','수학']),('ad240000-0000-4000-8000-000000000102','운영 B',array['영어','수학']);
insert into public.classroom_catalogs(id,name,subjects) values ('ad240000-0000-4000-8000-000000000201','운영 1',array['영어','수학']),('ad240000-0000-4000-8000-000000000202','운영 2',array['영어','수학']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
('ad240000-0000-4000-8000-000000000301','영어 운영','영어','수강','normalized','월 09:00-10:00','운영 A','운영 1','{}'),
('ad240000-0000-4000-8000-000000000302','수학 운영','수학','수강','normalized','화 11:00-12:00','운영 B','운영 2','{}'),
('ad240000-0000-4000-8000-000000000303','수학 준비','수학','개강 준비','legacy','월 09:30-10:30','운영 A','운영 2','{}');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name) values
('ad240000-0000-4000-8000-000000000401','ad240000-0000-4000-8000-000000000301',1,'09:00','10:00','ad240000-0000-4000-8000-000000000101','운영 A','ad240000-0000-4000-8000-000000000201','운영 1'),
('ad240000-0000-4000-8000-000000000402','ad240000-0000-4000-8000-000000000302',2,'11:00','12:00','ad240000-0000-4000-8000-000000000102','운영 B','ad240000-0000-4000-8000-000000000202','운영 2');
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','ad240000-0000-4000-8000-000000000901',true);
create function pg_temp.direct_write(q text) returns void language plpgsql as $$begin execute q; set constraints all immediate; set constraints all deferred; end$$;
select throws_ok($q$select pg_temp.direct_write($w$update public.classes set status='수강' where id='ad240000-0000-4000-8000-000000000303'$w$)$q$,'23P01','timetable_resource_conflict','legacy status activation rejects teacher collision across subjects');
select throws_ok($q$select public.save_class_schedule_defaults_v1('ad240000-0000-4000-8000-000000000302',0,'[{"id":"ad240000-0000-4000-8000-000000000402","weekday":1,"startTime":"09:30","endTime":"10:30","teacherCatalogId":"ad240000-0000-4000-8000-000000000102","classroomCatalogId":"ad240000-0000-4000-8000-000000000201","sortOrder":0}]','ad240000-0000-4000-8000-000000000501')$q$,'23P01','timetable_resource_conflict','defaults RPC rejects room-only collision before returning');
select throws_ok($q$select pg_temp.direct_write($w$insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin) values('ad240000-0000-4000-8000-000000000302','conflict','2026-10-05','makeup','09:30','10:30','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000202','manual')$w$)$q$,'23P01','timetable_resource_conflict','direct dated makeup write rejects effective weekly teacher conflict');
select throws_ok($q$select public.initialize_new_class_schedule_v1('ad240000-0000-4000-8000-000000000303',999,'bad','[]','ad240000-0000-4000-8000-000000000502')$q$,'P0001','class_schedule_stale','initialize stale uses domain SQLSTATE');
select throws_ok($q$select public.preview_class_lesson_session_generation_v1('ad240000-0000-4000-8000-000000000301',999,'2026-10-01','2026-10-07')$q$,'P0001','class_schedule_stale','preview stale uses domain SQLSTATE');
select throws_ok($q$select public.generate_class_lesson_sessions_v1('ad240000-0000-4000-8000-000000000301',999,'2026-10-01','2026-10-07','ad240000-0000-4000-8000-000000000503',null)$q$,'P0001','class_schedule_stale','generation stale uses domain SQLSTATE');

-- Remaining final stale producers, with actual calls (not source string checks).
insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin) values('ad240000-0000-4000-8000-000000000601','ad240000-0000-4000-8000-000000000301','authority','ad240000-0000-4000-8000-000000000401','2026-10-05','skipped',null,null,null,null,'default');
set constraints all immediate; set constraints all deferred;
select throws_ok($q$select public.save_class_lesson_session_v1('ad240000-0000-4000-8000-000000000601',999,'skipped','2026-10-05',null,null,null,null,'','','','ad240000-0000-4000-8000-000000000504')$q$,'P0001','class_schedule_stale','session stale uses domain SQLSTATE');
select throws_ok($q$select public.save_class_lesson_content_v1('ad240000-0000-4000-8000-000000000301','bad','{}','ad240000-0000-4000-8000-000000000505')$q$,'P0001','class_schedule_stale','content stale uses domain SQLSTATE');
select throws_ok($q$select public.backfill_class_schedule_shadow_v1('ad240000-0000-4000-8000-000000000303','bad','[]','[]','ad240000-0000-4000-8000-000000000506')$q$,'P0001','class_schedule_stale','backfill stale uses domain SQLSTATE');
update public.classes set schedule_storage_mode='shadow' where id='ad240000-0000-4000-8000-000000000303';
select throws_ok($q$select public.verify_class_schedule_shadow_v1('ad240000-0000-4000-8000-000000000303','bad')$q$,'P0001','class_schedule_stale','verify stale uses domain SQLSTATE');
select throws_ok($q$select public.activate_class_schedule_storage_v1('ad240000-0000-4000-8000-000000000303',999,'bad','ad240000-0000-4000-8000-000000000507')$q$,'P0001','class_schedule_stale','activate stale uses domain SQLSTATE');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2026-10-05') x where x->>'classId'='ad240000-0000-4000-8000-000000000301'),0,'skipped source-slot/date replaces weekly default with no reservation');
select lives_ok($q$select pg_temp.direct_write($w$insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin) values('ad240000-0000-4000-8000-000000000602','ad240000-0000-4000-8000-000000000302','safe-skipped','2026-10-05','makeup','09:30','10:00','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000202','manual')$w$)$q$,'actual makeup can use a date released by skipped authoritative session');
select throws_ok($q$select pg_temp.direct_write($w$delete from public.class_lesson_sessions where id='ad240000-0000-4000-8000-000000000601'$w$)$q$,'23P01','timetable_resource_conflict','removing skipped override cannot expose a conflicting default');
select throws_ok($q$select public.save_class_lesson_session_v1('ad240000-0000-4000-8000-000000000601',0,'active','2026-10-05','09:00','10:00','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000201','','','','ad240000-0000-4000-8000-000000000508')$q$,'23P01','timetable_resource_conflict','session RPC restoration rejects actual dated occupancy before returning');
select lives_ok($q$select public.save_class_lesson_session_v1('ad240000-0000-4000-8000-000000000601',0,'exception','2026-10-05','08:00','09:00','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000201','','','','ad240000-0000-4000-8000-000000000509')$q$,'exception session uses exact half-open safe interval');
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2026-10-05') x where x->>'classId'='ad240000-0000-4000-8000-000000000301'),1,'actual exception replaces weekly source reservation once');
set constraints all immediate; set constraints all deferred;
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule":"금 15:00-16:00","teacher":"운영 B","room":"운영 2","status":"수강"}','ad240000-0000-4000-8000-000000000510')$q$,'gateway updates legacy defaults and status atomically');
select throws_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule_plan":{"sessions":[{"id":"l1","date":"2026-10-06","startTime":"11:30","endTime":"12:30","teacherName":"운영 B","classroomName":"운영 1"}]}}','ad240000-0000-4000-8000-000000000511','{}')$q$,'23P01','timetable_resource_conflict','legacy schedule_plan gateway checks dated teacher collision');
select throws_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule_plan":{"sessions":[]}}','ad240000-0000-4000-8000-000000000512','{"changed":true}')$q$,'P0001','class_schedule_stale','legacy gateway detects stale source JSON');
select throws_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule":"판독 불가"}','ad240000-0000-4000-8000-000000000513')$q$,'23P01','timetable_resource_conflict','new unresolved active legacy occupancy fails closed');
select throws_ok($q$select public.save_class_schedule_defaults_v1('ad240000-0000-4000-8000-000000000301',0,'[{"id":"ad240000-0000-4000-8000-000000000401","weekday":1,"startTime":"09:00","endTime":"10:00","teacherCatalogId":null,"classroomCatalogId":null,"sortOrder":0}]','ad240000-0000-4000-8000-000000000514')$q$,'23P01','timetable_resource_conflict','active normalized defaults cannot introduce unresolved resources');
set constraints all immediate; set constraints all deferred;
-- Seed an explicitly pre-existing conflicting pair, then seal fixture baseline.
update public.class_schedule_slots set weekday=1,start_time='09:30',end_time='10:30',teacher_catalog_id='ad240000-0000-4000-8000-000000000101' where id='ad240000-0000-4000-8000-000000000402';
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1();
set constraints all immediate; set constraints all deferred;
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000302','{"name":"수학 이름 수정"}','ad240000-0000-4000-8000-000000000515')$q$,'existing conflict permits metadata-only edit');
select throws_ok($q$select pg_temp.direct_write($w$update public.class_schedule_slots set start_time='09:45' where id='ad240000-0000-4000-8000-000000000402'$w$)$q$,'23P01','timetable_resource_conflict','same conflict pair with changed overlapping coordinates is rejected');
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule":"금 16:00-17:00"}','ad240000-0000-4000-8000-000000000516')$q$,'unrelated safe occupancy edit preserves existing conflict');
select lives_ok($q$select pg_temp.direct_write($w$update public.class_schedule_slots set start_time='10:00',end_time='11:00' where id='ad240000-0000-4000-8000-000000000402'$w$)$q$,'existing overlap can be repaired to adjacent safe time');
select is((select count(*)::int from dashboard_private.timetable_operating_write_baselines),0,'deferred flush cleans baseline after multiple RPCs');
select lives_ok($q$select pg_temp.direct_write($w$update public.classes set schedule='irrelevant' where false$w$)$q$,'zero-row guarded statement is harmless');
select is((select count(*)::int from dashboard_private.timetable_operating_write_baselines),0,'zero-row statement baseline is cleaned');
set constraints all immediate;
select lives_ok($q$update public.classes set schedule='금 17:00-18:00' where id='ad240000-0000-4000-8000-000000000303'$q$,'immediate constraints support safe subsequent statement');
select throws_ok($q$update public.classes set schedule='월 09:30-10:30',teacher='운영 A' where id='ad240000-0000-4000-8000-000000000303'$q$,'23P01','timetable_resource_conflict','immediate constraints still guard subsequent conflicting statement');
select is((select count(*)::int from dashboard_private.timetable_operating_write_baselines),0,'rejected statement rollback leaves no baseline');
set constraints all deferred;
set local role authenticated;
select is(public.get_timetable_operational_reference_v1()->>'datedComplete','true','authenticated authorized reference includes complete dated contract');
select ok((public.get_timetable_operational_reference_v1()#>>'{shadowSlots,0,id}') like 'live:%','shadow identity is class and source slot based');
select throws_ok($q$select * from dashboard_private.timetable_operating_write_baselines$q$,'42501',null,'authenticated cannot read or forge guard baseline');
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"name":"인증 저장"}','ad240000-0000-4000-8000-000000000517')$q$,'gateway works as actual authenticated role');
reset role;
set local role anon;
select throws_ok($q$select public.get_timetable_operational_reference_v1()$q$,'42501',null,'anon cannot read operating reference');
select throws_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{}','ad240000-0000-4000-8000-000000000518')$q$,'42501',null,'anon cannot mutate operating gateway');
reset role;


-- Generation from preparing classes is still real dated occupancy.
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) values('ad240000-0000-4000-8000-000000000304','준비 생성','영어','개강 준비','normalized','{}');
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id) values('ad240000-0000-4000-8000-000000000404','ad240000-0000-4000-8000-000000000304',1,'09:30','10:30','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000202');
set constraints all immediate;set constraints all deferred;
select throws_ok($q$select public.generate_class_lesson_sessions_v1('ad240000-0000-4000-8000-000000000304',0,'2026-10-12','2026-10-12','ad240000-0000-4000-8000-000000000519')$q$,'23P01','timetable_resource_conflict','generation under preparing class checks actual dated occupancy');
update public.class_schedule_slots set start_time='12:00',end_time='13:00' where id='ad240000-0000-4000-8000-000000000404';
select lives_ok($q$select public.generate_class_lesson_sessions_v1('ad240000-0000-4000-8000-000000000304',0,'2026-10-12','2026-10-12','ad240000-0000-4000-8000-000000000520')$q$,'safe generation retains existing projection and receipt behavior');
select is((select count(*)::int from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304'),1,'failed generation rolled back all inserted sessions');
-- Dated closed-class sessions remain authoritative.
select set_config('app.class_close_mutation','v1',true);
update public.classes set status='종강' where id='ad240000-0000-4000-8000-000000000302';
set constraints all immediate;set constraints all deferred;
select is((select count(*)::int from dashboard_private.timetable_effective_date_v1(dashboard_private.read_timetable_operating_reference_v1(),'2026-10-05') x where x->>'classId'='ad240000-0000-4000-8000-000000000302'),1,'closed class retains valid actual makeup occupancy');
-- Target-period plan placement and the server snapshot use the same authority.
select public.mutate_timetable_plan_v1('{"operation":"create","planId":"ad240000-0000-4000-8000-000000000701","name":"기간 계획","targetStartDate":"2026-10-05","targetEndDate":"2026-10-05","requestKey":"period-plan"}');
create function pg_temp.plan_cmd(n int,a int,b int) returns jsonb language sql as $f$
select jsonb_build_object('operation','save','planId','ad240000-0000-4000-8000-000000000701','expectedMetaRevision',0,'expectedShadowFingerprint',public.get_timetable_plan_revision_v1('ad240000-0000-4000-8000-000000000701')->>'shadowFingerprint','expectedItemRevision',null,'requestKey','period-'||n,'item',jsonb_build_object('id',('ad240000-0000-4000-8000-'||lpad(n::text,12,'0')),'planId','ad240000-0000-4000-8000-000000000701','name','날짜 초안','subject','영어','subjectAreaKey',null,'grade','중2','capacity',12,'tuition',100,'defaultTeacherId','ad240000-0000-4000-8000-000000000101','defaultClassroomId','ad240000-0000-4000-8000-000000000201','durationMinutes',b-a,'pendingSlots','[]'::jsonb),'slots',jsonb_build_array(jsonb_build_object('id',('ad240000-0000-4000-8000-'||lpad((n+100)::text,12,'0')),'itemId',('ad240000-0000-4000-8000-'||lpad(n::text,12,'0')),'planId','ad240000-0000-4000-8000-000000000701','weekday',1,'startMinute',a,'endMinute',b,'teacherId','ad240000-0000-4000-8000-000000000101','classroomId','ad240000-0000-4000-8000-000000000201','sourceSlotId',null)))
$f$;
set local role authenticated;
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.plan_cmd(711,540,560))$q$,'23P01','timetable_resource_conflict','bounded recurring plan still reserves weekly default after dated session moved');
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.plan_cmd(714,1020,1040))$q$,'period plan saves safe weekly and dated position');
select throws_ok($q$select public.mutate_timetable_plan_v1('{"operation":"rename","planId":"ad240000-0000-4000-8000-000000000701","expectedMetaRevision":0,"name":"기간","targetStartDate":"2026-10-05","requestKey":"half-period"}')$q$,'22023','timetable_invalid','half-specified target period is rejected');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.plan_cmd(712,510,530))$q$,'23P01','timetable_resource_conflict','bounded plan detects dated exception outside weekly default');
select throws_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.plan_cmd(713,570,590))$q$,'23P01','timetable_resource_conflict','bounded plan detects actual makeup under closed class');
reset role;
-- Future drafts never reserve operating resources.
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule":"월 17:00-17:20","teacher":"운영 A","room":"운영 1"}','ad240000-0000-4000-8000-000000000521')$q$,'safe operating update ignores future plan draft occupancy');
-- Normalized makeup adapter resolves only a unique exact room name and uses KST.
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,class_id,class_name,request_kind,original_lesson_session_id,original_lesson_session_revision,makeup_slots)
select 'ad240000-0000-4000-8000-000000000801','approval_pending','영어','english','ad240000-0000-4000-8000-000000000901','ad240000-0000-4000-8000-000000000304','준비 생성','makeup_only',id,revision,'[{"startAt":"2026-10-12T09:30:00+09:00","endAt":"2026-10-12T10:00:00+09:00","classroom":"운영 2"}]' from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304';
create function pg_temp.apply_makeup() returns void language plpgsql as $f$begin perform dashboard_private.apply_normalized_makeup_effect_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000304','[]');set constraints all immediate;set constraints all deferred;end$f$;
select throws_ok($q$select pg_temp.apply_makeup()$q$,'23P01','timetable_resource_conflict','normalized makeup adapter conflicts at correct KST time');
update public.makeup_requests set makeup_slots='[{"startAt":"2026-10-12T14:00:00+09:00","endAt":"2026-10-12T15:00:00+09:00","classroom":"unknown"}]' where id='ad240000-0000-4000-8000-000000000801';
select throws_ok($q$select pg_temp.apply_makeup()$q$,'23P01','timetable_resource_conflict','normalized makeup adapter rejects unresolved room instead of guessing');
update public.makeup_requests set makeup_slots='[{"startAt":"2026-10-12T14:00:00+09:00","endAt":"2026-10-12T15:00:00+09:00","classroom":"운영 2"}]' where id='ad240000-0000-4000-8000-000000000801';
select lives_ok($q$select pg_temp.apply_makeup()$q$,'normalized makeup adapter accepts unique exact room');
select is((select classroom_catalog_id from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304' and schedule_state='makeup'),'ad240000-0000-4000-8000-000000000202'::uuid,'makeup stores exact stable room ID');
select is((select start_time from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304' and schedule_state='makeup'),'14:00'::time,'makeup KST start preserved independently of DB timezone');
select lives_ok($q$select pg_temp.direct_write($w$select dashboard_private.revert_normalized_makeup_effect_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000304')$w$)$q$,'normalized revert remains guarded and restores original active session');
select is((select count(*)::int from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304'),1,'makeup revert preserves original session history identity');

set local timezone='UTC';
update public.makeup_requests set original_lesson_session_revision=(select revision from public.class_lesson_sessions where id=original_lesson_session_id),makeup_slots='[{"startAt":"2026-10-13T00:30:00+09:00","endAt":"2026-10-13T01:00:00+09:00","classroom":"운영 2"}]' where id='ad240000-0000-4000-8000-000000000801';
select lives_ok($q$select pg_temp.apply_makeup()$q$,'early KST makeup works when UTC instant is previous date');
select is((select session_date from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304' and schedule_state='makeup'),'2026-10-13'::date,'early KST session keeps local date');
select pg_temp.direct_write($w$select dashboard_private.revert_normalized_makeup_effect_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000304')$w$);
update public.makeup_requests set original_lesson_session_revision=(select revision from public.class_lesson_sessions where id=original_lesson_session_id),makeup_slots='[{"startAt":"2026-10-13T23:30:00+09:00","endAt":"2026-10-14T00:00:00+09:00","classroom":"운영 2"}]' where id='ad240000-0000-4000-8000-000000000801';
select lives_ok($q$select pg_temp.apply_makeup()$q$,'KST 23:30 to next midnight is represented on start date');
select is((select end_time from public.class_lesson_sessions where class_id='ad240000-0000-4000-8000-000000000304' and schedule_state='makeup'),'24:00'::time,'midnight endpoint remains legal 1440 minutes');
select pg_temp.direct_write($w$select dashboard_private.revert_normalized_makeup_effect_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000304')$w$);
update public.makeup_requests set original_lesson_session_revision=(select revision from public.class_lesson_sessions where id=original_lesson_session_id),makeup_slots='[{"startAt":"2026-10-13T23:30:00+09:00","endAt":"2026-10-14T00:30:00+09:00","classroom":"운영 2"}]' where id='ad240000-0000-4000-8000-000000000801';
select throws_ok($q$select pg_temp.apply_makeup()$q$,'22023','class_schedule_validation','cross-midnight interior requires separate slots');
-- Legacy calendar effects follow the same final-state guard.
create function pg_temp.legacy_effect(p_date text) returns void language plpgsql as $f$
begin
 perform dashboard_private.notification_apply_makeup_calendar_effects_legacy_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000303','{}',jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','legacy-effect','date',p_date,'scheduleState','makeup','startTime','09:30','endTime','10:00','teacherName','운영 A','classroomName','운영 1'))),'ad240000-0000-4000-8000-000000000851',null,'[]',jsonb_build_array(jsonb_build_object('id','ad240000-0000-4000-8000-000000000851','title','fixture','date',p_date,'type','팁스','grade','all','note','[[TIPS_MAKEUP]] ad240000-0000-4000-8000-000000000801')));
 set constraints all immediate;set constraints all deferred;
end $f$;
select throws_ok($q$select pg_temp.legacy_effect('2026-10-12')$q$,'23P01','timetable_resource_conflict','legacy makeup effect cannot bypass teacher collision');
select is((select count(*)::int from public.academic_events where id='ad240000-0000-4000-8000-000000000851'),0,'failed legacy effect rolls calendar event back too');
select lives_ok($q$select pg_temp.legacy_effect('2026-10-13')$q$,'legacy safe dated effect remains supported');
select lives_ok($q$select pg_temp.direct_write($w$select dashboard_private.notification_revert_makeup_calendar_effects_legacy_v1('ad240000-0000-4000-8000-000000000801','ad240000-0000-4000-8000-000000000303','{}',(select schedule_plan from public.classes where id='ad240000-0000-4000-8000-000000000303'),'ad240000-0000-4000-8000-000000000851',null,'[]')$w$)$q$,'legacy revert restores original and guarded calendar state');
-- Content projection needs global-before-class ordering, but produces no changed occupancy signal.
create temporary table content_signal_before as select change_sequence from public.timetable_invalidation_signals where id='operating';
select lives_ok($q$select public.save_class_lesson_content_v1('ad240000-0000-4000-8000-000000000301',(select dashboard_private.continuous_class_schedule_content_hash_v1(schedule_plan) from public.classes where id='ad240000-0000-4000-8000-000000000301'),'{"textbooks":[]}','ad240000-0000-4000-8000-000000000522')$q$,'content-only mixed projection keeps existing contract');
set constraints all immediate;set constraints all deferred;
select is((select change_sequence from public.timetable_invalidation_signals where id='operating'),(select change_sequence from content_signal_before),'content-only projection emits no operating change signal');
create temporary table catalog_signal_before as select change_sequence from public.timetable_invalidation_signals where id='operating';
update public.classroom_catalogs set is_visible=false where id='ad240000-0000-4000-8000-000000000202';
set constraints all immediate;set constraints all deferred;
select ok((select change_sequence from public.timetable_invalidation_signals where id='operating')>(select change_sequence from catalog_signal_before),'resource catalog changes emit sanitized operating invalidation');
select is((select count(*)::int from dashboard_private.timetable_operating_write_baselines),0,'all final guard baselines cleaned');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send_before),'schedule guards do not create notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send_before),'schedule guards do not enqueue deliveries');
select is((select count(*) from public.student_class_enrollment_history),(select history from no_send_before),'schedule guards preserve student enrollment history');

select throws_ok($q$select pg_temp.direct_write($w$insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin) values('ad240000-0000-4000-8000-000000000301','source-less','2026-10-19','active','09:00','10:00','ad240000-0000-4000-8000-000000000101','ad240000-0000-4000-8000-000000000201','legacy')$w$)$q$,'23P01','timetable_resource_conflict','source-less identical session is not silently deduplicated by time');
set local role authenticated;
select throws_ok($q$select pg_temp.direct_write($w$select public.create_class_with_group_memberships_v1('{"id":"ad240000-0000-4000-8000-000000000306","name":"생성 충돌","subject":"영어","grade":"중1","status":"수강","schedule":"월 09:30-10:00","teacher":"운영 A","room":"운영 1"}','{}')$w$)$q$,'23P01','timetable_resource_conflict','actual authenticated create gateway cannot commit conflicting legacy occupancy');
reset role;
-- Explicit synthetic pre-existing ambiguous dated data, not a newly admitted write.
insert into public.classes(id,name,subject,status,schedule_plan) values('ad240000-0000-4000-8000-000000000305','기존 미해결','영어','개강 준비','{"sessions":[{"id":"unresolved","date":"not-a-date","startTime":"09:00"}]}');
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1();
set constraints all immediate;set constraints all deferred;
select is(public.get_timetable_plan_v1('ad240000-0000-4000-8000-000000000701')->>'complete','false','bounded plan never reports complete on unresolved dated data');
select is(public.get_timetable_plan_revision_v1('ad240000-0000-4000-8000-000000000701')->>'complete','false','revision poll agrees with bounded snapshot completeness');
select throws_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000303','{"schedule":"금 20:00-21:00"}','ad240000-0000-4000-8000-000000000523')$q$,'23P01','timetable_resource_conflict','unscoped legacy dated blocker prevents new weekly placement');
select lives_ok($q$select public.update_class_operational_v1('ad240000-0000-4000-8000-000000000305','{"name":"미해결 이름 변경"}','ad240000-0000-4000-8000-000000000524')$q$,'existing unresolved data allows metadata-only edit');
select * from finish();
rollback;
