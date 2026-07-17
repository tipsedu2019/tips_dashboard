begin;

set local lock_timeout = '5s';

do $$
declare
  v_runtime integer;
begin
  if pg_catalog.to_regprocedure('public.common_notification_control_plane_runtime_version()') is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
  then
    raise exception 'notification_control_plane_runtime_not_ready' using errcode = '55000';
  end if;
  execute 'select public.common_notification_control_plane_runtime_version()' into v_runtime;
  if v_runtime <> 1 then
    raise exception 'notification_control_plane_runtime_mismatch' using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.create_ops_task_v2_impl(
  p_input jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
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
  v_activity jsonb;
  v_activity_event_id uuid;
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

  v_task := dashboard_private.insert_ops_task_from_json_v2(p_input, v_actor);
  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, v_task.type);
  perform dashboard_private.upsert_ops_task_detail_v2(v_task.id, v_task.type, v_detail);

  if v_task.type = 'general' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'task.created', p_request_id, 'type', null, v_task.type
    );
    v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  elsif v_task.type = 'word_retest' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, 'word_retest.created', p_request_id, 'type', null, v_task.type,
      pg_catalog.jsonb_build_object(
        'test_at', v_detail ->> 'test_at',
        'retest_status', coalesce(nullif(v_detail ->> 'retest_status', ''), 'not_started')
      )
    );
    v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  elsif v_task.type = 'textbook' then
    v_activity := dashboard_private.insert_ops_task_activity_event_v1(
      v_task, v_actor, 'created', 'type', null, v_task.type, p_request_id
    );
    v_activity_event_id := (v_activity ->> 'sourceEventId')::uuid;
  end if;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', v_source_event_ids,
    'activityEventId', v_activity_event_id
  ));
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'create_ops_task_v2', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.update_ops_task_v2_impl(
  p_task_id uuid,
  p_input jsonb,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'input', p_input,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay jsonb;
  v_before public.ops_tasks%rowtype;
  v_after public.ops_tasks%rowtype;
  v_before_word public.ops_word_retests%rowtype;
  v_after_word public.ops_word_retests%rowtype;
  v_task_input jsonb;
  v_detail jsonb;
  v_detail_base jsonb := '{}'::jsonb;
  v_source jsonb;
  v_activity jsonb;
  v_activity_event_id uuid;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_event_key text;
  v_response jsonb;
begin
  if p_task_id is null or p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_expected_updated_at is null or p_request_id is null
  then
    raise exception 'ops_task_update_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'update_ops_task_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_before
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_before, null);
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'ops_task_stale_write' using errcode = '40001';
  end if;
  if v_before.type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;

  v_task_input := dashboard_private.ops_task_input_task_v2(p_input);
  if nullif(v_task_input ->> 'type', '') is not null
    and (v_task_input ->> 'type') <> v_before.type
  then
    raise exception 'ops_task_type_change_forbidden' using errcode = '22023';
  end if;
  if v_before.type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_before.type in ('transfer', 'withdrawal') then
    if v_before.status = 'done' then
      raise exception 'ops_transition_closed' using errcode = '40001';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'done' then
      raise exception 'ops_transition_completion_rpc_required' using errcode = '22023';
    end if;
    perform pg_catalog.set_config(
      'app.ops_transition_request_id', p_request_id::text, true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', 'false', true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_defer_details', 'true', true
    );
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', 'false', true
    );
  end if;
  if v_before.type = 'word_retest' then
    select detail.* into v_before_word
    from public.ops_word_retests detail
    where detail.task_id = p_task_id
    for update of detail;
    if not found then raise exception 'word_retest_not_found' using errcode = 'P0002'; end if;
    v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest');
    if not (
      v_before.status = 'in_progress'
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'in_progress'
      and v_before_word.retest_status = 'in_progress'
    ) and (
      (case when v_detail ? 'first_score' then nullif(v_detail ->> 'first_score', '')::numeric else v_before_word.first_score end)
        is distinct from v_before_word.first_score
      or (case when v_detail ? 'second_score' then nullif(v_detail ->> 'second_score', '')::numeric else v_before_word.second_score end)
        is distinct from v_before_word.second_score
      or (case when v_detail ? 'third_score' then nullif(v_detail ->> 'third_score', '')::numeric else v_before_word.third_score end)
        is distinct from v_before_word.third_score
      or (case when v_detail ? 'score_out_of_100' then nullif(v_detail ->> 'score_out_of_100', '')::numeric else v_before_word.score_out_of_100 end)
        is distinct from v_before_word.score_out_of_100
    ) then
      raise exception 'word_retest_score_update_not_allowed' using errcode = '40001';
    end if;
    if v_before.status in ('done', 'canceled')
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) <> v_before.status
    then
      raise exception 'word_retest_closed' using errcode = '40001';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'review_requested'
      and v_before.status <> 'review_requested'
    then
      raise exception 'word_retest_result_rpc_required' using errcode = '22023';
    end if;
    if v_before.status = 'review_requested'
      and coalesce(nullif(v_task_input ->> 'status', ''), v_before.status)
        not in ('review_requested', 'done', 'canceled')
    then
      raise exception 'word_retest_revision_rpc_required' using errcode = '22023';
    end if;
    if coalesce(nullif(v_task_input ->> 'status', ''), v_before.status) = 'done'
      and v_before.status <> 'review_requested'
    then
      raise exception 'word_retest_completion_not_allowed' using errcode = '40001';
    end if;
  end if;

  update public.ops_tasks task set
    title = coalesce(nullif(pg_catalog.btrim(v_task_input ->> 'title'), ''), task.title),
    status = coalesce(nullif(v_task_input ->> 'status', ''), task.status),
    priority = coalesce(nullif(v_task_input ->> 'priority', ''), task.priority),
    requested_by = coalesce(nullif(v_task_input ->> 'requested_by', '')::uuid, task.requested_by),
    requested_team = case when v_task_input ? 'requested_team' then nullif(v_task_input ->> 'requested_team', '') else task.requested_team end,
    assignee_id = case when v_task_input ? 'assignee_id' then nullif(v_task_input ->> 'assignee_id', '')::uuid else task.assignee_id end,
    assignee_team = case when v_task_input ? 'assignee_team' then nullif(v_task_input ->> 'assignee_team', '') else task.assignee_team end,
    secondary_assignee_id = case when v_task_input ? 'secondary_assignee_id' then nullif(v_task_input ->> 'secondary_assignee_id', '')::uuid else task.secondary_assignee_id end,
    student_id = case when v_task_input ? 'student_id' then nullif(v_task_input ->> 'student_id', '')::uuid else task.student_id end,
    class_id = case when v_task_input ? 'class_id' then nullif(v_task_input ->> 'class_id', '')::uuid else task.class_id end,
    textbook_id = case when v_task_input ? 'textbook_id' then nullif(v_task_input ->> 'textbook_id', '')::uuid else task.textbook_id end,
    student_name = case when v_task_input ? 'student_name' then nullif(v_task_input ->> 'student_name', '') else task.student_name end,
    class_name = case when v_task_input ? 'class_name' then nullif(v_task_input ->> 'class_name', '') else task.class_name end,
    textbook_title = case when v_task_input ? 'textbook_title' then nullif(v_task_input ->> 'textbook_title', '') else task.textbook_title end,
    campus = case when v_task_input ? 'campus' then nullif(v_task_input ->> 'campus', '') else task.campus end,
    subject = case when v_task_input ? 'subject' then nullif(v_task_input ->> 'subject', '') else task.subject end,
    start_at = case when v_task_input ? 'start_at' then nullif(v_task_input ->> 'start_at', '')::timestamptz else task.start_at end,
    due_at = case when v_task_input ? 'due_at' then nullif(v_task_input ->> 'due_at', '')::timestamptz else task.due_at end,
    completed_at = case
      when coalesce(nullif(v_task_input ->> 'status', ''), task.status) = 'done'
        then coalesce(nullif(v_task_input ->> 'completed_at', '')::timestamptz, task.completed_at, pg_catalog.clock_timestamp())
      else null
    end,
    memo = case when v_task_input ? 'memo' then nullif(v_task_input ->> 'memo', '') else task.memo end
  where task.id = p_task_id
  returning task.* into v_after;

  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, v_after.type);
  if v_after.type = 'word_retest' then
    v_detail_base := pg_catalog.to_jsonb(v_before_word)
      - 'task_id' - 'created_at' - 'updated_at'
      - 'retry_of_task_id' - 'retry_task_id';
  elsif v_after.type = 'transfer' then
    select pg_catalog.to_jsonb(detail) - 'task_id' - 'created_at' - 'updated_at'
    into v_detail_base
    from public.ops_transfer_details detail
    where detail.task_id = p_task_id;
  elsif v_after.type = 'withdrawal' then
    select pg_catalog.to_jsonb(detail) - 'task_id' - 'created_at' - 'updated_at'
    into v_detail_base
    from public.ops_withdrawal_details detail
    where detail.task_id = p_task_id;
  end if;
  v_detail := coalesce(v_detail_base, '{}'::jsonb) || v_detail;
  if v_after.type = 'word_retest' then
    if coalesce(
        v_after.student_id::text,
        nullif(pg_catalog.btrim(v_after.student_name), ''),
        nullif(pg_catalog.btrim(v_detail ->> 'student_name'), '')
      ) is null
      or coalesce(
        v_after.class_id::text,
        nullif(pg_catalog.btrim(v_after.class_name), ''),
        nullif(pg_catalog.btrim(v_detail ->> 'class_name'), '')
      ) is null
      or coalesce(
        nullif(v_detail ->> 'teacher_catalog_id', ''),
        nullif(pg_catalog.btrim(v_detail ->> 'teacher_name'), '')
      ) is null
      or nullif(v_detail ->> 'test_at', '') is null
    then
      raise exception 'word_retest_context_required' using errcode = '22023';
    end if;
    v_detail := v_detail || pg_catalog.jsonb_build_object(
      'retest_status', case
        when v_after.status in ('requested', 'confirmed') then 'not_started'
        when v_after.status = 'in_progress' then 'in_progress'
        when v_after.status = 'done' then case
          when v_before_word.retest_status = 'absent' then 'absent' else 'done'
        end
        when v_after.status = 'canceled' then 'absent'
        else v_before_word.retest_status
      end
    );
    if not (
      v_before.status = 'in_progress'
      and v_after.status = 'in_progress'
      and v_before_word.retest_status = 'in_progress'
    ) then
      v_detail := v_detail || pg_catalog.jsonb_build_object(
        'first_score', v_before_word.first_score,
        'second_score', v_before_word.second_score,
        'third_score', v_before_word.third_score,
        'score_out_of_100', v_before_word.score_out_of_100
      );
    end if;
  end if;
  perform dashboard_private.upsert_ops_task_detail_v2(v_after.id, v_after.type, v_detail);
  if v_after.type = 'word_retest' then
    select detail.* into v_after_word
    from public.ops_word_retests detail
    where detail.task_id = p_task_id;
  end if;
  -- SECURITY DEFINER가 기존 UPDATE RLS의 WITH CHECK를 우회하지 않도록
  -- 수정된 최종 소유권/담당자/연결 교사 기준으로 다시 권한을 확인한다.
  perform dashboard_private.assert_ops_task_actor_v2(v_after, null);

  if v_after.type = 'general' then
    if v_before.assignee_id is distinct from v_after.assignee_id
      or v_before.secondary_assignee_id is distinct from v_after.secondary_assignee_id
      or v_before.assignee_team is distinct from v_after.assignee_team
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'task.assignee_changed', p_request_id, 'assignee',
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_before.assignee_id,
          'secondary_profile_id', v_before.secondary_assignee_id,
          'team', v_before.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_after.assignee_id,
          'secondary_profile_id', v_after.secondary_assignee_id,
          'team', v_after.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'before_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_before.assignee_id,
            'secondary_profile_id', v_before.secondary_assignee_id,
            'team', v_before.assignee_team
          ),
          'after_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_after.assignee_id,
            'secondary_profile_id', v_after.secondary_assignee_id,
            'team', v_after.assignee_team
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.start_at is distinct from v_after.start_at or v_before.due_at is distinct from v_after.due_at then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'task.due_changed', p_request_id, 'schedule',
        pg_catalog.jsonb_build_object('start_at', v_before.start_at, 'due_at', v_before.due_at)::text,
        pg_catalog.jsonb_build_object('start_at', v_after.start_at, 'due_at', v_after.due_at)::text,
        pg_catalog.jsonb_build_object(
          'before_schedule', pg_catalog.jsonb_build_object(
            'start_at', v_before.start_at, 'due_at', v_before.due_at
          ),
          'after_schedule', pg_catalog.jsonb_build_object(
            'start_at', v_after.start_at, 'due_at', v_after.due_at
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.status is distinct from v_after.status then
      v_event_key := case
        when v_after.status = 'done' then 'task.completed'
        when v_after.status = 'canceled' then 'task.canceled'
        when v_before.status in ('done', 'canceled') then 'task.reopened'
        else 'task.status_changed'
      end;
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
  elsif v_after.type = 'word_retest' then
    if v_before.assignee_id is distinct from v_after.assignee_id
      or v_before.secondary_assignee_id is distinct from v_after.secondary_assignee_id
      or v_before.assignee_team is distinct from v_after.assignee_team
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'word_retest.assigned', p_request_id, 'assignee',
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_before.assignee_id,
          'secondary_profile_id', v_before.secondary_assignee_id,
          'team', v_before.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'primary_profile_id', v_after.assignee_id,
          'secondary_profile_id', v_after.secondary_assignee_id,
          'team', v_after.assignee_team
        )::text,
        pg_catalog.jsonb_build_object(
          'before_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_before.assignee_id,
            'secondary_profile_id', v_before.secondary_assignee_id,
            'team', v_before.assignee_team
          ),
          'after_assignee', pg_catalog.jsonb_build_object(
            'primary_profile_id', v_after.assignee_id,
            'secondary_profile_id', v_after.secondary_assignee_id,
            'team', v_after.assignee_team
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.start_at is distinct from v_after.start_at
      or v_before.due_at is distinct from v_after.due_at
      or v_before_word.test_at is distinct from v_after_word.test_at
    then
      v_source := dashboard_private.record_ops_task_notification_source_v2(
        v_after, 'word_retest.schedule_changed', p_request_id, 'schedule',
        pg_catalog.jsonb_build_object(
          'test_at', v_before_word.test_at,
          'start_at', v_before.start_at,
          'due_at', v_before.due_at
        )::text,
        pg_catalog.jsonb_build_object(
          'test_at', v_after_word.test_at,
          'start_at', v_after.start_at,
          'due_at', v_after.due_at
        )::text,
        pg_catalog.jsonb_build_object(
          'before_schedule', pg_catalog.jsonb_build_object(
            'test_at', v_before_word.test_at,
            'start_at', v_before.start_at,
            'due_at', v_before.due_at
          ),
          'after_schedule', pg_catalog.jsonb_build_object(
            'test_at', v_after_word.test_at,
            'start_at', v_after.start_at,
            'due_at', v_after.due_at
          )
        )
      );
      v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
    end if;
    if v_before.status is distinct from v_after.status then
      v_event_key := case
        when v_after.status = 'in_progress' then 'word_retest.started'
        when v_after.status = 'done' then 'word_retest.completed'
        when v_after.status = 'canceled' then 'word_retest.canceled'
        else null
      end;
      if v_event_key is not null then
        v_source := dashboard_private.record_ops_task_notification_source_v2(
          v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
        );
        v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
      end if;
    end if;
  end if;

  if v_after.type in ('transfer', 'withdrawal') then
    select coalesce(
      pg_catalog.jsonb_agg(event_row.id::text order by event_row.created_at, event_row.id),
      '[]'::jsonb
    )
    into v_source_event_ids
    from public.ops_task_events event_row
    where event_row.task_id = v_after.id
      and event_row.request_id = p_request_id
      and pg_catalog.split_part(event_row.event_type, '.', 1) = v_after.type;
    perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', '', true
    );
    perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', '', true
    );
  elsif v_after.type = 'textbook' then
    v_activity := dashboard_private.insert_ops_task_activity_event_v1(
      v_after, v_actor, 'updated', 'task', v_before.title, v_after.title, p_request_id
    );
    v_activity_event_id := (v_activity ->> 'sourceEventId')::uuid;
  end if;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_after),
    'sourceEventIds', v_source_event_ids,
    'activityEventId', v_activity_event_id
  ));
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'update_ops_task_v2', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.transition_ops_task_status_v2_impl(
  p_task_id uuid,
  p_status text,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'status', p_status,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay jsonb;
  v_before public.ops_tasks%rowtype;
  v_after public.ops_tasks%rowtype;
  v_event_key text;
  v_source jsonb;
  v_activity jsonb;
  v_activity_event_id uuid;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_status is null or p_status not in (
    'requested', 'confirmed', 'in_progress', 'review_requested', 'done', 'on_hold', 'canceled'
  ) or p_expected_updated_at is null or p_request_id is null then
    raise exception 'ops_task_status_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'transition_ops_task_status_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_before
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_before, null);
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception 'ops_task_stale_write' using errcode = '40001';
  end if;
  if v_before.type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;
  if v_before.type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_before.type in ('transfer', 'withdrawal') then
    if v_before.status = 'done' and p_status <> 'done' then
      raise exception 'ops_transition_closed' using errcode = '40001';
    end if;
    if p_status = 'done' and v_before.status <> 'done' then
      raise exception 'ops_transition_completion_rpc_required' using errcode = '22023';
    end if;
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
  end if;
  if v_before.type = 'word_retest' then
    if v_before.status in ('done', 'canceled') and p_status <> v_before.status then
      raise exception 'word_retest_closed' using errcode = '40001';
    end if;
    if p_status = 'review_requested' and v_before.status <> 'review_requested' then
      raise exception 'word_retest_result_rpc_required' using errcode = '22023';
    end if;
    if v_before.status = 'review_requested'
      and p_status not in ('review_requested', 'done', 'canceled')
    then
      raise exception 'word_retest_revision_rpc_required' using errcode = '22023';
    end if;
    if p_status = 'done' and v_before.status <> 'review_requested' then
      raise exception 'word_retest_completion_not_allowed' using errcode = '40001';
    end if;
  end if;

  update public.ops_tasks task set
    status = p_status,
    completed_at = case when p_status = 'done'
      then coalesce(task.completed_at, pg_catalog.clock_timestamp()) else null end
  where task.id = p_task_id
  returning task.* into v_after;

  if v_after.type = 'word_retest' then
    update public.ops_word_retests detail
    set retest_status = case
      when p_status in ('requested', 'confirmed') then 'not_started'
      when p_status = 'in_progress' then 'in_progress'
      when p_status = 'review_requested' then case
        when detail.retest_status in ('done', 'absent') then detail.retest_status
        else 'in_progress'
      end
      when p_status = 'done' then case
        when detail.retest_status = 'absent' then 'absent'
        else 'done'
      end
      when p_status = 'canceled' then 'absent'
      else detail.retest_status
    end
    where detail.task_id = p_task_id;
    if not found then
      raise exception 'word_retest_not_found' using errcode = 'P0002';
    end if;
  end if;

  if v_before.status is distinct from v_after.status and v_after.type = 'general' then
    v_event_key := case
      when v_after.status = 'done' then 'task.completed'
      when v_after.status = 'canceled' then 'task.canceled'
      when v_before.status in ('done', 'canceled') then 'task.reopened'
      else 'task.status_changed'
    end;
  elsif v_before.status is distinct from v_after.status and v_after.type = 'word_retest' then
    v_event_key := case
      when v_after.status = 'in_progress' then 'word_retest.started'
      when v_after.status = 'done' then 'word_retest.completed'
      when v_after.status = 'canceled' then 'word_retest.canceled'
      else null
    end;
  end if;
  if v_event_key is not null then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_after, v_event_key, p_request_id, 'status', v_before.status, v_after.status
    );
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;
  if v_after.type in ('transfer', 'withdrawal') then
    select coalesce(
      pg_catalog.jsonb_agg(event_row.id::text order by event_row.created_at, event_row.id),
      '[]'::jsonb
    )
    into v_source_event_ids
    from public.ops_task_events event_row
    where event_row.task_id = v_after.id
      and event_row.request_id = p_request_id
      and pg_catalog.split_part(event_row.event_type, '.', 1) = v_after.type;
    perform pg_catalog.set_config('app.ops_transition_request_id', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_completion_authorized', '', true
    );
    perform pg_catalog.set_config('app.ops_transition_defer_details', '', true);
    perform pg_catalog.set_config(
      'app.ops_transition_parent_details_changed', '', true
    );
  elsif v_after.type = 'textbook' then
    v_activity := dashboard_private.insert_ops_task_activity_event_v1(
      v_after, v_actor, 'status_changed', 'status',
      v_before.status, v_after.status, p_request_id
    );
    v_activity_event_id := (v_activity ->> 'sourceEventId')::uuid;
  end if;

  v_response := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_after),
    'sourceEventIds', v_source_event_ids,
    'activityEventId', v_activity_event_id
  ));
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'transition_ops_task_status_v2', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.insert_ops_task_activity_event_v1(
  p_task public.ops_tasks,
  p_actor uuid,
  p_event_type text,
  p_field_name text,
  p_before_value text,
  p_after_value text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_authorized_actor uuid := dashboard_private.assert_ops_task_actor_v2(p_task, null);
  v_event_type text := nullif(pg_catalog.btrim(p_event_type), '');
  v_field_name text := nullif(pg_catalog.btrim(p_field_name), '');
  v_before_value text := nullif(pg_catalog.btrim(p_before_value), '');
  v_after_value text := nullif(pg_catalog.btrim(p_after_value), '');
  v_source_event_id uuid := pg_catalog.gen_random_uuid();
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_payload jsonb;
  v_event public.ops_task_events%rowtype;
begin
  if p_task.id is null
    or p_actor is null
    or p_actor is distinct from v_authorized_actor
    or p_request_id is null
    or p_task.type not in ('registration', 'transfer', 'withdrawal', 'textbook')
    or v_event_type is null
    or v_event_type not in (
      'auto_synced', 'manual_checked', 'manual_unchecked', 'auto_checked',
      'rollback', 'created', 'updated', 'status_changed', 'revision_requested'
    )
    or pg_catalog.char_length(coalesce(v_field_name, '')) > 160
    or pg_catalog.char_length(coalesce(v_before_value, '')) > 4000
    or pg_catalog.char_length(coalesce(v_after_value, '')) > 4000
  then
    raise exception 'ops_task_activity_event_invalid' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', p_task.id,
    'task_type', p_task.type,
    'event_type', v_event_type,
    'field_name', v_field_name,
    'before_value', v_before_value,
    'after_value', v_after_value,
    'actor_profile_id', p_actor,
    'stable_request_key', p_request_id,
    'source_event_id', v_source_event_id,
    'occurred_at', v_occurred_at
  ));
  insert into public.ops_task_events(
    id, task_id, actor_id, event_type, field_name,
    before_value, after_value, request_id, payload, created_at
  ) values (
    v_source_event_id, p_task.id, p_actor, v_event_type, v_field_name,
    v_before_value, v_after_value, p_request_id, v_payload, v_occurred_at
  ) returning * into v_event;

  return pg_catalog.jsonb_build_object(
    'event', pg_catalog.to_jsonb(v_event),
    'sourceEventId', v_source_event_id
  );
