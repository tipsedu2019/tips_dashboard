begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.students') is null
    or pg_catalog.to_regclass('public.classes') is null
    or pg_catalog.to_regclass('public.ops_task_events') is null
    or pg_catalog.to_regclass('public.ops_transfer_details') is null
    or pg_catalog.to_regclass('public.ops_withdrawal_details') is null
    or pg_catalog.to_regclass('public.ops_registration_enrollments') is null
  then
    raise exception 'notification_withdrawal_content_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

-- Both completion entry points first run the subject-scoped roster transaction
-- and then call this writer through ensure_ops_transition_completion_source_v1.
-- The completed snapshot therefore observes the committed-in-transaction roster
-- after the selected class was removed, without mutating any remaining enrollment.
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
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_teacher_name text;
  v_requester_name text;
  v_actor_name text;
  v_selected_subject text;
  v_selected_class text;
  v_requested_withdrawal_date date;
  v_requested_withdrawal_round text;
  v_applied_withdrawal_date date;
  v_applied_withdrawal_round text;
  v_other_active_subjects jsonb;
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
    if p_task.student_id is null or p_task.class_id is null then
      raise exception 'ops_withdrawal_management_link_required' using errcode = '22023';
    end if;
    select class_row.* into v_class
    from public.classes class_row
    where class_row.id = p_task.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    v_teacher_name := nullif(v_withdrawal.teacher_name, '');
    v_selected_subject := nullif(pg_catalog.btrim(v_class.subject), '');
    v_selected_class := coalesce(
      nullif(pg_catalog.btrim(v_class.name), ''),
      nullif(pg_catalog.btrim(p_task.class_name), '')
    );
    if v_selected_subject not in ('영어', '수학', '과학') or v_selected_class is null then
      raise exception 'ops_withdrawal_subject_snapshot_invalid' using errcode = '23514';
    end if;

    v_requested_withdrawal_date := v_withdrawal.withdrawal_date;
    v_requested_withdrawal_round := nullif(pg_catalog.btrim(v_withdrawal.withdrawal_session), '');

    if p_event_key = 'withdrawal.completed' then
      select
        nullif(coalesce(
          source.payload ->> 'requested_withdrawal_date',
          source.payload ->> 'withdrawal_date'
        ), '')::date,
        nullif(pg_catalog.btrim(coalesce(
          source.payload ->> 'requested_withdrawal_round',
          source.payload ->> 'withdrawal_round'
        )), '')
      into v_requested_withdrawal_date, v_requested_withdrawal_round
      from public.ops_task_events source
      where source.task_id = p_task.id
        and source.event_type = 'withdrawal.submitted'
      order by source.created_at, source.id
      limit 1;
      if not found
        or v_requested_withdrawal_date is null
        or v_requested_withdrawal_round is null
      then
        raise exception 'ops_withdrawal_request_snapshot_required' using errcode = '23514';
      end if;
      v_applied_withdrawal_date := v_withdrawal.withdrawal_date;
      v_applied_withdrawal_round := nullif(pg_catalog.btrim(v_withdrawal.withdrawal_session), '');
      if v_applied_withdrawal_date is null or v_applied_withdrawal_round is null then
        raise exception 'ops_withdrawal_applied_snapshot_required' using errcode = '23514';
      end if;

      select student.* into v_student
      from public.students student
      where student.id = p_task.student_id;
      if not found then
        raise exception 'registration_student_not_found' using errcode = 'P0002';
      end if;
      if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
      then
        raise exception 'registration_roster_projection_invalid' using errcode = '23514';
      end if;

      select coalesce(
        pg_catalog.jsonb_agg(remaining.subject order by remaining.subject_sort),
        '[]'::jsonb
      )
      into v_other_active_subjects
      from (
        select distinct
          pg_catalog.btrim(class_row.subject) as subject,
          case pg_catalog.btrim(class_row.subject)
            when '영어' then 1
            when '수학' then 2
            when '과학' then 3
          end as subject_sort
        from public.classes class_row
        where class_row.id <> p_task.class_id
          and pg_catalog.btrim(class_row.subject) in ('영어', '수학', '과학')
          and pg_catalog.btrim(class_row.subject) <> v_selected_subject
          and (
            coalesce(v_student.class_ids, '[]'::jsonb) ? class_row.id::text
            or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? class_row.id::text
            or exists (
              select 1
              from public.ops_registration_enrollments enrollment
              where enrollment.student_id = p_task.student_id
                and enrollment.class_id = class_row.id
                and enrollment.roster_active
            )
          )
      ) remaining;
    end if;
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
    'subjects', case when p_task.type = 'withdrawal' then v_selected_subject end,
    'selected_subject', case when p_task.type = 'withdrawal' then v_selected_subject end,
    'selected_class', case when p_task.type = 'withdrawal' then v_selected_class end,
    'requested_withdrawal_date', case when p_task.type = 'withdrawal' then v_requested_withdrawal_date end,
    'requested_withdrawal_round', case when p_task.type = 'withdrawal' then v_requested_withdrawal_round end,
    'applied_withdrawal_date', case when p_event_key = 'withdrawal.completed' then v_applied_withdrawal_date end,
    'applied_withdrawal_round', case when p_event_key = 'withdrawal.completed' then v_applied_withdrawal_round end,
    'other_active_subjects', case when p_event_key = 'withdrawal.completed' then v_other_active_subjects end,
    'actor_name', v_actor_name,
    'reason', case
      when p_task.type = 'transfer' then v_transfer.transfer_reason
      else v_withdrawal.customer_reason
    end,
    'memo', p_task.memo,
    'class_name', case
      when p_task.type = 'withdrawal' then v_selected_class
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
