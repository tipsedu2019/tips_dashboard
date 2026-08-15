begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace view public.ops_registration_subject_track_summaries
with (security_invoker = true)
as
select
  track.id,
  track.task_id,
  track.subject,
  track.pipeline_status,
  track.director_profile_id,
  track.director_assignment_source,
  track.director_assignment_rule_key,
  track.waiting_kind,
  track.level_test_retake_decision,
  track.migration_review_required,
  track.stage_entered_at,
  track.updated_at,
  active_visit.scheduled_at as visit_scheduled_at,
  active_visit.place as visit_place,
  active_phone.ready_at as phone_ready_at,
  active_phone.ready_source as phone_ready_source,
  track.workflow_status,
  track.workflow_revision,
  track.workflow_status_entered_at,
  track.waiting_detail_kind,
  track.waiting_detail_class_id,
  track.waiting_detail_retake_decision,
  track.enrollment_detail_rows,
  active_level_test.scheduled_at as level_test_scheduled_at,
  active_level_test.place as level_test_place,
  case when observation_manager.allowed is true
    then track.observation_attempt_count else null
  end as observation_attempt_count,
  case when observation_manager.allowed is true
    then current_observation.id else null
  end as observation_current_id,
  case when observation_manager.allowed is true
    then current_observation.status else null
  end as observation_current_status,
  case when observation_manager.allowed is true
    then current_observation.appointment_id else null
  end as observation_current_appointment_id,
  case when observation_manager.allowed is true
    then current_observation.scheduled_at else null
  end as observation_nearest_scheduled_at,
  case when observation_manager.allowed is true
    then current_observation.place else null
  end as observation_nearest_place,
  case when observation_manager.allowed is true
    then current_observation.notification_revision else null
  end as observation_notification_revision,
  case when observation_manager.allowed is true
    then current_observation.revision else null
  end as observation_revision,
  case when observation_manager.allowed is true
    then current_observation.feedback_revision else null
  end as observation_feedback_revision,
  case when observation_manager.allowed is true
    then track.observation_return_workflow_status else null
  end as observation_return_workflow_status
from public.ops_registration_subject_tracks track
left join lateral (
  select true as allowed
  where dashboard_private.registration_observation_current_actor_is_active_manager_v1()
    or dashboard_private.registration_observation_track_director_profile_id_matches_v1(
      track.id
    )
  limit 1
) observation_manager on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
  where consultation.track_id = track.id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
    and appointment.kind = 'visit_consultation'
    and appointment.status = 'scheduled'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_visit on true
left join lateral (
  select consultation.ready_at, consultation.ready_source
  from public.ops_registration_consultations consultation
  where consultation.track_id = track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_phone on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
  where level_test.track_id = track.id
    and level_test.status in ('scheduled', 'in_progress')
    and appointment.kind = 'level_test'
    and appointment.status = 'scheduled'
  order by level_test.attempt_number desc,
    level_test.created_at desc,
    level_test.id desc
  limit 1
) active_level_test on true
left join lateral (
  select
    observation.id,
    observation.status,
    observation.appointment_id,
    observation.revision,
    observation.feedback_revision,
    appointment.scheduled_at,
    appointment.place,
    appointment.notification_revision
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
   and appointment.task_id = observation.task_id
  where observation.track_id = track.id
    and observation.decision_kind is null
    and observation.status in (
      'scheduled',
      'attended_feedback_pending',
      'completed',
      'no_show'
    )
  limit 1
) current_observation on true;

alter view public.ops_registration_subject_track_summaries
  owner to postgres;
revoke all on table public.ops_registration_subject_track_summaries
  from public, anon, service_role;
grant select on table public.ops_registration_subject_track_summaries
  to authenticated;

commit;