end;
$$;

create or replace function dashboard_private.record_ops_task_activity_event_v1_impl(
  p_task_id uuid,
  p_event_type text,
  p_field_name text,
  p_before_value text,
  p_after_value text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_event_type text := nullif(pg_catalog.btrim(p_event_type), '');
  v_field_name text := nullif(pg_catalog.btrim(p_field_name), '');
  v_before_value text := nullif(pg_catalog.btrim(p_before_value), '');
  v_after_value text := nullif(pg_catalog.btrim(p_after_value), '');
  v_fingerprint text;
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_response jsonb;
begin
  -- 이 공개 호환 경계는 권위 업무 행을 바꾸지 않는 운영 활동만 받는다.
  -- 생성·수정·상태 전이는 행을 잠근 create/update/transition RPC가 직접 기록한다.
  if p_task_id is null
    or p_request_id is null
    or v_event_type is null
    or v_event_type not in (
      'auto_synced', 'manual_checked', 'manual_unchecked', 'auto_checked', 'rollback'
    )
    or pg_catalog.char_length(coalesce(v_field_name, '')) > 160
    or pg_catalog.char_length(coalesce(v_before_value, '')) > 4000
    or pg_catalog.char_length(coalesce(v_after_value, '')) > 4000
  then
    raise exception 'ops_task_activity_event_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'task_id', p_task_id,
    'event_type', v_event_type,
    'field_name', v_field_name,
    'before_value', v_before_value,
    'after_value', v_after_value
  )::text);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'record_ops_task_activity_event_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for share of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.type not in ('registration', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_activity_event_type_forbidden' using errcode = '22023';
  end if;

  v_response := dashboard_private.insert_ops_task_activity_event_v1(
    v_task, v_actor, v_event_type, v_field_name,
    v_before_value, v_after_value, p_request_id
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'record_ops_task_activity_event_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.cleanup_created_ops_task_v1_impl(
  p_task_id uuid,
  p_expected_created_at timestamptz,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()),
    'task_id', p_task_id,
    'expected_created_at', p_expected_created_at
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_deleted_task_id uuid;
  v_response jsonb;
