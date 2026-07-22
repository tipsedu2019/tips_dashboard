begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
      'dashboard_private.report_word_retest_absent_v1_impl(uuid,text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.report_word_retest_absent_v1(uuid,text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.ops_task_request_replay_v2(uuid,text,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.finish_ops_task_request_v2(uuid,text,text,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.assert_ops_task_actor_v2(public.ops_tasks,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks,text,uuid,text,text,text,jsonb,uuid)'
    ) is null
  then
    raise exception 'word_retest_absence_storm_guard_prerequisite_missing'
      using errcode = '55000';
  end if;
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
  if v_replay is not null then
    if v_replay ->> 'skippedReason' = 'retry_child_deadline' then
      -- The empty array deliberately trips the legacy client's response validator.
      -- That keeps its persisted request id armed instead of issuing a fresh UUID.
      return pg_catalog.jsonb_build_array();
    end if;
    return v_replay;
  end if;

  if p_source = 'deadline' then
    select task.* into v_task
    from public.ops_tasks task
    where task.id = p_task_id;
    if not found or v_task.type <> 'word_retest' then
      raise exception 'word_retest_not_found' using errcode = 'P0002';
    end if;
    perform dashboard_private.assert_ops_task_actor_v2(v_task, null);

    select detail.* into v_detail
    from public.ops_word_retests detail
    where detail.task_id = p_task_id;
    if not found then
      raise exception 'word_retest_not_found' using errcode = 'P0002';
    end if;

    if v_detail.retry_of_task_id is not null then
      v_response := pg_catalog.jsonb_build_object(
        'task', pg_catalog.to_jsonb(v_task),
        'sourceEventIds', pg_catalog.jsonb_build_array(),
        'skippedReason', 'retry_child_deadline'
      );
      perform dashboard_private.finish_ops_task_request_v2(
        p_request_id, 'report_word_retest_absent_v1', v_fingerprint, v_response
      );
      return pg_catalog.jsonb_build_array();
    end if;
  end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
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
    if v_detail.retry_of_task_id is not null then
      v_response := pg_catalog.jsonb_build_object(
        'task', pg_catalog.to_jsonb(v_task),
        'sourceEventIds', pg_catalog.jsonb_build_array(),
        'skippedReason', 'retry_child_deadline'
      );
      perform dashboard_private.finish_ops_task_request_v2(
        p_request_id, 'report_word_retest_absent_v1', v_fingerprint, v_response
      );
      return pg_catalog.jsonb_build_array();
    end if;
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
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;

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

alter function dashboard_private.report_word_retest_absent_v1_impl(uuid, text, uuid)
  owner to postgres;

revoke all on function dashboard_private.report_word_retest_absent_v1_impl(uuid, text, uuid)
  from public, anon, authenticated, service_role;

commit;
