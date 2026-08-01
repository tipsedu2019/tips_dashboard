begin;

set local lock_timeout = '5s';
lock table public.ops_registration_subject_tracks in share row exclusive mode;
lock table dashboard_private.ops_registration_mutations in share row exclusive mode;

alter table public.ops_registration_subject_tracks
  add column if not exists enrollment_detail_rows jsonb not null default '[]'::jsonb,
  add constraint ops_registration_subject_tracks_enrollment_detail_rows_array_check
    check (pg_catalog.jsonb_typeof(enrollment_detail_rows) = 'array') not valid;

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
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_response jsonb;
begin
  if v_actor_id is null or v_request_key is null or p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'registration_enrollment_details_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.jsonb_build_object('trackId', p_track_id, 'rows', p_rows);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0));
  select mutation.target_fingerprint, mutation.response_payload into v_saved_fingerprint, v_response
  from dashboard_private.ops_registration_mutations mutation where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if v_saved_fingerprint is distinct from v_fingerprint then raise exception 'registration_mutation_request_conflict' using errcode = '40001'; end if;
    return v_response;
  end if;
  select track.* into v_track from public.ops_registration_subject_tracks track join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id and task.type = 'registration' for update of track;
  if not found then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  perform dashboard_private.assert_registration_mutation_access(v_track.task_id, v_track.id, 'save_enrollment_rows');
  update public.ops_registration_subject_tracks set enrollment_detail_rows = p_rows, updated_at = pg_catalog.now() where id = p_track_id;
  perform dashboard_private.write_registration_track_event(v_track.task_id, p_track_id, 'registration_enrollment_details_saved', v_track.pipeline_status, v_track.pipeline_status, null, pg_catalog.jsonb_build_object('rowCount', pg_catalog.jsonb_array_length(p_rows)));
  v_response := pg_catalog.jsonb_build_object('trackId', p_track_id, 'rows', p_rows);
  insert into dashboard_private.ops_registration_mutations(actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload)
  values (v_actor_id, v_request_key, v_track.task_id, 'save_registration_enrollment_details', v_fingerprint, v_response);
  return v_response;
end;
$$;

create function public.save_registration_enrollment_details_v1(p_track_id uuid, p_rows jsonb, p_request_key text)
returns jsonb language sql security invoker set search_path = '' as $$
  select dashboard_private.save_registration_enrollment_details_impl($1, $2, $3);
$$;
revoke execute on function public.save_registration_enrollment_details_v1(uuid, jsonb, text) from public, anon;
grant execute on function public.save_registration_enrollment_details_v1(uuid, jsonb, text) to authenticated;

commit;
