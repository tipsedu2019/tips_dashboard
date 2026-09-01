begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.enter_registration_observation_v1_impl(
  p_track_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.registration_observation_active_actor_v1();
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_source_status text;
  v_source_revision integer;
  v_response jsonb;
begin
  if p_track_id is null
    or p_expected_workflow_revision is null
    or p_expected_workflow_revision < 1
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_enter_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint :=
    dashboard_private.registration_observation_request_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'operation', 'enter',
        'trackId', p_track_id,
        'expectedWorkflowRevision', p_expected_workflow_revision
      )
    );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_key, 0)
  );

  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'enter'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_key_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  perform dashboard_private.assert_registration_observation_runtime_v1();

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_registration_observation_manager_access_v1(
    v_track.id
  );

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_observation_stale_revision'
      using errcode = '23514';
  end if;
  if v_track.workflow_status not in (
    'consultation_completed',
    'waiting_current_class',
    'waiting_new_class',
    'waiting_next_opening'
  ) or exists (
    select 1
    from public.ops_registration_observations observation
    where observation.track_id = v_track.id
      and observation.decision_kind is null
      and observation.status in (
        'scheduled', 'attended_feedback_pending', 'completed', 'no_show'
      )
  ) then
    raise exception 'registration_observation_transition_rejected'
      using errcode = '55000';
  end if;

  v_source_status := v_track.workflow_status;
  v_source_revision := v_track.workflow_revision;
  update public.ops_registration_subject_tracks track
  set workflow_status = 'observation_requested',
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      observation_return_workflow_status = v_source_status,
      updated_at = pg_catalog.now()
  where track.id = v_track.id
  returning track.* into v_track;

  perform dashboard_private.write_registration_track_event_v2(
    v_track.task_id,
    v_track.id,
    'registration_observation_entered',
    v_source_status,
    v_track.workflow_status,
    null,
    pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'workflowRevisionBefore', v_source_revision,
      'workflowRevisionAfter', v_track.workflow_revision
    ),
    'user',
    null
  );

  v_response := dashboard_private.registration_observation_response_v1(
    'enter', p_request_key, v_track, null, null, true
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id, operation, request_key, track_id,
    request_fingerprint, response_payload
  ) values (
    v_actor, 'enter', p_request_key, v_track.id,
    v_fingerprint, v_response
  );
  return v_response;
end;
$$;

create or replace function public.enter_registration_observation_v1(
  p_track_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.enter_registration_observation_v1_impl(
    p_track_id,
    p_expected_workflow_revision,
    p_request_key
  );
$$;

alter function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  owner to postgres;
alter function public.enter_registration_observation_v1(uuid, integer, text)
  owner to postgres;

revoke all on function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.enter_registration_observation_v1_impl(uuid, integer, text)
  to authenticated;

revoke all on function public.enter_registration_observation_v1(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.enter_registration_observation_v1(uuid, integer, text)
  to authenticated;

commit;
