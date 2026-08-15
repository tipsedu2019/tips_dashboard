begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.ops_registration_consultations'::regclass
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%outcome%'
  loop
    execute pg_catalog.format(
      'alter table public.ops_registration_consultations drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_outcome_check check (
    outcome is null or outcome in ('undecided', 'waiting', 'observation', 'enrollment', 'not_registered')
  ),
  add constraint ops_registration_consultations_completion_check check (
    status <> 'completed' or (completed_at is not null and outcome is not null)
  );

create or replace function public.save_registration_consultation_result_v2(
  p_consultation_id uuid,
  p_outcome text,
  p_note text,
  p_waiting_kind text,
  p_class_id uuid,
  p_expected_workflow_revision integer,
  p_request_key uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_outcome text := pg_catalog.lower(nullif(pg_catalog.btrim(p_outcome), ''));
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task public.ops_tasks%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_wait public.ops_registration_enrollments%rowtype;
  v_target_workflow_status text;
  v_target_pipeline_status text;
  v_prepared_enrollment_id uuid;
  v_response jsonb;
  v_fingerprint jsonb;
begin
  if v_actor is null or p_consultation_id is null or p_request_key is null
    or p_expected_workflow_revision is null or p_expected_workflow_revision < 1
    or v_outcome not in ('undecided', 'waiting', 'observation', 'enrollment', 'not_registered')
  then
    raise exception 'registration_consultation_result_invalid' using errcode = '22023';
  end if;
  if v_outcome = 'waiting' then
    if v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening') then
      raise exception 'waiting_kind_required' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_waiting_kind is not null or p_class_id is not null then
    raise exception 'registration_consultation_waiting_fields_not_allowed' using errcode = '22023';
  end if;

  select consultation.* into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id;
  if not found then raise exception 'registration_consultation_not_found' using errcode = 'P0002'; end if;

  select task.* into strict v_task
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track on track.task_id = task.id
  where track.id = v_consultation.track_id
  for update of task;

  perform 1 from public.ops_registration_details detail
  where detail.task_id = v_task.id for update;
  perform 1 from public.ops_registration_subject_tracks track
  where track.task_id = v_task.id order by track.id for update;
  perform 1 from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task.id order by consultation.id for update of consultation;
  perform 1 from public.ops_registration_observations observation
  where observation.task_id = v_task.id order by observation.id for update;
  perform 1 from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task.id order by enrollment.id for update of enrollment;

  select track.* into strict v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_consultation.track_id;
  select consultation.* into strict v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id;

  if v_track.director_profile_id is distinct from v_actor
    or v_consultation.director_profile_id is distinct from v_actor
    or public.current_dashboard_role() not in ('admin', 'staff', 'teacher')
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_consultation_result_refresh_required' using errcode = '40001';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'outcome', v_outcome,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'workflowRevision', p_expected_workflow_revision
  );
  select mutation.response_payload into v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor and mutation.request_key = p_request_key::text
    and mutation.mutation_type = 'save_consultation_result_v2'
    and mutation.target_fingerprint = v_fingerprint;
  if found then return v_response; end if;
  if exists (
    select 1 from dashboard_private.ops_registration_mutations mutation
    where mutation.actor_id = v_actor and mutation.request_key = p_request_key::text
  ) then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;

  select observation.* into v_observation
  from public.ops_registration_observations observation
  where observation.track_id = v_track.id
  order by observation.created_at desc, observation.id desc limit 1;
  if v_outcome <> 'observation'
    and v_observation.id is not null
    and v_observation.status in ('scheduled', 'attended_feedback_pending')
  then
    raise exception 'registration_observation_transition_requires_action' using errcode = '55000';
  end if;

  if v_outcome = 'enrollment' and v_track.waiting_kind = 'current_class' then
    select enrollment.* into v_wait
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = v_track.id
      and enrollment.status = 'waitlisted' and enrollment.roster_active
    order by enrollment.created_at desc, enrollment.id desc limit 1;
    if v_wait.id is not null then
      perform dashboard_private.apply_student_class_roster_mode(
        v_wait.student_id, v_wait.class_id, 'removed', 'waitlist', v_wait.id,
        'registration_waiting_promoted', v_actor
      );
      update public.ops_registration_enrollments enrollment
      set status = 'canceled', roster_active = false, updated_at = pg_catalog.now()
      where enrollment.id = v_wait.id;
      update public.ops_registration_enrollments enrollment
      set status = 'canceled', updated_at = pg_catalog.now()
      where enrollment.track_id = v_track.id
        and enrollment.status = 'planned' and enrollment.admission_batch_id is null;
      insert into public.ops_registration_enrollments(
        track_id, class_id, status, roster_active, sort_order
      ) values (v_track.id, v_wait.class_id, 'planned', false, 0)
      returning id into v_prepared_enrollment_id;
    end if;
  end if;

  v_target_workflow_status := case v_outcome
    when 'undecided' then 'consultation_completed'
    when 'waiting' then case v_waiting_kind
      when 'current_class' then 'waiting_current_class'
      when 'current_term_opening' then 'waiting_new_class'
      else 'waiting_next_opening'
    end
    when 'observation' then 'observation_requested'
    when 'enrollment' then 'enrollment_requested'
    else 'not_registered'
  end;
  v_target_pipeline_status := case v_outcome
    when 'waiting' then 'waiting'
    when 'enrollment' then 'enrollment_decided'
    when 'not_registered' then 'not_registered'
    else 'consultation_waiting'
  end;

  update public.ops_registration_consultations consultation
  set status = 'completed', completed_at = coalesce(consultation.completed_at, pg_catalog.now()),
      outcome = v_outcome, note = v_note, updated_at = pg_catalog.now()
  where consultation.id = v_consultation.id;

  update public.ops_registration_subject_tracks track
  set workflow_status = v_target_workflow_status,
      workflow_revision = track.workflow_revision + 1,
      workflow_status_entered_at = pg_catalog.now(),
      observation_return_workflow_status = case
        when v_outcome = 'observation' then coalesce(
          track.observation_return_workflow_status,
          case when track.workflow_status in ('consultation_completed', 'waiting_current_class', 'waiting_new_class', 'waiting_next_opening')
            then track.workflow_status else 'consultation_completed' end
        ) else null end,
      pipeline_status = v_target_pipeline_status,
      waiting_kind = case when v_outcome = 'waiting' then v_waiting_kind else null end,
      stage_entered_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where track.id = v_track.id;

  select pg_catalog.jsonb_build_object(
    'consultation_id', v_consultation.id, 'status', 'completed',
    'outcome', v_outcome, 'note', v_note, 'track_id', v_track.id,
    'workflow_status', v_target_workflow_status,
    'workflow_revision', p_expected_workflow_revision + 1,
    'waiting_kind', case when v_outcome = 'waiting' then v_waiting_kind else null end,
    'active_enrollment_id', null,
    'prepared_enrollment_id', v_prepared_enrollment_id
  ) into v_response;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (v_actor, p_request_key::text, v_task.id, 'save_consultation_result_v2', v_fingerprint, v_response);
  perform dashboard_private.write_registration_track_event(
    v_task.id, v_track.id, 'registration_consultation_result_saved',
    v_track.pipeline_status, v_target_pipeline_status, null,
    pg_catalog.jsonb_build_object('outcome', v_outcome, 'workflowStatus', v_target_workflow_status)
  );
  return v_response;
end;
$$;

alter function public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid) owner to postgres;
revoke all on function public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_registration_consultation_result_v2(uuid,text,text,text,uuid,integer,uuid)
  to authenticated;

commit;
