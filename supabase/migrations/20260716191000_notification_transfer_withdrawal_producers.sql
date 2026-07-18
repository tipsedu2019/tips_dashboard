begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks,text,uuid,text,text,text,jsonb,uuid)'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.ops_task_request_replay_v2(uuid,text,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_deterministic_uuid_v1(text,text)'
    ) is null
  then
    raise exception 'ops_transition_notification_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.notification_ops_transition_render_template_v1(
  p_template text,
  p_payload jsonb
) returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  rendered text := p_template;
begin
  rendered := pg_catalog.replace(rendered, '{학생}', coalesce(p_payload ->> 'student_name', ''));
  rendered := pg_catalog.replace(rendered, '{학년}', coalesce(p_payload ->> 'grade', ''));
  rendered := pg_catalog.replace(rendered, '{문의일시}', coalesce(p_payload ->> 'inquiry_at', ''));
  rendered := pg_catalog.replace(rendered, '{진행상태}', coalesce(p_payload ->> 'status', ''));
  rendered := pg_catalog.replace(rendered, '{등록 확인}', coalesce(p_payload ->> 'registration_checked', ''));
  rendered := pg_catalog.replace(rendered, '{담당선생님}', coalesce(p_payload ->> 'teacher_name', ''));
  rendered := pg_catalog.replace(rendered, '{전 수업}', coalesce(p_payload ->> 'before_class', ''));
  rendered := pg_catalog.replace(rendered, '{후 수업}', coalesce(p_payload ->> 'after_class', ''));
  rendered := pg_catalog.replace(rendered, '{전 수업 종료일}', coalesce(p_payload ->> 'before_end_date', ''));
  rendered := pg_catalog.replace(rendered, '{후 수업 시작일}', coalesce(p_payload ->> 'after_start_date', ''));
  rendered := pg_catalog.replace(rendered, '{수업}', coalesce(p_payload ->> 'class_name', ''));
  rendered := pg_catalog.replace(rendered, '{퇴원일}', coalesce(p_payload ->> 'withdrawal_date', ''));
  rendered := pg_catalog.replace(rendered, '{퇴원회차}', coalesce(p_payload ->> 'withdrawal_round', ''));
  if rendered ~ '[{}]' or pg_catalog.char_length(rendered) > 4000 then
    raise exception 'ops_transition_notification_template_invalid' using errcode = '22023';
  end if;
  return rendered;
end;
$$;

create or replace function dashboard_private.notification_ops_task_render_template_v1(
  p_template text,
  p_workflow_label text,
  p_event_label text,
  p_occurred_at text,
  p_deep_link text
) returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  rendered text := p_template;
begin
  rendered := pg_catalog.replace(rendered, '{workflow_label}', p_workflow_label);
  rendered := pg_catalog.replace(rendered, '{event_label}', p_event_label);
  rendered := pg_catalog.replace(rendered, '{occurred_at}', p_occurred_at);
  rendered := pg_catalog.replace(rendered, '{deep_link}', p_deep_link);
  if rendered ~ '[{}]' or pg_catalog.char_length(rendered) > 4000 then
    raise exception 'ops_task_notification_template_invalid' using errcode = '22023';
  end if;
  return rendered;
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

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', p_task.id,
    'student_name', p_task.student_name,
    'grade', case when p_task.type = 'withdrawal' then v_withdrawal.school_grade else '' end,
    'inquiry_at', '',
    'registration_checked', '',
    'teacher_name', v_teacher_name,
    'before_class', case when p_task.type = 'transfer' then v_transfer.from_class_name end,
    'after_class', case when p_task.type = 'transfer' then v_transfer.to_class_name end,
    'before_end_date', case when p_task.type = 'transfer' then v_transfer.from_class_end_date end,
    'after_start_date', case when p_task.type = 'transfer' then v_transfer.to_class_start_date end,
    'class_name', case
      when p_task.type = 'withdrawal' then p_task.class_name
      else coalesce(v_transfer.to_class_name, p_task.class_name)
    end,
    'withdrawal_date', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_date end,
    'withdrawal_round', case when p_task.type = 'withdrawal' then v_withdrawal.withdrawal_session end,
    'status', p_task.status,
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

