-- Numbered task reads: authorized scalar keys, one count/page snapshot, selected-parent DTOs.
-- Existing cursor/stats APIs and completion snapshots are deliberately unchanged.

-- One requested header/filter scalar, not an eager full display projection.
create or replace function dashboard_private.ops_withdrawal_numbered_scalar_v1(
  p_task public.ops_tasks, p_detail public.ops_withdrawal_details, p_column text
) returns text language sql stable security invoker set search_path = '' as $function$
  select case p_column
    when 'status' then dashboard_private.ops_task_page_status_label_v1(p_task.status)
    when 'subject' then dashboard_private.ops_task_page_text_v1(p_task.subject, '-')
    when 'teacher' then dashboard_private.ops_task_page_text_v1(p_detail.teacher_name, '미지정')
    when 'className' then dashboard_private.ops_task_page_text_v1(p_task.class_name, '-')
    when 'student' then dashboard_private.ops_task_page_text_v1(p_task.student_name, '-')
    when 'withdrawalDate' then coalesce(pg_catalog.to_char(p_detail.withdrawal_date, 'YYYY-MM-DD'), '-')
    when 'withdrawalSession' then dashboard_private.ops_task_page_text_v1(p_detail.withdrawal_session, '-')
    when 'completedLessonHours' then dashboard_private.ops_task_page_decimal_v1(p_detail.completed_lesson_hours, '-')
    when 'fourWeekLessonHours' then dashboard_private.ops_task_page_decimal_v1(p_detail.four_week_lesson_hours, '-')
    when 'progress' then case when p_detail.four_week_lesson_hours > 0 then least(100, pg_catalog.round(100 * p_detail.completed_lesson_hours / p_detail.four_week_lesson_hours))::text || '%' else '-' end
    when 'customerReason' then dashboard_private.ops_task_page_text_v1(p_detail.customer_reason, '-')
    when 'teacherOpinion' then dashboard_private.ops_task_page_text_v1(p_detail.teacher_opinion, '-')
    when 'undistributedTextbooks' then dashboard_private.ops_task_page_text_v1(p_detail.undistributed_textbooks, '-')
    when 'operationsChecklist' then ((p_detail.makeedu_withdrawal_done::int + p_detail.fee_processed::int + p_detail.textbook_fee_processed::int)::text || '/3 · ' ||
            case when p_detail.makeedu_withdrawal_done and p_detail.fee_processed and p_detail.textbook_fee_processed then '처리 확인 완료'
            else pg_catalog.concat_ws(', ',
              case when not p_detail.makeedu_withdrawal_done then '메이크에듀 퇴원처리' end,
              case when not p_detail.fee_processed then '수업료 처리' end,
              case when not p_detail.textbook_fee_processed then '교재비 처리' end
            ) end)
    else '' end
$function$;

-- One requested header/filter scalar, not an eager full display projection.
create or replace function dashboard_private.ops_transfer_numbered_scalar_v1(
  p_task public.ops_tasks, p_detail public.ops_transfer_details, p_column text
) returns text language sql stable security invoker set search_path = '' as $function$
  select case p_column
    when 'status' then dashboard_private.ops_task_page_status_label_v1(p_task.status)
    when 'subject' then dashboard_private.ops_task_page_text_v1(p_task.subject, '-')
    when 'fromTeacher' then dashboard_private.ops_task_page_text_v1(p_detail.from_teacher_name, '미지정')
    when 'fromClassName' then dashboard_private.ops_task_page_text_v1(p_detail.from_class_name, '-')
    when 'student' then dashboard_private.ops_task_page_text_v1(p_task.student_name, '-')
    when 'transferReason' then dashboard_private.ops_task_page_text_v1(p_detail.transfer_reason, '-')
    when 'fromUndistributedTextbooks' then dashboard_private.ops_task_page_text_v1(p_detail.from_undistributed_textbooks, '-')
    when 'fromClassEndDate' then coalesce(pg_catalog.to_char(p_detail.from_class_end_date, 'YYYY-MM-DD'), '-')
    when 'fromClassEndSession' then dashboard_private.ops_task_page_text_v1(p_detail.from_class_end_session, '-')
    when 'toTeacher' then dashboard_private.ops_task_page_text_v1(p_detail.to_teacher_name, '미지정')
    when 'toClassName' then dashboard_private.ops_task_page_text_v1(coalesce(p_detail.to_class_name, p_task.class_name), '-')
    when 'toClassStartDate' then coalesce(pg_catalog.to_char(p_detail.to_class_start_date, 'YYYY-MM-DD'), '-')
    when 'toClassStartSession' then dashboard_private.ops_task_page_text_v1(p_detail.to_class_start_session, '-')
    when 'toUndistributedTextbooks' then dashboard_private.ops_task_page_text_v1(p_detail.to_undistributed_textbooks, '-')
    when 'operationsChecklist' then ((p_detail.makeedu_transfer_done::int + p_detail.fee_processed::int + p_detail.textbook_fee_processed::int)::text || '/3 · ' ||
            case when p_detail.makeedu_transfer_done and p_detail.fee_processed and p_detail.textbook_fee_processed then '처리 확인 완료'
            else pg_catalog.concat_ws(', ',
              case when not p_detail.makeedu_transfer_done then '메이크에듀 전반처리' end,
              case when not p_detail.fee_processed then '수업료 처리' end,
              case when not p_detail.textbook_fee_processed then '교재비 처리' end
            ) end)
    else '' end
