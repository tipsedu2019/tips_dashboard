begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.registration_customer_message_legacy_slots_v1(
  p_schedule text,
  p_teacher text,
  p_room text
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_line text;
  v_match text[];
  v_days text;
  v_day text;
  v_start_text text;
  v_end_text text;
  v_start_time time;
  v_end_time time;
  v_weekday integer;
  v_day_index integer;
  v_sort_order integer;
  v_slot_key text;
  v_seen jsonb := '{}'::jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_sorted jsonb;
begin
  if nullif(pg_catalog.btrim(p_schedule), '') is null
    or nullif(pg_catalog.btrim(p_teacher), '') is null
    or nullif(pg_catalog.btrim(p_room), '') is null then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  foreach v_line in array pg_catalog.regexp_split_to_array(
    pg_catalog.btrim(p_schedule),
    E'\\r?\\n'
  ) loop
    v_match := pg_catalog.regexp_match(
      pg_catalog.btrim(v_line),
      '^([월화수목금토일]+)[[:space:]]+([0-9]{2}:[0-9]{2})-([0-9]{2}:[0-9]{2})$'
    );
    if v_match is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    v_days := v_match[1];
    v_start_text := v_match[2];
    v_end_text := v_match[3];
    if pg_catalog.substr(v_start_text, 1, 2)::integer > 23
      or pg_catalog.substr(v_start_text, 4, 2)::integer > 59
      or pg_catalog.substr(v_end_text, 1, 2)::integer > 23
      or pg_catalog.substr(v_end_text, 4, 2)::integer > 59 then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    v_start_time := v_start_text::time;
    v_end_time := v_end_text::time;
    if v_start_time >= v_end_time then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    for v_day_index in 1..pg_catalog.char_length(v_days) loop
      v_day := pg_catalog.substr(v_days, v_day_index, 1);
      v_weekday := case v_day
        when '일' then 0
        when '월' then 1
        when '화' then 2
        when '수' then 3
        when '목' then 4
        when '금' then 5
        when '토' then 6
        else null
      end;
      if v_weekday is null then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;

      v_slot_key := v_weekday::text || ':' || v_start_text || ':' || v_end_text;
      if v_seen ? v_slot_key then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;
      v_seen := v_seen || pg_catalog.jsonb_build_object(v_slot_key, true);
      v_sort_order := (case when v_weekday = 0 then 6 else v_weekday - 1 end) * 1000;
      v_slots := v_slots || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'slotId', null,
          'weekday', v_weekday,
          'startTime', v_start_text,
          'endTime', v_end_text,
          'teacherName', pg_catalog.btrim(p_teacher),
          'classroomName', pg_catalog.btrim(p_room),
          'sortOrder', v_sort_order,
          'updatedAt', null
        )
      );
    end loop;
  end loop;

  if pg_catalog.jsonb_array_length(v_slots) = 0 then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  select pg_catalog.jsonb_agg(
    slot.value
    order by
      (slot.value ->> 'sortOrder')::integer,
      slot.value ->> 'startTime',
      slot.value ->> 'endTime'
  )
  into v_sorted
  from pg_catalog.jsonb_array_elements(v_slots) slot(value);

  return v_sorted;
end;
$$;

