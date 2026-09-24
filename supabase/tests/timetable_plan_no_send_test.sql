-- Rollback-only, nonempty operational history. Never invokes a provider/dispatcher.
begin;
select no_plan();
create function pg_temp.hid(n int) returns uuid language sql immutable as $$select ('a8240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,instance_id,aud,role,email) values(pg_temp.hid(1),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task8-history@test.invalid');
insert into public.profiles(id,role,name) values(pg_temp.hid(1),'admin','history actor') on conflict(id) do update set role='admin';
select set_config('request.jwt.claim.sub',pg_temp.hid(1)::text,true);
delete from public.teacher_catalogs where profile_id=pg_temp.hid(1);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values(pg_temp.hid(2),'history teacher',array['영어'],pg_temp.hid(1));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.hid(3),'history room',array['영어']);
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons)
values(pg_temp.hid(4),'retained-history-class','영어','중2','수강','normalized','화 07:00-07:30','history teacher','history room','{}',jsonb_build_array(pg_temp.hid(5)),jsonb_build_array(pg_temp.hid(6)),jsonb_build_array(pg_temp.hid(7)),jsonb_build_object(pg_temp.hid(7)::text,jsonb_build_object('startDate','2026-09-01','endDate','2026-12-31','title','retained textbook usage')),'[{"id":"historic-lesson","date":"2026-09-01","attendance":{"present":1},"payment":{"paid":100000}}]');
insert into public.students(id,name,class_ids,waitlist_class_ids) values(pg_temp.hid(5),'history student',jsonb_build_array(pg_temp.hid(4)),'[]'),(pg_temp.hid(6),'history waiting','[]',jsonb_build_array(pg_temp.hid(4)));
insert into public.textbooks(id,name,lessons,sale_price,school_levels,grade_levels,subject,sub_subject) values(pg_temp.hid(7),'history textbook','[{"id":"unit1","title":"original"}]',12000,array['middle'],array['m2'],'english','reading');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id) values(pg_temp.hid(8),pg_temp.hid(4),2,'07:00','07:30',pg_temp.hid(2),pg_temp.hid(3));
insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin,memo) values(pg_temp.hid(9),pg_temp.hid(4),'2026-09-01:1',pg_temp.hid(8),'2026-09-01','active','07:00','07:30',pg_temp.hid(2),pg_temp.hid(3),'default','retained progress');
insert into public.student_class_enrollment_history(id,student_id,class_id,action,next_mode,memo) values(pg_temp.hid(10),pg_temp.hid(5),pg_temp.hid(4),'enrolled','enrolled','original claim history'),(pg_temp.hid(11),pg_temp.hid(6),pg_temp.hid(4),'waitlist','waitlist','original waiting history');
insert into public.ops_tasks(id,title,type,status,student_id,class_id) values(pg_temp.hid(12),'history registration','registration','requested',pg_temp.hid(5),pg_temp.hid(4));
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status) values(pg_temp.hid(13),pg_temp.hid(12),'영어','registered');
insert into public.ops_registration_admission_batches(id,task_id,revision_number,status,invoice_sent_at,payment_confirmed_at) values(pg_temp.hid(14),pg_temp.hid(12),1,'completed','2026-08-30','2026-08-31');
insert into public.ops_registration_enrollments(id,track_id,student_id,admission_batch_id,class_id,textbook_id,status,makeedu_registered,roster_active,class_start_lesson_session_id,class_start_date,class_start_session_key,class_start_session) values(pg_temp.hid(15),pg_temp.hid(13),pg_temp.hid(5),pg_temp.hid(14),pg_temp.hid(4),pg_temp.hid(7),'enrolled',true,true,pg_temp.hid(9),'2026-09-01','2026-09-01:1',dashboard_private.validate_registration_class_session(pg_temp.hid(4),'2026-09-01','2026-09-01:1')->>'sessionLabel');
insert into public.ops_registration_appointments(id,task_id,kind,scheduled_at,place) values(pg_temp.hid(16),pg_temp.hid(12),'observation_class','2026-09-01T07:00:00+09','본관');
insert into public.ops_registration_observations(id,task_id,track_id,appointment_id,class_id,session_authority,class_lesson_session_id,session_date,starts_at,ends_at,session_schedule_state,session_source_revision,source_revision,booking_fact_hash,teacher_catalog_id,teacher_profile_id,classroom_catalog_id,subject,class_name_snapshot,teacher_name_snapshot,classroom_name_snapshot,campus,attendance,attendance_recorded_by,attendance_recorded_at,status)
values(pg_temp.hid(17),pg_temp.hid(12),pg_temp.hid(13),pg_temp.hid(16),pg_temp.hid(4),'normalized',pg_temp.hid(9),'2026-09-01','2026-09-01T07:00:00+09','2026-09-01T07:30:00+09','active',0,jsonb_build_object('authority','normalized','sessionId',pg_temp.hid(9),'revision',0),'history-fact',pg_temp.hid(2),pg_temp.hid(1),pg_temp.hid(3),'영어','retained-history-class','history teacher','history room','본관','attended',pg_temp.hid(1),'2026-09-01T08:00:00+09','attended_feedback_pending');
insert into public.textbook_sales(id,class_id,charge_month,status) values(pg_temp.hid(18),pg_temp.hid(4),'2026-09','draft');
insert into public.textbook_sale_lines(id,sale_id,student_id,class_id,textbook_id,charge_month,quantity,unit_price,status,makeedu_paid_amount,makeedu_paid_at) values(pg_temp.hid(19),pg_temp.hid(18),pg_temp.hid(5),pg_temp.hid(4),pg_temp.hid(7),'2026-09',1,12000,'paid',12000,'2026-09-01');
insert into dashboard_private.notification_events(id,workflow_key,event_key,source_type,source_id,occurrence_key,occurred_at,payload_schema_version,payload,rule_snapshot) values(pg_temp.hid(20),'registration','history_fixture','task8',pg_temp.hid(12)::text,'task8-history',now(),1,'{"synthetic":true,"preserve":"original"}','[]');
insert into dashboard_private.notification_deliveries(id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,target_set_hash,target_kind,target_key,target_snapshot,status,status_reason,dedupe_key,rendered_title,rendered_body,scheduled_for,max_attempts)
select pg_temp.hid(21),pg_temp.hid(20),r.id,r.revision,r.active_template_id,r.channel_key,r.audience_key,'task8-history','audience','synthetic','{"synthetic":true}','disabled','rule_disabled','task8-history','retained queue','never dispatch',now(),1 from dashboard_private.notification_rules r where r.active_template_id is not null limit 1;
insert into public.ops_task_notification_deliveries(id,status,payload) values(pg_temp.hid(22),'sent','{"synthetic":true,"history":"preserved"}');
set constraints all immediate;set constraints all deferred;
select set_config('request.jwt.claim.sub',pg_temp.hid(1)::text,true);
insert into public.timetable_plans(id,name,created_by) values(pg_temp.hid(30),'history source',pg_temp.hid(1)),(pg_temp.hid(31),'history target',pg_temp.hid(1));
insert into public.timetable_plan_items(id,plan_id,name,subject,grade,capacity,tuition,source_class_id) values(pg_temp.hid(32),pg_temp.hid(30),'history derived draft','영어','중2',12,100000,pg_temp.hid(4));
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name) values(pg_temp.hid(33),pg_temp.hid(30),pg_temp.hid(32),3,420,450,pg_temp.hid(2),pg_temp.hid(3),'history teacher','history room');
create function pg_temp.history_snapshot() returns jsonb language plpgsql as $$
declare result jsonb:='{}'; relation text; rows jsonb;
begin
 foreach relation in array array['public.students','public.student_class_enrollment_history','public.ops_registration_enrollments','public.ops_registration_observations','public.ops_registration_admission_batches','public.textbooks','public.textbook_sales','public.textbook_sale_lines','public.class_lesson_sessions','dashboard_private.notification_events','dashboard_private.notification_deliveries','public.ops_task_notification_deliveries','public.makeup_notification_deliveries'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from %s t',relation) into rows;
 result:=result||jsonb_build_object(relation,jsonb_build_object('count',jsonb_array_length(rows),'rows',rows));
 end loop;
 select jsonb_agg(to_jsonb(c)) into rows from public.classes c where id=pg_temp.hid(4);
 return result||jsonb_build_object('originalClass',jsonb_build_object('count',jsonb_array_length(rows),'rows',rows));
end $$;
create temp table history_before as select pg_temp.history_snapshot() value;
select ok((select (value->relation->>'count')::int>0 from history_before),'nonempty fixture: '||relation) from unnest(array['public.students','public.student_class_enrollment_history','public.ops_registration_enrollments','public.ops_registration_observations','public.ops_registration_admission_batches','public.textbooks','public.textbook_sales','public.textbook_sale_lines','public.class_lesson_sessions','dashboard_private.notification_events','dashboard_private.notification_deliveries','public.ops_task_notification_deliveries']) relation;
create temp table transfer_result(value jsonb);
create function pg_temp.transfer(target int,mode text) returns jsonb language plpgsql as $$declare r jsonb;begin
 r:=jsonb_build_object('source',jsonb_build_object('kind','plan','planId',pg_temp.hid(30)),'target',case when target=0 then jsonb_build_object('kind','operational') else jsonb_build_object('kind','plan','planId',pg_temp.hid(target)) end,'mode',mode,'onConflict','reject','itemIds',jsonb_build_array(pg_temp.hid(32)));
 return public.commit_timetable_plan_transfer_v1(jsonb_build_object('request',r,'previewFingerprint',public.preview_timetable_plan_transfer_v1(r)->>'fingerprint','requestKey',mode||target));
end $$;

-- Roll back each transfer inside a subtransaction, keeping pgTAP counters outside it.
create function pg_temp.exercise(target int, mode text) returns jsonb language plpgsql as $$
declare result jsonb; receipt jsonb;begin
 begin
  receipt:=pg_temp.transfer(target,mode);
  result:=jsonb_build_object('receipt',receipt,'history',pg_temp.history_snapshot(),'classes',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.classes c where name='history derived draft'));
  raise exception using errcode='Z0001',message='rollback_fixture_transfer';
 exception when sqlstate 'Z0001' then null;
 end;
 return result;
