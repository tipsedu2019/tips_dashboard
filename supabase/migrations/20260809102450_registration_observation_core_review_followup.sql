begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.list_registration_observation_sessions_v1_impl(
  p_track_id uuid,
  p_class_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_sessions jsonb;
  v_textbooks jsonb;
  v_legacy_invalid boolean := false;
  v_time_ambiguous boolean := false;
  v_session_invalid boolean := false;
  v_result jsonb;
begin
  v_track := dashboard_private.assert_registration_observation_manager_access_v1(
    p_track_id
  );
  if p_class_id is null
    or p_date_from is null
    or p_date_to is null
    or p_date_from < current_date
    or p_date_to < p_date_from
    or p_date_to - p_date_from > 120
  then
    raise exception 'registration_observation_date_range_invalid'
      using errcode = '22023';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = p_class_id
    and class.subject = v_track.subject
    and class.closed_at is null;
  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  if v_class.schedule_storage_mode = 'normalized'
    and public.continuous_class_schedule_runtime_version() = 1
  then
    with candidates as materialized (
      select
        lesson.id,
        lesson.session_date,
        lesson.start_time
      from public.class_lesson_sessions lesson
      where lesson.class_id = p_class_id
        and lesson.session_date between p_date_from and p_date_to
        and lesson.schedule_state in ('active', 'makeup')
        and lesson.start_time is not null
        and lesson.end_time is not null
        and lesson.start_time < lesson.end_time
        and (lesson.session_date + lesson.start_time) at time zone 'Asia/Seoul'
          > pg_catalog.now()
      order by lesson.session_date, lesson.start_time, lesson.id
      limit 240
    ),
    resolved as materialized (
      select
        candidate.session_date,
        candidate.start_time,
        candidate.id,
        dashboard_private.resolve_registration_observation_session_v1(
          p_track_id,
          p_class_id,
          'normalized',
          candidate.id,
          null
        ) as payload
      from candidates candidate
    )
    select coalesce(
      pg_catalog.jsonb_agg(
        resolved.payload
        order by resolved.session_date, resolved.start_time, resolved.id
      ),
      '[]'::jsonb
    )
    into v_result
    from resolved;
  elsif v_class.schedule_storage_mode in ('legacy', 'shadow') then
    v_sessions := case
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'sessions') = 'array'
        then v_class.schedule_plan -> 'sessions'
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'session_list') = 'array'
        then v_class.schedule_plan -> 'session_list'
      else '[]'::jsonb
    end;
    v_textbooks := case
      when pg_catalog.jsonb_typeof(v_class.schedule_plan -> 'textbooks') = 'array'
        then v_class.schedule_plan -> 'textbooks'
      else '[]'::jsonb
    end;

    with source_sessions as materialized (
      select session.value, session.ordinality
      from pg_catalog.jsonb_array_elements(v_sessions)
        with ordinality session(value, ordinality)
    ),
    canonical as materialized (
      select
        source.value,
        source.ordinality,
        coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'sessionKey'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'session_key'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'id'), '')
        ) as session_key,
        coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'date'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'sessionDate'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'session_date'), '')
        ) as session_date_text,
        case pg_catalog.lower(coalesce(
          nullif(pg_catalog.btrim(source.value ->> 'scheduleState'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'schedule_state'), ''),
          nullif(pg_catalog.btrim(source.value ->> 'state'), ''),
          'active'
        ))
          when 'normal' then 'active'
          else pg_catalog.lower(coalesce(
            nullif(pg_catalog.btrim(source.value ->> 'scheduleState'), ''),
            nullif(pg_catalog.btrim(source.value ->> 'schedule_state'), ''),
            nullif(pg_catalog.btrim(source.value ->> 'state'), ''),
            'active'
          ))
        end as schedule_state
      from source_sessions source
    ),
    duplicate_keys as materialized (
      select canonical.session_key
      from canonical
      where canonical.session_key is not null
      group by canonical.session_key having count(*) > 1
    ),
    validation as materialized (
      select
        exists(select 1 from canonical where canonical.session_key is null)
        or exists(select 1 from duplicate_keys) as legacy_invalid
    ),
    dated as materialized (
      select
        canonical.value,
        canonical.ordinality,
        canonical.session_key,
        canonical.schedule_state,
        case
          when canonical.session_date_text ~ '^\d{4}-\d{2}-\d{2}$'
            then canonical.session_date_text::date
          else null
        end as session_date
      from canonical
      where canonical.session_key is not null
        and canonical.schedule_state in ('active', 'makeup')
    ),
    candidates as materialized (
      select
        dated.*,
        slot_fact.slot_count,
        slot_fact.start_time,
        slot_fact.end_time,
        slot_fact.teacher_catalog_id,
        slot_fact.teacher_name,
        slot_fact.classroom_catalog_id,
        slot_fact.classroom_name
      from dated
      cross join lateral (
        select
          pg_catalog.count(*)::integer as slot_count,
          pg_catalog.min(slot.start_time) as start_time,
          pg_catalog.min(slot.end_time) as end_time,
          (pg_catalog.array_agg(slot.teacher_catalog_id order by slot.sort_order, slot.id))[1]
            as teacher_catalog_id,
          (pg_catalog.array_agg(slot.teacher_name order by slot.sort_order, slot.id))[1]
            as teacher_name,
          (pg_catalog.array_agg(slot.classroom_catalog_id order by slot.sort_order, slot.id))[1]
            as classroom_catalog_id,
          (pg_catalog.array_agg(slot.classroom_name order by slot.sort_order, slot.id))[1]
            as classroom_name
        from public.class_schedule_slots slot
        where slot.class_id = p_class_id
          and slot.weekday = extract(dow from dated.session_date)::smallint
      ) slot_fact
      cross join validation
      where not validation.legacy_invalid
        and dated.session_date between p_date_from and p_date_to
        and (
          slot_fact.slot_count <> 1
          or (dated.session_date + slot_fact.start_time) at time zone 'Asia/Seoul'
            > pg_catalog.now()
        )
      order by dated.session_date, dated.session_key
      limit 240
    ),
    parsed as materialized (
      select
        candidate.*,
        coalesce(
          nullif(pg_catalog.btrim(candidate.value ->> 'teacherCatalogId'), ''),
          nullif(pg_catalog.btrim(candidate.value ->> 'teacher_catalog_id'), '')
        ) as teacher_catalog_text,
        coalesce(
          nullif(pg_catalog.btrim(candidate.value ->> 'classroomCatalogId'), ''),
          nullif(pg_catalog.btrim(candidate.value ->> 'classroom_catalog_id'), '')
        ) as classroom_catalog_text,
        coalesce(
          nullif(pg_catalog.btrim(candidate.value ->> 'teacherName'), ''),
          nullif(pg_catalog.btrim(candidate.value ->> 'teacher_name'), ''),
          nullif(pg_catalog.btrim(candidate.teacher_name), ''),
          nullif(pg_catalog.btrim(v_class.teacher), '')
        ) as teacher_name_fallback,
        coalesce(
          nullif(pg_catalog.btrim(candidate.value ->> 'classroomName'), ''),
          nullif(pg_catalog.btrim(candidate.value ->> 'classroom_name'), ''),
          nullif(pg_catalog.btrim(candidate.classroom_name), ''),
          nullif(pg_catalog.btrim(v_class.room), '')
        ) as classroom_name_fallback,
        case
          when pg_catalog.jsonb_typeof(candidate.value -> 'textbookEntries') = 'array'
            then candidate.value -> 'textbookEntries'
          else '[]'::jsonb
        end as textbook_entries
      from candidates candidate
    ),
    typed as materialized (
      select
        parsed.*,
        parsed.teacher_catalog_text is not null
          and parsed.teacher_catalog_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          as teacher_catalog_invalid,
        parsed.classroom_catalog_text is not null
          and parsed.classroom_catalog_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          as classroom_catalog_invalid,
        case
          when parsed.teacher_catalog_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then parsed.teacher_catalog_text::uuid
          else parsed.teacher_catalog_id
        end as resolved_teacher_catalog_id,
        case
          when parsed.classroom_catalog_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then parsed.classroom_catalog_text::uuid
          else parsed.classroom_catalog_id
        end as resolved_classroom_catalog_id
      from parsed
    ),
    catalogued as materialized (
      select
        typed.*,
        teacher_pick.match_count as teacher_match_count,
        teacher.id as selected_teacher_catalog_id,
        teacher.profile_id as selected_teacher_profile_id,
        teacher.name as selected_teacher_name,
        classroom_pick.match_count as classroom_match_count,
        classroom.id as selected_classroom_catalog_id,
        classroom.name as selected_classroom_name,
        classroom.campus as selected_campus
      from typed
      left join lateral (
        select
          pg_catalog.count(*)::integer as match_count,
          pg_catalog.min(teacher.id::text)::uuid as selected_id
        from public.teacher_catalogs teacher
        where teacher.is_visible = true
          and teacher.profile_id is not null
          and (
            pg_catalog.cardinality(teacher.subjects) = 0
            or v_track.subject = any(teacher.subjects)
          )
          and (
            (typed.resolved_teacher_catalog_id is not null
              and teacher.id = typed.resolved_teacher_catalog_id)
            or
            (typed.resolved_teacher_catalog_id is null
              and pg_catalog.lower(teacher.name)
                = pg_catalog.lower(typed.teacher_name_fallback))
          )
      ) teacher_pick on true
      left join public.teacher_catalogs teacher
        on teacher.id = teacher_pick.selected_id
       and teacher_pick.match_count = 1
      left join lateral (
        select
          pg_catalog.count(*)::integer as match_count,
          pg_catalog.min(classroom.id::text)::uuid as selected_id
        from public.classroom_catalogs classroom
        where classroom.is_visible = true
          and classroom.campus in ('본관', '별관')
          and (
            pg_catalog.cardinality(classroom.subjects) = 0
            or v_track.subject = any(classroom.subjects)
          )
          and (
            (typed.resolved_classroom_catalog_id is not null
              and classroom.id = typed.resolved_classroom_catalog_id)
            or
            (typed.resolved_classroom_catalog_id is null
              and pg_catalog.lower(classroom.name)
                = pg_catalog.lower(typed.classroom_name_fallback))
          )
      ) classroom_pick on true
      left join public.classroom_catalogs classroom
        on classroom.id = classroom_pick.selected_id
       and classroom_pick.match_count = 1
    ),
    enriched as materialized (
      select
        catalogued.*,
        textbook_fact.output_textbooks,
        dashboard_private.continuous_class_schedule_content_hash_v1(
          pg_catalog.jsonb_build_object(
            'textbooks', coalesce((
              select pg_catalog.jsonb_agg(book.value order by book.ordinality)
              from pg_catalog.jsonb_array_elements(v_textbooks)
                with ordinality book(value, ordinality)
              where nullif(pg_catalog.btrim(book.value ->> 'textbookId'), '') in (
                select nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), '')
                from pg_catalog.jsonb_array_elements(catalogued.textbook_entries) entry(value)
              )
            ), '[]'::jsonb),
            'sessions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'sessionKey', catalogued.session_key,
              'textbookEntries', catalogued.textbook_entries
            ))
          )
        ) as content_hash,
        coalesce(
          progress_fact.progress_value,
          nullif(pg_catalog.btrim(catalogued.value ->> 'publicNote'), ''),
          nullif(pg_catalog.btrim(catalogued.value ->> 'public_note'), ''),
          nullif(pg_catalog.btrim(catalogued.value ->> 'memo'), '')
        ) as progress_value
      from catalogued
      left join lateral (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'textbookId', nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), ''),
              'title', coalesce(
                nullif(pg_catalog.btrim(book.value ->> 'title'), ''),
                nullif(pg_catalog.btrim(book.value ->> 'name'), ''),
                nullif(pg_catalog.btrim(entry.value ->> 'textbookTitle'), ''),
                '교재 ' || entry.ordinality::text
              ),
              'planLabel', coalesce(
                nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'label'), ''),
                nullif(pg_catalog.btrim(entry.value ->> 'planLabel'), ''),
                ''
              ),
              'memo', coalesce(
                nullif(pg_catalog.btrim(entry.value -> 'plan' ->> 'memo'), ''),
                nullif(pg_catalog.btrim(entry.value ->> 'memo'), ''),
                ''
              )
            )
            order by entry.ordinality
          ),
          '[]'::jsonb
        ) as output_textbooks
        from pg_catalog.jsonb_array_elements(catalogued.textbook_entries)
          with ordinality entry(value, ordinality)
        left join lateral (
          select source.value
          from pg_catalog.jsonb_array_elements(v_textbooks)
            with ordinality source(value, ordinality)
          where nullif(pg_catalog.btrim(source.value ->> 'textbookId'), '')
            = nullif(pg_catalog.btrim(entry.value ->> 'textbookId'), '')
          order by source.ordinality
          limit 1
        ) book on true
      ) textbook_fact on true
      left join lateral (
        select nullif(pg_catalog.btrim(coalesce(
          nullif(progress.range_label, ''),
          nullif(progress.content, ''),
          nullif(progress.public_note, '')
        )), '') as progress_value
        from public.progress_logs progress
        where progress.class_id = p_class_id
          and progress.session_id = catalogued.session_key
        order by progress.updated_at desc nulls last, progress.id desc
        limit 1
      ) progress_fact on true
    ),
    resolved as materialized (
      select
        enriched.session_date,
        enriched.start_time,
        enriched.session_key,
        enriched.slot_count <> 1 as time_ambiguous,
        enriched.teacher_catalog_invalid
          or enriched.classroom_catalog_invalid as legacy_invalid,
        enriched.slot_count = 1
          and (
            enriched.start_time is null
            or enriched.end_time is null
            or enriched.start_time >= enriched.end_time
            or enriched.teacher_match_count <> 1
            or enriched.classroom_match_count <> 1
            or enriched.selected_teacher_catalog_id is null
            or not dashboard_private.notification_profile_is_active_v1(
              enriched.selected_teacher_profile_id
            )
            or enriched.selected_classroom_catalog_id is null
          ) as session_invalid,
        case
          when enriched.slot_count = 1
            and not enriched.teacher_catalog_invalid
            and not enriched.classroom_catalog_invalid
            and enriched.start_time is not null
            and enriched.end_time is not null
            and enriched.start_time < enriched.end_time
            and enriched.teacher_match_count = 1
            and enriched.classroom_match_count = 1
            and enriched.selected_teacher_catalog_id is not null
            and dashboard_private.notification_profile_is_active_v1(
              enriched.selected_teacher_profile_id
            )
            and enriched.selected_classroom_catalog_id is not null
          then pg_catalog.jsonb_build_object(
            'classId', p_class_id,
            'subject', v_track.subject,
            'sessionAuthority', 'legacy',
            'classLessonSessionId', null,
            'legacySessionKey', enriched.session_key,
            'sessionKey', enriched.session_key,
            'scheduleState', enriched.schedule_state,
            'sessionDate', enriched.session_date,
            'startsAt', (enriched.session_date + enriched.start_time) at time zone 'Asia/Seoul',
            'endsAt', (enriched.session_date + enriched.end_time) at time zone 'Asia/Seoul',
            'sessionSourceRevision', null,
            'legacySessionSourceHash', enriched.content_hash,
            'sourceRevision', pg_catalog.jsonb_build_object(
              'authority', 'legacy',
              'sessionKey', enriched.session_key,
              'contentHash', enriched.content_hash
            ),
            'teacherCatalogId', enriched.selected_teacher_catalog_id,
            'teacherProfileId', enriched.selected_teacher_profile_id,
            'teacherName', enriched.selected_teacher_name,
            'classroomCatalogId', enriched.selected_classroom_catalog_id,
            'classroomName', enriched.selected_classroom_name,
            'campus', enriched.selected_campus,
            'className', v_class.name,
            'textbooks', enriched.output_textbooks,
            'progress', case when enriched.progress_value is null
              then '진도: 미입력'
              else '진도: ' || enriched.progress_value
            end,
            'bookingFactHash', dashboard_private.registration_observation_booking_fact_hash_v1(
              pg_catalog.jsonb_build_object(
                'classId', p_class_id,
                'subject', v_track.subject,
                'sessionAuthority', 'legacy',
                'classLessonSessionId', null,
                'legacySessionKey', enriched.session_key,
                'sessionKey', enriched.session_key,
                'scheduleState', enriched.schedule_state,
                'sessionDate', enriched.session_date,
                'startsAt', (enriched.session_date + enriched.start_time) at time zone 'Asia/Seoul',
                'endsAt', (enriched.session_date + enriched.end_time) at time zone 'Asia/Seoul',
                'teacherCatalogId', enriched.selected_teacher_catalog_id,
                'teacherProfileId', enriched.selected_teacher_profile_id,
                'teacherName', enriched.selected_teacher_name,
                'classroomCatalogId', enriched.selected_classroom_catalog_id,
                'classroomName', enriched.selected_classroom_name,
                'campus', enriched.selected_campus
              )
            )
          )
          else null
        end as payload
      from enriched
    )
    select
      validation.legacy_invalid
        or coalesce(pg_catalog.bool_or(resolved.legacy_invalid), false),
      coalesce(pg_catalog.bool_or(resolved.time_ambiguous), false),
      coalesce(pg_catalog.bool_or(resolved.session_invalid), false),
      coalesce(
        pg_catalog.jsonb_agg(
          resolved.payload
          order by resolved.session_date, resolved.start_time, resolved.session_key
        ) filter (where resolved.payload is not null),
        '[]'::jsonb
      )
    into
      v_legacy_invalid,
      v_time_ambiguous,
      v_session_invalid,
      v_result
    from validation
    left join resolved on not validation.legacy_invalid
    group by validation.legacy_invalid;

    if v_legacy_invalid then
      raise exception 'registration_observation_legacy_session_invalid'
        using errcode = '22023';
    end if;
    if v_time_ambiguous then
      raise exception 'registration_observation_session_time_ambiguous'
        using errcode = '22023';
    end if;
    if v_session_invalid then
      raise exception 'registration_observation_session_invalid'
        using errcode = '22023';
    end if;
  else
    raise exception 'registration_observation_session_invalid'
      using errcode = '22023';
  end if;

  return v_result;
end;
$$;

alter function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  owner to postgres;
revoke all on function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.list_registration_observation_sessions_v1_impl(uuid, uuid, date, date)
  to authenticated;

commit;
