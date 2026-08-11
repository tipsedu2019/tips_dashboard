begin;

set local lock_timeout = '5s';

alter table public.ops_registration_enrollments
  add column class_start_source_observation_id uuid
    references public.ops_registration_observations(id) on delete restrict;

create index ops_registration_enrollments_class_start_source_observation_id_idx
  on public.ops_registration_enrollments(class_start_source_observation_id)
  where class_start_source_observation_id is not null;

create or replace function dashboard_private.validate_registration_observation_class_start_source_v1(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_class_start_date date,
  p_class_start_session_key text,
  p_class_start_lesson_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_observation record;
  v_session_key text;
  v_session_label text;
begin
  if (select auth.uid()) is null
    or p_track_id is null
    or p_observation_id is null
    or p_class_id is null
    or p_class_start_date is null
    or nullif(pg_catalog.btrim(p_class_start_session_key), '') is null
  then
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'save_enrollment_rows'
  );

  select
    observation.id,
    observation.task_id,
    observation.track_id,
    observation.class_id,
    observation.session_authority,
    observation.class_lesson_session_id,
    observation.legacy_session_key,
    observation.session_date,
    observation.starts_at,
    observation.ends_at,
    observation.status,
    observation.attendance,
    observation.suitability_result,
    observation.decision_kind,
    lesson.session_key as normalized_session_key
  into v_observation
  from public.ops_registration_observations observation
  join public.ops_registration_subject_tracks track
    on track.id = observation.track_id
   and track.task_id = observation.task_id
  left join public.class_lesson_sessions lesson
    on lesson.id = observation.class_lesson_session_id
   and lesson.class_id = observation.class_id
  where observation.id = p_observation_id
    and observation.task_id = v_task_id
    and observation.task_id = track.task_id
    and observation.track_id = p_track_id
    and observation.class_id = p_class_id
    and observation.status = 'completed'
    and observation.attendance = 'attended'
    and observation.suitability_result = 'fit'
    and observation.decision_kind = 'enrollment'
  for update of observation;

  if not found then
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  if v_observation.session_authority = 'normalized' then
    if v_observation.class_lesson_session_id is null
      or v_observation.normalized_session_key is null
      or p_class_start_lesson_session_id
        is distinct from v_observation.class_lesson_session_id
      or p_class_start_date is distinct from v_observation.session_date
      or pg_catalog.btrim(p_class_start_session_key)
        is distinct from v_observation.normalized_session_key
    then
      raise exception 'registration_observation_class_start_source_invalid'
        using errcode = '23514';
    end if;
    v_session_key := v_observation.normalized_session_key;
  elsif v_observation.session_authority = 'legacy' then
    if p_class_start_lesson_session_id is not null
      or nullif(pg_catalog.btrim(v_observation.legacy_session_key), '') is null
      or p_class_start_date is distinct from v_observation.session_date
      or pg_catalog.btrim(p_class_start_session_key)
        is distinct from pg_catalog.btrim(v_observation.legacy_session_key)
    then
      raise exception 'registration_observation_class_start_source_invalid'
        using errcode = '23514';
    end if;
    v_session_key := pg_catalog.btrim(v_observation.legacy_session_key);
  else
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;

  v_session_label :=
    pg_catalog.to_char(
      v_observation.starts_at at time zone 'Asia/Seoul',
      'YYYY-MM-DD HH24:MI'
    )
    || '–'
    || pg_catalog.to_char(
      v_observation.ends_at at time zone 'Asia/Seoul',
      'HH24:MI'
    );

  return pg_catalog.jsonb_build_object(
    'observationId', v_observation.id,
    'classId', v_observation.class_id,
    'classStartDate', v_observation.session_date,
    'classStartSessionKey', v_session_key,
    'classStartLessonSessionId',
      case
        when v_observation.session_authority = 'normalized'
          then v_observation.class_lesson_session_id
        else null
      end,
    'classStartSession', v_session_label
  );
end;
$$;

