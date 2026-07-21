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
    or pg_catalog.to_regprocedure(
      'public.current_dashboard_role()'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.visible_dashboard_notification_rows_v1(uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.create_makeup_request_v2(jsonb,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.transition_makeup_request_v2(uuid,text,jsonb,text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.delete_makeup_request_v2(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.create_makeup_request_v2_unguarded(jsonb,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'dashboard_private.transition_makeup_request_v2_unguarded(uuid,text,jsonb,text,uuid)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'dashboard_private.delete_makeup_request_v2_unguarded(uuid,uuid)'
    ) is not null
    or pg_catalog.to_regclass(
      'dashboard_private.notification_request_ledger'
    ) is null
    or pg_catalog.to_regclass('public.makeup_requests') is null
    or pg_catalog.to_regclass('public.makeup_request_events') is null
    or pg_catalog.to_regclass('public.makeup_notification_settings') is null
    or pg_catalog.to_regclass('public.makeup_notification_deliveries') is null
    or pg_catalog.to_regclass('public.dashboard_notifications') is null
  then
    raise exception 'assistant_permission_prerequisite_missing' using errcode = '55000';
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
  v_requested_detail jsonb;
  v_requested_retest_status text;
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
  v_requested_detail := dashboard_private.ops_task_input_detail_v2(
    p_input,
    'word_retest'
  );
  v_requested_retest_status := case
    when v_requested_detail ? 'retest_status' then coalesce(
      nullif(v_requested_detail ->> 'retest_status', ''),
      'not_started'
    )
    else v_detail.retest_status
  end;
  if v_task.status not in ('requested', 'confirmed', 'in_progress', 'on_hold')
    or v_detail.retest_status not in ('not_started', 'in_progress')
    or v_requested_status is distinct from v_task.status
    or v_requested_retest_status is distinct from v_detail.retest_status
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

drop policy if exists makeup_requests_assistant_hard_deny
  on public.makeup_requests;
create policy makeup_requests_assistant_hard_deny
  on public.makeup_requests
  as restrictive
  for all
  to authenticated
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

drop policy if exists makeup_request_events_assistant_hard_deny
  on public.makeup_request_events;
create policy makeup_request_events_assistant_hard_deny
  on public.makeup_request_events
  as restrictive
  for all
  to authenticated
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

drop policy if exists makeup_notification_settings_assistant_hard_deny
  on public.makeup_notification_settings;
create policy makeup_notification_settings_assistant_hard_deny
  on public.makeup_notification_settings
  as restrictive
  for select
  to authenticated
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

drop policy if exists makeup_notification_deliveries_assistant_hard_deny
  on public.makeup_notification_deliveries;
create policy makeup_notification_deliveries_assistant_hard_deny
  on public.makeup_notification_deliveries
  as restrictive
  for all
  to authenticated
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
    )
  );

drop policy if exists dashboard_notifications_assistant_makeup_hard_deny
  on public.dashboard_notifications;
create policy dashboard_notifications_assistant_makeup_hard_deny
  on public.dashboard_notifications
  as restrictive
  for all
  to authenticated
  using (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
      and coalesce(
        type = 'makeup_request'
        or metadata ->> 'workflow_key' = 'makeup_requests'
        or href like '/admin/makeup-requests%',
        false
      )
    )
  )
  with check (
    not (
      coalesce((select auth.jwt() ->> 'role'), '') = 'authenticated'
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.profiles profile
        where profile.id = (select auth.uid())
          and profile.role = 'assistant'
      )
      and coalesce(
        type = 'makeup_request'
        or metadata ->> 'workflow_key' = 'makeup_requests'
        or href like '/admin/makeup-requests%',
        false
      )
    )
  );

create or replace function dashboard_private.visible_dashboard_notification_rows_v1(
  p_profile_id uuid
)
returns table (
  id uuid,
  recipient_profile_id uuid,
  recipient_team text,
  actor_profile_id uuid,
  notification_type text,
  title text,
  body text,
  href text,
  metadata jsonb,
  legacy_read_at timestamptz,
  receipt_read_at timestamptz,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    notification.id,
    notification.recipient_profile_id,
    notification.recipient_team,
    notification.actor_profile_id,
    notification.type as notification_type,
    notification.title,
    notification.body,
    notification.href,
    notification.metadata,
    notification.read_at as legacy_read_at,
    receipt.read_at as receipt_read_at,
    coalesce(receipt.read_at, notification.read_at) as read_at,
    notification.created_at
  from public.dashboard_notifications notification
  left join public.dashboard_notification_read_receipts receipt
    on receipt.notification_id = notification.id
   and receipt.profile_id = p_profile_id
  where p_profile_id is not null
    and notification.revoked_at is null
    and notification.type <> 'registration_consultation_admin_chat'
    and not (
      exists (
        select 1
        from public.profiles profile
        where profile.id = p_profile_id
          and profile.role = 'assistant'
      )
      and coalesce(
        notification.type = 'makeup_request'
        or notification.metadata ->> 'workflow_key' = 'makeup_requests'
        or notification.href like '/admin/makeup-requests%',
        false
      )
    )
    and (
      notification.recipient_profile_id = p_profile_id
      or (
        notification.recipient_profile_id is null
        and notification.recipient_team = '관리팀'
        and exists (
          select 1
          from public.profiles profile
          where profile.id = p_profile_id
            and profile.role in ('admin', 'staff')
        )
      )
    );
$$;

create or replace function dashboard_private.assert_assistant_makeup_action_v1(
  p_patch jsonb default null
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if dashboard_private.is_authenticated_assistant_request_v1() then
    raise exception 'makeup_request_assistant_forbidden' using errcode = '42501';
  end if;
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    and p_patch is not null
    and pg_catalog.jsonb_typeof(p_patch) = 'object'
    and exists (
      select 1
      from public.profiles profile
      where profile.id = nullif(
          pg_catalog.btrim(p_patch ->> 'actor_profile_id'), ''
        )::uuid
        and profile.role = 'assistant'
    )
  then
    raise exception 'makeup_request_assistant_forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.reject_assistant_makeup_request_dml_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if dashboard_private.is_authenticated_assistant_request_v1() then
    raise exception 'makeup_request_assistant_forbidden' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists reject_assistant_makeup_request_dml_v1
  on public.makeup_requests;
create trigger reject_assistant_makeup_request_dml_v1
before insert or update or delete on public.makeup_requests
for each row
execute function dashboard_private.reject_assistant_makeup_request_dml_v1();

alter function public.create_makeup_request_v2(jsonb, uuid)
  set schema dashboard_private;
alter function dashboard_private.create_makeup_request_v2(jsonb, uuid)
  rename to create_makeup_request_v2_unguarded;
alter function public.transition_makeup_request_v2(uuid, text, jsonb, text, uuid)
  set schema dashboard_private;
alter function dashboard_private.transition_makeup_request_v2(uuid, text, jsonb, text, uuid)
  rename to transition_makeup_request_v2_unguarded;
alter function public.delete_makeup_request_v2(uuid, uuid)
  set schema dashboard_private;
alter function dashboard_private.delete_makeup_request_v2(uuid, uuid)
  rename to delete_makeup_request_v2_unguarded;

create or replace function public.create_makeup_request_v2(
  p_input jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  return dashboard_private.create_makeup_request_v2_unguarded(
    p_input,
    p_request_id
  );
end;
$$;

create or replace function public.transition_makeup_request_v2(
  p_makeup_request_id uuid,
  p_command text,
  p_patch jsonb,
  p_expected_status text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_makeup_action_v1(p_patch);
  return dashboard_private.transition_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_command,
    p_patch,
    p_expected_status,
    p_request_id
  );
end;
$$;

create or replace function public.delete_makeup_request_v2(
  p_makeup_request_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_assistant_makeup_action_v1(null);
  return dashboard_private.delete_makeup_request_v2_unguarded(
    p_makeup_request_id,
    p_request_id
  );
end;
$$;

alter function dashboard_private.assert_assistant_makeup_action_v1(jsonb)
  owner to postgres;
alter function dashboard_private.reject_assistant_makeup_request_dml_v1()
  owner to postgres;
alter function dashboard_private.create_makeup_request_v2_unguarded(jsonb, uuid)
  owner to postgres;
alter function dashboard_private.transition_makeup_request_v2_unguarded(
  uuid, text, jsonb, text, uuid
) owner to postgres;
alter function dashboard_private.delete_makeup_request_v2_unguarded(uuid, uuid)
  owner to postgres;
alter function public.create_makeup_request_v2(jsonb, uuid)
  owner to postgres;
alter function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) owner to postgres;
alter function public.delete_makeup_request_v2(uuid, uuid)
  owner to postgres;

revoke all on function dashboard_private.assert_assistant_makeup_action_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reject_assistant_makeup_request_dml_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_makeup_request_v2_unguarded(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.transition_makeup_request_v2_unguarded(
  uuid, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.delete_makeup_request_v2_unguarded(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_makeup_request_v2(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.delete_makeup_request_v2(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_makeup_request_v2(jsonb, uuid)
  to authenticated, service_role;
grant execute on function public.transition_makeup_request_v2(
  uuid, text, jsonb, text, uuid
) to authenticated, service_role;
grant execute on function public.delete_makeup_request_v2(uuid, uuid)
  to authenticated, service_role;

commit;
