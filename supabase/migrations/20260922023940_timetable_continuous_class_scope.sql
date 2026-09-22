begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Remove semester and class-date visibility gates from weekly timetable templates.
-- Row limits, invoker RLS, authenticated ACL, range validation and payload shape remain.
create or replace function public.get_academic_timetable_range_v1(
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
  -- Weekly templates are selected by class status, never by a historical semester.
  -- Keep the retired argument and empty metadata keys for old client compatibility.
  v_class_group_id := null;

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
      coalesce(term.academic_year, nullif(pg_catalog.substring(class.period, '([0-9]{4})'), '')::integer, pg_catalog.date_part('year', current_date)::integer) as academic_year,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), nullif(pg_catalog.btrim(term.name), '')) as term_name,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (nullif(pg_catalog.btrim(p_status), '') is null
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(p_status))
      and (nullif(pg_catalog.btrim(p_subject), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(p_subject))
  ), parsed as materialized (
    select
      class.*,
      '[]'::jsonb as group_ids,
      '[]'::jsonb as group_names,
      matched.parts,
      day_value.day,
      coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) <> ''
            and pg_catalog.btrim(token) !~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.teacher, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      ) as row_teacher,
      dashboard_private.academic_classroom_name_v1(coalesce(
        nullif(pg_catalog.btrim((
          select token
          from pg_catalog.regexp_split_to_table(coalesce(matched.parts[4], ''), '[,/&·]+') token
          where pg_catalog.btrim(token) ~* '(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관|^(본|별)[0-9]+(강)?$|^[0-9]+(강|실|관)$)'
          limit 1
        )), ''),
        nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.regexp_replace(coalesce(class.room, ''), '[&/·]', ',', 'g'), ',', 1)), ''),
        ''
      )) as row_classroom
    from eligible class
    cross join lateral pg_catalog.regexp_matches(
      coalesce(class.schedule, ''),
      '([월화수목금토일]+)\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})(?:\s*\(([^)]+)\))?',
      'g'
    ) matched(parts)
    cross join lateral pg_catalog.regexp_split_to_table(matched.parts[1], '') day_value(day)
    where day_value.day in ('월','화','수','목','금','토','일')
  ), row_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', parsed.id::text || ':' || parsed.day || ':' || parsed.parts[2] || ':' || parsed.parts[3],
      'classId', parsed.id,
      'title', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''),
      'fullTitle', coalesce(parsed.name, ''),
      'academicYear', parsed.academic_year::text,
      'subject', coalesce(parsed.subject, ''),
      'subjectAreaKey', coalesce(parsed.subject_area_key, ''),
      'grade', coalesce(parsed.grade, ''),
      'teacher', parsed.row_teacher,
      'classroom', parsed.row_classroom,
      'term', coalesce(parsed.term_name, ''),
      'schedule', coalesce(parsed.schedule, ''),
      'status', parsed.normalized_status,
      'statusFilter', parsed.normalized_status,
      'classGroupIds', parsed.group_ids,
      'classGroupNames', parsed.group_names,
      'classGroupLabel', coalesce((select pg_catalog.string_agg(value, ', ') from pg_catalog.jsonb_array_elements_text(parsed.group_names) value), '미분류'),
      'day', parsed.day,
      'dayIndex', case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      'start', parsed.parts[2],
      'end', parsed.parts[3],
      'startMinutes', pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[2], ':', 2)::integer,
      'endMinutes', pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer,
      'durationMinutes', greatest(0,
        pg_catalog.split_part(parsed.parts[3], ':', 1)::integer * 60 + pg_catalog.split_part(parsed.parts[3], ':', 2)::integer
        - pg_catalog.split_part(parsed.parts[2], ':', 1)::integer * 60 - pg_catalog.split_part(parsed.parts[2], ':', 2)::integer),
      'searchText', pg_catalog.lower(pg_catalog.concat_ws(' ', pg_catalog.regexp_replace(coalesce(parsed.name, ''), '^\[[^]]+\]\s*', ''), parsed.subject, parsed.grade, parsed.row_teacher, parsed.row_classroom, parsed.normalized_status, parsed.term_name, parsed.schedule))
    ) as row_data,
    parsed.day,
    parsed.parts[2] as start_time,
    parsed.id
    from parsed
    order by case parsed.day when '월' then 0 when '화' then 1 when '수' then 2 when '목' then 3 when '금' then 4 when '토' then 5 else 6 end,
      parsed.parts[2], parsed.id
    limit 2001
  ), class_summary_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'id', class.id,
      'subject', class.subject,
      'grade', class.grade,
      'term_id', class.term_id,
      'period', class.period,
      'academic_year', class.academic_year
    ) as row_data
    from eligible class order by class.name collate dashboard_private.ko_numeric, class.id limit 501
  ), teacher_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.teacher_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.teacher, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  ), classroom_limited as materialized (
    select pg_catalog.jsonb_build_object(
      'name', catalog.name,
      'subjects', catalog.subjects,
      'is_visible', catalog.is_visible,
      'sort_order', catalog.sort_order
    ) as row_data
    from public.classroom_catalogs catalog
    where catalog.is_visible
      and exists (select 1 from eligible class where coalesce(class.room, '') ilike '%' || catalog.name || '%')
    order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id limit 501
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by day, start_time, id) from row_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from class_summary_limited), '[]'::jsonb),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    coalesce((select pg_catalog.jsonb_agg(row_data) from teacher_limited), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(row_data) from classroom_limited), '[]'::jsonb),
    pg_catalog.jsonb_build_array('수강','개강 준비','종강'),
    coalesce((select pg_catalog.jsonb_agg(distinct subject order by subject) filter (where nullif(pg_catalog.btrim(subject), '') is not null) from eligible), '[]'::jsonb)
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

revoke all on function public.get_academic_timetable_range_v1(date,date,text,text,text) from public, anon;
grant execute on function public.get_academic_timetable_range_v1(date,date,text,text,text) to authenticated;
commit;
