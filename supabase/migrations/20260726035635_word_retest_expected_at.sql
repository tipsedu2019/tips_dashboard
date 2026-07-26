begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ops_word_retests
  add column if not exists expected_retest_at timestamptz;

create or replace function dashboard_private.upsert_ops_task_detail_v2(
  p_task_id uuid,
  p_type text,
  p_detail jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
  v_general_marker boolean := false;
  v_is_linked_teacher_review boolean := false;
begin
  if p_type = 'word_retest' then
    if p_detail ? 'retry_of_task_id' or p_detail ? 'retry_task_id' then
      raise exception 'word_retest_retry_link_forbidden' using errcode = '22023';
    end if;
    if v_actor is not null
      and v_role = 'teacher'
      and p_detail ? 'expected_retest_at'
    then
      select exists (
        select 1
        from public.ops_tasks task
        join public.ops_word_retests retest on retest.task_id = task.id
        join public.teacher_catalogs teacher on teacher.id = retest.teacher_catalog_id
        where task.id = p_task_id
          and task.status = 'review_requested'
          and teacher.profile_id = v_actor
      ) into v_is_linked_teacher_review;
    end if;
    if v_actor is not null
      and (
        v_role in ('admin', 'staff', 'assistant')
        or v_is_linked_teacher_review
      )
      and p_detail ? 'expected_retest_at'
    then
      insert into dashboard_private.word_retest_expected_update_markers(
        transaction_id, task_id, actor_id, update_scope
      ) values (
        pg_catalog.txid_current(), p_task_id, v_actor, 'detail_upsert'
      )
      on conflict (transaction_id, task_id, actor_id) do update set
        update_scope = excluded.update_scope;
      v_general_marker := true;
    end if;
    insert into public.ops_word_retests(
      task_id, branch, teacher_catalog_id, teacher_name, class_name, student_name,
      test_at, expected_retest_at, textbook_name, unit, request_note,
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
      nullif(p_detail ->> 'expected_retest_at', '')::timestamptz,
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
      expected_retest_at = excluded.expected_retest_at,
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
    if v_general_marker then
      delete from dashboard_private.word_retest_expected_update_markers marker
      where marker.transaction_id = pg_catalog.txid_current()
        and marker.task_id = p_task_id
        and marker.actor_id = v_actor;
    end if;
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

create table if not exists dashboard_private.word_retest_expected_update_markers (
  transaction_id bigint not null,
  task_id uuid not null,
  actor_id uuid not null,
  update_scope text not null check (update_scope in ('expected_only', 'detail_upsert')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (transaction_id, task_id, actor_id)
);

create or replace function dashboard_private.clear_word_retest_expected_at_on_retry_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.retry_of_task_id is null and new.retry_of_task_id is not null then
    new.expected_retest_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_word_retest_expected_at_on_retry_link
  on public.ops_word_retests;
create trigger clear_word_retest_expected_at_on_retry_link
  before update of retry_of_task_id on public.ops_word_retests
  for each row
  execute function dashboard_private.clear_word_retest_expected_at_on_retry_link_v1();

create or replace function dashboard_private.guard_word_retest_expected_only_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
  v_task_id uuid;
  v_status text;
  v_is_linked_teacher boolean := false;
  v_marked boolean := false;
  v_marker_scope text := '';
  v_is_initial_retry_link boolean := false;
begin
  if tg_table_name = 'ops_tasks' then
    v_task_id := old.id;
    v_status := old.status;
  else
    v_task_id := old.task_id;
    select task.status into v_status
    from public.ops_tasks task
    where task.id = old.task_id;
  end if;

  if v_role = 'teacher' and v_actor is not null then
    select exists (
      select 1
      from public.ops_word_retests retest
      join public.teacher_catalogs teacher
        on teacher.id = retest.teacher_catalog_id
      where retest.task_id = v_task_id
        and teacher.profile_id = v_actor
    ) into v_is_linked_teacher;
  end if;

  select coalesce((
    select marker.update_scope
    from dashboard_private.word_retest_expected_update_markers marker
    where marker.transaction_id = pg_catalog.txid_current()
      and marker.task_id = v_task_id
      and marker.actor_id = v_actor
  ), '') into v_marker_scope;
  v_marked := v_marker_scope <> '';

  if v_marked then
    if v_marker_scope = 'detail_upsert' then
      if tg_table_name <> 'ops_word_retests'
        or not (
          v_role in ('admin', 'staff', 'assistant')
          or (
            v_role = 'teacher'
            and v_status = 'review_requested'
            and v_is_linked_teacher
          )
        )
      then
        raise exception 'word_retest_expected_only_required' using errcode = '42501';
      end if;
      return new;
    end if;
    if v_marker_scope <> 'expected_only' then
      raise exception 'word_retest_expected_only_required' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      raise exception 'word_retest_expected_only_required' using errcode = '42501';
    end if;
    if tg_table_name = 'ops_tasks' then
      if (pg_catalog.to_jsonb(new) - 'updated_at')
        is distinct from (pg_catalog.to_jsonb(old) - 'updated_at')
      then
        raise exception 'word_retest_expected_only_required' using errcode = '42501';
      end if;
      new.updated_at := greatest(
        pg_catalog.clock_timestamp(),
        old.updated_at + interval '1 microsecond'
      );
    else
      if (pg_catalog.to_jsonb(new) - 'expected_retest_at' - 'updated_at')
        is distinct from
        (pg_catalog.to_jsonb(old) - 'expected_retest_at' - 'updated_at')
      then
        raise exception 'word_retest_expected_only_required' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'ops_word_retests' then
    v_is_initial_retry_link :=
      old.retry_of_task_id is null
      and new.retry_of_task_id is not null
      and (pg_catalog.to_jsonb(new)
        - 'retry_of_task_id' - 'expected_retest_at' - 'updated_at')
        is not distinct from
        (pg_catalog.to_jsonb(old)
        - 'retry_of_task_id' - 'expected_retest_at' - 'updated_at');

    if old.expected_retest_at is distinct from new.expected_retest_at
      and not v_is_initial_retry_link
    then
      raise exception 'word_retest_expected_only_required' using errcode = '42501';
    end if;
  end if;

  if not v_is_linked_teacher
    or v_status not in ('requested', 'confirmed', 'in_progress', 'on_hold')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'word_retest_expected_only_required' using errcode = '42501';
  end if;

  if not v_is_initial_retry_link then
    raise exception 'word_retest_expected_only_required' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists word_retest_expected_only_parent_update_guard
  on public.ops_tasks;
create trigger word_retest_expected_only_parent_update_guard
  before update on public.ops_tasks
  for each row
  execute function dashboard_private.guard_word_retest_expected_only_v1();

drop trigger if exists word_retest_expected_only_parent_delete_guard
  on public.ops_tasks;
create trigger word_retest_expected_only_parent_delete_guard
  before delete on public.ops_tasks
  for each row
  execute function dashboard_private.guard_word_retest_expected_only_v1();

drop trigger if exists word_retest_expected_only_detail_update_guard
  on public.ops_word_retests;
create trigger word_retest_expected_only_detail_update_guard
  before update on public.ops_word_retests
  for each row
  execute function dashboard_private.guard_word_retest_expected_only_v1();

create or replace function dashboard_private.update_word_retest_expected_at_v1_impl(
  p_task_id uuid,
  p_expected_retest_at timestamptz,
  p_expected_updated_at timestamptz,
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
  v_fingerprint text;
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_word_retests%rowtype;
  v_response jsonb;
begin
  if p_task_id is null
    or p_expected_updated_at is null
    or p_request_id is null
  then
    raise exception 'word_retest_expected_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'task_id', p_task_id,
    'expected_retest_at', p_expected_retest_at,
    'expected_updated_at', p_expected_updated_at
  )::text);
  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'update_word_retest_expected_at_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;

  select detail.* into v_detail
  from public.ops_word_retests detail
  where detail.task_id = p_task_id
  for update of detail;
  if not found or v_task.type <> 'word_retest' then
    raise exception 'word_retest_not_found' using errcode = 'P0002';
  end if;

  if v_task.updated_at is distinct from p_expected_updated_at then
    raise exception 'word_retest_expected_stale_write' using errcode = '40001';
  end if;
  if v_task.status in ('done', 'canceled') then
    raise exception 'word_retest_expected_closed' using errcode = '40001';
  end if;
  if v_actor is null or not exists (
    select 1 from public.profiles profile where profile.id = v_actor
  ) then
    raise exception 'word_retest_expected_access_denied' using errcode = '42501';
  end if;

  if not (
    v_role in ('admin', 'staff')
    or (
      v_role = 'assistant'
      and v_task.status in ('requested', 'confirmed', 'in_progress', 'on_hold')
    )
    or (
      v_role = 'teacher'
      and exists (
        select 1
        from public.teacher_catalogs teacher
        where teacher.id = v_detail.teacher_catalog_id
          and teacher.profile_id = v_actor
      )
    )
  ) then
    raise exception 'word_retest_expected_access_denied' using errcode = '42501';
  end if;

  if v_detail.expected_retest_at is distinct from p_expected_retest_at then
    insert into dashboard_private.word_retest_expected_update_markers(
      transaction_id, task_id, actor_id, update_scope
    ) values (
      pg_catalog.txid_current(), v_task.id, v_actor, 'expected_only'
    )
    on conflict (transaction_id, task_id, actor_id) do update set
      update_scope = excluded.update_scope;

    update public.ops_word_retests detail
    set expected_retest_at = p_expected_retest_at
    where detail.task_id = v_task.id
    returning detail.* into v_detail;

    update public.ops_tasks task
    set updated_at = pg_catalog.clock_timestamp()
    where task.id = v_task.id
    returning task.* into v_task;

    delete from dashboard_private.word_retest_expected_update_markers marker
    where marker.transaction_id = pg_catalog.txid_current()
      and marker.task_id = v_task.id
      and marker.actor_id = v_actor;
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'expectedRetestAt', v_detail.expected_retest_at,
    'updatedAt', v_task.updated_at
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id,
    'update_word_retest_expected_at_v1',
    v_fingerprint,
    v_response
  );
end;
$$;

create or replace function public.update_word_retest_expected_at_v1(
  p_task_id uuid,
  p_expected_retest_at timestamptz,
  p_expected_updated_at timestamptz,
  p_request_id uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.update_word_retest_expected_at_v1_impl(
    p_task_id,
    p_expected_retest_at,
    p_expected_updated_at,
    p_request_id
  );
$$;

revoke all on table dashboard_private.word_retest_expected_update_markers
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.clear_word_retest_expected_at_on_retry_link_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.guard_word_retest_expected_only_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.update_word_retest_expected_at_v1_impl(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.update_word_retest_expected_at_v1(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.update_word_retest_expected_at_v1(
  uuid, timestamptz, timestamptz, uuid
) to authenticated;

commit;
