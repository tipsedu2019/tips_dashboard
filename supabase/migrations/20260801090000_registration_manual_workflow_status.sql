begin;

set local lock_timeout = '5s';
lock table public.ops_registration_subject_tracks in share row exclusive mode;
lock table public.ops_task_events in share row exclusive mode;
lock table dashboard_private.ops_registration_mutations in share row exclusive mode;

alter table public.ops_registration_subject_tracks
  add column if not exists workflow_status text,
  add column if not exists workflow_revision integer,
  add column if not exists workflow_status_entered_at timestamptz;

update public.ops_registration_subject_tracks track
set
  workflow_status = case
    when track.pipeline_status = 'waiting' then case track.waiting_kind
      when 'current_class' then 'waiting_current_class'
      when 'next_term_opening' then 'waiting_next_opening'
      else 'waiting_new_class'
    end
    when track.pipeline_status in ('inquiry', 'migration_review') then 'inquiry'
    when track.pipeline_status in ('level_test_scheduled', 'level_test_in_progress') then 'level_test_requested'
    when track.pipeline_status in ('consultation_waiting', 'visit_consultation_scheduled') then 'consultation_requested'
    when track.pipeline_status = 'enrollment_decided' then 'enrollment_requested'
    when track.pipeline_status = 'enrollment_processing' then 'payment_in_progress'
    when track.pipeline_status = 'registered' then 'registered'
    when track.pipeline_status = 'not_registered' then 'not_registered'
    when track.pipeline_status = 'inquiry_closed' then 'inquiry_only'
    else 'inquiry'
  end,
  workflow_revision = coalesce(track.workflow_revision, 1),
  workflow_status_entered_at = coalesce(
    track.workflow_status_entered_at,
    track.stage_entered_at,
    track.updated_at,
    track.created_at,
    pg_catalog.now()
  )
where track.workflow_status is null
  or track.workflow_revision is null
  or track.workflow_status_entered_at is null;

insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value, created_at
)
select
  track.task_id,
  null,
  'registration_workflow_backfill_warning',
  'registration_track:' || track.id::text,
  null,
  pg_catalog.jsonb_build_object(
    'version', 2,
    'event_type', 'registration_workflow_backfill_warning',
    'actor_profile_id', null,
    'actor_kind', 'migration',
    'system_source', 'registration_manual_workflow_status',
    'track_id', track.id,
    'subject', track.subject,
    'source', 'waiting',
    'destination', 'waiting_new_class',
    'reason_code', 'legacy_waiting_kind_defaulted',
    'metadata', pg_catalog.jsonb_build_object(
      'waitingKind', track.waiting_kind,
      'workflowStatus', track.workflow_status
    ),
    'occurred_at', pg_catalog.now()
  )::text,
  pg_catalog.now()
from public.ops_registration_subject_tracks track
where track.pipeline_status = 'waiting'
  and coalesce(track.waiting_kind, '') not in (
    'current_class', 'current_term_opening', 'next_term_opening'
  );

alter table public.ops_registration_subject_tracks
  alter column workflow_status set default 'inquiry',
  alter column workflow_status set not null,
  alter column workflow_revision set default 1,
  alter column workflow_revision set not null,
  alter column workflow_status_entered_at set default now(),
  alter column workflow_status_entered_at set not null;

alter table public.ops_registration_subject_tracks
  drop constraint if exists ops_registration_subject_tracks_workflow_status_check,
  add constraint ops_registration_subject_tracks_workflow_status_check check (
    workflow_status in (
      'inquiry',
      'level_test_requested',
      'consultation_requested',
      'consultation_completed',
      'waiting_current_class',
      'waiting_new_class',
      'waiting_next_opening',
      'enrollment_requested',
      'payment_in_progress',
      'registered',
      'not_registered',
      'inquiry_only'
    )
  ),
  drop constraint if exists ops_registration_subject_tracks_workflow_revision_check,
  add constraint ops_registration_subject_tracks_workflow_revision_check check (
    workflow_revision > 0
  );

