begin;

create schema if not exists dashboard_private;

create collation if not exists dashboard_private.ko_numeric (
  provider = icu,
  locale = 'ko-u-kn-true',
  deterministic = true
);

do $guard$
declare
  collation_row record;
  collation_locale text;
begin
  select catalog_collation.*
  into collation_row
  from pg_catalog.pg_collation catalog_collation
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = catalog_collation.collnamespace
  where namespace_row.nspname = 'dashboard_private'
    and catalog_collation.collname = 'ko_numeric';

  collation_locale := coalesce(
    pg_catalog.to_jsonb(collation_row) ->> 'colllocale',
    pg_catalog.to_jsonb(collation_row) ->> 'colliculocale',
    pg_catalog.to_jsonb(collation_row) ->> 'collcollate'
  );

  if not found
    or collation_row.collprovider <> 'i'
    or not collation_row.collisdeterministic
    or collation_locale <> 'ko-u-kn-true' then
    raise exception 'dashboard_ko_numeric_collation_invalid'
      using errcode = '55000';
  end if;
end;
$guard$;

create or replace function dashboard_private.dashboard_statistics_normalized_name_v1(
  p_value text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    nullif(
      pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '\s+', ' ', 'g'),
      ''
    ),
    pg_catalog.chr(1114111)
  );
$function$;

create or replace function dashboard_private.dashboard_statistics_subject_key_v1(
  p_value text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
    when '영어' then 'english'
    when 'english' then 'english'
    when '수학' then 'math'
    when 'math' then 'math'
    when '과학' then 'science'
    when 'science' then 'science'
    else pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
  end;
$function$;

create or replace function dashboard_private.dashboard_statistics_class_active_v1(
  p_status text,
  p_start_date text,
  p_end_date text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  status_value text := pg_catalog.btrim(coalesce(p_status, ''));
  local_today date := (pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date;
  start_value date;
  end_value date;
begin
  if status_value in ('개강', '수업 진행 중', '수강') then
    return true;
  end if;
  if status_value in ('개강 예정', '개강 준비 중', '개강 준비', '종강') then
    return false;
  end if;

  begin
    start_value := nullif(p_start_date, '')::date;
    end_value := nullif(p_end_date, '')::date;
  exception when others then
    return false;
  end;

  return (start_value is null or start_value <= local_today)
    and (end_value is null or end_value >= local_today);
end;
$function$;

create or replace function dashboard_private.dashboard_statistics_division_label_matches_v1(
  p_value text,
  p_division text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  with normalized as (
    select pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(p_value, ''), '\s+', '', 'g')
    ) as label
  )
  select case
    when p_division = 'all' then true
    when p_division = 'high' then
      label like '%고%'
      or label like '%high%'
      or label ~ '^(g?(10|11|12)|grade(10|11|12))$'
    when p_division = 'middle' then
      label like '%초%'
      or label like '%중%'
      or label like '%elementary%'
      or label like '%middle%'
      or label ~ '^(g?[1-9]|grade[1-9])$'
    else false
  end
  from normalized;
$function$;

create or replace function dashboard_private.dashboard_statistics_schedule_day_count_v1(
  p_schedule text
)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(pg_catalog.sum(pg_catalog.char_length(day_match[1])), 0)::integer
  from pg_catalog.regexp_matches(
    coalesce(p_schedule, ''),
    '([월화수목금토일]+)',
    'g'
  ) day_match;
$function$;

create or replace function dashboard_private.dashboard_statistics_weekly_minutes_v1(
  p_schedule text
)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $function$
  with parsed_slots as (
    select slot_match
    from pg_catalog.regexp_matches(
      coalesce(p_schedule, ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})',
      'g'
    ) slot_match
  ), parsed_total as (
    select coalesce(pg_catalog.sum(
      dashboard_private.dashboard_statistics_schedule_day_count_v1(slot_match[1])
        * pg_catalog.greatest(
          0,
          pg_catalog.split_part(slot_match[3], ':', 1)::integer * 60
            + pg_catalog.split_part(slot_match[3], ':', 2)::integer
            - pg_catalog.split_part(slot_match[2], ':', 1)::integer * 60
            - pg_catalog.split_part(slot_match[2], ':', 2)::integer
        )
    ), 0)::integer as minutes,
    pg_catalog.count(*) as slot_count
    from parsed_slots
  ), fallback_total as (
    select coalesce(pg_catalog.sum(pg_catalog.greatest(
      0,
      pg_catalog.split_part(time_match[2], ':', 1)::integer * 60
        + pg_catalog.split_part(time_match[2], ':', 2)::integer
        - pg_catalog.split_part(time_match[1], ':', 1)::integer * 60
        - pg_catalog.split_part(time_match[1], ':', 2)::integer
    )), 0)::integer as minutes
    from pg_catalog.regexp_matches(
      coalesce(p_schedule, ''),
      '([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})',
      'g'
    ) time_match
  )
  select case when parsed_total.slot_count > 0
    then parsed_total.minutes
    else fallback_total.minutes
  end
  from parsed_total cross join fallback_total;
$function$;

create or replace function dashboard_private.dashboard_statistics_textbook_active_v1(
  p_status text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, 'active')))
    when 'active' then true
    when '사용중' then true
    when 'inactive' then false
    when '미사용' then false
    else false
  end;