$function$;

-- One requested header/filter scalar, not an eager full display projection.
create or replace function dashboard_private.ops_word_retest_numbered_scalar_v1(
  p_task public.ops_tasks, p_detail public.ops_word_retests, p_column text, p_assignee_label text, p_requester_label text
) returns text language sql stable security invoker set search_path = '' as $function$
  select case p_column
    when 'status' then case
          when p_task.status in ('review_requested','done') and score_source.status_value = 'absent' then '미응시'
          when p_task.status in ('review_requested','done') and p_detail.cutoff_question_count is not null and exists (select 1 from pg_catalog.unnest(score_source.scores) score where score >= p_detail.cutoff_question_count) then '완료: 합격'
          when p_task.status in ('review_requested','done') and p_detail.cutoff_question_count is not null and pg_catalog.cardinality(score_source.scores) > 0 then '미완료: 불합격'
          when p_task.status in ('review_requested','done') and score_source.status_value in ('done','in_progress') then '완료'
          when score_source.status_value = 'in_progress' then '진행 중'
          when score_source.status_value = 'absent' then '미응시'
          when score_source.status_value = 'done' then '완료'
          else '시작 전'
        end
    when 'testAt' then coalesce(pg_catalog.to_char(p_detail.test_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), '')
    when 'expectedRetestAt' then coalesce(pg_catalog.to_char(p_detail.expected_retest_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'), '')
    when 'teacher' then dashboard_private.ops_task_page_text_v1(coalesce(p_detail.teacher_name, p_assignee_label, p_requester_label), '미지정')
    when 'class' then dashboard_private.ops_task_page_text_v1(coalesce(p_task.class_name, p_detail.class_name), '미지정')
    when 'student' then dashboard_private.ops_task_page_text_v1(coalesce(p_task.student_name, p_detail.student_name), '미지정')
    when 'textbook' then dashboard_private.ops_task_page_text_v1(coalesce(p_task.textbook_title, p_detail.textbook_name), '미지정')
    when 'unit' then dashboard_private.ops_task_page_text_v1(p_detail.unit, '미지정')
    when 'note' then dashboard_private.ops_task_page_text_v1(coalesce(p_detail.request_note, p_task.memo), '')
    when 'total' then dashboard_private.ops_task_page_decimal_v1(p_detail.total_question_count, '')
    when 'cutoff' then dashboard_private.ops_task_page_decimal_v1(p_detail.cutoff_question_count, '')
    when 'score' then dashboard_private.ops_task_page_decimal_v1((select pg_catalog.max(score) from pg_catalog.unnest(score_source.scores) score), '')
    when 'result' then case
          when score_source.status_value = 'absent' then '미응시'
          when p_detail.cutoff_question_count is null or pg_catalog.cardinality(score_source.scores) = 0 then '미정'
          when exists (select 1 from pg_catalog.unnest(score_source.scores) score where score >= p_detail.cutoff_question_count) then '통과'
          else '재시험'
        end
    else '' end
  from (select coalesce(nullif(pg_catalog.btrim(p_detail.retest_status), ''), 'not_started') as status_value, array_remove(array[p_detail.first_score,p_detail.second_score,p_detail.third_score],null) as scores) score_source
$function$;

create or replace function dashboard_private.ops_task_numbered_keys_v1(
  p_type text,
  p_filters jsonb
)
returns table(
  id uuid,
  matching_track_id uuid,
  task_status text,
  priority_rank integer,
  workflow_status_rank integer,
  date_bucket integer,
  primary_date timestamptz,
  completed_sort_at timestamptz,
  recency_at timestamptz,
  effective_test_at timestamptz,
  effective_created_at timestamptz,
  registration_representative_priority integer,
  registration_representative_at timestamptz,
  display_text text
)
language sql
stable
security invoker
set search_path = ''
set timezone = 'Asia/Seoul'
as $function$
  with base as (
    select
      task.*, task as task_row,
      coalesce(nullif(pg_catalog.btrim(requester.name), ''), nullif(pg_catalog.btrim(requester.email), ''), '') as requester_label,
      coalesce(nullif(pg_catalog.btrim(assignee.name), ''), nullif(pg_catalog.btrim(assignee.email), ''), '') as assignee_label,
      case task.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as priority_rank,
      case task.status
        when 'requested' then 0 when 'confirmed' then 1 when 'in_progress' then 2
        when 'review_requested' then 3 when 'done' then 4 when 'on_hold' then 5 else 6
      end as workflow_status_rank,
      coalesce(task.due_at, task.start_at) as primary_date,
      case
        when coalesce(task.due_at, task.start_at) is null then 3
        when coalesce(task.due_at, task.start_at) < current_date then 0
        when coalesce(task.due_at, task.start_at) < current_date + interval '1 day' then 1
        else 2
      end as date_bucket
    from public.ops_tasks task
    left join public.profiles requester on p_type = 'word_retest' and p_filters ->> 'tableSortColumn' = 'teacher' and requester.id = task.requested_by
    left join public.profiles assignee on p_type = 'word_retest' and p_filters ->> 'tableSortColumn' = 'teacher' and assignee.id = task.assignee_id
    where case when p_type = 'general' then task.type in ('general','textbook') else task.type = p_type end
      and (
        pg_catalog.jsonb_array_length(p_filters -> 'statuses') = 0
        or task.status in (select item #>> '{}' from pg_catalog.jsonb_array_elements(p_filters -> 'statuses') item)
      )
      and (
        nullif(pg_catalog.btrim(p_filters ->> 'search'), '') is null
        or p_type = 'registration'
        or (p_type in ('withdrawal','transfer') and (p_filters -> 'filterColumn') <> 'null'::jsonb)
        or pg_catalog.concat_ws(' ', task.title, task.student_name, task.class_name, task.textbook_title, task.subject, task.campus)
          ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%'
      )

  ), common as (select * from base), shaped as (    select
      common.id,
      null::uuid as matching_track_id,
      common.status as task_status,
      common.priority_rank,
      common.workflow_status_rank,
      common.date_bucket,
      common.primary_date,
      coalesce(common.completed_at, common.updated_at, common.created_at) as completed_sort_at,
      coalesce(common.created_at, common.updated_at) as recency_at,
      null::timestamptz as effective_test_at,
      common.created_at as effective_created_at,
      null::integer as registration_representative_priority,
      null::timestamptz as registration_representative_at,
      ''::text as display_text
    from common
    where p_type = 'general'
      and (
        nullif(p_filters ->> 'requestedById','') is null
        or (p_filters ->> 'requestedById' = '__unassigned__' and common.requested_by is null)
        or common.requested_by::text = p_filters ->> 'requestedById'
      )
      and (
        nullif(p_filters ->> 'requestedTeam','') is null
        or (p_filters ->> 'requestedTeam' = '__unassigned__' and nullif(pg_catalog.btrim(common.requested_team), '') is null)
        or common.requested_team = p_filters ->> 'requestedTeam'
      )
      and (
        nullif(p_filters ->> 'assigneeId','') is null
        or (p_filters ->> 'assigneeId' = '__unassigned__' and common.assignee_id is null and common.secondary_assignee_id is null)
        or common.assignee_id::text = p_filters ->> 'assigneeId'
        or common.secondary_assignee_id::text = p_filters ->> 'assigneeId'
      )
      and (
        nullif(p_filters ->> 'assigneeTeam','') is null
        or (p_filters ->> 'assigneeTeam' = '__unassigned__' and nullif(pg_catalog.btrim(common.assignee_team), '') is null)
        or common.assignee_team = p_filters ->> 'assigneeTeam'
      )
      and (
        (p_filters ->> 'queue' = 'completed' and common.status in ('done','canceled'))
        or (p_filters ->> 'queue' = 'inbox' and common.status not in ('done','canceled') and (
          (common.status = 'review_requested' and common.requested_by = (select auth.uid()))
          or (common.status <> 'review_requested' and ((common.assignee_id = (select auth.uid())) or (common.secondary_assignee_id = (select auth.uid()))))
        ))
        or (p_filters ->> 'queue' = 'sent' and common.status not in ('done','canceled') and (
          (common.status = 'review_requested' and ((common.assignee_id = (select auth.uid())) or (common.secondary_assignee_id = (select auth.uid()))))
          or (common.status <> 'review_requested' and common.requested_by = (select auth.uid()))
        ))
      )
      and case p_filters ->> 'focus'
        when 'today' then common.primary_date >= current_date and common.primary_date < current_date + interval '1 day'
        when 'overdue' then common.primary_date < current_date and common.status not in ('done','canceled')
        when 'mine' then common.assignee_id = (select auth.uid()) or common.secondary_assignee_id = (select auth.uid())
        when 'unassigned' then common.assignee_id is null or common.primary_date is null
        when 'confirmation' then common.status = 'review_requested'
        else true
      end

    union all

    select
      common.id,
      matching_track.matching_track_id,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      matching_track.registration_representative_priority,
      matching_track.registration_representative_at,
      ''::text
    from common
    left join public.ops_registration_details detail on detail.task_id = common.id
    join lateral (
      select
        summary.id as matching_track_id,
        case
          when p_filters ->> 'view' = 'consultation_requested'
            and summary.pipeline_status = 'consultation_waiting' then 0
          when p_filters ->> 'view' = 'consultation_requested' then 1
          else 0
        end as registration_representative_priority,
        case
          when p_filters ->> 'view' = 'consultation_requested'
            and summary.pipeline_status = 'consultation_waiting' then summary.phone_ready_at
          else null
        end as registration_representative_at
      from public.ops_registration_subject_track_summaries summary
      left join public.profiles matching_director on matching_director.id = summary.director_profile_id
      where summary.task_id = common.id
        and case p_filters ->> 'view'
          when 'inquiry' then summary.workflow_status = 'inquiry'
          when 'level_test' then summary.workflow_status = 'level_test_requested'
          when 'consultation_requested' then summary.workflow_status = 'consultation_requested'
          when 'consultation_completed' then summary.workflow_status = 'consultation_completed'
          when 'waiting' then summary.workflow_status in ('waiting_current_class','waiting_new_class','waiting_next_opening')
          when 'observation' then summary.workflow_status in ('observation_requested','observation_feedback_pending','observation_completed')
          when 'enrollment' then summary.workflow_status = 'enrollment_requested'
          when 'payment' then summary.workflow_status = 'payment_in_progress'
          when 'completed' then summary.workflow_status in ('registered','not_registered','inquiry_only')
          else false
        end
        and (
          p_filters ->> 'view' not in ('consultation_requested','consultation_completed')
          or nullif(p_filters ->> 'consultationOwnerId','') is null
          or summary.director_profile_id::text = p_filters ->> 'consultationOwnerId'
        )
        and (
          nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g'), '') is null
          or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.concat_ws(' ',
            common.student_name,
            common.title,
            detail.parent_phone,
            detail.student_phone,
            detail.school_grade,
            detail.school_name,
            detail.request_note,
            summary.subject,
            matching_director.name,
            summary.visit_place
          )), '[[:space:]-]+', '', 'g') like '%' ||
            pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          or exists (
            select 1
            from public.ops_registration_subject_track_summaries search_track
            where search_track.task_id = common.id
              and case p_filters ->> 'view'
                when 'inquiry' then search_track.workflow_status = 'inquiry'
                when 'level_test' then search_track.workflow_status = 'level_test_requested'
                when 'consultation_requested' then search_track.workflow_status = 'consultation_requested'
                when 'consultation_completed' then search_track.workflow_status = 'consultation_completed'
                when 'waiting' then search_track.workflow_status in ('waiting_current_class','waiting_new_class','waiting_next_opening')
                when 'observation' then search_track.workflow_status in ('observation_requested','observation_feedback_pending','observation_completed')
                when 'enrollment' then search_track.workflow_status = 'enrollment_requested'
                when 'payment' then search_track.workflow_status = 'payment_in_progress'
                when 'completed' then search_track.workflow_status in ('registered','not_registered','inquiry_only')
                else false
              end
              and (
                p_filters ->> 'view' not in ('consultation_requested','consultation_completed')
                or nullif(p_filters ->> 'consultationOwnerId','') is null
                or search_track.director_profile_id::text = p_filters ->> 'consultationOwnerId'
              )
              and pg_catalog.regexp_replace(pg_catalog.lower(search_track.subject), '[[:space:]-]+', '', 'g') like '%' ||
                pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          )
        )
      order by
        case when summary.pipeline_status = 'consultation_waiting' then 0 else 1 end,
        case when summary.pipeline_status = 'consultation_waiting' then summary.phone_ready_at end asc nulls last,
        summary.id asc
      limit 1
    ) matching_track on true
    where p_type = 'registration'

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      dashboard_private.ops_withdrawal_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'sortColumn')
    from common
    join public.ops_withdrawal_details detail on detail.task_id = common.id
    where p_type = 'withdrawal'
      and (nullif(p_filters ->> 'subject','') is null or common.subject = p_filters ->> 'subject' or (p_filters ->> 'subject' = '-' and nullif(pg_catalog.btrim(common.subject), '') is null))
      and (nullif(p_filters ->> 'teacher','') is null or detail.teacher_name = p_filters ->> 'teacher' or (p_filters ->> 'teacher' = '미지정' and nullif(pg_catalog.btrim(detail.teacher_name), '') is null))
      and case p_filters ->> 'view'
        when 'applicant' then common.status = 'requested'
        when 'operations' then common.status in ('confirmed','in_progress','on_hold','review_requested')
        else common.status in ('done','canceled')
      end
      and case p_filters ->> 'period'
        when 'today' then current_date = any(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date])
        when 'week' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7)
        when 'month' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value >= pg_catalog.date_trunc('month', current_date)::date and value < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date)
        when 'custom' then exists (select 1 from pg_catalog.unnest(array[detail.withdrawal_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date)
        else true
      end
      and (nullif(p_filters ->> 'filterColumn','') is null or dashboard_private.ops_withdrawal_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      dashboard_private.ops_transfer_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'sortColumn')
    from common
    join public.ops_transfer_details detail on detail.task_id = common.id
    where p_type = 'transfer'
      and (nullif(p_filters ->> 'subject','') is null or common.subject = p_filters ->> 'subject' or (p_filters ->> 'subject' = '-' and nullif(pg_catalog.btrim(common.subject), '') is null))
      and (nullif(p_filters ->> 'teacher','') is null or detail.from_teacher_name = p_filters ->> 'teacher' or (p_filters ->> 'teacher' = '미지정' and nullif(pg_catalog.btrim(detail.from_teacher_name), '') is null))
      and case p_filters ->> 'view'
        when 'applicant' then common.status = 'requested'
        when 'operations' then common.status in ('confirmed','in_progress','on_hold','review_requested')
        else common.status in ('done','canceled')
      end
      and case p_filters ->> 'period'
        when 'today' then current_date = any(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date])
        when 'week' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7)
        when 'month' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value >= pg_catalog.date_trunc('month', current_date)::date and value < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date)
        when 'custom' then exists (select 1 from pg_catalog.unnest(array[detail.from_class_end_date, detail.to_class_start_date, common.due_at::date, common.start_at::date, common.created_at::date]) value where value between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date)
        else true
      end
      and (nullif(p_filters ->> 'filterColumn','') is null or dashboard_private.ops_transfer_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      null::uuid,
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, coalesce(detail.test_at, common.due_at, common.start_at),
      coalesce(common.created_at, common.updated_at),
      null::integer, null::timestamptz,
      dashboard_private.ops_word_retest_numbered_scalar_v1(common.task_row, detail, p_filters ->> 'tableSortColumn', common.assignee_label, common.requester_label)
    from common
    join public.ops_word_retests detail on detail.task_id = common.id
    where p_type = 'word_retest'
      and (nullif(p_filters ->> 'branch','') is null or detail.branch = p_filters ->> 'branch')
      and (
        nullif(p_filters ->> 'teacherId','') is null
        or detail.teacher_catalog_id::text = p_filters ->> 'teacherId'
        or (
          p_filters ->> 'teacherId' like 'teacher_name:%'
          and nullif(pg_catalog.btrim(detail.teacher_name), '') = pg_catalog.substr(p_filters ->> 'teacherId', 14)
        )
        or (
          p_filters ->> 'teacherId' = '__unassigned__'
          and detail.teacher_catalog_id is null
          and nullif(pg_catalog.btrim(detail.teacher_name), '') is null
        )
      )
      and (
        nullif(p_filters ->> 'classId','') is null
        or common.class_id::text = p_filters ->> 'classId'
        or (
          p_filters ->> 'classId' like 'class_name:%'
          and coalesce(nullif(pg_catalog.btrim(common.class_name), ''), nullif(pg_catalog.btrim(detail.class_name), '')) = pg_catalog.substr(p_filters ->> 'classId', 12)
        )
        or (
          p_filters ->> 'classId' = '__unassigned__'
          and common.class_id is null
          and nullif(pg_catalog.btrim(coalesce(common.class_name, detail.class_name)), '') is null
        )
      )
      and ((p_filters ->> 'includeClosed')::boolean or common.status not in ('done','canceled'))
      and (
        ((p_filters ->> 'includeClosed')::boolean and common.status in ('done','canceled'))
        or (p_filters ->> 'queue' = 'assistant' and common.status in ('requested','confirmed','in_progress','on_hold'))
        or (p_filters ->> 'queue' = 'teacher' and common.status = 'review_requested')
      )
      and case p_filters ->> 'period'
        when 'today' then coalesce(detail.test_at, common.due_at, common.start_at)::date = current_date
        when 'week' then coalesce(detail.test_at, common.due_at, common.start_at)::date between current_date - extract(isodow from current_date)::integer + 1 and current_date - extract(isodow from current_date)::integer + 7
        when 'month' then coalesce(detail.test_at, common.due_at, common.start_at)::date >= pg_catalog.date_trunc('month', current_date)::date and coalesce(detail.test_at, common.due_at, common.start_at)::date < (pg_catalog.date_trunc('month', current_date) + interval '1 month')::date
        when 'custom' then coalesce(detail.test_at, common.due_at, common.start_at)::date between (p_filters ->> 'dateFrom')::date and (p_filters ->> 'dateTo')::date
        else true
      end
  )
  select * from shaped
