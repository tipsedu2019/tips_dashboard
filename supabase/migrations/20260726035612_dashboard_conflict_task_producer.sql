begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists dashboard_private.dashboard_conflict_task_links (
  conflict_key text primary key,
  task_id uuid not null unique references public.ops_tasks(id) on delete restrict,
  conflict_type text not null check (conflict_type in ('exam', 'teacher', 'classroom', 'student')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists dashboard_private.dashboard_conflict_verification_checkpoints (
  request_id uuid not null,
  phase text not null check (phase in ('before_source_lock', 'after_source_lock')),
  class_ids uuid[] not null,
  reached_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (request_id, phase)
);

create or replace function dashboard_private.dashboard_conflict_text_array_v1(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(value order by value),
    array[]::text[]
  )
  from (
    select distinct pg_catalog.btrim(item.value) as value
    from pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) item(value)
    where nullif(pg_catalog.btrim(item.value), '') is not null
  ) normalized;
$$;

create or replace function dashboard_private.dashboard_conflict_uuid_array_v1(p_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text[];
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(id order by id),
    array[]::text[]
  ) into v_result
  from (
    select distinct (pg_catalog.btrim(item.value)::uuid)::text as id
    from pg_catalog.jsonb_array_elements_text(p_value) item(value)
    where nullif(pg_catalog.btrim(item.value), '') is not null
  ) normalized;
  return v_result;
exception when invalid_text_representation then
  raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
end;
$$;

create or replace function dashboard_private.dashboard_conflict_normalize_time_v1(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(coalesce(p_value, ''));
  v_parts text[];
begin
  if v_value !~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  v_parts := pg_catalog.string_to_array(v_value, ':');
  return pg_catalog.lpad(v_parts[1], 2, '0') || ':' || v_parts[2];
end;
$$;

create or replace function dashboard_private.dashboard_conflict_normalize_subject_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))
    when 'english' then '영어'
    when 'math' then '수학'
    when 'science' then '과학'
    else pg_catalog.btrim(coalesce(p_value, ''))
  end;
$$;

create or replace function dashboard_private.dashboard_conflict_event_type_v1(p_event jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case pg_catalog.btrim(coalesce(p_event ->> 'type', p_event ->> 'typeLabel', p_event ->> 'type_label', ''))
    when '시험' then '시험기간'
    when '모의고사' then '시험기간'
    when '영어 시험일 및 시험범위' then '영어시험일'
    when '수학 시험일 및 시험범위' then '수학시험일'
    when '과학 시험일 및 시험범위' then '과학시험일'
    else pg_catalog.btrim(coalesce(p_event ->> 'type', p_event ->> 'typeLabel', p_event ->> 'type_label', ''))
  end;
$$;

create or replace function dashboard_private.dashboard_conflict_subject_from_event_v1(p_event jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case dashboard_private.dashboard_conflict_event_type_v1(p_event)
    when '영어시험일' then '영어'
    when '수학시험일' then '수학'
    when '과학시험일' then '과학'
    else dashboard_private.dashboard_conflict_normalize_subject_v1(p_event ->> 'subject')
  end;
$$;

create or replace function dashboard_private.dashboard_conflict_event_date_v1(p_event jsonb)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := coalesce(
    nullif(p_event ->> 'exam_date', ''),
    nullif(p_event ->> 'examDate', ''),
    nullif(p_event ->> 'start_date', ''),
    nullif(p_event ->> 'start', ''),
    nullif(p_event ->> 'date', '')
  );
begin
  if v_value is null or pg_catalog.substr(v_value, 1, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  begin
    return pg_catalog.substr(v_value, 1, 10)::date;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
  p_school_id text,
  p_school_name text,
  p_grade text,
  p_student jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_school_id text := coalesce(p_student ->> 'school_id', p_student ->> 'schoolId', '');
  v_student_school text := pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_student ->> 'school', ''), '\s+', '', 'g'));
  v_source_school text := pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_school_name, ''), '\s+', '', 'g'));
  v_grade text := pg_catalog.btrim(coalesce(p_student ->> 'grade', ''));
  v_school_match boolean := false;
  v_grade_match boolean := false;
begin
  if nullif(pg_catalog.btrim(coalesce(p_school_id, '')), '') is not null then
    v_school_match := p_school_id = v_student_school_id or exists (
      select 1
      from public.academic_schools school
      where school.id::text = p_school_id
        and pg_catalog.lower(pg_catalog.regexp_replace(coalesce(school.name, ''), '\s+', '', 'g')) = v_student_school
    );
  elsif v_source_school <> '' then
    v_school_match := v_source_school = v_student_school;
  else
    v_school_match := v_student_school = '';
  end if;

  if v_grade = '' then
    v_grade_match := true;
  elsif nullif(pg_catalog.btrim(coalesce(p_grade, '')), '') is null
    or pg_catalog.btrim(p_grade) in ('all', '전체')
  then
    v_grade_match := true;
  else
    select exists (
      select 1
      from pg_catalog.regexp_split_to_table(p_grade, ',') grade_item
      where pg_catalog.btrim(grade_item) = v_grade
    ) into v_grade_match;
  end if;
  return v_school_match and v_grade_match;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(
  p_student jsonb,
  p_exam_date date
) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subjects text[] := array[]::text[];
  v_day jsonb;
begin
  select coalesce(pg_catalog.array_agg(distinct subject order by subject), array[]::text[])
  into v_subjects
  from (
    select dashboard_private.dashboard_conflict_normalize_subject_v1(detail.subject) as subject
    from public.academic_event_exam_details detail
    left join public.academic_events event on event.id = detail.academic_event_id
    where detail.exam_date = p_exam_date
      and dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
        coalesce(detail.school_id::text, pg_catalog.to_jsonb(event) ->> 'school_id'),
        coalesce(
          pg_catalog.to_jsonb(detail) ->> 'school',
          pg_catalog.to_jsonb(event) ->> 'school',
          pg_catalog.to_jsonb(event) ->> 'school_name'
        ),
        coalesce(nullif(detail.grade, ''), pg_catalog.to_jsonb(event) ->> 'grade', 'all'),
        p_student
      )
    union
    select dashboard_private.dashboard_conflict_subject_from_event_v1(pg_catalog.to_jsonb(event)) as subject
    from public.academic_events event
    where dashboard_private.dashboard_conflict_event_type_v1(pg_catalog.to_jsonb(event))
      in ('영어시험일', '수학시험일', '과학시험일')
      and dashboard_private.dashboard_conflict_event_date_v1(pg_catalog.to_jsonb(event)) = p_exam_date
      and dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
        pg_catalog.to_jsonb(event) ->> 'school_id',
        coalesce(pg_catalog.to_jsonb(event) ->> 'school', pg_catalog.to_jsonb(event) ->> 'school_name'),
        coalesce(pg_catalog.to_jsonb(event) ->> 'grade', 'all'),
        p_student
      )
  ) modern_subjects
  where nullif(subject, '') is not null;

  if pg_catalog.cardinality(v_subjects) > 0 then
    return v_subjects;
  end if;

  if pg_catalog.to_regclass('public.academic_exam_days') is null then
    return v_subjects;
  end if;
  for v_day in execute
    'select pg_catalog.to_jsonb(day) from public.academic_exam_days day where day.exam_date = $1'
    using p_exam_date
  loop
    if dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
      v_day ->> 'school_id',
      coalesce(v_day ->> 'school', v_day ->> 'school_name'),
      coalesce(v_day ->> 'grade', 'all'),
      p_student
    ) then
      v_subjects := pg_catalog.array_append(
        v_subjects,
        dashboard_private.dashboard_conflict_normalize_subject_v1(v_day ->> 'subject')
      );
    end if;
  end loop;
  select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
    into v_subjects
  from pg_catalog.unnest(v_subjects) item
  where nullif(item, '') is not null;
  return v_subjects;
end;
$$;