$function$;

create or replace function dashboard_private.dashboard_statistics_hours_label_v1(
  p_minutes integer
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.greatest(coalesce(p_minutes, 0), 0) >= 60
      and pg_catalog.mod(pg_catalog.greatest(coalesce(p_minutes, 0), 0), 60) > 0
      then (pg_catalog.greatest(coalesce(p_minutes, 0), 0) / 60)::text
        || '시간 '
        || pg_catalog.mod(pg_catalog.greatest(coalesce(p_minutes, 0), 0), 60)::text
        || '분'
    when pg_catalog.greatest(coalesce(p_minutes, 0), 0) >= 60
      then (pg_catalog.greatest(coalesce(p_minutes, 0), 0) / 60)::text || '시간'
    else pg_catalog.greatest(coalesce(p_minutes, 0), 0)::text || '분'
  end;
$function$;

create or replace function dashboard_private.dashboard_statistics_unique_text_jsonb_v1(
  p_left jsonb,
  p_right jsonb default '[]'::jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(item.value order by item.value),
    '[]'::jsonb
  )
  from (
    select distinct element.value
    from pg_catalog.jsonb_array_elements_text(
      coalesce(p_left, '[]'::jsonb) || coalesce(p_right, '[]'::jsonb)
    ) element(value)
    where nullif(pg_catalog.btrim(element.value), '') is not null
  ) item;
$function$;

create or replace function dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(
  p_values jsonb
)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.count(distinct element.value)::integer
  from pg_catalog.jsonb_array_elements_text(coalesce(p_values, '[]'::jsonb)) element(value)
  where nullif(pg_catalog.btrim(element.value), '') is not null;
$function$;

create or replace function dashboard_private.dashboard_statistics_inferred_grade_labels_v1(
  p_direct text,
  p_name text,
  p_student_grades text[]
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  direct_labels text[];
  name_labels text[];
  student_labels text[];
begin
  select coalesce(pg_catalog.array_agg(distinct label order by label), array[]::text[])
  into direct_labels
  from (
    select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(value), '\s+', '', 'g'), '') as label
    from pg_catalog.regexp_split_to_table(coalesce(p_direct, ''), '[,/&·\n]+') value
  ) values_row
  where label is not null;

  select coalesce(pg_catalog.array_agg(distinct label order by label), array[]::text[])
  into name_labels
  from (
    select pg_catalog.regexp_replace(match_row[1], '\s+', '', 'g') as label
    from pg_catalog.regexp_matches(coalesce(p_name, ''), '([초중고]\s*[1-6])', 'gi') match_row
    union all
    select 'Grade' || match_row[1]
    from pg_catalog.regexp_matches(coalesce(p_name, ''), '(?:grade|g)\s*(1[0-2]|[1-9])', 'gi') match_row
  ) values_row;

  select coalesce(pg_catalog.array_agg(distinct label order by label), array[]::text[])
  into student_labels
  from (
    select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(value), '\s+', '', 'g'), '') as label
    from pg_catalog.unnest(coalesce(p_student_grades, array[]::text[])) value
  ) values_row
  where label is not null;

  return case
    when pg_catalog.cardinality(direct_labels) > 0 then direct_labels
    when pg_catalog.cardinality(name_labels) > 0 then name_labels
    when pg_catalog.cardinality(student_labels) > 0 then student_labels
    else array['미정']::text[]
  end;
end;
$function$;

