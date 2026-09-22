begin;
set local role postgres;
set local search_path = extensions, public;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '60s';
set local lock_timeout = '5s';

create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('a9600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.sid(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.sid(n),'role','authenticated')::text,true);
$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.sid(n),'authenticated','authenticated','multi-book-'||n||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb
from generate_series(1,2) n;
insert into public.profiles(id,role,name,email)
select pg_temp.sid(n),case n when 1 then 'admin' else 'teacher' end,'다중 교재 테스트','multi-book-'||n||'@example.invalid'
from generate_series(1,2) n on conflict(id) do update set role=excluded.role;
insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values ('영어',true,true,array['중2'],10)
on conflict(subject) do update set is_active=true,registration_create_enabled=true,grade_levels=excluded.grade_levels;
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
select pg_temp.sid(n),'교재 '||n,'교재 '||n,'english','middle','m2',array['middle'],array['m2'],'독해'
from generate_series(11,13) n;
insert into public.classes(id,name,subject,status,teacher,room,schedule,schedule_storage_mode,schedule_plan,textbook_ids)
values (pg_temp.sid(21),'다중 교재 영어반','영어','수업 진행 중','교재 강사','본관','화 18:00-20:00','legacy',
'{"sessions":[{"date":"2026-09-29","sessionNumber":1,"scheduleState":"active"}]}',jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12)));

create temp table multi_case(response jsonb);
create temp table multi_saved(response jsonb);
grant select,insert,update,delete on multi_case,multi_saved to authenticated;
set local role authenticated;
select pg_temp.actor(1);
insert into multi_case select public.create_registration_case('다중교재학생','중2','테스트중','01000009991',null,'본관',now(),array['영어'],'','normal','multi-book-case');
create function pg_temp.track_id() returns uuid language sql as $$ select (response->'tracks'->0->>'id')::uuid from multi_case $$;
create function pg_temp.book_rows(books jsonb) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('classId',pg_temp.sid(21),'textbookIds',books,
 'classStartDate','2026-09-29','classStartSessionKey','2026-09-29:1','classStartSession','1회차','sortOrder',0));
$$;
set local role postgres;
create temp table multi_no_send as select jsonb_build_object(
 'events',(select count(*) from dashboard_private.notification_events),
 'messages',(select count(*) from public.ops_registration_customer_messages),
 'reminders',(select count(*) from dashboard_private.registration_customer_reminder_jobs),
 'chat',(select count(*) from dashboard_private.registration_observation_chat_jobs)) counts;
set local role authenticated;
insert into multi_saved select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12))),'multi-save');
select is((select response->'rows'->0->'textbookIds' from multi_saved),jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12)),'save response contains both books');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[pg_temp.sid(11),pg_temp.sid(12)],'RLS readback retains both selections');
select is((select textbook_id from public.ops_registration_enrollments where track_id=pg_temp.track_id()),pg_temp.sid(11),'legacy scalar aliases the first selection');
select is((select enrollment_detail_rows->0->'textbookIds' from public.ops_registration_subject_tracks where id=pg_temp.track_id()),jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12)),'track details retain both selections');
select is(public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12))),'multi-save'),(select response from multi_saved),'same request replays without duplicate enrollments');
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11))),'multi-save')$$,'22023','registration_mutation_request_conflict','changing the second book under the same request key is a conflict');
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(13))),'multi-wrong-class')$$,'23514','registration_textbook_class_mismatch','the second book must also belong to the class');
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows('["bad-uuid"]'),'multi-malformed')$$,'22023','registration_enrollment_rows_invalid','invalid array UUIDs have a non-retryable validation SQLSTATE');
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows('null'),'multi-null')$$,'22023','registration_enrollment_rows_invalid','null array is invalid instead of silently clearing');
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),jsonb_build_array(jsonb_build_object('classId',pg_temp.sid(21),'sortOrder',0,'textbookId',pg_temp.sid(13),'textbookIds',jsonb_build_array(pg_temp.sid(11)))),'multi-ambiguous')$$,'22023','registration_enrollment_rows_invalid','conflicting legacy and multiple selections are rejected');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[pg_temp.sid(11),pg_temp.sid(12)],'failed writes leave both selections intact');
select is((public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12),pg_temp.sid(11))),'multi-dedup')->'rows'->0->'textbookIds'),jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12)),'duplicate selection normalizes in stable order');
set local role postgres;
select is(dashboard_private.registration_customer_message_admission_plan_v1((select id from public.ops_registration_enrollments where track_id=pg_temp.track_id()),0)->>'textbookName','교재 11, 교재 12','admission preview names every selected book');
select throws_ok($$delete from public.textbooks where id=pg_temp.sid(12)$$,'23503','registration_textbook_in_use','secondary selected textbook cannot be deleted behind an enrollment');
select ok(not has_function_privilege('authenticated','dashboard_private.registration_enrollment_textbook_ids_v1(jsonb)','execute'),'new helper is private');
select ok(not has_function_privilege('anon','public.save_registration_enrollment_details_v1(uuid,jsonb,text)','execute'),'anonymous enrollment writes remain forbidden');
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows('[]'),'multi-teacher')$$,'42501','registration_access_denied','teacher cannot alter registration textbook choices');
select pg_temp.actor(1);
select is((public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows('[]'),'multi-clear')->'rows'->0->'textbookIds'),'[]'::jsonb,'all textbooks can be explicitly cleared');
select is((select textbook_id from public.ops_registration_enrollments where track_id=pg_temp.track_id()),null::uuid,'clearing also clears the legacy alias');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[]::uuid[],'empty selection survives database readback');
select is((public.save_registration_enrollment_details_v1(pg_temp.track_id(),jsonb_build_array(jsonb_build_object('classId',pg_temp.sid(21),'sortOrder',0,'textbookId',pg_temp.sid(12))),'multi-legacy')->'rows'->0->'textbookIds'),jsonb_build_array(pg_temp.sid(12)),'old single-book clients remain supported');
set local role postgres;
select is(jsonb_build_object(
 'events',(select count(*) from dashboard_private.notification_events),
 'messages',(select count(*) from public.ops_registration_customer_messages),
 'reminders',(select count(*) from dashboard_private.registration_customer_reminder_jobs),
 'chat',(select count(*) from dashboard_private.registration_observation_chat_jobs)),(select counts from multi_no_send),'saving and clearing textbooks does not send or enqueue notifications');

