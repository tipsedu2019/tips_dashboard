begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.ops_task_events') is null
    or pg_catalog.to_regclass('public.ops_transfer_details') is null
    or pg_catalog.to_regclass('public.ops_withdrawal_details') is null
  then
    raise exception 'notification_transfer_content_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.record_ops_transition_notification_source_v1(
  p_task public.ops_tasks,
  p_event_key text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.assert_ops_task_actor_v2(p_task, null);
  v_source_event_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_transfer public.ops_transfer_details%rowtype;
  v_withdrawal public.ops_withdrawal_details%rowtype;
  v_teacher_name text;
  v_requester_name text;
  v_actor_name text;
  v_payload jsonb;
  v_recorded jsonb;
  v_existing_event_id uuid;
  v_existing_job_id uuid;
begin
  if p_request_id is null
    or p_task.type not in ('transfer', 'withdrawal')
    or p_event_key not in (
      'transfer.submitted', 'transfer.processing_started',
      'transfer.details_changed', 'transfer.completed',
      'transfer.canceled', 'transfer.reopened',
      'withdrawal.submitted', 'withdrawal.processing_started',
      'withdrawal.details_changed', 'withdrawal.completed',
      'withdrawal.canceled', 'withdrawal.reopened'
    )
    or pg_catalog.split_part(p_event_key, '.', 1) <> p_task.type
  then
    raise exception 'ops_transition_notification_event_invalid' using errcode = '22023';
  end if;

  select source.id into v_source_event_id
  from public.ops_task_events source
  where source.task_id = p_task.id
    and source.request_id = p_request_id
    and source.event_type = p_event_key;
  if found then
    select event_row.id, job.id
    into strict v_existing_event_id, v_existing_job_id
    from dashboard_private.notification_events event_row
    join dashboard_private.notification_event_fanout_jobs job
      on job.event_id = event_row.id
    where event_row.workflow_key = p_task.type
      and event_row.event_key = p_event_key
      and event_row.source_type = 'ops_task_event'
      and event_row.source_id = v_source_event_id::text
      and event_row.occurrence_key = v_source_event_id::text;
    return pg_catalog.jsonb_build_object(
      'sourceEventId', v_source_event_id,
      'notificationEventId', v_existing_event_id,
      'fanoutJobId', v_existing_job_id
    );
  end if;
  v_source_event_id := pg_catalog.gen_random_uuid();

  if p_task.type = 'transfer' then
    select detail.* into v_transfer
    from public.ops_transfer_details detail
    where detail.task_id = p_task.id;
    if not found then
      raise exception 'ops_transfer_detail_required' using errcode = '23514';
    end if;
    v_teacher_name := coalesce(nullif(v_transfer.from_teacher_name, ''), nullif(v_transfer.to_teacher_name, ''));
  else
    select detail.* into v_withdrawal
    from public.ops_withdrawal_details detail
    where detail.task_id = p_task.id;
    if not found then
      raise exception 'ops_withdrawal_detail_required' using errcode = '23514';
    end if;
    v_teacher_name := nullif(v_withdrawal.teacher_name, '');
  end if;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_requester_name
  from public.profiles profile
  where profile.id = p_task.requested_by;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_actor_name
  from public.profiles profile
  where profile.id = v_actor;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', p_task.id,
    'student_name', p_task.student_name,
    'grade', case when p_task.type = 'withdrawal' then v_withdrawal.school_grade else '' end,
    'inquiry_at', '',
    'registration_checked', '',
    'task_status', p_task.status,
    'status', p_task.status,
    'requester_name', v_requester_name,
    'teacher_name', v_teacher_name,
    'before_class', case when p_task.type = 'transfer' then v_transfer.from_class_name end,
    'after_class', case when p_task.type = 'transfer' then v_transfer.to_class_name end,
    'requested_effective_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'before_class_end_date', case when p_task.type = 'transfer' then v_transfer.from_class_end_date end,
    'after_class_start_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'before_end_date', case when p_task.type = 'transfer' then v_transfer.from_class_end_date end,
    'after_start_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'actor_name', v_actor_name,
    'reason', case
      when p_task.type = 'transfer' then v_transfer.transfer_reason
      else v_withdrawal.customer_reason
    end,
    'memo', p_task.memo,
    'class_name', case
      when p_task.type = 'withdrawal' then p_task.class_name
      else coalesce(v_transfer.to_class_name, p_task.class_name)
    end,
    'withdrawal_date', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_date end,
    'withdrawal_round', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_session end,
    'requester_profile_id', p_task.requested_by,
    'management_profile_ids', pg_catalog.to_jsonb(dashboard_private.ops_task_management_profile_ids_v2()),
    'source_event_id', v_source_event_id,
    'occurred_at', v_occurred_at
  ));

  if p_event_key in ('transfer.canceled', 'transfer.reopened', 'withdrawal.canceled', 'withdrawal.reopened') then
    with canceled as (
      update dashboard_private.notification_deliveries delivery
      set status = 'canceled',
          status_reason = 'source_status_changed',
          next_attempt_at = null,
          claimed_by = null,
          claim_token = null,
          lease_expires_at = null,
          resolved_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      from dashboard_private.notification_events event_row
      where delivery.event_id = event_row.id
        and event_row.workflow_key = p_task.type
        and event_row.payload ->> 'task_id' = p_task.id::text
        and delivery.status in ('pending', 'retry_wait')
      returning delivery.id
    )
    update dashboard_private.notification_deliveries delivery
    set cancel_requested_at = coalesce(
          delivery.cancel_requested_at,
          pg_catalog.clock_timestamp()
        ),
        cancel_reason = 'source_status_changed',
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = p_task.type
      and event_row.payload ->> 'task_id' = p_task.id::text
      and delivery.status = 'claimed';
  end if;

  insert into public.ops_task_events(
    id, task_id, actor_id, event_type, field_name,
    before_value, after_value, request_id, payload, created_at
  ) values (
    v_source_event_id, p_task.id, v_actor, p_event_key,
    case when p_event_key like '%.details_changed' then 'details' else 'status' end,
    null, p_task.status, p_request_id, v_payload, v_occurred_at
  );

  v_recorded := dashboard_private.record_notification_event_v1(
    'global',
    p_task.type,
    p_event_key,
    'ops_task_event',
    v_source_event_id::text,
    null,
    v_source_event_id::text,
    v_actor,
    v_occurred_at,
    1,
    v_payload,
    null,
    null
  );

  return pg_catalog.jsonb_build_object(
    'sourceEventId', v_source_event_id,
    'notificationEventId', v_recorded ->> 'event_id',
    'fanoutJobId', v_recorded ->> 'fanout_job_id'
  );
end;
$$;

revoke all on function dashboard_private.record_ops_transition_notification_source_v1(
  public.ops_tasks, text, uuid
) from public, anon, authenticated, service_role;

alter function dashboard_private.record_ops_transition_notification_source_v1(
  public.ops_tasks, text, uuid
) owner to postgres;

commit;
