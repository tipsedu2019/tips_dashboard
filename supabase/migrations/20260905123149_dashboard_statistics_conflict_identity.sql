-- Keep affected students in display data, not teacher/classroom RPC identity.
-- Forward replacement of the final aggregate; role/RLS, volatility and ACLs stay intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.get_dashboard_statistics_sources_v1(
  p_tab text,
  p_subject text default null,
  p_division text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  normalized_subject text := coalesce(p_subject, 'all');
  normalized_division text := coalesce(p_division, 'all');
  local_today date := (pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date;
  range_from date;
  range_to date;
  result jsonb;
begin
  if p_tab is null or pg_catalog.btrim(p_tab) = ''
    or p_tab not in ('overview', 'students_classes', 'schedule_conflicts', 'textbooks') then
    raise exception 'dashboard_statistics_request_invalid' using errcode = '22023';
  end if;
  if p_subject = '' or p_division = '' then
    raise exception 'dashboard_statistics_request_invalid' using errcode = '22023';
  end if;

  if p_tab in ('overview', 'students_classes') then
    if normalized_subject <> all(array['all', 'english', 'math', 'science'])
      or normalized_division <> all(array['all', 'middle', 'high'])
      or p_date_from is not null
      or p_date_to is not null then
      raise exception 'dashboard_statistics_request_invalid' using errcode = '22023';
    end if;
    return dashboard_private.get_dashboard_statistics_students_classes_v1(
      normalized_subject,
      normalized_division,
      p_tab = 'students_classes'
    );
  end if;

  if p_tab = 'schedule_conflicts' then
    if p_subject is not null or p_division is not null then
      raise exception 'dashboard_statistics_request_invalid' using errcode = '22023';
    end if;
    range_from := coalesce(p_date_from, local_today);
    range_to := coalesce(p_date_to, local_today + 90);
    if (p_date_from is null) <> (p_date_to is null)
      or range_to < range_from
      or (range_to - range_from) <> all(array[90, 180, 400]) then
      raise exception 'dashboard_statistics_date_range_invalid' using errcode = '22023';
    end if;

    with visible_classes as materialized (
      select class.id, class.name, class.subject, class.teacher, class.room,
        class.schedule, class.student_ids,
        pg_catalog.jsonb_build_object(
          'id', class.id,
          'name', class.name,
          'subject', class.subject,
          'teacher', class.teacher,
          'room', class.room,
          'schedule', class.schedule
        ) as slot_input
      from public.classes class
      where dashboard_private.dashboard_statistics_class_active_v1(
        class.status,
        class.start_date::text,
        class.end_date::text
      )
    ),
    slots as materialized (
      select class.id, class.name, class.subject, class.student_ids,
        slot.weekday, slot.slot_start, slot.slot_end,
        slot.teacher_name, slot.classroom_name
      from visible_classes class
      cross join lateral dashboard_private.dashboard_conflict_class_slots_v1(class.slot_input) slot
    ),
    overlap_pairs as materialized (
      select
        left_slot.id as left_id,
        right_slot.id as right_id,
        left_slot.name as left_name,
        right_slot.name as right_name,
        left_slot.subject as left_subject,
        right_slot.subject as right_subject,
        left_slot.student_ids as left_student_ids,
        right_slot.student_ids as right_student_ids,
        left_slot.weekday,
        greatest(left_slot.slot_start, right_slot.slot_start) as overlap_start,
        least(left_slot.slot_end, right_slot.slot_end) as overlap_end,
        nullif(left_slot.teacher_name, '') as left_teacher_name,
        nullif(right_slot.teacher_name, '') as right_teacher_name,
        nullif(left_slot.classroom_name, '') as left_classroom_name,
        nullif(right_slot.classroom_name, '') as right_classroom_name
      from slots left_slot
      join slots right_slot on left_slot.id < right_slot.id
        and left_slot.weekday = right_slot.weekday
        and greatest(left_slot.slot_start, right_slot.slot_start)
          < least(left_slot.slot_end, right_slot.slot_end)
    ),
    teacher_rows as (
      select distinct pg_catalog.jsonb_build_object(
        'key', 'weekly:v1:teacher:' || pair.weekday || ':' || pair.overlap_start || '-' || pair.overlap_end
          || ':' || pair.left_id::text || ':' || pair.right_id::text,
        'type', 'teacher',
        'occurrenceKind', 'weekly',
        'title', '선생님 일정 충돌',
        'nextOccurrenceAt', '',
        'recurrenceDay', pair.weekday,
        'problem', pair.left_teacher_name || ' 선생님이 ' || pair.left_name || ', ' || pair.right_name || ' 수업을 동시에 담당합니다.',
        'ownerLabel', pair.left_teacher_name,
        'resolution', '한 수업의 시간 또는 대체 선생님 확정',
        'classIds', pg_catalog.jsonb_build_array(pair.left_id, pair.right_id),
        'classNames', pg_catalog.jsonb_build_array(pair.left_name, pair.right_name),
        'affectedStudentIds', dashboard_private.dashboard_statistics_unique_text_jsonb_v1(pair.left_student_ids, pair.right_student_ids),
        'subject', case when dashboard_private.dashboard_statistics_subject_key_v1(pair.left_subject) = dashboard_private.dashboard_statistics_subject_key_v1(pair.right_subject) then pair.left_subject else '' end,
        'campus', '',
        'primaryAssigneeProfileId', '',
        'secondaryAssigneeProfileId', '',
        'assigneeTeam', '관리팀',
        'source', pg_catalog.jsonb_build_object(
          'classIds', pg_catalog.jsonb_build_array(pair.left_id, pair.right_id),
          'studentIds', '[]'::jsonb,
          'examEventIds', '[]'::jsonb,
          'examDetailIds', '[]'::jsonb,
          'teacherCatalogIds', '[]'::jsonb,
          'classroomCatalogIds', '[]'::jsonb,
          'weekday', pair.weekday,
          'overlapStart', pair.overlap_start,
          'overlapEnd', pair.overlap_end,
          'examDate', '',
          'examRule', ''
        )
      ) as row_value,
      pair.weekday, pair.overlap_start, pair.left_id, pair.right_id
      from overlap_pairs pair
      where pair.left_teacher_name is not null
        and pair.left_teacher_name = pair.right_teacher_name
    ),
    classroom_rows as (
      select distinct pg_catalog.jsonb_build_object(
        'key', 'weekly:v1:classroom:' || pair.weekday || ':' || pair.overlap_start || '-' || pair.overlap_end
          || ':' || pair.left_id::text || ':' || pair.right_id::text,
        'type', 'classroom',
        'occurrenceKind', 'weekly',
        'title', '강의실 일정 충돌',
        'nextOccurrenceAt', '',
        'recurrenceDay', pair.weekday,
        'problem', pair.left_classroom_name || '에 ' || pair.left_name || ', ' || pair.right_name || ' 수업이 동시에 배정되어 있습니다.',
        'ownerLabel', '관리팀',
        'resolution', '한 수업의 강의실 또는 시간 변경',
        'classIds', pg_catalog.jsonb_build_array(pair.left_id, pair.right_id),
        'classNames', pg_catalog.jsonb_build_array(pair.left_name, pair.right_name),
        'affectedStudentIds', dashboard_private.dashboard_statistics_unique_text_jsonb_v1(pair.left_student_ids, pair.right_student_ids),
        'subject', case when dashboard_private.dashboard_statistics_subject_key_v1(pair.left_subject) = dashboard_private.dashboard_statistics_subject_key_v1(pair.right_subject) then pair.left_subject else '' end,
        'campus', '',
        'primaryAssigneeProfileId', '',
        'secondaryAssigneeProfileId', '',
        'assigneeTeam', '관리팀',
        'source', pg_catalog.jsonb_build_object(
          'classIds', pg_catalog.jsonb_build_array(pair.left_id, pair.right_id),
          'studentIds', '[]'::jsonb,
          'examEventIds', '[]'::jsonb,
          'examDetailIds', '[]'::jsonb,
          'teacherCatalogIds', '[]'::jsonb,
          'classroomCatalogIds', '[]'::jsonb,
          'weekday', pair.weekday,
          'overlapStart', pair.overlap_start,
          'overlapEnd', pair.overlap_end,
          'examDate', '',
          'examRule', ''
        )
      ) as row_value,
      pair.weekday, pair.overlap_start, pair.left_id, pair.right_id
      from overlap_pairs pair
      where pair.left_classroom_name is not null
        and pair.left_classroom_name = pair.right_classroom_name
    ),
    session_rows as materialized (
      select class.id as class_id, class.name as class_name, class.subject,
        class.student_ids, session.session_date
      from visible_classes class
      join public.list_dashboard_class_session_dates_v1(range_from, range_to) session
        on session.class_id = class.id
    ),
    enrolled_sessions as materialized (
      select distinct
        session.class_id,
        session.class_name,
        session.subject,
        session.session_date,
        student.id as student_id,
        student.grade as student_grade,
        school.id as school_id
      from session_rows session
      cross join lateral (
        select distinct element.value as student_id
        from pg_catalog.jsonb_array_elements_text(coalesce(session.student_ids, '[]'::jsonb)) element(value)
      ) enrolled
      join public.students student on student.id::text = enrolled.student_id
      join public.academic_schools school
        on pg_catalog.lower(pg_catalog.regexp_replace(school.name, '\s+', '', 'g'))
          = pg_catalog.lower(pg_catalog.regexp_replace(student.school, '\s+', '', 'g'))
    ),
    student_exam_context as materialized (
      select distinct session.student_id, session.student_grade, session.school_id
      from enrolled_sessions session
    ),
    modern_exam_sources as materialized (
      select
        student.student_id,
        detail.exam_date,
        dashboard_private.dashboard_statistics_subject_key_v1(detail.subject) as subject_key,
        detail.academic_event_id,
        detail.id as exam_detail_id
      from public.academic_event_exam_details detail
      left join public.academic_events event on event.id = detail.academic_event_id
      join student_exam_context student
        on coalesce(detail.school_id, event.school_id) = student.school_id
        and dashboard_private.dashboard_statistics_exam_grade_matches_student_v1(
          coalesce(
            nullif(pg_catalog.btrim(detail.grade), ''),
            nullif(pg_catalog.btrim(event.grade), ''),
            'all'
          ),
          student.student_grade
        )
      where detail.exam_date is not null
        and nullif(dashboard_private.dashboard_statistics_subject_key_v1(detail.subject), '') is not null
      union all
      select
        student.student_id,
        event.date as exam_date,
        dashboard_private.dashboard_statistics_subject_key_v1(
          dashboard_private.dashboard_conflict_subject_from_event_v1(pg_catalog.to_jsonb(event))
        ) as subject_key,
        event.id as academic_event_id,
        null::uuid as exam_detail_id
      from public.academic_events event
      join student_exam_context student
        on event.school_id = student.school_id
        and dashboard_private.dashboard_statistics_exam_grade_matches_student_v1(
          coalesce(nullif(pg_catalog.btrim(event.grade), ''), 'all'),
          student.student_grade
        )
      where dashboard_private.dashboard_conflict_event_type_v1(pg_catalog.to_jsonb(event))
          in ('영어시험일', '수학시험일', '과학시험일')
        and event.date is not null
    ),
    fallback_exam_sources as materialized (
      select
        student.student_id,
        exam_day.exam_date,
        dashboard_private.dashboard_statistics_subject_key_v1(exam_day.subject) as subject_key,
        null::uuid as academic_event_id,
        null::uuid as exam_detail_id
      from public.academic_exam_days exam_day
      join student_exam_context student
        on exam_day.school_id = student.school_id
        and dashboard_private.dashboard_statistics_exam_grade_matches_student_v1(
          coalesce(nullif(pg_catalog.btrim(exam_day.grade), ''), 'all'),
          student.student_grade
        )
      where exam_day.exam_date is not null
        and nullif(dashboard_private.dashboard_statistics_subject_key_v1(exam_day.subject), '') is not null
        and not exists (
          select 1
          from modern_exam_sources modern_source
          where modern_source.student_id = student.student_id
            and modern_source.exam_date = exam_day.exam_date
        )
    ),
    student_exam_sources as materialized (
      select source.* from modern_exam_sources source
      union all
      select source.* from fallback_exam_sources source
    ),
    exam_matches as materialized (
      select
        'exam:v1:' || session.class_id::text || ':' || source.exam_date::text || ':'
          || case
            when session.session_date = source.exam_date then 'same-day-subject'
            else 'day-before-other-subject'
          end as conflict_key,
        case
          when session.session_date = source.exam_date then 'same-day-subject'
          else 'day-before-other-subject'
        end as exam_rule,
        session.session_date,
        session.class_id,
        session.class_name,
        session.subject,
        session.student_id,
        source.exam_date,
        source.academic_event_id,
        source.exam_detail_id
      from enrolled_sessions session
      join student_exam_sources source on source.student_id = session.student_id
        and (
          (
            source.exam_date = session.session_date
            and source.subject_key = dashboard_private.dashboard_statistics_subject_key_v1(session.subject)
          )
          or (
            session.session_date = source.exam_date - 1
            and source.subject_key <> dashboard_private.dashboard_statistics_subject_key_v1(session.subject)
            and not exists (
              select 1
              from student_exam_sources same_subject_source
              where same_subject_source.student_id = session.student_id
                and same_subject_source.exam_date = source.exam_date
                and same_subject_source.subject_key
                  = dashboard_private.dashboard_statistics_subject_key_v1(session.subject)
            )
          )
        )
    ),
    exam_grouped as materialized (
      select
        conflict_key,
        exam_rule,
        pg_catalog.min(session_date) as session_date,
        class_id,
        pg_catalog.min(class_name) as class_name,
        pg_catalog.min(subject) as subject,
        exam_date,
        dashboard_private.dashboard_statistics_unique_text_jsonb_v1(
          pg_catalog.jsonb_agg(distinct student_id::text)
        ) as affected_student_ids,
        dashboard_private.dashboard_statistics_unique_text_jsonb_v1(
          pg_catalog.jsonb_agg(distinct academic_event_id::text) filter (where academic_event_id is not null)
        ) as exam_event_ids,
        dashboard_private.dashboard_statistics_unique_text_jsonb_v1(
          pg_catalog.jsonb_agg(distinct exam_detail_id::text)
        ) as exam_detail_ids
      from exam_matches
      group by conflict_key, exam_rule, class_id, exam_date
    ),
    exam_rows as (
      select pg_catalog.jsonb_build_object(
        'key', conflict.conflict_key,
        'type', 'exam',
        'occurrenceKind', 'dated',
        'title', '시험 일정 충돌',
        'nextOccurrenceAt', conflict.session_date::text || 'T00:00:00+09:00',
        'problem', case conflict.exam_rule
          when 'same-day-subject' then conflict.class_name || ' 수업이 해당 과목 시험일과 겹칩니다.'
          else conflict.class_name || ' 수업이 다른 과목 시험 전날과 겹칩니다.'
        end,
        'ownerLabel', '담당 선생님',
        'resolution', '수업일 변경 또는 휴강·보강 확정 후 학생·보호자 안내',
        'classIds', pg_catalog.jsonb_build_array(conflict.class_id),
        'classNames', pg_catalog.jsonb_build_array(conflict.class_name),
        'affectedStudentIds', conflict.affected_student_ids,
        'subject', conflict.subject,
        'campus', '',
        'primaryAssigneeProfileId', '',
        'secondaryAssigneeProfileId', '',
        'assigneeTeam', '관리팀',
        'source', pg_catalog.jsonb_build_object(
          'classIds', pg_catalog.jsonb_build_array(conflict.class_id),
          'studentIds', conflict.affected_student_ids,
          'examEventIds', conflict.exam_event_ids,
          'examDetailIds', conflict.exam_detail_ids,
          'teacherCatalogIds', '[]'::jsonb,
          'classroomCatalogIds', '[]'::jsonb,
          'weekday', '',
          'overlapStart', '',
          'overlapEnd', '',
          'examDate', conflict.exam_date,
          'examRule', conflict.exam_rule
        )
      ) as row_value,
      conflict.session_date, conflict.class_id, conflict.conflict_key
      from exam_grouped conflict
    )
    select pg_catalog.jsonb_build_object(
      'range', pg_catalog.jsonb_build_object('dateFrom', range_from, 'dateTo', range_to),
      'teacherConflicts', coalesce((select pg_catalog.jsonb_agg(row_value order by weekday, overlap_start, left_id, right_id) from teacher_rows), '[]'::jsonb),
      'classroomConflicts', coalesce((select pg_catalog.jsonb_agg(row_value order by weekday, overlap_start, left_id, right_id) from classroom_rows), '[]'::jsonb),
      'examConflicts', coalesce((select pg_catalog.jsonb_agg(row_value order by session_date, class_id, conflict_key) from exam_rows), '[]'::jsonb)
    ) into result;
    return result;
  end if;

  if normalized_subject <> all(array['all', 'english', 'math', 'science'])
    or p_division is not null then
    raise exception 'dashboard_statistics_request_invalid' using errcode = '22023';
  end if;
  range_to := coalesce(p_date_to, local_today);
  range_from := coalesce(p_date_from, local_today - 89);
  if (p_date_from is null) <> (p_date_to is null)
    or range_to < range_from
    or ((range_to - range_from) + 1) <> all(array[30, 90, 180, 365]) then
    raise exception 'dashboard_statistics_date_range_invalid' using errcode = '22023';
  end if;

  with visible_classes as materialized (
    select class.id, class.subject, class.textbook_ids
    from public.classes class
    where dashboard_private.dashboard_statistics_class_active_v1(
      class.status,
      class.start_date::text,
      class.end_date::text
    )
      and (
        normalized_subject = 'all'
        or dashboard_private.dashboard_statistics_subject_key_v1(class.subject) = normalized_subject
      )
  ),
  visible_textbooks as materialized (
    select textbook.id
    from public.textbooks textbook
    where dashboard_private.dashboard_statistics_textbook_active_v1(textbook.status)
      and (
        normalized_subject = 'all'
        or dashboard_private.dashboard_statistics_subject_key_v1(textbook.subject) = normalized_subject
      )
  ),
  visible_progress as materialized (
    select progress.status
    from public.progress_logs progress
    join visible_classes class on class.id = progress.class_id
    where progress.updated_at >= range_from::timestamp at time zone 'Asia/Seoul'
      and progress.updated_at < (range_to + 1)::timestamp at time zone 'Asia/Seoul'
  )
  select pg_catalog.jsonb_build_object(
    'range', pg_catalog.jsonb_build_object('dateFrom', range_from, 'dateTo', range_to),
    'activeTitles', (select pg_catalog.count(*)::integer from visible_textbooks),
    'activeClassesWithTextbook', (select pg_catalog.count(*)::integer from visible_classes class where pg_catalog.jsonb_array_length(coalesce(class.textbook_ids, '[]'::jsonb)) > 0),
    'activeClassesWithoutTextbook', (select pg_catalog.count(*)::integer from visible_classes class where pg_catalog.jsonb_array_length(coalesce(class.textbook_ids, '[]'::jsonb)) = 0),
    'progressSessions', pg_catalog.jsonb_build_object(
      'pending', (select pg_catalog.count(*)::integer from visible_progress where status = 'pending'),
      'partial', (select pg_catalog.count(*)::integer from visible_progress where status = 'partial'),
      'done', (select pg_catalog.count(*)::integer from visible_progress where status = 'done')
    ),
    'updatedProgressSessions', (select pg_catalog.count(*)::integer from visible_progress)
  ) into result;
  return result;
end;
$function$;

commit;
