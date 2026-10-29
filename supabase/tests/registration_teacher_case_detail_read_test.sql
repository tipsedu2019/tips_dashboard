-- Synthetic, rollback-only isolated schema test. Never run against an operating
-- database. No provider, dispatch, worker, booking or preview RPC is invoked.
begin;
select no_plan();
set local timezone='UTC';
set local statement_timeout='60s';
set local lock_timeout='5s';
do $$begin
 if exists(select 1 from public.ops_tasks)
  or exists(select 1 from public.ops_registration_customer_messages)
  or exists(select 1 from public.ops_registration_customer_message_previews)
  or exists(select 1 from dashboard_private.registration_customer_solapi_template_receipts)
  or exists(select 1 from dashboard_private.registration_customer_solapi_activation where mode<>'off') then
  raise exception 'registration_teacher_test_requires_empty_isolated_baseline' using errcode='55000';
 end if;
end $$;
create function pg_temp.t219(n integer) returns uuid language sql immutable as $$
 select ('f2190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.actor219(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.t219(n)::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.t219(n),'role','authenticated','user_metadata',jsonb_build_object('role','teacher'))::text,true);
end $$;
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.t219(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','case219-'||n||'@synthetic.invalid' from generate_series(1,8)n;
insert into public.profiles(id,role,name,email)
select pg_temp.t219(n),case n when 1 then 'admin' when 2 then 'staff' when 5 then 'viewer' when 6 then 'assistant' else 'teacher' end,
 '합성 담당자 '||n,'FORBIDDEN_ACCOUNT_'||n||'@synthetic.invalid' from generate_series(1,8)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
select pg_temp.actor219(1);
delete from public.teacher_catalogs where profile_id=pg_temp.t219(4);
insert into public.teacher_catalogs(id,name,subjects,profile_id,is_visible)
values(pg_temp.t219(30),'합성 관찰 교사',array['영어'],pg_temp.t219(4),true);
insert into public.classroom_catalogs(id,name,subjects,campus)
values(pg_temp.t219(31),'합성 101호',array['영어'],'본관');
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan)
select pg_temp.t219(1000+n),'합성 선택 반 '||n,'영어','수업 진행 중','legacy','{"sessions":[]}' from generate_series(1,31)n;
insert into public.classes(id,name,subject) values(pg_temp.t219(1999),'FORBIDDEN_UNREFERENCED_CLASS','영어');
insert into public.classes(id,name,subject) values(pg_temp.t219(1998),'합성 이전 수업','영어');
insert into public.textbooks(id,title,name,subject,school_levels,grade_levels,sub_subject,status)
values(pg_temp.t219(40),'합성 선택 교재','합성 선택 교재','english',array['middle'],array['m3'],'독해','active'),
(pg_temp.t219(42),'합성 이전 교재','합성 이전 교재','english',array['middle'],array['m3'],'독해','active'),
(pg_temp.t219(43),'합성 별칭 교재','합성 별칭 교재','english',array['middle'],array['m3'],'독해','active'),
(pg_temp.t219(41),'FORBIDDEN_UNREFERENCED_BOOK','FORBIDDEN_UNREFERENCED_BOOK','english',array['middle'],array['m3'],'독해','active');
insert into public.ops_tasks(id,title,type,requested_by,student_name,class_id,textbook_id,memo)
values(pg_temp.t219(101),'합성 등록 선택','registration',pg_temp.t219(2),'합성 선택 학생',pg_temp.t219(1001),pg_temp.t219(40),'DISPLAY_REQUEST_MEMO'),
 (pg_temp.t219(102),'FORBIDDEN_OTHER_CASE','registration',pg_temp.t219(2),'FORBIDDEN_OTHER_STUDENT',null,null,'FORBIDDEN_OTHER_NOTE'),
 (pg_temp.t219(103),'등록 외 합성','general',pg_temp.t219(2),null,null,null,null),
 (pg_temp.t219(104),'빈 등록 합성','registration',null,null,null,null,null),
 (pg_temp.t219(105),'상세 행 없는 등록 합성','registration',null,null,null,null,null);
insert into public.ops_registration_details(task_id,school_grade,school_name,parent_phone,student_phone,request_note,level_test_result)
values(pg_temp.t219(101),'중3','합성 학교','DISPLAY_PARENT_CONTACT','DISPLAY_STUDENT_CONTACT','DISPLAY_REQUEST_NOTE','DISPLAY_LEGACY_RESULT'),
 (pg_temp.t219(102),'중3','다른 학교','FORBIDDEN_OTHER_CONTACT',null,'FORBIDDEN_OTHER_NOTE',null),
 (pg_temp.t219(104),null,null,null,null,null,null);
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,
 director_profile_id,director_assignment_source,director_assigned_at,observation_return_workflow_status,observation_attempt_count,archived_at,archived_by)
values(pg_temp.t219(201),pg_temp.t219(101),'영어','consultation_waiting','observation_requested',1,pg_temp.t219(2),'manual',now(),'consultation_completed',22,null,null),
 (pg_temp.t219(202),pg_temp.t219(102),'영어','inquiry','inquiry',1,null,null,null,null,0,null,null),
 (pg_temp.t219(203),pg_temp.t219(101),'수학','inquiry','inquiry',1,null,null,null,null,0,now(),pg_temp.t219(1)),
 (pg_temp.t219(204),pg_temp.t219(104),'영어','inquiry','inquiry',1,null,null,null,null,0,null,null);
