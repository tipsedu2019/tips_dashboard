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

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '10000000-0000-4000-8000-000000007251',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'level-result-parent-admin@registration-runtime.invalid',
  crypt('registration-level-result-parent-runtime-only', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"registration-level-result-parent"}'::jsonb, now(), now()
);

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '10000000-0000-4000-8000-000000007251',
  'admin',
  '레벨테스트 결과 부모 정합성 관리자',
  'level-result-parent-admin@registration-runtime.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

-- The isolated baseline intentionally carries no production rows. Seed only
-- the subject switches this transactional test needs, then roll them back.
insert into public.academic_subject_settings(
  subject,
  is_active,
  registration_create_enabled,
  grade_levels,
  sort_order
) values
  (
    '영어', true, true,
    array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'],
    10
  ),
  (
    '수학', true, true,
    array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'],
    20
  )
on conflict (subject) do update
set is_active = excluded.is_active,
    registration_create_enabled = excluded.registration_create_enabled,
    grade_levels = excluded.grade_levels,
    sort_order = excluded.sort_order;

create or replace function pg_temp.registration_level_result_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.registration_level_result_receipt_count(
  p_actor_id uuid,
  p_request_key text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = p_actor_id
    and mutation.request_key = p_request_key
    and mutation.mutation_type = 'save_registration_level_test_result';
$$;

create or replace function pg_temp.registration_level_result_artifact_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'notificationEvents', (
      select pg_catalog.count(*)
      from dashboard_private.notification_events
    ),
    'notificationDeliveries', (
      select pg_catalog.count(*)
      from dashboard_private.notification_deliveries
    ),
    'notificationFanoutJobs', (
      select pg_catalog.count(*)
      from dashboard_private.notification_event_fanout_jobs
    ),
    'reminderJobs', (
      select pg_catalog.count(*)
      from dashboard_private.registration_customer_reminder_jobs
    ),
    'observationDomainEvents', (
      select pg_catalog.count(*)
      from dashboard_private.registration_observation_domain_events
    ),
    'observationChatJobs', (
      select pg_catalog.count(*)
      from dashboard_private.registration_observation_chat_jobs
    ),
    'customerMessagePreviews', (
      select pg_catalog.count(*)
      from public.ops_registration_customer_message_previews
    ),
    'customerMessages', (
      select pg_catalog.count(*)
      from public.ops_registration_customer_messages
    ),
    'lightweightAlertDeliveries', (
      select pg_catalog.count(*)
      from dashboard_private.lightweight_registration_alert_deliveries
    )
  );
$$;