create or replace function dashboard_private.normalize_registration_enrollment_rows_request_v1(
  p_rows jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_allowed_keys constant text[] := array[
    'id',
    'classId',
    'textbookId',
    'classStartDate',
    'classStartSessionKey',
    'classStartLessonSessionId',
    'classStartSession',
    'classStartSourceObservationId',
    'sortOrder'
  ];
  v_input jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_id_text text;
  v_class_id_text text;
  v_textbook_id_text text;
  v_date_text text;
  v_session_key text;
  v_lesson_id_text text;
  v_session_label text;
  v_source_id_text text;
  v_sort_text text;
  v_sort_order integer;
  v_date date;
begin
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'registration_enrollment_rows_invalid'
      using errcode = '22023';
  end if;

  for v_input in
    select element.value
    from pg_catalog.jsonb_array_elements(p_rows) element(value)
  loop
    if pg_catalog.jsonb_typeof(v_input) <> 'object' then
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_input) supplied(key)
      where not (supplied.key = any(v_allowed_keys))
    ) then
      raise exception 'registration_enrollment_rows_unknown_key'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classId')
      or pg_catalog.jsonb_typeof(v_input -> 'classId') <> 'string'
      or not (v_input ? 'sortOrder')
      or pg_catalog.jsonb_typeof(v_input -> 'sortOrder') <> 'number'
    then
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    v_class_id_text := pg_catalog.lower(
      pg_catalog.btrim(v_input ->> 'classId')
    );
    if v_class_id_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    v_sort_text := v_input ->> 'sortOrder';
    if v_sort_text !~ '^-?[0-9]+$' then
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;
    begin
      if v_sort_text::numeric < -2147483648
        or v_sort_text::numeric > 2147483647
      then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
      v_sort_order := v_sort_text::integer;
    exception
      when numeric_value_out_of_range then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
    end;

    if not (v_input ? 'id') or v_input -> 'id' = 'null'::jsonb then
      v_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'id') = 'string' then
      v_id_text := pg_catalog.lower(pg_catalog.btrim(v_input ->> 'id'));
      if v_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'textbookId')
      or v_input -> 'textbookId' = 'null'::jsonb
    then
      v_textbook_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'textbookId') = 'string' then
      v_textbook_id_text := pg_catalog.lower(
        pg_catalog.btrim(v_input ->> 'textbookId')
      );
      if v_textbook_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classStartDate')
      or v_input -> 'classStartDate' = 'null'::jsonb
    then
      v_date_text := null;
      v_date := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'classStartDate') = 'string' then
      v_date_text := pg_catalog.btrim(v_input ->> 'classStartDate');
      if v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
      begin
        v_date := v_date_text::date;
      exception
        when others then
          raise exception 'registration_enrollment_rows_invalid'
            using errcode = '22023';
      end;
      if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> v_date_text then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classStartSessionKey')
      or v_input -> 'classStartSessionKey' = 'null'::jsonb
    then
      v_session_key := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'classStartSessionKey') = 'string' then
      v_session_key := nullif(
        pg_catalog.btrim(v_input ->> 'classStartSessionKey'),
        ''
      );
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classStartSession')
      or v_input -> 'classStartSession' = 'null'::jsonb
    then
      v_session_label := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'classStartSession') = 'string' then
      v_session_label := nullif(
        pg_catalog.btrim(v_input ->> 'classStartSession'),
        ''
      );
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classStartLessonSessionId')
      or v_input -> 'classStartLessonSessionId' = 'null'::jsonb
    then
      v_lesson_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_input -> 'classStartLessonSessionId') = 'string' then
      v_lesson_id_text := pg_catalog.lower(
        pg_catalog.btrim(v_input ->> 'classStartLessonSessionId')
      );
      if v_lesson_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if not (v_input ? 'classStartSourceObservationId')
      or v_input -> 'classStartSourceObservationId' = 'null'::jsonb
    then
      v_source_id_text := null;
    elsif pg_catalog.jsonb_typeof(
      v_input -> 'classStartSourceObservationId'
    ) = 'string' then
      v_source_id_text := pg_catalog.lower(
        pg_catalog.btrim(v_input ->> 'classStartSourceObservationId')
      );
      if v_source_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_enrollment_rows_invalid'
          using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid'
        using errcode = '22023';
    end if;

    if v_source_id_text is null and not (
      (
        v_date_text is null
        and v_session_key is null
        and v_session_label is null
        and v_lesson_id_text is null
      )
      or
      (
        v_date_text is not null
        and v_session_key is not null
        and v_session_label is not null
      )
    ) then
      raise exception 'registration_enrollment_schedule_incomplete'
        using errcode = '22023';
    end if;

    if v_source_id_text is not null
      and (v_date_text is null or v_session_key is null)
    then
      raise exception 'registration_enrollment_schedule_incomplete'
        using errcode = '22023';
    end if;

    v_rows := v_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', case when v_id_text is null then null else v_id_text::uuid end,
        'classId', v_class_id_text::uuid,
        'textbookId', case
          when v_textbook_id_text is null then null
          else v_textbook_id_text::uuid
        end,
        'classStartDate', v_date,
        'classStartSessionKey', v_session_key,
        'classStartLessonSessionId', case
          when v_lesson_id_text is null then null
          else v_lesson_id_text::uuid
        end,
        'classStartSession', v_session_label,
        'classStartSourceObservationId', case
          when v_source_id_text is null then null
          else v_source_id_text::uuid
        end,
        'sortOrder', v_sort_order
      )
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_rows) row_item(value)
    where row_item.value ->> 'id' is not null
    group by row_item.value ->> 'id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_enrollment_rows_duplicate_id'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_rows) row_item(value)
    group by row_item.value ->> 'classId'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_enrollment_rows_duplicate_class'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      row_item.value
      order by row_item.value ->> 'classId', row_item.value ->> 'id'
    ),
    '[]'::jsonb
  )
  into v_rows
  from pg_catalog.jsonb_array_elements(v_rows) row_item(value);

  return v_rows;