begin
  if p_task_id is null or p_expected_created_at is null or p_request_id is null then
    raise exception 'ops_task_cleanup_invalid' using errcode = '22023';
  end if;
  if v_actor is null or not exists (
    select 1 from public.profiles profile where profile.id = v_actor
  ) then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'cleanup_created_ops_task_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.type <> 'registration'
    or v_task.created_at is distinct from p_expected_created_at
    or v_task.created_at < pg_catalog.clock_timestamp() - interval '1 hour'
    or v_task.status in ('done', 'canceled')
    or dashboard_private.registration_task_has_subject_tracks(v_task.id)
  then
    raise exception 'ops_task_cleanup_scope_forbidden' using errcode = '40001';
  end if;
  if v_actor is distinct from v_task.requested_by
    and v_role not in ('admin', 'staff')
  then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;

  delete from public.ops_tasks task
  where task.id = v_task.id
  returning task.id into v_deleted_task_id;
  if v_deleted_task_id is null then
    raise exception 'ops_task_cleanup_failed' using errcode = 'P0002';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_deleted_task_id,
    'deleted', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'cleanup_created_ops_task_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.add_ops_task_comment_v2_impl(
  p_task_id uuid,
  p_body text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id,
    'body', pg_catalog.btrim(p_body)
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_comment public.ops_task_comments%rowtype;
  v_event_key text;
  v_source jsonb;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_task_id is null or nullif(pg_catalog.btrim(p_body), '') is null
    or pg_catalog.char_length(pg_catalog.btrim(p_body)) > 4000
    or p_request_id is null
  then
    raise exception 'ops_task_comment_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'add_ops_task_comment_v2', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.type not in (
    'general', 'word_retest', 'registration', 'transfer', 'withdrawal', 'textbook'
  ) then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;

  insert into public.ops_task_comments(task_id, author_id, body)
  values (p_task_id, v_actor, pg_catalog.btrim(p_body))
  returning * into v_comment;

  v_event_key := case
    when v_task.type = 'general' then 'task.comment_added'
    when v_task.type = 'word_retest' then null
    else null
  end;
  if v_event_key is not null then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_task, v_event_key, p_request_id, 'comment', null, v_comment.id::text,
      pg_catalog.jsonb_build_object('comment_id', v_comment.id), v_comment.id
    );
    v_source_event_ids := pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'comment', pg_catalog.to_jsonb(v_comment),
    'sourceId', v_comment.id,
    'sourceEventIds', v_source_event_ids
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'add_ops_task_comment_v2', v_fingerprint, v_response
  );