create temporary table registration_level_result_cases(
  case_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on registration_level_result_cases to authenticated;

set local role authenticated;
select pg_temp.registration_level_result_set_actor(
  '10000000-0000-4000-8000-000000007251'
);

insert into registration_level_result_cases(case_key, payload)
values
  (
    'single_completed',
    public.create_registration_case(
      '레벨결과 완료 학생', '중1', '레벨결과중', '01077007251', null,
      '본관', '2026-08-20 09:30+09'::timestamptz, array['영어'],
      'parent reconciliation fixture', 'normal',
      'level-result-parent-single-completed'
    )
  ),
  (
    'single_absent',
    public.create_registration_case(
      '레벨결과 결석 학생', '중1', '레벨결과중', '01077007252', null,
      '본관', '2026-08-20 09:30+09'::timestamptz, array['영어'],
      'parent reconciliation fixture', 'normal',
      'level-result-parent-single-absent'
    )
  ),
  (
    'single_canceled',
    public.create_registration_case(
      '레벨결과 취소 학생', '중1', '레벨결과중', '01077007253', null,
      '본관', '2026-08-20 09:30+09'::timestamptz, array['영어'],
      'parent reconciliation fixture', 'normal',
      'level-result-parent-single-canceled'
    )
  ),
  (
    'shared_terminal',
    public.create_registration_case(
      '레벨결과 공유 학생', '중1', '레벨결과중', '01077007254', null,
      '본관', '2026-08-20 09:30+09'::timestamptz, array['영어', '수학'],
      'parent reconciliation fixture', 'normal',
      'level-result-parent-shared-terminal'
    )
  );

-- Flat case creation intentionally ignores operational plans. Book each level
-- test explicitly through the independent appointment action that production
-- clients use after storing the case facts.
create temporary table registration_level_result_appointments(
  case_key text primary key,
  response jsonb not null
) on commit drop;

insert into registration_level_result_appointments(case_key, response)
select
  fixture.case_key,
  public.save_registration_appointment_details_v1(
    null,
    (fixture.payload ->> 'taskId')::uuid,
    'level_test',
    case fixture.case_key
      when 'single_completed' then '2026-08-25 10:00+09'::timestamptz
      when 'single_absent' then '2026-08-26 10:00+09'::timestamptz
      when 'single_canceled' then '2026-08-27 10:00+09'::timestamptz
      else '2026-08-28 10:00+09'::timestamptz
    end,
    '본관',
    array(
      select (track_item.value ->> 'id')::uuid
      from pg_catalog.jsonb_array_elements(
        fixture.payload -> 'tracks'
      ) track_item(value)
      order by track_item.value ->> 'subject'
    ),
    null,
    'level-result-parent-appointment-' || fixture.case_key
  )
from registration_level_result_cases fixture;

grant select on registration_level_result_appointments to authenticated;

create temporary table registration_level_result_ids on commit drop as
select
  fixture.case_key,
  task.id as task_id,
  appointment.id as appointment_id,
  track.id as track_id,
  attempt.id as attempt_id,
  track.subject
from registration_level_result_cases fixture
join public.ops_tasks task
  on task.id = (fixture.payload ->> 'taskId')::uuid
join registration_level_result_appointments booking
  on booking.case_key = fixture.case_key
join public.ops_registration_appointments appointment
  on appointment.id = (booking.response ->> 'appointmentId')::uuid
 and appointment.task_id = task.id
 and appointment.kind = 'level_test'
join public.ops_registration_subject_tracks track
  on track.task_id = task.id
join public.ops_registration_level_tests attempt
  on attempt.track_id = track.id
 and attempt.appointment_id = appointment.id;
grant select on registration_level_result_ids to authenticated;

create temporary table registration_level_result_event_baselines on commit drop as
select
  ids.case_key,
  ids.track_id,
  count(event.id)::integer as result_event_count
from registration_level_result_ids ids
left join public.ops_task_events event
  on event.task_id = ids.task_id
 and event.event_type = 'registration_track_event'
 and event.after_value is not null
 and event.after_value::jsonb ->> 'event_type' = 'registration_level_test_result_saved'
group by ids.case_key, ids.track_id;
grant select on registration_level_result_event_baselines to authenticated;

create or replace function pg_temp.registration_workflow_stale_revision_error(
  p_track_id uuid
)
returns text
language plpgsql
volatile
as $$
declare
  v_workflow_status text;
  v_workflow_revision integer;
begin
  select track.workflow_status, track.workflow_revision
  into strict v_workflow_status, v_workflow_revision
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  begin
    perform public.set_registration_workflow_status_v1(
      p_track_id,
      v_workflow_status,
      v_workflow_revision + 1,
      'level-result-parent-stale-workflow-revision'
    );
    return 'no_error';
  exception
    when others then
      return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

select is(
  pg_temp.registration_workflow_stale_revision_error(
    (select ids.track_id
     from registration_level_result_ids ids
     where ids.case_key = 'single_completed'
     limit 1)
  ),
  '23514:registration_workflow_status_refresh_required',
  'stale workflow revisions use a non-retryable domain SQLSTATE'
);

create temporary table registration_level_result_workflow_baselines
on commit drop as
select
  track.id as track_id,
  track.workflow_status,
  track.workflow_revision
from public.ops_registration_subject_tracks track
join registration_level_result_ids ids on ids.track_id = track.id
order by track.id;
grant select on registration_level_result_workflow_baselines to authenticated;

create temporary table registration_level_result_artifact_baseline(
  artifact_counts jsonb not null
) on commit drop;
insert into registration_level_result_artifact_baseline(artifact_counts)
values (pg_temp.registration_level_result_artifact_counts());
grant select on registration_level_result_artifact_baseline to authenticated;

-- The result RPC writes the child first and relies on deferred integrity checks.
-- Catch any deferred error in a subtransaction so it remains a normal pgTAP
-- assertion instead of aborting the packet. Every valid call explicitly forces
-- deferred triggers before returning.
create or replace function pg_temp.registration_level_result_save(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_response jsonb;
begin
  v_response := public.save_registration_level_test_result_v1(
    p_attempt_id,
    p_status,
    p_material_link,
    p_request_key
  );
  set constraints all immediate;
  set constraints all deferred;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'response', v_response
  );
exception
  when others then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'sqlstate', sqlstate,
      'error', sqlerrm
    );