create or replace function dashboard_private.write_ops_transition_task_source_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_event_key text;
  v_defer_details boolean := false;
  v_completion_authorized boolean := false;
begin
  if new.type not in ('transfer', 'withdrawal') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'ops_transition_initial_status_invalid' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.type is distinct from old.type then
    raise exception 'ops_task_type_change_forbidden' using errcode = '22023';
  end if;

  begin
    v_request_id := nullif(
      pg_catalog.current_setting('app.ops_transition_request_id', true), ''
    )::uuid;
  exception
    when invalid_text_representation then
      v_request_id := null;
  end;
  v_request_id := coalesce(v_request_id, pg_catalog.gen_random_uuid());
  v_completion_authorized := coalesce(
    nullif(pg_catalog.current_setting(
      'app.ops_transition_completion_authorized', true
    ), '')::boolean,
    false
  );
  v_defer_details := coalesce(
    nullif(pg_catalog.current_setting(
      'app.ops_transition_defer_details', true
    ), '')::boolean,
    false
  );

  if old.status = 'done' and new.status is distinct from old.status then
    raise exception 'ops_transition_closed' using errcode = '40001';
  end if;
  if new.status = 'done'
    and old.status <> 'done'
    and not v_completion_authorized
  then
    raise exception 'ops_transition_completion_rpc_required' using errcode = '22023';
  end if;

  if new.status is distinct from old.status then
    v_event_key := case
      when new.status = 'done' then new.type || '.completed'
      when new.status = 'canceled' then new.type || '.canceled'
      when old.status = 'canceled' then new.type || '.reopened'
      when new.status = 'in_progress' then new.type || '.processing_started'
      else null
    end;
    if v_event_key is not null then
      perform dashboard_private.record_ops_transition_notification_source_v1(
        new, v_event_key, v_request_id
      );
    end if;
  end if;

  if (pg_catalog.to_jsonb(new) - array[
        'status', 'completed_at', 'created_at', 'updated_at'
      ]::text[])
      is distinct from
      (pg_catalog.to_jsonb(old) - array[
        'status', 'completed_at', 'created_at', 'updated_at'
      ]::text[])
  then
    if v_defer_details then
      perform pg_catalog.set_config(
        'app.ops_transition_parent_details_changed', 'true', true
      );
    else
      perform dashboard_private.record_ops_transition_notification_source_v1(
        new, new.type || '.details_changed', v_request_id
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function dashboard_private.write_ops_transition_detail_source_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_task public.ops_tasks%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_parent_changed boolean := false;
  v_completion_authorized boolean := false;
begin
  select task.* into v_task
  from public.ops_tasks task
  where task.id = new.task_id
    and task.type in ('transfer', 'withdrawal');
  if not found then
    raise exception 'ops_transition_task_required' using errcode = '23514';
  end if;
  begin
    v_request_id := nullif(
      pg_catalog.current_setting('app.ops_transition_request_id', true), ''
    )::uuid;
  exception
    when invalid_text_representation then
      v_request_id := null;
  end;
  v_request_id := coalesce(v_request_id, pg_catalog.gen_random_uuid());
  v_completion_authorized := coalesce(
    nullif(pg_catalog.current_setting(
      'app.ops_transition_completion_authorized', true
    ), '')::boolean,
    false
  );
  if tg_op = 'INSERT' then
    if v_task.status <> 'requested' then
      raise exception 'ops_transition_initial_status_invalid' using errcode = '22023';
    end if;
    perform dashboard_private.record_ops_transition_notification_source_v1(
      v_task, v_task.type || '.submitted', v_request_id
    );
    return new;
  end if;
  if v_completion_authorized then
    return new;
  end if;

  v_parent_changed := coalesce(
    nullif(pg_catalog.current_setting(
      'app.ops_transition_parent_details_changed', true
    ), '')::boolean,
    false
  );
  if tg_table_name = 'ops_transfer_details' then
    v_before := pg_catalog.to_jsonb(old) - array[
      'task_id', 'created_at', 'updated_at', 'timetable_roster_updated',
      'makeedu_transfer_done', 'fee_processed', 'textbook_fee_processed'
    ]::text[];
    v_after := pg_catalog.to_jsonb(new) - array[
      'task_id', 'created_at', 'updated_at', 'timetable_roster_updated',
      'makeedu_transfer_done', 'fee_processed', 'textbook_fee_processed'
    ]::text[];
  else
    v_before := pg_catalog.to_jsonb(old) - array[
      'task_id', 'created_at', 'updated_at', 'timetable_roster_updated',
      'makeedu_withdrawal_done', 'fee_processed', 'textbook_fee_processed'
    ]::text[];
    v_after := pg_catalog.to_jsonb(new) - array[
      'task_id', 'created_at', 'updated_at', 'timetable_roster_updated',
      'makeedu_withdrawal_done', 'fee_processed', 'textbook_fee_processed'
    ]::text[];
  end if;
  if not v_parent_changed and v_before is not distinct from v_after then
    return new;
  end if;
  perform dashboard_private.record_ops_transition_notification_source_v1(
    v_task, v_task.type || '.details_changed', v_request_id
  );
  return new;
end;
$$;

drop trigger if exists write_ops_transition_task_source_v1 on public.ops_tasks;
create trigger write_ops_transition_task_source_v1
before insert or update on public.ops_tasks
for each row execute function dashboard_private.write_ops_transition_task_source_v1();

drop trigger if exists write_ops_transfer_detail_source_v1
  on public.ops_transfer_details;
create trigger write_ops_transfer_detail_source_v1
after insert or update on public.ops_transfer_details
for each row execute function dashboard_private.write_ops_transition_detail_source_v1();

drop trigger if exists write_ops_withdrawal_detail_source_v1
  on public.ops_withdrawal_details;
create trigger write_ops_withdrawal_detail_source_v1
after insert or update on public.ops_withdrawal_details
for each row execute function dashboard_private.write_ops_transition_detail_source_v1();

create or replace function dashboard_private.ensure_ops_transition_completion_source_v1(
  p_task public.ops_tasks,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_event_id uuid;
  v_notification_event_id uuid;
  v_fanout_job_id uuid;
begin
  if p_task.type not in ('transfer', 'withdrawal')
    or p_task.status <> 'done'
    or p_request_id is null
  then
    raise exception 'ops_transition_completion_state_conflict' using errcode = '40001';
  end if;
  select source.id into v_source_event_id
  from public.ops_task_events source
  where source.task_id = p_task.id
    and source.event_type = p_task.type || '.completed'
  order by source.created_at desc, source.id desc
  limit 1;
  if not found then
    return dashboard_private.record_ops_transition_notification_source_v1(
      p_task, p_task.type || '.completed', p_request_id
    );
  end if;
  select event_row.id, job.id
  into strict v_notification_event_id, v_fanout_job_id
  from dashboard_private.notification_events event_row
  join dashboard_private.notification_event_fanout_jobs job
    on job.event_id = event_row.id
  where event_row.workflow_key = p_task.type
    and event_row.event_key = p_task.type || '.completed'
    and event_row.source_type = 'ops_task_event'
    and event_row.source_id = v_source_event_id::text
    and event_row.occurrence_key = v_source_event_id::text;
  return pg_catalog.jsonb_build_object(
    'sourceEventId', v_source_event_id,
    'notificationEventId', v_notification_event_id,
    'fanoutJobId', v_fanout_job_id
  );
end;
$$;

create or replace function dashboard_private.create_ops_task_v2_impl(
  p_input jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.assert_ops_task_actor_v2(null, null);
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'input', p_input
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail jsonb;
  v_source jsonb;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object' or p_request_id is null then
    raise exception 'ops_task_input_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'create_ops_task_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'false', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_task := dashboard_private.insert_ops_task_from_json_v2(p_input, v_actor);
  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, v_task.type);
  perform dashboard_private.upsert_ops_task_detail_v2(v_task.id, v_task.type, v_detail);

  if v_task.type = 'transfer' then
    v_source := dashboard_private.record_ops_transition_notification_source_v1(
      v_task, 'transfer.submitted', p_request_id
    );
  elsif v_task.type = 'withdrawal' then
    v_source := dashboard_private.record_ops_transition_notification_source_v1(
      v_task, 'withdrawal.submitted', p_request_id
    );
  elsif v_task.type = 'general' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'task.created', p_request_id, 'type', null, v_task.type
    );
  elsif v_task.type = 'word_retest' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'word_retest.created', p_request_id, 'type', null, v_task.type,
      pg_catalog.jsonb_build_object(
        'test_at', v_detail ->> 'test_at',
        'retest_status', coalesce(nullif(v_detail ->> 'retest_status', ''), 'not_started')
      )
    );
  end if;

  if v_source is not null then
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;
  v_response := pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', v_source_event_ids
  );
  perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', '', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', '', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'create_ops_task_v2', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.complete_ops_transfer_roster_transition_v2_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'ops_transfer_completion_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'complete_ops_transfer_roster_transition_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_legacy_response := dashboard_private.complete_ops_transfer_roster_transition_impl(
    p_task_id, p_request_id::text
  );
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id and task.type = 'transfer';
  if v_task.status <> 'done' then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, p_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
  );
  perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', '', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', '', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'complete_ops_transfer_roster_transition_v2', v_fingerprint, v_response
  );
