-- Definitive source-state conflicts are check violations, not serialization failures.
-- Preserve the final function's authentication, locks, idempotency, and no-send behavior.
begin;

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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
    raise exception 'dashboard_conflict_stale' using errcode = '23514';
  end if;
  foreach v_class in array v_class_rows loop
    if not dashboard_private.dashboard_conflict_class_is_active_v1(v_class) then
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
    end if;
  end loop;

  foreach v_id in array v_student_ids loop
    select pg_catalog.to_jsonb(source_student) into v_student
    from public.students source_student
    where source_student.id = v_id::uuid
    for update of source_student;
    if not found then raise exception 'dashboard_conflict_stale' using errcode = '23514'; end if;
    v_student_rows := pg_catalog.array_append(v_student_rows, v_student);
    if v_type = 'exam' and not dashboard_private.dashboard_conflict_student_registered_v1(
      v_class_rows[1], v_student
    ) then
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
    end if;
    perform 1 from public.teacher_catalogs source_teacher
    where source_teacher.id = any(v_derived_teacher_ids::uuid[])
      and dashboard_private.dashboard_conflict_resource_key_v1(source_teacher.name) = any(v_resource_keys)
    order by source_teacher.id
    for update of source_teacher;
    get diagnostics v_count = row_count;
    if v_count <> pg_catalog.cardinality(v_derived_teacher_ids) then
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
        raise exception 'dashboard_conflict_stale' using errcode = '23514';
      end if;
    end loop;
  elsif v_type = 'exam' then
    v_subject := dashboard_private.dashboard_conflict_normalize_subject_v1(v_class_rows[1] ->> 'subject');
    if v_subject = '' or not dashboard_private.dashboard_conflict_class_has_session_v1(v_class_rows[1], v_session_date) then
      raise exception 'dashboard_conflict_stale' using errcode = '23514';
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
        raise exception 'dashboard_conflict_stale' using errcode = '23514';
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

commit;