create or replace function dashboard_private.normalize_dashboard_conflict_v1(p_conflict jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := pg_catalog.btrim(coalesce(p_conflict ->> 'type', ''));
  v_occurrence text := pg_catalog.btrim(coalesce(p_conflict ->> 'occurrenceKind', ''));
  v_class_ids text[];
  v_student_ids text[];
  v_exam_event_ids text[];
  v_exam_detail_ids text[];
  v_teacher_catalog_ids text[];
  v_classroom_catalog_ids text[];
  v_weekday text := pg_catalog.btrim(coalesce(p_conflict ->> 'weekday', ''));
  v_start text := pg_catalog.btrim(coalesce(p_conflict ->> 'overlapStart', ''));
  v_end text := pg_catalog.btrim(coalesce(p_conflict ->> 'overlapEnd', ''));
  v_exam_date text := pg_catalog.btrim(coalesce(p_conflict ->> 'examDate', ''));
  v_exam_rule text := pg_catalog.btrim(coalesce(p_conflict ->> 'examRule', ''));
begin
  if p_conflict is null or pg_catalog.jsonb_typeof(p_conflict) <> 'object' then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  if v_type not in ('exam', 'teacher', 'classroom', 'student') then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_conflict -> 'classIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_conflict -> 'studentIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_conflict -> 'examEventIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_conflict -> 'examDetailIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_conflict -> 'teacherCatalogIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_conflict -> 'classroomCatalogIds') <> 'array'
  then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;

  v_class_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'classIds');
  v_student_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'studentIds');
  v_exam_event_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'examEventIds');
  v_exam_detail_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'examDetailIds');
  v_teacher_catalog_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'teacherCatalogIds');
  v_classroom_catalog_ids := dashboard_private.dashboard_conflict_uuid_array_v1(p_conflict -> 'classroomCatalogIds');

  if v_type = 'exam' then
    if v_occurrence <> 'dated'
      or pg_catalog.cardinality(v_class_ids) <> 1
      or pg_catalog.cardinality(v_student_ids) < 1
      or pg_catalog.cardinality(v_classroom_catalog_ids) <> 0
      or v_exam_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or v_exam_rule not in ('same-day-subject', 'day-before-other-subject')
    then
      raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
    end if;
    begin
      perform v_exam_date::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
    end;
    v_weekday := '';
    v_start := '';
    v_end := '';
  else
    if v_occurrence <> 'weekly'
      or pg_catalog.cardinality(v_class_ids) <> 2
      or v_weekday not in ('월', '화', '수', '목', '금', '토', '일')
      or v_exam_date <> ''
      or v_exam_rule <> ''
      or (v_type = 'student' and pg_catalog.cardinality(v_student_ids) <> 1)
      or (v_type <> 'student' and pg_catalog.cardinality(v_student_ids) <> 0)
      or pg_catalog.cardinality(v_exam_event_ids) <> 0
      or pg_catalog.cardinality(v_exam_detail_ids) <> 0
      or (v_type = 'classroom' and pg_catalog.cardinality(v_teacher_catalog_ids) <> 0)
      or (v_type <> 'classroom' and pg_catalog.cardinality(v_classroom_catalog_ids) <> 0)
    then
      raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
    end if;
    v_start := dashboard_private.dashboard_conflict_normalize_time_v1(v_start);
    v_end := dashboard_private.dashboard_conflict_normalize_time_v1(v_end);
    if v_start >= v_end then
      raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
    end if;
    v_exam_date := '';
  end if;

  return pg_catalog.jsonb_build_object(
    'type', v_type,
    'occurrenceKind', v_occurrence,
    'classIds', pg_catalog.to_jsonb(v_class_ids),
    'studentIds', pg_catalog.to_jsonb(v_student_ids),
    'examEventIds', pg_catalog.to_jsonb(v_exam_event_ids),
    'examDetailIds', pg_catalog.to_jsonb(v_exam_detail_ids),
    'teacherCatalogIds', pg_catalog.to_jsonb(v_teacher_catalog_ids),
    'classroomCatalogIds', pg_catalog.to_jsonb(v_classroom_catalog_ids),
    'weekday', v_weekday,
    'overlapStart', v_start,
    'overlapEnd', v_end,
    'examDate', v_exam_date,
    'examRule', v_exam_rule
  );
end;
$$;

create or replace function dashboard_private.dashboard_conflict_key_v1(p_conflict jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := p_conflict ->> 'type';
  v_classes text[] := dashboard_private.dashboard_conflict_text_array_v1(p_conflict -> 'classIds');
  v_students text[] := dashboard_private.dashboard_conflict_text_array_v1(p_conflict -> 'studentIds');
  v_key text;
begin
  if v_type = 'exam' then
    return 'exam:v1:' || v_classes[1] || ':' || (p_conflict ->> 'examDate') || ':' || (p_conflict ->> 'examRule');
  end if;
  v_key := 'weekly:v1:' || v_type || ':' || (p_conflict ->> 'weekday') || ':' ||
    (p_conflict ->> 'overlapStart') || '-' || (p_conflict ->> 'overlapEnd') || ':' ||
    pg_catalog.array_to_string(v_classes, ':');
  if v_type = 'student' then
    v_key := v_key || ':' || v_students[1];
  end if;
  return v_key;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_assert_role_v1(p_write boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
begin
  if v_actor is null or not exists (select 1 from public.profiles profile where profile.id = v_actor) then
    raise exception 'dashboard_conflict_access_denied' using errcode = '42501';
  end if;
  if (p_write and coalesce(v_role, '') not in ('admin', 'staff', 'teacher'))
    or (not p_write and coalesce(v_role, '') not in ('admin', 'staff', 'teacher', 'assistant', 'viewer'))
  then
    raise exception 'dashboard_conflict_access_denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_task_visible_v1(
  p_task public.ops_tasks,
  p_actor uuid,
  p_role text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_task.id is not null and (
    coalesce(p_role, '') in ('admin', 'staff', 'assistant')
    or p_actor = p_task.requested_by
    or p_actor = p_task.assignee_id
    or p_actor = p_task.secondary_assignee_id
    or dashboard_private.is_ops_word_retest_teacher(p_task.id)
  );
$$;

create or replace function dashboard_private.dashboard_conflict_link_response_v1(
  p_conflict_key text,
  p_actor uuid,
  p_already_exists boolean default true
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link dashboard_private.dashboard_conflict_task_links%rowtype;
  v_task public.ops_tasks%rowtype;
  v_can_open boolean := false;
begin
  select link.* into v_link
  from dashboard_private.dashboard_conflict_task_links link
  where link.conflict_key = p_conflict_key;
  if not found then
    return pg_catalog.jsonb_build_object(
      'conflictKey', p_conflict_key,
      'linked', false,
      'taskId', '',
      'canOpen', false,
      'alreadyExists', false
    );
  end if;
  select task.* into v_task from public.ops_tasks task where task.id = v_link.task_id;
  v_can_open := dashboard_private.dashboard_conflict_task_visible_v1(
    v_task, p_actor, public.current_dashboard_role()
  );
  return pg_catalog.jsonb_build_object(
    'conflictKey', p_conflict_key,
    'linked', true,
    'taskId', case when v_can_open then v_link.task_id::text else '' end,
    'canOpen', v_can_open,
    'alreadyExists', p_already_exists
  );
end;
$$;

create or replace function dashboard_private.dashboard_conflict_minutes_v1(p_value text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.split_part(p_value, ':', 1)::integer, 0) * 60 +
    coalesce(pg_catalog.split_part(p_value, ':', 2)::integer, 0);
$$;

create or replace function dashboard_private.dashboard_conflict_class_has_slot_v1(
  p_class jsonb,
  p_weekday text,
  p_start text,
  p_end text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.regexp_matches(
      coalesce(p_class ->> 'schedule', ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})',
      'g'
    ) matched
    where pg_catalog.strpos(matched[1], p_weekday) > 0
      and dashboard_private.dashboard_conflict_minutes_v1(matched[2]) <= dashboard_private.dashboard_conflict_minutes_v1(p_start)
      and dashboard_private.dashboard_conflict_minutes_v1(matched[3]) >= dashboard_private.dashboard_conflict_minutes_v1(p_end)
  );
$$;

create or replace function dashboard_private.dashboard_conflict_class_has_session_v1(
  p_class jsonb,
  p_date date
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_plan jsonb := case
    when pg_catalog.jsonb_typeof(p_class -> 'schedule_plan') = 'object' then p_class -> 'schedule_plan'
    else '{}'::jsonb
  end;
  v_has_plan_sessions boolean := false;
  v_day text := (array['일', '월', '화', '수', '목', '금', '토'])[pg_catalog.date_part('dow', p_date)::integer + 1];
  v_start_date date;
  v_end_date date;
begin
  if pg_catalog.jsonb_typeof(v_plan -> 'sessions') = 'array' then
    select exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_plan -> 'sessions') session
      where coalesce(nullif(session ->> 'scheduleState', ''), nullif(session ->> 'schedule_state', ''), nullif(session ->> 'state', ''), 'active')
        in ('active', 'makeup')
    ) into v_has_plan_sessions;
    if v_has_plan_sessions then
      return exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_plan -> 'sessions') session
        where coalesce(nullif(session ->> 'scheduleState', ''), nullif(session ->> 'schedule_state', ''), nullif(session ->> 'state', ''), 'active')
          in ('active', 'makeup')
          and coalesce(nullif(session ->> 'date', ''), nullif(session ->> 'dateValue', ''), nullif(session ->> 'date_value', '')) = p_date::text
      );
    end if;
  end if;
  begin
    v_start_date := nullif(coalesce(p_class ->> 'start_date', p_class ->> 'startDate'), '')::date;
    v_end_date := nullif(coalesce(p_class ->> 'end_date', p_class ->> 'endDate'), '')::date;
  exception when others then
    return false;
  end;
  if v_start_date is null or v_end_date is null or p_date < v_start_date or p_date > v_end_date then
    return false;
  end if;
  return exists (
    select 1
    from pg_catalog.regexp_matches(
      coalesce(p_class ->> 'schedule', ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})',
      'g'
    ) matched
    where pg_catalog.strpos(matched[1], v_day) > 0
  );
