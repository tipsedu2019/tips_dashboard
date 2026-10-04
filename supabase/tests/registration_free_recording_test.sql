begin;
select no_plan();
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local role postgres;
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, banned_until, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99300000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-admin@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-staff@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-teacher@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'registration-fence-banned@example.invalid',
    crypt('registration-fence-runtime-only', gen_salt('bf')),
    pg_catalog.now(), pg_catalog.now() + interval '1 day',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-manager-fence"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '99300000-0000-4000-8000-000000000001', 'admin', '등록 펜스 원장',
    'registration-fence-admin@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000002', 'staff', '등록 펜스 관리팀',
    'registration-fence-staff@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000003', 'teacher', '등록 펜스 교사',
    'registration-fence-teacher@example.invalid', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '99300000-0000-4000-8000-000000000004', 'staff', '등록 펜스 정지직원',
    'registration-fence-banned@example.invalid', pg_catalog.now(), pg_catalog.now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

select pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claim.role', '', true);

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, assignee_id
)
values
  (
    '99310000-0000-4000-8000-000000000001',
    '등록 manager fence', 'registration', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000002'
  ),
  (
    '99310000-0000-4000-8000-000000000002',
    '일반 업무 fence 비회귀', 'general', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000003',
    '99300000-0000-4000-8000-000000000003'
  ),
  (
    '99310000-0000-4000-8000-000000000003',
    'appointment integrity 독립성', 'registration', 'requested', 'normal',
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000001'
  );

insert into public.ops_registration_details(task_id, common_revision)
values
  ('99310000-0000-4000-8000-000000000001', 1),
  ('99310000-0000-4000-8000-000000000003', 1);

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status
)
values
  (
    '99320000-0000-4000-8000-000000000001',
    '99310000-0000-4000-8000-000000000001',
    '영어', 'inquiry'
  ),
  (
    '99320000-0000-4000-8000-000000000002',
    '99310000-0000-4000-8000-000000000003',
    '수학', 'inquiry'
  );

insert into public.ops_task_events(
  id, task_id, actor_id, event_type, field_name, after_value
)
values
  (
    '99330000-0000-4000-8000-000000000001',
    '99310000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    'registration_case_created', 'task_id',
    '99310000-0000-4000-8000-000000000001'
  ),
  (
    '99330000-0000-4000-8000-000000000002',
    '99310000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003',
    'updated', 'memo', '일반 업무'
  );