end;
$$;

alter table public.ops_task_events
  add column if not exists request_id uuid,
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.ops_word_retests
  add column if not exists retry_of_task_id uuid references public.ops_tasks(id) on delete set null,
  add column if not exists retry_task_id uuid references public.ops_tasks(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ops_task_events_payload_object_check'
      and conrelid = 'public.ops_task_events'::regclass
  ) then
    alter table public.ops_task_events
      add constraint ops_task_events_payload_object_check
      check (pg_catalog.jsonb_typeof(payload) = 'object');
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ops_word_retests_retry_distinct_check'
      and conrelid = 'public.ops_word_retests'::regclass
  ) then
    alter table public.ops_word_retests
      add constraint ops_word_retests_retry_distinct_check
      check (
        (retry_of_task_id is null or retry_of_task_id <> task_id)
        and (retry_task_id is null or retry_task_id <> task_id)
      );
  end if;
end;
$$;

create unique index if not exists ops_task_events_request_event_uidx
  on public.ops_task_events(
    request_id,
    event_type,
    coalesce(field_name, '')
  )
  where request_id is not null;

create unique index if not exists ops_word_retests_retry_of_uidx
  on public.ops_word_retests(retry_of_task_id)
  where retry_of_task_id is not null;

create unique index if not exists ops_word_retests_retry_task_uidx
  on public.ops_word_retests(retry_task_id)
  where retry_task_id is not null;

create or replace function dashboard_private.ops_task_request_replay_v2(
  p_request_id uuid,
  p_request_kind text,
  p_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger dashboard_private.notification_request_ledger%rowtype;
begin
  if p_request_id is null
    or nullif(pg_catalog.btrim(p_request_kind), '') is null
    or nullif(pg_catalog.btrim(p_fingerprint), '') is null
  then
    raise exception 'ops_task_request_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if not found then
    return null;
  end if;
  if v_ledger.request_kind <> p_request_kind
    or v_ledger.request_fingerprint <> p_fingerprint
  then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  return v_ledger.response_payload;
end;
$$;

create or replace function dashboard_private.finish_ops_task_request_v2(
  p_request_id uuid,
  p_request_kind text,
  p_fingerprint text,
  p_response jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_response is null or pg_catalog.jsonb_typeof(p_response) <> 'object' then
    raise exception 'ops_task_response_invalid' using errcode = '22023';
  end if;
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (
    p_request_id, p_request_kind, p_fingerprint, p_response
  );
  return p_response;
end;
$$;

create or replace function dashboard_private.assert_ops_task_actor_v2(
  p_task public.ops_tasks default null,
  p_requested_by uuid default null
) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles profile where profile.id = v_actor
  ) then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  if p_task.id is not null
    and coalesce(v_role, '') not in ('admin', 'staff', 'assistant')
    and v_actor is distinct from p_task.requested_by
    and v_actor is distinct from p_task.assignee_id
    and v_actor is distinct from p_task.secondary_assignee_id
    and not dashboard_private.is_ops_word_retest_teacher(p_task.id)
  then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  if p_task.id is null
    and p_requested_by is not null
    and p_requested_by <> v_actor
    and coalesce(v_role, '') not in ('admin', 'staff', 'assistant')
  then
    raise exception 'ops_task_access_denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function dashboard_private.ops_task_management_profile_ids_v2()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    array[]::uuid[]
  )
  from public.profiles profile
  where profile.role in ('admin', 'staff')
    and dashboard_private.notification_profile_is_active_v1(profile.id);
$$;

create or replace function dashboard_private.ops_task_input_task_v2(p_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_input -> 'task') = 'object' then p_input -> 'task'
    else coalesce(p_input, '{}'::jsonb)
  end;
$$;