create index if not exists ops_registration_subject_tracks_workflow_status_idx
  on public.ops_registration_subject_tracks(workflow_status, workflow_status_entered_at);

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
  track.workflow_status_entered_at
from public.ops_registration_subject_tracks track
left join lateral (
  select
    appointment.scheduled_at,
    appointment.place
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
  select
    consultation.ready_at,
    consultation.ready_source
  from public.ops_registration_consultations consultation
  where consultation.track_id = track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_phone on true;

create or replace function dashboard_private.assert_registration_workflow_status_access(
  p_track_id uuid,
  p_workflow_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce(public.current_dashboard_role(), '');
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if v_role = 'admin' then
    return;
  end if;

  if v_role = 'staff'
    and p_workflow_status in (
      'inquiry',
      'level_test_requested',
      'consultation_requested',
      'payment_in_progress',
      'registered',
      'inquiry_only'
    )
  then
    return;
  end if;

  if p_workflow_status in (
    'consultation_completed',
    'waiting_current_class',
    'waiting_new_class',
    'waiting_next_opening',
    'enrollment_requested',
    'not_registered'
  )
    and v_track.director_profile_id = v_actor_id
    and dashboard_private.is_active_subject_director(v_actor_id, v_track.subject)
  then
    return;
  end if;

  raise exception 'registration_access_denied' using errcode = '42501';
end;
$$;

alter function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.set_registration_workflow_status_v1_impl(
  p_track_id uuid,
  p_workflow_status text,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_workflow_status text := nullif(pg_catalog.btrim(p_workflow_status), '');
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_status_changed boolean;
  v_previous_workflow_status text;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_expected_workflow_revision is null or p_expected_workflow_revision < 1 then
    raise exception 'registration_workflow_revision_invalid' using errcode = '22023';
  end if;
  if v_workflow_status not in (
    'inquiry',
    'level_test_requested',
    'consultation_requested',
    'consultation_completed',
    'waiting_current_class',
    'waiting_new_class',
    'waiting_next_opening',
    'enrollment_requested',
    'payment_in_progress',
    'registered',
    'not_registered',
    'inquiry_only'
  ) then
    raise exception 'registration_workflow_status_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_workflow_status_access(
    v_track.id,
    v_workflow_status
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_workflow_status,
    'expectedWorkflowRevision', p_expected_workflow_revision
  );
  select
    mutation.response_payload,
    mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_workflow_status_refresh_required' using errcode = '40001';
  end if;

  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;
  if v_status_changed then
    v_previous_workflow_status := v_track.workflow_status;
    update public.ops_registration_subject_tracks track
    set
      workflow_status = v_workflow_status,
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.* into v_track;

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_workflow_status_changed',
      v_previous_workflow_status,
      v_workflow_status,
      'manual_status_change',
      pg_catalog.jsonb_build_object(
        'workflowStatus', v_workflow_status,
        'workflowRevision', v_track.workflow_revision
      ),
      'user',
      null
    );
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowStatus', v_track.workflow_status,
    'workflowRevision', v_track.workflow_revision,
    'workflowStatusEnteredAt', v_track.workflow_status_entered_at
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'set_workflow_status',
    v_target_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

alter function dashboard_private.set_registration_workflow_status_v1_impl(uuid, text, integer, text)
  owner to postgres;
revoke all on function dashboard_private.set_registration_workflow_status_v1_impl(uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.set_registration_workflow_status_v1_impl(uuid, text, integer, text)
  to authenticated;

create or replace function public.set_registration_workflow_status_v1(
  p_track_id uuid,
  p_workflow_status text,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.set_registration_workflow_status_v1_impl(
    p_track_id,
    p_workflow_status,
    p_expected_workflow_revision,
    p_request_key
  );
$$;

alter function public.set_registration_workflow_status_v1(uuid, text, integer, text)
  owner to postgres;
revoke all on function public.set_registration_workflow_status_v1(uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_registration_workflow_status_v1(uuid, text, integer, text)
  to authenticated;

commit;
