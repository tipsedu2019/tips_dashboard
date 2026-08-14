begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema if not exists dashboard_private;

create function dashboard_private.academic_class_status_v1(
  p_status text,
  p_start_date date,
  p_end_date date
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.btrim(pg_catalog.coalesce(p_status, '')) in ('개강', '수업 진행 중', '수강') then '수강'
    when pg_catalog.btrim(pg_catalog.coalesce(p_status, '')) in ('개강 예정', '개강 준비 중', '개강 준비') then '개강 준비'
    when pg_catalog.btrim(pg_catalog.coalesce(p_status, '')) = '종강' then '종강'
    when p_start_date is not null and p_start_date > current_date then '개강 준비'
    when p_end_date is not null and p_end_date < current_date then '종강'
    else '수강'
  end;
$$;

create function dashboard_private.academic_classroom_name_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.coalesce(p_value, '')), '\s+', '', 'g')
    when '본2' then '본관 2강'
    when '본2강' then '본관 2강'
    when '본3' then '본관 3강'
    when '본3강' then '본관 3강'
    when '본5' then '본관 5강'
    when '본5강' then '본관 5강'
    when '별3' then '별관 3강'
    when '별3강' then '별관 3강'
    when '별4' then '별관 4강'
    when '별4강' then '별관 4강'
    when '별관4강' then '별관 4강'
    when '별5' then '별관 5강'
    when '별5강' then '별관 5강'
    when '별7' then '별관 5강'
    when '별7강' then '별관 5강'
    else pg_catalog.btrim(pg_catalog.coalesce(p_value, ''))
  end;
$$;