end;
$$;

create or replace function dashboard_private.save_registration_enrollment_rows_canonical_v1(
  p_track_id uuid,
  p_canonical_rows jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_row jsonb;
  v_bound_rows jsonb := '[]'::jsonb;
  v_final_rows jsonb := '[]'::jsonb;
  v_candidate_ids uuid[];
  v_candidate_id uuid;
  v_row_id uuid;
  v_class_id uuid;
  v_textbook_id uuid;
  v_source_id uuid;
  v_date date;
  v_session_key text;
  v_session_label text;
  v_lesson_id uuid;
  v_class record;
  v_session jsonb;
  v_written_ids uuid[] := array[]::uuid[];
  v_written_count integer := 0;
  v_rows_response jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_actor_id is null
    or p_actor_id is distinct from (select auth.uid())
    or p_track_id is null
    or p_canonical_rows is null
    or pg_catalog.jsonb_typeof(p_canonical_rows) <> 'array'
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'save_enrollment_rows'
  );

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if v_track.pipeline_status not in ('enrollment_decided', 'registered')
    and coalesce(
      pg_catalog.current_setting(
        'dashboard.registration_status_independent_enrollment',
        true
      ),
      ''
    ) <> 'on'
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_canonical_rows) source_row(value)
    where source_row.value ->> 'classStartSourceObservationId' is not null
  ) then
    perform dashboard_private.assert_registration_observation_runtime_v1();
  end if;

  -- enrollment_source_enrollment_locks
  for v_row in
    select row_item.value
    from pg_catalog.jsonb_array_elements(p_canonical_rows) row_item(value)
    order by row_item.value ->> 'classId', row_item.value ->> 'id'
  loop
    v_row_id := nullif(v_row ->> 'id', '')::uuid;
    v_class_id := (v_row ->> 'classId')::uuid;

    if v_row_id is not null then
      perform 1
      from public.ops_registration_enrollments enrollment
      where enrollment.id = v_row_id
        and enrollment.track_id = p_track_id
        and enrollment.status = 'planned'
        and enrollment.admission_batch_id is null
        and enrollment.student_id is null
        and not enrollment.roster_active
        and enrollment.roster_released_at is null
        and enrollment.roster_release_reason is null
        and enrollment.roster_release_source_task_id is null
        and enrollment.roster_release_kind is null
      for update;
      if not found then
        raise exception 'registration_enrollment_draft_not_editable'
          using errcode = '40001';
      end if;
    else
      v_candidate_ids := array[]::uuid[];
      for v_candidate_id in
        select enrollment.id
        from public.ops_registration_enrollments enrollment
        where enrollment.track_id = p_track_id
          and enrollment.class_id = v_class_id
          and enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
          and enrollment.student_id is null
          and not enrollment.roster_active
          and enrollment.roster_released_at is null
          and enrollment.roster_release_reason is null
          and enrollment.roster_release_source_task_id is null
          and enrollment.roster_release_kind is null
        order by enrollment.id
        for update
      loop
        v_candidate_ids := pg_catalog.array_append(
          v_candidate_ids,
          v_candidate_id
        );
      end loop;

      if pg_catalog.cardinality(v_candidate_ids) = 0 then
        v_row_id := extensions.gen_random_uuid();
      elsif pg_catalog.cardinality(v_candidate_ids) = 1 then
        v_row_id := v_candidate_ids[1];
      else
        raise exception 'registration_enrollment_draft_ambiguous'
          using errcode = '40001';
      end if;
    end if;

    v_bound_rows := v_bound_rows || pg_catalog.jsonb_build_array(
      v_row || pg_catalog.jsonb_build_object('id', v_row_id)
    );
  end loop;

  -- enrollment_source_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select (row_item.value ->> 'classId')::uuid
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
  )
  order by class.id
  for update;

  if (
    select pg_catalog.count(distinct class.id)
    from public.classes class
    where class.id in (
      select (row_item.value ->> 'classId')::uuid
      from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    )
  ) <> pg_catalog.jsonb_array_length(v_bound_rows) then
    raise exception 'registration_class_not_found' using errcode = 'P0002';
  end if;

  -- enrollment_source_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select (row_item.value ->> 'textbookId')::uuid
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    where row_item.value ->> 'textbookId' is not null
  )
  order by textbook.id
  for update;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    join public.classes class
      on class.id = (row_item.value ->> 'classId')::uuid
    where pg_catalog.btrim(class.subject) is distinct from v_track.subject
  ) then
    raise exception 'registration_class_subject_mismatch'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    join public.classes class
      on class.id = (row_item.value ->> 'classId')::uuid
    where row_item.value ->> 'textbookId' is not null
      and not (
        exists (
          select 1
          from public.textbooks textbook
          where textbook.id = (row_item.value ->> 'textbookId')::uuid
        )
        and pg_catalog.jsonb_typeof(
          coalesce(pg_catalog.to_jsonb(class.textbook_ids), '[]'::jsonb)
        ) = 'array'
        and coalesce(
          pg_catalog.to_jsonb(class.textbook_ids),
          '[]'::jsonb
        ) ? (row_item.value ->> 'textbookId')
      )
  ) then
    raise exception 'registration_textbook_class_mismatch'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    join public.ops_registration_enrollments enrollment
      on enrollment.track_id = p_track_id
     and enrollment.class_id = (row_item.value ->> 'classId')::uuid
     and enrollment.id is distinct from (row_item.value ->> 'id')::uuid
     and (enrollment.status = 'planned' or enrollment.roster_active)
  ) then
    raise exception 'registration_enrollment_class_conflict'
      using errcode = '40001';
  end if;

  -- enrollment_source_final_rows
  for v_row in
    select row_item.value
    from pg_catalog.jsonb_array_elements(v_bound_rows) row_item(value)
    order by row_item.value ->> 'classId', row_item.value ->> 'id'
  loop
    v_row_id := (v_row ->> 'id')::uuid;
    v_class_id := (v_row ->> 'classId')::uuid;
    v_textbook_id := nullif(v_row ->> 'textbookId', '')::uuid;
    v_source_id := nullif(
      v_row ->> 'classStartSourceObservationId',
      ''
    )::uuid;
    v_date := nullif(v_row ->> 'classStartDate', '')::date;
    v_session_key := nullif(
      pg_catalog.btrim(v_row ->> 'classStartSessionKey'),
      ''
    );
    v_session_label := nullif(
      pg_catalog.btrim(v_row ->> 'classStartSession'),
      ''
    );
    v_lesson_id := nullif(
      v_row ->> 'classStartLessonSessionId',
      ''
    )::uuid;

    select
      class.schedule_storage_mode,
      class.textbook_ids
    into v_class
    from public.classes class
    where class.id = v_class_id;

    if v_source_id is not null then
      v_session := dashboard_private.validate_registration_observation_class_start_source_v1(
        p_track_id,
        v_source_id,
        v_class_id,
        v_date,
        v_session_key,
        v_lesson_id
      );
      v_date := (v_session ->> 'classStartDate')::date;
      v_session_key := v_session ->> 'classStartSessionKey';
      v_session_label := v_session ->> 'classStartSession';
      v_lesson_id := nullif(
        v_session ->> 'classStartLessonSessionId',
        ''
      )::uuid;
      v_source_id := (v_session ->> 'observationId')::uuid;
    elsif v_date is null
      and v_session_key is null
      and v_session_label is null
      and v_lesson_id is null
    then
      v_date := null;
      v_session_key := null;
      v_session_label := null;
      v_lesson_id := null;
      v_source_id := null;
    else
      v_session := dashboard_private.validate_registration_class_session(
        v_class_id,
        v_date,
        v_session_key
      );
      if coalesce((v_session ->> 'valid')::boolean, false) is not true then
        raise exception 'registration_class_session_invalid'
          using errcode = '23514';
      end if;
      v_date := (v_session ->> 'sessionDate')::date;
      v_session_key := v_session ->> 'sessionKey';
      v_session_label := v_session ->> 'sessionLabel';

      if v_class.schedule_storage_mode = 'normalized' then
        select lesson.id
        into v_candidate_id
        from public.class_lesson_sessions lesson
        where lesson.class_id = v_class_id
          and lesson.session_date = v_date
          and lesson.session_key = v_session_key
          and lesson.schedule_state in ('active', 'makeup')
        order by lesson.id
        limit 1;
        if v_candidate_id is null
          or v_lesson_id is distinct from v_candidate_id
        then
          raise exception 'registration_class_session_invalid'
            using errcode = '23514';
        end if;
        v_lesson_id := v_candidate_id;
      elsif v_lesson_id is not null then
        raise exception 'registration_class_session_invalid'
          using errcode = '23514';
      else
        v_lesson_id := null;
      end if;
    end if;

    v_final_rows := v_final_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_row_id,
        'classId', v_class_id,
        'textbookId', v_textbook_id,
        'classStartDate', v_date,
        'classStartSessionKey', v_session_key,
        'classStartSession', v_session_label,
        'classStartLessonSessionId', v_lesson_id,
        'classStartSourceObservationId', v_source_id,
        'sortOrder', (v_row ->> 'sortOrder')::integer
      )
    );
  end loop;

  with final_rows as (
    select
      (row_item.value ->> 'id')::uuid as id,
      (row_item.value ->> 'classId')::uuid as class_id,
      nullif(row_item.value ->> 'textbookId', '')::uuid as textbook_id,
      nullif(row_item.value ->> 'classStartDate', '')::date
        as class_start_date,
      nullif(row_item.value ->> 'classStartSessionKey', '')
        as class_start_session_key,
      nullif(row_item.value ->> 'classStartSession', '')
        as class_start_session,
      nullif(row_item.value ->> 'classStartLessonSessionId', '')::uuid
        as class_start_lesson_session_id,
      nullif(row_item.value ->> 'classStartSourceObservationId', '')::uuid
        as class_start_source_observation_id,
      (row_item.value ->> 'sortOrder')::integer as sort_order
    from pg_catalog.jsonb_array_elements(v_final_rows) row_item(value)
  ), written as (
    insert into public.ops_registration_enrollments(
      id,
      track_id,
      student_id,
      admission_batch_id,
      class_id,
      textbook_id,
      class_start_date,
      class_start_session_key,
      class_start_session,
      class_start_lesson_session_id,
      class_start_source_observation_id,
      status,
      makeedu_registered,
      roster_active,
      roster_released_at,
      roster_release_reason,
      roster_release_source_task_id,
      roster_release_kind,
      sort_order
    )
    select
      final_rows.id,
      p_track_id,
      null,
      null,
      final_rows.class_id,
      final_rows.textbook_id,
      final_rows.class_start_date,
      final_rows.class_start_session_key,
      final_rows.class_start_session,
      final_rows.class_start_lesson_session_id,
      final_rows.class_start_source_observation_id,
      'planned',
      false,
      false,
      null,
      null,
      null,
      null,
      final_rows.sort_order
    from final_rows
    on conflict (id) do update
    set class_id = excluded.class_id,
        textbook_id = excluded.textbook_id,
        class_start_date = excluded.class_start_date,
        class_start_session_key = excluded.class_start_session_key,
        class_start_session = excluded.class_start_session,
        class_start_lesson_session_id = excluded.class_start_lesson_session_id,
        class_start_source_observation_id = excluded.class_start_source_observation_id,
        sort_order = excluded.sort_order,
        updated_at = pg_catalog.now()
    where ops_registration_enrollments.track_id = p_track_id
      and ops_registration_enrollments.status = 'planned'
      and ops_registration_enrollments.admission_batch_id is null
      and ops_registration_enrollments.student_id is null
      and not ops_registration_enrollments.roster_active
      and ops_registration_enrollments.roster_released_at is null
      and ops_registration_enrollments.roster_release_reason is null
      and ops_registration_enrollments.roster_release_source_task_id is null
      and ops_registration_enrollments.roster_release_kind is null
    returning ops_registration_enrollments.id
  )
  select
    coalesce(
      pg_catalog.array_agg(written.id order by written.id),
      array[]::uuid[]
    ),
    pg_catalog.count(*)::integer
  into v_written_ids, v_written_count
  from written;

  if v_written_count <> pg_catalog.jsonb_array_length(v_final_rows) then
    raise exception 'registration_enrollment_draft_write_mismatch'
      using errcode = '40001';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'classStartLessonSessionId', enrollment.class_start_lesson_session_id,
        'classStartSourceObservationId',
          enrollment.class_start_source_observation_id,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      )
      order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_written_ids);

  perform dashboard_private.write_registration_track_event_v2(
    v_task_id,
    p_track_id,
    'enrollment_rows_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'rowIds', pg_catalog.to_jsonb(v_written_ids),
      'rowCount', pg_catalog.cardinality(v_written_ids),
      'rows', v_rows_response
    ),
    'user',
    null
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'rows', v_rows_response
  );
  return v_response;