end;
$$;

create temporary table registration_level_result_calls(
  case_key text not null,
  invocation text not null,
  result jsonb not null,
  primary key (case_key, invocation)
) on commit drop;
grant select, insert on registration_level_result_calls to authenticated;

-- A sole completed child closes its explicitly booked appointment.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'completed',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'completed',
    'https://drive.invalid/registration-level-result/completed',
    'level-result-parent-completed'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_completed';

select ok(
  (select result ->> 'ok' = 'true'
   from registration_level_result_calls
   where case_key = 'single_completed'
     and invocation = 'completed'),
  'sole completed level-test result commits through deferred appointment integrity'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'single_completed'
  ),
  'completed:2',
  'sole completed child reconciles its appointment parent and increments revision once'
);

select is(
  (
    select track.pipeline_status || ':' || task.status || ':' || detail.pipeline_status
    from registration_level_result_ids ids
    join public.ops_registration_subject_tracks track
      on track.id = ids.track_id
    join public.ops_tasks task
      on task.id = ids.task_id
    join public.ops_registration_details detail
      on detail.task_id = ids.task_id
    where ids.case_key = 'single_completed'
  ),
  'inquiry:requested:0. 등록 문의',
  'explicit booking and data-only result save leave manual registration status projections unchanged'
);

-- A fresh request key is an intentional correction, not an idempotent replay.
-- Link-only edits keep the derived parent revision stable; terminal status
-- corrections update the parent in both directions.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'completed_link_edit',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'completed',
    'https://drive.invalid/registration-level-result/completed-edited',
    'level-result-parent-completed-link-edit'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_completed';

select is(
  (
    select call.result ->> 'ok' || ':' || attempt.material_link || ':'
      || appointment.status || ':' || appointment.notification_revision
    from registration_level_result_calls call
    join registration_level_result_ids ids on ids.case_key = call.case_key
    join public.ops_registration_level_tests attempt on attempt.id = ids.attempt_id
    join public.ops_registration_appointments appointment on appointment.id = ids.appointment_id
    where call.case_key = 'single_completed'
      and call.invocation = 'completed_link_edit'
  ),
  'true:https://drive.invalid/registration-level-result/completed-edited:completed:2',
  'fresh-key completed link edit commits without changing the derived parent revision'
);

insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'completed_to_canceled',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'canceled',
    null,
    'level-result-parent-completed-to-canceled'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_completed';

select is(
  (
    select call.result ->> 'ok' || ':'
      || appointment.status || ':' || appointment.notification_revision
    from registration_level_result_calls call
    join registration_level_result_ids ids on ids.case_key = call.case_key
    join public.ops_registration_appointments appointment on appointment.id = ids.appointment_id
    where call.case_key = 'single_completed'
      and call.invocation = 'completed_to_canceled'
  ),
  'true:canceled:3',
  'fresh-key completed to canceled correction updates the derived parent once'
);

insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'canceled_to_completed',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'completed',
    'https://drive.invalid/registration-level-result/completed-corrected',
    'level-result-parent-canceled-to-completed'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_completed';

select is(
  (
    select call.result ->> 'ok' || ':'
      || appointment.status || ':' || appointment.notification_revision
    from registration_level_result_calls call
    join registration_level_result_ids ids on ids.case_key = call.case_key
    join public.ops_registration_appointments appointment on appointment.id = ids.appointment_id
    where call.case_key = 'single_completed'
      and call.invocation = 'canceled_to_completed'
  ),
  'true:completed:4',
  'fresh-key canceled to completed correction updates the derived parent once'
);

-- Sole absent child is a completed appointment (non-canceled terminal child).
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'absent',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'absent',
    null,
    'level-result-parent-absent'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_absent';

