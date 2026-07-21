begin;
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('dashboard_private.retry_word_retest_v1_impl(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('dashboard_private.report_word_retest_absent_v1_impl(uuid,text,uuid)') is null
    or pg_catalog.to_regprocedure('public.retry_word_retest_v1(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('public.report_word_retest_absent_v1(uuid,text,uuid)') is null
  then
    raise exception 'word_retest_reretry_prerequisite_missing' using errcode = '55000';
  end if;
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
  v_effective_input jsonb;
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
    or v_previous_detail.retry_task_id is not null
    or not (
      v_previous_detail.retest_status = 'absent'
      or (
        v_previous_detail.retest_status = 'done'
        and v_previous_detail.cutoff_question_count is not null
        and exists (
          select 1 from (values
            (v_previous_detail.first_score),
            (v_previous_detail.second_score),
            (v_previous_detail.third_score)
          ) score(value) where score.value is not null
        )
        and not exists (
          select 1 from (values
            (v_previous_detail.first_score),
            (v_previous_detail.second_score),
            (v_previous_detail.third_score)
          ) score(value)
          where score.value >= v_previous_detail.cutoff_question_count
        )
      )
    )
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

  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest')
    - 'retry_of_task_id' - 'retry_task_id';
  v_detail := v_detail || pg_catalog.jsonb_build_object(
    'test_at', coalesce(nullif(v_detail ->> 'test_at', ''), v_previous_detail.test_at::text)
  );
  v_effective_input := p_input || pg_catalog.jsonb_build_object('word_retest', v_detail);

  update public.ops_tasks task
  set status = 'done', completed_at = pg_catalog.clock_timestamp()
  where task.id = p_previous_task_id
  returning task.* into v_previous_task;

  v_new_task := dashboard_private.insert_ops_task_from_json_v2(v_effective_input, v_actor);
  if v_new_task.type <> 'word_retest' then
    raise exception 'word_retest_retry_type_invalid' using errcode = '22023';
  end if;
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
    if v_detail.retry_of_task_id is not null then
      raise exception 'word_retest_absent_deadline_not_allowed'
        using errcode = '40001';
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

alter function dashboard_private.retry_word_retest_v1_impl(uuid, jsonb, uuid) owner to postgres;
alter function dashboard_private.report_word_retest_absent_v1_impl(uuid, text, uuid) owner to postgres;

revoke all on function dashboard_private.retry_word_retest_v1_impl(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.report_word_retest_absent_v1_impl(uuid, text, uuid)
  from public, anon, authenticated, service_role;

commit;
