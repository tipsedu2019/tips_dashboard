begin;

set local lock_timeout = '5s';

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
  track.enrollment_detail_rows
from public.ops_registration_subject_tracks track
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment on appointment.id = consultation.appointment_id
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
) active_phone on true;

revoke all on table public.ops_registration_subject_track_summaries from public, anon;
grant select on table public.ops_registration_subject_track_summaries to authenticated;

notify pgrst, 'reload schema';

commit;