select ok(
  (select result ->> 'ok' = 'true'
   from registration_level_result_calls
   where case_key = 'single_absent'
     and invocation = 'absent'),
  'sole absent level-test result commits through deferred appointment integrity'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'single_absent'
  ),
  'completed:2',
  'sole absent child reconciles its appointment parent as completed'
);

-- Sole canceled child is the only terminal shape that cancels its appointment.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'canceled',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'canceled',
    null,
    'level-result-parent-canceled'
  )
from registration_level_result_ids ids
where ids.case_key = 'single_canceled';

select ok(
  (select result ->> 'ok' = 'true'
   from registration_level_result_calls
   where case_key = 'single_canceled'
     and invocation = 'canceled'),
  'sole canceled level-test result commits through deferred appointment integrity'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'single_canceled'
  ),
  'canceled:2',
  'sole canceled child reconciles its appointment parent as canceled'
);

-- Shared appointment: the first terminal child must not close the parent while
-- the second child is still scheduled.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'shared_first_completed',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'completed',
    'https://drive.invalid/registration-level-result/shared-english',
    'level-result-parent-shared-first'
  )
from registration_level_result_ids ids
where ids.case_key = 'shared_terminal'
  and ids.subject = '영어';

select ok(
  (select result ->> 'ok' = 'true'
   from registration_level_result_calls
   where case_key = 'shared_terminal'
     and invocation = 'shared_first_completed'),
  'first terminal child of a shared appointment commits while sibling remains active'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'shared_terminal'
    limit 1
  ),
  'scheduled:1',
  'first terminal child leaves shared appointment scheduled at the same revision'
);

-- Same request key must replay without writing a second result event or changing
-- the appointment revision.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'shared_first_duplicate',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'completed',
    'https://drive.invalid/registration-level-result/shared-english',
    'level-result-parent-shared-first'
  )
from registration_level_result_ids ids
where ids.case_key = 'shared_terminal'
  and ids.subject = '영어';

select ok(
  (
    select first_call.result -> 'response' = duplicate_call.result -> 'response'
      and duplicate_call.result ->> 'ok' = 'true'
    from registration_level_result_calls first_call
    join registration_level_result_calls duplicate_call
      on duplicate_call.case_key = first_call.case_key
    join registration_level_result_ids ids
      on ids.case_key = first_call.case_key
     and ids.subject = '영어'
    where first_call.case_key = 'shared_terminal'
      and first_call.invocation = 'shared_first_completed'
      and duplicate_call.invocation = 'shared_first_duplicate'
  ),
  'same request key replays the same response without a second result event'
);

select is(
  (
    select count(*)::integer
    from public.ops_task_events event
    join registration_level_result_ids ids
      on ids.task_id = event.task_id
     and event.field_name = 'registration_fact:' || ids.track_id::text
    where ids.case_key = 'shared_terminal'
      and ids.subject = '영어'
      and event.event_type = 'registration_fact_saved'
      and event.after_value::jsonb ->> 'factType' = 'level_test_result'
  ),
  1,
  'same request key creates exactly one fact audit event for the shared child'
);

-- Reusing the request key for a different target must fail closed instead of
-- silently overwriting a previously acknowledged result.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'shared_first_conflict',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'absent',
    null,
    'level-result-parent-shared-first'
  )
from registration_level_result_ids ids
where ids.case_key = 'shared_terminal'
  and ids.subject = '영어';

select is(
  (
    select result ->> 'sqlstate'
    from registration_level_result_calls
    where case_key = 'shared_terminal'
      and invocation = 'shared_first_conflict'
  ),
  '22023',
  'same request key with a different target fails as idempotency_key_reused'
);

select is(
  pg_temp.registration_level_result_receipt_count(
    '10000000-0000-4000-8000-000000007251',
    'level-result-parent-shared-first'
  ),
  1,
  'level-test result persistence records exactly one durable request receipt'
);

-- A receipt is not an authorization grant. Replays must re-check both the
-- current management role and the current auth-account state before returning
-- the stored response.
set local role postgres;
update public.profiles
set role = 'teacher',
    updated_at = pg_catalog.now()
