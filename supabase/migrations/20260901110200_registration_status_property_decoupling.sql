begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Registration editing is an operations surface. In the current account model
-- directors use the admin role and the management team uses the staff role.
-- A teacher assignment or a track director id is data, not an authorization
-- capability.
create or replace function dashboard_private.assert_registration_mutation_access(
  p_task_id uuid,
  p_track_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  select actor.role
  into v_role
  from public.profiles actor
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where actor.id = v_actor
    and actor.role in ('admin', 'staff');

  if v_actor is null or v_role is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_action in (
    'complete_withdrawal_roster_transition',
    'complete_transfer_roster_transition'
  ) then
    if p_track_id is not null
      or not exists (
        select 1
        from public.ops_tasks task
        where task.id = p_task_id
          and (
            (
              p_action = 'complete_withdrawal_roster_transition'
              and task.type = 'withdrawal'
            )
            or (
              p_action = 'complete_transfer_roster_transition'
              and task.type = 'transfer'
            )
          )
      )
    then
      raise exception 'registration_access_denied' using errcode = '42501';
    end if;
    return;
  end if;

  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_track_id is not null and not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
      and track.task_id = p_task_id
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

alter function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  from public, anon, authenticated, service_role;

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
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  select actor.role
  into v_role
  from public.profiles actor
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where actor.id = v_actor
    and actor.role in ('admin', 'staff');

  if v_actor is null or v_role is null or nullif(pg_catalog.btrim(p_workflow_status), '') is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_tasks task
      on task.id = track.task_id
     and task.type = 'registration'
    where track.id = p_track_id
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

alter function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.assert_registration_observation_manager_access_v1(
  p_track_id uuid
)
returns public.ops_registration_subject_tracks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  join public.profiles actor
    on actor.id = (select auth.uid())
   and actor.role in ('admin', 'staff')
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where track.id = p_track_id;

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_track;
end;
$$;

alter function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  to authenticated;

drop policy if exists ops_registration_observations_select
  on public.ops_registration_observations;
create policy ops_registration_observations_select
on public.ops_registration_observations
for select
to authenticated
using (
  dashboard_private.registration_observation_current_actor_is_active_manager_v1()
);

-- Close the legacy no-track direct-write escape hatch. Normalized registration
-- writes already go through the reviewed RPC surface.
drop policy if exists ops_registration_details_update
  on public.ops_registration_details;
create policy ops_registration_details_update
on public.ops_registration_details
for update
to authenticated
using (
  not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = ops_registration_details.task_id
  )
  and exists (
    select 1
    from public.ops_tasks task
    where task.id = ops_registration_details.task_id
      and task.type = 'registration'
      and dashboard_private.registration_observation_current_actor_is_active_manager_v1()
  )
)
with check (
  not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = ops_registration_details.task_id
  )
  and exists (
    select 1
    from public.ops_tasks task
    where task.id = ops_registration_details.task_id
      and task.type = 'registration'
      and dashboard_private.registration_observation_current_actor_is_active_manager_v1()
  )
);

drop policy if exists ops_tasks_update_v2 on public.ops_tasks;
create policy ops_tasks_update_v2
on public.ops_tasks
for update
to authenticated
using (
  not dashboard_private.registration_task_has_subject_tracks(id)
  and (
    (
      type = 'registration'
      and dashboard_private.registration_observation_current_actor_is_active_manager_v1()
    )
    or (
      type <> 'registration'
      and (
        (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
        or requested_by = (select auth.uid())
        or assignee_id = (select auth.uid())
        or secondary_assignee_id = (select auth.uid())
        or dashboard_private.is_ops_word_retest_teacher(id)
      )
    )
  )
)
with check (
  not dashboard_private.registration_task_has_subject_tracks(id)
  and (
    (
      type = 'registration'
      and dashboard_private.registration_observation_current_actor_is_active_manager_v1()
    )
    or (
      type <> 'registration'
      and (
        (select public.current_dashboard_role()) in ('admin', 'staff', 'assistant')
        or requested_by = (select auth.uid())
        or assignee_id = (select auth.uid())
        or secondary_assignee_id = (select auth.uid())
        or dashboard_private.is_ops_word_retest_teacher(id)
      )
    )
  )
);

drop policy if exists ops_tasks_delete_v2 on public.ops_tasks;
create policy ops_tasks_delete_v2
on public.ops_tasks
for delete
to authenticated
using (
  not dashboard_private.registration_task_has_subject_tracks(id)
  and (
    (
      type = 'registration'
      and dashboard_private.registration_observation_current_actor_is_active_manager_v1()
      and (
        (select public.current_dashboard_role()) = 'admin'
        or status not in ('done', 'canceled')
      )
    )
    or (
      type <> 'registration'
      and (
        (select public.current_dashboard_role()) = 'admin'
        or (
          type = 'general'
          and (
            requested_by = (select auth.uid())
            or assignee_id = (select auth.uid())
            or secondary_assignee_id = (select auth.uid())
          )
        )
        or (
          requested_by = (select auth.uid())
          and status not in ('done', 'canceled')
        )
        or (
          (select public.current_dashboard_role()) = 'staff'
          and (
            type = 'general'
            or status not in ('done', 'canceled')
          )
        )
      )
    )
  )
);

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

  perform 1
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
  where track.id = p_track_id
    and task.type = 'registration'
  order by task.id
  for update of task;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

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
    v_response := v_response || pg_catalog.jsonb_build_object(
      'enrollmentFinalization',
      null
    );
    update dashboard_private.ops_registration_mutations mutation
    set response_payload = v_response
    where mutation.actor_id = v_actor_id
      and mutation.request_key = v_request_key
      and mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status';
    if not found then
      raise exception 'registration_workflow_receipt_missing' using errcode = '23514';
    end if;
    return v_response;
  end if;

  if v_track.workflow_revision <> p_expected_workflow_revision then
    raise exception 'registration_workflow_status_refresh_required'
      using errcode = '23514';
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
    'workflowStatusEnteredAt', v_track.workflow_status_entered_at,
    'enrollmentFinalization', null
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
) is 'Changes only the manual registration status property and its audit record.';

-- Observation used to commandeer the registration status. Restore those rows
-- to their pre-observation manual property without deleting observation facts.
do $registration_workflow_status_decoupled$
declare
  v_track record;
  v_next_status text;
  v_next_revision integer;
begin
  for v_track in
    select
      track.id,
      track.task_id,
      track.workflow_status,
      track.workflow_revision,
      track.observation_return_workflow_status
    from public.ops_registration_subject_tracks track
    where track.workflow_status in (
      'observation_requested',
      'observation_feedback_pending',
      'observation_completed'
    )
    order by track.task_id, track.id
    for update
  loop
    v_next_status := case
      when v_track.observation_return_workflow_status in (
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
      ) then v_track.observation_return_workflow_status
      else 'consultation_completed'
    end;

    update public.ops_registration_subject_tracks track
    set workflow_status = v_next_status,
        workflow_revision = track.workflow_revision + 1,
        workflow_status_entered_at = pg_catalog.now(),
        observation_return_workflow_status = null,
        updated_at = pg_catalog.now()
    where track.id = v_track.id
    returning track.workflow_revision into v_next_revision;

    perform dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_workflow_status_decoupled',
      v_track.workflow_status,
      v_next_status,
      'status_property_decoupling',
      pg_catalog.jsonb_build_object(
        'workflowRevisionBefore', v_track.workflow_revision,
        'workflowRevisionAfter', v_next_revision
      ),
      'migration',
      '20260901110200_registration_status_property_decoupling'
    );
  end loop;
end;
$registration_workflow_status_decoupled$;

commit;