create or replace function dashboard_private.get_dashboard_statistics_students_classes_v1(
  p_subject text,
  p_division text,
  p_include_breakdowns boolean
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with visible_students as materialized (
    select student.id, student.school, student.grade
    from public.students student
  ),
  candidate_classes as materialized (
    select
      class.id,
      class.name,
      class.subject,
      class.grade,
      class.teacher,
      class.room,
      class.schedule,
      class.student_ids,
      class.waitlist_ids,
      class.textbook_ids,
      class.status,
      class.start_date,
      class.end_date,
      dashboard_private.dashboard_statistics_inferred_grade_labels_v1(
        class.grade,
        class.name,
        array(
          select student.grade
          from visible_students student
          where coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
        )
      ) as grade_labels
    from public.classes class
    where dashboard_private.dashboard_statistics_class_active_v1(
      class.status,
      class.start_date::text,
      class.end_date::text
    )
      and (
        p_subject = 'all'
        or dashboard_private.dashboard_statistics_subject_key_v1(class.subject) = p_subject
      )
  ),
  visible_classes as materialized (
    select candidate.*
    from candidate_classes candidate
    where p_division = 'all'
      or exists (
        select 1
        from pg_catalog.unnest(candidate.grade_labels) grade_label
        where dashboard_private.dashboard_statistics_division_label_matches_v1(grade_label, p_division)
      )
  ),
  registered_enrollments as materialized (
    select
      class.id as class_id,
      class.grade as class_grade,
      class.teacher,
      class.room,
      class.schedule,
      student.id as student_id,
      coalesce(nullif(pg_catalog.btrim(student.grade), ''), '미정') as grade_label,
      coalesce(nullif(pg_catalog.btrim(student.school), ''), '미정') as school_label
    from visible_classes class
    cross join lateral (
      select distinct element.value as student_id
      from pg_catalog.jsonb_array_elements_text(coalesce(class.student_ids, '[]'::jsonb)) element(value)
    ) enrolled
    join visible_students student on student.id::text = enrolled.student_id
  ),
  registered_ids as (
    select distinct class.id as class_id, enrolled.student_id
    from visible_classes class
    cross join lateral pg_catalog.jsonb_array_elements_text(
      coalesce(class.student_ids, '[]'::jsonb)
    ) enrolled(student_id)
  ),
  waitlist_ids as (
    select distinct class.id as class_id, waitlisted.student_id
    from visible_classes class
    cross join lateral pg_catalog.jsonb_array_elements_text(
      coalesce(class.waitlist_ids, '[]'::jsonb)
    ) waitlisted(student_id)
  ),
  summary as (
    select
      (select pg_catalog.count(*)::integer from visible_classes) as active_classes_count,
      (select pg_catalog.count(*)::integer from registered_ids) as registered_enrollment_count,
      (select pg_catalog.count(*)::integer from waitlist_ids) as waitlist_enrollment_count,
      (select pg_catalog.count(distinct student_id)::integer from registered_ids) as unique_registered_student_count,
      (select pg_catalog.count(distinct student_id)::integer from waitlist_ids) as unique_waitlist_student_count,
      (select pg_catalog.count(distinct school_label)::integer from registered_enrollments) as school_count,
      (select pg_catalog.count(distinct grade_label)::integer from registered_enrollments) as grade_count,
      (select coalesce(pg_catalog.sum(
        dashboard_private.dashboard_statistics_weekly_minutes_v1(class.schedule)
      ), 0)::integer from visible_classes class) as weekly_minutes
  ),
  grade_school_counts as (
    select
      enrollment.grade_label,
      enrollment.school_label,
      pg_catalog.count(*)::integer as enrollment_count,
      pg_catalog.count(distinct enrollment.student_id)::integer as student_count
    from registered_enrollments enrollment
    group by enrollment.grade_label, enrollment.school_label
  ),
  grade_rows as (
    select
      enrollment.grade_label,
      pg_catalog.count(*)::integer as enrollment_count,
      pg_catalog.count(distinct enrollment.student_id)::integer as student_count,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', grade_school.school_label,
            'label', grade_school.school_label,
            'enrollmentCount', grade_school.enrollment_count,
            'studentCount', grade_school.student_count
          )
          order by grade_school.student_count desc,
            grade_school.enrollment_count desc,
            grade_school.school_label collate dashboard_private.ko_numeric
        )
        from grade_school_counts grade_school
        where grade_school.grade_label = enrollment.grade_label
      ) as children
    from registered_enrollments enrollment
    group by enrollment.grade_label
  ),
  school_grade_counts as (
    select
      enrollment.school_label,
      enrollment.grade_label,
      pg_catalog.count(*)::integer as enrollment_count,
      pg_catalog.count(distinct enrollment.student_id)::integer as student_count
    from registered_enrollments enrollment
    group by enrollment.school_label, enrollment.grade_label
  ),
  school_rows as (
    select
      enrollment.school_label,
      pg_catalog.count(*)::integer as enrollment_count,
      pg_catalog.count(distinct enrollment.student_id)::integer as student_count,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', school_grade.grade_label,
            'label', school_grade.grade_label,
            'enrollmentCount', school_grade.enrollment_count,
            'studentCount', school_grade.student_count
          )
          order by school_grade.student_count desc,
            school_grade.enrollment_count desc,
            school_grade.grade_label collate dashboard_private.ko_numeric
        )
        from school_grade_counts school_grade
        where school_grade.school_label = enrollment.school_label
      ) as children
    from registered_enrollments enrollment
    group by enrollment.school_label
  ),
  class_axis_rows as (
    select
      'grade'::text as axis,
      grade_label as label,
      class.id,
      dashboard_private.dashboard_statistics_weekly_minutes_v1(class.schedule) as weekly_minutes,
      dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(class.student_ids) as enrollment_count
    from visible_classes class
    cross join lateral pg_catalog.unnest(class.grade_labels) grade_label
    union all
    select
      'teacher',
      coalesce(nullif(pg_catalog.btrim(teacher_label), ''), '미정'),
      class.id,
      dashboard_private.dashboard_statistics_weekly_minutes_v1(class.schedule),
      dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(class.student_ids)
    from visible_classes class
    cross join lateral pg_catalog.regexp_split_to_table(
      coalesce(class.teacher, ''), '[,/&·\n]+'
    ) teacher_label
    union all
    select
      'classroom',
      coalesce(nullif(pg_catalog.btrim(classroom_label), ''), '미정'),
      class.id,
      dashboard_private.dashboard_statistics_weekly_minutes_v1(class.schedule),
      dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(class.student_ids)
    from visible_classes class
    cross join lateral pg_catalog.regexp_split_to_table(
      coalesce(class.room, ''), '[,/&·\n]+'
    ) classroom_label
  ),
  class_group_base as (
    select
      axis_row.axis,
      axis_row.label,
      pg_catalog.count(distinct axis_row.id)::integer as class_count,
      pg_catalog.sum(axis_row.enrollment_count)::integer as enrollment_count,
      pg_catalog.sum(axis_row.weekly_minutes)::integer as weekly_minutes
    from class_axis_rows axis_row
    group by axis_row.axis, axis_row.label
  ),
  class_group_students as (
    select axis_row.axis, axis_row.label,
      pg_catalog.count(distinct enrollment.student_id)::integer as student_count
    from class_axis_rows axis_row
    left join registered_enrollments enrollment on enrollment.class_id = axis_row.id
    group by axis_row.axis, axis_row.label
  ),
  class_group_rows as (
    select base.axis, base.label, base.class_count,
      coalesce(student_count.student_count, 0)::integer as student_count,
      base.enrollment_count, base.weekly_minutes
    from class_group_base base
    left join class_group_students student_count
      on student_count.axis = base.axis and student_count.label = base.label
  )
  select pg_catalog.jsonb_build_object(
    'summary', pg_catalog.jsonb_build_object(
      'activeClassesCount', summary.active_classes_count,
      'registeredEnrollmentCount', summary.registered_enrollment_count,
      'waitlistEnrollmentCount', summary.waitlist_enrollment_count,
      'uniqueRegisteredStudentCount', summary.unique_registered_student_count,
      'uniqueWaitlistStudentCount', summary.unique_waitlist_student_count,
      'schoolCount', summary.school_count,
      'gradeCount', summary.grade_count,
      'weeklyMinutes', summary.weekly_minutes,
      'weeklyHoursLabel', dashboard_private.dashboard_statistics_hours_label_v1(summary.weekly_minutes)
    )
  ) || case when p_include_breakdowns then pg_catalog.jsonb_build_object(
    'studentBreakdowns', pg_catalog.jsonb_build_object(
      'byGrade', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', grade.label,
            'label', grade.label,
            'enrollmentCount', grade.enrollment_count,
            'studentCount', grade.student_count,
            'children', grade.children
          )
          order by grade.student_count desc,
            grade.enrollment_count desc,
            grade.label collate dashboard_private.ko_numeric
        )
        from (
          select grade_row.grade_label as label, grade_row.* from grade_rows grade_row
        ) grade
      ), '[]'::jsonb),
      'bySchool', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', school.label,
            'label', school.label,
            'enrollmentCount', school.enrollment_count,
            'studentCount', school.student_count,
            'children', school.children
          )
          order by school.student_count desc,
            school.enrollment_count desc,
            school.label collate dashboard_private.ko_numeric
        )
        from (
          select school_row.school_label as label, school_row.* from school_rows school_row
        ) school
      ), '[]'::jsonb)
    ),
    'classGroups', pg_catalog.jsonb_build_object(
      'byGrade', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', group_row.label,
            'label', group_row.label,
            'classCount', group_row.class_count,
            'studentCount', group_row.student_count,
            'enrollmentCount', group_row.enrollment_count,
            'weeklyMinutes', group_row.weekly_minutes,
            'weeklyHoursLabel', dashboard_private.dashboard_statistics_hours_label_v1(group_row.weekly_minutes)
          ) order by group_row.class_count desc, group_row.label collate dashboard_private.ko_numeric
        ) from class_group_rows group_row where group_row.axis = 'grade'
      ), '[]'::jsonb),
      'byTeacher', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', group_row.label,
            'label', group_row.label,
            'classCount', group_row.class_count,
            'studentCount', group_row.student_count,
            'enrollmentCount', group_row.enrollment_count,
            'weeklyMinutes', group_row.weekly_minutes,
            'weeklyHoursLabel', dashboard_private.dashboard_statistics_hours_label_v1(group_row.weekly_minutes)
          ) order by group_row.class_count desc, group_row.label collate dashboard_private.ko_numeric
        ) from class_group_rows group_row where group_row.axis = 'teacher'
      ), '[]'::jsonb),
      'byClassroom', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', group_row.label,
            'label', group_row.label,
            'classCount', group_row.class_count,
            'studentCount', group_row.student_count,
            'enrollmentCount', group_row.enrollment_count,
            'weeklyMinutes', group_row.weekly_minutes,
            'weeklyHoursLabel', dashboard_private.dashboard_statistics_hours_label_v1(group_row.weekly_minutes)
          ) order by group_row.class_count desc, group_row.label collate dashboard_private.ko_numeric
        ) from class_group_rows group_row where group_row.axis = 'classroom'
      ), '[]'::jsonb)
    )
  ) else '{}'::jsonb end
  from summary;
