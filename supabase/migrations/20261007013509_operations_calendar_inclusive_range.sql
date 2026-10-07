-- Read the stored inclusive range without changing event identities, grades or saved data.
-- Applies only to calendar and exact-detail reads; annual RPC is unchanged.
set lock_timeout = '1s';
set statement_timeout = '5s';

create or replace function public.get_operations_calendar_range_v1(
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_count integer;
  v_rows jsonb;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from
    or p_date_to - p_date_from > 41
  then
    raise exception 'operations_visible_range_invalid' using errcode = '22023';
  end if;

  with bounded as (
    select
      event.id,
      event.title,
      event.school_id,
      school.name as school,
      event.type,
      event.date as start,
      case when stored_range.range_end >= event.date then stored_range.range_end else event.date end as end,
      event.grade,
      event.note,
      school.name as canonical_school_name,
      school.category
    from public.academic_events as event
    left join public.academic_schools as school on school.id = event.school_id
    cross join lateral (
      select dashboard_private.extract_academic_event_meta_v1(event.note) as event_meta
    ) as metadata
    cross join lateral (
      select case
        when pg_catalog.jsonb_typeof(metadata.event_meta -> 'rangeEnd') = 'string'
          and (metadata.event_meta ->> 'rangeEnd') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_catalog.pg_input_is_valid(metadata.event_meta ->> 'rangeEnd', 'date')
        then (metadata.event_meta ->> 'rangeEnd')::date
        else null::date
      end as range_end
    ) as stored_range
    where event.date <= p_date_to
      and case when stored_range.range_end >= event.date then stored_range.range_end else event.date end >= p_date_from
    order by event.date asc, event.id asc
    limit 2001
  ), numbered as (
    select bounded.*, pg_catalog.row_number() over (order by bounded.start asc, bounded.id asc) as ordinal
    from bounded
  )
  select
    pg_catalog.count(*)::integer,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', numbered.id,
          'sourceId', numbered.id,
          'sourceKind', 'academic_event',
          'title', coalesce(nullif(pg_catalog.btrim(numbered.title), ''), '제목 없는 일정'),
          'startsAt', numbered.start,
          'endsAt', coalesce(numbered.end, numbered.start),
          'timeLabel', coalesce(nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name, '학교 미지정'),
          'durationLabel', case
            when coalesce(numbered.end, numbered.start) = numbered.start then '하루 일정'
            else numbered.start::text || ' ~ ' || coalesce(numbered.end, numbered.start)::text
          end,
          'eventType', case
            when numbered.type = '체험학습' then 'event'
            when numbered.type = '방학·휴일·기타' then 'reminder'
            when numbered.type = '팁스' then 'meeting'
            when numbered.type in ('시험기간', '영어시험일', '수학시험일', '과학시험일') then 'task'
            else 'personal'
          end,
          'typeLabel', numbered.type,
          'attendees', case
            when nullif(pg_catalog.btrim(numbered.grade), '') is null or numbered.grade = 'all' then '[]'::jsonb
            else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(numbered.grade, '\\s*,\\s*'))
          end,
          'subject', null,
          'place', coalesce(nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name),
          'color', case
            when numbered.type in ('시험기간', '영어시험일', '수학시험일', '과학시험일') then 'bg-rose-500'
            when numbered.type = '체험학습' then 'bg-emerald-500'
            when numbered.type = '방학·휴일·기타' then 'bg-amber-500'
            when numbered.type = '팁스' then 'bg-blue-500'
            else 'bg-violet-500'
          end,
          'description', nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(coalesce(numbered.note, ''), '[[TIPS_META]]', 1)), 160), ''),
          'schoolId', numbered.school_id,
          'schoolName', coalesce(nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name),
          'category', numbered.category,
          'grade', numbered.grade,
          'examTerm', null,
          'scopeSummary', null,
          'scienceAreaKey', null,
          'scienceAreaLabel', null,
          'notePreview', nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(coalesce(numbered.note, ''), '[[TIPS_META]]', 1)), 160), ''),
          'status', 'active',
          'revision', 0
        ) order by numbered.start asc, numbered.id asc
      ) filter (where numbered.ordinal <= 2000),
      '[]'::jsonb
    )
  into v_count, v_rows
  from numbered;

  if v_count > 2000 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'visible_range_too_dense',
      'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
      'rows', '[]'::jsonb,
      'observedRowsAtLeast', 2001,
      'suggestedDays', 7
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'range', pg_catalog.jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
    'rows', v_rows,
    'complete', true
  );