end;
$$;

create or replace function dashboard_private.dashboard_conflict_json_array_contains_v1(
  p_value jsonb,
  p_id text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_value) = 'array' then p_value ? p_id
    when pg_catalog.jsonb_typeof(p_value) = 'string' then
      case
        when pg_catalog.jsonb_typeof((p_value #>> '{}')::jsonb) = 'array' then ((p_value #>> '{}')::jsonb) ? p_id
        else false
      end
    else false
  end;
$$;

create or replace function dashboard_private.dashboard_conflict_student_registered_v1(
  p_class jsonb,
  p_student jsonb
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select (
    dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_class -> 'student_ids', p_student ->> 'id'
    )
    or dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_student -> 'class_ids', p_class ->> 'id'
    )
  ) and not (
    dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_class -> 'waitlist_ids', p_student ->> 'id'
    )
    or dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_class -> 'waitlist_student_ids', p_student ->> 'id'
    )
    or dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_student -> 'waitlist_class_ids', p_class ->> 'id'
    )
    or dashboard_private.dashboard_conflict_json_array_contains_v1(
      p_student -> 'waitlist_ids', p_class ->> 'id'
    )
  );
$$;

create or replace function dashboard_private.dashboard_conflict_resource_overlap_v1(
  p_left text,
  p_right text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.regexp_split_to_table(pg_catalog.lower(coalesce(p_left, '')), '[,/\n·]+') left_item
    join pg_catalog.regexp_split_to_table(pg_catalog.lower(coalesce(p_right, '')), '[,/\n·]+') right_item
      on nullif(pg_catalog.btrim(left_item), '') = nullif(pg_catalog.btrim(right_item), '')
    where nullif(pg_catalog.btrim(left_item), '') is not null
  );
$$;

create or replace function dashboard_private.dashboard_conflict_resource_key_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '\s+', '', 'g'));
$$;

create or replace function dashboard_private.dashboard_conflict_normalize_classroom_v1(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(coalesce(p_value, ''));
  v_compact text;
begin
  v_value := pg_catalog.regexp_replace(v_value, '\s*\((?:월|화|수|목|금|토|일|[,\s/·])+\)\s*$', '', 'g');
  v_compact := pg_catalog.regexp_replace(v_value, '\s+', '', 'g');
  return case v_compact
    when '본2' then '본관 2강' when '본2강' then '본관 2강'
    when '본3' then '본관 3강' when '본3강' then '본관 3강'
    when '본5' then '본관 5강' when '본5강' then '본관 5강'
    when '별3' then '별관 3강' when '별3강' then '별관 3강'
    when '별4' then '별관 4강' when '별4강' then '별관 4강' when '별관4강' then '별관 4강'
    when '별5' then '별관 5강' when '별5강' then '별관 5강'
    when '별7' then '별관 5강' when '별7강' then '별관 5강'
    else v_value
  end;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_is_classroom_token_v1(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(coalesce(p_value, '')) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관)'
    or pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '\s+', '', 'g') ~* '^(본|별)[0-9]+(강)?$'
    or pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '\s+', '', 'g') ~ '^[0-9]+(강|실|관)$';
$$;