end;
$$;
-- create or replace function dashboard_private.complete_ops_transfer_roster_transition_v2_impl_end

create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'ops_withdrawal_completion_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'complete_ops_withdrawal_roster_transition_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', p_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  v_legacy_response := dashboard_private.complete_ops_withdrawal_roster_transition_impl(
    p_task_id, p_request_id::text
  );
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id and task.type = 'withdrawal';
  if v_task.status <> 'done' then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, p_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
  );
  perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', '', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', '', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'complete_ops_withdrawal_roster_transition_v2', v_fingerprint, v_response
  );
end;
$$;
-- create or replace function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl_end

create or replace function dashboard_private.complete_ops_transition_legacy_bridge_v1(
  p_task_id uuid,
  p_request_key text,
  p_task_type text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_request_id uuid;
  v_request_kind text;
  v_fingerprint text;
  v_replay jsonb;
  v_legacy_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if v_actor is null
    or p_task_id is null
    or v_request_key is null
    or p_task_type not in ('transfer', 'withdrawal')
  then
    raise exception 'ops_transition_completion_invalid' using errcode = '22023';
  end if;
  v_request_id := dashboard_private.notification_deterministic_uuid_v1(
    'ops-transition-legacy-request-v1',
    v_actor::text || ':' || p_task_type || ':' || v_request_key
  );
  v_request_kind := 'complete_ops_' || p_task_type || '_roster_transition_legacy_v1';
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'task_id', p_task_id,
    'task_type', p_task_type,
    'request_key', v_request_key
  )::text);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    v_request_id, v_request_kind, v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_catalog.set_config(
    'app.ops_transition_request_id', v_request_id::text, true
  );
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', 'true', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', 'false', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', 'false', true
  );
  if p_task_type = 'transfer' then
    v_legacy_response := dashboard_private.complete_ops_transfer_roster_transition_impl(
      p_task_id, v_request_key
    );
  else
    v_legacy_response := dashboard_private.complete_ops_withdrawal_roster_transition_impl(
      p_task_id, v_request_key
    );
  end if;
  select task.* into strict v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = p_task_type;
  if v_task.status <> 'done' then
    raise exception 'ops_transition_completion_state_conflict' using errcode = '40001';
  end if;
  v_source := dashboard_private.ensure_ops_transition_completion_source_v1(
    v_task, v_request_id
  );
  v_response := coalesce(v_legacy_response, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'task', pg_catalog.to_jsonb(v_task),
      'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
    );
  perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_completion_authorized', '', true
  );
  perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
  perform pg_catalog.set_config(
    'app.ops_transition_parent_details_changed', '', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    v_request_id, v_request_kind, v_fingerprint, v_response
  );