$function$;

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
        pg_catalog.greatest(left_slot.slot_start, right_slot.slot_start) as overlap_start,
        pg_catalog.least(left_slot.slot_end, right_slot.slot_end) as overlap_end,
        nullif(left_slot.teacher_name, '') as left_teacher_name,
        nullif(right_slot.teacher_name, '') as right_teacher_name,
        nullif(left_slot.classroom_name, '') as left_classroom_name,
        nullif(right_slot.classroom_name, '') as right_classroom_name
      from slots left_slot
      join slots right_slot on left_slot.id < right_slot.id
        and left_slot.weekday = right_slot.weekday
        and pg_catalog.greatest(left_slot.slot_start, right_slot.slot_start)
          < pg_catalog.least(left_slot.slot_end, right_slot.slot_end)
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
          'studentIds', dashboard_private.dashboard_statistics_unique_text_jsonb_v1(pair.left_student_ids, pair.right_student_ids),
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
          'studentIds', dashboard_private.dashboard_statistics_unique_text_jsonb_v1(pair.left_student_ids, pair.right_student_ids),
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
    exam_matches as materialized (
      select
        'exam:v1:' || session.class_id::text || ':' || detail.exam_date::text || ':'
          || case
            when session.session_date = detail.exam_date then 'same-day-subject'
            else 'day-before-other-subject'
          end as conflict_key,
        case
          when session.session_date = detail.exam_date then 'same-day-subject'
          else 'day-before-other-subject'
        end as exam_rule,
        session.session_date,
        session.class_id,
        session.class_name,
        session.subject,
        student.id as student_id,
        detail.exam_date,
        detail.academic_event_id,
        detail.id as exam_detail_id
      from session_rows session
      cross join lateral (
        select distinct element.value as student_id
        from pg_catalog.jsonb_array_elements_text(coalesce(session.student_ids, '[]'::jsonb)) element(value)
      ) enrolled
      join public.students student on student.id::text = enrolled.student_id
      join public.academic_schools school
        on pg_catalog.lower(pg_catalog.regexp_replace(school.name, '\s+', '', 'g'))
          = pg_catalog.lower(pg_catalog.regexp_replace(student.school, '\s+', '', 'g'))
      join public.academic_event_exam_details detail
        on detail.school_id = school.id
        and (detail.grade is null or detail.grade in ('all', '전체') or detail.grade = student.grade)
        and (
          (
            detail.exam_date = session.session_date
            and dashboard_private.dashboard_statistics_subject_key_v1(detail.subject)
              = dashboard_private.dashboard_statistics_subject_key_v1(session.subject)
          )
          or (
            session.session_date = detail.exam_date - 1
            and dashboard_private.dashboard_statistics_subject_key_v1(detail.subject)
              <> dashboard_private.dashboard_statistics_subject_key_v1(session.subject)
            and not exists (
              select 1
              from public.academic_event_exam_details same_subject_detail
              where same_subject_detail.school_id = detail.school_id
                and same_subject_detail.exam_date = detail.exam_date
                and (
                  same_subject_detail.grade is null
                  or same_subject_detail.grade in ('all', '전체')
                  or same_subject_detail.grade = student.grade
                )
                and dashboard_private.dashboard_statistics_subject_key_v1(same_subject_detail.subject)
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

create or replace function public.list_dashboard_statistics_student_roster_v1(
  p_subject text,
  p_division text,
  p_axis text,
  p_key text,
  p_parent_key text,
  p_cursor_name text,
  p_cursor_id uuid,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if p_subject not in ('all', 'english', 'math', 'science')
    or p_division not in ('all', 'middle', 'high')
    or p_axis <> all(array['grade', 'school', 'grade_school', 'school_grade'])
    or nullif(pg_catalog.btrim(p_key), '') is null
    or (p_cursor_name is null) <> (p_cursor_id is null)
    or p_limit <> 30 then
    raise exception 'dashboard_statistics_drilldown_request_invalid' using errcode = '22023';
  end if;

  with visible_students as materialized (
    select student.id, student.grade
    from public.students student
  ),
  candidate_classes as materialized (
    select class.id, class.student_ids,
      dashboard_private.dashboard_statistics_inferred_grade_labels_v1(
        class.grade,
        class.name,
        array(
          select student.grade
          from visible_students student
          where coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
        )
      ) as grade_labels
    from public.classes class
    where dashboard_private.dashboard_statistics_class_active_v1(
      class.status,
      class.start_date::text,
      class.end_date::text
      )
      and (p_subject = 'all' or dashboard_private.dashboard_statistics_subject_key_v1(class.subject) = p_subject)
  ),
  visible_classes as materialized (
    select class.*
    from candidate_classes class
    where p_division = 'all'
      or exists (
        select 1 from pg_catalog.unnest(class.grade_labels) grade_label
        where dashboard_private.dashboard_statistics_division_label_matches_v1(grade_label, p_division)
      )
  ),
  matched as materialized (
    select distinct
      student.id,
      student.name,
      coalesce(student.school, '') as school,
      coalesce(student.grade, '') as grade,
      dashboard_private.dashboard_statistics_normalized_name_v1(student.name) as normalized_name
    from visible_classes class
    cross join lateral (
      select distinct element.value as student_id
      from pg_catalog.jsonb_array_elements_text(coalesce(class.student_ids, '[]'::jsonb)) element(value)
    ) enrolled
    join public.students student on student.id::text = enrolled.student_id
    where case p_axis
      when 'grade' then coalesce(nullif(pg_catalog.btrim(student.grade), ''), '미정') = p_key
      when 'school' then coalesce(nullif(pg_catalog.btrim(student.school), ''), '미정') = p_key
      when 'grade_school' then coalesce(nullif(pg_catalog.btrim(student.grade), ''), '미정') = p_parent_key
        and coalesce(nullif(pg_catalog.btrim(student.school), ''), '미정') = p_key
      when 'school_grade' then coalesce(nullif(pg_catalog.btrim(student.school), ''), '미정') = p_parent_key
        and coalesce(nullif(pg_catalog.btrim(student.grade), ''), '미정') = p_key
      else false
    end
      and (
        p_cursor_name is null
        or (
          dashboard_private.dashboard_statistics_normalized_name_v1(student.name) collate dashboard_private.ko_numeric,
          student.id
        ) > (
          dashboard_private.dashboard_statistics_normalized_name_v1(p_cursor_name) collate dashboard_private.ko_numeric,
          p_cursor_id
        )
      )
    order by normalized_name collate dashboard_private.ko_numeric, student.id
    limit 31
  ),
  page_rows as materialized (
    select matched.*
    from matched
    order by normalized_name collate dashboard_private.ko_numeric, id
    limit 30
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', id, 'name', name, 'school', school, 'grade', grade)
      order by normalized_name collate dashboard_private.ko_numeric, id
    ) from page_rows), '[]'::jsonb),
    'nextCursor', case when (select pg_catalog.count(*) from matched) > 30 then (
      select pg_catalog.jsonb_build_object('sortValue', normalized_name, 'id', id)
      from page_rows order by normalized_name collate dashboard_private.ko_numeric desc, id desc limit 1
    ) else null end,
    'hasMore', (select pg_catalog.count(*) from matched) > 30
  ) into result;
  return result;
end;
$function$;

create or replace function public.list_dashboard_statistics_class_group_v1(
  p_subject text,
  p_division text,
  p_axis text,
  p_key text,
  p_cursor_name text,
  p_cursor_id uuid,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if p_subject not in ('all', 'english', 'math', 'science')
    or p_division not in ('all', 'middle', 'high')
    or p_axis <> all(array['grade', 'teacher', 'classroom'])
    or nullif(pg_catalog.btrim(p_key), '') is null
    or (p_cursor_name is null) <> (p_cursor_id is null)
    or p_limit <> 30 then
    raise exception 'dashboard_statistics_drilldown_request_invalid' using errcode = '22023';
  end if;

  with visible_students as materialized (
    select student.id, student.grade
    from public.students student
  ),
  candidate_classes as materialized (
    select
      class.id,
      class.name as title,
      class.subject,
      class.schedule,
      class.teacher,
      class.room,
      class.student_ids,
      dashboard_private.dashboard_statistics_inferred_grade_labels_v1(
        class.grade,
        class.name,
        array(
          select student.grade
          from visible_students student
          where coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
        )
      ) as grade_labels,
      dashboard_private.dashboard_statistics_normalized_name_v1(class.name) as normalized_name
    from public.classes class
    where dashboard_private.dashboard_statistics_class_active_v1(
      class.status,
      class.start_date::text,
      class.end_date::text
    )
      and (p_subject = 'all' or dashboard_private.dashboard_statistics_subject_key_v1(class.subject) = p_subject)
  ),
  matching_classes as materialized (
    select class.*
    from candidate_classes class
    where (
        p_division = 'all'
        or exists (
          select 1 from pg_catalog.unnest(class.grade_labels) grade_label
          where dashboard_private.dashboard_statistics_division_label_matches_v1(grade_label, p_division)
        )
      )
      and case p_axis
        when 'grade' then p_key = any (class.grade_labels)
        when 'teacher' then exists (
          select 1 from pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), '[,/&·\n]+') label
          where coalesce(nullif(pg_catalog.btrim(label), ''), '미정') = p_key
        )
        when 'classroom' then exists (
          select 1 from pg_catalog.regexp_split_to_table(coalesce(class.room, ''), '[,/&·\n]+') label
          where coalesce(nullif(pg_catalog.btrim(label), ''), '미정') = p_key
        )
        else false
      end
      and (
        p_cursor_name is null
        or (
          class.normalized_name collate dashboard_private.ko_numeric,
          class.id
        ) > (
          dashboard_private.dashboard_statistics_normalized_name_v1(p_cursor_name) collate dashboard_private.ko_numeric,
          p_cursor_id
        )
      )
    order by normalized_name collate dashboard_private.ko_numeric, class.id
    limit 31
  ),
  page_rows as materialized (
    select matching.* from matching_classes matching
    order by normalized_name collate dashboard_private.ko_numeric, id limit 30
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', id,
        'title', title,
        'subject', subject,
        'scheduleLabel', coalesce(nullif(schedule, ''), '시간 미정'),
        'teacherLabel', coalesce(nullif(teacher, ''), '미정'),
        'classroomLabel', coalesce(nullif(room, ''), '미정'),
        'studentCount', dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(student_ids),
        'enrollmentCount', dashboard_private.dashboard_statistics_distinct_jsonb_count_v1(student_ids),
        'weeklyMinutes', dashboard_private.dashboard_statistics_weekly_minutes_v1(schedule),
        'weeklyHoursLabel', dashboard_private.dashboard_statistics_hours_label_v1(
          dashboard_private.dashboard_statistics_weekly_minutes_v1(schedule)
        )
      ) order by normalized_name collate dashboard_private.ko_numeric, id
    ) from page_rows), '[]'::jsonb),
    'nextCursor', case when (select pg_catalog.count(*) from matching_classes) > 30 then (
      select pg_catalog.jsonb_build_object('sortValue', normalized_name, 'id', id)
      from page_rows order by normalized_name collate dashboard_private.ko_numeric desc, id desc limit 1
    ) else null end,
    'hasMore', (select pg_catalog.count(*) from matching_classes) > 30
  ) into result;
  return result;
