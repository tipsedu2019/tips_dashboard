create schema if not exists dashboard_private;

create or replace function dashboard_private.ops_task_page_text_v1(
  p_value text,
  p_fallback text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(nullif(pg_catalog.btrim(p_value), ''), p_fallback)
$function$;

create or replace function dashboard_private.ops_task_page_decimal_v1(
  p_value numeric,
  p_fallback text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(nullif(pg_catalog.trim_scale(p_value)::text, ''), p_fallback)
$function$;

create or replace function dashboard_private.ops_task_page_status_label_v1(p_status text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case p_status
    when 'requested' then '신청'
    when 'confirmed' then '처리 중'
    when 'in_progress' then '처리 중'
    when 'review_requested' then '처리 중'
    when 'done' then '완료'
    when 'on_hold' then '처리 중'
    when 'canceled' then '취소'
    else '처리 중'
  end
$function$;

create or replace function dashboard_private.ops_task_page_assert_filters_v1(
  p_type text,
  p_filters jsonb
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  expected_keys text[];
  actual_keys text[];
  statuses jsonb;
  period_value text;
  from_value text;
  to_value text;
begin
  if p_type not in ('general', 'registration', 'withdrawal', 'transfer', 'word_retest')
     or pg_catalog.jsonb_typeof(p_filters) <> 'object'
     or p_filters ->> 'taskType' is distinct from p_type then
    raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
  end if;

  expected_keys := case p_type
    when 'general' then array[
      'assigneeId','assigneeTeam','focus','queue','requestedById','requestedTeam',
      'search','sort','statuses','taskType'
    ]
    when 'registration' then array[
      'consultationOwnerId','search','statuses','taskType','view'
    ]
    when 'withdrawal' then array[
      'dateFrom','dateTo','filterColumn','period','search','sortColumn','sortDirection',
      'statuses','subject','taskType','teacher','view'
    ]
    when 'transfer' then array[
      'dateFrom','dateTo','filterColumn','period','search','sortColumn','sortDirection',
      'statuses','subject','taskType','teacher','view'
    ]
    else array[
      'branch','classId','dateFrom','dateTo','includeClosed','period','queue','search',
      'statuses','tableSortColumn','tableSortDirection','taskType','teacherId'
    ]
  end;
  select pg_catalog.array_agg(key order by key)
  into actual_keys
  from pg_catalog.jsonb_object_keys(p_filters) key;
  select pg_catalog.array_agg(key order by key)
  into expected_keys
  from pg_catalog.unnest(expected_keys) key;
  if actual_keys is distinct from expected_keys
     or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
     or pg_catalog.jsonb_typeof(p_filters -> 'statuses') <> 'array'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_filters -> 'statuses') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
          or item #>> '{}' not in ('requested','confirmed','in_progress','review_requested','done','on_hold','canceled')
     ) then
    raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
  end if;
  statuses := p_filters -> 'statuses';

  if p_type = 'general' then
    if p_filters ->> 'queue' not in ('inbox','sent','completed')
       or p_filters ->> 'focus' not in ('none','today','overdue','mine','unassigned','confirmation')
       or p_filters ->> 'sort' not in ('status','priority','due')
       or exists (
         select 1 from pg_catalog.unnest(array['requestedById','requestedTeam','assigneeId','assigneeTeam']) key
         where pg_catalog.jsonb_typeof(p_filters -> key) not in ('string','null')
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
  elsif p_type = 'registration' then
    if p_filters ->> 'view' not in (
      'inquiry','level_test','consultation_requested','consultation_completed','waiting',
      'observation','enrollment','payment','completed'
    ) or pg_catalog.jsonb_typeof(p_filters -> 'consultationOwnerId') not in ('string','null') then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
  elsif p_type in ('withdrawal','transfer') then
    period_value := p_filters ->> 'period';
    from_value := p_filters ->> 'dateFrom';
    to_value := p_filters ->> 'dateTo';
    if p_filters ->> 'view' not in ('applicant','operations','closed')
       or period_value not in ('all','today','week','month','custom')
       or ((p_filters -> 'sortColumn') = 'null'::jsonb) is distinct from ((p_filters -> 'sortDirection') = 'null'::jsonb)
       or ((p_filters -> 'sortDirection') <> 'null'::jsonb and p_filters ->> 'sortDirection' not in ('asc','desc'))
       or (period_value = 'custom' and (from_value is null or to_value is null))
       or (period_value <> 'custom' and (from_value is not null or to_value is not null))
       or exists (
         select 1 from pg_catalog.unnest(array['subject','teacher','dateFrom','dateTo','filterColumn','sortColumn','sortDirection']) key
         where pg_catalog.jsonb_typeof(p_filters -> key) not in ('string','null')
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
    if p_type = 'withdrawal' and coalesce(p_filters ->> 'sortColumn', '') <> ''
       and p_filters ->> 'sortColumn' not in (
         'status','subject','teacher','className','student','withdrawalDate','withdrawalSession',
         'completedLessonHours','fourWeekLessonHours','progress','customerReason','teacherOpinion',
         'undistributedTextbooks','operationsChecklist'
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
    if p_type = 'withdrawal' and coalesce(p_filters ->> 'filterColumn', '') <> ''
       and p_filters ->> 'filterColumn' not in (
         'status','subject','teacher','className','student','withdrawalDate','withdrawalSession',
         'completedLessonHours','fourWeekLessonHours','progress','customerReason','teacherOpinion',
         'undistributedTextbooks','operationsChecklist'
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
    if p_type = 'transfer' and coalesce(p_filters ->> 'sortColumn', '') <> ''
       and p_filters ->> 'sortColumn' not in (
         'status','subject','fromTeacher','fromClassName','student','transferReason',
         'fromUndistributedTextbooks','fromClassEndDate','fromClassEndSession','toTeacher',
         'toClassName','toClassStartDate','toClassStartSession','toUndistributedTextbooks',
         'operationsChecklist'
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
    if p_type = 'transfer' and coalesce(p_filters ->> 'filterColumn', '') <> ''
       and p_filters ->> 'filterColumn' not in (
         'status','subject','fromTeacher','fromClassName','student','transferReason',
         'fromUndistributedTextbooks','fromClassEndDate','fromClassEndSession','toTeacher',
         'toClassName','toClassStartDate','toClassStartSession','toUndistributedTextbooks',
         'operationsChecklist'
       ) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
  else
    period_value := p_filters ->> 'period';
    from_value := p_filters ->> 'dateFrom';
    to_value := p_filters ->> 'dateTo';
    if p_filters ->> 'queue' not in ('assistant','teacher')
       or period_value not in ('all','today','week','month','custom')
       or pg_catalog.jsonb_typeof(p_filters -> 'includeClosed') <> 'boolean'
       or ((p_filters -> 'tableSortColumn') = 'null'::jsonb) is distinct from ((p_filters -> 'tableSortDirection') = 'null'::jsonb)
       or ((p_filters -> 'tableSortDirection') <> 'null'::jsonb and p_filters ->> 'tableSortDirection' not in ('asc','desc'))
       or (period_value = 'custom' and (from_value is null or to_value is null))
       or (period_value <> 'custom' and (from_value is not null or to_value is not null))
       or exists (
         select 1 from pg_catalog.unnest(array['branch','classId','dateFrom','dateTo','tableSortColumn','tableSortDirection','teacherId']) key
         where pg_catalog.jsonb_typeof(p_filters -> key) not in ('string','null')
       )
       or (coalesce(p_filters ->> 'tableSortColumn', '') <> '' and p_filters ->> 'tableSortColumn' not in (
         'status','testAt','expectedRetestAt','teacher','class','student','textbook','unit',
         'note','total','cutoff','score','result'
       )) then
      raise exception using errcode = '22023', message = 'ops_task_filters_invalid';
    end if;
  end if;
end
$function$;

create or replace function dashboard_private.ops_task_page_source_v1(
  p_type text,
  p_filters jsonb
)
returns table(
  id uuid,
  row_data jsonb,
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
      task.*,
      coalesce(nullif(pg_catalog.btrim(requester.name), ''), nullif(pg_catalog.btrim(requester.email), ''), '') as requester_label,
      coalesce(nullif(pg_catalog.btrim(assignee.name), ''), nullif(pg_catalog.btrim(assignee.email), ''), '') as assignee_label,
      coalesce(nullif(pg_catalog.btrim(secondary.name), ''), nullif(pg_catalog.btrim(secondary.email), ''), '') as secondary_assignee_label,
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
    left join public.profiles requester on requester.id = task.requested_by
    left join public.profiles assignee on assignee.id = task.assignee_id
    left join public.profiles secondary on secondary.id = task.secondary_assignee_id
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
  ), common as (
    select
      base.*,
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
        'summaryFlags', '[]'::jsonb
      ) as common_json
    from base
  ), shaped as (
    select
      common.id,
      common.common_json as row_data,
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
      common.common_json || pg_catalog.jsonb_build_object(
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
      ),
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
        ) order by case when summary.id = matching_track.matching_track_id then 0 else 1 end, summary.id
      ) as tracks
      from public.ops_registration_subject_track_summaries summary
      left join public.profiles director on director.id = summary.director_profile_id
      where summary.task_id = common.id
    ) track_page on true
    where p_type = 'registration'

    union all

    select
      common.id,
      common.common_json || pg_catalog.jsonb_build_object(
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
      ),
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      coalesce(values.display_values ->> (p_filters ->> 'sortColumn'), '')
    from common
    join public.ops_withdrawal_details detail on detail.task_id = common.id
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'status', dashboard_private.ops_task_page_status_label_v1(common.status),
        'subject', dashboard_private.ops_task_page_text_v1(common.subject, '-'),
        'teacher', dashboard_private.ops_task_page_text_v1(detail.teacher_name, '미지정'),
        'className', dashboard_private.ops_task_page_text_v1(common.class_name, '-'),
        'student', dashboard_private.ops_task_page_text_v1(common.student_name, '-'),
        'withdrawalDate', coalesce(pg_catalog.to_char(detail.withdrawal_date, 'YYYY-MM-DD'), '-'),
        'withdrawalSession', dashboard_private.ops_task_page_text_v1(detail.withdrawal_session, '-'),
        'completedLessonHours', dashboard_private.ops_task_page_decimal_v1(detail.completed_lesson_hours, '-'),
        'fourWeekLessonHours', dashboard_private.ops_task_page_decimal_v1(detail.four_week_lesson_hours, '-'),
        'progress', case when detail.four_week_lesson_hours > 0 then least(100, pg_catalog.round(100 * detail.completed_lesson_hours / detail.four_week_lesson_hours))::text || '%' else '-' end,
        'customerReason', dashboard_private.ops_task_page_text_v1(detail.customer_reason, '-'),
        'teacherOpinion', dashboard_private.ops_task_page_text_v1(detail.teacher_opinion, '-'),
        'undistributedTextbooks', dashboard_private.ops_task_page_text_v1(detail.undistributed_textbooks, '-'),
        'operationsChecklist',
          ((detail.makeedu_withdrawal_done::int + detail.fee_processed::int + detail.textbook_fee_processed::int)::text || '/3 · ' ||
            case when detail.makeedu_withdrawal_done and detail.fee_processed and detail.textbook_fee_processed then '처리 확인 완료'
            else pg_catalog.concat_ws(', ',
              case when not detail.makeedu_withdrawal_done then '메이크에듀 퇴원처리' end,
              case when not detail.fee_processed then '수업료 처리' end,
              case when not detail.textbook_fee_processed then '교재비 처리' end
            ) end)
      ) as display_values
    ) values
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
      and (nullif(p_filters ->> 'filterColumn','') is null or values.display_values ->> (p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      common.common_json || pg_catalog.jsonb_build_object(
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
      ),
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, null::timestamptz, common.created_at,
      null::integer, null::timestamptz,
      coalesce(values.display_values ->> (p_filters ->> 'sortColumn'), '')
    from common
    join public.ops_transfer_details detail on detail.task_id = common.id
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'status', dashboard_private.ops_task_page_status_label_v1(common.status),
        'subject', dashboard_private.ops_task_page_text_v1(common.subject, '-'),
        'fromTeacher', dashboard_private.ops_task_page_text_v1(detail.from_teacher_name, '미지정'),
        'fromClassName', dashboard_private.ops_task_page_text_v1(detail.from_class_name, '-'),
        'student', dashboard_private.ops_task_page_text_v1(common.student_name, '-'),
        'transferReason', dashboard_private.ops_task_page_text_v1(detail.transfer_reason, '-'),
        'fromUndistributedTextbooks', dashboard_private.ops_task_page_text_v1(detail.from_undistributed_textbooks, '-'),
        'fromClassEndDate', coalesce(pg_catalog.to_char(detail.from_class_end_date, 'YYYY-MM-DD'), '-'),
        'fromClassEndSession', dashboard_private.ops_task_page_text_v1(detail.from_class_end_session, '-'),
        'toTeacher', dashboard_private.ops_task_page_text_v1(detail.to_teacher_name, '미지정'),
        'toClassName', dashboard_private.ops_task_page_text_v1(coalesce(detail.to_class_name, common.class_name), '-'),
        'toClassStartDate', coalesce(pg_catalog.to_char(detail.to_class_start_date, 'YYYY-MM-DD'), '-'),
        'toClassStartSession', dashboard_private.ops_task_page_text_v1(detail.to_class_start_session, '-'),
        'toUndistributedTextbooks', dashboard_private.ops_task_page_text_v1(detail.to_undistributed_textbooks, '-'),
        'operationsChecklist',
          ((detail.makeedu_transfer_done::int + detail.fee_processed::int + detail.textbook_fee_processed::int)::text || '/3 · ' ||
            case when detail.makeedu_transfer_done and detail.fee_processed and detail.textbook_fee_processed then '처리 확인 완료'
            else pg_catalog.concat_ws(', ',
              case when not detail.makeedu_transfer_done then '메이크에듀 전반처리' end,
              case when not detail.fee_processed then '수업료 처리' end,
              case when not detail.textbook_fee_processed then '교재비 처리' end
            ) end)
      ) as display_values
    ) values
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
      and (nullif(p_filters ->> 'filterColumn','') is null or values.display_values ->> (p_filters ->> 'filterColumn') ilike '%' || pg_catalog.btrim(p_filters ->> 'search') || '%')

    union all

    select
      common.id,
      common.common_json || pg_catalog.jsonb_build_object(
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
      ),
      common.status, common.priority_rank, common.workflow_status_rank, common.date_bucket,
      common.primary_date, coalesce(common.completed_at, common.updated_at, common.created_at),
      common.updated_at, coalesce(detail.test_at, common.due_at, common.start_at),
      coalesce(common.created_at, common.updated_at),
      null::integer, null::timestamptz,
      coalesce(values.display_values ->> (p_filters ->> 'tableSortColumn'), '')
    from common
    join public.ops_word_retests detail on detail.task_id = common.id
    cross join lateral (
      select
        coalesce(nullif(pg_catalog.btrim(detail.retest_status), ''), 'not_started') as status_value,
        array_remove(array[detail.first_score, detail.second_score, detail.third_score], null) as scores
    ) score_source
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'status', case
          when common.status in ('review_requested','done') and score_source.status_value = 'absent' then '미응시'
          when common.status in ('review_requested','done') and detail.cutoff_question_count is not null and exists (select 1 from pg_catalog.unnest(score_source.scores) score where score >= detail.cutoff_question_count) then '완료: 합격'
          when common.status in ('review_requested','done') and detail.cutoff_question_count is not null and pg_catalog.cardinality(score_source.scores) > 0 then '미완료: 불합격'
          when common.status in ('review_requested','done') and score_source.status_value in ('done','in_progress') then '완료'
          when score_source.status_value = 'in_progress' then '진행 중'
          when score_source.status_value = 'absent' then '미응시'
          when score_source.status_value = 'done' then '완료'
          else '시작 전'
        end,
        'testAt', coalesce(pg_catalog.to_char(detail.test_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), ''),
        'expectedRetestAt', coalesce(pg_catalog.to_char(detail.expected_retest_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI'), ''),
        'teacher', dashboard_private.ops_task_page_text_v1(coalesce(detail.teacher_name, common.assignee_label, common.requester_label), '미지정'),
        'class', dashboard_private.ops_task_page_text_v1(coalesce(common.class_name, detail.class_name), '미지정'),
        'student', dashboard_private.ops_task_page_text_v1(coalesce(common.student_name, detail.student_name), '미지정'),
        'textbook', dashboard_private.ops_task_page_text_v1(coalesce(common.textbook_title, detail.textbook_name), '미지정'),
        'unit', dashboard_private.ops_task_page_text_v1(detail.unit, '미지정'),
        'note', dashboard_private.ops_task_page_text_v1(coalesce(detail.request_note, common.memo), ''),
        'total', dashboard_private.ops_task_page_decimal_v1(detail.total_question_count, ''),
        'cutoff', dashboard_private.ops_task_page_decimal_v1(detail.cutoff_question_count, ''),
        'score', dashboard_private.ops_task_page_decimal_v1((select pg_catalog.max(score) from pg_catalog.unnest(score_source.scores) score), ''),
        'result', case
          when score_source.status_value = 'absent' then '미응시'
          when detail.cutoff_question_count is null or pg_catalog.cardinality(score_source.scores) = 0 then '미정'
          when exists (select 1 from pg_catalog.unnest(score_source.scores) score where score >= detail.cutoff_question_count) then '통과'
          else '재시험'
        end
      ) as display_values
    ) values
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

create or replace function public.list_ops_task_page_v1(
  p_type text,
  p_filters jsonb,
  p_cursor_sort_values jsonb,
  p_cursor_id uuid,
  p_limit integer
)
returns table(id uuid, row_data jsonb, sort_values jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  cursor_arity integer;
  is_header boolean;
begin
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type, p_filters);
  if p_limit is null or p_limit < 1 or p_limit > 30
     or (p_cursor_sort_values is null) is distinct from (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'ops_task_page_limit_invalid';
  end if;
  is_header := case
    when p_type in ('withdrawal','transfer') then (p_filters -> 'sortColumn') <> 'null'::jsonb
    when p_type = 'word_retest' then (p_filters -> 'tableSortColumn') <> 'null'::jsonb
    else false
  end;
  cursor_arity := case
    when p_type = 'general' and p_filters ->> 'queue' = 'completed' then 1
    when p_type = 'general' and p_filters ->> 'sort' = 'status' then 5
    when p_type = 'general' then 4
    when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then 2
    when p_type in ('registration','withdrawal','transfer') and not is_header then 1
    when p_type in ('withdrawal','transfer') then 2
    when p_type = 'word_retest' and is_header then 3
    else 2
  end;
  if p_cursor_sort_values is not null and (
    pg_catalog.jsonb_typeof(p_cursor_sort_values) <> 'array'
    or pg_catalog.jsonb_array_length(p_cursor_sort_values) <> cursor_arity
  ) then
    raise exception using errcode = '22023', message = 'ops_task_cursor_invalid';
  end if;
  if p_cursor_sort_values is not null and exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_cursor_sort_values) with ordinality cursor_value(value, position)
    where case
      when p_type = 'general' and p_filters ->> 'queue' = 'completed' then pg_catalog.jsonb_typeof(value) not in ('string')
      when p_type = 'general' and p_filters ->> 'sort' = 'status' and position in (1,2,4) then pg_catalog.jsonb_typeof(value) <> 'number'
      when p_type = 'general' and p_filters ->> 'sort' = 'priority' and position in (1,2) then pg_catalog.jsonb_typeof(value) <> 'number'
      when p_type = 'general' and p_filters ->> 'sort' = 'due' and position in (1,3) then pg_catalog.jsonb_typeof(value) <> 'number'
      when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' and position = 1 then pg_catalog.jsonb_typeof(value) <> 'number'
      when p_type in ('withdrawal','transfer') and is_header and position = 1 then pg_catalog.jsonb_typeof(value) <> 'string'
      when p_type = 'word_retest' and is_header and position = 1 then pg_catalog.jsonb_typeof(value) <> 'string'
      else pg_catalog.jsonb_typeof(value) not in ('string','null')
    end
  ) then
    raise exception using errcode = '22023', message = 'ops_task_cursor_invalid';
  end if;

  return query
  with source as (
    select * from dashboard_private.ops_task_page_source_v1(p_type, p_filters)
  ), projected as (
    select
      source.*,
      case
        when p_type = 'general' and p_filters ->> 'queue' = 'completed' then pg_catalog.jsonb_build_array(source.completed_sort_at)
        when p_type = 'general' and p_filters ->> 'sort' = 'status' then pg_catalog.jsonb_build_array(source.workflow_status_rank, source.date_bucket, source.primary_date, source.priority_rank, source.recency_at)
        when p_type = 'general' and p_filters ->> 'sort' = 'priority' then pg_catalog.jsonb_build_array(source.priority_rank, source.date_bucket, source.primary_date, source.recency_at)
        when p_type = 'general' then pg_catalog.jsonb_build_array(source.date_bucket, source.primary_date, source.priority_rank, source.recency_at)
        when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then pg_catalog.jsonb_build_array(source.registration_representative_priority, source.registration_representative_at)
        when p_type in ('registration','withdrawal','transfer') and not is_header then pg_catalog.jsonb_build_array(source.recency_at)
        when p_type in ('withdrawal','transfer') then pg_catalog.jsonb_build_array(source.display_text, source.recency_at)
        when p_type = 'word_retest' and is_header then pg_catalog.jsonb_build_array(source.display_text, source.effective_test_at, source.effective_created_at)
        else pg_catalog.jsonb_build_array(source.effective_test_at, source.effective_created_at)
      end as row_sort_values
    from source
  )
  select projected.id, projected.row_data, projected.row_sort_values
  from projected
  where p_cursor_id is null or (
    case
      when p_type = 'general' and p_filters ->> 'queue' = 'completed' then
        projected.completed_sort_at < (p_cursor_sort_values ->> 0)::timestamptz
        or (projected.completed_sort_at = (p_cursor_sort_values ->> 0)::timestamptz and projected.id > p_cursor_id)
      when p_type = 'registration' and p_filters ->> 'view' = 'consultation_requested' then
        projected.registration_representative_priority > (p_cursor_sort_values ->> 0)::integer
        or (projected.registration_representative_priority = (p_cursor_sort_values ->> 0)::integer and (
          projected.registration_representative_at > (p_cursor_sort_values ->> 1)::timestamptz
          or (projected.registration_representative_at is null and (p_cursor_sort_values ->> 1) is not null)
          or (projected.registration_representative_at is not distinct from (p_cursor_sort_values ->> 1)::timestamptz and projected.id > p_cursor_id)
        ))
      when p_type in ('registration','withdrawal','transfer') and not is_header then
        projected.recency_at < (p_cursor_sort_values ->> 0)::timestamptz
        or (projected.recency_at = (p_cursor_sort_values ->> 0)::timestamptz and projected.id > p_cursor_id)
      when p_type in ('withdrawal','transfer') and is_header then
        case when p_filters ->> 'sortDirection' = 'asc'
          then projected.display_text collate dashboard_private.ko_numeric > (p_cursor_sort_values ->> 0) collate dashboard_private.ko_numeric
          else projected.display_text collate dashboard_private.ko_numeric < (p_cursor_sort_values ->> 0) collate dashboard_private.ko_numeric
        end
        or (projected.display_text = p_cursor_sort_values ->> 0 and (
          projected.recency_at < (p_cursor_sort_values ->> 1)::timestamptz
          or (projected.recency_at = (p_cursor_sort_values ->> 1)::timestamptz and projected.id > p_cursor_id)
        ))
      when p_type = 'word_retest' then
        (is_header and (
          case when p_filters ->> 'tableSortDirection' = 'asc'
            then projected.display_text collate dashboard_private.ko_numeric > (p_cursor_sort_values ->> 0) collate dashboard_private.ko_numeric
            else projected.display_text collate dashboard_private.ko_numeric < (p_cursor_sort_values ->> 0) collate dashboard_private.ko_numeric
          end
        ))
        or ((not is_header or projected.display_text = p_cursor_sort_values ->> 0) and (
          projected.effective_test_at > (p_cursor_sort_values ->> (case when is_header then 1 else 0 end))::timestamptz
          or (projected.effective_test_at is null and (p_cursor_sort_values ->> (case when is_header then 1 else 0 end)) is not null)
          or (projected.effective_test_at is not distinct from (p_cursor_sort_values ->> (case when is_header then 1 else 0 end))::timestamptz and (
            projected.effective_created_at > (p_cursor_sort_values ->> (case when is_header then 2 else 1 end))::timestamptz
            or (projected.effective_created_at = (p_cursor_sort_values ->> (case when is_header then 2 else 1 end))::timestamptz and projected.id > p_cursor_id)
          ))
        ))
      else
        case
          when p_filters ->> 'sort' = 'status' then
            projected.workflow_status_rank > (p_cursor_sort_values ->> 0)::integer
            or (projected.workflow_status_rank = (p_cursor_sort_values ->> 0)::integer and (
              projected.date_bucket > (p_cursor_sort_values ->> 1)::integer
              or (projected.date_bucket = (p_cursor_sort_values ->> 1)::integer and (
                projected.primary_date > (p_cursor_sort_values ->> 2)::timestamptz
                or (projected.primary_date is null and (p_cursor_sort_values ->> 2) is not null)
                or (projected.primary_date is not distinct from (p_cursor_sort_values ->> 2)::timestamptz and (
                  projected.priority_rank > (p_cursor_sort_values ->> 3)::integer
                  or (projected.priority_rank = (p_cursor_sort_values ->> 3)::integer and (
                    projected.recency_at < (p_cursor_sort_values ->> 4)::timestamptz
                    or (projected.recency_at = (p_cursor_sort_values ->> 4)::timestamptz and projected.id > p_cursor_id)
                  ))
                ))
              ))
            ))
          when p_filters ->> 'sort' = 'priority' then
            projected.priority_rank > (p_cursor_sort_values ->> 0)::integer
            or (projected.priority_rank = (p_cursor_sort_values ->> 0)::integer and (
              projected.date_bucket > (p_cursor_sort_values ->> 1)::integer
              or (projected.date_bucket = (p_cursor_sort_values ->> 1)::integer and (
                projected.primary_date > (p_cursor_sort_values ->> 2)::timestamptz
                or (projected.primary_date is null and (p_cursor_sort_values ->> 2) is not null)
                or (projected.primary_date is not distinct from (p_cursor_sort_values ->> 2)::timestamptz and (
                  projected.recency_at < (p_cursor_sort_values ->> 3)::timestamptz
                  or (projected.recency_at = (p_cursor_sort_values ->> 3)::timestamptz and projected.id > p_cursor_id)
                ))
              ))
            ))
          else
            projected.date_bucket > (p_cursor_sort_values ->> 0)::integer
            or (projected.date_bucket = (p_cursor_sort_values ->> 0)::integer and (
              projected.primary_date > (p_cursor_sort_values ->> 1)::timestamptz
              or (projected.primary_date is null and (p_cursor_sort_values ->> 1) is not null)
              or (projected.primary_date is not distinct from (p_cursor_sort_values ->> 1)::timestamptz and (
                projected.priority_rank > (p_cursor_sort_values ->> 2)::integer
                or (projected.priority_rank = (p_cursor_sort_values ->> 2)::integer and (
                  projected.recency_at < (p_cursor_sort_values ->> 3)::timestamptz
                  or (projected.recency_at = (p_cursor_sort_values ->> 3)::timestamptz and projected.id > p_cursor_id)
                ))
              ))
            ))
        end
    end
  )
  order by
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
  limit p_limit + 1;
end
$function$;

create or replace function public.get_ops_task_list_stats_v1(
  p_type text,
  p_filters jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  result jsonb;
  by_view jsonb := '{}'::jsonb;
  metrics jsonb := '{}'::jsonb;
  facets jsonb := '{}'::jsonb;
begin
  perform dashboard_private.ops_task_page_assert_filters_v1(p_type, p_filters);
  with status_counts as (
    select source.task_status, pg_catalog.count(*) as count_value
    from dashboard_private.ops_task_page_source_v1(p_type, p_filters) source
    group by source.task_status
  )
  select pg_catalog.jsonb_build_object(
    'total', coalesce(pg_catalog.sum(status_counts.count_value), 0),
    'byStatus', coalesce(pg_catalog.jsonb_object_agg(status_counts.task_status, status_counts.count_value), '{}'::jsonb)
  )
  into result
  from status_counts;

  if p_type = 'general' then
    with sibling(view_key) as (
      values ('inbox'::text), ('sent'::text), ('completed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{queue}', pg_catalog.to_jsonb(sibling.view_key))
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    with focus_keys(metric_key) as (
      values ('today'::text), ('overdue'::text), ('mine'::text), ('unassigned'::text), ('confirmation'::text)
    ), counts as (
      select focus_keys.metric_key, pg_catalog.count(source.id) as count_value
      from focus_keys
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{focus}', pg_catalog.to_jsonb(focus_keys.metric_key))
      ) source on true
      group by focus_keys.metric_key
    )
    select pg_catalog.jsonb_object_agg(metric_key, count_value) into metrics from counts;

    select pg_catalog.jsonb_build_object(
      'requestedBy', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'requestedById', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'requestedByLabel', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{requestedById}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'requestedByLabel', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'requestedTeam', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{requestedTeam}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'requestedTeam', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'assignee', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select candidate.value, candidate.label, pg_catalog.count(distinct candidate.task_id) as count_value
          from (
            with assignee_source as materialized (
              select source.id, source.row_data
              from dashboard_private.ops_task_page_source_v1(
                p_type,
                pg_catalog.jsonb_set(p_filters, '{assigneeId}', 'null'::jsonb)
              ) source
            )
            select
              source.id as task_id,
              source.row_data ->> 'assigneeId' as value,
              coalesce(nullif(source.row_data ->> 'assigneeLabel', ''), '미지정') as label
            from assignee_source source
            where nullif(source.row_data ->> 'assigneeId', '') is not null
            union all
            select
              source.id,
              source.row_data ->> 'secondaryAssigneeId',
              coalesce(nullif(source.row_data ->> 'secondaryAssigneeLabel', ''), '미지정')
            from assignee_source source
            where nullif(source.row_data ->> 'secondaryAssigneeId', '') is not null
            union all
            select source.id, '__unassigned__', '미지정'
            from assignee_source source
            where nullif(source.row_data ->> 'assigneeId', '') is null
              and nullif(source.row_data ->> 'secondaryAssigneeId', '') is null
          ) candidate
          group by candidate.value, candidate.label
          order by candidate.label collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'assigneeTeam', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '__unassigned__') as value,
            coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{assigneeTeam}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'assigneeTeam', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  elsif p_type = 'registration' then
    with sibling(view_key) as (
      values
        ('inquiry'::text), ('level_test'::text), ('consultation_requested'::text),
        ('consultation_completed'::text), ('waiting'::text), ('observation'::text),
        ('enrollment'::text), ('payment'::text), ('completed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_filters, '{view}', pg_catalog.to_jsonb(sibling.view_key)),
          '{consultationOwnerId}',
          'null'::jsonb
        )
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'consultationMine', case when p_filters ->> 'view' in ('consultation_requested','consultation_completed') then (
        select pg_catalog.count(*) from dashboard_private.ops_task_page_source_v1(
          p_type,
          pg_catalog.jsonb_set(p_filters, '{consultationOwnerId}', pg_catalog.to_jsonb((select auth.uid())::text))
        )
      ) else 0 end,
      'consultationAll', case when p_filters ->> 'view' in ('consultation_requested','consultation_completed') then (
        select pg_catalog.count(*) from dashboard_private.ops_task_page_source_v1(
          p_type,
          pg_catalog.jsonb_set(p_filters, '{consultationOwnerId}', 'null'::jsonb)
        )
      ) else 0 end
    ) into metrics;
  elsif p_type in ('withdrawal','transfer') then
    with sibling(view_key) as (
      values ('applicant'::text), ('operations'::text), ('closed'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(p_filters, '{view}', pg_catalog.to_jsonb(sibling.view_key))
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'subject', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data ->> 'subject', ''), '-') as value,
            coalesce(nullif(source.row_data ->> 'subject', ''), '-') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{subject}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data ->> 'subject', ''), '-') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'teacher', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') as value,
            coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{teacher}', 'null'::jsonb)) source
          group by 1,2
          order by coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), nullif(source.row_data #>> '{displayValues,fromTeacher}', ''), '미지정') collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  else
    with sibling(view_key) as (
      values ('assistant'::text), ('teacher'::text)
    ), counts as (
      select sibling.view_key, pg_catalog.count(source.id) as count_value
      from sibling
      left join lateral dashboard_private.ops_task_page_source_v1(
        p_type,
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(p_filters, '{queue}', pg_catalog.to_jsonb(sibling.view_key)),
          '{includeClosed}',
          'false'::jsonb
        )
      ) source on true
      group by sibling.view_key
    )
    select pg_catalog.jsonb_object_agg(view_key, count_value) into by_view from counts;

    select pg_catalog.jsonb_build_object(
      'teacher', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then source.row_data #>> '{inlineState,teacherId}'
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then 'teacher_name:' || pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '__unassigned__'
            end as value,
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), '미지정')
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '미지정'
            end as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{teacherId}', 'null'::jsonb)) source
          group by 1,2
          order by (
            case
              when nullif(source.row_data #>> '{inlineState,teacherId}', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,teacher}', ''), '미지정')
              when nullif(source.row_data #>> '{inlineState,teacherName}', '') is not null then pg_catalog.btrim(source.row_data #>> '{inlineState,teacherName}')
              else '미지정'
            end
          ) collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb),
      'class', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', value, 'label', label, 'count', count_value) order by label collate dashboard_private.ko_numeric)
        from (
          select
            case
              when nullif(source.row_data ->> 'classId', '') is not null then source.row_data ->> 'classId'
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then 'class_name:' || coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '__unassigned__'
            end as value,
            case
              when nullif(source.row_data ->> 'classId', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,class}', ''), '미지정')
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '미지정'
            end as label,
            pg_catalog.count(*) as count_value
          from dashboard_private.ops_task_page_source_v1(p_type, pg_catalog.jsonb_set(p_filters, '{classId}', 'null'::jsonb)) source
          group by 1,2
          order by (
            case
              when nullif(source.row_data ->> 'classId', '') is not null then coalesce(nullif(source.row_data #>> '{displayValues,class}', ''), '미지정')
              when coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              ) is not null then coalesce(
                nullif(pg_catalog.btrim(source.row_data ->> 'className'), ''),
                nullif(pg_catalog.btrim(source.row_data #>> '{inlineState,className}'), '')
              )
              else '미지정'
            end
          ) collate dashboard_private.ko_numeric
          limit 100
        ) bounded
      ), '[]'::jsonb)
    ) into facets;
  end if;

  return result || pg_catalog.jsonb_build_object(
    'byView', coalesce(by_view, '{}'::jsonb),
    'metrics', coalesce(metrics, '{}'::jsonb),
    'facets', coalesce(facets, '{}'::jsonb)
  );
end
$function$;

revoke all on function public.list_ops_task_page_v1(text,jsonb,jsonb,uuid,integer) from public, anon;
revoke all on function public.get_ops_task_list_stats_v1(text,jsonb) from public, anon;
grant execute on function public.list_ops_task_page_v1(text,jsonb,jsonb,uuid,integer) to authenticated;
grant execute on function public.get_ops_task_list_stats_v1(text,jsonb) to authenticated;

revoke all on function dashboard_private.ops_task_page_text_v1(text,text) from public, anon, authenticated;
revoke all on function dashboard_private.ops_task_page_decimal_v1(numeric,text) from public, anon, authenticated;
revoke all on function dashboard_private.ops_task_page_status_label_v1(text) from public, anon, authenticated;
revoke all on function dashboard_private.ops_task_page_assert_filters_v1(text,jsonb) from public, anon, authenticated;
revoke all on function dashboard_private.ops_task_page_source_v1(text,jsonb) from public, anon, authenticated;
grant execute on function dashboard_private.ops_task_page_text_v1(text,text) to authenticated;
grant execute on function dashboard_private.ops_task_page_decimal_v1(numeric,text) to authenticated;
grant execute on function dashboard_private.ops_task_page_status_label_v1(text) to authenticated;
grant execute on function dashboard_private.ops_task_page_assert_filters_v1(text,jsonb) to authenticated;
grant execute on function dashboard_private.ops_task_page_source_v1(text,jsonb) to authenticated;

create index if not exists ops_tasks_general_page_sort_idx
  on public.ops_tasks(status, due_at, start_at, priority, updated_at desc, id)
  where type in ('general','textbook');

create index if not exists ops_tasks_registration_page_sort_idx
  on public.ops_tasks(updated_at desc, id)
  where type = 'registration';

create index if not exists ops_tasks_operation_page_sort_idx
  on public.ops_tasks(type, status, updated_at desc, id)
  where type in ('withdrawal','transfer','word_retest');
