CREATE OR REPLACE FUNCTION dashboard_private.ops_task_numbered_keys_v1(p_type text, p_filters jsonb)
 RETURNS TABLE(id uuid, matching_track_id uuid, task_status text, priority_rank integer, workflow_status_rank integer, date_bucket integer, primary_date timestamp with time zone, completed_sort_at timestamp with time zone, recency_at timestamp with time zone, effective_test_at timestamp with time zone, effective_created_at timestamp with time zone, registration_representative_priority integer, registration_representative_at timestamp with time zone, display_text text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'Asia/Seoul'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$#variable_conflict use_column
begin
  return query

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
    left join lateral (
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
      and (
        matching_track.matching_track_id is not null
        or (
          p_filters ->> 'view' = 'inquiry'
          and not exists (
            select 1
            from public.ops_registration_subject_track_summaries active_track
            where active_track.task_id = common.id
          )
          and (
            nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g'), '') is null
            or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.concat_ws(' ', common.student_name, common.title, detail.parent_phone, detail.student_phone, detail.school_grade, detail.school_name, detail.request_note)), '[[:space:]-]+', '', 'g') like '%' || pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> 'search')), '[[:space:]-]+', '', 'g') || '%'
          )
        )
      )

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
  select * from shaped;
end;
$function$
