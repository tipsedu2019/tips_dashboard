begin;

set local lock_timeout = '5s';
lock table public.ops_registration_subject_tracks in share row exclusive mode;
lock table public.ops_registration_consultations in share row exclusive mode;
lock table public.ops_registration_enrollments in share row exclusive mode;
lock table dashboard_private.ops_registration_mutations in share row exclusive mode;

create or replace function dashboard_private.save_registration_phone_consultation_v1_impl(
  p_track_id uuid,
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
  v_track public.ops_registration_subject_tracks%rowtype;
  v_consultation public.ops_registration_consultations%rowtype;
  v_target_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_response jsonb;
begin
  if v_actor_id is null or p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object('trackId', p_track_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id
    and task.type = 'registration'
  for update of track;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_track.task_id, v_track.id, 'save_appointment'
  );
  perform dashboard_private.assert_registration_track_director_ready(v_track.id);

  select mutation.target_fingerprint, mutation.response_payload
  into v_saved_fingerprint, v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_fingerprint is distinct from v_target_fingerprint then
      raise exception 'registration_mutation_request_conflict' using errcode = '40001';
    end if;
    return v_response;
  end if;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.track_id = v_track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
  for update;

  if not found then
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    ) values (
      v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
      pg_catalog.now(), 'director_resolved'
    )
    returning * into v_consultation;
  elsif v_consultation.director_profile_id is distinct from v_track.director_profile_id then
    update public.ops_registration_consultations consultation
    set director_profile_id = v_track.director_profile_id,
        updated_at = pg_catalog.now()
    where consultation.id = v_consultation.id
    returning consultation.* into v_consultation;
  end if;

  perform dashboard_private.write_registration_track_event(
    v_track.task_id,
    v_track.id,
    'registration_phone_consultation_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object('consultationId', v_consultation.id)
  );

  v_response := pg_catalog.to_jsonb(v_consultation);
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type,
    target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_track.task_id,
    'save_phone_consultation', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  owner to postgres;
revoke all on function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_phone_consultation_v1_impl(uuid, text)
  to authenticated;

create or replace function public.save_registration_phone_consultation_v1(
  p_track_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_phone_consultation_v1_impl($1, $2);
$$;

alter function public.save_registration_phone_consultation_v1(uuid, text)
  owner to postgres;
revoke all on function public.save_registration_phone_consultation_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_registration_phone_consultation_v1(uuid, text)
  to authenticated;

do $migration$
declare
  v_definition text;
  v_updated_definition text;
  v_old_fragment text;
  v_new_fragment text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.save_registration_enrollment_rows_impl(uuid,jsonb,text)'::regprocedure
  );
  v_old_fragment := $old$if v_track.pipeline_status not in ('enrollment_decided', 'registered') then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;$old$;
  v_new_fragment := $new$if v_track.pipeline_status not in ('enrollment_decided', 'registered')
    and coalesce(pg_catalog.current_setting(
      'dashboard.registration_status_independent_enrollment', true
    ), '') <> 'on'
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;$new$;
  v_updated_definition := pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  if v_updated_definition = v_definition then
    raise exception 'registration_enrollment_integrity_patch_target_missing';
  end if;
  execute v_updated_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.claim_registration_admission_message_impl(uuid,text)'::regprocedure
  );
  v_old_fragment := $old$v_eligible := exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'enrollment_decided'
  ) or exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_registration_enrollments enrollment
      on enrollment.track_id = track.id
    where track.task_id = p_task_id
      and track.pipeline_status = 'registered'
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
  );$old$;
  v_new_fragment := $new$v_eligible := exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.workflow_status = 'enrollment_requested'
  ) or exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_registration_enrollments enrollment
      on enrollment.track_id = track.id
    where track.task_id = p_task_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
  );$new$;
  v_updated_definition := pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  if v_updated_definition = v_definition then
    raise exception 'registration_admission_claim_integrity_patch_target_missing';
  end if;
  execute v_updated_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)'::regprocedure
  );
  v_old_fragment := $old$if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.pipeline_status not in ('enrollment_decided', 'registered')
  ) then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;$old$;
  v_new_fragment := $new$-- Manual workflow state is independent. The selected canonical planned rows
  -- below are the admission batch integrity boundary.$new$;
  v_updated_definition := pg_catalog.replace(v_definition, v_old_fragment, v_new_fragment);
  if v_updated_definition = v_definition then
    raise exception 'registration_admission_batch_integrity_patch_target_missing';
  end if;
  execute v_updated_definition;
end;
$migration$;

alter function dashboard_private.save_registration_enrollment_rows_impl(uuid, jsonb, text)
  owner to postgres;
alter function dashboard_private.claim_registration_admission_message_impl(uuid, text)
  owner to postgres;
alter function dashboard_private.start_registration_admission_batch_impl(uuid, uuid[], uuid[], text)
  owner to postgres;

create or replace function dashboard_private.save_registration_enrollment_details_impl(
  p_track_id uuid,
  p_rows jsonb,
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
  v_track public.ops_registration_subject_tracks%rowtype;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_response jsonb;
begin
  if v_actor_id is null
    or v_request_key is null
    or p_rows is null
    or pg_catalog.jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'registration_enrollment_details_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'rows', p_rows
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id
    and task.type = 'registration'
  for update of track;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select mutation.target_fingerprint, mutation.response_payload
  into v_saved_fingerprint, v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_fingerprint is distinct from v_fingerprint then
      raise exception 'registration_mutation_request_conflict' using errcode = '40001';
    end if;
    return v_response;
  end if;

  perform pg_catalog.set_config(
    'dashboard.registration_status_independent_enrollment', 'on', true
  );
  v_response := public.save_registration_enrollment_rows(
    p_track_id,
    p_rows,
    p_request_key || ':canonical-rows'
  );

  update public.ops_registration_subject_tracks
  set enrollment_detail_rows = p_rows,
      updated_at = pg_catalog.now()
  where id = p_track_id;

  perform dashboard_private.write_registration_track_event(
    v_track.task_id,
    p_track_id,
    'registration_enrollment_details_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'rowCount', pg_catalog.jsonb_array_length(p_rows),
      'canonical', true
    )
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type,
    target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_track.task_id,
    'save_registration_enrollment_details', v_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  owner to postgres;
revoke all on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  to authenticated;

commit;