create or replace function dashboard_private.dashboard_conflict_class_slots_v1(p_class jsonb)
returns table(
  weekday text,
  slot_start text,
  slot_end text,
  teacher_name text,
  classroom_name text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
  v_days text;
  v_override text;
  v_parts text[];
  v_part text;
  v_default_teachers text[] := array[]::text[];
  v_default_classrooms text[] := array[]::text[];
  v_override_teacher text;
  v_override_classroom text;
  v_slot_teacher text;
  v_slot_classroom text;
  v_resolved_teachers text[];
  v_resolved_classrooms text[];
  v_teacher text;
  v_classroom text;
  v_index integer;
begin
  select coalesce(pg_catalog.array_agg(pg_catalog.btrim(token.value) order by token.ordinality), array[]::text[])
    into v_default_teachers
  from pg_catalog.regexp_split_to_table(
    coalesce(p_class ->> 'teacher', p_class ->> 'teacher_name', p_class ->> 'teacherName', ''),
    '[,/&·\n]+'
  ) with ordinality token(value, ordinality)
  where nullif(pg_catalog.btrim(token.value), '') is not null;
  select coalesce(
    pg_catalog.array_agg(
      dashboard_private.dashboard_conflict_normalize_classroom_v1(token.value)
      order by token.ordinality
    ),
    array[]::text[]
  ) into v_default_classrooms
  from pg_catalog.regexp_split_to_table(
    coalesce(p_class ->> 'classroom', p_class ->> 'room', ''),
    '[,/&·\n]+'
  ) with ordinality token(value, ordinality)
  where nullif(dashboard_private.dashboard_conflict_normalize_classroom_v1(token.value), '') is not null;

  for v_match in
    select matched
    from pg_catalog.regexp_matches(
      coalesce(p_class ->> 'schedule', ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?',
      'g'
    ) matched
  loop
    v_days := v_match[1];
    v_override := coalesce(v_match[4], '');
    v_override_teacher := '';
    v_override_classroom := '';
    if nullif(pg_catalog.btrim(v_override), '') is not null then
      v_parts := pg_catalog.regexp_split_to_array(v_override, '[,/&·\n]+');
      foreach v_part in array v_parts loop
        v_part := pg_catalog.btrim(v_part);
        if v_part = '' then continue; end if;
        if dashboard_private.dashboard_conflict_is_classroom_token_v1(v_part) then
          if v_override_classroom = '' then
            v_override_classroom := dashboard_private.dashboard_conflict_normalize_classroom_v1(v_part);
          end if;
        elsif v_override_teacher = '' then
          v_override_teacher := v_part;
        end if;
      end loop;
    end if;

    for v_index in 1..pg_catalog.char_length(v_days) loop
      v_slot_teacher := coalesce(nullif(v_override_teacher, ''), v_default_teachers[1], '');
      v_slot_classroom := coalesce(nullif(v_override_classroom, ''), v_default_classrooms[1], '');

      if v_slot_teacher <> ''
        and (not (v_slot_teacher = any(v_default_teachers)) or pg_catalog.cardinality(v_default_teachers) <= 1)
      then
        v_resolved_teachers := array[v_slot_teacher];
      elsif v_slot_teacher <> ''
        and pg_catalog.cardinality(v_default_teachers) > 1
        and v_slot_teacher = v_default_teachers[1]
      then
        v_resolved_teachers := v_default_teachers;
      elsif v_slot_teacher <> '' then
        v_resolved_teachers := array[v_slot_teacher];
      else
        v_resolved_teachers := array['']::text[];
      end if;

      if v_slot_classroom <> ''
        and (not (v_slot_classroom = any(v_default_classrooms)) or pg_catalog.cardinality(v_default_classrooms) <= 1)
      then
        v_resolved_classrooms := array[v_slot_classroom];
      elsif v_slot_classroom <> ''
        and pg_catalog.cardinality(v_default_classrooms) > 1
        and v_slot_classroom = v_default_classrooms[1]
      then
        v_resolved_classrooms := v_default_classrooms;
      elsif v_slot_classroom <> '' then
        v_resolved_classrooms := array[v_slot_classroom];
      else
        v_resolved_classrooms := array['']::text[];
      end if;

      foreach v_teacher in array v_resolved_teachers loop
        foreach v_classroom in array v_resolved_classrooms loop
          weekday := pg_catalog.substr(v_days, v_index, 1);
          slot_start := dashboard_private.dashboard_conflict_normalize_time_v1(v_match[2]);
          slot_end := dashboard_private.dashboard_conflict_normalize_time_v1(v_match[3]);
          teacher_name := v_teacher;
          classroom_name := v_classroom;
          return next;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function dashboard_private.dashboard_conflict_class_is_active_v1(p_class jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status text := pg_catalog.btrim(coalesce(p_class ->> 'status', ''));
  v_today date := (pg_catalog.now() at time zone 'Asia/Seoul')::date;
  v_start date;
  v_end date;
begin
  if v_status in ('개강', '수업 진행 중', '수강') then return true; end if;
  if v_status in ('개강 예정', '개강 준비 중', '개강 준비', '종강') then return false; end if;
  begin
    v_start := nullif(coalesce(p_class ->> 'start_date', p_class ->> 'startDate'), '')::date;
    v_end := nullif(coalesce(p_class ->> 'end_date', p_class ->> 'endDate'), '')::date;
  exception when others then
    return false;
  end;
  return (v_start is null or v_start <= v_today) and (v_end is null or v_end >= v_today);
end;
$$;

create or replace function dashboard_private.dashboard_conflict_checkpoint_wait_v1(
  p_request_id uuid,
  p_phase text,
  p_class_ids uuid[]
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_released timestamptz;
  v_scope_match boolean := false;
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_lock_key bigint := pg_catalog.hashtextextended(
    'dashboard-conflict-checkpoint:' || p_request_id::text || ':' || p_phase,
    0
  );
begin
  select checkpoint.released_at into v_released
  from dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
  where checkpoint.request_id = p_request_id
    and checkpoint.phase = p_phase
    and checkpoint.class_ids = (
      select pg_catalog.array_agg(id order by id)
      from pg_catalog.unnest(p_class_ids) id
    );
  v_scope_match := found;
  if exists (
    select 1
    from dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
    where checkpoint.request_id = p_request_id
      and checkpoint.phase = p_phase
  ) and not v_scope_match then
    raise exception 'dashboard_conflict_checkpoint_scope_mismatch' using errcode = '42501';
  end if;
  if not v_scope_match or v_released is not null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  loop
    select checkpoint.released_at into v_released
    from dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
    where checkpoint.request_id = p_request_id
      and checkpoint.phase = p_phase
      and checkpoint.class_ids = (
        select pg_catalog.array_agg(id order by id)
        from pg_catalog.unnest(p_class_ids) id
      );
    exit when v_released is not null;
    if pg_catalog.clock_timestamp() - v_started > interval '20 seconds' then
      raise exception 'dashboard_conflict_checkpoint_timeout' using errcode = '57014';
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
end;
$$;

create or replace function public.arm_dashboard_conflict_checkpoint_v1(
  p_request_id uuid,
  p_phase text,
  p_class_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_ids uuid[];
  v_count integer;
begin
  select pg_catalog.array_agg(distinct id order by id) into v_class_ids
  from pg_catalog.unnest(p_class_ids) id;
  if (select auth.role()) <> 'service_role'
    or p_phase not in ('before_source_lock', 'after_source_lock')
    or pg_catalog.cardinality(v_class_ids) not between 1 and 2
  then
    raise exception 'dashboard_conflict_checkpoint_denied' using errcode = '42501';
  end if;
  select pg_catalog.count(*) into v_count
  from public.classes source_class
  where source_class.id = any(v_class_ids)
    and coalesce(
      nullif(pg_catalog.to_jsonb(source_class) ->> 'name', ''),
      nullif(pg_catalog.to_jsonb(source_class) ->> 'class_name', ''),
      ''
    ) is not null
    and pg_catalog.left(
      coalesce(
        nullif(pg_catalog.to_jsonb(source_class) ->> 'name', ''),
        nullif(pg_catalog.to_jsonb(source_class) ->> 'class_name', ''),
        ''
      ),
      pg_catalog.char_length('__dashboard_conflict_verify__')
    ) = '__dashboard_conflict_verify__';
  if v_count <> pg_catalog.cardinality(v_class_ids) then
    raise exception 'dashboard_conflict_checkpoint_denied' using errcode = '42501';
  end if;
  insert into dashboard_private.dashboard_conflict_verification_checkpoints(request_id, phase, class_ids)
  values (p_request_id, p_phase, v_class_ids)
  on conflict (request_id, phase) do update
    set class_ids = excluded.class_ids,
      reached_at = null,
      released_at = null,
      created_at = pg_catalog.clock_timestamp();
end;
$$;

create or replace function public.get_dashboard_conflict_checkpoint_v1(p_request_id uuid, p_phase text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row dashboard_private.dashboard_conflict_verification_checkpoints%rowtype;
  v_armed boolean := false;
  v_lock_acquired boolean := false;
  v_lock_key bigint := pg_catalog.hashtextextended(
    'dashboard-conflict-checkpoint:' || p_request_id::text || ':' || p_phase,
    0
  );
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'dashboard_conflict_checkpoint_denied' using errcode = '42501';
  end if;
  select checkpoint.* into v_row
  from dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
  where checkpoint.request_id = p_request_id and checkpoint.phase = p_phase;
  v_armed := found;
  if v_armed and v_row.released_at is null then
    v_lock_acquired := pg_catalog.pg_try_advisory_lock(v_lock_key);
    if v_lock_acquired then
      perform pg_catalog.pg_advisory_unlock(v_lock_key);
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'armed', v_armed,
    'reached', v_armed and v_row.released_at is null and not v_lock_acquired,
    'released', v_row.released_at is not null
  );
end;
$$;

create or replace function public.release_dashboard_conflict_checkpoint_v1(p_request_id uuid, p_phase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'dashboard_conflict_checkpoint_denied' using errcode = '42501';
  end if;
  update dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
  set released_at = pg_catalog.clock_timestamp()
  where checkpoint.request_id = p_request_id and checkpoint.phase = p_phase;
end;
$$;

create or replace function public.disarm_dashboard_conflict_checkpoint_v1(p_request_id uuid, p_phase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'dashboard_conflict_checkpoint_denied' using errcode = '42501';
  end if;
  delete from dashboard_private.dashboard_conflict_verification_checkpoints checkpoint
  where checkpoint.request_id = p_request_id and checkpoint.phase = p_phase;
end;
$$;

create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl(
  p_conflict jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_conflict jsonb;
  v_key text;
  v_fingerprint text;
  v_replay jsonb;
  v_type text;
  v_class_ids text[];
  v_student_ids text[];
  v_event_ids text[];
  v_detail_ids text[];
  v_teacher_ids text[];
  v_classroom_ids text[];
  v_class_rows jsonb[] := array[]::jsonb[];
  v_student_rows jsonb[] := array[]::jsonb[];
  v_class jsonb;
  v_student jsonb;
  v_subject text;
  v_exam_subjects text[] := array[]::text[];
  v_all_exam_subjects text[] := array[]::text[];
  v_affected_student_names text[] := array[]::text[];
  v_exam_date date;
  v_session_date date;
  v_left_slot record;
  v_right_slot record;
  v_exact_overlap boolean := false;
  v_resource_keys text[] := array[]::text[];
  v_derived_teacher_ids text[] := array[]::text[];
  v_derived_classroom_ids text[] := array[]::text[];
  v_teacher_labels text[] := array[]::text[];
  v_classroom_labels text[] := array[]::text[];
  v_unlinked_teacher_labels text[] := array[]::text[];
  v_profile_ids uuid[] := array[]::uuid[];
  v_primary uuid;
  v_secondary uuid;
  v_class_names text[] := array[]::text[];
  v_campuses text[] := array[]::text[];
  v_due timestamptz;
  v_task public.ops_tasks%rowtype;
  v_response jsonb;
  v_id text;
  v_count integer;
  v_problem text;
  v_owner text;
  v_resolution text;
  v_summary text;
  v_single_subject text;
  v_single_campus text;
  v_next_occurrence date;
  v_campus_value text;
begin
  if p_request_id is null then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  v_actor := dashboard_private.dashboard_conflict_assert_role_v1(true);
  v_conflict := dashboard_private.normalize_dashboard_conflict_v1(p_conflict);
  v_key := dashboard_private.dashboard_conflict_key_v1(v_conflict);
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor,
    'conflictKey', v_key,
    'conflict', v_conflict
  )::text);

  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'create_dashboard_conflict_task_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  v_type := v_conflict ->> 'type';
  v_class_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'classIds');
  v_student_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'studentIds');
  v_event_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'examEventIds');
  v_detail_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'examDetailIds');
  v_teacher_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'teacherCatalogIds');
  v_classroom_ids := dashboard_private.dashboard_conflict_text_array_v1(v_conflict -> 'classroomCatalogIds');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dashboard-conflict:' || v_key, 0)
  );
  perform dashboard_private.dashboard_conflict_checkpoint_wait_v1(
    p_request_id, 'before_source_lock', v_class_ids::uuid[]
  );
  if v_type = 'exam' then
    v_exam_date := (v_conflict ->> 'examDate')::date;
    v_session_date := case
      when v_conflict ->> 'examRule' = 'same-day-subject' then v_exam_date
      else v_exam_date - 1
    end;
    if v_session_date < (pg_catalog.now() at time zone 'Asia/Seoul')::date then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
  end if;

  for v_class in
    select pg_catalog.to_jsonb(source_class)
    from public.classes source_class
    where source_class.id = any(v_class_ids::uuid[])
    order by source_class.id
    for update of source_class
  loop
    v_class_rows := pg_catalog.array_append(v_class_rows, v_class);
  end loop;
  if pg_catalog.cardinality(v_class_rows) <> pg_catalog.cardinality(v_class_ids) then
    raise exception 'dashboard_conflict_stale' using errcode = '40001';
  end if;
  foreach v_class in array v_class_rows loop
    if not dashboard_private.dashboard_conflict_class_is_active_v1(v_class) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
  end loop;

  foreach v_id in array v_student_ids loop
    select pg_catalog.to_jsonb(source_student) into v_student
    from public.students source_student
    where source_student.id = v_id::uuid
    for update of source_student;
    if not found then raise exception 'dashboard_conflict_stale' using errcode = '40001'; end if;
    v_student_rows := pg_catalog.array_append(v_student_rows, v_student);
    if v_type = 'exam' and not dashboard_private.dashboard_conflict_student_registered_v1(
      v_class_rows[1], v_student
    ) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
  end loop;

  if v_type = 'exam' then
    -- Lock every modern parent covering an affected student before locking its details.
    perform 1
    from public.academic_events source_event
    where dashboard_private.dashboard_conflict_event_type_v1(pg_catalog.to_jsonb(source_event))
      in ('시험기간', '영어시험일', '수학시험일', '과학시험일')
      and exists (
        select 1
        from pg_catalog.unnest(v_student_rows) as affected_student(student)
        where dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
          pg_catalog.to_jsonb(source_event) ->> 'school_id',
          coalesce(pg_catalog.to_jsonb(source_event) ->> 'school', pg_catalog.to_jsonb(source_event) ->> 'school_name'),
          coalesce(pg_catalog.to_jsonb(source_event) ->> 'grade', 'all'),
          student
        )
      )
    order by source_event.id
    for update of source_event;

    select pg_catalog.count(*) into v_count
    from public.academic_events source_event
    where source_event.id = any(v_event_ids::uuid[])
      and dashboard_private.dashboard_conflict_event_type_v1(pg_catalog.to_jsonb(source_event))
        in ('시험기간', '영어시험일', '수학시험일', '과학시험일')
      and exists (
        select 1
        from pg_catalog.unnest(v_student_rows) as affected_student(student)
        where dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
          pg_catalog.to_jsonb(source_event) ->> 'school_id',
          coalesce(pg_catalog.to_jsonb(source_event) ->> 'school', pg_catalog.to_jsonb(source_event) ->> 'school_name'),
          coalesce(pg_catalog.to_jsonb(source_event) ->> 'grade', 'all'),
          student
        )
      );
    if v_count <> pg_catalog.cardinality(v_event_ids) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;

    perform 1
    from public.academic_event_exam_details source_detail
    left join public.academic_events source_event on source_event.id = source_detail.academic_event_id
    where source_detail.exam_date = v_exam_date
      and exists (
        select 1
        from pg_catalog.unnest(v_student_rows) as affected_student(student)
        where dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
          coalesce(source_detail.school_id::text, pg_catalog.to_jsonb(source_event) ->> 'school_id'),
          coalesce(
            pg_catalog.to_jsonb(source_detail) ->> 'school',
            pg_catalog.to_jsonb(source_event) ->> 'school',
            pg_catalog.to_jsonb(source_event) ->> 'school_name'
          ),
          coalesce(nullif(source_detail.grade, ''), pg_catalog.to_jsonb(source_event) ->> 'grade', 'all'),
          student
        )
      )
    order by source_detail.id
    for update of source_detail;

    select pg_catalog.count(*) into v_count
    from public.academic_event_exam_details source_detail
    left join public.academic_events source_event on source_event.id = source_detail.academic_event_id
    where source_detail.id = any(v_detail_ids::uuid[])
      and source_detail.exam_date = v_exam_date
      and exists (
        select 1
        from pg_catalog.unnest(v_student_rows) as affected_student(student)
        where dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(
          coalesce(source_detail.school_id::text, pg_catalog.to_jsonb(source_event) ->> 'school_id'),
          coalesce(
            pg_catalog.to_jsonb(source_detail) ->> 'school',
            pg_catalog.to_jsonb(source_event) ->> 'school',
            pg_catalog.to_jsonb(source_event) ->> 'school_name'
          ),
          coalesce(nullif(source_detail.grade, ''), pg_catalog.to_jsonb(source_event) ->> 'grade', 'all'),
          student
        )
      );
    if v_count <> pg_catalog.cardinality(v_detail_ids) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;

    if pg_catalog.to_regclass('public.academic_exam_days') is not null then
      for v_id in execute
        'select day.id::text from public.academic_exam_days day where day.exam_date = $1 order by day.id for update of day'
        using v_exam_date
      loop
        null;
      end loop;
    end if;
  end if;
  if v_type = 'exam' then
    select coalesce(
      pg_catalog.array_agg(
        distinct dashboard_private.dashboard_conflict_resource_key_v1(teacher_name)
        order by dashboard_private.dashboard_conflict_resource_key_v1(teacher_name)
      ),
      array[]::text[]
    ), coalesce(
      pg_catalog.array_agg(distinct pg_catalog.btrim(teacher_name) order by pg_catalog.btrim(teacher_name)),
      array[]::text[]
    ) into v_resource_keys, v_teacher_labels
    from pg_catalog.regexp_split_to_table(
      coalesce(
        v_class_rows[1] ->> 'teacher',
        v_class_rows[1] ->> 'teacher_name',
        v_class_rows[1] ->> 'teacherName',
        ''
      ),
      '[,/&·\n]+'
    ) teacher_name
    where nullif(dashboard_private.dashboard_conflict_resource_key_v1(teacher_name), '') is not null;
  else
    for v_left_slot in
      select slot.*
      from dashboard_private.dashboard_conflict_class_slots_v1(v_class_rows[1]) slot
      where slot.weekday = v_conflict ->> 'weekday'
    loop
      for v_right_slot in
        select slot.*
        from dashboard_private.dashboard_conflict_class_slots_v1(v_class_rows[2]) slot
        where slot.weekday = v_conflict ->> 'weekday'
      loop
        if v_left_slot.slot_start < v_right_slot.slot_end
          and v_right_slot.slot_start < v_left_slot.slot_end
          and greatest(v_left_slot.slot_start, v_right_slot.slot_start) = v_conflict ->> 'overlapStart'
          and least(v_left_slot.slot_end, v_right_slot.slot_end) = v_conflict ->> 'overlapEnd'
        then
          if v_type = 'teacher'
            and nullif(dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.teacher_name), '') is not null
            and pg_catalog.btrim(v_left_slot.teacher_name) = pg_catalog.btrim(v_right_slot.teacher_name)
          then
            v_exact_overlap := true;
            v_resource_keys := pg_catalog.array_append(
              v_resource_keys,
              dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.teacher_name)
            );
            v_teacher_labels := pg_catalog.array_append(v_teacher_labels, v_left_slot.teacher_name);
          elsif v_type = 'classroom'
            and nullif(dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.classroom_name), '') is not null
            and pg_catalog.btrim(v_left_slot.classroom_name) = pg_catalog.btrim(v_right_slot.classroom_name)
          then
            v_exact_overlap := true;
            v_resource_keys := pg_catalog.array_append(
              v_resource_keys,
              dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.classroom_name)
            );
            v_classroom_labels := pg_catalog.array_append(
              v_classroom_labels,
              v_left_slot.classroom_name
            );
          elsif v_type = 'student' then
            v_exact_overlap := true;
            if nullif(dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.teacher_name), '') is not null then
              v_resource_keys := pg_catalog.array_append(
                v_resource_keys,
                dashboard_private.dashboard_conflict_resource_key_v1(v_left_slot.teacher_name)
              );
              v_teacher_labels := pg_catalog.array_append(v_teacher_labels, v_left_slot.teacher_name);
            end if;
            if nullif(dashboard_private.dashboard_conflict_resource_key_v1(v_right_slot.teacher_name), '') is not null then
              v_resource_keys := pg_catalog.array_append(
                v_resource_keys,
                dashboard_private.dashboard_conflict_resource_key_v1(v_right_slot.teacher_name)
              );
              v_teacher_labels := pg_catalog.array_append(v_teacher_labels, v_right_slot.teacher_name);
            end if;
          end if;
        end if;
      end loop;
    end loop;
    if not v_exact_overlap then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
    select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
      into v_resource_keys
    from pg_catalog.unnest(v_resource_keys) item
    where nullif(item, '') is not null;
    select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
      into v_teacher_labels
    from pg_catalog.unnest(v_teacher_labels) item
    where nullif(pg_catalog.btrim(item), '') is not null;
    select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
      into v_classroom_labels
    from pg_catalog.unnest(v_classroom_labels) item
    where nullif(pg_catalog.btrim(item), '') is not null;
  end if;

  if v_type in ('exam', 'teacher', 'student') then
    select coalesce(pg_catalog.array_agg(source_teacher.id::text order by source_teacher.id), array[]::text[])
      into v_derived_teacher_ids
    from public.teacher_catalogs source_teacher
    where dashboard_private.dashboard_conflict_resource_key_v1(source_teacher.name) = any(v_resource_keys);
    if v_teacher_ids <> v_derived_teacher_ids then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
    perform 1 from public.teacher_catalogs source_teacher
    where source_teacher.id = any(v_derived_teacher_ids::uuid[])
      and dashboard_private.dashboard_conflict_resource_key_v1(source_teacher.name) = any(v_resource_keys)
    order by source_teacher.id
    for update of source_teacher;
    get diagnostics v_count = row_count;
    if v_count <> pg_catalog.cardinality(v_derived_teacher_ids) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
    select coalesce(pg_catalog.array_agg(label order by label), array[]::text[])
      into v_unlinked_teacher_labels
    from pg_catalog.unnest(v_teacher_labels) label
    where not exists (
      select 1
      from public.teacher_catalogs source_teacher
      where dashboard_private.dashboard_conflict_resource_key_v1(source_teacher.name) =
        dashboard_private.dashboard_conflict_resource_key_v1(label)
        and source_teacher.profile_id is not null
    );
  else
    select coalesce(pg_catalog.array_agg(source_classroom.id::text order by source_classroom.id), array[]::text[])
      into v_derived_classroom_ids
    from public.classroom_catalogs source_classroom
    where dashboard_private.dashboard_conflict_resource_key_v1(
      dashboard_private.dashboard_conflict_normalize_classroom_v1(source_classroom.name)
    ) = any(v_resource_keys);
    if v_classroom_ids <> v_derived_classroom_ids then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
    perform 1 from public.classroom_catalogs source_classroom
    where source_classroom.id = any(v_derived_classroom_ids::uuid[])
      and dashboard_private.dashboard_conflict_resource_key_v1(
        dashboard_private.dashboard_conflict_normalize_classroom_v1(source_classroom.name)
      ) = any(v_resource_keys)
    order by source_classroom.id
    for update of source_classroom;
    get diagnostics v_count = row_count;
    if v_count <> pg_catalog.cardinality(v_derived_classroom_ids) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
  end if;

  perform dashboard_private.dashboard_conflict_checkpoint_wait_v1(
    p_request_id, 'after_source_lock', v_class_ids::uuid[]
  );

  if v_type = 'student' then
    for v_count in 1..2 loop
      if not dashboard_private.dashboard_conflict_student_registered_v1(
        v_class_rows[v_count], v_student_rows[1]
      ) then
        raise exception 'dashboard_conflict_stale' using errcode = '40001';
      end if;
    end loop;
  elsif v_type = 'exam' then
    v_subject := dashboard_private.dashboard_conflict_normalize_subject_v1(v_class_rows[1] ->> 'subject');
    if v_subject = '' or not dashboard_private.dashboard_conflict_class_has_session_v1(v_class_rows[1], v_session_date) then
      raise exception 'dashboard_conflict_stale' using errcode = '40001';
    end if;
    foreach v_student in array v_student_rows loop
      v_exam_subjects := dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(
        v_student, v_exam_date
      );
      v_all_exam_subjects := v_all_exam_subjects || v_exam_subjects;
      v_affected_student_names := pg_catalog.array_append(
        v_affected_student_names,
        coalesce(nullif(v_student ->> 'name', ''), v_student ->> 'id')
      );
      if pg_catalog.cardinality(v_exam_subjects) = 0
        or (v_conflict ->> 'examRule' = 'same-day-subject' and not (v_subject = any(v_exam_subjects)))
        or (v_conflict ->> 'examRule' = 'day-before-other-subject' and v_subject = any(v_exam_subjects))
      then
        raise exception 'dashboard_conflict_stale' using errcode = '40001';
      end if;
    end loop;
    select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
      into v_all_exam_subjects
    from pg_catalog.unnest(v_all_exam_subjects) item
    where nullif(item, '') is not null;
    select coalesce(pg_catalog.array_agg(distinct item order by item), array[]::text[])
      into v_affected_student_names
    from pg_catalog.unnest(v_affected_student_names) item
    where nullif(item, '') is not null;
  end if;

  v_response := dashboard_private.dashboard_conflict_link_response_v1(v_key, v_actor, true);
  if coalesce((v_response ->> 'linked')::boolean, false) then
    return dashboard_private.finish_ops_task_request_v2(
      p_request_id, 'create_dashboard_conflict_task_v1', v_fingerprint, v_response
    );
  end if;

  select coalesce(pg_catalog.array_agg(profile_id order by profile_id), array[]::uuid[])
    into v_profile_ids
  from (
    select distinct source_teacher.profile_id
    from public.teacher_catalogs source_teacher
    where source_teacher.id = any(v_teacher_ids::uuid[]) and source_teacher.profile_id is not null
  ) linked_profiles;
  v_primary := v_profile_ids[1];
  v_secondary := case
    when v_type = 'student' then v_profile_ids[2]
    else null
  end;
  if v_secondary = v_primary then v_secondary := null; end if;

  for v_count in 1..pg_catalog.cardinality(v_class_rows) loop
    v_class_names := pg_catalog.array_append(v_class_names, coalesce(
      nullif(v_class_rows[v_count] ->> 'name', ''), nullif(v_class_rows[v_count] ->> 'class_name', ''), v_class_ids[v_count]
    ));
    v_campus_value := coalesce(
      nullif(v_class_rows[v_count] ->> 'campus', ''),
      nullif(v_class_rows[v_count] ->> 'branch', ''),
      case
        when coalesce(v_class_rows[v_count] ->> 'classroom', v_class_rows[v_count] ->> 'room', '') ~ '본관' then '본관'
        when coalesce(v_class_rows[v_count] ->> 'classroom', v_class_rows[v_count] ->> 'room', '') ~ '별관' then '별관'
        else null
      end
    );
    if v_campus_value is not null then
      v_campuses := pg_catalog.array_append(v_campuses, v_campus_value);
    end if;
  end loop;
  select case when pg_catalog.count(distinct dashboard_private.dashboard_conflict_normalize_subject_v1(item ->> 'subject')) = 1
    then pg_catalog.min(dashboard_private.dashboard_conflict_normalize_subject_v1(item ->> 'subject')) else null end
    into v_single_subject from pg_catalog.unnest(v_class_rows) as class_item(item);
  select case when pg_catalog.count(distinct campus) = 1 then pg_catalog.min(campus) else null end
    into v_single_campus from pg_catalog.unnest(v_campuses) as class_campus(campus);

  if v_type = 'exam' then
    v_summary := pg_catalog.array_to_string(v_class_names, ', ') || ' 시험일 충돌';
    v_problem := case when v_conflict ->> 'examRule' = 'same-day-subject'
      then v_exam_date::text || ' ' || coalesce(
        nullif(pg_catalog.array_to_string(v_all_exam_subjects, ', '), ''),
        v_subject
      ) || ' 시험일에 수업이 배치되어 있습니다.'
      else v_exam_date::text || ' ' || coalesce(
        nullif(pg_catalog.array_to_string(v_all_exam_subjects, ', '), ''),
        '다른 과목'
      ) || ' 시험 전날에 수업이 배치되어 있습니다.' end ||
      ' 영향 학생: ' || pg_catalog.array_to_string(v_affected_student_names, ', ');
    v_resolution := '1. 담당 선생님이 시험일과 수업일을 확인\n2. 필요한 보강일을 협의\n3. 수업일정을 수정하고 학생에게 안내';
    v_due := ((v_session_date - 1)::timestamp + time '18:00') at time zone 'Asia/Seoul';
  elsif v_type = 'teacher' then
    v_summary := pg_catalog.array_to_string(v_class_names, ', ') || ' 선생님 시간 충돌';
    v_problem := coalesce(nullif(pg_catalog.array_to_string(v_teacher_labels, ', '), ''), '담당 선생님') ||
      ' 선생님의 ' || pg_catalog.array_to_string(v_class_names, ', ') || ' 수업 시간이 겹칩니다.';
    v_resolution := '1. 담당 선생님이 두 수업을 확인\n2. 대체 시간 또는 대체 선생님을 협의\n3. 수업일정을 수정';
  elsif v_type = 'classroom' then
    v_summary := pg_catalog.array_to_string(v_class_names, ', ') || ' 강의실 충돌';
    v_problem := coalesce(nullif(pg_catalog.array_to_string(v_classroom_labels, ', '), ''), '같은 강의실') ||
      '에 ' || pg_catalog.array_to_string(v_class_names, ', ') || ' 수업 시간이 겹칩니다.';
    v_resolution := '1. 관리팀이 강의실 사용을 확인\n2. 대체 강의실을 지정\n3. 수업일정을 수정';
  else
    v_summary := pg_catalog.array_to_string(v_class_names, ', ') || ' 학생 시간 충돌';
    v_problem := coalesce(nullif(v_student_rows[1] ->> 'name', ''), v_student_ids[1]) ||
      ' 학생의 ' || pg_catalog.array_to_string(v_class_names, ', ') || ' 수업 시간이 겹칩니다.';
    v_resolution := '1. 두 담당 선생님이 학생 수강일정을 확인\n2. 학생과 대체 시간을 협의\n3. 수업일정을 수정';
  end if;
  if v_type <> 'exam' then
    v_next_occurrence := (pg_catalog.now() at time zone 'Asia/Seoul')::date +
      mod(
        pg_catalog.array_position(array['월', '화', '수', '목', '금', '토', '일'], v_conflict ->> 'weekday') -
        pg_catalog.date_part('isodow', pg_catalog.now() at time zone 'Asia/Seoul')::integer + 7,
        7
      );
    if v_next_occurrence = (pg_catalog.now() at time zone 'Asia/Seoul')::date
      and (v_conflict ->> 'overlapStart')::time <= (pg_catalog.now() at time zone 'Asia/Seoul')::time
    then
      v_next_occurrence := v_next_occurrence + 7;
    end if;
    v_due := ((v_next_occurrence - 1)::timestamp + time '18:00') at time zone 'Asia/Seoul';
  end if;
  v_owner := case
    when v_type = 'classroom' then '관리팀'
    when pg_catalog.cardinality(v_profile_ids) > 0 then '담당 선생님'
    when pg_catalog.cardinality(v_teacher_labels) > 0
      then '관리팀 (담당 ' || pg_catalog.array_to_string(v_teacher_labels, ', ') || ')'
    else '관리팀'
  end;
  if v_due is null or v_due <= pg_catalog.clock_timestamp() then
    v_due := (((pg_catalog.now() at time zone 'Asia/Seoul')::date)::timestamp + time '23:59') at time zone 'Asia/Seoul';
  end if;

  v_task := dashboard_private.insert_ops_task_from_json_v2(
    pg_catalog.jsonb_build_object('task', pg_catalog.jsonb_build_object(
      'title', '[일정 충돌] ' || v_summary,
      'type', 'general',
      'status', 'requested',
      'priority', 'high',
      'requested_by', v_actor,
      'requested_team', '운영팀',
      'assignee_id', v_primary,
      'assignee_team', case
        when v_type = 'classroom' or pg_catalog.cardinality(v_profile_ids) = 0 then '관리팀'
        else null
      end,
      'secondary_assignee_id', v_secondary,
      'class_id', case when pg_catalog.cardinality(v_class_ids) = 1 then v_class_ids[1] else null end,
      'class_name', pg_catalog.array_to_string(v_class_names, ', '),
      'campus', v_single_campus,
      'subject', v_single_subject,
      'due_at', v_due,
      'memo', '[충돌 키] ' || v_key || E'\n[발생] ' ||
        case when v_type = 'exam' then v_exam_date::text else (v_conflict ->> 'weekday') || ' ' || (v_conflict ->> 'overlapStart') || '-' || (v_conflict ->> 'overlapEnd') end ||
        E'\n[수업] ' || pg_catalog.array_to_string(v_class_names, ', ') ||
        E'\n[문제] ' || v_problem || E'\n[담당] ' || v_owner ||
        case when pg_catalog.cardinality(v_unlinked_teacher_labels) > 0
          then E'\n[계정 미연결 담당] ' || pg_catalog.array_to_string(v_unlinked_teacher_labels, ', ')
          else '' end ||
        E'\n[처리] ' || v_resolution
    )),
    v_actor
  );

  insert into dashboard_private.dashboard_conflict_task_links(
    conflict_key, task_id, conflict_type, created_by
  ) values (v_key, v_task.id, v_type, v_actor);

  v_response := dashboard_private.dashboard_conflict_link_response_v1(v_key, v_actor, false);
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'create_dashboard_conflict_task_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.list_dashboard_conflict_task_links_v1(p_conflicts jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_item jsonb;
  v_normalized jsonb;
  v_key text;
  v_seen text[] := array[]::text[];
  v_result jsonb := '[]'::jsonb;