end $$;

truncate transfer_result;
insert into transfer_result select pg_temp.exercise(0,'copy');
select is(after.value->>'count',before.value->>'count','operating copy count unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is(after.value->'rows',before.value->'rows','operating copy core JSON unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is((select jsonb_array_length(value->'classes') from transfer_result),1,'operating copy expected new class count');
select ok(not exists(select 1 from transfer_result r cross join lateral jsonb_array_elements(r.value->'classes') c where c->'student_ids'<>'[]' or c->'waitlist_ids'<>'[]' or c->'textbook_ids'<>'[]' or c->'textbook_usage'<>'{}' or c->'lessons'<>'[]'),'operating copy new class has no copied history');

truncate transfer_result;
insert into transfer_result select pg_temp.exercise(0,'move');
select is(after.value->>'count',before.value->>'count','operating move count unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is(after.value->'rows',before.value->'rows','operating move core JSON unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is((select jsonb_array_length(value->'classes') from transfer_result),1,'operating move expected new class count');
select ok(not exists(select 1 from transfer_result r cross join lateral jsonb_array_elements(r.value->'classes') c where c->'student_ids'<>'[]' or c->'waitlist_ids'<>'[]' or c->'textbook_ids'<>'[]' or c->'textbook_usage'<>'{}' or c->'lessons'<>'[]'),'operating move new class has no copied history');

truncate transfer_result;
insert into transfer_result select pg_temp.exercise(31,'copy');
select is(after.value->>'count',before.value->>'count','plan copy count unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is(after.value->'rows',before.value->'rows','plan copy core JSON unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is((select jsonb_array_length(value->'classes') from transfer_result),0,'plan copy expected new class count');
select ok(not exists(select 1 from transfer_result r cross join lateral jsonb_array_elements(r.value->'classes') c where c->'student_ids'<>'[]' or c->'waitlist_ids'<>'[]' or c->'textbook_ids'<>'[]' or c->'textbook_usage'<>'{}' or c->'lessons'<>'[]'),'plan copy new class has no copied history');

truncate transfer_result;
insert into transfer_result select pg_temp.exercise(31,'move');
select is(after.value->>'count',before.value->>'count','plan move count unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is(after.value->'rows',before.value->'rows','plan move core JSON unchanged: '||before.key) from history_before b cross join lateral jsonb_each(b.value) before join lateral jsonb_each((select value->'history' from transfer_result)) after on after.key=before.key;
select is((select jsonb_array_length(value->'classes') from transfer_result),0,'plan move expected new class count');
select ok(not exists(select 1 from transfer_result r cross join lateral jsonb_array_elements(r.value->'classes') c where c->'student_ids'<>'[]' or c->'waitlist_ids'<>'[]' or c->'textbook_ids'<>'[]' or c->'textbook_usage'<>'{}' or c->'lessons'<>'[]'),'plan move new class has no copied history');
select * from finish();
rollback;
