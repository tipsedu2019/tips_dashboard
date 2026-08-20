begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Result persistence is a data-only mutation: it closes the level-test child
-- and its appointment parent, but deliberately leaves the manual registration
-- workflow status unchanged.
create or replace function dashboard_private.save_registration_level_test_result_impl(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_link text := nullif(pg_catalog.btrim(p_material_link), '');
  v_attempt public.ops_registration_level_tests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_receipt_found boolean := false;
  v_receipt_matches boolean := false;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_attempt_id is null
    or v_request_key is null
    or p_status is null
    or p_status not in ('completed', 'absent', 'canceled')
    or (p_status = 'completed' and v_link is null)
  then
    raise exception 'registration_level_test_result_invalid' using errcode = '22023';
  end if;

  -- Serialize one actor/request pair before taking workflow row locks so an
  -- acknowledged retry can never write a duplicate event or revision.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select attempt.*
  into v_attempt
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track
    on track.id = attempt.track_id
  where attempt.id = p_attempt_id
  for update of attempt, track;
  if not found then
    raise exception 'registration_level_test_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into strict v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_attempt.track_id;

  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id,
    v_track.id,
    'complete_level_test'
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', p_status,
    'materialLink', case when p_status = 'completed' then v_link else null end
  );

  select
    mutation.response_payload,
    mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'save_registration_level_test_result'
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

  update public.ops_registration_level_tests attempt
  set
    status = p_status,
    material_link = case when p_status = 'completed' then v_link else null end,
    completed_at = coalesce(attempt.completed_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where attempt.id = p_attempt_id
  returning attempt.* into v_attempt;

  perform dashboard_private.write_registration_track_event(
    v_track.task_id,
    v_track.id,
    'registration_level_test_result_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'attemptId', p_attempt_id,
      'status', p_status
    )
  );

  perform dashboard_private.reconcile_registration_appointment_parent_v1(
    v_attempt.appointment_id
  );

  v_response := pg_catalog.jsonb_build_object(
    'attemptId', v_attempt.id,
    'trackId', v_track.id,
    'status', v_attempt.status,
    'materialLink', v_attempt.material_link
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_track.task_id,
    'save_registration_level_test_result',
    v_target_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

alter function dashboard_private.save_registration_level_test_result_impl(
  uuid,
  text,
  text,
  text
) owner to postgres;
revoke all on function dashboard_private.save_registration_level_test_result_impl(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_level_test_result_impl(
  uuid,
  text,
  text,
  text
) to authenticated;

-- Deterministic domain-state violations are check failures, not transaction
-- serialization failures. A non-retryable SQLSTATE prevents the Data API from
-- internally replaying an impossible transaction.
create or replace function dashboard_private.assert_registration_appointment_integrity_v1(
  p_appointment_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
begin
  if p_appointment_id is null then
    return;
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if not found or v_appointment.kind not in ('level_test', 'visit_consultation') then
    return;
  end if;

  if v_appointment.kind = 'level_test' then
    if v_appointment.status = 'scheduled'
      and not exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = v_appointment.id
          and attempt.status in ('scheduled', 'in_progress')
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '23514';
    end if;

    if v_appointment.status <> 'scheduled'
      and exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = v_appointment.id
          and attempt.status in ('scheduled', 'in_progress')
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '23514';
    end if;
  else
    if v_appointment.status = 'scheduled'
      and not exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '23514';
    end if;

    if v_appointment.status <> 'scheduled'
      and exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '23514';
    end if;
  end if;
end;
$$;

alter function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  from public, anon, authenticated, service_role;

commit;