begin
  v_actor := dashboard_private.dashboard_conflict_assert_role_v1(false);
  if pg_catalog.jsonb_typeof(p_conflicts) <> 'array' or pg_catalog.jsonb_array_length(p_conflicts) > 250 then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_conflicts) loop
    v_normalized := dashboard_private.normalize_dashboard_conflict_v1(v_item);
    v_key := dashboard_private.dashboard_conflict_key_v1(v_normalized);
    if v_key = any(v_seen) then
      raise exception 'dashboard_conflict_duplicate_key' using errcode = '22023';
    end if;
    v_seen := pg_catalog.array_append(v_seen, v_key);
    v_result := v_result || pg_catalog.jsonb_build_array(
      dashboard_private.dashboard_conflict_link_response_v1(v_key, v_actor, true)
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.create_dashboard_conflict_task_v1(
  p_conflict jsonb,
  p_request_id uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dashboard_private.create_dashboard_conflict_task_v1_impl(p_conflict, p_request_id);
$$;

create or replace function public.get_dashboard_conflict_notification_counts_v1(p_task_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_ids uuid[];
  v_source_event_ids uuid[] := array[]::uuid[];
  v_notification_event_ids uuid[] := array[]::uuid[];
  v_task_event_count integer := 0;
  v_notification_event_count integer := 0;
  v_fanout_count integer := 0;
  v_delivery_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.array_agg(distinct id order by id), array[]::uuid[])
    into v_task_ids
  from pg_catalog.unnest(coalesce(p_task_ids, array[]::uuid[])) id;
  if pg_catalog.cardinality(v_task_ids) > 20 then
    raise exception 'dashboard_conflict_input_invalid' using errcode = '22023';
  end if;

  select pg_catalog.count(*), coalesce(pg_catalog.array_agg(event_row.id order by event_row.id), array[]::uuid[])
    into v_task_event_count, v_source_event_ids
  from public.ops_task_events event_row
  where event_row.task_id = any(v_task_ids);
  select pg_catalog.count(*), coalesce(pg_catalog.array_agg(event_row.id order by event_row.id), array[]::uuid[])
    into v_notification_event_count, v_notification_event_ids
  from dashboard_private.notification_events event_row
  where event_row.source_type = 'ops_task_event'
    and event_row.source_id in (
      select source_event_id::text from pg_catalog.unnest(v_source_event_ids) source_event_id
    );
  select pg_catalog.count(*) into v_fanout_count
  from dashboard_private.notification_event_fanout_jobs job
  where job.event_id = any(v_notification_event_ids);
  select pg_catalog.count(*) into v_delivery_count
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = any(v_notification_event_ids);

  return pg_catalog.jsonb_build_object(
    'taskEvents', v_task_event_count,
    'notificationEvents', v_notification_event_count,
    'fanoutJobs', v_fanout_count,
    'deliveries', v_delivery_count
  );
end;
$$;

create or replace function public.cleanup_dashboard_conflict_fixture_v1(
  p_task_ids uuid[],
  p_class_ids uuid[]
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_ids uuid[];
  v_class_ids uuid[];
  v_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.array_agg(distinct id order by id), array[]::uuid[])
    into v_task_ids
  from pg_catalog.unnest(coalesce(p_task_ids, array[]::uuid[])) id;
  select coalesce(pg_catalog.array_agg(distinct id order by id), array[]::uuid[])
    into v_class_ids
  from pg_catalog.unnest(coalesce(p_class_ids, array[]::uuid[])) id;
  if pg_catalog.cardinality(v_class_ids) not between 1 and 4
    or pg_catalog.cardinality(v_task_ids) > 4
  then
    raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
  end if;

  select pg_catalog.count(*) into v_count
  from public.classes source_class
  where source_class.id = any(v_class_ids)
    and coalesce(
      nullif(pg_catalog.to_jsonb(source_class) ->> 'name', ''),
      nullif(pg_catalog.to_jsonb(source_class) ->> 'class_name', ''),
      ''
    ) is not null
    and pg_catalog.left(
      coalesce(
        nullif(pg_catalog.to_jsonb(source_class) ->> 'name', ''),
        nullif(pg_catalog.to_jsonb(source_class) ->> 'class_name', ''),
        ''
      ),
      pg_catalog.char_length('__dashboard_conflict_verify__')
    ) = '__dashboard_conflict_verify__';
  if v_count <> pg_catalog.cardinality(v_class_ids) then
    raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.array_agg(distinct task_id order by task_id), array[]::uuid[])
    into v_task_ids
  from (
    select supplied_task_id as task_id
    from pg_catalog.unnest(v_task_ids) supplied_task_id
    union all
    select link.task_id
    from dashboard_private.dashboard_conflict_task_links link
    join public.ops_tasks task on task.id = link.task_id
    where task.created_at >= pg_catalog.clock_timestamp() - interval '1 hour'
      and task.title like '[일정 충돌]%'
      and exists (
        select 1
        from pg_catalog.unnest(v_class_ids) class_id
        where link.conflict_key like '%' || class_id::text || '%'
      )
  ) scoped_tasks;
  if pg_catalog.cardinality(v_task_ids) > 4 then
    raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
  end if;

  if pg_catalog.cardinality(v_task_ids) > 0 then
    select pg_catalog.count(*) into v_count
    from dashboard_private.dashboard_conflict_task_links link
    join public.ops_tasks task on task.id = link.task_id
    where task.id = any(v_task_ids)
      and task.created_at >= pg_catalog.clock_timestamp() - interval '1 hour'
      and task.title like '[일정 충돌]%'
      and exists (
        select 1
        from pg_catalog.unnest(v_class_ids) class_id
        where link.conflict_key like '%' || class_id::text || '%'
      );
    if v_count <> pg_catalog.cardinality(v_task_ids) then
      raise exception 'dashboard_conflict_verification_denied' using errcode = '42501';
    end if;
    delete from dashboard_private.dashboard_conflict_task_links link
    where link.task_id = any(v_task_ids);
    delete from public.ops_tasks task where task.id = any(v_task_ids);
  end if;
  delete from public.classes source_class where source_class.id = any(v_class_ids);
end;
$$;

create or replace function dashboard_private.guard_dashboard_conflict_task_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from dashboard_private.dashboard_conflict_task_links link where link.task_id = old.id
  ) then
    raise exception 'dashboard_conflict_task_delete_forbidden' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_dashboard_conflict_task_delete on public.ops_tasks;