end
$function$;

create or replace function public.get_academic_event_detail_v1(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', event.id,
    'sourceId', event.id,
    'sourceKind', 'academic_event',
    'title', event.title,
    'startsAt', event.date,
    'endsAt', case when stored_range.range_end >= event.date then stored_range.range_end else event.date end,
    'timeLabel', coalesce(nullif(pg_catalog.btrim(school.name), ''), '학교 미지정'),
    'durationLabel', case when case when stored_range.range_end >= event.date then stored_range.range_end else event.date end = event.date then '하루 일정' else event.date::text || ' ~ ' || (case when stored_range.range_end >= event.date then stored_range.range_end else event.date end)::text end,
    'eventType', case when event.type = '체험학습' then 'event' when event.type = '방학·휴일·기타' then 'reminder' when event.type = '팁스' then 'meeting' when event.type in ('시험기간','영어시험일','수학시험일','과학시험일') then 'task' else 'personal' end,
    'typeLabel', event.type,
    'attendees', case when nullif(pg_catalog.btrim(event.grade), '') is null or event.grade = 'all' then '[]'::jsonb else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(event.grade, '\\s*,\\s*')) end,
    'subject', null,
    'place', nullif(pg_catalog.btrim(school.name), ''),
    'color', case when event.type in ('시험기간','영어시험일','수학시험일','과학시험일') then 'bg-rose-500' when event.type = '체험학습' then 'bg-emerald-500' when event.type = '방학·휴일·기타' then 'bg-amber-500' when event.type = '팁스' then 'bg-blue-500' else 'bg-violet-500' end,
    'description', nullif(pg_catalog.btrim(pg_catalog.split_part(coalesce(event.note, ''), '[[TIPS_META]]', 1)), ''),
    'schoolId', event.school_id,
    'schoolName', nullif(pg_catalog.btrim(school.name), ''),
    'category', school.category,
    'grade', event.grade,
    'examTerm', null,
    'scopeSummary', null,
    'scienceAreaKey', null,
    'scienceAreaLabel', null,
    'notePreview', nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(coalesce(event.note, ''), '[[TIPS_META]]', 1)), 160), ''),
    'status', 'active',
    'revision', 0,
    'storedNote', event.note,
    'note', nullif(pg_catalog.btrim(pg_catalog.split_part(coalesce(event.note, ''), '[[TIPS_META]]', 1)), ''),
    'embeddedNoteMeta', null,
    'textbookScopes', '[]'::jsonb,
    'subtextbookScopes', '[]'::jsonb,
    'materialSections', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'label', coalesce(detail.subject, '시험범위'),
        'items', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
          nullif(pg_catalog.btrim(detail.textbook_scope), ''),
          nullif(pg_catalog.btrim(detail.supplement_scope), ''),
          nullif(pg_catalog.btrim(detail.other_scope), '')
        ], null))
      ) order by detail.sort_order asc, detail.id asc)
      from public.academic_event_exam_details as detail
      where detail.academic_event_id = event.id
    ), '[]'::jsonb)
  )
  from public.academic_events as event
  left join public.academic_schools as school on school.id = event.school_id
  cross join lateral (
      select dashboard_private.extract_academic_event_meta_v1(event.note) as event_meta
    ) as metadata
    cross join lateral (
      select case
        when pg_catalog.jsonb_typeof(metadata.event_meta -> 'rangeEnd') = 'string'
          and (metadata.event_meta ->> 'rangeEnd') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_catalog.pg_input_is_valid(metadata.event_meta ->> 'rangeEnd', 'date')
        then (metadata.event_meta ->> 'rangeEnd')::date
        else null::date
      end as range_end
    ) as stored_range
  where event.id = p_event_id
$function$;