end;
$$;

create or replace function public.save_registration_enrollment_rows(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_canonical_request_rows jsonb;
  v_task_id uuid;
  v_target_fingerprint jsonb;
  v_saved_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_response jsonb;
  v_receipt_matches boolean;
begin
  if v_actor_id is null or v_request_key is null or p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_canonical_request_rows :=
    dashboard_private.normalize_registration_enrollment_rows_request_v1(p_rows);

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'save_enrollment_rows'
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'rows', v_canonical_request_rows
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || v_request_key,
      0
    )
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'save_enrollment_rows'
      and mutation.target_fingerprint = v_target_fingerprint
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response,
    v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if not v_receipt_matches then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_response;
  end if;

  v_response :=
    dashboard_private.save_registration_enrollment_rows_canonical_v1(
      p_track_id,
      v_canonical_request_rows,
      v_actor_id
    );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'save_enrollment_rows',
    v_target_fingerprint,
    v_response
  );

  return v_response;
end;
$$;

create or replace function dashboard_private.sync_registration_enrollment_lesson_session_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_task_id uuid;
  v_mode text;
  v_session jsonb;
  v_session_id uuid;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = new.track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    new.track_id,
    'save_enrollment_rows'
  );

  if new.class_start_source_observation_id is null then
    if new.class_start_date is null
      and nullif(pg_catalog.btrim(new.class_start_session_key), '') is null
      and nullif(pg_catalog.btrim(new.class_start_session), '') is null
    then
      new.class_start_lesson_session_id := null;
      return new;
    end if;
    if new.class_start_date is null
      or nullif(pg_catalog.btrim(new.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(new.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete'
        using errcode = '23514';
    end if;

    v_session := dashboard_private.validate_registration_class_session(
      new.class_id,
      new.class_start_date,
      new.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or new.class_start_date
        is distinct from (v_session ->> 'sessionDate')::date
      or new.class_start_session_key
        is distinct from v_session ->> 'sessionKey'
      or new.class_start_session
        is distinct from v_session ->> 'sessionLabel'
    then
      raise exception 'registration_class_session_invalid'
        using errcode = '23514';
    end if;

    select class.schedule_storage_mode
    into v_mode
    from public.classes class
    where class.id = new.class_id;
    if v_mode = 'normalized' then
      select lesson.id
      into v_session_id
      from public.class_lesson_sessions lesson
      where lesson.class_id = new.class_id
        and lesson.session_date = new.class_start_date
        and lesson.session_key = new.class_start_session_key
        and lesson.schedule_state in ('active', 'makeup')
      order by lesson.id
      limit 1;
      if v_session_id is null
        or new.class_start_lesson_session_id is distinct from v_session_id
      then
        raise exception 'registration_class_session_invalid'
          using errcode = '23514';
      end if;
      new.class_start_lesson_session_id := v_session_id;
    else
      if new.class_start_lesson_session_id is not null then
        raise exception 'registration_class_session_invalid'
          using errcode = '23514';
      end if;
      new.class_start_lesson_session_id := null;
    end if;
    return new;
  end if;

  v_session := dashboard_private.validate_registration_observation_class_start_source_v1(
    new.track_id,
    new.class_start_source_observation_id,
    new.class_id,
    new.class_start_date,
    new.class_start_session_key,
    new.class_start_lesson_session_id
  );
  if new.class_start_source_observation_id
      is distinct from (v_session ->> 'observationId')::uuid
    or new.class_id is distinct from (v_session ->> 'classId')::uuid
    or new.class_start_date
      is distinct from (v_session ->> 'classStartDate')::date
    or new.class_start_session_key
      is distinct from v_session ->> 'classStartSessionKey'
    or new.class_start_session
      is distinct from v_session ->> 'classStartSession'
    or new.class_start_lesson_session_id
      is distinct from nullif(
        v_session ->> 'classStartLessonSessionId',
        ''
      )::uuid
  then
    raise exception 'registration_observation_class_start_source_invalid'
      using errcode = '23514';
  end if;
  new.class_start_lesson_session_id := nullif(
    v_session ->> 'classStartLessonSessionId',
    ''
  )::uuid;
  return new;
end;
$$;

drop trigger if exists ops_registration_enrollments_sync_lesson_session
  on public.ops_registration_enrollments;
create trigger ops_registration_enrollments_sync_lesson_session
before insert or update of
  class_id,
  class_start_date,
  class_start_session_key,
  class_start_lesson_session_id,
  class_start_source_observation_id
on public.ops_registration_enrollments
for each row
execute function dashboard_private.sync_registration_enrollment_lesson_session_v1();

create or replace function dashboard_private.save_registration_enrollment_details_impl(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_fingerprint jsonb;
  v_saved_task_id uuid;
  v_saved_type text;
  v_saved_fingerprint jsonb;
  v_canonical_rows jsonb;
  v_response jsonb;
begin
  if v_actor_id is null
    or v_request_key is null
    or p_track_id is null
    or p_rows is null
    or pg_catalog.jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'registration_enrollment_details_invalid'
      using errcode = '22023';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'save_enrollment_rows'
  );

  v_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'rows', p_rows
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || v_request_key,
      0
    )
  );

  select
    mutation.task_id,
    mutation.mutation_type,
    mutation.target_fingerprint,
    mutation.response_payload
  into
    v_saved_task_id,
    v_saved_type,
    v_saved_fingerprint,
    v_response
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  if found then
    if v_saved_task_id is distinct from v_task_id
      or v_saved_type is distinct from 'save_registration_enrollment_details'
      or v_saved_fingerprint is distinct from v_fingerprint
    then
      raise exception 'registration_mutation_request_conflict'
        using errcode = '40001';
    end if;
    return v_response;
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'dashboard.registration_status_independent_enrollment',
    'on',
    true
  );
  v_canonical_rows :=
    dashboard_private.normalize_registration_enrollment_rows_request_v1(p_rows);
  v_response :=
    dashboard_private.save_registration_enrollment_rows_canonical_v1(
      p_track_id,
      v_canonical_rows,
      v_actor_id
    );

  update public.ops_registration_subject_tracks
  set enrollment_detail_rows = v_response -> 'rows',
      updated_at = pg_catalog.now()
  where id = p_track_id;

  perform dashboard_private.write_registration_track_event_v2(
    v_task_id,
    p_track_id,
    'registration_enrollment_details_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'rowCount', pg_catalog.jsonb_array_length(v_response -> 'rows'),
      'canonical', true
    ),
    'user',
    null
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'save_registration_enrollment_details',
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.save_registration_enrollment_details_v1(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_enrollment_details_impl(
    p_track_id,
    p_rows,
    p_request_key
  );
$$;

create or replace view public.ops_registration_appointment_calendar
with (security_invoker = true)
as
with canonical_participants as (
  select
    level_test.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
   and appointment.kind = 'level_test'
  join public.ops_registration_subject_tracks track
    on track.id = level_test.track_id

  union

  select
    consultation.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
   and appointment.kind = 'visit_consultation'
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where consultation.mode = 'visit'
    and consultation.appointment_id is not null

  union

  select
    observation.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
   and appointment.kind = 'observation_class'
  join public.ops_registration_subject_tracks track
    on track.id = observation.track_id
),
appointment_participants as (
  select
    participant.appointment_id,
    pg_catalog.array_agg(
      participant.track_id
      order by
        case participant.subject
          when '영어' then 10
          when '수학' then 20
          when '과학' then 30
          else 2147483647
        end,
        participant.track_id
    ) as track_ids,
    pg_catalog.array_agg(
      participant.subject
      order by
        case participant.subject
          when '영어' then 10
          when '수학' then 20
          when '과학' then 30
          else 2147483647
        end,
        participant.track_id
    ) as subjects
  from canonical_participants participant
  group by participant.appointment_id
)
select
  appointment.id as appointment_id,
  appointment.task_id,
  task.student_name,
  appointment.kind,
  appointment.scheduled_at,
  appointment.place,
  appointment.status,
  appointment.notification_revision,
  participant.track_ids,
  participant.subjects,
  observation.id as observation_id,
  observation.track_id as observation_track_id,
  observation.class_id as observation_class_id,
  observation.class_name_snapshot as observation_class_name,
  observation.ends_at as observation_ends_at,
  observation.teacher_name_snapshot as observation_teacher_name,
  observation.classroom_name_snapshot as observation_classroom_name
from public.ops_registration_appointments appointment
join public.ops_tasks task
  on task.id = appointment.task_id
join appointment_participants participant
  on participant.appointment_id = appointment.id
left join public.ops_registration_observations observation
  on observation.appointment_id = appointment.id
 and appointment.kind = 'observation_class';

create or replace function dashboard_private.registration_appointment_track_ids_v1(
  p_appointment_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(
      participant.track_id order by
        dashboard_private.registration_subject_sort_order(track.subject),
        participant.track_id
    ),
    array[]::uuid[]
  )
  from (
    select level_test.track_id
    from public.ops_registration_level_tests level_test
    where level_test.appointment_id = p_appointment_id
      and level_test.status in ('scheduled', 'in_progress')
    union
    select consultation.track_id
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
    union
    select observation.track_id
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment
      on appointment.id = observation.appointment_id
     and appointment.kind = 'observation_class'
    where observation.appointment_id = p_appointment_id
  ) participant
  join public.ops_registration_subject_tracks track
    on track.id = participant.track_id;
$$;

alter function dashboard_private.validate_registration_observation_class_start_source_v1(
  uuid, uuid, uuid, date, text, uuid
) owner to postgres;
alter function dashboard_private.normalize_registration_enrollment_rows_request_v1(
  jsonb
) owner to postgres;
alter function dashboard_private.save_registration_enrollment_rows_canonical_v1(
  uuid, jsonb, uuid
) owner to postgres;
alter function public.save_registration_enrollment_rows(uuid, jsonb, text)
  owner to postgres;
alter function dashboard_private.sync_registration_enrollment_lesson_session_v1()
  owner to postgres;
alter function dashboard_private.save_registration_enrollment_details_impl(
  uuid, jsonb, text
) owner to postgres;
alter function public.save_registration_enrollment_details_v1(uuid, jsonb, text)
  owner to postgres;
alter function dashboard_private.registration_appointment_track_ids_v1(uuid)
  owner to postgres;
alter view public.ops_registration_appointment_calendar owner to postgres;

revoke all on function public.save_registration_enrollment_rows_legacy_v1(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_enrollment_rows_impl(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.sync_registration_enrollment_lesson_session_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_track_ids_v1(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.save_registration_enrollment_rows(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_registration_enrollment_rows(uuid,jsonb,text)
  to authenticated;

revoke all on function dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)
  to authenticated;
revoke all on function public.save_registration_enrollment_details_v1(uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_registration_enrollment_details_v1(uuid,jsonb,text)
  to authenticated;

revoke all on table public.ops_registration_appointment_calendar
  from public, anon, authenticated, service_role;
grant select on table public.ops_registration_appointment_calendar
  to authenticated;

commit;