alter function dashboard_private.registration_customer_message_legacy_slots_v1(text, text, text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_legacy_slots_v1(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.registration_customer_message_admission_plan_v1(
  p_enrollment_id uuid,
  p_runtime_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_textbook public.textbooks%rowtype;
  v_session public.class_lesson_sessions%rowtype;
  v_authority text;
  v_slots jsonb;
  v_first_lesson jsonb;
  v_schedule_hash text;
  v_plan_sessions jsonb;
  v_plan_session jsonb;
  v_plan_date_text text;
  v_plan_number_text text;
  v_plan_key text;
  v_plan_state text;
  v_plan_start_text text;
  v_plan_end_text text;
  v_plan_start_time time;
  v_plan_end_time time;
  v_plan_match_count integer := 0;
  v_candidate_count integer;
  v_candidate_slot jsonb;
  v_textbook_name text;
begin
  if p_enrollment_id is null or p_runtime_version is null or p_runtime_version < 0 then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id
  for share;

  if not found
    or v_enrollment.status <> 'planned'
    or v_enrollment.admission_batch_id is not null
    or v_enrollment.class_start_date is null
    or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_enrollment.track_id
    and track.workflow_status = 'enrollment_requested'
  for share;

  if not found then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = v_enrollment.class_id
  for share;

  if not found
    or nullif(pg_catalog.btrim(v_class.name), '') is null
    or nullif(pg_catalog.btrim(v_class.subject), '') is null
    or v_class.subject is distinct from v_track.subject then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  if v_enrollment.textbook_id is not null then
    select textbook.*
    into v_textbook
    from public.textbooks textbook
    where textbook.id = v_enrollment.textbook_id
    for share;
    if not found then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;
    v_textbook_name := coalesce(
      nullif(pg_catalog.btrim(v_textbook.name), ''),
      nullif(pg_catalog.btrim(v_textbook.title), '')
    );
    if v_textbook_name is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;
  end if;

  if public.continuous_class_schedule_runtime_version() = 1
    and p_runtime_version = 1
    and v_class.schedule_storage_mode = 'normalized' then
    v_authority := 'normalized';
    if v_enrollment.class_start_lesson_session_id is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    perform slot.id
    from public.class_schedule_slots slot
    where slot.class_id = v_class.id
    order by slot.sort_order, slot.weekday, slot.start_time, slot.id
    for share;

    if not found or exists (
      select 1
      from public.class_schedule_slots slot
      where slot.class_id = v_class.id
        and (
          slot.start_time >= slot.end_time
          or nullif(pg_catalog.btrim(slot.teacher_name), '') is null
          or nullif(pg_catalog.btrim(slot.classroom_name), '') is null
        )
    ) then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'slotId', slot.id,
        'weekday', slot.weekday,
        'startTime', pg_catalog.to_char(slot.start_time, 'HH24:MI'),
        'endTime', pg_catalog.to_char(slot.end_time, 'HH24:MI'),
        'teacherName', pg_catalog.btrim(slot.teacher_name),
        'classroomName', pg_catalog.btrim(slot.classroom_name),
        'sortOrder', slot.sort_order,
        'updatedAt', slot.updated_at
      )
      order by slot.sort_order, slot.weekday, slot.start_time, slot.id
    )
    into v_slots
    from public.class_schedule_slots slot
    where slot.class_id = v_class.id;

    select session.*
    into v_session
    from public.class_lesson_sessions session
    where session.id = v_enrollment.class_start_lesson_session_id
      and session.class_id = v_enrollment.class_id
      and session.session_date = v_enrollment.class_start_date
      and session.session_key = v_enrollment.class_start_session_key
      and session.schedule_state in ('active', 'makeup')
      and session.start_time is not null
      and session.end_time is not null
      and session.start_time < session.end_time
      and nullif(pg_catalog.btrim(session.teacher_name_snapshot), '') is not null
      and nullif(pg_catalog.btrim(session.classroom_name_snapshot), '') is not null
    for share;

    if not found then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    v_first_lesson := pg_catalog.jsonb_build_object(
      'sessionId', v_session.id,
      'sessionKey', v_session.session_key,
      'sessionDate', pg_catalog.to_char(v_session.session_date, 'YYYY-MM-DD'),
      'scheduleState', v_session.schedule_state,
      'startTime', pg_catalog.to_char(v_session.start_time, 'HH24:MI'),
      'endTime', pg_catalog.to_char(v_session.end_time, 'HH24:MI'),
      'revision', v_session.revision,
      'updatedAt', v_session.updated_at
    );
    v_schedule_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'slots', v_slots,
          'firstLesson', v_first_lesson
        )
      )
    );
  else
    v_authority := 'legacy';
    v_slots := dashboard_private.registration_customer_message_legacy_slots_v1(
      v_class.schedule,
      v_class.teacher,
      v_class.room
    );
    v_plan_sessions := case
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'sessions') = 'array'
        then v_class.schedule_plan -> 'sessions'
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'session_list') = 'array'
        then v_class.schedule_plan -> 'session_list'
      else null
    end;
    if v_plan_sessions is null then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    for v_plan_session in
      select item.value
      from pg_catalog.jsonb_array_elements(v_plan_sessions) item(value)
    loop
      v_plan_date_text := coalesce(
        nullif(pg_catalog.btrim(v_plan_session ->> 'date'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'session_date'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'dateValue'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'date_value'), '')
      );
      v_plan_number_text := coalesce(
        nullif(pg_catalog.btrim(v_plan_session ->> 'sessionNumber'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'session_number'), '')
      );
      if v_plan_date_text !~ '^\d{4}-\d{2}-\d{2}$'
        or v_plan_number_text !~ '^[1-9]\d*$' then
        continue;
      end if;
      begin
        v_plan_key := pg_catalog.to_char(v_plan_date_text::date, 'YYYY-MM-DD')
          || ':' || v_plan_number_text::integer::text;
      exception when others then
        continue;
      end;
      if v_plan_date_text::date <> v_enrollment.class_start_date
        or v_plan_key <> pg_catalog.btrim(v_enrollment.class_start_session_key) then
        continue;
      end if;

      v_plan_match_count := v_plan_match_count + 1;
      v_plan_state := pg_catalog.lower(coalesce(
        nullif(pg_catalog.btrim(v_plan_session ->> 'scheduleState'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'schedule_state'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'state'), ''),
        'active'
      ));
      v_plan_start_text := coalesce(
        nullif(pg_catalog.btrim(v_plan_session ->> 'startTime'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'start_time'), '')
      );
      v_plan_end_text := coalesce(
        nullif(pg_catalog.btrim(v_plan_session ->> 'endTime'), ''),
        nullif(pg_catalog.btrim(v_plan_session ->> 'end_time'), '')
      );
    end loop;

    if v_plan_match_count <> 1
      or v_plan_state not in ('active', 'normal', 'makeup')
      or (v_plan_start_text is null) <> (v_plan_end_text is null) then
      raise exception 'registration_customer_message_admission_schedule_incomplete'
        using errcode = '22023';
    end if;

    if v_plan_start_text is not null then
      if v_plan_start_text !~ '^[0-9]{2}:[0-9]{2}$'
        or v_plan_end_text !~ '^[0-9]{2}:[0-9]{2}$'
        or pg_catalog.substr(v_plan_start_text, 1, 2)::integer > 23
        or pg_catalog.substr(v_plan_start_text, 4, 2)::integer > 59
        or pg_catalog.substr(v_plan_end_text, 1, 2)::integer > 23
        or pg_catalog.substr(v_plan_end_text, 4, 2)::integer > 59 then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;
      v_plan_start_time := v_plan_start_text::time;
      v_plan_end_time := v_plan_end_text::time;
      if v_plan_start_time >= v_plan_end_time then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;
    else
      if v_plan_state not in ('active', 'normal') then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;
      select pg_catalog.count(*)::integer
      into v_candidate_count
      from pg_catalog.jsonb_array_elements(v_slots) slot(value)
      where (slot.value ->> 'weekday')::integer =
        pg_catalog.date_part('dow', v_enrollment.class_start_date)::integer;
      if v_candidate_count <> 1 then
        raise exception 'registration_customer_message_admission_schedule_incomplete'
          using errcode = '22023';
      end if;
      select slot.value
      into v_candidate_slot
      from pg_catalog.jsonb_array_elements(v_slots) slot(value)
      where (slot.value ->> 'weekday')::integer =
        pg_catalog.date_part('dow', v_enrollment.class_start_date)::integer;
      v_plan_start_text := v_candidate_slot ->> 'startTime';
      v_plan_end_text := v_candidate_slot ->> 'endTime';
    end if;

    v_first_lesson := pg_catalog.jsonb_build_object(
      'sessionId', null,
      'sessionKey', pg_catalog.btrim(v_enrollment.class_start_session_key),
      'sessionDate', pg_catalog.to_char(v_enrollment.class_start_date, 'YYYY-MM-DD'),
      'scheduleState', case when v_plan_state = 'makeup' then 'makeup' else 'active' end,
      'startTime', v_plan_start_text,
      'endTime', v_plan_end_text,
      'revision', null,
      'updatedAt', null
    );
    v_schedule_hash := dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'schedule', v_class.schedule,
          'schedulePlan', v_class.schedule_plan,
          'teacher', v_class.teacher,
          'room', v_class.room
        )
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'enrollmentId', v_enrollment.id,
    'trackId', v_track.id,
    'subject', v_track.subject,
    'sortOrder', v_enrollment.sort_order,
    'workflowStatus', v_track.workflow_status,
    'workflowRevision', v_track.workflow_revision,
    'enrollmentUpdatedAt', v_enrollment.updated_at,
    'classId', v_class.id,
    'classSubject', v_class.subject,
    'className', pg_catalog.btrim(v_class.name),
    'classUpdatedAt', coalesce(v_class.created_at, v_enrollment.updated_at),
    'textbookId', v_enrollment.textbook_id,
    'textbookName', case when v_enrollment.textbook_id is null then null else v_textbook_name end,
    'textbookUpdatedAt', case
      when v_enrollment.textbook_id is null then null
      else coalesce(v_textbook.updated_at, v_textbook.created_at, v_enrollment.updated_at)
    end,
    'runtimeVersion', p_runtime_version,
    'storageMode', v_class.schedule_storage_mode,
    'authority', v_authority,
    'scheduleRevision', v_class.schedule_revision,
    'scheduleHash', v_schedule_hash,
    'slots', v_slots,
    'firstLesson', v_first_lesson
  );