create function public.get_academic_timetable_range_v1(
  p_date_from date,
  p_date_to date,
  p_class_group_id text default null,
  p_status text default null,
  p_subject text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_class_summaries jsonb := '[]'::jsonb;
  v_terms jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_teachers jsonb := '[]'::jsonb;
  v_classrooms jsonb := '[]'::jsonb;
  v_status_options jsonb := '[]'::jsonb;
  v_subject_options jsonb := '[]'::jsonb;
  v_collection text;
  v_class_group_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from
     or (p_date_to - p_date_from) > 13 then
    raise exception 'academic_timetable_range_invalid' using errcode = '22023';
  end if;
  select pg_catalog.coalesce(
    nullif(pg_catalog.btrim(p_class_group_id), ''),
    (
      select group_row.id::text
      from public.class_schedule_sync_groups group_row
      order by group_row.is_default desc, group_row.sort_order, group_row.name collate dashboard_private.ko_numeric, group_row.id
      limit 1
    )
  ) into v_class_group_id;

  with eligible as materialized (
    select
      class.id,
      class.name,
      class.subject,
      class.subject_area_key,
      class.grade,
      class.teacher,
      class.room,
      class.schedule,
      class.status,
      class.start_date,
      class.end_date,
      class.term_id,
      class.period,
      pg_catalog.coalesce(term.academic_year, nullif(pg_catalog.substring(class.period, '([0-9]{4})'), '')::integer, pg_catalog.date_part('year', current_date)::integer) as academic_year,
      pg_catalog.coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), '')) as term_name,
      dashboard_private.academic_class_status_v1(class.status, class.start_date, class.end_date) as normalized_status
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (class.start_date is null or class.start_date <= p_date_to)
      and (class.end_date is null or class.end_date >= p_date_from)
      and (nullif(pg_catalog.btrim(p_status), '') is null
        or dashboard_private.academic_class_status_v1(class.status, class.start_date, class.end_date) = pg_catalog.btrim(p_status))
      and (nullif(pg_catalog.btrim(p_subject), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(p_subject))
      and (
        nullif(pg_catalog.btrim(v_class_group_id), '') is null
        or exists (
          select 1
          from public.class_schedule_sync_group_members member
          join public.class_schedule_sync_groups group_row on group_row.id = member.group_id
          where member.class_id = class.id
            and (member.group_id::text = v_class_group_id or group_row.name = v_class_group_id)
        )
        or (
          not exists (
            select 1 from public.class_schedule_sync_group_members member
            where member.class_id = class.id
          )
          and (
            ('term:' || pg_catalog.coalesce(term.academic_year::text, nullif(pg_catalog.substring(class.period, '([0-9]{4})'), ''), pg_catalog.date_part('year', current_date)::integer::text)
              || ':' || pg_catalog.coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), ''), 'term')) = v_class_group_id
            or pg_catalog.btrim(pg_catalog.concat_ws(' ', term.academic_year::text, pg_catalog.coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), '')))) = v_class_group_id
          )
        )
      )
  ), group_context as materialized (
    select
      class.id as class_id,
      pg_catalog.coalesce(
        pg_catalog.jsonb_agg(group_row.id::text order by member.sort_order, group_row.sort_order, group_row.name)
          filter (where group_row.id is not null),
        pg_catalog.jsonb_build_array(
          'term:' || class.academic_year::text || ':' || pg_catalog.coalesce(class.term_name, 'term')
        )
      ) as group_ids,
      pg_catalog.coalesce(
        pg_catalog.jsonb_agg(group_row.name order by member.sort_order, group_row.sort_order, group_row.name)
          filter (where group_row.id is not null),
        pg_catalog.jsonb_build_array(
          pg_catalog.btrim(pg_catalog.concat_ws(' ', class.academic_year::text, class.term_name))
        )
      ) as group_names
    from eligible class
    left join public.class_schedule_sync_group_members member on member.class_id = class.id
    left join public.class_schedule_sync_groups group_row on group_row.id = member.group_id
    group by class.id, class.academic_year, class.term_name
  ), parsed as materialized (
    select
      class.*,
      context.group_ids,
      context.group_names,
      matched.parts,
      day_value.day,
      pg_catalog.coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(pg_catalog.coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) as row_teacher,
      dashboard_private.academic_classroom_name_v1(pg_catalog.coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(pg_catalog.coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) as row_classroom
    from eligible class
    join group_context context on context.class_id = class.id
    cross join lateral pg_catalog.regexp_matches(
      pg_catalog.coalesce(class.schedule, ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?',
      'g'
    ) matched(parts)
    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    where day_value.day in ('월','화','수','목','금','토','일')
  ), row_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', parsed.id::text || ':' || parsed.day || ':' || parsed.parts[2] || ':' || parsed.parts[3],
      'classId', parsed.id,
      'title', pg_catalog.regexp_replace(pg_catalog.coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''),
      'fullTitle', pg_catalog.coalesce(parsed.name, ''),
      'academicYear', parsed.academic_year::text,
      'subject', pg_catalog.coalesce(parsed.subject, ''),
      'subjectAreaKey', pg_catalog.coalesce(parsed.subject_area_key, ''),
      'grade', pg_catalog.coalesce(parsed.grade, ''),
      'teacher', parsed.row_teacher,
      'classroom', parsed.row_classroom,
      'term', pg_catalog.coalesce(parsed.term_name, ''),
      'schedule', pg_catalog.coalesce(parsed.schedule, ''),
      'status', parsed.normalized_status,
      'statusFilter', parsed.normalized_status,
      'classGroupIds', parsed.group_ids,
      'classGroupNames', parsed.group_names,
      'classGroupLabel', pg_catalog.coalesce((select pg_catalog.string_agg(value, ', ') from pg_catalog.jsonb_array_elements_text(parsed.group_names) value), '미분류'),
      'day', parsed.day,
      'dayIndex', case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      'start', parsed.parts[2],
      'end', parsed.parts[3],
      'startMinutes', pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[2], ':', 2)::integer,
      'endMinutes', pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer,
      'durationMinutes', pg_catalog.greatest(0,
        pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer
        - pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 - pg_catalog.split_part(parsed.parts[2], ':', 2)::integer),
      'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', pg_catalog.regexp_replace(pg_catalog.coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''), parsed.subject, parsed.grade, parsed.row_teacher, parsed.row_classroom, parsed.normalized_status, parsed.term_name, parsed.schedule))
    ) as row_data,
    parsed.day,
    parsed.parts[2] as start_time,
    parsed.id
    from parsed
    order by case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      parsed.parts[2], parsed.id
    limit 2001
  ), class_summary_limited as materialized (
    select pg_catalog.to_jsonb(class) - 'start_date' - 'end_date' as row_data
    from eligible class order by class.name collate dashboard_private.ko_numeric, class.id limit 501
  ), term_limited as materialized (
    select bounded.row_data
    from (
      select distinct pg_catalog.to_jsonb(term) as row_data
      from public.class_terms term join eligible class on class.term_id = term.id
    ) bounded
    order by bounded.row_data::text limit 501
  ), group_limited as materialized (
    select bounded.row_data
    from (
      select distinct pg_catalog.to_jsonb(group_row) as row_data
      from public.class_schedule_sync_groups group_row
      join public.class_schedule_sync_group_members member on member.group_id = group_row.id
      join eligible class on class.id = member.class_id
    ) bounded
    order by bounded.row_data::text limit 501
  ), member_limited as materialized (
    select pg_catalog.to_jsonb(member) as row_data
    from public.class_schedule_sync_group_members member join eligible class on class.id = member.class_id
    order by member.group_id, member.sort_order, member.class_id limit 501
  ), teacher_limited as materialized (
    select pg_catalog.to_jsonb(catalog) as row_data
    from public.teacher_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where pg_catalog.coalesce(class.teacher, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  ), classroom_limited as materialized (
    select pg_catalog.to_jsonb(catalog) as row_data
    from public.classroom_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where pg_catalog.coalesce(class.room, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  )
  select
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data order by day, start_time, id) from row_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from class_summary_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from term_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from group_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from member_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from teacher_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(row_data) from classroom_limited), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(distinct normalized_status order by normalized_status) from eligible), '[]'::jsonb),
    pg_catalog.coalesce((select pg_catalog.jsonb_agg(distinct subject order by subject) filter (where nullif(pg_catalog.btrim(subject), '') is not null) from eligible), '[]'::jsonb)
  into v_rows, v_class_summaries, v_terms, v_groups, v_members, v_teachers, v_classrooms, v_status_options, v_subject_options;

  if pg_catalog.jsonb_array_length(v_rows) > 2000 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'visible_range_too_dense',
      'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
      'rows', '[]'::jsonb, 'observedRowsAtLeast', 2001, 'suggestedDays', 7
    );
  end if;

  foreach v_collection in array array['class_summaries','class_terms','class_groups','class_group_members','teacher_catalogs','classroom_catalogs'] loop
    if pg_catalog.jsonb_array_length(case v_collection
      when 'class_summaries' then v_class_summaries when 'class_terms' then v_terms
      when 'class_groups' then v_groups when 'class_group_members' then v_members
      when 'teacher_catalogs' then v_teachers else v_classrooms end) > 500 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'timetable_collection_too_dense',
        'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
        'collection', v_collection, 'observedItemsAtLeast', 501,
        'action', 'narrow_filters', 'rows', '[]'::jsonb
      );
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
    'resolvedClassGroupId', v_class_group_id,
    'rows', v_rows,
    'classSummaries', v_class_summaries,
    'classTerms', v_terms,
    'classGroups', v_groups,
    'classGroupMembers', v_members,
    'teacherCatalogs', v_teachers,
    'classroomCatalogs', v_classrooms,
    'statusOptions', v_status_options,
    'subjectOptions', v_subject_options,
    'complete', true
  );