create or replace function dashboard_private.ops_task_input_detail_v2(
  p_input jsonb,
  p_type text
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'word_retest' then coalesce(p_input -> 'word_retest', p_input -> 'wordRetest', '{}'::jsonb)
    when 'transfer' then coalesce(p_input -> 'transfer', '{}'::jsonb)
    when 'withdrawal' then coalesce(p_input -> 'withdrawal', '{}'::jsonb)
    else '{}'::jsonb
  end;
$$;

create or replace function dashboard_private.insert_ops_task_from_json_v2(
  p_input jsonb,
  p_actor uuid
) returns public.ops_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_input jsonb := dashboard_private.ops_task_input_task_v2(p_input);
  v_detail_input jsonb;
  v_task public.ops_tasks%rowtype;
  v_type text := nullif(pg_catalog.btrim(v_task_input ->> 'type'), '');
  v_status text := coalesce(nullif(v_task_input ->> 'status', ''), 'requested');
  v_retest_status text;
  v_requested_by uuid := coalesce(nullif(v_task_input ->> 'requested_by', '')::uuid, p_actor);
begin
  if pg_catalog.jsonb_typeof(v_task_input) <> 'object'
    or nullif(pg_catalog.btrim(v_task_input ->> 'title'), '') is null
    or v_type is null
  then
    raise exception 'ops_task_input_invalid' using errcode = '22023';
  end if;
  if v_type = 'registration' then
    raise exception 'registration_dedicated_service_required' using errcode = '22023';
  end if;
  if v_type not in ('general', 'word_retest', 'transfer', 'withdrawal', 'textbook') then
    raise exception 'ops_task_type_not_supported' using errcode = '22023';
  end if;
  if v_type = 'word_retest' then
    v_detail_input := dashboard_private.ops_task_input_detail_v2(p_input, v_type);
    v_retest_status := coalesce(nullif(v_detail_input ->> 'retest_status', ''), 'not_started');
    if v_status <> 'requested'
      or v_retest_status <> 'not_started'
      or nullif(v_detail_input ->> 'first_score', '') is not null
      or nullif(v_detail_input ->> 'second_score', '') is not null
      or nullif(v_detail_input ->> 'third_score', '') is not null
      or nullif(v_detail_input ->> 'score_out_of_100', '') is not null
    then
      raise exception 'word_retest_initial_state_invalid' using errcode = '22023';
    end if;
    if coalesce(
        nullif(v_task_input ->> 'student_id', ''),
        nullif(pg_catalog.btrim(v_task_input ->> 'student_name'), ''),
        nullif(pg_catalog.btrim(v_detail_input ->> 'student_name'), '')
      ) is null
      or coalesce(
        nullif(v_task_input ->> 'class_id', ''),
        nullif(pg_catalog.btrim(v_task_input ->> 'class_name'), ''),
        nullif(pg_catalog.btrim(v_detail_input ->> 'class_name'), '')
      ) is null
      or coalesce(
        nullif(v_detail_input ->> 'teacher_catalog_id', ''),
        nullif(pg_catalog.btrim(v_detail_input ->> 'teacher_name'), '')
      ) is null
      or nullif(v_detail_input ->> 'test_at', '') is null
    then
      raise exception 'word_retest_context_required' using errcode = '22023';
    end if;
  end if;
  perform dashboard_private.assert_ops_task_actor_v2(null, v_requested_by);

  insert into public.ops_tasks(
    title, type, status, priority, requested_by, requested_team,
    assignee_id, assignee_team, secondary_assignee_id,
    student_id, class_id, textbook_id,
    student_name, class_name, textbook_title, campus, subject,
    start_at, due_at, completed_at, memo
  ) values (
    pg_catalog.btrim(v_task_input ->> 'title'),
    v_type,
    v_status,
    coalesce(nullif(v_task_input ->> 'priority', ''), 'normal'),
    v_requested_by,
    nullif(v_task_input ->> 'requested_team', ''),
    nullif(v_task_input ->> 'assignee_id', '')::uuid,
    nullif(v_task_input ->> 'assignee_team', ''),
    nullif(v_task_input ->> 'secondary_assignee_id', '')::uuid,
    nullif(v_task_input ->> 'student_id', '')::uuid,
    nullif(v_task_input ->> 'class_id', '')::uuid,
    nullif(v_task_input ->> 'textbook_id', '')::uuid,
    nullif(v_task_input ->> 'student_name', ''),
    nullif(v_task_input ->> 'class_name', ''),
    nullif(v_task_input ->> 'textbook_title', ''),
    nullif(v_task_input ->> 'campus', ''),
    nullif(v_task_input ->> 'subject', ''),
    nullif(v_task_input ->> 'start_at', '')::timestamptz,
    nullif(v_task_input ->> 'due_at', '')::timestamptz,
    case
      when v_status = 'done'
        then coalesce(nullif(v_task_input ->> 'completed_at', '')::timestamptz, pg_catalog.clock_timestamp())
      else nullif(v_task_input ->> 'completed_at', '')::timestamptz
    end,
    nullif(v_task_input ->> 'memo', '')
  ) returning * into v_task;
  return v_task;
end;
$$;

create or replace function dashboard_private.upsert_ops_task_detail_v2(
  p_task_id uuid,
  p_type text,
  p_detail jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_type = 'word_retest' then
    if p_detail ? 'retry_of_task_id' or p_detail ? 'retry_task_id' then
      raise exception 'word_retest_retry_link_forbidden' using errcode = '22023';
    end if;
    insert into public.ops_word_retests(
      task_id, branch, teacher_catalog_id, teacher_name, class_name, student_name,
      test_at, textbook_name, unit, request_note,
      total_question_count, score_out_of_100, cutoff_question_count,
      first_score, second_score, third_score, retest_status
    ) values (
      p_task_id,
      coalesce(nullif(p_detail ->> 'branch', ''), '본관'),
      nullif(p_detail ->> 'teacher_catalog_id', '')::uuid,
      nullif(p_detail ->> 'teacher_name', ''),
      nullif(p_detail ->> 'class_name', ''),
      nullif(p_detail ->> 'student_name', ''),
      nullif(p_detail ->> 'test_at', '')::timestamptz,
      nullif(p_detail ->> 'textbook_name', ''),
      nullif(p_detail ->> 'unit', ''),
      nullif(p_detail ->> 'request_note', ''),
      nullif(p_detail ->> 'total_question_count', '')::numeric,
      nullif(p_detail ->> 'score_out_of_100', '')::numeric,
      nullif(p_detail ->> 'cutoff_question_count', '')::numeric,
      nullif(p_detail ->> 'first_score', '')::numeric,
      nullif(p_detail ->> 'second_score', '')::numeric,
      nullif(p_detail ->> 'third_score', '')::numeric,
      coalesce(nullif(p_detail ->> 'retest_status', ''), 'not_started')
    )
    on conflict (task_id) do update set
      branch = excluded.branch,
      teacher_catalog_id = excluded.teacher_catalog_id,
      teacher_name = excluded.teacher_name,
      class_name = excluded.class_name,
      student_name = excluded.student_name,
      test_at = excluded.test_at,
      textbook_name = excluded.textbook_name,
      unit = excluded.unit,
      request_note = excluded.request_note,
      total_question_count = excluded.total_question_count,
      score_out_of_100 = excluded.score_out_of_100,
      cutoff_question_count = excluded.cutoff_question_count,
      first_score = excluded.first_score,
      second_score = excluded.second_score,
      third_score = excluded.third_score,
      retest_status = excluded.retest_status;
  elsif p_type = 'transfer' then
    insert into public.ops_transfer_details(
      task_id, transfer_reason, from_class_id, to_class_id,
      from_teacher_name, to_teacher_name, from_class_name, to_class_name,
      from_class_end_date, from_class_end_session,
      to_class_start_date, to_class_start_session,
      from_undistributed_textbooks, to_undistributed_textbooks,
      timetable_roster_updated, makeedu_transfer_done, fee_processed, textbook_fee_processed
    ) values (
      p_task_id, nullif(p_detail ->> 'transfer_reason', ''),
      nullif(p_detail ->> 'from_class_id', '')::uuid,
      nullif(p_detail ->> 'to_class_id', '')::uuid,
      nullif(p_detail ->> 'from_teacher_name', ''), nullif(p_detail ->> 'to_teacher_name', ''),
      nullif(p_detail ->> 'from_class_name', ''), nullif(p_detail ->> 'to_class_name', ''),
      nullif(p_detail ->> 'from_class_end_date', '')::date,
      nullif(p_detail ->> 'from_class_end_session', ''),
      nullif(p_detail ->> 'to_class_start_date', '')::date,
      nullif(p_detail ->> 'to_class_start_session', ''),
      nullif(p_detail ->> 'from_undistributed_textbooks', ''),
      nullif(p_detail ->> 'to_undistributed_textbooks', ''),
      coalesce((p_detail ->> 'timetable_roster_updated')::boolean, false),
      coalesce((p_detail ->> 'makeedu_transfer_done')::boolean, false),
      coalesce((p_detail ->> 'fee_processed')::boolean, false),
      coalesce((p_detail ->> 'textbook_fee_processed')::boolean, false)
    ) on conflict (task_id) do update set
      transfer_reason = excluded.transfer_reason,
      from_class_id = excluded.from_class_id,
      to_class_id = excluded.to_class_id,
      from_teacher_name = excluded.from_teacher_name,
      to_teacher_name = excluded.to_teacher_name,
      from_class_name = excluded.from_class_name,
      to_class_name = excluded.to_class_name,
      from_class_end_date = excluded.from_class_end_date,
      from_class_end_session = excluded.from_class_end_session,
      to_class_start_date = excluded.to_class_start_date,
      to_class_start_session = excluded.to_class_start_session,
      from_undistributed_textbooks = excluded.from_undistributed_textbooks,
      to_undistributed_textbooks = excluded.to_undistributed_textbooks,
      timetable_roster_updated = excluded.timetable_roster_updated,
      makeedu_transfer_done = excluded.makeedu_transfer_done,
      fee_processed = excluded.fee_processed,
      textbook_fee_processed = excluded.textbook_fee_processed;
  elsif p_type = 'withdrawal' then
    insert into public.ops_withdrawal_details(
      task_id, school_grade, teacher_name, withdrawal_date, withdrawal_session,
      customer_reason, teacher_opinion, undistributed_textbooks,
      completed_lesson_hours, four_week_lesson_hours,
      timetable_roster_updated, makeedu_withdrawal_done, fee_processed, textbook_fee_processed
    ) values (
      p_task_id, nullif(p_detail ->> 'school_grade', ''), nullif(p_detail ->> 'teacher_name', ''),
      nullif(p_detail ->> 'withdrawal_date', '')::date,
      nullif(p_detail ->> 'withdrawal_session', ''),
      nullif(p_detail ->> 'customer_reason', ''), nullif(p_detail ->> 'teacher_opinion', ''),
      nullif(p_detail ->> 'undistributed_textbooks', ''),
      nullif(p_detail ->> 'completed_lesson_hours', '')::numeric,
      nullif(p_detail ->> 'four_week_lesson_hours', '')::numeric,
      coalesce((p_detail ->> 'timetable_roster_updated')::boolean, false),
      coalesce((p_detail ->> 'makeedu_withdrawal_done')::boolean, false),
      coalesce((p_detail ->> 'fee_processed')::boolean, false),
      coalesce((p_detail ->> 'textbook_fee_processed')::boolean, false)
    ) on conflict (task_id) do update set
      school_grade = excluded.school_grade,
      teacher_name = excluded.teacher_name,
      withdrawal_date = excluded.withdrawal_date,
      withdrawal_session = excluded.withdrawal_session,
      customer_reason = excluded.customer_reason,
      teacher_opinion = excluded.teacher_opinion,
      undistributed_textbooks = excluded.undistributed_textbooks,
      completed_lesson_hours = excluded.completed_lesson_hours,
      four_week_lesson_hours = excluded.four_week_lesson_hours,
      timetable_roster_updated = excluded.timetable_roster_updated,
      makeedu_withdrawal_done = excluded.makeedu_withdrawal_done,
      fee_processed = excluded.fee_processed,
      textbook_fee_processed = excluded.textbook_fee_processed;
  end if;
end;
$$;

create or replace function dashboard_private.cancel_ops_task_unsent_work_v1(
  p_task_id uuid,
  p_reason text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job_count bigint := 0;
  v_delivery_count bigint := 0;
begin
  if p_task_id is null or p_reason not in ('source_status_changed', 'source_schedule_changed') then
    raise exception 'ops_task_supersession_invalid' using errcode = '22023';
  end if;

  perform 1
  from dashboard_private.notification_event_fanout_jobs job
  join dashboard_private.notification_events event_row on event_row.id = job.event_id
  where event_row.workflow_key in ('tasks', 'word_retests')
    and event_row.payload ->> 'task_id' = p_task_id::text
    and (
      p_reason = 'source_status_changed'
      or event_row.event_key in ('task.due_changed', 'word_retest.schedule_changed')
    )
    and job.status in ('pending', 'claimed')
  order by job.id
  for update of job;

  with stopped as (
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'failed',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        last_error_code = p_reason,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where event_row.id = job.event_id
      and event_row.workflow_key in ('tasks', 'word_retests')
      and event_row.payload ->> 'task_id' = p_task_id::text
      and (
        p_reason = 'source_status_changed'
        or event_row.event_key in ('task.due_changed', 'word_retest.schedule_changed')
      )
      and job.status in ('pending', 'claimed')
    returning job.id
  ) select pg_catalog.count(*) into v_job_count from stopped;

  with canceled as (
    update dashboard_private.notification_deliveries delivery
    set status = 'canceled',
        status_reason = p_reason,
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        cancel_requested_at = null,
        cancel_reason = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where event_row.id = delivery.event_id
      and event_row.workflow_key in ('tasks', 'word_retests')
      and event_row.payload ->> 'task_id' = p_task_id::text
      and (
        p_reason = 'source_status_changed'
        or event_row.event_key in ('task.due_changed', 'word_retest.schedule_changed')
      )
      and delivery.status in ('pending', 'retry_wait')
    returning delivery.id
  ), requested as (
    update dashboard_private.notification_deliveries delivery
    set cancel_requested_at = coalesce(
          delivery.cancel_requested_at,
          pg_catalog.clock_timestamp()
        ),
        cancel_reason = p_reason,
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where event_row.id = delivery.event_id
      and event_row.workflow_key in ('tasks', 'word_retests')
      and event_row.payload ->> 'task_id' = p_task_id::text
      and (
        p_reason = 'source_status_changed'
        or event_row.event_key in ('task.due_changed', 'word_retest.schedule_changed')
      )
      and delivery.status = 'claimed'
    returning delivery.id
  )
  select pg_catalog.count(*) into v_delivery_count
  from (
    select id from canceled
    union all
    select id from requested
  ) changed;

  return pg_catalog.jsonb_build_object(
    'fanoutJobsStopped', v_job_count,
    'deliveriesCanceled', v_delivery_count,
    'reason', p_reason
  );
end;
$$;

create or replace function dashboard_private.record_ops_task_notification_source_v2(
  p_task public.ops_tasks,
  p_event_key text,
  p_request_id uuid,
  p_field_name text default null,
  p_before_value text default null,
  p_after_value text default null,
  p_extra_payload jsonb default '{}'::jsonb,
  p_comment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.assert_ops_task_actor_v2(p_task, null);
  v_workflow_key text := case when p_task.type = 'word_retest' then 'word_retests' else 'tasks' end;
  v_prefix text := case when p_task.type = 'word_retest' then 'word_retest' else 'task' end;
  v_source_event_id uuid := pg_catalog.gen_random_uuid();
  v_source_type text := case when p_comment_id is null then 'ops_task_event' else 'ops_task_comment' end;
  v_source_id uuid := coalesce(p_comment_id, v_source_event_id);
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_word public.ops_word_retests%rowtype;
  v_result_summary text;
  v_payload jsonb;
  v_recorded jsonb;
begin
  if p_task.type not in ('general', 'word_retest')
    or p_event_key not like v_prefix || '.%'
    or p_event_key not in (
      'task.created', 'task.assignee_changed', 'task.due_changed', 'task.status_changed',
      'task.completed', 'task.canceled', 'task.reopened', 'task.comment_added',
      'word_retest.created', 'word_retest.assigned', 'word_retest.schedule_changed',
      'word_retest.started', 'word_retest.result_reported', 'word_retest.absent_reported',
      'word_retest.revision_requested', 'word_retest.retry_created',
      'word_retest.completed', 'word_retest.canceled'
    )
    or p_request_id is null
    or p_extra_payload is null
    or pg_catalog.jsonb_typeof(p_extra_payload) <> 'object'
  then
    raise exception 'ops_task_notification_event_invalid' using errcode = '22023';
  end if;

  if p_task.type = 'word_retest' then
    select detail.* into v_word
    from public.ops_word_retests detail
    where detail.task_id = p_task.id;
    if not found then
      raise exception 'word_retest_not_found' using errcode = 'P0002';
    end if;
    if v_word.retest_status = 'absent' then
      v_result_summary := 'absent';
    elsif v_word.retest_status = 'done'
      and v_word.cutoff_question_count is not null
      and exists (
        select 1 from (values
          (v_word.first_score), (v_word.second_score), (v_word.third_score)
        ) score(value)
        where score.value >= v_word.cutoff_question_count
      )
    then
      v_result_summary := 'passed';
    elsif v_word.retest_status = 'done'
      and exists (
        select 1 from (values
          (v_word.first_score), (v_word.second_score), (v_word.third_score)
        ) score(value)
        where score.value is not null
      )
    then
      v_result_summary := 'failed';
    end if;
  end if;

  if p_event_key in ('task.canceled', 'word_retest.canceled') then
    perform dashboard_private.cancel_ops_task_unsent_work_v1(
      p_task.id, 'source_status_changed'
    );
  elsif p_event_key in ('task.due_changed', 'word_retest.schedule_changed') then
    perform dashboard_private.cancel_ops_task_unsent_work_v1(
      p_task.id, 'source_schedule_changed'
    );
  end if;

  v_payload := pg_catalog.jsonb_strip_nulls(p_extra_payload || pg_catalog.jsonb_build_object(
    'task_id', p_task.id,
    'event_key', p_event_key,
    'task_title', p_task.title,
    'task_status', p_task.status,
    'priority', p_task.priority,
    'actor_profile_id', v_actor,
    'requester_profile_id', p_task.requested_by,
    'requester_team', p_task.requested_team,
    'primary_assignee_profile_id', p_task.assignee_id,
    'assignee_team', p_task.assignee_team,
    'secondary_assignee_profile_id', p_task.secondary_assignee_id,
    'requesting_teacher_profile_id', p_task.requested_by,
    'assigned_assistant_profile_id', p_task.assignee_id,
    'student_id', p_task.student_id,
    'student_name', coalesce(
      p_task.student_name,
      case when p_task.type = 'word_retest' then v_word.student_name end
    ),
    'class_id', p_task.class_id,
    'class_name', coalesce(
      p_task.class_name,
      case when p_task.type = 'word_retest' then v_word.class_name end
    ),
    'textbook_id', p_task.textbook_id,
    'textbook_title', coalesce(
      p_task.textbook_title,
      case when p_task.type = 'word_retest' then v_word.textbook_name end
    ),
    'start_at', p_task.start_at,
    'due_at', p_task.due_at,
    'completed_at', p_task.completed_at,
    'canceled_at', case when p_task.status = 'canceled' then v_occurred_at end,
    'field_name', p_field_name,
    'before_value', p_before_value,
    'after_value', p_after_value,
    'comment_id', p_comment_id,
    'comment_author_profile_id', case when p_comment_id is not null then v_actor end,
    'stable_request_key', p_request_id,
    'branch', case when p_task.type = 'word_retest' then v_word.branch end,
    'teacher_catalog_id', case when p_task.type = 'word_retest' then v_word.teacher_catalog_id end,
    'teacher_name', case when p_task.type = 'word_retest' then v_word.teacher_name end,
    'test_at', case when p_task.type = 'word_retest' then v_word.test_at end,
    'retest_status', case when p_task.type = 'word_retest' then v_word.retest_status end,
    'total_question_count', case when p_task.type = 'word_retest' then v_word.total_question_count end,
    'cutoff_question_count', case when p_task.type = 'word_retest' then v_word.cutoff_question_count end,
    'first_score', case when p_task.type = 'word_retest' then v_word.first_score end,
    'second_score', case when p_task.type = 'word_retest' then v_word.second_score end,
    'third_score', case when p_task.type = 'word_retest' then v_word.third_score end,
    'score_out_of_100', case when p_task.type = 'word_retest' then v_word.score_out_of_100 end,
    'result_summary', v_result_summary,
    'previous_task_id', case when p_task.type = 'word_retest' then v_word.retry_of_task_id end,
    'retry_task_id', case
      when p_event_key = 'word_retest.retry_created' then p_task.id
      when p_task.type = 'word_retest' then v_word.retry_task_id
    end,
    'management_profile_ids', pg_catalog.to_jsonb(dashboard_private.ops_task_management_profile_ids_v2()),
    'occurred_at', v_occurred_at,
    'source_event_id', v_source_event_id
  ));

  insert into public.ops_task_events(
    id, task_id, actor_id, event_type, field_name,
    before_value, after_value, request_id, payload, created_at
  ) values (
    v_source_event_id, p_task.id, v_actor, p_event_key, p_field_name,
    p_before_value, p_after_value, p_request_id, v_payload, v_occurred_at
  );

  v_recorded := dashboard_private.record_notification_event_v1(
    'global',
    v_workflow_key,
    p_event_key,
    v_source_type,
    v_source_id::text,
    null,
    v_source_id::text,
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

create or replace function dashboard_private.retry_word_retest_v1_impl(
  p_previous_task_id uuid,
  p_input jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'previous_task_id', p_previous_task_id, 'input', p_input
  )::text);
  v_replay jsonb;
  v_previous_task public.ops_tasks%rowtype;
  v_previous_detail public.ops_word_retests%rowtype;
  v_previous_status text;
  v_new_task public.ops_tasks%rowtype;
  v_detail jsonb;
  v_source jsonb;
  v_source_event_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_previous_task_id is null or p_input is null
    or pg_catalog.jsonb_typeof(p_input) <> 'object' or p_request_id is null
  then
    raise exception 'word_retest_retry_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'retry_word_retest_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select previous_task.* into v_previous_task
  from public.ops_tasks previous_task
  where previous_task.id = p_previous_task_id
  for update of previous_task;
  if not found or v_previous_task.type <> 'word_retest' then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  v_actor := dashboard_private.assert_ops_task_actor_v2(v_previous_task, null);
  select detail.* into v_previous_detail
  from public.ops_word_retests detail
  where detail.task_id = p_previous_task_id
  for update of detail;
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  if v_previous_task.status <> 'review_requested'
    or v_previous_detail.retest_status <> 'done'
    or v_previous_detail.cutoff_question_count is null
    or not exists (
      select 1 from (values
        (v_previous_detail.first_score),
        (v_previous_detail.second_score),
        (v_previous_detail.third_score)
      ) score(value)
      where score.value is not null
    )
    or exists (
      select 1 from (values
        (v_previous_detail.first_score),
        (v_previous_detail.second_score),
        (v_previous_detail.third_score)
      ) score(value)
      where score.value >= v_previous_detail.cutoff_question_count
    )
    or v_previous_detail.retry_task_id is not null
  then
    raise exception 'word_retest_retry_conflict' using errcode = '40001';
  end if;
  v_previous_status := v_previous_task.status;
  if coalesce(nullif(
      dashboard_private.ops_task_input_task_v2(p_input) ->> 'status', ''
    ), 'requested') <> 'requested'
    or coalesce(nullif(
      dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest') ->> 'retest_status', ''
    ), 'not_started') <> 'not_started'
  then
    raise exception 'word_retest_retry_type_invalid' using errcode = '22023';
  end if;

  update public.ops_tasks task
  set status = 'done', completed_at = pg_catalog.clock_timestamp()
  where task.id = p_previous_task_id
  returning task.* into v_previous_task;
  update public.ops_word_retests detail
  set retest_status = 'done'
  where detail.task_id = p_previous_task_id;

  v_new_task := dashboard_private.insert_ops_task_from_json_v2(p_input, v_actor);
  if v_new_task.type <> 'word_retest' then
    raise exception 'word_retest_retry_type_invalid' using errcode = '22023';
  end if;
  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest')
    - 'retry_of_task_id' - 'retry_task_id';
  perform dashboard_private.upsert_ops_task_detail_v2(v_new_task.id, 'word_retest', v_detail);
  update public.ops_word_retests detail
  set retry_of_task_id = p_previous_task_id
  where detail.task_id = v_new_task.id
    and detail.retry_of_task_id is null
    and detail.retry_task_id is null;
  if not found then
    raise exception 'word_retest_retry_conflict' using errcode = '40001';
  end if;
  update public.ops_word_retests detail
  set retry_task_id = v_new_task.id
  where detail.task_id = p_previous_task_id
    and detail.retry_task_id is null;
  if not found then
    raise exception 'word_retest_retry_conflict' using errcode = '40001';
  end if;

  v_source := dashboard_private.record_ops_task_notification_source_v2(
    v_previous_task, 'word_retest.completed', p_request_id,
    'status', v_previous_status, 'done',
    pg_catalog.jsonb_build_object('retry_task_id', v_new_task.id)
  );
  v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  v_source := dashboard_private.record_ops_task_notification_source_v2(
    v_new_task, 'word_retest.retry_created', p_request_id,
    'retry_of_task_id', p_previous_task_id::text, v_new_task.id::text,
    pg_catalog.jsonb_build_object('retry_of_task_id', p_previous_task_id)
  );
  v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');

  v_response := pg_catalog.jsonb_build_object(
    'previousTask', pg_catalog.to_jsonb(v_previous_task),
    'task', pg_catalog.to_jsonb(v_new_task),
    'sourceEventIds', v_source_event_ids
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'retry_word_retest_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.report_word_retest_result_v1_impl(
  p_task_id uuid,
  p_result jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'result', p_result
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
    or p_request_id is null
  then
    raise exception 'word_retest_result_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'report_word_retest_result_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;
  select task.* into v_task
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found or v_task.type <> 'word_retest' then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_ops_task_actor_v2(v_task, null);
  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  if v_task.status <> 'in_progress' or v_detail.retest_status <> 'in_progress' then
    raise exception 'word_retest_result_not_allowed' using errcode = '40001';
  end if;

  update public.ops_word_retests detail set
    first_score = case when p_result ? 'first_score' then nullif(p_result ->> 'first_score', '')::numeric else detail.first_score end,
    second_score = case when p_result ? 'second_score' then nullif(p_result ->> 'second_score', '')::numeric else detail.second_score end,
    third_score = case when p_result ? 'third_score' then nullif(p_result ->> 'third_score', '')::numeric else detail.third_score end,
    score_out_of_100 = case when p_result ? 'score_out_of_100' then nullif(p_result ->> 'score_out_of_100', '')::numeric else detail.score_out_of_100 end,
    retest_status = 'done'
  where detail.task_id = p_task_id;
  if not found then raise exception 'word_retest_not_found' using errcode = 'P0002'; end if;
  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id;
  if v_detail.total_question_count is null
    or v_detail.total_question_count <= 0
    or v_detail.cutoff_question_count is null
    or v_detail.cutoff_question_count < 0
    or v_detail.cutoff_question_count > v_detail.total_question_count
    or not exists (
      select 1 from (values
        (v_detail.first_score), (v_detail.second_score), (v_detail.third_score)
      ) score(value)
      where score.value is not null
    )
    or exists (
      select 1 from (values
        (v_detail.first_score), (v_detail.second_score), (v_detail.third_score)
      ) score(value)
      where score.value < 0 or score.value > v_detail.total_question_count
    )
    or (v_detail.score_out_of_100 is not null
      and (v_detail.score_out_of_100 < 0 or v_detail.score_out_of_100 > 100))
  then
    raise exception 'word_retest_result_invalid' using errcode = '22023';
  end if;
  update public.ops_tasks task
  set status = 'review_requested', completed_at = null
  where task.id = p_task_id
  returning task.* into v_task;

  v_source := dashboard_private.record_ops_task_notification_source_v2(
    v_task, 'word_retest.result_reported', p_request_id,
    'result', null, 'reported', pg_catalog.jsonb_build_object(
      'reported_at', pg_catalog.clock_timestamp()
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'report_word_retest_result_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.report_word_retest_absent_v1_impl(
  p_task_id uuid,
  p_source text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'source', p_source
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
  v_source_event jsonb;
  v_response jsonb;
begin
  if p_task_id is null or p_source is null
    or p_source not in ('manual', 'deadline', 'attendance') or p_request_id is null
  then
    raise exception 'word_retest_absent_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'report_word_retest_absent_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;
  select task.* into v_task
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found or v_task.type <> 'word_retest' then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_ops_task_actor_v2(v_task, null);
  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  if p_source = 'deadline' then
    if v_task.status not in ('requested', 'confirmed', 'on_hold')
      or v_detail.retest_status <> 'not_started'
      or v_detail.test_at is null
      or pg_catalog.clock_timestamp() < (
        ((v_detail.test_at at time zone 'Asia/Seoul')::date + 8)::timestamp
        at time zone 'Asia/Seoul'
      )
    then
      raise exception 'word_retest_absent_deadline_not_reached' using errcode = '40001';
    end if;
  elsif v_task.status <> 'in_progress' or v_detail.retest_status <> 'in_progress' then
    raise exception 'word_retest_absent_not_allowed' using errcode = '40001';
  end if;

  update public.ops_word_retests detail
  set retest_status = 'absent', first_score = null, second_score = null,
      third_score = null, score_out_of_100 = null
  where detail.task_id = p_task_id;
  if not found then raise exception 'word_retest_not_found' using errcode = 'P0002'; end if;
  update public.ops_tasks task
  set status = 'review_requested', completed_at = null
  where task.id = p_task_id
  returning task.* into v_task;

  v_source_event := dashboard_private.record_ops_task_notification_source_v2(
    v_task, 'word_retest.absent_reported', p_request_id,
    'absence', null, p_source, pg_catalog.jsonb_build_object(
      'absence_source', p_source,
      'test_at', v_detail.test_at,
      'reported_at', pg_catalog.clock_timestamp()
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source_event ->> 'sourceEventId')
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'report_word_retest_absent_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.request_word_retest_revision_v1_impl(
  p_task_id uuid,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()), 'task_id', p_task_id, 'reason', p_reason
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
  v_source jsonb;
  v_response jsonb;
begin
  if p_task_id is null or nullif(pg_catalog.btrim(p_reason), '') is null or p_request_id is null then
    raise exception 'word_retest_revision_invalid' using errcode = '22023';
  end if;
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'request_word_retest_revision_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;
  select task.* into v_task
  from public.ops_tasks task where task.id = p_task_id
  for update of task;
  if not found or v_task.type <> 'word_retest' then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if v_task.status <> 'review_requested' then
    raise exception 'word_retest_revision_not_allowed' using errcode = '40001';
  end if;
  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;
  if v_detail.retest_status <> 'done' then
    raise exception 'word_retest_revision_not_allowed' using errcode = '40001';
  end if;
  update public.ops_word_retests detail
  set retest_status = 'in_progress'
  where detail.task_id = p_task_id
    and detail.retest_status = 'done';
  if not found then
    raise exception 'word_retest_revision_not_allowed' using errcode = '40001';
  end if;
  update public.ops_tasks task
  set status = 'in_progress', completed_at = null
  where task.id = p_task_id
  returning task.* into v_task;

  v_source := dashboard_private.record_ops_task_notification_source_v2(
    v_task, 'word_retest.revision_requested', p_request_id,
    'revision', 'review_requested', 'in_progress',
    pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason))
  );
  v_response := pg_catalog.jsonb_build_object(
    'task', pg_catalog.to_jsonb(v_task),
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId')
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'request_word_retest_revision_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.create_ops_task_v2(p_input jsonb, p_request_id uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.create_ops_task_v2_impl(p_input, p_request_id); $$;

create or replace function public.update_ops_task_v2(
  p_task_id uuid, p_input jsonb, p_expected_updated_at timestamptz, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.update_ops_task_v2_impl(p_task_id, p_input, p_expected_updated_at, p_request_id); $$;

create or replace function public.transition_ops_task_status_v2(
  p_task_id uuid, p_status text, p_expected_updated_at timestamptz, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.transition_ops_task_status_v2_impl(p_task_id, p_status, p_expected_updated_at, p_request_id); $$;

create or replace function public.add_ops_task_comment_v2(
  p_task_id uuid, p_body text, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.add_ops_task_comment_v2_impl(p_task_id, p_body, p_request_id); $$;

create or replace function public.record_ops_task_activity_event_v1(
  p_task_id uuid,
  p_event_type text,
  p_field_name text,
  p_before_value text,
  p_after_value text,
  p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$
  select dashboard_private.record_ops_task_activity_event_v1_impl(
    p_task_id,
    p_event_type,
    p_field_name,
    p_before_value,
    p_after_value,
    p_request_id
  );
$$;

create or replace function public.cleanup_created_ops_task_v1(
  p_task_id uuid,
  p_expected_created_at timestamptz,
  p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$
  select dashboard_private.cleanup_created_ops_task_v1_impl(
    p_task_id,
    p_expected_created_at,
    p_request_id
  );
$$;

create or replace function public.retry_word_retest_v1(
  p_previous_task_id uuid, p_input jsonb, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.retry_word_retest_v1_impl(p_previous_task_id, p_input, p_request_id); $$;

create or replace function public.report_word_retest_result_v1(
  p_task_id uuid, p_result jsonb, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.report_word_retest_result_v1_impl(p_task_id, p_result, p_request_id); $$;

create or replace function public.report_word_retest_absent_v1(
  p_task_id uuid, p_source text, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.report_word_retest_absent_v1_impl(p_task_id, p_source, p_request_id); $$;

create or replace function public.request_word_retest_revision_v1(
  p_task_id uuid, p_reason text, p_request_id uuid
) returns jsonb language sql security definer set search_path = ''
as $$ select dashboard_private.request_word_retest_revision_v1_impl(p_task_id, p_reason, p_request_id); $$;

update dashboard_private.notification_rules
set enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where scope_key = 'global'
  and workflow_key in ('tasks', 'word_retests')
  and enabled;

do $$
begin
  if exists (
    select 1 from dashboard_private.notification_rules rule
    where rule.scope_key = 'global'
      and rule.workflow_key in ('tasks', 'word_retests')
      and rule.enabled
  ) then
    raise exception 'ops_task_notification_rules_must_remain_disabled' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.ops_task_notification_producers_runtime_version()
returns integer language sql stable set search_path = '' as $$ select 1; $$;

-- 생산자 RPC가 설치된 뒤에는 브라우저가 원장을 직접 바꿀 수 없어야 한다.
-- SECURITY DEFINER 생산자는 소유자 권한으로 계속 쓰고, 인증 사용자는 아래의
-- 고정 목적 RPC만 호출한다.
revoke insert, update, delete on table public.ops_tasks
  from public, anon, authenticated;
revoke insert, update, delete on table public.ops_word_retests
  from public, anon, authenticated;

revoke all on function dashboard_private.ops_task_request_replay_v2(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.finish_ops_task_request_v2(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_ops_task_actor_v2(public.ops_tasks, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.ops_task_management_profile_ids_v2() from public, anon, authenticated, service_role;
revoke all on function dashboard_private.ops_task_input_task_v2(jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.ops_task_input_detail_v2(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.insert_ops_task_from_json_v2(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.upsert_ops_task_detail_v2(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_ops_task_unsent_work_v1(uuid, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks, text, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_ops_task_v2_impl(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.update_ops_task_v2_impl(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.transition_ops_task_status_v2_impl(uuid, text, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.insert_ops_task_activity_event_v1(
  public.ops_tasks, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_ops_task_activity_event_v1_impl(
  uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cleanup_created_ops_task_v1_impl(
  uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.add_ops_task_comment_v2_impl(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.retry_word_retest_v1_impl(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.report_word_retest_result_v1_impl(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.report_word_retest_absent_v1_impl(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.request_word_retest_revision_v1_impl(uuid, text, uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_ops_task_v2(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_ops_task_v2(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.transition_ops_task_status_v2(uuid, text, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_ops_task_activity_event_v1(
  uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_created_ops_task_v1(
  uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.add_ops_task_comment_v2(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.retry_word_retest_v1(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_word_retest_result_v1(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_word_retest_absent_v1(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.request_word_retest_revision_v1(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ops_task_notification_producers_runtime_version() from public, anon, authenticated, service_role;

grant execute on function public.create_ops_task_v2(jsonb, uuid) to authenticated;
grant execute on function public.update_ops_task_v2(uuid, jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.transition_ops_task_status_v2(uuid, text, timestamptz, uuid) to authenticated;
grant execute on function public.record_ops_task_activity_event_v1(
  uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.cleanup_created_ops_task_v1(
  uuid, timestamptz, uuid
) to authenticated;
grant execute on function public.add_ops_task_comment_v2(uuid, text, uuid) to authenticated;
grant execute on function public.retry_word_retest_v1(uuid, jsonb, uuid) to authenticated;
grant execute on function public.report_word_retest_result_v1(uuid, jsonb, uuid) to authenticated;
grant execute on function public.report_word_retest_absent_v1(uuid, text, uuid) to authenticated;
grant execute on function public.request_word_retest_revision_v1(uuid, text, uuid) to authenticated;
grant execute on function public.ops_task_notification_producers_runtime_version() to authenticated, service_role;

commit;