end;
$function$;

create or replace function public.list_dashboard_statistics_class_roster_v1(
  p_class_id uuid,
  p_cursor_name text,
  p_cursor_id uuid,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if p_class_id is null
    or (p_cursor_name is null) <> (p_cursor_id is null)
    or p_limit <> 30 then
    raise exception 'dashboard_statistics_drilldown_request_invalid' using errcode = '22023';
  end if;

  with matching_students as materialized (
    select
      student.id,
      student.name,
      coalesce(student.school, '') as school,
      coalesce(student.grade, '') as grade,
      dashboard_private.dashboard_statistics_normalized_name_v1(student.name) as normalized_name
    from public.classes class
    cross join lateral (
      select distinct element.value as student_id
      from pg_catalog.jsonb_array_elements_text(coalesce(class.student_ids, '[]'::jsonb)) element(value)
    ) enrolled
    join public.students student on student.id::text = enrolled.student_id
    where class.id = p_class_id
      and dashboard_private.dashboard_statistics_class_active_v1(
        class.status,
        class.start_date::text,
        class.end_date::text
      )
      and (
        p_cursor_name is null
        or (
          dashboard_private.dashboard_statistics_normalized_name_v1(student.name) collate dashboard_private.ko_numeric,
          student.id
        ) > (
          dashboard_private.dashboard_statistics_normalized_name_v1(p_cursor_name) collate dashboard_private.ko_numeric,
          p_cursor_id
        )
      )
    order by normalized_name collate dashboard_private.ko_numeric, student.id
    limit 31
  ),
  page_rows as materialized (
    select matching.* from matching_students matching
    order by normalized_name collate dashboard_private.ko_numeric, id limit 30
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', id, 'name', name, 'school', school, 'grade', grade)
      order by normalized_name collate dashboard_private.ko_numeric, id
    ) from page_rows), '[]'::jsonb),
    'nextCursor', case when (select pg_catalog.count(*) from matching_students) > 30 then (
      select pg_catalog.jsonb_build_object('sortValue', normalized_name, 'id', id)
      from page_rows order by normalized_name collate dashboard_private.ko_numeric desc, id desc limit 1
    ) else null end,
    'hasMore', (select pg_catalog.count(*) from matching_students) > 30
  ) into result;
  return result;