insert into public.ops_task_comments(id,task_id,author_id,body) values(pg_temp.t219(301),pg_temp.t219(101),pg_temp.t219(2),'DISPLAY_COMMENT'),(pg_temp.t219(302),pg_temp.t219(102),pg_temp.t219(2),'FORBIDDEN_OTHER_COMMENT');
insert into public.ops_task_attachments(id,task_id,file_name,drive_link,uploaded_by)
values(pg_temp.t219(303),pg_temp.t219(101),'합성 안내.pdf','https://example.invalid/synthetic219.pdf',null);
insert into public.ops_task_events(id,task_id,actor_id,event_type,after_value)
values(pg_temp.t219(304),pg_temp.t219(101),pg_temp.t219(2),'registration_case_created',jsonb_build_object('version',1,'actorId',pg_temp.t219(2),'occurredAt','2026-10-29T10:00:00Z','studentSnapshot','FORBIDDEN_UNUSED_SNAPSHOT')::text),
 (pg_temp.t219(305),pg_temp.t219(101),pg_temp.t219(2),'registration_observation_booked','FORBIDDEN_BOOKING_ONLY_EVENT'),
 (pg_temp.t219(306),pg_temp.t219(101),pg_temp.t219(2),'registration_track_event','{"version":2,"event_type":"registration_observation_booked","metadata":{"unused":"FORBIDDEN_BOOKING_ONLY_EVENT"}}');
-- Canonical notification metadata is never displayed; normal process history,
-- free text, nested rows and legacy label references must remain intact.
insert into public.ops_task_events(id,task_id,actor_id,event_type,after_value) values
(pg_temp.t219(308),pg_temp.t219(101),pg_temp.t219(2),'registration_track_event',jsonb_build_object('version',2,'event_type','registration_management_notification_requested','track_id',pg_temp.t219(201),'metadata',jsonb_build_object('requestKey','FORBIDDEN_NOTIFICATION_KEY','factsChecksum','FORBIDDEN_NOTIFICATION_CHECKSUM'))::text),
(pg_temp.t219(309),pg_temp.t219(101),pg_temp.t219(2),'registration_track_event','{"version":1,"eventType":"registration_management_notification_requested","metadata":{"requestKey":"FORBIDDEN_NOTIFICATION_V1"}}'),
(pg_temp.t219(310),pg_temp.t219(101),pg_temp.t219(2),'registration_track_event',jsonb_build_object(
 'version',2,'event_type','enrollment_rows_saved','track_id',pg_temp.t219(201),'subject','영어','actor_profile_id',pg_temp.t219(2),'actor_kind','user',
 'source','consultation_completed','destination','waiting','reason_code','DISPLAY_FREE_TEXT 원문 2026-10-29T11:00:00Z','occurred_at','2026-10-29T11:00:00Z',
 'unused','FORBIDDEN_EVENT_EXTRA','metadata',jsonb_build_object('activityId','synthetic219-activity','rowIds',jsonb_build_array(pg_temp.t219(2201)),
 'mode',jsonb_build_object('unused','FORBIDDEN_SCALAR_OBJECT'),'scheduledAt','NOT_A_DATE_DISPLAY','place','DISPLAY_FREE_PLACE','materialLink','https://example.invalid/kept?x=1','unused','FORBIDDEN_METADATA_EXTRA',
 'rows',jsonb_build_array(jsonb_build_object('classId',pg_temp.t219(1001),'textbookId',pg_temp.t219(40),'textbookIds','[]'::jsonb,'classStartDate','2026-11-01','classStartSession','1','status','planned','unused','FORBIDDEN_ROW_EXTRA')),
 'enrollmentSnapshot',jsonb_build_object('classId',pg_temp.t219(1001),'textbookIds',jsonb_build_array(pg_temp.t219(40)),'admissionBatchId',pg_temp.t219(2132),'unused','FORBIDDEN_SNAPSHOT_EXTRA'),
 'subjectTransitions',jsonb_build_array(jsonb_build_object('subject','영어','source','inquiry','destination','waiting','reason','DISPLAY_TRANSITION','unused','FORBIDDEN_TRANSITION_EXTRA')),
 'appointmentChanges',jsonb_build_array(jsonb_build_object('eventType','appointment_updated','reasonLabel','DISPLAY_CHANGE_REASON','unused','FORBIDDEN_CHANGE_EXTRA','metadata',jsonb_build_object('oldPlace','DISPLAY_OLD_PLACE','place','DISPLAY_NEW_PLACE','unused','FORBIDDEN_CHANGE_METADATA')))))::text);
insert into public.ops_task_events(id,task_id,actor_id,event_type,before_value,after_value) values
(pg_temp.t219(311),pg_temp.t219(101),null,'legacy_registration_imported',jsonb_build_object('classId',pg_temp.t219(1998),'textbookId',pg_temp.t219(42),'pipelineStatus','inquiry','rawSubject','FORBIDDEN_LEGACY_EXTRA')::text,'{"version":1,"unused":"FORBIDDEN_LEGACY_AFTER","timestamps":{"classStartDate":"2026-01-01","unused":"FORBIDDEN_LEGACY_TIME"},"legacyBooleans":{"paymentChecked":false,"unused":"FORBIDDEN_LEGACY_BOOL"}}');
insert into public.ops_task_events(id,task_id,actor_id,event_type,after_value) values
(pg_temp.t219(312),pg_temp.t219(101),pg_temp.t219(2),'registration_fact_saved','{"factKey":"consultation_result","payload":{"note":"FORBIDDEN_HIDDEN_AUDIT_NOTE","outcome":"not_registered"}}'),
(pg_temp.t219(313),pg_temp.t219(101),pg_temp.t219(2),'registration_track_event','{"version":99,"event_type":"consultation_completed","metadata":{"note":"FORBIDDEN_UNKNOWN_VERSION"}}'),
(pg_temp.t219(314),pg_temp.t219(101),null,'consultation_completed','DISPLAY_LEGACY_LITERAL: 원문 및 시간 미상');
update public.ops_registration_subject_tracks set enrollment_detail_rows=jsonb_build_array(jsonb_build_object(
 'id','synthetic219-row','class_id',pg_temp.t219(1001),'textbook_ids',jsonb_build_array(pg_temp.t219(43)),
 'class_start_date','2026-11-01','class_start_session','1','sort_order',0,'unused','FORBIDDEN_ENROLLMENT_ROW_EXTRA')) where id=pg_temp.t219(201);
