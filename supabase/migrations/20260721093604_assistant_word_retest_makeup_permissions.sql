begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
      'dashboard_private.ops_task_input_task_v2(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.update_ops_task_v2_impl(uuid,jsonb,timestamptz,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.transition_ops_task_status_v2_impl(uuid,text,timestamptz,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.retry_word_retest_v1_impl(uuid,jsonb,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.request_word_retest_revision_v1_impl(uuid,text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.update_ops_task_v2(uuid,jsonb,timestamptz,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.transition_ops_task_status_v2(uuid,text,timestamptz,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.retry_word_retest_v1(uuid,jsonb,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.request_word_retest_revision_v1(uuid,text,uuid)'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.notification_request_ledger'
    ) is null
  then
    raise exception 'assistant_word_retest_prerequisite_missing' using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.is_authenticated_assistant_request_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.role = 'assistant'
    );
$$;

create or replace function dashboard_private.assert_assistant_word_retest_update_v1(
  p_task_id uuid,
  p_input jsonb,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
  v_requested_status text;
begin
  if not dashboard_private.is_authenticated_assistant_request_v1() then
    return;
  end if;
  if p_task_id is null
    or p_input is null
    or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_expected_updated_at is null
    or p_request_id is null
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  if exists (
    select 1
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id = p_request_id
  ) then
    return;
  end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found or v_task.type <> 'word_retest' then
    return;
  end if;

  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found then
    raise exception 'word_retest_assistant_action_not_allowed' using errcode = '42501';
  end if;

  v_requested_status := coalesce(
    nullif(
      dashboard_private.ops_task_input_task_v2(p_input) ->> 'status',
      ''
    ),
    v_task.status
  );
  if v_task.status not in ('requested', 'confirmed', 'in_progress', 'on_hold')
    or v_detail.retest_status not in ('not_started', 'in_progress')
    or v_requested_status is distinct from v_task.status
    or (
      v_task.status in ('requested', 'confirmed')
      and v_detail.retest_status <> 'not_started'
    )
    or (
      v_task.status = 'in_progress'
      and v_detail.retest_status <> 'in_progress'
    )
  then
    raise exception 'word_retest_assistant_action_not_allowed' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_assistant_word_retest_transition_v1(
  p_task_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
begin
  if not dashboard_private.is_authenticated_assistant_request_v1() then
    return;
  end if;
  if p_task_id is null
    or p_status is null
    or p_expected_updated_at is null
    or p_request_id is null
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  if exists (
    select 1
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id = p_request_id
  ) then
    return;
  end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found or v_task.type <> 'word_retest' then
    return;
  end if;

  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found
    or v_task.status not in ('requested', 'confirmed', 'on_hold')
    or p_status is distinct from 'in_progress'
    or (
      v_task.status in ('requested', 'confirmed')
      and v_detail.retest_status <> 'not_started'
    )
    or (
      v_task.status = 'on_hold'
      and v_detail.retest_status not in ('not_started', 'in_progress')
    )
  then
    raise exception 'word_retest_assistant_action_not_allowed' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_assistant_word_retest_teacher_action_v1()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if dashboard_private.is_authenticated_assistant_request_v1() then
    raise exception 'word_retest_assistant_action_not_allowed' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.update_ops_task_v2(
  p_task_id uuid,
  p_input jsonb,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_word_retest_update_v1(
    p_task_id,
    p_input,
    p_expected_updated_at,
    p_request_id
  );
  return dashboard_private.update_ops_task_v2_impl(
    p_task_id,
    p_input,
    p_expected_updated_at,
    p_request_id
  );
end;
$$;

create or replace function public.transition_ops_task_status_v2(
  p_task_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_word_retest_transition_v1(
    p_task_id,
    p_status,
    p_expected_updated_at,
    p_request_id
  );
  return dashboard_private.transition_ops_task_status_v2_impl(
    p_task_id,
    p_status,
    p_expected_updated_at,
    p_request_id
  );
end;
$$;

create or replace function public.retry_word_retest_v1(
  p_previous_task_id uuid,
  p_input jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_word_retest_teacher_action_v1();
  return dashboard_private.retry_word_retest_v1_impl(
    p_previous_task_id,
    p_input,
    p_request_id
  );
end;
$$;

create or replace function public.request_word_retest_revision_v1(
  p_task_id uuid,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_word_retest_teacher_action_v1();
  return dashboard_private.request_word_retest_revision_v1_impl(
    p_task_id,
    p_reason,
    p_request_id
  );
end;
$$;

alter function dashboard_private.is_authenticated_assistant_request_v1()
  owner to postgres;
alter function dashboard_private.assert_assistant_word_retest_update_v1(
  uuid, jsonb, timestamptz, uuid
) owner to postgres;
alter function dashboard_private.assert_assistant_word_retest_transition_v1(
  uuid, text, timestamptz, uuid
) owner to postgres;
alter function dashboard_private.assert_assistant_word_retest_teacher_action_v1()
  owner to postgres;

alter function public.update_ops_task_v2(uuid, jsonb, timestamptz, uuid)
  owner to postgres;
alter function public.transition_ops_task_status_v2(uuid, text, timestamptz, uuid)
  owner to postgres;
alter function public.retry_word_retest_v1(uuid, jsonb, uuid)
  owner to postgres;
alter function public.request_word_retest_revision_v1(uuid, text, uuid)
  owner to postgres;

revoke all on function dashboard_private.is_authenticated_assistant_request_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_assistant_word_retest_update_v1(
  uuid, jsonb, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_assistant_word_retest_transition_v1(
  uuid, text, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_assistant_word_retest_teacher_action_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.update_ops_task_v2(uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_ops_task_status_v2(uuid, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_word_retest_v1(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_word_retest_revision_v1(uuid, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.update_ops_task_v2(uuid, jsonb, timestamptz, uuid)
  to authenticated;
grant execute on function public.transition_ops_task_status_v2(uuid, text, timestamptz, uuid)
  to authenticated;
grant execute on function public.retry_word_retest_v1(uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.request_word_retest_revision_v1(uuid, text, uuid)
  to authenticated;

commit;