-- Replay a receipt in the pre-migration scalar format without rewriting it.
update dashboard_private.ops_registration_mutations
set target_fingerprint=jsonb_set(target_fingerprint,'{rows}',(select jsonb_agg(value-'textbookIds') from jsonb_array_elements(target_fingerprint->'rows')))
where actor_id=pg_temp.sid(1) and request_key='multi-legacy';
set local role authenticated;
select lives_ok($$select public.save_registration_enrollment_details_v1(pg_temp.track_id(),jsonb_build_array(jsonb_build_object('classId',pg_temp.sid(21),'sortOrder',0,'textbookId',pg_temp.sid(12))),'multi-legacy')$$,'pre-migration single-book detail receipts remain replayable');
select public.save_registration_enrollment_rows(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11))),'multi-public');
set local role postgres;
update dashboard_private.ops_registration_mutations
set target_fingerprint=jsonb_set(target_fingerprint,'{rows}',(select jsonb_agg(value-'textbookIds') from jsonb_array_elements(target_fingerprint->'rows')))
where actor_id=pg_temp.sid(1) and request_key='multi-public';
set local role authenticated;
select lives_ok($$select public.save_registration_enrollment_rows(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11))),'multi-public')$$,'public writer can replay the pre-migration single-book fingerprint');
select throws_ok($$select public.save_registration_enrollment_rows(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12))),'multi-public')$$,'22023','idempotency_key_reused','adding a second book to a legacy receipt is not an idempotent replay');
set local role postgres;

-- Admission must revalidate the entire choice against the latest class books.
set local role authenticated;
select public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12))),'multi-finalization');
set local role postgres;
update public.ops_registration_subject_tracks set pipeline_status='enrollment_processing' where id=pg_temp.track_id();
update public.classes set textbook_ids=jsonb_build_array(pg_temp.sid(11)) where id=pg_temp.sid(21);
select throws_ok($$select dashboard_private.finalize_registration_track_enrollments_v1(pg_temp.track_id(),pg_temp.sid(1))$$,'23514','registration_textbook_class_mismatch','finalization revalidates the second book after a class change');
select is((select count(*) from public.ops_registration_admission_batches where task_id=(select (response->>'taskId')::uuid from multi_case)),0::bigint,'failed finalization rolls back its compatibility batch');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[pg_temp.sid(11),pg_temp.sid(12)],'failed finalization preserves the full choice');
update public.classes set textbook_ids=jsonb_build_array(pg_temp.sid(11),pg_temp.sid(12)) where id=pg_temp.sid(21);
select lives_ok($$select dashboard_private.finalize_registration_track_enrollments_v1(pg_temp.track_id(),pg_temp.sid(1))$$,'valid multiple textbooks can complete admission');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[pg_temp.sid(11),pg_temp.sid(12)],'completed admission retains both books');
set local role authenticated;
select is((public.save_registration_enrollment_details_v1(pg_temp.track_id(),pg_temp.book_rows(jsonb_build_array(pg_temp.sid(12))),'multi-external-correction')->>'externalReconciliationRequired'),'true','post-admission corrections retain the reconciliation boundary');
select is((select textbook_ids from public.ops_registration_enrollments where track_id=pg_temp.track_id()),array[pg_temp.sid(11),pg_temp.sid(12)],'post-admission correction does not rewrite enrolled facts');
select is((select enrollment_detail_rows->0->'textbookIds' from public.ops_registration_subject_tracks where id=pg_temp.track_id()),jsonb_build_array(pg_temp.sid(12)),'corrected choices persist separately for reconciliation');
set local role postgres;
select * from finish();
rollback;