insert into public.ops_registration_messages(id,task_id,template_key,request_key,status,claim_active,provider_message_id)
values(pg_temp.t219(307),pg_temp.t219(101),'admission_application','FORBIDDEN_LEGACY_REQUEST_KEY','accepted',true,'FORBIDDEN_PROVIDER_ID');

-- Existing collection windows: one valid current appointment, 31 historical
-- appointments and 31 current/historical enrollments. One active level test per
-- track is required by the existing workflow contract. All IDs are
-- synthetic and no table/role/trigger guard is disabled to seed them.
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place,status,created_at,updated_at)
select pg_temp.t219(500+n),pg_temp.t219(101),'level_test','2026-11-01T10:00:00Z'::timestamptz+n*interval '1 minute','합성 예약실','scheduled','2026-10-01','2026-10-01' from generate_series(1,1)n;
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place,status,created_at,updated_at)
select pg_temp.t219(600+n),pg_temp.t219(101),'level_test','2026-09-01T10:00:00Z'::timestamptz+n*interval '1 minute','합성 과거실','completed','2026-08-01','2026-09-01' from generate_series(1,31)n;
insert into public.ops_registration_level_tests(id,track_id,appointment_id,attempt_number,status,completed_at,material_link)
select pg_temp.t219(700+n),pg_temp.t219(201),pg_temp.t219(600+n),n,'completed','2026-09-01','https://example.invalid/material/'||n from generate_series(1,31)n;
insert into public.ops_registration_level_tests(id,track_id,appointment_id,attempt_number,status)
values(pg_temp.t219(732),pg_temp.t219(201),pg_temp.t219(501),32,'scheduled');
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place,status)
values(pg_temp.t219(632),pg_temp.t219(102),'level_test','2026-09-01','다른 합성 예약실','completed');
insert into public.ops_registration_level_tests(id,track_id,appointment_id,attempt_number,status,completed_at,material_link)
values(pg_temp.t219(733),pg_temp.t219(202),pg_temp.t219(632),1,'completed','2026-09-01','https://example.invalid/foreign-material');
insert into public.ops_registration_consultations(id,track_id,mode,status,director_profile_id,completed_at,outcome,note)
select pg_temp.t219(2000+n),pg_temp.t219(201),'phone','completed',pg_temp.t219(2),now(),'not_registered','DISPLAY_CONSULTATION_'||n from generate_series(1,31)n;
insert into public.ops_registration_consultations(id,track_id,mode,status,director_profile_id,note)
values(pg_temp.t219(2032),pg_temp.t219(201),'phone','waiting',pg_temp.t219(2),'DISPLAY_CURRENT_CONSULTATION'),
 (pg_temp.t219(2033),pg_temp.t219(203),'phone','waiting',pg_temp.t219(2),'FORBIDDEN_ARCHIVED_NOTE'),
 (pg_temp.t219(2034),pg_temp.t219(202),'phone','waiting',pg_temp.t219(2),'FORBIDDEN_OTHER_CONSULTATION');
insert into public.ops_registration_admission_batches(id,task_id,revision_number,status)
select pg_temp.t219(2100+n),pg_temp.t219(101),n,'canceled' from generate_series(1,31)n;
insert into public.ops_registration_admission_batches(id,task_id,revision_number,status)
values(pg_temp.t219(2132),pg_temp.t219(101),32,'draft');
insert into public.ops_registration_enrollments(id,track_id,class_id,status,textbook_id,created_at,updated_at)
select pg_temp.t219(2200+n),pg_temp.t219(201),pg_temp.t219(1000+n),'planned',pg_temp.t219(40),'2026-10-01','2026-10-01' from generate_series(1,31)n;
insert into public.ops_registration_enrollments(id,track_id,class_id,status,created_at,updated_at)
select pg_temp.t219(2300+n),pg_temp.t219(201),pg_temp.t219(1000+n),'canceled','2026-09-01','2026-09-01' from generate_series(1,31)n;

-- One older current observation and 21 newer decided attempts deliberately
-- put the current saved row outside the history window of 20.
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place,status)
select pg_temp.t219(900+n),pg_temp.t219(101),'observation_class','2026-11-10T10:00:00Z','합성 관찰실',case when n=0 then 'scheduled' else 'completed' end from generate_series(0,21)n;
insert into public.ops_registration_observations(id,task_id,track_id,appointment_id,class_id,session_authority,legacy_session_key,
 session_date,starts_at,ends_at,session_schedule_state,legacy_session_source_hash,source_revision,booking_fact_hash,
 teacher_catalog_id,teacher_profile_id,classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,classroom_name_snapshot,campus,
 textbook_snapshot,progress_snapshot,status,attendance,attendance_recorded_by,attendance_recorded_at,suitability_result,feedback_reason,
 feedback_submitted_by,feedback_submitted_at,feedback_revision,decision_kind,decided_by,decided_at,created_by,updated_by,created_at)
select pg_temp.t219(800+n),pg_temp.t219(101),pg_temp.t219(201),pg_temp.t219(900+n),pg_temp.t219(1001),'legacy','synthetic219-'||n,
 '2026-11-10','2026-11-10T10:00:00Z','2026-11-10T11:00:00Z','active',repeat('a',64),
 jsonb_build_object('authority','legacy','sessionKey','synthetic219-'||n,'contentHash',repeat('a',64)),repeat('b',64),
 pg_temp.t219(30),pg_temp.t219(4),pg_temp.t219(31),'영어','DISPLAY_SAVED_CLASS','DISPLAY_SAVED_TEACHER','DISPLAY_SAVED_ROOM','본관',
 '[{"textbookId":null,"title":"DISPLAY_SAVED_BOOK","planLabel":"FORBIDDEN_UNUSED_BOOK_LABEL","memo":"FORBIDDEN_UNUSED_BOOK_MEMO"}]','DISPLAY_PROGRESS',
 case when n=0 then 'scheduled' else 'completed' end,case when n>0 then 'attended' end,case when n>0 then pg_temp.t219(2) end,case when n>0 then now() end,
 case when n>0 then 'fit' end,case when n>0 then 'DISPLAY_FEEDBACK' end,case when n>0 then pg_temp.t219(2) end,case when n>0 then now() end,
 case when n=0 then 0 else 1 end,case when n>0 then 'not_registered' end,case when n>0 then pg_temp.t219(2) end,case when n>0 then now() end,
 pg_temp.t219(2),pg_temp.t219(2),'2026-01-01T00:00:00Z'::timestamptz+n*interval '1 day' from generate_series(0,21)n;