end;
$$;

create function public.get_academic_curriculum_page_v1(
  p_filters jsonb,
  p_cursor_sort_key text default null,
  p_cursor_id uuid default null,
  p_limit integer default 30,
  p_include_scope_metadata boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_filters jsonb := pg_catalog.coalesce(p_filters, '{}'::jsonb);
  v_result jsonb;
  v_default_period_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_limit <> 30 then
    raise exception 'academic_curriculum_page_limit_invalid' using errcode = '22023';
  end if;
  if p_include_scope_metadata is null then
    raise exception 'academic_curriculum_metadata_mode_invalid' using errcode = '22023';
  end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then
    raise exception 'academic_curriculum_cursor_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_filters) <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(v_filters) key
       where key not in ('periodId','search','status','subject','grade','teacher','classroom','viewMode')
     ) then
    raise exception 'academic_curriculum_filters_invalid' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(v_filters ->> 'periodId'), '') is null then
    select group_row.id::text
    into v_default_period_id
    from public.class_schedule_sync_groups group_row
    order by group_row.is_default desc, group_row.sort_order, group_row.name collate dashboard_private.ko_numeric, group_row.id
    limit 1;
    if v_default_period_id is not null then
      v_filters := pg_catalog.jsonb_set(v_filters, '{periodId}', pg_catalog.to_jsonb(v_default_period_id), true);
    end if;
  end if;

  with eligible_classes as materialized (
    select
      class.id, class.name, class.subject, class.subject_area_key, class.grade,
      class.teacher, class.room, class.schedule, class.status, class.start_date,
      class.end_date, class.term_id, class.period, class.textbook_ids,
      dashboard_private.academic_class_status_v1(class.status, class.start_date, class.end_date) as normalized_status,
      pg_catalog.coalesce(nullif(pg_catalog.btrim(class.period), ''), term.name, '') as term_name,
      pg_catalog.jsonb_array_length(pg_catalog.coalesce(class.textbook_ids, '[]'::jsonb))::integer as textbook_count,
      pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name), ''), U&'\FFFF') collate dashboard_private.ko_numeric as sort_key
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(v_filters ->> 'periodId'), '') is null or exists (
        select 1
        from public.class_schedule_sync_group_members member
        join public.class_schedule_sync_groups group_row on group_row.id = member.group_id
        where member.class_id = class.id
          and (member.group_id::text = v_filters ->> 'periodId' or group_row.name = v_filters ->> 'periodId')
      ))
      and (nullif(pg_catalog.btrim(v_filters ->> 'status'), '') is null
        or dashboard_private.academic_class_status_v1(class.status, class.start_date, class.end_date) = pg_catalog.btrim(v_filters ->> 'status'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'subject'), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(v_filters ->> 'subject'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'grade'), '') is null or pg_catalog.btrim(class.grade) = pg_catalog.btrim(v_filters ->> 'grade'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'teacher'), '') is null or pg_catalog.coalesce(class.teacher, '') ilike '%' || pg_catalog.btrim(v_filters ->> 'teacher') || '%')
      and (
        nullif(pg_catalog.btrim(v_filters ->> 'classroom'), '') is null
        or exists (
          select 1
          from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(class.room, ''), '[,/&·]+') token
          where dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token))
            = dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(v_filters ->> 'classroom'))
        )
      )
      and (nullif(pg_catalog.btrim(v_filters ->> 'search'), '') is null or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, class.room, class.schedule) ilike '%' || pg_catalog.btrim(v_filters ->> 'search') || '%')
  ), progress_agg as materialized (
    select log.class_id,
      pg_catalog.count(*)::integer as progress_count,
      pg_catalog.count(distinct pg_catalog.coalesce(nullif(log.session_id, ''), nullif(log.progress_key, ''), log.id::text))
        filter (where pg_catalog.coalesce(log.status, '') in ('partial','done'))::integer as planned_count,
      pg_catalog.max(log.updated_at) as last_updated_at
    from public.progress_logs log
    join eligible_classes eligible on eligible.id = log.class_id
    group by log.class_id
  ), session_agg as materialized (
    select session.class_id,
      pg_catalog.count(*) filter (where session.schedule_state <> 'skipped')::integer as session_count
    from public.class_lesson_sessions session
    join eligible_classes eligible on eligible.id = session.class_id
    group by session.class_id
  ), next_unplanned as materialized (
    select distinct on (session.class_id)
      session.class_id,
      session.id as next_session_id,
      session.session_key as next_session_key,
      session.session_date as next_session_date,
      session.start_time as next_start_time,
      session.end_time as next_end_time,
      session.schedule_state as next_schedule_state
    from public.class_lesson_sessions session
    join eligible_classes eligible on eligible.id = session.class_id
    where session.schedule_state <> 'skipped'
      and not exists (
        select 1
        from public.progress_logs log
        where log.class_id = session.class_id
          and log.session_id in (session.id::text, session.session_key)
          and pg_catalog.coalesce(log.status, '') in ('partial','done')
      )
    order by session.class_id, session.session_date, session.start_time nulls last, session.id
  ), base as materialized (
    select
      eligible.id, eligible.name, eligible.subject, eligible.subject_area_key,
      eligible.grade, eligible.teacher, eligible.room, eligible.schedule,
      eligible.status, eligible.start_date, eligible.end_date, eligible.term_id,
      eligible.period, eligible.textbook_ids, eligible.normalized_status,
      eligible.term_name, eligible.textbook_count,
      pg_catalog.coalesce(session_agg.session_count, 0)::integer as session_count,
      pg_catalog.coalesce(progress_agg.planned_count, 0)::integer as planned_count,
      progress_agg.last_updated_at,
      next_unplanned.next_session_id,
      next_unplanned.next_session_key,
      next_unplanned.next_session_date,
      next_unplanned.next_start_time,
      next_unplanned.next_end_time,
      next_unplanned.next_schedule_state,
      eligible.sort_key
    from eligible_classes eligible
    left join progress_agg on progress_agg.class_id = eligible.id
    left join session_agg on session_agg.class_id = eligible.id
    left join next_unplanned on next_unplanned.class_id = eligible.id
  ), classified as materialized (
    select
      base.id, base.name, base.subject, base.subject_area_key, base.grade,
      base.teacher, base.room, base.schedule, base.status, base.start_date,
      base.end_date, base.term_id, base.period, base.textbook_ids,
      base.normalized_status, base.term_name, base.textbook_count,
      base.session_count, base.planned_count, base.last_updated_at,
      base.next_session_id, base.next_session_key, base.next_session_date,
      base.next_start_time, base.next_end_time, base.next_schedule_state,
      base.sort_key,
      case
        when base.session_count = 0 then '회차 미생성'
        when base.textbook_count = 0 then '교재 미연결'
        when base.planned_count < base.session_count then '진도 미배정'
        else '계획 완료'
      end as state_label,
      case
        when base.session_count = 0 then 'unscheduled'
        when base.textbook_count = 0 then 'unlinked'
        when base.planned_count < base.session_count then 'update'
        else 'done'
      end as view_mode
    from base
  ), filtered as materialized (
    select
      classified.id, classified.name, classified.subject, classified.subject_area_key,
      classified.grade, classified.teacher, classified.room, classified.schedule,
      classified.status, classified.start_date, classified.end_date, classified.term_id,
      classified.period, classified.textbook_ids, classified.normalized_status,
      classified.term_name, classified.textbook_count, classified.session_count,
      classified.planned_count, classified.last_updated_at,
      classified.next_session_id, classified.next_session_key, classified.next_session_date,
      classified.next_start_time, classified.next_end_time, classified.next_schedule_state,
      classified.sort_key, classified.state_label, classified.view_mode
    from classified
    where pg_catalog.coalesce(nullif(pg_catalog.btrim(v_filters ->> 'viewMode'), ''), 'all') = 'all'
       or view_mode = pg_catalog.btrim(v_filters ->> 'viewMode')
  ), page_candidates as materialized (
    select
      filtered.id, filtered.name, filtered.subject, filtered.subject_area_key,
      filtered.grade, filtered.teacher, filtered.room, filtered.schedule,
      filtered.status, filtered.start_date, filtered.end_date, filtered.term_id,
      filtered.period, filtered.textbook_ids, filtered.normalized_status,
      filtered.term_name, filtered.textbook_count, filtered.session_count,
      filtered.planned_count, filtered.last_updated_at,
      filtered.next_session_id, filtered.next_session_key, filtered.next_session_date,
      filtered.next_start_time, filtered.next_end_time, filtered.next_schedule_state,
      filtered.sort_key, filtered.state_label, filtered.view_mode
    from filtered
    where p_cursor_sort_key is null
       or sort_key > p_cursor_sort_key collate dashboard_private.ko_numeric
       or (sort_key = p_cursor_sort_key collate dashboard_private.ko_numeric and id > p_cursor_id)
    order by sort_key, id
    limit 31
  ), page_rows as materialized (
    select
      id,
      sort_key::text as sort_key,
      pg_catalog.jsonb_build_object(
        'id', id,
        'title', pg_catalog.regexp_replace(pg_catalog.coalesce(name, ''), '^\[[^]]+\]\s*', ''),
        'fullTitle', pg_catalog.coalesce(name, ''),
        'subject', pg_catalog.coalesce(subject, ''),
        'subjectAreaKey', pg_catalog.coalesce(subject_area_key, ''),
        'grade', pg_catalog.coalesce(grade, ''),
        'term', term_name,
        'teacherNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(pg_catalog.coalesce(teacher, ''), '\s*[,/&·]\s*')),
        'teacherSummary', pg_catalog.coalesce(teacher, ''),
        'classroomNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(pg_catalog.coalesce(room, ''), '\s*[,/&·]\s*')),
        'classroomSummary', pg_catalog.coalesce(room, ''),
        'schedule', pg_catalog.coalesce(schedule, ''),
        'status', normalized_status,
        'statusFilter', normalized_status,
        'classGroupIds', pg_catalog.coalesce((select pg_catalog.jsonb_agg(member.group_id::text order by member.sort_order, member.group_id) from public.class_schedule_sync_group_members member where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupNames', pg_catalog.coalesce((select pg_catalog.jsonb_agg(group_row.name order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupLabel', pg_catalog.coalesce((select pg_catalog.string_agg(group_row.name, ', ' order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '미분류'),
        'textbookCount', textbook_count,
        'textbookCatalog', '[]'::jsonb,
        'textbookTitles', '[]'::jsonb,
        'textbookSummary', case when textbook_count > 0 then textbook_count::text || '권 연결' else '교재 미연결' end,
        'textbookOverflowCount', 0,
        'textbookScopeLabels', '[]'::jsonb,
        'totalSessions', session_count,
        'completedSessions', planned_count,
        'updatedSessions', planned_count,
        'delayedSessions', pg_catalog.greatest(session_count - planned_count, 0),
        'plannedSessions', planned_count,
        'progressTargetSessions', case when textbook_count > 0 then session_count else 0 end,
        'delayedProgressSessions', case when textbook_count > 0 then pg_catalog.greatest(session_count - planned_count, 0) else 0 end,
        'plannedProgressSessions', planned_count,
        'progressPercent', case when session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'progressTargetPercent', case when textbook_count > 0 and session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'lastUpdatedAt', pg_catalog.coalesce(last_updated_at::text, ''),
        'stateLabel', state_label,
        'latestNoteSummary', '',
        'latestNoteSessionLabel', '',
        'pendingSessionLabels', '[]'::jsonb,
        'nextSession', case when next_session_id is null then null else pg_catalog.jsonb_build_object(
          'sessionId', next_session_id,
          'sessionKey', next_session_key,
          'sessionOrder', 0,
          'label', pg_catalog.to_char(next_session_date, 'YYYY-MM-DD'),
          'progressStatus', 'pending',
          'hasActualContent', false,
          'updatedAt', '',
          'noteSummary', '',
          'dateValue', next_session_date,
          'dateLabel', next_session_date,
          'periodLabel', pg_catalog.concat_ws('~', next_start_time::text, next_end_time::text),
          'scheduleState', next_schedule_state,
          'scheduleMemo', '',
          'makeupMemo', '',
          'makeupDate', '',
          'hasPlanContent', false,
          'planSummary', '',
          'textbookEntryCount', 0,
          'textbookEntries', '[]'::jsonb
        ) end,
        'sessionSummaries', '[]'::jsonb,
        'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', name, subject, grade, teacher, room, schedule, state_label))
      ) as row_data
    from page_candidates
  ), stats as materialized (
    select pg_catalog.jsonb_build_object(
      'total', pg_catalog.count(*)::integer,
      'managedClassCount', pg_catalog.count(*) filter (where session_count > 0)::integer,
      'totalSessions', pg_catalog.coalesce(pg_catalog.sum(session_count),0)::integer,
      'completedSessions', pg_catalog.coalesce(pg_catalog.sum(planned_count),0)::integer,
      'pendingSessions', pg_catalog.coalesce(pg_catalog.sum(pg_catalog.greatest(session_count-planned_count,0)),0)::integer,
      'linkedTextbooks', pg_catalog.coalesce(pg_catalog.sum(textbook_count),0)::integer,
      'unlinkedClassCount', pg_catalog.count(*) filter (where view_mode='unlinked')::integer,
      'noScheduleClassCount', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
      'updateNeededClassCount', pg_catalog.count(*) filter (where state_label='진도 미배정')::integer,
      'completedClassCount', pg_catalog.count(*) filter (where state_label='계획 완료')::integer,
      'viewModeCounts', (
        select pg_catalog.jsonb_build_object(
          'all', pg_catalog.count(*)::integer,
          'unlinked', pg_catalog.count(*) filter (where view_mode='unlinked')::integer,
          'unscheduled', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
          'update', pg_catalog.count(*) filter (where view_mode='update')::integer,
          'done', pg_catalog.count(*) filter (where view_mode='done')::integer
        )
        from classified
      )
    ) as data from filtered
    where p_include_scope_metadata
  ), filter_options as materialized (
    select pg_catalog.jsonb_build_object(
      'periods', pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value',id,'label',name,'isDefault',is_default) order by sort_order,name) from (select id,name,is_default,sort_order from public.class_schedule_sync_groups order by sort_order,name limit 500) bounded), '[]'::jsonb),
      'statuses', pg_catalog.to_jsonb(array['수강','개강 준비','종강']),
      'subjects', pg_catalog.coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct subject as value from base where nullif(pg_catalog.btrim(subject),'') is not null order by subject limit 500) bounded), '[]'::jsonb),
      'grades', pg_catalog.coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct grade as value from base where nullif(pg_catalog.btrim(grade),'') is not null order by grade limit 500) bounded), '[]'::jsonb),
      'teachers', pg_catalog.coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct pg_catalog.btrim(token) as value from base cross join lateral pg_catalog.regexp_split_to_table(pg_catalog.coalesce(teacher,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb),
      'classrooms', pg_catalog.coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token)) as value from base cross join lateral pg_catalog.regexp_split_to_table(pg_catalog.coalesce(room,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb)
    ) as data
    where p_include_scope_metadata
  )
  select pg_catalog.jsonb_build_object(
    'rows', pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'sort_key',sort_key,'row_data',row_data) order by sort_key,id) from page_rows), '[]'::jsonb),
    'stats', case when p_include_scope_metadata then (select data from stats) else null end,
    'filterOptions', case when p_include_scope_metadata then (select data from filter_options) else null end,
    'resolvedPeriodId', v_filters ->> 'periodId'
  ) into v_result;

  return v_result;
