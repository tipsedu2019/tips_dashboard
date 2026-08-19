begin;

alter function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text)
  rename to save_registration_enrollment_details_impl_base;

create function dashboard_private.save_registration_enrollment_details_impl(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_track public.ops_registration_subject_tracks%rowtype;
  v_externalized boolean;
  v_rows jsonb;
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_response jsonb;
begin
  if v_actor_id is null or v_request_key is null or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'registration_enrollment_details_invalid' using errcode = '22023';
  end if;
  select track.* into v_track from public.ops_registration_subject_tracks track join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id and task.type = 'registration' for update of track;
  if not found then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  perform dashboard_private.assert_registration_mutation_access(v_track.task_id, v_track.id, 'save_enrollment_rows');
  select exists(
    select 1 from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id and (enrollment.admission_batch_id is not null or enrollment.roster_active)
  ) into v_externalized;
  if not v_externalized then
    return dashboard_private.save_registration_enrollment_details_impl_base(p_track_id, p_rows, p_request_key);
  end if;
  v_rows := dashboard_private.normalize_registration_enrollment_rows_request_v1(p_rows);
  v_fingerprint := pg_catalog.jsonb_build_object('trackId', p_track_id, 'rows', v_rows, 'externalized', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0));
  select mutation.target_fingerprint, mutation.response_payload into v_saved_fingerprint, v_response
  from dashboard_private.ops_registration_mutations mutation where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if v_saved_fingerprint is distinct from v_fingerprint then raise exception 'registration_mutation_request_conflict' using errcode = '40001'; end if;
    return v_response;
  end if;
  update public.ops_registration_subject_tracks
  set enrollment_detail_rows = v_rows, updated_at = pg_catalog.now()
  where id = p_track_id;
  v_response := pg_catalog.jsonb_build_object('trackId', p_track_id, 'rows', v_rows, 'externalReconciliationRequired', true);
  insert into dashboard_private.ops_registration_mutations(actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload)
  values (v_actor_id, v_request_key, v_track.task_id, 'save_registration_enrollment_details_external_correction', v_fingerprint, v_response);
  perform dashboard_private.write_registration_track_event_v2(v_track.task_id, p_track_id, 'registration_enrollment_details_external_correction_saved', v_track.pipeline_status, v_track.pipeline_status, null, pg_catalog.jsonb_build_object('externalReconciliationRequired', true), 'user', null);
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text) owner to postgres;
revoke all on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_enrollment_details_impl(uuid, jsonb, text) to authenticated;

commit;