end;
$function$;

alter function public.get_dashboard_statistics_sources_v1(text, text, text, date, date)
  owner to postgres;
alter function public.list_dashboard_statistics_student_roster_v1(text, text, text, text, text, text, uuid, integer)
  owner to postgres;
alter function public.list_dashboard_statistics_class_group_v1(text, text, text, text, text, uuid, integer)
  owner to postgres;
alter function public.list_dashboard_statistics_class_roster_v1(uuid, text, uuid, integer)
  owner to postgres;

revoke all on function public.get_dashboard_statistics_sources_v1(text, text, text, date, date)
  from public, anon;
revoke all on function public.list_dashboard_statistics_student_roster_v1(text, text, text, text, text, text, uuid, integer)
  from public, anon;
revoke all on function public.list_dashboard_statistics_class_group_v1(text, text, text, text, text, uuid, integer)
  from public, anon;
revoke all on function public.list_dashboard_statistics_class_roster_v1(uuid, text, uuid, integer)
  from public, anon;

grant execute on function public.get_dashboard_statistics_sources_v1(text, text, text, date, date)
  to authenticated;
grant execute on function public.list_dashboard_statistics_student_roster_v1(text, text, text, text, text, text, uuid, integer)
  to authenticated;
grant execute on function public.list_dashboard_statistics_class_group_v1(text, text, text, text, text, uuid, integer)
  to authenticated;
grant execute on function public.list_dashboard_statistics_class_roster_v1(uuid, text, uuid, integer)
  to authenticated;

comment on function public.get_dashboard_statistics_sources_v1(text, text, text, date, date) is
  'Returns one RLS-visible aggregate statistics tab without roster or full source rows.';
comment on function public.list_dashboard_statistics_student_roster_v1(text, text, text, text, text, text, uuid, integer) is
  'Returns one uncached 30-student keyset page for an explicit statistics drilldown.';
comment on function public.list_dashboard_statistics_class_group_v1(text, text, text, text, text, uuid, integer) is
  'Returns one uncached 30-class keyset page without embedding any roster.';
comment on function public.list_dashboard_statistics_class_roster_v1(uuid, text, uuid, integer) is
  'Returns one uncached 30-student keyset page for one visible active class.';

commit;