$function$;

create or replace function dashboard_private.ops_task_numbered_project_v1(
  p_type text, p_ids uuid[], p_matching_ids uuid[]
) returns table(id uuid, row_data jsonb) language sql stable security invoker
set search_path = '' set timezone = 'Asia/Seoul' as $function$
  with base as materialized (
    select task.*, task as task_row, selected.matching_track_id,
      coalesce(nullif(pg_catalog.btrim(requester.name), ''), nullif(pg_catalog.btrim(requester.email), ''), '') as requester_label,
      coalesce(nullif(pg_catalog.btrim(assignee.name), ''), nullif(pg_catalog.btrim(assignee.email), ''), '') as assignee_label,
      coalesce(nullif(pg_catalog.btrim(secondary.name), ''), nullif(pg_catalog.btrim(secondary.email), ''), '') as secondary_assignee_label
    from rows from(pg_catalog.unnest(p_ids), pg_catalog.unnest(p_matching_ids)) selected(id,matching_track_id)
    join public.ops_tasks task on task.id=selected.id
    left join public.profiles requester on requester.id=task.requested_by
    left join public.profiles assignee on assignee.id=task.assignee_id
    left join public.profiles secondary on secondary.id=task.secondary_assignee_id
  ), common as (select base.*,
      pg_catalog.jsonb_build_object(
        'id', base.id,
        'title', base.title,
        'type', base.type,
        'status', base.status,
        'priority', base.priority,
        'requestedById', base.requested_by,
        'requestedByLabel', base.requester_label,
        'requestedTeam', coalesce(base.requested_team, ''),
        'assigneeId', base.assignee_id,
        'assigneeLabel', base.assignee_label,
        'assigneeTeam', coalesce(base.assignee_team, ''),
        'secondaryAssigneeId', base.secondary_assignee_id,
        'secondaryAssigneeLabel', base.secondary_assignee_label,
        'studentId', base.student_id,
        'studentName', coalesce(base.student_name, ''),
        'classId', base.class_id,
        'className', coalesce(base.class_name, ''),
        'textbookId', base.textbook_id,
        'textbookTitle', coalesce(base.textbook_title, ''),
        'campus', coalesce(base.campus, ''),
        'subject', coalesce(base.subject, ''),
        'startAt', base.start_at,
        'dueAt', base.due_at,
        'completedAt', base.completed_at,
        'memo', coalesce(base.memo, ''),
        'createdAt', base.created_at,
        'updatedAt', base.updated_at,
        'completedById', base.completed_by,
        'completedByLabel', coalesce(base.completed_by_label, ''),
        'summaryFlags', '[]'::jsonb
      ) as common_json
    from base
  )
  select common.id, common.common_json
    from common
    where p_type = 'general'
  union all
  select common.id, common.common_json || pg_catalog.jsonb_build_object(
        'registration', pg_catalog.jsonb_build_object(
          'pipelineStatus', coalesce(detail.pipeline_status, ''),
          'inquiryAt', detail.inquiry_at,
          'schoolGrade', coalesce(detail.school_grade, ''),
          'schoolName', coalesce(detail.school_name, ''),
          'parentPhone', coalesce(detail.parent_phone, ''),
          'studentPhone', coalesce(detail.student_phone, ''),
          'levelTestAt', detail.level_test_at,
          'levelTestCompletedAt', detail.level_test_completed_at,
          'levelTestResult', coalesce(detail.level_test_result, ''),
          'levelTestPlace', coalesce(detail.level_test_place, ''),
          'levelTestMaterialLink', coalesce(detail.level_test_material_link, ''),
          'counselor', coalesce(detail.counselor, ''),
          'phoneConsultationAt', detail.phone_consultation_at,
          'visitConsultationAt', detail.visit_consultation_at,
          'consultationAt', detail.consultation_at,
          'classStartDate', detail.class_start_date,
          'classStartSession', coalesce(detail.class_start_session, ''),
          'requestNote', coalesce(detail.request_note, '')
        ),
        'registrationTracks', coalesce(track_page.tracks, '[]'::jsonb)
      )
    from common
    left join public.ops_registration_details detail on detail.task_id = common.id
    left join lateral (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', summary.id,
          'taskId', summary.task_id,
          'subject', summary.subject,
          'status', summary.pipeline_status,
          'workflowStatus', summary.workflow_status,
          'workflowRevision', summary.workflow_revision,
          'workflowStatusEnteredAt', summary.workflow_status_entered_at,
          'legacy', false,
          'directorProfileId', summary.director_profile_id,
          'directorName', coalesce(director.name, ''),
          'directorAssignmentSource', coalesce(summary.director_assignment_source, ''),
          'directorAssignmentRuleKey', coalesce(summary.director_assignment_rule_key, ''),
          'waitingKind', coalesce(summary.waiting_kind, ''),
          'waitingDetailKind', coalesce(summary.waiting_detail_kind, ''),
          'waitingDetailClassId', summary.waiting_detail_class_id,
          'waitingDetailRetakeDecision', coalesce(summary.waiting_detail_retake_decision, ''),
          'enrollmentDetailRows', coalesce(summary.enrollment_detail_rows, '[]'::jsonb),
          'levelTestRetakeDecision', coalesce(summary.level_test_retake_decision, ''),
          'migrationReviewRequired', coalesce(summary.migration_review_required, false),
          'stageEnteredAt', summary.stage_entered_at,
          'phoneReadyAt', summary.phone_ready_at,
          'phoneReadySource', summary.phone_ready_source,
          'levelTestScheduledAt', summary.level_test_scheduled_at,
          'levelTestPlace', summary.level_test_place,
          'visitScheduledAt', summary.visit_scheduled_at,
          'visitPlace', summary.visit_place,
          'observationAttemptCount', summary.observation_attempt_count,
          'observationCurrentId', summary.observation_current_id,
          'observationCurrentStatus', summary.observation_current_status,
          'observationCurrentAppointmentId', summary.observation_current_appointment_id,
          'observationNearestScheduledAt', summary.observation_nearest_scheduled_at,
          'observationNearestPlace', summary.observation_nearest_place,
          'observationNotificationRevision', summary.observation_notification_revision,
          'observationRevision', summary.observation_revision,
          'observationFeedbackRevision', summary.observation_feedback_revision,
          'observationSummaryVisible', summary.observation_attempt_count is not null
            or summary.observation_current_id is not null
            or summary.observation_current_status is not null
            or summary.observation_current_appointment_id is not null
            or summary.observation_nearest_scheduled_at is not null
            or summary.observation_nearest_place is not null
            or summary.observation_notification_revision is not null
            or summary.observation_revision is not null
            or summary.observation_feedback_revision is not null
        ) order by case when summary.id = common.matching_track_id then 0 else 1 end, summary.id
      ) as tracks
      from public.ops_registration_subject_track_summaries summary
      left join public.profiles director on director.id = summary.director_profile_id
      where summary.task_id = common.id
    ) track_page on true
    where p_type = 'registration'
  union all
  select common.id, common.common_json || pg_catalog.jsonb_build_object(
        'displayValues', values.display_values,
        'inlineState', pg_catalog.jsonb_build_object(
          'teacherName', coalesce(detail.teacher_name, ''),
          'withdrawalDate', detail.withdrawal_date,
          'withdrawalSession', coalesce(detail.withdrawal_session, ''),
          'customerReason', coalesce(detail.customer_reason, ''),
          'teacherOpinion', coalesce(detail.teacher_opinion, ''),
          'undistributedTextbooks', coalesce(detail.undistributed_textbooks, ''),
          'completedLessonHours', detail.completed_lesson_hours,
          'fourWeekLessonHours', detail.four_week_lesson_hours,
          'makeeduWithdrawalDone', detail.makeedu_withdrawal_done,
          'feeProcessed', detail.fee_processed,
          'textbookFeeProcessed', detail.textbook_fee_processed
        )
      )
    from common
    join public.ops_withdrawal_details detail on detail.task_id=common.id
    cross join lateral (select pg_catalog.jsonb_object_agg(column_key, dashboard_private.ops_withdrawal_numbered_scalar_v1(common.task_row, detail, column_key)) as display_values
      from pg_catalog.unnest(array['status','subject','teacher','className','student','withdrawalDate','withdrawalSession','completedLessonHours','fourWeekLessonHours','progress','customerReason','teacherOpinion','undistributedTextbooks','operationsChecklist']) column_key) values
    where p_type = 'withdrawal'
  union all
  select common.id, common.common_json || pg_catalog.jsonb_build_object(
        'displayValues', values.display_values,
        'inlineState', pg_catalog.jsonb_build_object(
          'fromClassId', detail.from_class_id,
          'toClassId', detail.to_class_id,
          'fromTeacherName', coalesce(detail.from_teacher_name, ''),
          'toTeacherName', coalesce(detail.to_teacher_name, ''),
          'fromClassName', coalesce(detail.from_class_name, ''),
          'toClassName', coalesce(detail.to_class_name, ''),
          'fromClassEndDate', detail.from_class_end_date,
          'fromClassEndSession', coalesce(detail.from_class_end_session, ''),
          'toClassStartDate', detail.to_class_start_date,
          'toClassStartSession', coalesce(detail.to_class_start_session, ''),
          'transferReason', coalesce(detail.transfer_reason, ''),
          'fromUndistributedTextbooks', coalesce(detail.from_undistributed_textbooks, ''),
          'toUndistributedTextbooks', coalesce(detail.to_undistributed_textbooks, ''),
          'makeeduTransferDone', detail.makeedu_transfer_done,
          'feeProcessed', detail.fee_processed,
          'textbookFeeProcessed', detail.textbook_fee_processed
        )
      )
    from common
    join public.ops_transfer_details detail on detail.task_id=common.id
    cross join lateral (select pg_catalog.jsonb_object_agg(column_key, dashboard_private.ops_transfer_numbered_scalar_v1(common.task_row, detail, column_key)) as display_values
      from pg_catalog.unnest(array['status','subject','fromTeacher','fromClassName','student','transferReason','fromUndistributedTextbooks','fromClassEndDate','fromClassEndSession','toTeacher','toClassName','toClassStartDate','toClassStartSession','toUndistributedTextbooks','operationsChecklist']) column_key) values
    where p_type = 'transfer'
  union all
  select common.id, common.common_json || pg_catalog.jsonb_build_object(
        'displayValues', values.display_values,
        'inlineState', pg_catalog.jsonb_build_object(
          'retryOfTaskId', detail.retry_of_task_id,
          'retryTaskId', detail.retry_task_id,
          'branch', coalesce(detail.branch, ''),
          'teacherId', detail.teacher_catalog_id,
          'teacherName', coalesce(detail.teacher_name, ''),
          'className', coalesce(detail.class_name, ''),
          'studentName', coalesce(detail.student_name, ''),
          'testAt', detail.test_at,
          'expectedRetestAt', detail.expected_retest_at,
          'textbookName', coalesce(detail.textbook_name, ''),
          'unit', coalesce(detail.unit, ''),
          'requestNote', coalesce(detail.request_note, ''),
          'totalQuestionCount', detail.total_question_count,
          'cutoffQuestionCount', detail.cutoff_question_count,
          'firstScore', detail.first_score,
          'secondScore', detail.second_score,
          'thirdScore', detail.third_score,
          'retestStatus', coalesce(detail.retest_status, 'not_started')
        )
      )
    from common
    join public.ops_word_retests detail on detail.task_id=common.id
    cross join lateral (select pg_catalog.jsonb_object_agg(column_key, dashboard_private.ops_word_retest_numbered_scalar_v1(common.task_row, detail, column_key, common.assignee_label, common.requester_label)) as display_values
      from pg_catalog.unnest(array['status','testAt','expectedRetestAt','teacher','class','student','textbook','unit','note','total','cutoff','score','result']) column_key) values
    where p_type = 'word_retest'