end;
$$;

alter function dashboard_private.registration_customer_message_admission_plan_v1(uuid, integer)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_admission_plan_v1(uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.resolve_registration_customer_message_source_v1_impl(p_message_kind text, p_source_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_phone_digits text;
  v_appointment public.ops_registration_appointments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_subjects jsonb;
  v_tracks jsonb;
  v_participants jsonb;
  v_enrollment_plans jsonb := '[]'::jsonb;
  v_enrollment_id uuid;
  v_enrollment_plan jsonb;
  v_runtime_version integer;
  v_expected_waiting_kind text;
begin
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
    and nullif(pg_catalog.btrim(task.student_name), '') is not null
  for share;

  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for share;

  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  if v_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  if p_message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder'
  ) then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_source_id
      and appointment.task_id = v_task_id
      and appointment.status = 'scheduled'
      and appointment.scheduled_at > pg_catalog.clock_timestamp()
    for share;

    if not found
      or (p_message_kind = 'level_test_booking' and v_appointment.kind <> 'level_test')
      or (
        p_message_kind = 'visit_consultation_booking'
        and v_appointment.kind <> 'visit_consultation'
      ) then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;

    if v_appointment.kind = 'level_test' then
      perform 1
      from public.ops_registration_level_tests level_test
      join public.ops_registration_subject_tracks track
        on track.id = level_test.track_id
      where level_test.appointment_id = v_appointment.id
      order by level_test.id, track.id
      for share of level_test, track;

      select
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'trackId', participant.track_id,
            'subject', participant.subject,
            'workflowStatus', participant.workflow_status,
            'workflowRevision', participant.workflow_revision,
            'activityId', participant.activity_id,
            'activityStatus', participant.activity_status
          ) order by participant.subject_order, participant.track_id, participant.activity_id
        ),
        pg_catalog.jsonb_agg(
          participant.subject
          order by participant.subject_order, participant.track_id
        )
      into v_participants, v_subjects
      from (
        select
          track.id as track_id,
          track.subject,
          track.workflow_status,
          track.workflow_revision,
          level_test.id as activity_id,
          level_test.status as activity_status,
          case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
            as subject_order
        from public.ops_registration_level_tests level_test
        join public.ops_registration_subject_tracks track
          on track.id = level_test.track_id
        where level_test.appointment_id = v_appointment.id
          and level_test.status in ('scheduled', 'in_progress')
          and track.task_id = v_task_id
          and track.workflow_status = 'level_test_requested'
      ) participant;
    else
      perform 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment.id
      order by consultation.id, track.id
      for share of consultation, track;

      select
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'trackId', participant.track_id,
            'subject', participant.subject,
            'workflowStatus', participant.workflow_status,
            'workflowRevision', participant.workflow_revision,
            'activityId', participant.activity_id,
            'activityStatus', participant.activity_status
          ) order by participant.subject_order, participant.track_id, participant.activity_id
        ),
        pg_catalog.jsonb_agg(
          participant.subject
          order by participant.subject_order, participant.track_id
        )
      into v_participants, v_subjects
      from (
        select
          track.id as track_id,
          track.subject,
          track.workflow_status,
          track.workflow_revision,
          consultation.id as activity_id,
          consultation.status as activity_status,
          case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
            as subject_order
        from public.ops_registration_consultations consultation
        join public.ops_registration_subject_tracks track
          on track.id = consultation.track_id
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and track.task_id = v_task_id
          and track.workflow_status = 'consultation_requested'
      ) participant;
    end if;

    if v_participants is null
      or pg_catalog.jsonb_array_length(v_participants) = 0 then
      raise exception 'registration_customer_message_source_ineligible'
        using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'messageKind', p_message_kind,
      'sourceId', p_source_id,
      'taskId', v_task_id,
      'trackId', null,
      'appointmentId', v_appointment.id,
      'sourceRevision', v_appointment.notification_revision,
      'studentName', pg_catalog.btrim(v_task.student_name),
      'parentPhoneDigits', v_phone_digits,
      'subjects', v_subjects,
      'appointmentKind', v_appointment.kind,
      'scheduledAt', v_appointment.scheduled_at,
      'place', pg_catalog.btrim(v_appointment.place),
      'participants', v_participants
    );
  elsif p_message_kind = 'waiting_notice' then
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = p_source_id
      and track.task_id = v_task_id
    for share;

    if not found then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;

    v_expected_waiting_kind := case v_track.workflow_status
      when 'waiting_current_class' then 'current_class'
      when 'waiting_new_class' then 'current_term_opening'
      when 'waiting_next_opening' then 'next_term_opening'
      else null
    end;

    if v_expected_waiting_kind is null
      or v_track.waiting_detail_kind is distinct from v_expected_waiting_kind then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    if v_track.pipeline_status = 'waiting'
      and v_track.waiting_kind is not null
      and v_track.waiting_kind is distinct from v_track.waiting_detail_kind then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    if v_track.waiting_detail_kind = 'current_class' then
      if v_track.waiting_detail_class_id is null then
        raise exception 'registration_customer_message_waiting_source_inconsistent'
          using errcode = '22023';
      end if;
      select class.*
      into v_class
      from public.classes class
      where class.id = v_track.waiting_detail_class_id
        and nullif(pg_catalog.btrim(class.name), '') is not null
      for share;
      if not found then
        raise exception 'registration_customer_message_waiting_source_inconsistent'
          using errcode = '22023';
      end if;
    elsif v_track.waiting_detail_class_id is not null then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'messageKind', p_message_kind,
      'sourceId', p_source_id,
      'taskId', v_task_id,
      'trackId', v_track.id,
      'appointmentId', null,
      'sourceRevision', v_track.workflow_revision,
      'studentName', pg_catalog.btrim(v_task.student_name),
      'parentPhoneDigits', v_phone_digits,
      'subjects', pg_catalog.jsonb_build_array(v_track.subject),
      'workflowStatus', v_track.workflow_status,
      'waitingKind', v_track.waiting_detail_kind,
      'waitingClassId', v_track.waiting_detail_class_id,
      'waitingClassName', case
        when v_track.waiting_detail_kind = 'current_class' then pg_catalog.btrim(v_class.name)
        else null
      end
    );
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for share;

  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track
    on track.id = enrollment.track_id
  where track.task_id = v_task_id
  order by enrollment.id
  for share of enrollment;

  if v_detail.admission_notice_sent or exists (
    select 1
    from public.ops_registration_messages legacy_message
    where legacy_message.task_id = v_task_id
      and legacy_message.template_key = 'admission_application'
      and (
        legacy_message.status = 'accepted'
        or legacy_message.claim_active
      )
  ) then
    raise exception 'registration_customer_message_admission_already_sent'
      using errcode = '23505';
  end if;

  select
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', eligible.id,
        'subject', eligible.subject,
        'workflowStatus', eligible.workflow_status,
        'workflowRevision', eligible.workflow_revision,
        'pipelineStatus', eligible.pipeline_status
      ) order by eligible.subject_order, eligible.id
    ),
    pg_catalog.jsonb_agg(
      eligible.subject
      order by eligible.subject_order, eligible.id
    )
  into v_tracks, v_subjects
  from (
    select
      track.id,
      track.subject,
      track.workflow_status,
      track.workflow_revision,
      track.pipeline_status,
      case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
        as subject_order
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and track.workflow_status = 'enrollment_requested'
      and exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = track.id
          and enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
      )
  ) eligible;

  if v_tracks is null or pg_catalog.jsonb_array_length(v_tracks) = 0 then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  v_runtime_version := public.continuous_class_schedule_runtime_version();
  for v_enrollment_id in
    select enrollment.id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track
      on track.id = enrollment.track_id
    join public.classes class
      on class.id = enrollment.class_id
    where track.task_id = v_task_id
      and track.workflow_status = 'enrollment_requested'
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
    order by
      case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end,
      enrollment.sort_order,
      class.name collate "C",
      enrollment.id
  loop
    v_enrollment_plan := dashboard_private.registration_customer_message_admission_plan_v1(
      v_enrollment_id,
      v_runtime_version
    );
    v_enrollment_plans := v_enrollment_plans
      || pg_catalog.jsonb_build_array(v_enrollment_plan);
  end loop;

  if pg_catalog.jsonb_array_length(v_enrollment_plans) = 0 then
    raise exception 'registration_customer_message_admission_schedule_incomplete'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'sourceId', p_source_id,
    'taskId', v_task_id,
    'trackId', null,
    'appointmentId', null,
    'sourceRevision', v_detail.common_revision,
    'studentName', pg_catalog.btrim(v_task.student_name),
    'parentPhoneDigits', v_phone_digits,
    'subjects', v_subjects,
    'tracks', v_tracks,
    'enrollmentPlans', v_enrollment_plans
  );
end;
$$;

alter function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  from public, anon, authenticated, service_role;

alter table dashboard_private.registration_customer_reminder_jobs
  alter column available_at drop not null;

create or replace function public.release_registration_customer_reminder_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
begin
  if (select auth.role()) <> 'service_role'
    or v_error_code is null
    or pg_catalog.octet_length(v_error_code) > 120 then
    raise exception 'registration_customer_reminder_release_invalid'
      using errcode = '22023';
  end if;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case
        when v_error_code = 'source_ineligible' then 'canceled'
        else 'pending'
      end,
      claim_token = null,
      claim_expires_at = null,
      available_at = case
        when v_error_code = 'source_ineligible' then null
        else pg_catalog.clock_timestamp() + interval '5 minutes'
      end,
      last_error_code = v_error_code
  where job.appointment_id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.message_id is null;
  return pg_catalog.jsonb_build_object('released', found, 'jobId', p_job_id);
end;
$$;

alter function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  owner to postgres;
revoke all on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  to service_role;

commit;