-- Historical message fixture: normal verification-mode prerequisites inside
-- this rollback transaction, following registration_customer_solapi_messages_test.
-- Fake catalog values are fixture facts, never claimed provider verification.
-- No guard is disabled, real key supplied, preview RPC called or worker run.
create temp table activation219_original as select * from dashboard_private.registration_customer_solapi_activation where message_kind='level_test_booking';
insert into dashboard_private.registration_customer_solapi_template_receipts(message_kind,template_id,pf_id,catalog_checksum,provider_checksum,provider_status,verified_by)
values('level_test_booking','synthetic219-template-only','synthetic219-pf-only',repeat('c',64),repeat('c',64),'sendable',pg_temp.t219(1));
do $$declare n integer;task_id uuid;begin
 for n in 1..32 loop
  task_id:=pg_temp.t219(case when n=32 then 102 else 101 end);
  update dashboard_private.registration_customer_solapi_activation set mode='verification',verification_task_id=task_id,
   verification_recipient_hash=repeat('b',64),updated_by=pg_temp.t219(1) where message_kind='level_test_booking';
  insert into public.ops_registration_customer_message_previews(id,task_id,appointment_id,message_kind,source_revision,source_fingerprint,source_facts_checksum,
   recipient_hash,recipient_last4,template_key,template_revision,template_checksum,rendered_variables_checksum,rendered_body_checksum,rendered_buttons_checksum,created_by)
  values(pg_temp.t219(3000+n),task_id,pg_temp.t219(600+n),'level_test_booking',1,repeat('a',64),repeat('d',64),repeat('b',64),'1234','level_test_booking',1,
   repeat('c',64),repeat('e',64),repeat('f',64),repeat('a',64),pg_temp.t219(1));
  insert into public.ops_registration_customer_messages(id,preview_id,task_id,appointment_id,message_kind,source_revision,source_fingerprint,source_facts_checksum,
   recipient_hash,recipient_last4,template_key,template_revision,template_checksum,rendered_variables_checksum,rendered_body_checksum,rendered_buttons_checksum,
   dedupe_key,request_key,status,dispatch_token,provider_attempt_started_at,provider_attempt_count,provider_message_id,provider_group_id,
   confirmed_by,confirmed_at,resolution_source,resolved_at,created_at,updated_at)
  values(pg_temp.t219(3100+n),pg_temp.t219(3000+n),task_id,pg_temp.t219(600+n),'level_test_booking',1,repeat('a',64),repeat('d',64),repeat('b',64),'1234',
   'level_test_booking',1,repeat('c',64),repeat('e',64),repeat('f',64),repeat('a',64),md5('synthetic219-'||n)||md5('synthetic219-'||n),
   'FORBIDDEN_MESSAGE_REQUEST_'||n,'accepted',pg_temp.t219(3200+n),'2026-10-01',1,'FORBIDDEN_PROVIDER_MESSAGE','FORBIDDEN_PROVIDER_GROUP',
   pg_temp.t219(2),'2026-10-02','provider_send','2026-10-02','2026-09-01'::timestamptz+n*interval '1 minute','2026-10-02');
 end loop;
end $$;
update dashboard_private.registration_customer_solapi_activation a set mode=o.mode,verification_task_id=o.verification_task_id,
 verification_recipient_hash=o.verification_recipient_hash,updated_by=o.updated_by,updated_at=o.updated_at
from activation219_original o where a.message_kind=o.message_kind;
delete from dashboard_private.registration_customer_solapi_template_receipts where message_kind='level_test_booking';
select ok((select (to_jsonb(a)-'updated_at')=(to_jsonb(o)-'updated_at') from dashboard_private.registration_customer_solapi_activation a join activation219_original o using(message_kind)),
 'synthetic activation mode and scope are restored before reads; update timestamp follows its unchanged trigger');
select ok((select tgenabled='O' from pg_trigger where tgrelid='public.ops_registration_customer_messages'::regclass and tgname='enforce_registration_customer_solapi_delivery_gate_v1'),
 'delivery gate stayed enabled during historical fixture creation');

-- Validate all deferred fixture constraints before any assertions or reads.
set constraints all immediate;

-- Existing management write succeeds before the read-only effect baseline.
select pg_temp.actor219(2);set local role authenticated;
select lives_ok($q$select public.add_ops_task_comment_v2(pg_temp.t219(101),'DISPLAY_MANAGER_COMMENT',pg_temp.t219(4001))$q$,
 'existing staff registration comment writer remains available');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','staff retains its original path, not the teacher endpoint');
reset role;
create temp table baseline219 as select
 (select jsonb_agg(to_jsonb(t) order by id) from public.ops_tasks t) tasks,
 (select jsonb_agg(to_jsonb(t) order by id) from public.ops_registration_observations t) observations,
 (select jsonb_agg(to_jsonb(t) order by id) from public.ops_registration_customer_messages t) messages,
 (select count(*) from public.ops_registration_customer_message_previews) previews,
 (select count(*) from public.ops_task_comments) comments,
 (select count(*) from public.ops_task_events) events,
 (select count(*) from dashboard_private.ops_registration_mutations) mutations,
 (select count(*) from dashboard_private.notification_events) notifications,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select jsonb_agg(to_jsonb(t) order by message_kind) from dashboard_private.registration_customer_solapi_activation t) activation;