$function$;

create or replace function public.list_ops_task_numbered_page_v1(
  p_type text, p_filters jsonb, p_page integer, p_page_size integer
) returns jsonb language plpgsql stable security invoker
set search_path = '' set timezone = 'Asia/Seoul' as $function$
declare
  result jsonb;
  is_header boolean;
  key text;
  nullable_keys text[];
  date_from date;
  date_to date;
begin
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20)
    or p_type is null or p_type not in ('general','registration','withdrawal','transfer','word_retest')
    or pg_catalog.jsonb_typeof(p_filters) is distinct from 'object' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  -- Close JSON-null/three-valued-logic holes before the unchanged legacy validator.
  nullable_keys := case p_type
    when 'general' then array['requestedById','requestedTeam','assigneeId','assigneeTeam']
    when 'registration' then array['consultationOwnerId']
    when 'word_retest' then array['branch','classId','dateFrom','dateTo','tableSortColumn','tableSortDirection','teacherId']
    else array['subject','teacher','dateFrom','dateTo','filterColumn','sortColumn','sortDirection'] end;
  for key in select pg_catalog.jsonb_object_keys(p_filters) loop
    if not (key=any(nullable_keys)) and p_filters->key='null'::jsonb then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
  end loop;
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type,p_filters);
  if p_filters->>'sortColumn' = '' or p_filters->>'filterColumn' = '' or p_filters->>'tableSortColumn' = '' then
    raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
  end if;
  if p_type in ('withdrawal','transfer','word_retest') and p_filters->>'period'='custom' then
    if p_filters->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_filters->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end if;
    begin
      date_from := (p_filters->>'dateFrom')::date; date_to := (p_filters->>'dateTo')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='ops_task_numbered_request_invalid';
    end;
    if date_from > date_to then raise exception using errcode='22023', message='ops_task_numbered_request_invalid'; end if;
  end if;
  is_header := case when p_type in ('withdrawal','transfer') then p_filters->>'sortColumn' is not null
    when p_type='word_retest' then p_filters->>'tableSortColumn' is not null else false end;
  with eligible as materialized (
    select * from dashboard_private.ops_task_numbered_keys_v1(p_type,p_filters)
  ), selected as materialized (
    select projected.*, row_number() over (order by
    case when p_type = 'general' and p_filters ->> 'queue' = 'completed' then projected.completed_sort_at end desc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'status' then projected.workflow_status_rank end asc,
    case when p_type = 'general' and p_filters ->> 'sort' = 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.date_bucket end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.primary_date end asc nulls last,
    case when p_type = 'general' and p_filters ->> 'sort' <> 'priority' then projected.priority_rank end asc,
    case when p_type = 'general' and p_filters ->> 'queue' <> 'completed' then projected.recency_at end desc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_priority end asc,
    case when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then projected.registration_representative_at end asc nulls last,
    case when p_type in ('registration','withdrawal','transfer') and not is_header and not (p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested') then projected.recency_at end desc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'asc' then projected.display_text end collate dashboard_private.ko_numeric asc,
    case when is_header and coalesce(p_filters ->> 'sortDirection', p_filters ->> 'tableSortDirection') = 'desc' then projected.display_text end collate dashboard_private.ko_numeric desc,
    case when p_type in ('withdrawal','transfer') and is_header then projected.recency_at end desc,
    case when p_type = 'word_retest' then projected.effective_test_at end asc nulls last,
    case when p_type = 'word_retest' then projected.effective_created_at end asc,
    projected.id asc
    ) as ordinal
    from eligible projected
    order by ordinal
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_input as (
    select pg_catalog.array_agg(id order by ordinal) as ids, pg_catalog.array_agg(matching_track_id order by ordinal) as matching_ids from selected
  ), projected as (
    select dto.id,dto.row_data from page_input
    cross join lateral dashboard_private.ops_task_numbered_project_v1(p_type,page_input.ids,page_input.matching_ids) dto
  )
  select pg_catalog.jsonb_build_object(
    'rows',coalesce((select pg_catalog.jsonb_agg(projected.row_data order by selected.ordinal) from projected join selected using(id)),'[]'::jsonb),
    'page',p_page,'pageSize',p_page_size,'totalCount',(select pg_catalog.count(*) from eligible)
  ) into result;
  return result;
end
$function$;

revoke all on function dashboard_private.ops_withdrawal_numbered_scalar_v1(public.ops_tasks,public.ops_withdrawal_details,text) from public, anon;
grant execute on function dashboard_private.ops_withdrawal_numbered_scalar_v1(public.ops_tasks,public.ops_withdrawal_details,text) to authenticated;
revoke all on function dashboard_private.ops_transfer_numbered_scalar_v1(public.ops_tasks,public.ops_transfer_details,text) from public, anon;
grant execute on function dashboard_private.ops_transfer_numbered_scalar_v1(public.ops_tasks,public.ops_transfer_details,text) to authenticated;
revoke all on function dashboard_private.ops_word_retest_numbered_scalar_v1(public.ops_tasks,public.ops_word_retests,text,text,text) from public, anon;
grant execute on function dashboard_private.ops_word_retest_numbered_scalar_v1(public.ops_tasks,public.ops_word_retests,text,text,text) to authenticated;
revoke all on function dashboard_private.ops_task_numbered_keys_v1(text,jsonb) from public, anon;
grant execute on function dashboard_private.ops_task_numbered_keys_v1(text,jsonb) to authenticated;
revoke all on function dashboard_private.ops_task_numbered_project_v1(text,uuid[],uuid[]) from public, anon;
grant execute on function dashboard_private.ops_task_numbered_project_v1(text,uuid[],uuid[]) to authenticated;
revoke all on function public.list_ops_task_numbered_page_v1(text,jsonb,integer,integer) from public, anon;
grant execute on function public.list_ops_task_numbered_page_v1(text,jsonb,integer,integer) to authenticated;