create trigger guard_dashboard_conflict_task_delete
before delete on public.ops_tasks
for each row execute function dashboard_private.guard_dashboard_conflict_task_delete_v1();

revoke all on table dashboard_private.dashboard_conflict_task_links
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.dashboard_conflict_verification_checkpoints
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_text_array_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_uuid_array_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_normalize_time_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_normalize_subject_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_event_type_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_subject_from_event_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_event_date_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_exam_reference_matches_student_v1(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_exam_subjects_for_student_v1(jsonb, date)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.normalize_dashboard_conflict_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_key_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_assert_role_v1(boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_task_visible_v1(public.ops_tasks, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_link_response_v1(text, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_minutes_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_class_has_slot_v1(jsonb, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_class_has_session_v1(jsonb, date)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_json_array_contains_v1(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_student_registered_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_resource_overlap_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_resource_key_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_normalize_classroom_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_is_classroom_token_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_class_slots_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_class_is_active_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.dashboard_conflict_checkpoint_wait_v1(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_dashboard_conflict_task_v1_impl(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.guard_dashboard_conflict_task_delete_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.list_dashboard_conflict_task_links_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_dashboard_conflict_task_v1(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_dashboard_conflict_notification_counts_v1(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_dashboard_conflict_fixture_v1(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.list_dashboard_conflict_task_links_v1(jsonb) to authenticated;
grant execute on function public.create_dashboard_conflict_task_v1(jsonb, uuid) to authenticated;
grant execute on function public.get_dashboard_conflict_notification_counts_v1(uuid[]) to service_role;
grant execute on function public.cleanup_dashboard_conflict_fixture_v1(uuid[], uuid[]) to service_role;

revoke all on function public.arm_dashboard_conflict_checkpoint_v1(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.get_dashboard_conflict_checkpoint_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_dashboard_conflict_checkpoint_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.disarm_dashboard_conflict_checkpoint_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.arm_dashboard_conflict_checkpoint_v1(uuid, text, uuid[]) to service_role;
grant execute on function public.get_dashboard_conflict_checkpoint_v1(uuid, text) to service_role;
grant execute on function public.release_dashboard_conflict_checkpoint_v1(uuid, text) to service_role;
grant execute on function public.disarm_dashboard_conflict_checkpoint_v1(uuid, text) to service_role;

commit;