create temp table responses219(kind text primary key,payload jsonb);grant all on responses219 to authenticated;
select pg_temp.actor219(3);set local role authenticated;
select lives_ok($q$insert into responses219 values('case',public.get_registration_teacher_detail_v1(pg_temp.t219(101)))$q$,'unrelated active teacher reads the selected registration display');
select lives_ok($q$insert into responses219 values('empty',public.get_registration_teacher_detail_v1(pg_temp.t219(104)))$q$,'empty registration collections are readable');
-- Red regression for the original draft's INNER JOIN of registration details.
select lives_ok($q$insert into responses219 values('parent-only',public.get_registration_teacher_detail_v1(pg_temp.t219(105)))$q$,'parent-only registration matches management empty-detail fallback');
select is((select payload#>'{data,parent,ops_registration_details}' from responses219 where kind='parent-only'),'{}'::jsonb,'missing detail is an empty object, never missing parent');
select is((select payload->>'contractVersion' from responses219 where kind='case'),'1','versioned read envelope');
select is((select payload#>>'{data,parent,ops_registration_details,parent_phone}' from responses219 where kind='case'),'DISPLAY_PARENT_CONTACT','approved parent contact is readable');
select is((select payload#>>'{data,parent,ops_registration_details,request_note}' from responses219 where kind='case'),'DISPLAY_REQUEST_NOTE','approved inquiry notes are readable');
select is((select payload#>>'{data,parent,memo}' from responses219 where kind='case'),'DISPLAY_REQUEST_MEMO','same existing task memo is readable');
select ok((select payload::text like '%DISPLAY_CURRENT_CONSULTATION%' from responses219 where kind='case'),'current consultation text is preserved');
select ok((select payload::text like '%DISPLAY_COMMENT%' and payload::text like '%DISPLAY_MANAGER_COMMENT%' from responses219 where kind='case'),'existing collaboration display is preserved');
select ok((select payload::text not like '%FORBIDDEN_%' from responses219 where kind='case'),'case output excludes other case/archive/account/provider/unused snapshot canaries');
select is((select jsonb_array_length(payload#>'{data,tracks}') from responses219 where kind='case'),1,'archived and unrelated tracks are absent');
select is((select payload#>>'{data,tracks,0,id}' from responses219 where kind='case'),pg_temp.t219(201)::text,'selected active track identity is exact');
select is((select payload#>>'{data,tracks,0,observation_current_id}' from responses219 where kind='case'),pg_temp.t219(800)::text,'teacher gets the saved current observation summary');
select is((select payload#>>'{data,tracks,0,observation_attempt_count}' from responses219 where kind='empty'),'0','empty observation summary uses count zero');
select is((select payload#>'{data,tracks,0,director}' from responses219 where kind='empty'),'null'::jsonb,'nullable director is not fabricated');
select is((select payload#>'{data,activeAdmissionMessage,request_key}' from responses219 where kind='case'),null::jsonb,'legacy request key is excluded');
select is((select payload#>>'{data,activeAdmissionMessage,status}' from responses219 where kind='case'),'accepted','saved legacy admission message status is preserved');
select is((select jsonb_array_length(payload#>'{data,appointments}') from responses219 where kind='case'),31,'appointment current1/history30 window is bounded without invalid active fixtures');
select is((select payload#>>'{data,scheduledAppointmentTotal}' from responses219 where kind='case'),'1','exact current appointment total matches valid source rows');
select is((select payload#>>'{data,appointments,0,id}' from responses219 where kind='case'),pg_temp.t219(501)::text,'current appointments remain scheduled-time ascending');
select is((select payload#>>'{data,appointments,1,id}' from responses219 where kind='case'),pg_temp.t219(631)::text,'history tie-break stays updated/id descending');
select is((select jsonb_array_length(payload#>'{data,reminderSummaries}') from responses219 where kind='case'),31,'each displayed shared appointment has one persisted reminder summary');
select is((select jsonb_array_length(payload#>'{data,levelTests}') from responses219 where kind='case'),31,'per-track level tests preserve active1/history30');
select is((select jsonb_array_length(payload#>'{data,consultations}') from responses219 where kind='case'),31,'per-track consultations preserve active1/history30');
select is((select jsonb_array_length(payload#>'{data,admissionBatches}') from responses219 where kind='case'),31,'admission batches preserve current1/history30');
select is((select jsonb_array_length(payload#>'{data,enrollments}') from responses219 where kind='case'),60,'enrollments preserve current30/history30');
select is((select payload#>>'{data,currentEnrollmentTotal}' from responses219 where kind='case'),'31','exact current enrollment total preserves overflow');
select is((select payload#>>'{data,enrollments,0,id}' from responses219 where kind='case'),pg_temp.t219(2231)::text,'enrollment ties preserve descending ID');
select is((select payload#>'{data,appointments}' from responses219 where kind='empty'),'[]'::jsonb,'empty appointment list stays an array');
select is((select payload#>'{data,activeAdmissionMessage}' from responses219 where kind='empty'),'null'::jsonb,'empty message status remains nullable');
select is((select jsonb_array_length(payload#>'{data,textbooks}') from responses219 where kind='case'),3,'only current, legacy and alias-referenced textbook labels are exposed');

select ok((select not exists(select 1 from jsonb_array_elements(payload#>'{data,events}') e where e->>'id' in(pg_temp.t219(308)::text,pg_temp.t219(309)::text)) from responses219 where kind='case'),'canonical v1/v2 internal notification events are absent');
select ok((select not exists(select 1 from jsonb_array_elements(payload#>'{data,events}') e where e->>'id' in(pg_temp.t219(312)::text,pg_temp.t219(313)::text)) from responses219 where kind='case'),'hidden audit note and unknown structured version are excluded');
select is((select e->>'after_value' from responses219 cross join lateral jsonb_array_elements(payload#>'{data,events}') e where kind='case' and e->>'id'=pg_temp.t219(314)::text),'DISPLAY_LEGACY_LITERAL: 원문 및 시간 미상','displayed literal legacy text remains exactly as recorded');
select is((select (e->>'after_value')::jsonb#>>'{timestamps,classStartDate}' from responses219 cross join lateral jsonb_array_elements(payload#>'{data,events}') e where kind='case' and e->>'id'=pg_temp.t219(311)::text),'2026-01-01','legacy displayed timestamp survives the explicit snapshot projection');
select ok((select exists(select 1 from jsonb_array_elements(payload#>'{data,events}') e where e->>'id'=pg_temp.t219(310)::text and e->>'after_value' like '%DISPLAY_FREE_TEXT%' and e->>'after_value' like '%NOT_A_DATE_DISPLAY%' and e->>'after_value' like '%DISPLAY_CHANGE_REASON%') from responses219 where kind='case'),'ordinary canonical history keeps free text, invalid date text and recursive displayed fields');
select is((select (e->>'after_value')::jsonb#>'{metadata,rows,0,textbookIds}' from responses219 cross join lateral jsonb_array_elements(payload#>'{data,events}') e where kind='case' and e->>'id'=pg_temp.t219(310)::text),'[]'::jsonb,'explicit empty plural textbook selection still overrides singular fallback');
select is((select (e->>'after_value')::jsonb#>>'{metadata,appointmentChanges,0,metadata,oldPlace}' from responses219 cross join lateral jsonb_array_elements(payload#>'{data,events}') e where kind='case' and e->>'id'=pg_temp.t219(310)::text),'DISPLAY_OLD_PLACE','nested appointment display fields are retained');
select ok((select exists(select 1 from jsonb_array_elements(payload#>'{data,classes}') e where e->>'id'=pg_temp.t219(1998)::text and e->>'name'='합성 이전 수업') from responses219 where kind='case'),'legacy class name remains resolvable when no current row references it');
select ok((select exists(select 1 from jsonb_array_elements(payload#>'{data,textbooks}') e where e->>'id'=pg_temp.t219(42)::text and e->>'title'='합성 이전 교재') from responses219 where kind='case'),'legacy textbook label remains resolvable independently of current placement');
select ok((select exists(select 1 from jsonb_array_elements(payload#>'{data,textbooks}') e where e->>'id'=pg_temp.t219(43)::text) from responses219 where kind='case'),'snake-case plural textbook alias keeps its referenced label');

select lives_ok($q$insert into responses219 values('observations',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'observation_detail',pg_temp.t219(201)))$q$,'saved observation detail is readable without booking capability');
select lives_ok($q$insert into responses219 values('attempt',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'observation_attempt',pg_temp.t219(201),pg_temp.t219(821)))$q$,'selected historical observation remains readable');
select lives_ok($q$insert into responses219 values('feedback',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'feedback',pg_temp.t219(201),pg_temp.t219(821)))$q$,'saved proxy feedback is readable');
select lives_ok($q$insert into responses219 values('feedback-empty',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'feedback',pg_temp.t219(201),pg_temp.t219(800)))$q$,'unsubmitted feedback has a nullable display tuple');
select lives_ok($q$insert into responses219 values('observation-empty',public.get_registration_teacher_detail_v1(pg_temp.t219(104),'observation_detail',pg_temp.t219(204)))$q$,'track without attempts returns an empty saved observation detail');
select is((select payload#>>'{data,currentObservation,observationId}' from responses219 where kind='observations'),pg_temp.t219(800)::text,'current saved observation outside history20 is preserved independently');
select is((select jsonb_array_length(payload#>'{data,attempts}') from responses219 where kind='observations'),20,'history window remains exactly20');
select is((select payload#>>'{data,attempts,0,observationId}' from responses219 where kind='observations'),pg_temp.t219(821)::text,'attempt history stays newest first');
select is((select payload#>>'{data,attempts,19,observationId}' from responses219 where kind='observations'),pg_temp.t219(802)::text,'current row is not appended or used to replace a historical row');
select is((select payload#>>'{data,latestDecisionObservation,observationId}' from responses219 where kind='observations'),pg_temp.t219(821)::text,'latest decision is selected independently from current row');
select is((select payload#>>'{data,observation,className}' from responses219 where kind='attempt'),'DISPLAY_SAVED_CLASS','historical attempt uses saved class name');
select is((select payload#>>'{data,observation,textbooks,0,title}' from responses219 where kind='attempt'),'DISPLAY_SAVED_BOOK','saved displayed textbook title is preserved');
select ok((select payload::text not like '%FORBIDDEN_%' and payload::text not like '%bookingFactHash%' and payload::text not like '%sourceRevision%' from responses219 where kind='attempt'),'attempt omits unused textbook metadata and booking/source hashes');
select is((select payload#>>'{data,feedbackReason}' from responses219 where kind='feedback'),'DISPLAY_FEEDBACK','saved feedback text is preserved');
select is((select payload#>'{data,proxySubmitted}' from responses219 where kind='feedback'),'true'::jsonb,'saved proxy submission semantics match management');
select is((select payload#>>'{data,feedbackSubmittedByName}' from responses219 where kind='feedback'),'합성 담당자 2','saved active submitter label is preserved');
select is((select payload#>'{data,feedbackSubmittedAt}' from responses219 where kind='feedback-empty'),'null'::jsonb,'missing feedback time remains null');
select is((select payload#>'{data,proxySubmitted}' from responses219 where kind='feedback-empty'),'false'::jsonb,'unsubmitted feedback is not marked proxy submitted');
select is((select payload#>'{data,currentObservation}' from responses219 where kind='observation-empty'),'null'::jsonb,'empty current observation remains null');
select is((select payload#>'{data,attempts}' from responses219 where kind='observation-empty'),'[]'::jsonb,'empty attempts remain an array');

select lives_ok($q$insert into responses219 values('history1',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',null,null,1,20))$q$,'saved masked message history is readable without provider execution');
select lives_ok($q$insert into responses219 values('history2',public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',null,null,2,20))$q$,'message history preserves numbered page2');
select lives_ok($q$insert into responses219 values('history-empty',public.get_registration_teacher_detail_v1(pg_temp.t219(104),'customer_history'))$q$,'empty message history is a successful empty page');
select is((select payload#>>'{data,totalCount}' from responses219 where kind='history1'),'31','message total is selected-case scoped');
select is((select jsonb_array_length(payload#>'{data,history}') from responses219 where kind='history1'),20,'history first page respects size20');
select is((select jsonb_array_length(payload#>'{data,history}') from responses219 where kind='history2'),11,'history second page retains remaining rows');
select is((select payload#>>'{data,history,0,messageId}' from responses219 where kind='history1'),pg_temp.t219(3131)::text,'message order stays created_at/id descending');
select is((select payload#>>'{data,history,0,recipientLast4}' from responses219 where kind='history1'),'1234','only the existing masked recipient suffix is exposed');
select ok((select bool_and((item->>'canCheck')::boolean=false and(item->>'canCheckDelivery')::boolean=false) from responses219 cross join lateral jsonb_array_elements(payload#>'{data,history}') item where kind='history1'),'teacher history never grants receipt/provider action capabilities');
select ok((select payload::text not like '%FORBIDDEN_%' and payload::text not like '%recipient_hash%' and payload::text not like '%dispatch_token%' from responses219 where kind='history1'),'history excludes provider identifiers, internal keys and full recipient facts');
select is((select payload#>'{data,history}' from responses219 where kind='history-empty'),'[]'::jsonb,'empty history remains an array');
select is(public.get_registration_teacher_detail_v1(pg_temp.t219(101)),(select payload from responses219 where kind='case'),'repeat read returns the same saved display snapshot');
select is(dashboard_private.get_registration_teacher_detail_v1_impl(pg_temp.t219(101)),(select payload from responses219 where kind='case'),'direct implementation call has the same guarded display contract');

-- Closed argument and association contract; no child ID can widen task scope.
select throws_ok($q$select public.get_registration_teacher_detail_v1(null)$q$,'22023','registration_teacher_detail_invalid','null selected task is invalid');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'send')$q$,'22023','registration_teacher_detail_invalid','unknown section cannot invoke an action');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'case',pg_temp.t219(201))$q$,'22023','registration_teacher_detail_invalid','case rejects unused child arguments');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'observation_detail')$q$,'22023','registration_teacher_detail_invalid','observation section requires selected track');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'feedback',pg_temp.t219(201))$q$,'22023','registration_teacher_detail_invalid','feedback requires selected observation');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'case',null,null,2,10)$q$,'22023','registration_teacher_detail_invalid','case rejects history paging arguments');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',null,null,0,10)$q$,'22023','registration_teacher_detail_invalid','page zero is invalid');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',null,null,100001,10)$q$,'22023','registration_teacher_detail_invalid','out-of-range page is invalid');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',null,null,1,30)$q$,'22023','registration_teacher_detail_invalid','unsupported page size is invalid');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'customer_history',pg_temp.t219(201))$q$,'22023','registration_teacher_detail_invalid','history rejects child selector');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(9999))$q$,'P0002','registration_teacher_detail_not_found','unknown task is not a fabricated empty registration');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(103))$q$,'P0002','registration_teacher_detail_not_found','non-registration task is excluded');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'observation_detail',pg_temp.t219(202))$q$,'42501','registration_teacher_detail_forbidden','foreign task track is denied');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'observation_detail',pg_temp.t219(203))$q$,'42501','registration_teacher_detail_forbidden','archived track is denied');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(102),'observation_attempt',pg_temp.t219(202),pg_temp.t219(821))$q$,'42501','registration_teacher_detail_forbidden','foreign observation is denied even when selected task and track exist');
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101),'feedback',pg_temp.t219(201),pg_temp.t219(9999))$q$,'42501','registration_teacher_detail_forbidden','unknown observation is denied');

-- The new display capability does not change existing raw-table or write scope.
select is((select count(*) from public.ops_tasks where id=pg_temp.t219(101)),0::bigint,'unrelated teacher still cannot read raw selected registration task');
select is((select count(*) from public.ops_registration_details where task_id=pg_temp.t219(101)),0::bigint,'unrelated teacher still cannot read raw registration detail');
select throws_ok($q$select public.add_ops_task_comment_v2(pg_temp.t219(101),'DENIED_TEACHER_COMMENT',pg_temp.t219(4002))$q$,'42501','registration_access_denied','registration comment writing remains manager-only');
select throws_ok($q$select public.add_ops_task_comment_v2(pg_temp.t219(102),'DENIED_OTHER_COMMENT',pg_temp.t219(4003))$q$,'42501','registration_access_denied','other-case writing remains denied');
select throws_ok($q$select public.delete_registration_case_v1(pg_temp.t219(101),pg_temp.t219(4004))$q$,'42501','registration_access_denied','registration deletion remains manager-only');
select throws_ok($q$insert into public.ops_task_comments(task_id,author_id,body) values(pg_temp.t219(101),pg_temp.t219(3),'DENIED_RAW_COMMENT')$q$,'42501',null,'raw comment insertion remains denied');
select throws_ok($q$select public.get_registration_observation_manager_detail_v1(pg_temp.t219(201),20)$q$,'P0002','registration_observation_not_found','existing manager observation endpoint is not broadened');
select throws_ok($q$select public.list_registration_case_customer_messages_v1(pg_temp.t219(2),pg_temp.t219(101),1,20)$q$,'42501',null,'existing service-role customer history endpoint is not granted to teachers');
reset role;

-- Compare to the existing manager display projections, not invented expected
-- provider state. These are read-only saved-state functions, never send paths.
select pg_temp.actor219(2);set local role authenticated;
select lives_ok($q$insert into responses219 select 'manager-reminders',coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.get_registration_customer_reminder_summaries_v1(pg_temp.t219(101)) r$q$,'existing staff reminder reader remains available');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.t219(2),'role','service_role')::text,true);
insert into responses219 values('manager-history',public.list_registration_case_customer_messages_v1(pg_temp.t219(2),pg_temp.t219(101),1,20));
select is((select jsonb_agg(item-'canCheck'-'canCheckDelivery' order by ord) from responses219 cross join lateral jsonb_array_elements(payload#>'{data,history}') with ordinality x(item,ord) where kind='history1'),
 (select jsonb_agg(item-'canCheck'-'canCheckDelivery' order by ord) from responses219 cross join lateral jsonb_array_elements(payload->'history') with ordinality x(item,ord) where kind='manager-history'),
 'teacher saved message display equals management except action flags');
select is((select jsonb_agg(item order by item->>'appointment_id') from responses219 cross join lateral jsonb_array_elements(payload#>'{data,reminderSummaries}') item where kind='case'),
 (select jsonb_agg(item order by item->>'appointment_id') from responses219 cross join lateral jsonb_array_elements(payload) item where kind='manager-reminders' and item->>'appointment_id' in(select a->>'id' from responses219 cross join lateral jsonb_array_elements(payload#>'{data,appointments}') a where kind='case')),
 'teacher reminders equal management saved display for the same bounded appointments');

-- Current database account/role is checked before inputs and existence, even
-- when a stale user-editable JWT continues to claim teacher.
select pg_temp.actor219(1);set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(null,'invalid')$q$,'42501','registration_teacher_detail_forbidden','admin auth guard precedes argument validation');reset role;
select pg_temp.actor219(5);set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(9999))$q$,'42501','registration_teacher_detail_forbidden','viewer cannot infer selected task existence');reset role;
select pg_temp.actor219(6);set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','assistant does not gain this teacher capability');reset role;
select pg_temp.actor219(9998);set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','unknown account cannot use teacher metadata to gain access');reset role;
update public.profiles set role='viewer' where id=pg_temp.t219(3);
select pg_temp.actor219(3);set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','revoked teacher is denied despite stale teacher claim');
select throws_ok($q$select dashboard_private.get_registration_teacher_detail_v1_impl(null,'invalid')$q$,'42501','registration_teacher_detail_forbidden','direct implementation has the same auth-first guard');reset role;
update public.profiles set role='teacher' where id=pg_temp.t219(3);
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.t219(3);
set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','banned teacher is denied');reset role;
update auth.users set banned_until=null,deleted_at=now() where id=pg_temp.t219(3);
set local role authenticated;
select throws_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'42501','registration_teacher_detail_forbidden','soft-deleted teacher is denied');reset role;
update auth.users set deleted_at=null where id=pg_temp.t219(3);
set local role authenticated;
select lives_ok($q$select public.get_registration_teacher_detail_v1(pg_temp.t219(101))$q$,'restored active teacher uses the current account state');reset role;

select ok((select not prosecdef and provolatile='s' and proowner='postgres'::regrole and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer)'::regprocedure),'public wrapper is stable, invoker and has an empty search path');
select ok((select prosecdef and provolatile='s' and proowner='postgres'::regrole and proconfig @> array['search_path=""','TimeZone=UTC'] from pg_proc where oid='dashboard_private.get_registration_teacher_detail_v1_impl(uuid,text,uuid,uuid,integer,integer)'::regprocedure),'private reader is stable, definer, postgres-owned and pins search path/timezone');
select ok(has_function_privilege('authenticated','public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer)','execute'),'authenticated may enter the guarded wrapper');
select ok(not has_function_privilege('anon','public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer)','execute') and not has_function_privilege('service_role','public.get_registration_teacher_detail_v1(uuid,text,uuid,uuid,integer,integer)','execute'),'anon and service role receive no new endpoint grant');
select ok(not has_function_privilege('authenticated','dashboard_private.registration_teacher_case_v1(uuid)','execute'),'unscoped case projector is private');
select ok(not has_function_privilege('authenticated','dashboard_private.registration_teacher_attempt_v1(public.ops_registration_observations,public.ops_registration_appointments)','execute'),'unscoped observation projector is private');
select ok(not has_function_privilege('authenticated','public.list_registration_case_customer_messages_v1(uuid,uuid,integer,integer)','execute'),'provider service endpoint ACL is unchanged');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.ops_tasks t),(select tasks from baseline219),'reads and denied writes leave task rows unchanged');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.ops_registration_observations t),(select observations from baseline219),'reads do not change feedback/observation rows');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.ops_registration_customer_messages t),(select messages from baseline219),'reads never dispatch or update message attempts');
select is((select count(*) from public.ops_registration_customer_message_previews),(select previews from baseline219),'reads create no preview/consent tokens');
select is((select count(*) from public.ops_task_comments),(select comments from baseline219),'denied comment writes have no effects');
select is((select count(*) from public.ops_task_events),(select events from baseline219),'reads create no activity events');
select is((select count(*) from dashboard_private.ops_registration_mutations),(select mutations from baseline219),'reads create no mutation receipts');
select is((select count(*) from dashboard_private.notification_events),(select notifications from baseline219),'reads enqueue no notifications');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from baseline219),'reads create no deliveries');
select is((select jsonb_agg(to_jsonb(t) order by message_kind) from dashboard_private.registration_customer_solapi_activation t),(select activation from baseline219),'reads do not modify activation configuration');
-- These producer outputs are synthetic by the initial empty-baseline assertion.
-- A future isolated run can feed them to the real JS decoder; source fixtures
-- alone do not establish SQL producer/consumer runtime parity.
select diag('SYNTHETIC219_PRODUCER '||kind||' '||payload::text) from responses219 where kind in('case','empty','parent-only','observations','attempt','feedback','feedback-empty','history1') order by kind;
select * from finish();
rollback;
