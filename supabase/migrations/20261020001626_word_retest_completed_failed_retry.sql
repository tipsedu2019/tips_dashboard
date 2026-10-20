-- Allow completed failed word retests to use the existing retry workflow.
-- Preserve the public wrapper and the existing private function owner and ACL.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $$
begin
  if pg_catalog.to_regclass('public.ops_tasks') is null
    or pg_catalog.to_regclass('public.ops_word_retests') is null
  then
    raise exception 'word_retest_completed_retry_prerequisite_missing' using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure('dashboard_private.retry_word_retest_v1_impl(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('public.retry_word_retest_v1(uuid,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('auth.uid()') is null
    or pg_catalog.to_regprocedure('dashboard_private.ops_task_request_replay_v2(uuid,text,text)') is null
    or pg_catalog.to_regprocedure('dashboard_private.assert_ops_task_actor_v2(public.ops_tasks,uuid)') is null
    or pg_catalog.to_regprocedure('dashboard_private.ops_task_input_task_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('dashboard_private.ops_task_input_detail_v2(jsonb,text)') is null
    or pg_catalog.to_regprocedure('dashboard_private.insert_ops_task_from_json_v2(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('dashboard_private.upsert_ops_task_detail_v2(uuid,text,jsonb)') is null
    or pg_catalog.to_regprocedure('dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks,text,uuid,text,text,text,jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('dashboard_private.finish_ops_task_request_v2(uuid,text,text,jsonb)') is null
  then
    raise exception 'word_retest_completed_retry_prerequisite_missing' using errcode = '55000';
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
  v_previous_result_summary text;
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
  if v_previous_detail.retry_task_id is not null
    or not (
      v_previous_task.status in ('review_requested', 'done')
      and (
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
    )
  then
    raise exception 'word_retest_retry_conflict' using errcode = '23514';
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

  if v_previous_detail.retest_status = 'absent' then
    v_previous_result_summary := 'absent';
  elsif exists (
    select 1 from (values
      (v_previous_detail.first_score),
      (v_previous_detail.second_score),
      (v_previous_detail.third_score)
    ) score(value)
    where score.value >= v_previous_detail.cutoff_question_count
  ) then
    v_previous_result_summary := 'passed';
  else
    v_previous_result_summary := 'failed';
  end if;

  v_detail := dashboard_private.ops_task_input_detail_v2(p_input, 'word_retest')
    - 'retry_of_task_id' - 'retry_task_id';
  v_detail := v_detail || pg_catalog.jsonb_build_object(
    'test_at', coalesce(
      nullif(v_detail ->> 'test_at', ''),
      v_previous_detail.test_at::text,
      v_previous_task.due_at::text,
      v_previous_task.start_at::text
    )
  );
  v_effective_input := p_input || pg_catalog.jsonb_build_object('word_retest', v_detail);

  update public.ops_tasks task
  set status = 'done', completed_at = coalesce(task.completed_at, pg_catalog.clock_timestamp())
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
    raise exception 'word_retest_retry_conflict' using errcode = '23514';
  end if;
  update public.ops_word_retests detail
  set retry_task_id = v_new_task.id
  where detail.task_id = p_previous_task_id
    and detail.retry_task_id is null;
  if not found then
    raise exception 'word_retest_retry_conflict' using errcode = '23514';
  end if;

  if v_previous_status <> 'done' then
    v_source := dashboard_private.record_ops_task_notification_source_v2(
      v_previous_task, 'word_retest.completed', p_request_id,
      'status', v_previous_status, 'done',
      pg_catalog.jsonb_build_object('retry_task_id', v_new_task.id)
    );
    v_source_event_ids := v_source_event_ids || pg_catalog.jsonb_build_array(v_source ->> 'sourceEventId');
  end if;
  v_source := dashboard_private.record_ops_task_notification_source_v2(
    v_new_task, 'word_retest.retry_created', p_request_id,
    'retry_of_task_id', p_previous_task_id::text, v_new_task.id::text,
    pg_catalog.jsonb_build_object(
      'retry_of_task_id', p_previous_task_id,
      'previous_result_summary', v_previous_result_summary,
      'previous_total_question_count', v_previous_detail.total_question_count,
      'previous_cutoff_question_count', v_previous_detail.cutoff_question_count,
      'previous_first_score', v_previous_detail.first_score,
      'previous_second_score', v_previous_detail.second_score,
      'previous_third_score', v_previous_detail.third_score
    )
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

commit;
