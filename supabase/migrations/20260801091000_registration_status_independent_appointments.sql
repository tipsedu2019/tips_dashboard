begin;

set local lock_timeout = '5s';
lock table public.ops_registration_appointments in share row exclusive mode;
lock table public.ops_registration_level_tests in share row exclusive mode;
lock table public.ops_registration_consultations in share row exclusive mode;
lock table dashboard_private.ops_registration_mutations in share row exclusive mode;

create function dashboard_private.save_registration_appointment_details_impl(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_expected_notification_revision integer,
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
  v_place text := nullif(pg_catalog.btrim(p_place), '');
  v_track_ids uuid[];
  v_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_response jsonb;
  v_appointment public.ops_registration_appointments%rowtype;
  v_appointment_id uuid;
  v_activity_id uuid;
  v_activity_ids uuid[] := array[]::uuid[];
  v_track record;
  v_existing_track_ids uuid[];
  v_changed boolean := false;
begin
  if v_actor_id is null then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  if v_request_key is null then raise exception 'request_key_required' using errcode = '22023'; end if;
  if p_kind not in ('level_test', 'visit_consultation') or p_scheduled_at is null or v_place is null then
    raise exception 'registration_appointment_details_invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct item order by item), array[]::uuid[]) into v_track_ids
  from unnest(coalesce(p_track_ids, array[]::uuid[])) item where item is not null;
  if cardinality(v_track_ids) not between 1 and 2 then raise exception 'registration_appointment_tracks_required' using errcode = '22023'; end if;
  v_fingerprint := jsonb_build_object('appointmentId', p_appointment_id, 'taskId', p_task_id, 'kind', p_kind, 'scheduledAt', p_scheduled_at, 'place', v_place, 'trackIds', to_jsonb(v_track_ids), 'expectedNotificationRevision', p_expected_notification_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0));
  select mutation.target_fingerprint, mutation.response_payload into v_saved_fingerprint, v_saved_response
  from dashboard_private.ops_registration_mutations mutation where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if v_saved_fingerprint is distinct from v_fingerprint then raise exception 'registration_mutation_request_conflict' using errcode = '40001'; end if;
    return v_saved_response;
  end if;
  perform 1 from public.ops_tasks task where task.id = p_task_id and task.type = 'registration' for update;
  if not found then raise exception 'registration_appointment_task_mismatch' using errcode = '22023'; end if;
  perform dashboard_private.assert_registration_mutation_access(p_task_id, null, 'save_appointment');
  perform 1 from public.ops_registration_subject_tracks track where track.task_id = p_task_id order by track.id for update;
  if (select count(*) from public.ops_registration_subject_tracks track where track.task_id = p_task_id and track.id = any(v_track_ids)) <> cardinality(v_track_ids) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '22023';
  end if;
  if p_appointment_id is not null then
    select appointment.* into v_appointment from public.ops_registration_appointments appointment
    where appointment.id = p_appointment_id and appointment.task_id = p_task_id for update;
    if not found or v_appointment.kind <> p_kind then raise exception 'registration_appointment_task_mismatch' using errcode = '22023'; end if;
    if v_appointment.notification_revision is distinct from p_expected_notification_revision then raise exception 'registration_appointment_revision_conflict' using errcode = '40001'; end if;
    select coalesce(array_agg(distinct activity.track_id order by activity.track_id), array[]::uuid[]) into v_existing_track_ids
    from (select attempt.track_id from public.ops_registration_level_tests attempt where p_kind = 'level_test' and attempt.appointment_id = p_appointment_id union all select consultation.track_id from public.ops_registration_consultations consultation where p_kind = 'visit_consultation' and consultation.appointment_id = p_appointment_id) activity;
    if v_existing_track_ids is distinct from v_track_ids then raise exception 'registration_appointment_participants_locked' using errcode = '23514'; end if;
    v_changed := v_appointment.scheduled_at is distinct from p_scheduled_at or v_appointment.place is distinct from v_place;
    update public.ops_registration_appointments appointment set scheduled_at = p_scheduled_at, place = v_place, notification_revision = case when v_changed then appointment.notification_revision + 1 else appointment.notification_revision end, updated_at = pg_catalog.now() where appointment.id = p_appointment_id returning * into v_appointment;
    v_appointment_id := v_appointment.id;
  else
    insert into public.ops_registration_appointments(task_id, kind, scheduled_at, place, status, notification_revision, created_by)
    values (p_task_id, p_kind, p_scheduled_at, v_place, 'scheduled', 1, v_actor_id) returning * into v_appointment;
    v_appointment_id := v_appointment.id;
    for v_track in select track.* from public.ops_registration_subject_tracks track where track.id = any(v_track_ids) order by track.id loop
      if p_kind = 'level_test' then
        insert into public.ops_registration_level_tests(track_id, appointment_id, attempt_number, status)
        values (v_track.id, v_appointment_id, coalesce((select max(attempt_number) + 1 from public.ops_registration_level_tests where track_id = v_track.id), 1), 'scheduled') returning id into v_activity_id;
      else
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        insert into public.ops_registration_consultations(track_id, appointment_id, mode, status, director_profile_id)
        values (v_track.id, v_appointment_id, 'visit', 'scheduled', v_track.director_profile_id) returning id into v_activity_id;
      end if;
      v_activity_ids := array_append(v_activity_ids, v_activity_id);
    end loop;
  end if;
  for v_track in select track.* from public.ops_registration_subject_tracks track where track.id = any(v_track_ids) order by track.id loop
    perform dashboard_private.write_registration_track_event(p_task_id, v_track.id, 'registration_appointment_details_saved', v_track.pipeline_status, v_track.pipeline_status, null, jsonb_build_object('appointmentId', v_appointment_id, 'kind', p_kind, 'scheduledAt', p_scheduled_at, 'place', v_place, 'notificationRevision', v_appointment.notification_revision, 'changed', v_changed));
  end loop;
  v_saved_response := jsonb_build_object('taskId', p_task_id, 'appointmentId', v_appointment_id, 'notificationRevision', v_appointment.notification_revision, 'trackIds', to_jsonb(v_track_ids), 'activityIds', to_jsonb(v_activity_ids), 'requiresDirectorAssignmentTrackIds', '[]'::jsonb, 'notificationTargets', '[]'::jsonb);
  insert into dashboard_private.ops_registration_mutations(actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload) values (v_actor_id, v_request_key, p_task_id, 'save_registration_appointment_details', v_fingerprint, v_saved_response);
  return v_saved_response;