create or replace function pg_temp.registration_fence_set_actor(p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;


update public.ops_registration_subject_tracks set workflow_status='observation_feedback_pending', observation_return_workflow_status='consultation_completed' where id='99320000-0000-4000-8000-000000000001';
-- Save counts before recording-only operations. Everything is synthetic and rolled back.
create temp table recording_baseline as select
 (select count(*) from public.students) students,
 (select count(*) from public.ops_registration_appointments) appointments,
 (select count(*) from public.ops_registration_observations) observations,
 (select count(*) from public.ops_registration_enrollments) enrollments,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
select pg_temp.registration_fence_set_actor('99300000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok($test$
 do $loop$
 declare s text; t text; revision integer; result jsonb; counter integer := 0;
 states text[] := array['inquiry','level_test_requested','consultation_requested','consultation_completed','waiting_current_class','waiting_new_class','waiting_next_opening','observation_requested','enrollment_requested','payment_in_progress','registered','not_registered','inquiry_only'];
 begin
 foreach s in array states loop
   foreach t in array states loop
     select workflow_revision into revision from public.ops_registration_subject_tracks where id='99320000-0000-4000-8000-000000000001';
     counter := counter + 1;
     perform public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001',s,revision,'free-source-'||counter);
     select workflow_revision into revision from public.ops_registration_subject_tracks where id='99320000-0000-4000-8000-000000000001';
     result := public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001',t,revision,'free-target-'||counter);
     if result->>'workflowStatus' is distinct from t or result->'enrollmentFinalization' is distinct from 'null'::jsonb then raise exception 'incorrect recording result'; end if;
     if jsonb_array_length(result->'sourceEventIds') <> (case when t='registered' and s<>'registered' then 1 else 0 end) then raise exception 'subject notification source contract lost'; end if;
   end loop;
 end loop;
 end $loop$;
$test$, 'staff records all 169 source/target pairs with blank identity/contact and no appointment');
select throws_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001','registered',1,'stale')$$, '23514','registration_workflow_status_refresh_required','stale manual property revision is exact 23514, not a retryable collision');
select lives_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001','current_class',null,null,'partial-waiting')$$,'current-class intent saves without a selected class');
select lives_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001',null,null,null,'blank-waiting')$$,'all waiting information may be blank');
select lives_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001',null,null,null,'blank-waiting')$$,'same request replays');
select throws_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001','current_class',null,null,'blank-waiting')$$,'22023','registration_mutation_request_conflict','a reused key with changed intent is rejected');
select throws_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001','current_class','99999999-0000-4000-8000-000000000001',null,'missing-class')$$,'23503',null,'supplied class still requires a real referenced row');
select throws_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001',null,'99999999-0000-4000-8000-000000000001',null,'wrong-kind')$$,'22023','registration_waiting_details_invalid','a supplied class cannot be detached from its current-class meaning');
reset role;
select pg_temp.registration_fence_set_actor('99300000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000002','observation_requested',1,'director-trial')$$,'director can choose trial without booking or return metadata');
select lives_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000002','observation_requested',1,'director-trial')$$,'status receipt replay ignores now-stale expected revision');
select throws_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000002','registered',1,'director-trial')$$,'22023','idempotency_key_reused','status replay cannot change requested outcome');
reset role;
select pg_temp.registration_fence_set_actor('99300000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001','registered',1,'teacher-status')$$,'42501','registration_access_denied','teacher cannot record registration status');
select throws_ok($$select public.save_registration_waiting_details_v2('99320000-0000-4000-8000-000000000001',null,null,null,'teacher-note')$$,'42501','registration_access_denied','teacher cannot save optional facts');
reset role;
update public.profiles set role='assistant' where id='99300000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001','registered',1,'assistant-status')$$,'42501','registration_access_denied','assistant remains denied');
reset role;
select pg_temp.registration_fence_set_actor('99300000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok($$select public.set_registration_workflow_status_v1('99320000-0000-4000-8000-000000000001','registered',1,'banned-status')$$,'42501','registration_access_denied','banned staff remains denied');
reset role;
select is((select pipeline_status from public.ops_registration_subject_tracks where id='99320000-0000-4000-8000-000000000001'),'inquiry','manual results preserve historical pipeline data');
select is((select observation_return_workflow_status from public.ops_registration_subject_tracks where id='99320000-0000-4000-8000-000000000001'),'consultation_completed','historical return metadata remains unchanged after leaving old trial status');
select is((select student_name from public.ops_tasks where id='99310000-0000-4000-8000-000000000001'),null::text,'no student identity was fabricated');
select results_eq($$select (select count(*) from public.students), (select count(*) from public.ops_registration_appointments), (select count(*) from public.ops_registration_observations), (select count(*) from public.ops_registration_enrollments), (select count(*) from dashboard_private.notification_deliveries)$$,$$select * from recording_baseline$$,'status and partial facts create no student, appointment, attendance, enrollment or delivery');
select is((select count(*) from public.ops_task_events where task_id='99310000-0000-4000-8000-000000000001' and event_type='registration_fact_saved'),2::bigint,'partial and blank saves each record one audit event; replay creates none');
select ok(exists(select 1 from public.ops_task_events where task_id='99310000-0000-4000-8000-000000000001' and event_type='registration_track_event' and after_value::jsonb->>'event_type'='registration_workflow_status_changed'),'manual transitions retain automatic audit history');
select is((select count(*) from dashboard_private.notification_events where event_key='registration.subject_registration_completed' and payload->>'track_id'='99320000-0000-4000-8000-000000000001'), (select count(*) from public.ops_task_events where task_id='99310000-0000-4000-8000-000000000001' and event_type='registration_track_event' and after_value::jsonb->>'destination'='registered'), 'each registered transition retains its canonical notification source');
select * from finish();
rollback;
