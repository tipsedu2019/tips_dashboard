begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.record_ops_task_notification_source_v2(public.ops_tasks,text,uuid,text,text,text,jsonb,uuid)'
  ) is null
    or pg_catalog.to_regclass('public.ops_task_comments') is null
    or pg_catalog.to_regclass('public.ops_task_attachments') is null
    or pg_catalog.to_regclass('public.profiles') is null
  then
    raise exception 'notification_task_content_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

-- Display facts are captured here, inside the same domain transaction that writes
-- ops_task_events and the canonical notification event. Renderers consume only this
-- immutable payload and never look up mutable profile, comment, or attachment rows.
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
  v_actor_name text;
  v_current_assignee_name text;
  v_before_assignee_name text;
  v_after_assignee_name text;
  v_before_due_at text := nullif(p_extra_payload #>> '{before_schedule,due_at}', '');
  v_after_due_at text := nullif(p_extra_payload #>> '{after_schedule,due_at}', '');
  v_before_status text := case when p_field_name = 'status' then p_before_value end;
  v_after_status text := case when p_field_name = 'status' then p_after_value end;
  v_comment_author_name text;
  v_comment_body text;
  v_attachment_count integer;
  v_attachment_types jsonb;
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
    or (p_event_key = 'task.comment_added' and p_comment_id is null)
    or (p_event_key <> 'task.comment_added' and p_comment_id is not null)
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

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_actor_name
  from public.profiles profile
  where profile.id = v_actor;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_current_assignee_name
  from public.profiles profile
  where profile.id in (p_task.assignee_id, p_task.secondary_assignee_id)
  order by case when profile.id = p_task.assignee_id then 0 else 1 end
  limit 1;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_before_assignee_name
  from public.profiles profile
  where profile.id::text in (
    coalesce(p_extra_payload #>> '{before_assignee,primary_profile_id}', ''),
    coalesce(p_extra_payload #>> '{before_assignee,secondary_profile_id}', '')
  )
  order by case
    when profile.id::text = p_extra_payload #>> '{before_assignee,primary_profile_id}' then 0
    else 1
  end
  limit 1;

  select nullif(pg_catalog.btrim(profile.name), '')
  into v_after_assignee_name
  from public.profiles profile
  where profile.id::text in (
    coalesce(p_extra_payload #>> '{after_assignee,primary_profile_id}', ''),
    coalesce(p_extra_payload #>> '{after_assignee,secondary_profile_id}', '')
  )
  order by case
    when profile.id::text = p_extra_payload #>> '{after_assignee,primary_profile_id}' then 0
    else 1
  end
  limit 1;

  if p_comment_id is not null then
    select
      nullif(pg_catalog.btrim(profile.name), ''),
      comment_row.body
    into v_comment_author_name, v_comment_body
    from public.ops_task_comments comment_row
    left join public.profiles profile on profile.id = comment_row.author_id
    where comment_row.id = p_comment_id
      and comment_row.task_id = p_task.id;
    if not found then
      raise exception 'ops_task_comment_not_found' using errcode = 'P0002';
    end if;
  end if;

  select pg_catalog.count(*)::integer
  into v_attachment_count
  from public.ops_task_attachments attachment
  where attachment.task_id = p_task.id;

  select coalesce(pg_catalog.jsonb_agg(kind_row.kind order by kind_row.kind), '[]'::jsonb)
  into v_attachment_types
  from (
    select distinct nullif(pg_catalog.btrim(attachment.file_kind), '') as kind
    from public.ops_task_attachments attachment
    where attachment.task_id = p_task.id
  ) kind_row
  where kind_row.kind is not null;

  -- Preserve the old sparse payload for existing consumers, then append the
  -- content-contract keys without stripping explicit null states.
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
  )) || pg_catalog.jsonb_build_object(
    'task_title', p_task.title,
    'current_assignee_name', v_current_assignee_name,
    'current_assignee_team', p_task.assignee_team,
    'before_assignee_name', v_before_assignee_name,
    'after_assignee_name', v_after_assignee_name,
    'before_due_at', v_before_due_at,
    'after_due_at', v_after_due_at,
    'before_status', v_before_status,
    'after_status', v_after_status,
    'actor_name', v_actor_name,
    'comment_author_name', v_comment_author_name,
    'comment_body', v_comment_body,
    'attachment_count', v_attachment_count,
    'attachment_types', v_attachment_types
  );

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

revoke all on function dashboard_private.record_ops_task_notification_source_v2(
  public.ops_tasks, text, uuid, text, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;

alter function dashboard_private.record_ops_task_notification_source_v2(
  public.ops_tasks, text, uuid, text, text, text, jsonb, uuid
) owner to postgres;

commit;