end;
$$;

create function public.save_registration_appointment_details_v1(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_expected_notification_revision integer,
  p_request_key text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select dashboard_private.save_registration_appointment_details_impl($1, $2, $3, $4, $5, $6, $7, $8);
$$;
revoke execute on function public.save_registration_appointment_details_v1(uuid, uuid, text, timestamptz, text, uuid[], integer, text) from public, anon;
grant execute on function public.save_registration_appointment_details_v1(uuid, uuid, text, timestamptz, text, uuid[], integer, text) to authenticated;

create function dashboard_private.save_registration_level_test_result_impl(p_attempt_id uuid, p_status text, p_material_link text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.ops_registration_level_tests%rowtype; v_track public.ops_registration_subject_tracks%rowtype; v_link text := nullif(pg_catalog.btrim(p_material_link), ''); begin
  if auth.uid() is null then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  if nullif(pg_catalog.btrim(p_request_key), '') is null or p_status not in ('completed', 'absent', 'canceled') or (p_status = 'completed' and v_link is null) then raise exception 'registration_level_test_result_invalid' using errcode = '22023'; end if;
  select attempt, track into v_attempt, v_track from public.ops_registration_level_tests attempt join public.ops_registration_subject_tracks track on track.id = attempt.track_id where attempt.id = p_attempt_id for update of attempt, track;
  if not found then raise exception 'registration_level_test_not_found' using errcode = 'P0002'; end if;
  perform dashboard_private.assert_registration_mutation_access(v_track.task_id, v_track.id, 'complete_level_test');
  update public.ops_registration_level_tests set status = p_status, material_link = case when p_status = 'completed' then v_link else null end, completed_at = coalesce(completed_at, pg_catalog.now()), updated_at = pg_catalog.now() where id = p_attempt_id returning * into v_attempt;
  perform dashboard_private.write_registration_track_event(v_track.task_id, v_track.id, 'registration_level_test_result_saved', v_track.pipeline_status, v_track.pipeline_status, null, jsonb_build_object('attemptId', p_attempt_id, 'status', p_status));
  return jsonb_build_object('attemptId', v_attempt.id, 'trackId', v_track.id, 'status', v_attempt.status, 'materialLink', v_attempt.material_link);
end;
$$;
create function public.save_registration_level_test_result_v1(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
) returns jsonb language sql security invoker set search_path = '' as $$ select dashboard_private.save_registration_level_test_result_impl($1, $2, $3, $4); $$;
revoke execute on function public.save_registration_level_test_result_v1(uuid, text, text, text) from public, anon;
grant execute on function public.save_registration_level_test_result_v1(uuid, text, text, text) to authenticated;

create function dashboard_private.save_registration_consultation_details_impl(p_consultation_id uuid, p_status text, p_outcome text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_consultation public.ops_registration_consultations%rowtype; v_track public.ops_registration_subject_tracks%rowtype; begin
  if auth.uid() is null then raise exception 'registration_access_denied' using errcode = '42501'; end if;
  if nullif(pg_catalog.btrim(p_request_key), '') is null or p_status not in ('waiting', 'scheduled', 'completed', 'canceled') or (p_status = 'completed' and p_outcome not in ('enrollment', 'waiting', 'not_registered')) or (p_status <> 'completed' and p_outcome is not null) then raise exception 'registration_consultation_details_invalid' using errcode = '22023'; end if;
  select consultation, track into v_consultation, v_track from public.ops_registration_consultations consultation join public.ops_registration_subject_tracks track on track.id = consultation.track_id where consultation.id = p_consultation_id for update of consultation, track;
  if not found then raise exception 'registration_consultation_not_found' using errcode = 'P0002'; end if;
  perform dashboard_private.assert_registration_mutation_access(v_track.task_id, v_track.id, 'complete_consultation');
  update public.ops_registration_consultations set status = p_status, outcome = p_outcome, completed_at = case when p_status = 'completed' then coalesce(completed_at, pg_catalog.now()) else null end, updated_at = pg_catalog.now() where id = p_consultation_id returning * into v_consultation;
  perform dashboard_private.write_registration_track_event(v_track.task_id, v_track.id, 'registration_consultation_details_saved', v_track.pipeline_status, v_track.pipeline_status, null, jsonb_build_object('consultationId', p_consultation_id, 'status', p_status, 'outcome', p_outcome));
  return jsonb_build_object('consultationId', v_consultation.id, 'trackId', v_track.id, 'status', v_consultation.status, 'outcome', v_consultation.outcome);
end;
$$;
create function public.save_registration_consultation_details_v1(
  p_consultation_id uuid,
  p_status text,
  p_outcome text,
  p_request_key text
) returns jsonb language sql security invoker set search_path = '' as $$ select dashboard_private.save_registration_consultation_details_impl($1, $2, $3, $4); $$;
revoke execute on function public.save_registration_consultation_details_v1(uuid, text, text, text) from public, anon;
grant execute on function public.save_registration_consultation_details_v1(uuid, text, text, text) to authenticated;

commit;