end;
$$;

create or replace function public.complete_ops_transfer_roster_transition_v2(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.complete_ops_transfer_roster_transition_v2_impl(
    p_task_id, p_request_id
  );
$$;

create or replace function public.complete_ops_withdrawal_roster_transition_v2(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(
    p_task_id, p_request_id
  );
$$;

create or replace function public.complete_ops_transfer_roster_transition(
  p_task_id uuid,
  p_request_key text
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.complete_ops_transition_legacy_bridge_v1(
    p_task_id, p_request_key, 'transfer'
  );
$$;

create or replace function public.complete_ops_withdrawal_roster_transition(
  p_task_id uuid,
  p_request_key text
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.complete_ops_transition_legacy_bridge_v1(
    p_task_id, p_request_key, 'withdrawal'
  );
$$;

create or replace function public.get_ops_task_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source public.ops_task_events%rowtype;
  v_task public.ops_tasks%rowtype;
  v_transfer public.ops_transfer_details%rowtype;
  v_withdrawal public.ops_withdrawal_details%rowtype;
  v_canonical dashboard_private.notification_events%rowtype;
  v_actor_role text;
  v_items jsonb;
  v_workflow_key text;
  v_deep_link text;
  v_canonical_source_type text;
  v_canonical_source_id uuid;
begin
  if p_source_event_id is null or p_actor_profile_id is null then
    raise exception 'ops_task_legacy_dispatch_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_source
  from public.ops_task_events event_row
  where event_row.id = p_source_event_id
    and event_row.event_type in (
      'task.created', 'task.assignee_changed', 'task.due_changed',
      'task.status_changed', 'task.completed', 'task.canceled',
      'task.reopened', 'task.comment_added',
      'word_retest.created', 'word_retest.assigned',
      'word_retest.schedule_changed', 'word_retest.started',
      'word_retest.result_reported', 'word_retest.absent_reported',
      'word_retest.revision_requested', 'word_retest.retry_created',
      'word_retest.completed', 'word_retest.canceled',
      'transfer.submitted', 'transfer.processing_started',
      'transfer.details_changed', 'transfer.completed',
      'transfer.canceled', 'transfer.reopened',
      'withdrawal.submitted', 'withdrawal.processing_started',
      'withdrawal.details_changed', 'withdrawal.completed',
      'withdrawal.canceled', 'withdrawal.reopened'
    );
  if not found then
    raise exception 'ops_task_notification_source_not_found' using errcode = 'P0002';
  end if;
  select task.* into v_task
  from public.ops_tasks task
  where task.id = v_source.task_id
    and task.type in ('general', 'word_retest', 'transfer', 'withdrawal');
  if not found or pg_catalog.split_part(v_source.event_type, '.', 1) <>
    (case v_task.type when 'general' then 'task' else v_task.type end)
  then
    raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end if;
  if v_task.type = 'transfer' then
    select detail.* into v_transfer
    from public.ops_transfer_details detail
    where detail.task_id = v_task.id;
    if not found then raise exception 'ops_transfer_detail_required' using errcode = '23514'; end if;
  elsif v_task.type = 'withdrawal' then
    select detail.* into v_withdrawal
    from public.ops_withdrawal_details detail
    where detail.task_id = v_task.id;
    if not found then raise exception 'ops_withdrawal_detail_required' using errcode = '23514'; end if;
  end if;
  v_workflow_key := case v_task.type
    when 'general' then 'tasks'
    when 'word_retest' then 'word_retests'
    else v_task.type
  end;
  v_canonical_source_type := case
    when v_source.event_type = 'task.comment_added' then 'ops_task_comment'
    else 'ops_task_event'
  end;
  begin
    v_canonical_source_id := case
      when v_source.event_type = 'task.comment_added'
        then nullif(v_source.payload ->> 'comment_id', '')::uuid
      else p_source_event_id
    end;
  exception
    when invalid_text_representation then
      raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end;
  if v_canonical_source_id is null
    or (v_canonical_source_type = 'ops_task_comment' and not exists (
      select 1 from public.ops_task_comments comment_row
      where comment_row.id = v_canonical_source_id
        and comment_row.task_id = v_task.id
    ))
  then
    raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end if;
  v_deep_link := case v_task.type
    when 'general' then '/admin/tasks?taskId=' || v_task.id::text
    when 'word_retest' then '/admin/word-retests?taskId=' || v_task.id::text
    when 'transfer' then '/admin/transfer?taskId=' || v_task.id::text
    else '/admin/withdrawal?taskId=' || v_task.id::text
  end;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  if not (
    v_source.actor_id = p_actor_profile_id
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or v_actor_role in ('admin', 'staff')
  ) then
    raise exception 'ops_task_legacy_dispatch_forbidden' using errcode = '42501';
  end if;
  select event_row.* into v_canonical
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = v_workflow_key
    and event_row.event_key = v_source.event_type
    and event_row.source_type = v_canonical_source_type
    and event_row.source_id = v_canonical_source_id::text
    and event_row.occurrence_key = v_canonical_source_id::text;
  if not found then
    raise exception 'ops_task_notification_canonical_event_not_found' using errcode = 'P0002';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', v_canonical.id,
    'eventKey', v_canonical.event_key,
    'occurrenceKey', v_canonical.occurrence_key,
    'ruleId', (snapshot.item ->> 'rule_id')::uuid,
    'ruleRevision', snapshot.item ->> 'rule_revision',
    'templateId', template_row.id,
    'templateChecksum', template_row.checksum,
    'channelKey', snapshot.item ->> 'channel_key',
    'audienceKey', snapshot.item ->> 'audience_key',
    'targetGeneration', '0',
    'targetKind', 'connection',
    'targetKey', 'connection:google_chat.management',
    'targetProfileId', null,
    'connectionKey', 'google_chat.management',
    'targetSnapshot', pg_catalog.jsonb_build_object('connection_key', 'google_chat.management'),
    'renderedTitle', case when v_task.type in ('transfer', 'withdrawal')
      then dashboard_private.notification_ops_transition_render_template_v1(
        template_row.title_template, v_canonical.payload
      )
      else dashboard_private.notification_ops_task_render_template_v1(
        template_row.title_template,
        registry.workflow_label,
        registry.event_label,
        coalesce(v_canonical.payload ->> 'occurred_at', v_canonical.occurred_at::text),
        v_deep_link
      )
    end,
    'renderedBody', case when v_task.type in ('transfer', 'withdrawal')
      then dashboard_private.notification_ops_transition_render_template_v1(
        template_row.body_template, v_canonical.payload
      )
      else dashboard_private.notification_ops_task_render_template_v1(
        template_row.body_template,
        registry.workflow_label,
        registry.event_label,
        coalesce(v_canonical.payload ->> 'occurred_at', v_canonical.occurred_at::text),
        v_deep_link
      )
    end,
    'href', v_deep_link,
    'scheduledFor', v_canonical.occurred_at
  ) order by (snapshot.item ->> 'rule_id')::uuid), '[]'::jsonb)
  into v_items
  from pg_catalog.jsonb_array_elements(v_canonical.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template_row
    on template_row.id = (snapshot.item ->> 'template_id')::uuid
   and template_row.rule_id = (snapshot.item ->> 'rule_id')::uuid
  join dashboard_private.notification_settings_ui_registry registry
    on registry.rule_id = (snapshot.item ->> 'rule_id')::uuid
  where snapshot.item ->> 'audience_key' = 'management_team'
    and snapshot.item ->> 'channel_key' = 'google_chat'
    and (snapshot.item ->> 'enabled')::boolean;

  return pg_catalog.jsonb_build_object(
    'sourceEventId', p_source_event_id,
    'taskId', v_task.id,
    'items', v_items
  );
end;
$$;

create or replace function public.transfer_withdrawal_notification_producers_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1; $$;

revoke all on function dashboard_private.notification_ops_transition_render_template_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_ops_task_render_template_v1(
  text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_ops_transition_task_source_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_ops_transition_detail_source_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.ensure_ops_transition_completion_source_v1(public.ops_tasks, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_ops_task_v2_impl(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_ops_transfer_roster_transition_v2_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_ops_transition_legacy_bridge_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_ops_transfer_roster_transition_impl(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ops_transfer_roster_transition_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ops_withdrawal_roster_transition_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ops_transfer_roster_transition(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ops_withdrawal_roster_transition(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.transfer_withdrawal_notification_producers_runtime_version()
  from public, anon;

grant execute on function public.complete_ops_transfer_roster_transition_v2(uuid, uuid)
  to authenticated;
grant execute on function public.complete_ops_withdrawal_roster_transition_v2(uuid, uuid)
  to authenticated;
grant execute on function public.complete_ops_transfer_roster_transition(uuid, text)
  to authenticated;
grant execute on function public.complete_ops_withdrawal_roster_transition(uuid, text)
  to authenticated;
grant execute on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;
grant execute on function public.transfer_withdrawal_notification_producers_runtime_version()
  to authenticated, service_role;

alter function dashboard_private.notification_ops_transition_render_template_v1(text, jsonb)
  owner to postgres;
alter function dashboard_private.notification_ops_task_render_template_v1(
  text, text, text, text, text
) owner to postgres;
alter function dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks, text, uuid)
  owner to postgres;
alter function dashboard_private.write_ops_transition_task_source_v1()
  owner to postgres;
alter function dashboard_private.write_ops_transition_detail_source_v1()
  owner to postgres;
alter function dashboard_private.ensure_ops_transition_completion_source_v1(public.ops_tasks, uuid)
  owner to postgres;
alter function dashboard_private.create_ops_task_v2_impl(jsonb, uuid)
  owner to postgres;
alter function dashboard_private.complete_ops_transfer_roster_transition_v2_impl(uuid, uuid)
  owner to postgres;
alter function dashboard_private.complete_ops_withdrawal_roster_transition_v2_impl(uuid, uuid)
  owner to postgres;
alter function dashboard_private.complete_ops_transition_legacy_bridge_v1(uuid, text, text)
  owner to postgres;
alter function dashboard_private.complete_ops_transfer_roster_transition_impl(uuid, text)
  owner to postgres;
alter function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text)
  owner to postgres;
alter function public.complete_ops_transfer_roster_transition_v2(uuid, uuid)
  owner to postgres;
alter function public.complete_ops_withdrawal_roster_transition_v2(uuid, uuid)
  owner to postgres;
alter function public.complete_ops_transfer_roster_transition(uuid, text)
  owner to postgres;
alter function public.complete_ops_withdrawal_roster_transition(uuid, text)
  owner to postgres;
alter function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function public.transfer_withdrawal_notification_producers_runtime_version()
  owner to postgres;

commit;