end;
$$;

create function public.get_academic_curriculum_detail_v1(p_class_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_class jsonb;
  v_textbook_ids jsonb;
  v_schedule_count integer;
  v_progress_count integer;
  v_textbook_count integer;
  v_schedule jsonb;
  v_progress jsonb;
  v_textbooks jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_class_id is null then
    raise exception 'academic_curriculum_class_id_required' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_build_object(
    'id', class.id,
    'name', class.name,
    'className', class.name,
    'classType', class.class_type,
    'subject', class.subject,
    'subjectAreaKey', class.subject_area_key,
    'grade', class.grade,
    'teacher', class.teacher,
    'schedule', class.schedule,
    'room', class.room,
    'status', class.status,
    'termId', class.term_id,
    'period', class.period,
    'startDate', class.start_date,
    'endDate', class.end_date,
    'textbookIds', pg_catalog.coalesce(class.textbook_ids, '[]'::jsonb),
    'scheduleStorageMode', class.schedule_storage_mode,
    'scheduleRevision', class.schedule_revision
  ), pg_catalog.coalesce(class.textbook_ids, '[]'::jsonb)
  into v_class, v_textbook_ids
  from public.classes class where class.id = p_class_id;
  if not found then return null; end if;

  select pg_catalog.count(*) into v_schedule_count from public.class_lesson_sessions where class_id = p_class_id;
  select pg_catalog.count(*) into v_progress_count from public.progress_logs where class_id = p_class_id;
  select pg_catalog.jsonb_array_length(v_textbook_ids) into v_textbook_count;
  if v_schedule_count > 500 or v_progress_count > 500 or v_textbook_count > 500 then
    raise exception 'academic_curriculum_detail_too_dense' using errcode = '54000';
  end if;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'sessionKey',session_key,'sessionDate',session_date,'scheduleState',schedule_state,
    'startTime',start_time,'endTime',end_time,'teacherName',teacher_name_snapshot,
    'classroomName',classroom_name_snapshot,'memo',memo,'publicNote',public_note,'teacherNote',teacher_note,
    'revision',revision,'updatedAt',updated_at
  ) order by session_date,start_time,id), '[]'::jsonb)
  into v_schedule from public.class_lesson_sessions where class_id = p_class_id limit 501;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'classId',class_id,'textbookId',textbook_id,'progressKey',progress_key,
    'sessionId',session_id,'sessionOrder',session_order,'status',status,'rangeStart',range_start,
    'rangeEnd',range_end,'rangeLabel',range_label,'publicNote',public_note,'teacherNote',teacher_note,
    'updatedAt',updated_at
  ) order by updated_at desc,id), '[]'::jsonb)
  into v_progress from public.progress_logs where class_id = p_class_id limit 501;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',book.id,'title',pg_catalog.coalesce(book.title,book.name,''),'publisher',pg_catalog.coalesce(book.publisher,''),
    'subject',pg_catalog.coalesce(book.subject,''),'subjectAreaKey',pg_catalog.coalesce(book.subject_area_key,''),
    'category',pg_catalog.coalesce(book.category,'')
  ) order by pg_catalog.coalesce(book.title,book.name,''),book.id), '[]'::jsonb)
  into v_textbooks
  from public.textbooks book
  where v_textbook_ids ? book.id::text
  limit 501;

  return pg_catalog.jsonb_build_object(
    'id', p_class_id,
    'classItem', v_class,
    'scheduleRows', v_schedule,
    'progressRows', v_progress,
    'textbookRows', v_textbooks
  );
end;
$$;

revoke all on function dashboard_private.academic_class_status_v1(text,date,date) from public, anon, authenticated;
revoke all on function dashboard_private.academic_classroom_name_v1(text) from public, anon, authenticated;
revoke all on function public.get_academic_timetable_range_v1(date,date,text,text,text) from public, anon, authenticated;
revoke all on function public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean) from public, anon, authenticated;
revoke all on function public.get_academic_curriculum_detail_v1(uuid) from public, anon, authenticated;

grant usage on schema dashboard_private to authenticated;
grant execute on function dashboard_private.academic_class_status_v1(text,date,date) to authenticated;
grant execute on function dashboard_private.academic_classroom_name_v1(text) to authenticated;
grant execute on function public.get_academic_timetable_range_v1(date,date,text,text,text) to authenticated;
grant execute on function public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean) to authenticated;
grant execute on function public.get_academic_curriculum_detail_v1(uuid) to authenticated;

commit;