where id = '10000000-0000-4000-8000-000000007251';
set local role authenticated;
select pg_temp.registration_level_result_set_actor(
  '10000000-0000-4000-8000-000000007251'
);
select throws_ok(
  $$
    select public.save_registration_level_test_result_v1(
      (select ids.attempt_id
       from registration_level_result_ids ids
       where ids.case_key = 'shared_terminal'
         and ids.subject = '영어'),
      'completed',
      'https://drive.invalid/registration-level-result/shared-english',
      'level-result-parent-shared-first'
    )
  $$,
  '42501',
  'registration_access_denied',
  'demoted receipt owner cannot replay a stored level-test result'
);

set local role postgres;
update public.profiles
set role = 'admin',
    updated_at = pg_catalog.now()
where id = '10000000-0000-4000-8000-000000007251';
update auth.users
set banned_until = pg_catalog.now() + interval '1 day',
    updated_at = pg_catalog.now()
where id = '10000000-0000-4000-8000-000000007251';
set local role authenticated;
select pg_temp.registration_level_result_set_actor(
  '10000000-0000-4000-8000-000000007251'
);
select throws_ok(
  $$
    select public.save_registration_level_test_result_v1(
      (select ids.attempt_id
       from registration_level_result_ids ids
       where ids.case_key = 'shared_terminal'
         and ids.subject = '영어'),
      'completed',
      'https://drive.invalid/registration-level-result/shared-english',
      'level-result-parent-shared-first'
    )
  $$,
  '42501',
  'registration_access_denied',
  'disabled receipt owner cannot replay a stored level-test result'
);

set local role postgres;
update auth.users
set banned_until = null,
    updated_at = pg_catalog.now()
where id = '10000000-0000-4000-8000-000000007251';
set local role authenticated;
select pg_temp.registration_level_result_set_actor(
  '10000000-0000-4000-8000-000000007251'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'shared_terminal'
    limit 1
  ),
  'scheduled:1',
  'same request key does not duplicate the shared appointment revision'
);

-- The final canceled sibling closes the shared appointment as completed because
-- the first child is non-canceled terminal evidence.
insert into registration_level_result_calls(case_key, invocation, result)
select
  ids.case_key,
  'shared_last_canceled',
  pg_temp.registration_level_result_save(
    ids.attempt_id,
    'canceled',
    null,
    'level-result-parent-shared-last'
  )
from registration_level_result_ids ids
where ids.case_key = 'shared_terminal'
  and ids.subject = '수학';

select ok(
  (select result ->> 'ok' = 'true'
   from registration_level_result_calls
   where case_key = 'shared_terminal'
     and invocation = 'shared_last_canceled'),
  'last terminal child of a shared appointment commits through deferred integrity'
);

select is(
  (
    select appointment.status || ':' || appointment.notification_revision
    from registration_level_result_ids ids
    join public.ops_registration_appointments appointment
      on appointment.id = ids.appointment_id
    where ids.case_key = 'shared_terminal'
    limit 1
  ),
  'completed:2',
  'last terminal child reconciles a shared appointment exactly once'
);

select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', track.id,
        'workflowStatus', track.workflow_status,
        'workflowRevision', track.workflow_revision
      )
      order by track.id
    )
    from public.ops_registration_subject_tracks track
    join registration_level_result_ids ids on ids.track_id = track.id
  ),
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', baseline.track_id,
        'workflowStatus', baseline.workflow_status,
        'workflowRevision', baseline.workflow_revision
      )
      order by baseline.track_id
    )
    from registration_level_result_workflow_baselines baseline
  ),
  'level-test result saves leave every track workflow status and revision unchanged'
);

select is(
  pg_temp.registration_level_result_artifact_counts(),
  (
    select baseline.artifact_counts
    from registration_level_result_artifact_baseline baseline
  ),
  'level-test result saves and denied replays create no notification, reminder, chat, or customer-message artifacts'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.ops_task_events event
    where event.task_id in (
      select ids.task_id
      from registration_level_result_ids ids
    )
      and event.event_type = 'registration_track_event'
      and event.after_value is not null
      and event.after_value::jsonb ->> 'event_type' =
        'registration_level_test_result_saved'
  ),
  0,
  'level-test result saves create zero legacy registration track events'
);

select * from finish();
rollback;
