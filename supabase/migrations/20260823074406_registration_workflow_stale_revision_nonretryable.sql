begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A stale optimistic-concurrency revision is a decisive domain conflict, not a
-- PostgreSQL serialization failure. PostgREST retries SQLSTATE 40001 inside the
-- same request, so using it here can turn one stale UI write into an unbounded
-- database error loop. Preserve the RPC contract and return a non-retryable
-- check-violation SQLSTATE instead.
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
  if v_workflow_status in (
    'observation_requested',
    'observation_feedback_pending',
    'observation_completed'
  ) then
    raise exception 'registration_observation_transition_requires_action'
      using errcode = '55000';
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

  if v_track.workflow_status in (
    'observation_requested',
    'observation_feedback_pending',
    'observation_completed'
  ) or exists (
    select 1
    from public.ops_registration_observations observation
    where observation.track_id = v_track.id
      and observation.decision_kind is null
      and observation.status in (
        'scheduled', 'attended_feedback_pending', 'completed', 'no_show'
      )
  ) then
    raise exception 'registration_observation_transition_requires_action'
      using errcode = '55000';
  end if;

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_workflow_status_refresh_required' using errcode = '23514';
  end if;

  v_status_changed := v_track.workflow_status is distinct from v_workflow_status;
  if v_status_changed then
    v_previous_workflow_status := v_track.workflow_status;
    update public.ops_registration_subject_tracks track
    set workflow_status = v_workflow_status,
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
    actor_id, request_key, task_id, mutation_type,
    target_fingerprint, response_payload
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

alter function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) owner to postgres;
revoke all on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) to authenticated;

comment on function dashboard_private.set_registration_workflow_status_v1_impl(
  uuid, text, integer, text
) is 'Sets a manual registration workflow status and reports stale revisions with non-retryable SQLSTATE 23514.';

commit;
