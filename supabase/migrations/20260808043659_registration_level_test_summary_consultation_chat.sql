begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
  active_level_test.place as level_test_place
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
) active_phone on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment on appointment.id = level_test.appointment_id
  where level_test.track_id = track.id
    and level_test.status in ('scheduled', 'in_progress')
    and appointment.kind = 'level_test'
    and appointment.status = 'scheduled'
  order by level_test.attempt_number desc, level_test.created_at desc, level_test.id desc
  limit 1
) active_level_test on true;

revoke all on table public.ops_registration_subject_track_summaries from public, anon;
grant select on table public.ops_registration_subject_track_summaries to authenticated;

create or replace function public.ensure_registration_workflow_notification_v1(
  p_track_id uuid,
  p_workflow_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role text;
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_registration_source record;
  v_source public.ops_task_events%rowtype;
  v_source_payload jsonb;
  v_destination text;
  v_event_key text;
begin
  if v_actor is null
    or p_track_id is null
    or p_workflow_revision is null
    or p_workflow_revision < 1
  then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  select track, task into v_registration_source
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_track := v_registration_source.track;
  v_task := v_registration_source.task;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;
  if not (
    v_actor_role in ('admin', 'staff')
    or v_task.requested_by = v_actor
    or v_task.assignee_id = v_actor
    or v_task.secondary_assignee_id = v_actor
  ) then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-workflow-chat:' || p_track_id::text || ':' || p_workflow_revision::text,
    0
  ));
  select event_row.*
  into v_source
  from public.ops_task_events event_row
  where event_row.task_id = v_track.task_id
    and event_row.actor_id = v_actor
    and event_row.event_type = 'registration_track_event'
    and event_row.field_name = 'registration_track:' || p_track_id::text
    and event_row.after_value::jsonb ->> 'event_type' = 'registration_workflow_status_changed'
    and (event_row.after_value::jsonb -> 'metadata' ->> 'workflowRevision')::integer = p_workflow_revision
  order by event_row.created_at desc, event_row.id desc
  limit 1;
  if not found then
    raise exception 'registration_workflow_notification_source_not_found' using errcode = 'P0002';
  end if;
  v_source_payload := v_source.after_value::jsonb;

  v_destination := nullif(v_source_payload ->> 'destination', '');
  v_event_key := case
    when v_destination = 'consultation_requested'
      then 'registration.case_created'
    when v_destination = 'consultation_completed'
      then 'registration.consultation_completed'
    when v_destination in ('waiting_current_class', 'waiting_new_class', 'waiting_next_opening')
      then 'registration.waiting_transitioned'
    when v_destination = 'enrollment_requested'
      then 'registration.admission_started'
    else null
  end;
  if v_event_key is null then
    return pg_catalog.jsonb_build_object(
      'trackId', p_track_id,
      'workflowRevision', p_workflow_revision,
      'sourceEventIds', '[]'::jsonb
    );
  end if;

  if not exists (
    select 1
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key = v_event_key
      and canonical.source_type = 'ops_task_event'
      and canonical.source_id = v_source.id::text
      and canonical.occurrence_key = v_source.id::text
  ) then
    perform dashboard_private.record_registration_management_notification_v1(
      v_source.id,
      v_event_key,
      v_track.task_id,
      v_track.id,
      p_workflow_revision,
      v_source.created_at,
      v_source.actor_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'workflowRevision', p_workflow_revision,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id)
  );
end;
$$;

alter function public.ensure_registration_workflow_notification_v1(uuid, integer) owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
