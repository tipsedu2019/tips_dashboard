begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Registration data is an operations-owned table surface.  A caller id carried
-- through a SECURITY DEFINER RPC remains authoritative, so the final write
-- boundary must verify both the profile role and the current auth account.
create or replace function dashboard_private.registration_actor_is_active_manager_v1(
  p_actor_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_profile_id is not null
    and exists (
      select 1
      from public.profiles actor
      join auth.users account
        on account.id = actor.id
       and account.deleted_at is null
       and (
         account.banned_until is null
         or account.banned_until <= pg_catalog.now()
       )
      where actor.id = p_actor_profile_id
        and actor.role in ('admin', 'staff')
    );
$$;

create or replace function dashboard_private.assert_registration_actor_is_active_manager_v1(
  p_actor_profile_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not dashboard_private.registration_actor_is_active_manager_v1(
    p_actor_profile_id
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_registration_task_replay_access_v1(
  p_task_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_type text;
begin
  if p_task_id is null then
    return;
  end if;

  select task.type
  into v_task_type
  from public.ops_tasks task
  where task.id = p_task_id;
  if not found then
    raise exception 'ops_task_not_found' using errcode = 'P0002';
  end if;

  if v_task_type = 'registration' then
    perform dashboard_private.assert_registration_actor_is_active_manager_v1(
      (select auth.uid())
    );
  end if;
end;
$$;

create or replace function dashboard_private.enforce_registration_manager_write_fence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_registration_write boolean := true;
begin
  -- Internal and service-owned projections have no end-user actor and retain
  -- their existing behavior.  Every JWT-backed registration writer is fenced.
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'ops_tasks' then
    if tg_op = 'INSERT' then
      v_registration_write := new.type = 'registration';
    elsif tg_op = 'DELETE' then
      v_registration_write := old.type = 'registration';
    else
      v_registration_write := old.type = 'registration'
        or new.type = 'registration';
    end if;
  end if;

  if v_registration_write
    and not dashboard_private.registration_actor_is_active_manager_v1(v_actor)
  then
    raise exception 'registration_manager_write_access_denied'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter function dashboard_private.registration_actor_is_active_manager_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_registration_actor_is_active_manager_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_registration_task_replay_access_v1(uuid)
  owner to postgres;
alter function dashboard_private.enforce_registration_manager_write_fence_v1()
  owner to postgres;

revoke all on function dashboard_private.registration_actor_is_active_manager_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_actor_is_active_manager_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_task_replay_access_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.enforce_registration_manager_write_fence_v1()
  from public, anon, authenticated, service_role;

do $registration_manager_write_triggers$
declare
  v_table record;
begin
  for v_table in
    select relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and (
        relation.relname = 'ops_tasks'
        or pg_catalog.substr(relation.relname, 1, 17) = 'ops_registration_'
      )
    order by relation.relname
  loop
    execute pg_catalog.format(
      'drop trigger if exists enforce_registration_manager_write_fence_v1 on public.%I',
      v_table.relname
    );
    execute pg_catalog.format(
      'create trigger enforce_registration_manager_write_fence_v1 '
        || 'before insert or update or delete on public.%I '
        || 'for each row execute function '
        || 'dashboard_private.enforce_registration_manager_write_fence_v1()',
      v_table.relname
    );
  end loop;
end;
$registration_manager_write_triggers$;

-- The browser-side authenticated client performs this scope check before the
-- service-role client may read a dispatch plan.  Non-registration workflows
-- retain their existing actor/assignee rules in the generic plan RPC.
create or replace function public.authorize_registration_legacy_dispatch_v1(
  p_source_event_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_registration_source boolean;
begin
  if p_source_event_id is null then
    raise exception 'registration_legacy_dispatch_invalid' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.ops_task_events source_event
    join public.ops_tasks task
      on task.id = source_event.task_id
     and task.type = 'registration'
    where source_event.id = p_source_event_id
  )
  into v_registration_source;

  if not v_registration_source then
    return false;
  end if;

  if not dashboard_private.registration_actor_is_active_manager_v1(
    (select auth.uid())
  ) then
    raise exception 'registration_legacy_dispatch_access_denied'
      using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.list_registration_legacy_source_ids_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_source_ids jsonb;
begin
  if p_task_id is null
    or not dashboard_private.registration_actor_is_active_manager_v1(v_actor)
  then
    raise exception 'registration_legacy_source_access_denied'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(event_row.id order by event_row.created_at, event_row.id),
    '[]'::jsonb
  )
  into v_source_ids
  from public.ops_task_events event_row
  join dashboard_private.notification_events canonical
    on canonical.workflow_key = 'registration'
   and canonical.source_type = 'ops_task_event'
   and canonical.source_id = event_row.id::text
   and canonical.occurrence_key = event_row.id::text
  where event_row.task_id = p_task_id
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started',
      'registration.registration_completed',
      'registration.case_closed'
    );

  return pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'sourceEventIds', v_source_ids
  );
end;
$$;

-- Preserve the fully patched archived-subject plan as a private base and put an
-- active-manager check in front of every service-role plan read.
alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  rename to get_registration_core_legacy_dispatch_plan_v1_base;

revoke all on function public.get_registration_core_legacy_dispatch_plan_v1_base(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_registration_core_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(
    p_actor_profile_id
  );
  return public.get_registration_core_legacy_dispatch_plan_v1_base(
    p_source_event_id,
    p_actor_profile_id
  );
end;
$$;

-- Public replay boundaries authorize the current account before the private
-- implementation is allowed to read an idempotency receipt.
create or replace function public.add_ops_task_comment_v2(
  p_task_id uuid,
  p_body text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_task_replay_access_v1(p_task_id);
  return dashboard_private.add_ops_task_comment_v2_impl(
    p_task_id,
    p_body,
    p_request_id
  );
end;
$$;

create or replace function public.record_ops_task_activity_event_v1(
  p_task_id uuid,
  p_event_type text,
  p_field_name text,
  p_before_value text,
  p_after_value text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_task_replay_access_v1(p_task_id);
  return dashboard_private.record_ops_task_activity_event_v1_impl(
    p_task_id,
    p_event_type,
    p_field_name,
    p_before_value,
    p_after_value,
    p_request_id
  );
end;
$$;

create or replace function public.delete_registration_case_v1(
  p_task_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(
    (select auth.uid())
  );
  return dashboard_private.delete_registration_case_v1_impl(
    p_task_id,
    p_request_id
  );
end;
$$;

create or replace function public.save_registration_consultation_result_v2(
  p_consultation_id uuid,
  p_outcome text,
  p_note text,
  p_waiting_kind text,
  p_class_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_appointment_id uuid;
  v_task_id uuid;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(
    (select auth.uid())
  );

  v_response := public.save_registration_consultation_result_v2_base(
    p_consultation_id,
    p_outcome,
    p_note,
    p_waiting_kind,
    p_class_id,
    p_expected_workflow_revision,
    p_request_key
  );

  select consultation.appointment_id, track.task_id
  into v_appointment_id, v_task_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where consultation.id = p_consultation_id;

  if v_appointment_id is not null then
    perform dashboard_private.reconcile_registration_appointment_parent_v1(
      v_appointment_id
    );
  end if;
  if v_task_id is not null then
    perform dashboard_private.recompute_registration_parent(v_task_id);
  end if;

  return v_response;
end;
$$;

-- Keep deterministic domain conflicts non-retryable in the final ordered
-- definition, regardless of earlier historical definitions.
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
  if not found
    or v_appointment.kind not in ('level_test', 'visit_consultation')
  then
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

create or replace function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.pipeline_status is not distinct from old.pipeline_status
  then
    return null;
  end if;

  for v_appointment_id in
    select distinct attempt.appointment_id
    from public.ops_registration_level_tests attempt
    where attempt.track_id = coalesce(new.id, old.id)
    union
    select distinct consultation.appointment_id
    from public.ops_registration_consultations consultation
    where consultation.track_id = coalesce(new.id, old.id)
      and consultation.appointment_id is not null
  loop
    perform dashboard_private.assert_registration_appointment_integrity_v1(
      v_appointment_id
    );
  end loop;
  return null;
end;
$$;

alter function public.authorize_registration_legacy_dispatch_v1(uuid)
  owner to postgres;
alter function public.list_registration_legacy_source_ids_v1(uuid)
  owner to postgres;
alter function public.get_registration_core_legacy_dispatch_plan_v1_base(uuid, uuid)
  owner to postgres;
alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function public.add_ops_task_comment_v2(uuid, text, uuid)
  owner to postgres;
alter function public.record_ops_task_activity_event_v1(uuid, text, text, text, text, uuid)
  owner to postgres;
alter function public.delete_registration_case_v1(uuid, uuid)
  owner to postgres;
alter function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
  owner to postgres;

revoke all on function public.authorize_registration_legacy_dispatch_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_registration_legacy_dispatch_v1(uuid)
  to authenticated;

revoke all on function public.list_registration_legacy_source_ids_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_registration_legacy_source_ids_v1(uuid)
  to authenticated;

revoke all on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;

revoke all on function public.add_ops_task_comment_v2(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.add_ops_task_comment_v2(uuid, text, uuid)
  to authenticated;

revoke all on function public.record_ops_task_activity_event_v1(
  uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.record_ops_task_activity_event_v1(
  uuid, text, text, text, text, uuid
) to authenticated;

revoke all on function public.delete_registration_case_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_registration_case_v1(uuid, uuid)
  to authenticated;

revoke all on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) to authenticated;

revoke all on function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
  from public, anon, authenticated, service_role;

comment on function dashboard_private.enforce_registration_manager_write_fence_v1()
  is 'Rejects every JWT-backed registration-domain table write unless the current account is an active admin/staff, while retaining null-actor internal writers.';
comment on function public.authorize_registration_legacy_dispatch_v1(uuid)
  is 'Authenticated preflight for the legacy route: registration sources require an active admin/staff before service-plan access; other task workflows are unchanged.';

notify pgrst, 'reload schema';

commit;
