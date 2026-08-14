create function dashboard_private.extract_academic_event_meta_v1(p_note text)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_encoded text;
begin
  if pg_catalog.position('[[TIPS_META]]' in pg_catalog.coalesce(p_note, '')) = 0 then
    return '{}'::jsonb;
  end if;
  v_encoded := pg_catalog.btrim(pg_catalog.split_part(p_note, '[[TIPS_META]]', 2));
  if v_encoded = '' then return '{}'::jsonb; end if;
  return v_encoded::jsonb;
exception when others then
  return '{}'::jsonb;
end
$function$;

create function dashboard_private.normalize_academic_exam_period_key_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  with normalized as (
    select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.coalesce(p_value, ''), E'[\\s_-]+', '', 'g')) as value
  )
  select case
    when (value like '%1학기%' and value like '%중간%') or (value like '%1%' and (value like '%mid%' or value like '%middle%')) then '1mid'
    when (value like '%1학기%' and value like '%기말%') or (value like '%1%' and value like '%final%') then '1final'
    when (value like '%2학기%' and value like '%중간%') or (value like '%2%' and (value like '%mid%' or value like '%middle%')) then '2mid'
    when (value like '%2학기%' and value like '%기말%') or (value like '%2%' and value like '%final%') then '2final'
    else value
  end
  from normalized
$function$;

create function public.get_operations_calendar_range_v1(
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
      event.school,
      event.type,
      event.start,
      event.end,
      event.grade,
      event.note,
      school.name as canonical_school_name,
      school.category
    from public.academic_events as event
    left join public.academic_schools as school on school.id = event.school_id
    where event.start <= p_date_to
      and pg_catalog.coalesce(event.end, event.start) >= p_date_from
    order by event.start asc, event.id asc
    limit 2001
  ), numbered as (
    select bounded.*, pg_catalog.row_number() over (order by bounded.start asc, bounded.id asc) as ordinal
    from bounded
  )
  select
    pg_catalog.count(*)::integer,
    pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', numbered.id,
          'sourceId', numbered.id,
          'sourceKind', 'academic_event',
          'title', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(numbered.title), ''), '제목 없는 일정'),
          'startsAt', numbered.start,
          'endsAt', pg_catalog.coalesce(numbered.end, numbered.start),
          'timeLabel', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name, '학교 미지정'),
          'durationLabel', case
            when pg_catalog.coalesce(numbered.end, numbered.start) = numbered.start then '하루 일정'
            else numbered.start::text || ' ~ ' || pg_catalog.coalesce(numbered.end, numbered.start)::text
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
            when pg_catalog.nullif(pg_catalog.btrim(numbered.grade), '') is null or numbered.grade = 'all' then '[]'::jsonb
            else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(numbered.grade, '\\s*,\\s*'))
          end,
          'subject', null,
          'place', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name),
          'color', case
            when numbered.type in ('시험기간', '영어시험일', '수학시험일', '과학시험일') then 'bg-rose-500'
            when numbered.type = '체험학습' then 'bg-emerald-500'
            when numbered.type = '방학·휴일·기타' then 'bg-amber-500'
            when numbered.type = '팁스' then 'bg-blue-500'
            else 'bg-violet-500'
          end,
          'description', pg_catalog.nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(numbered.note, ''), '[[TIPS_META]]', 1)), 160), ''),
          'schoolId', numbered.school_id,
          'schoolName', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(numbered.school), ''), numbered.canonical_school_name),
          'category', numbered.category,
          'grade', numbered.grade,
          'examTerm', null,
          'scopeSummary', null,
          'scienceAreaKey', null,
          'scienceAreaLabel', null,
          'notePreview', pg_catalog.nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(numbered.note, ''), '[[TIPS_META]]', 1)), 160), ''),
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

create function public.get_operations_annual_board_v1(p_academic_year integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_entry_count integer;
  v_rows jsonb;
  v_payload_bytes integer;
  v_year_options jsonb;
  v_school_count integer;
  v_active_type_count integer;
begin
  if p_academic_year < 2000 or p_academic_year > 2200 then
    raise exception 'operations_academic_year_invalid' using errcode = '22023';
  end if;

  with base_events as (
    select
      event.id,
      event.id::text as entry_id,
      event.id as parent_event_id,
      'academic_event'::text as source_kind,
      event.school_id,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.school), ''), school.name, '학교 미지정') as school_name,
      pg_catalog.coalesce(school.category, 'all') as category,
      grade_token.grade,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.type), ''), '팁스') as entry_type,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.title), ''), '제목 없는 일정') as title,
      exam_term.value as exam_term,
      dashboard_private.normalize_academic_exam_period_key_v1(exam_term.value) as exam_period_key,
      event.title as term_source_title,
      event.start as start_date,
      pg_catalog.coalesce(event.end, event.start) as end_date,
      pg_catalog.nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(event.note, ''), '[[TIPS_META]]', 1)), 160), '') as note_preview,
      metadata.event_meta,
      science_area.label as science_area_label,
      null::text as scope_summary,
      '[]'::jsonb as display_sections
    from public.academic_events as event
    left join public.academic_schools as school on school.id = event.school_id
    cross join lateral (select dashboard_private.extract_academic_event_meta_v1(event.note) as event_meta) as metadata
    cross join lateral (
      select pg_catalog.coalesce(
        pg_catalog.nullif(pg_catalog.btrim(metadata.event_meta ->> 'examTerm'), ''),
        case
          when event.title ilike '%중간%' then case
            when event.title ilike '%2학기%' then '2학기 중간'
            when event.title ilike '%1학기%' then '1학기 중간'
            when pg_catalog.extract(month from event.start) >= 8 then '2학기 중간'
            else '1학기 중간'
          end
          when event.title ilike '%기말%' then case
            when event.title ilike '%2학기%' then '2학기 기말'
            when event.title ilike '%1학기%' then '1학기 기말'
            when pg_catalog.extract(month from event.start) >= 8 then '2학기 기말'
            else '1학기 기말'
          end
          else null
        end
      ) as value
    ) as exam_term
    left join public.list_active_science_subject_areas_v1() as science_area
      on science_area.area_key = metadata.event_meta ->> 'scienceAreaKey'
      and science_area.subject = '과학'
      and science_area.is_active
    cross join lateral (
      select pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(split_grade.value), ''), 'all') as grade
      from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.grade), ''), 'all'), E'\\s*,\\s*') as split_grade(value)
    ) as grade_token
    where event.start >= pg_catalog.make_date(p_academic_year, 1, 1)
      and event.start < pg_catalog.make_date(p_academic_year + 1, 1, 1)
  ), subject_events as (
    select
      detail.id,
      'exam-detail:' || detail.id::text as entry_id,
      event.id as parent_event_id,
      'academic_event_exam_detail'::text as source_kind,
      pg_catalog.coalesce(detail.school_id, event.school_id) as school_id,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.school), ''), school.name, '학교 미지정') as school_name,
      pg_catalog.coalesce(school.category, 'all') as category,
      grade_token.grade,
      case
        when detail.subject ilike '%영어%' then '영어시험일'
        when detail.subject ilike '%수학%' then '수학시험일'
        when detail.subject = '과학' or pg_catalog.lower(detail.subject) = 'science' then '과학시험일'
        else '시험기간'
      end as entry_type,
      case
        when detail.subject ilike '%영어%' then '영어 시험일 및 시험범위'
        when detail.subject ilike '%수학%' then '수학 시험일 및 시험범위'
        when detail.subject = '과학' or pg_catalog.lower(detail.subject) = 'science' then '과학 시험일 및 시험범위'
        else pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.title), ''), '시험기간')
      end as title,
      exam_term.value as exam_term,
      dashboard_private.normalize_academic_exam_period_key_v1(exam_term.value) as exam_period_key,
      event.title as term_source_title,
      pg_catalog.coalesce(detail.exam_date, event.start) as start_date,
      pg_catalog.coalesce(detail.exam_date, event.start) as end_date,
      pg_catalog.nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.coalesce(detail.note, '')), 160), '') as note_preview,
      metadata.event_meta,
      science_area.label as science_area_label,
      pg_catalog.nullif(pg_catalog.concat_ws(' · ',
        pg_catalog.nullif(pg_catalog.btrim(detail.textbook_scope), ''),
        pg_catalog.nullif(pg_catalog.btrim(detail.supplement_scope), ''),
        pg_catalog.nullif(pg_catalog.btrim(detail.other_scope), '')
      ), '') as scope_summary,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'label', '시험범위',
        'items', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
          pg_catalog.nullif(pg_catalog.btrim(detail.textbook_scope), ''),
          pg_catalog.nullif(pg_catalog.btrim(detail.supplement_scope), ''),
          pg_catalog.nullif(pg_catalog.btrim(detail.other_scope), '')
        ], null))
      )) as display_sections
    from public.academic_event_exam_details as detail
    join public.academic_events as event on event.id = detail.academic_event_id
    left join public.academic_schools as school on school.id = pg_catalog.coalesce(detail.school_id, event.school_id)
    cross join lateral (select dashboard_private.extract_academic_event_meta_v1(event.note) as event_meta) as metadata
    cross join lateral (
      select pg_catalog.coalesce(
        pg_catalog.nullif(pg_catalog.btrim(metadata.event_meta ->> 'examTerm'), ''),
        case
          when event.title ilike '%중간%' then case
            when event.title ilike '%2학기%' then '2학기 중간'
            when event.title ilike '%1학기%' then '1학기 중간'
            when pg_catalog.extract(month from event.start) >= 8 then '2학기 중간'
            else '1학기 중간'
          end
          when event.title ilike '%기말%' then case
            when event.title ilike '%2학기%' then '2학기 기말'
            when event.title ilike '%1학기%' then '1학기 기말'
            when pg_catalog.extract(month from event.start) >= 8 then '2학기 기말'
            else '1학기 기말'
          end
          else null
        end
      ) as value
    ) as exam_term
    left join public.list_active_science_subject_areas_v1() as science_area
      on science_area.area_key = metadata.event_meta ->> 'scienceAreaKey'
      and science_area.subject = '과학'
      and science_area.is_active
    cross join lateral (
      select pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(split_grade.value), ''), 'all') as grade
      from pg_catalog.regexp_split_to_table(
        pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(detail.grade), ''), pg_catalog.nullif(pg_catalog.btrim(event.grade), ''), 'all'),
        E'\\s*,\\s*'
      ) as split_grade(value)
    ) as grade_token
    where pg_catalog.coalesce(detail.exam_date, event.start) >= pg_catalog.make_date(p_academic_year, 1, 1)
      and pg_catalog.coalesce(detail.exam_date, event.start) < pg_catalog.make_date(p_academic_year + 1, 1, 1)
  ), fallback_subject_entries as (
    select
      base.id,
      'material-fallback:' || base.id::text || ':' || subject_entry.entry_type as entry_id,
      base.parent_event_id,
      'academic_event_material_fallback'::text as source_kind,
      base.school_id,
      base.school_name,
      base.category,
      base.grade,
      subject_entry.entry_type,
      subject_entry.title,
      base.exam_term,
      base.exam_period_key,
      base.term_source_title,
      base.start_date,
      base.end_date,
      base.note_preview,
      base.event_meta,
      base.science_area_label,
      null::text as scope_summary,
      '[]'::jsonb as display_sections
    from base_events as base
    cross join lateral (
      values
        ('영어시험일'::text, '영어'::text, '영어 시험일 및 시험범위'::text),
        ('수학시험일'::text, '수학'::text, '수학 시험일 및 시험범위'::text),
        ('과학시험일'::text, '과학'::text, '과학 시험일 및 시험범위'::text)
    ) as subject_entry(entry_type, subject, title)
    where base.entry_type = '시험기간'
      and base.exam_period_key <> ''
      and (
      exists (
        select 1
        from public.academic_exam_material_plans as material_plan
        join public.academic_exam_material_items as material_item on material_item.plan_id = material_plan.id
        where material_plan.academic_year = p_academic_year
          and material_plan.school_id = base.school_id
          and material_plan.grade = base.grade
          and material_plan.subject = subject_entry.subject
          and dashboard_private.normalize_academic_exam_period_key_v1(material_plan.exam_period_code) = base.exam_period_key
        limit 1
      )
      or exists (
        select 1
        from public.academy_curriculum_plans as curriculum_plan
        where curriculum_plan.academic_year = p_academic_year
          and curriculum_plan.academy_grade = base.grade
          and curriculum_plan.subject = subject_entry.subject
          and (
            curriculum_plan.main_textbook_id is not null
            or exists (select 1 from public.academy_curriculum_materials as curriculum_material where curriculum_material.plan_id = curriculum_plan.id)
          )
        limit 1
      )
      or exists (
        select 1
        from public.academic_curriculum_profiles as curriculum_profile
        where curriculum_profile.academic_year = p_academic_year
          and curriculum_profile.school_id = base.school_id
          and curriculum_profile.grade = base.grade
          and curriculum_profile.subject = subject_entry.subject
          and (
            pg_catalog.nullif(pg_catalog.btrim(curriculum_profile.main_textbook_title), '') is not null
            or exists (select 1 from public.academic_supplement_materials as supplement where supplement.profile_id = curriculum_profile.id)
          )
        limit 1
      )
      )
      and not exists (
        select 1
        from subject_events as subject_event
        where subject_event.parent_event_id = base.parent_event_id
          and subject_event.grade = base.grade
          and subject_event.entry_type = subject_entry.entry_type
      )
  ), bounded_entries as (
    select entry.*
    from (
      select * from base_events
      union all
      select * from subject_events
      union all
      select * from fallback_subject_entries
    ) as entry
    order by entry.start_date asc, entry.id asc
    limit 4001
  ), projected as (
    select
      bounded_entries.*,
      material_sections.sections as material_sections,
      pg_catalog.jsonb_build_object(
        'id', bounded_entries.entry_id,
        'parentEventId', bounded_entries.parent_event_id,
        'sourceKind', bounded_entries.source_kind,
        'title', bounded_entries.title,
        'type', bounded_entries.entry_type,
        'start', bounded_entries.start_date,
        'end', bounded_entries.end_date,
        'dateLabel', case
          when bounded_entries.start_date = bounded_entries.end_date then bounded_entries.start_date::text
          else bounded_entries.start_date::text || ' ~ ' || bounded_entries.end_date::text
        end,
        'schoolId', bounded_entries.school_id,
        'schoolName', bounded_entries.school_name,
        'grade', bounded_entries.grade,
        'gradeBadges', case when bounded_entries.grade = 'all' then '[]'::jsonb else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(bounded_entries.grade, '\\s*,\\s*')) end,
        'examTerm', bounded_entries.exam_term,
        'examDateLabel', bounded_entries.start_date,
        'linkedScheduleLabel', null,
        'scopeSummary', bounded_entries.scope_summary,
        'scienceAreaKey', bounded_entries.event_meta ->> 'scienceAreaKey',
        'scienceAreaLabel', bounded_entries.science_area_label,
        'textbookScope', bounded_entries.event_meta ->> 'textbookScope',
        'subtextbookScope', bounded_entries.event_meta ->> 'subtextbookScope',
        'textbookScopes', pg_catalog.coalesce((select pg_catalog.jsonb_agg(scope_item.value) from (select value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bounded_entries.event_meta -> 'textbookScopes') = 'array' then bounded_entries.event_meta -> 'textbookScopes' else '[]'::jsonb end) as value limit 4) as scope_item), '[]'::jsonb),
        'subtextbookScopes', pg_catalog.coalesce((select pg_catalog.jsonb_agg(scope_item.value) from (select value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bounded_entries.event_meta -> 'subtextbookScopes') = 'array' then bounded_entries.event_meta -> 'subtextbookScopes' else '[]'::jsonb end) as value limit 4) as scope_item), '[]'::jsonb),
        'displayMeta', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'examTerm', bounded_entries.event_meta ->> 'examTerm',
          'scienceAreaKey', bounded_entries.event_meta ->> 'scienceAreaKey',
          'scienceAreaLabel', bounded_entries.science_area_label
        )),
        'metaBadges', case when bounded_entries.scope_summary is null then '[]'::jsonb else pg_catalog.jsonb_build_array(bounded_entries.scope_summary) end,
        'materialSections', bounded_entries.display_sections || material_sections.sections,
        'displaySections', bounded_entries.display_sections || material_sections.sections,
        'notePreview', bounded_entries.note_preview,
        'color', case
          when bounded_entries.entry_type in ('시험기간', '영어시험일', '수학시험일', '과학시험일') then 'bg-rose-500'
          when bounded_entries.entry_type = '체험학습' then 'bg-emerald-500'
          when bounded_entries.entry_type = '방학·휴일·기타' then 'bg-amber-500'
          else 'bg-blue-500'
        end,
        'revision', 0
      ) as entry_data
    from bounded_entries
    cross join lateral (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label', material.label, 'items', pg_catalog.jsonb_build_array(material.value)) order by material.sort_order, material.value), '[]'::jsonb) as sections
      from (
        select
          case
            when pg_catalog.lower(material_item.material_category) like any (array['%textbook%', '%main%', '%교과서%']) then '교과서'
            when pg_catalog.lower(material_item.material_category) like any (array['%supplement%', '%sub%', '%부교재%']) then '부교재'
            else '자료'
          end as label,
          pg_catalog.concat_ws(' · ', pg_catalog.nullif(pg_catalog.btrim(material_item.title), ''), pg_catalog.nullif(pg_catalog.btrim(material_item.publisher), ''), pg_catalog.nullif(pg_catalog.btrim(material_item.scope_detail), '')) as value,
          material_item.sort_order
        from public.academic_exam_material_plans as material_plan
        join public.academic_exam_material_items as material_item on material_item.plan_id = material_plan.id
        where material_plan.academic_year = p_academic_year
          and material_plan.school_id = bounded_entries.school_id
          and material_plan.grade = bounded_entries.grade
          and material_plan.subject = case bounded_entries.entry_type when '영어시험일' then '영어' when '수학시험일' then '수학' when '과학시험일' then '과학' else null end
          and dashboard_private.normalize_academic_exam_period_key_v1(material_plan.exam_period_code) = bounded_entries.exam_period_key
        union all
        select
          '교과서' as label,
          pg_catalog.concat_ws(' · ',
            pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(main_textbook.title), ''), pg_catalog.nullif(pg_catalog.btrim(main_textbook.name), '')),
            pg_catalog.nullif(pg_catalog.btrim(main_textbook.publisher), ''),
            pg_catalog.nullif(pg_catalog.btrim(curriculum_plan.note), '')
          ) as value,
          curriculum_plan.sort_order
        from public.academy_curriculum_plans as curriculum_plan
        left join public.textbooks as main_textbook on main_textbook.id = curriculum_plan.main_textbook_id
        where curriculum_plan.academic_year = p_academic_year
          and curriculum_plan.academy_grade = bounded_entries.grade
          and curriculum_plan.subject = case bounded_entries.entry_type when '영어시험일' then '영어' when '수학시험일' then '수학' when '과학시험일' then '과학' else null end
          and curriculum_plan.main_textbook_id is not null
        union all
        select
          '부교재' as label,
          pg_catalog.concat_ws(' · ',
            pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(curriculum_material.title), ''), pg_catalog.nullif(pg_catalog.btrim(material_textbook.title), ''), pg_catalog.nullif(pg_catalog.btrim(material_textbook.name), '')),
            pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(curriculum_material.publisher), ''), pg_catalog.nullif(pg_catalog.btrim(material_textbook.publisher), '')),
            pg_catalog.nullif(pg_catalog.btrim(curriculum_material.note), '')
          ) as value,
          curriculum_material.sort_order
        from public.academy_curriculum_plans as curriculum_plan
        join public.academy_curriculum_materials as curriculum_material on curriculum_material.plan_id = curriculum_plan.id
        left join public.textbooks as material_textbook on material_textbook.id = curriculum_material.textbook_id
        where curriculum_plan.academic_year = p_academic_year
          and curriculum_plan.academy_grade = bounded_entries.grade
          and curriculum_plan.subject = case bounded_entries.entry_type when '영어시험일' then '영어' when '수학시험일' then '수학' when '과학시험일' then '과학' else null end
        union all
        select
          '교과서' as label,
          pg_catalog.concat_ws(' · ',
            pg_catalog.nullif(pg_catalog.btrim(curriculum_profile.main_textbook_title), ''),
            pg_catalog.nullif(pg_catalog.btrim(curriculum_profile.main_textbook_publisher), ''),
            pg_catalog.nullif(pg_catalog.btrim(curriculum_profile.note), '')
          ) as value,
          0 as sort_order
        from public.academic_curriculum_profiles as curriculum_profile
        where curriculum_profile.academic_year = p_academic_year
          and curriculum_profile.school_id = bounded_entries.school_id
          and curriculum_profile.grade = bounded_entries.grade
          and curriculum_profile.subject = case bounded_entries.entry_type when '영어시험일' then '영어' when '수학시험일' then '수학' when '과학시험일' then '과학' else null end
          and pg_catalog.nullif(pg_catalog.btrim(curriculum_profile.main_textbook_title), '') is not null
        union all
        select
          '부교재' as label,
          pg_catalog.concat_ws(' · ',
            pg_catalog.nullif(pg_catalog.btrim(supplement.title), ''),
            pg_catalog.nullif(pg_catalog.btrim(supplement.publisher), ''),
            pg_catalog.nullif(pg_catalog.btrim(supplement.note), '')
          ) as value,
          supplement.sort_order
        from public.academic_curriculum_profiles as curriculum_profile
        join public.academic_supplement_materials as supplement on supplement.profile_id = curriculum_profile.id
        where curriculum_profile.academic_year = p_academic_year
          and curriculum_profile.school_id = bounded_entries.school_id
          and curriculum_profile.grade = bounded_entries.grade
          and curriculum_profile.subject = case bounded_entries.entry_type when '영어시험일' then '영어' when '수학시험일' then '수학' when '과학시험일' then '과학' else null end
        order by sort_order asc, value asc
        limit 24
      ) as material
    ) as material_sections
  ), grouped as (
    select
      projected.school_id,
      projected.school_name,
      projected.category,
      projected.grade,
      pg_catalog.count(*)::integer as total_events,
      pg_catalog.jsonb_build_object(
        '시험기간', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '시험기간'), '[]'::jsonb),
        '영어시험일', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '영어시험일'), '[]'::jsonb),
        '수학시험일', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '수학시험일'), '[]'::jsonb),
        '과학시험일', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '과학시험일'), '[]'::jsonb),
        '체험학습', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '체험학습'), '[]'::jsonb),
        '방학·휴일·기타', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '방학·휴일·기타'), '[]'::jsonb),
        '팁스', pg_catalog.coalesce(pg_catalog.jsonb_agg(projected.entry_data order by projected.start_date, projected.id) filter (where projected.entry_type = '팁스'), '[]'::jsonb)
      ) as type_buckets
    from projected
    group by projected.school_id, projected.school_name, projected.category, projected.grade
  )
  select
    (select pg_catalog.count(*)::integer from bounded_entries),
    pg_catalog.coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', pg_catalog.coalesce(grouped.school_id::text, pg_catalog.md5(grouped.school_name)) || ':' || grouped.grade,
        'schoolId', grouped.school_id,
        'schoolName', grouped.school_name,
        'category', grouped.category,
        'grade', grouped.grade,
        'gradeValues', case when grouped.grade = 'all' then '[]'::jsonb else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(grouped.grade, '\\s*,\\s*')) end,
        'gradeBadges', case when grouped.grade = 'all' then '[]'::jsonb else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(grouped.grade, '\\s*,\\s*')) end,
        'totalEvents', grouped.total_events,
        'typeBuckets', grouped.type_buckets
      ) order by grouped.school_name asc, grouped.grade asc
    ), '[]'::jsonb),
    (select pg_catalog.count(distinct pg_catalog.coalesce(projected.school_id::text, projected.school_name))::integer from projected),
    (select pg_catalog.count(distinct projected.entry_type)::integer from projected)
  into v_entry_count, v_rows, v_school_count, v_active_type_count
  from grouped;

  if v_entry_count > 4000 then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'annual_board_too_dense');
  end if;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(year_value order by year_value desc), '[]'::jsonb)
  into v_year_options
  from (
    select distinct pg_catalog.extract(year from event.start)::integer as year_value
    from public.academic_events as event
    where event.start is not null
    order by year_value desc
    limit 50
  ) as years;

  v_payload_bytes := pg_catalog.octet_length(pg_catalog.convert_to(v_rows::text, 'UTF8'));
  if v_payload_bytes > 400 * 1024 then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'annual_board_too_dense');
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'data', pg_catalog.jsonb_build_object(
      'academicYear', p_academic_year,
      'selectedSemester', 'all',
      'yearOptions', case when v_year_options @> pg_catalog.jsonb_build_array(p_academic_year) then v_year_options else pg_catalog.jsonb_build_array(p_academic_year) || v_year_options end,
      'rows', v_rows,
      'summary', pg_catalog.jsonb_build_object(
        'schoolCount', pg_catalog.coalesce(v_school_count, 0),
        'eventCount', pg_catalog.coalesce(v_entry_count, 0),
        'activeTypeCount', pg_catalog.coalesce(v_active_type_count, 0)
      )
    )
  );
end
$function$;

create function public.get_operations_class_schedule_page_v1(
  p_filters jsonb,
  p_cursor_sort_key text,
  p_cursor_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_keys text[];
  v_rows jsonb;
  v_stats jsonb;
  v_options jsonb;
begin
  select pg_catalog.array_agg(filter_key.key order by filter_key.key)
  into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as filter_key(key);

  if pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or v_keys is distinct from array['grade','search','subject','syncGroupId','teacher','termId']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (
      select 1
      from pg_catalog.jsonb_each(p_filters) as filter_value(key, value)
      where filter_value.key <> 'search'
        and pg_catalog.jsonb_typeof(filter_value.value) not in ('string', 'null')
    )
  then
    raise exception 'operations_class_schedule_filters_invalid' using errcode = '22023';
  end if;
  if p_limit is null or not (p_limit = 30) then
    raise exception 'operations_class_schedule_limit_invalid' using errcode = '22023';
  end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then
    raise exception 'operations_class_schedule_cursor_invalid' using errcode = '22023';
  end if;

  with filtered as (
    select
      class.id,
      class.name,
      class.subject,
      class.grade,
      class.schedule,
      class.term_id,
      pg_catalog.nullif(pg_catalog.btrim(class.teacher), '') as teacher_name,
      term.name as term_name,
      (
        select member.group_id
        from public.class_schedule_sync_group_members as member
        where member.class_id = class.id
        order by (member.group_id::text = p_filters ->> 'syncGroupId') desc, member.sort_order asc, member.group_id asc
        limit 1
      ) as sync_group_id,
      (
        select sync_group.name
        from public.class_schedule_sync_group_members as member
        join public.class_schedule_sync_groups as sync_group on sync_group.id = member.group_id
        where member.class_id = class.id
        order by (member.group_id::text = p_filters ->> 'syncGroupId') desc, member.sort_order asc, member.group_id asc
        limit 1
      ) as sync_group_name,
      class.status,
      class.updated_at,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(class.name), ''), '') collate dashboard_private.ko_numeric as sort_key
    from public.classes as class
    left join public.class_terms as term on term.id = class.term_id
    where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, term.name) ilike '%' || p_filters ->> 'search' || '%')
      and ((p_filters ->> 'termId') is null or class.term_id::text = p_filters ->> 'termId')
      and ((p_filters ->> 'subject') is null or class.subject = p_filters ->> 'subject')
      and ((p_filters ->> 'grade') is null or class.grade = p_filters ->> 'grade')
      and ((p_filters ->> 'teacher') is null or exists (
        select 1
        from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value)
        where pg_catalog.btrim(teacher_name.value) = p_filters ->> 'teacher'
      ))
      and ((p_filters ->> 'syncGroupId') is null or exists (
        select 1 from public.class_schedule_sync_group_members as member
        where member.class_id = class.id and member.group_id::text = p_filters ->> 'syncGroupId'
      ))
  ), page as (
    select filtered.*
    from filtered
    where p_cursor_sort_key is null
      or filtered.sort_key > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.sort_key = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.sort_key asc, filtered.id asc
    limit p_limit + 1
  )
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', page.id,
    'sort_key', page.sort_key::text,
    'row_data', pg_catalog.jsonb_build_object(
      'id', page.id,
      'name', pg_catalog.coalesce(page.name, ''),
      'subject', pg_catalog.coalesce(page.subject, ''),
      'grade', pg_catalog.coalesce(page.grade, ''),
      'schedule', pg_catalog.coalesce(page.schedule, ''),
      'termId', page.term_id,
      'teacherName', page.teacher_name,
      'termName', page.term_name,
      'syncGroupId', page.sync_group_id,
      'syncGroupName', page.sync_group_name,
      'status', pg_catalog.coalesce(page.status, ''),
      'updatedAt', page.updated_at
    )
  ) order by page.sort_key asc, page.id asc), '[]'::jsonb)
  into v_rows
  from page;

  with filtered as (
    select class.status
    from public.classes as class
    left join public.class_terms as term on term.id = class.term_id
    where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, term.name) ilike '%' || p_filters ->> 'search' || '%')
      and ((p_filters ->> 'termId') is null or class.term_id::text = p_filters ->> 'termId')
      and ((p_filters ->> 'subject') is null or class.subject = p_filters ->> 'subject')
      and ((p_filters ->> 'grade') is null or class.grade = p_filters ->> 'grade')
      and ((p_filters ->> 'teacher') is null or exists (
        select 1
        from pg_catalog.regexp_split_to_table(pg_catalog.coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value)
        where pg_catalog.btrim(teacher_name.value) = p_filters ->> 'teacher'
      ))
      and ((p_filters ->> 'syncGroupId') is null or exists (
        select 1 from public.class_schedule_sync_group_members as member
        where member.class_id = class.id and member.group_id::text = p_filters ->> 'syncGroupId'
      ))
  )
  select pg_catalog.jsonb_build_object(
    'total', pg_catalog.count(*),
    'active', pg_catalog.count(*) filter (where filtered.status in ('수강', '수업 진행 중')),
    'draft', pg_catalog.count(*) filter (where filtered.status in ('개강 예정', '개강 준비 중'))
  ) into v_stats
  from filtered;

  select pg_catalog.jsonb_build_object(
    'terms', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', term.id, 'label', term.name) order by term.academic_year desc, term.sort_order asc, term.id asc), '[]'::jsonb) from (select * from public.class_terms order by academic_year desc, sort_order asc, id asc limit 200) as term),
    'subjects', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric), '[]'::jsonb) from (select distinct class.subject as value from public.classes as class where pg_catalog.nullif(pg_catalog.btrim(class.subject), '') is not null order by value collate dashboard_private.ko_numeric limit 200) as option),
    'grades', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric), '[]'::jsonb) from (select distinct class.grade as value from public.classes as class where pg_catalog.nullif(pg_catalog.btrim(class.grade), '') is not null order by value collate dashboard_private.ko_numeric limit 200) as option),
    'teachers', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric), '[]'::jsonb) from (select distinct pg_catalog.btrim(teacher_name.value) as value from public.classes as class cross join lateral pg_catalog.regexp_split_to_table(pg_catalog.coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value) where pg_catalog.nullif(pg_catalog.btrim(teacher_name.value), '') is not null order by value collate dashboard_private.ko_numeric limit 200) as option),
    'syncGroups', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', sync_group.id, 'label', sync_group.name) order by sync_group.sort_order asc, sync_group.name collate dashboard_private.ko_numeric asc, sync_group.id asc), '[]'::jsonb) from (select * from public.class_schedule_sync_groups order by sort_order asc, name collate dashboard_private.ko_numeric asc, id asc limit 200) as sync_group)
  ) into v_options;

  return pg_catalog.jsonb_build_object('rows', v_rows, 'stats', v_stats, 'filterOptions', v_options);
end
$function$;

create function public.get_academic_event_detail_v1(p_event_id uuid)
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
    'startsAt', event.start,
    'endsAt', pg_catalog.coalesce(event.end, event.start),
    'timeLabel', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.school), ''), school.name, '학교 미지정'),
    'durationLabel', case when pg_catalog.coalesce(event.end, event.start) = event.start then '하루 일정' else event.start::text || ' ~ ' || pg_catalog.coalesce(event.end, event.start)::text end,
    'eventType', case when event.type = '체험학습' then 'event' when event.type = '방학·휴일·기타' then 'reminder' when event.type = '팁스' then 'meeting' when event.type in ('시험기간','영어시험일','수학시험일','과학시험일') then 'task' else 'personal' end,
    'typeLabel', event.type,
    'attendees', case when pg_catalog.nullif(pg_catalog.btrim(event.grade), '') is null or event.grade = 'all' then '[]'::jsonb else pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(event.grade, '\\s*,\\s*')) end,
    'subject', null,
    'place', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.school), ''), school.name),
    'color', case when event.type in ('시험기간','영어시험일','수학시험일','과학시험일') then 'bg-rose-500' when event.type = '체험학습' then 'bg-emerald-500' when event.type = '방학·휴일·기타' then 'bg-amber-500' when event.type = '팁스' then 'bg-blue-500' else 'bg-violet-500' end,
    'description', pg_catalog.nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(event.note, ''), '[[TIPS_META]]', 1)), ''),
    'schoolId', event.school_id,
    'schoolName', pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(event.school), ''), school.name),
    'category', school.category,
    'grade', event.grade,
    'examTerm', null,
    'scopeSummary', null,
    'scienceAreaKey', null,
    'scienceAreaLabel', null,
    'notePreview', pg_catalog.nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(event.note, ''), '[[TIPS_META]]', 1)), 160), ''),
    'status', 'active',
    'revision', 0,
    'storedNote', event.note,
    'note', pg_catalog.nullif(pg_catalog.btrim(pg_catalog.split_part(pg_catalog.coalesce(event.note, ''), '[[TIPS_META]]', 1)), ''),
    'embeddedNoteMeta', null,
    'textbookScopes', '[]'::jsonb,
    'subtextbookScopes', '[]'::jsonb,
    'materialSections', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'label', pg_catalog.coalesce(detail.subject, '시험범위'),
        'items', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
          pg_catalog.nullif(pg_catalog.btrim(detail.textbook_scope), ''),
          pg_catalog.nullif(pg_catalog.btrim(detail.supplement_scope), ''),
          pg_catalog.nullif(pg_catalog.btrim(detail.other_scope), '')
        ], null))
      ) order by detail.sort_order asc, detail.id asc)
      from public.academic_event_exam_details as detail
      where detail.academic_event_id = event.id
    ), '[]'::jsonb)
  )
  from public.academic_events as event
  left join public.academic_schools as school on school.id = event.school_id
  where event.id = p_event_id
$function$;

create function public.get_operations_class_lesson_design_detail_v1(p_class_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'classItem', pg_catalog.jsonb_build_object(
      'id', class.id,
      'name', class.name,
      'className', class.name,
      'classType', class.class_type,
      'subject', class.subject,
      'grade', class.grade,
      'teacher', class.teacher,
      'schedule', class.schedule,
      'room', class.room,
      'status', class.status,
      'termId', class.term_id,
      'termName', term.name,
      'startDate', class.start_date,
      'endDate', class.end_date,
      'textbookIds', pg_catalog.coalesce(class.textbook_ids, '[]'::jsonb),
      'schedulePlan', pg_catalog.coalesce(class.schedule_plan, '{}'::jsonb),
      'scheduleStorageMode', class.schedule_storage_mode,
      'scheduleRevision', class.schedule_revision
    ),
    'textbooks', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', textbook.id,
        'title', textbook.title,
        'name', textbook.name,
        'subject', textbook.subject,
        'publisher', textbook.publisher,
        'category', textbook.category,
        'subSubject', textbook.sub_subject,
        'status', textbook.status
      ) order by pg_catalog.coalesce(textbook.title, textbook.name) collate dashboard_private.ko_numeric, textbook.id), '[]'::jsonb)
      from public.textbooks as textbook
      where pg_catalog.coalesce(class.textbook_ids, '[]'::jsonb) ? textbook.id::text
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(class.schedule_plan -> 'textbooks') = 'array' then class.schedule_plan -> 'textbooks' else '[]'::jsonb end) as plan_textbook(value)
          where pg_catalog.coalesce(plan_textbook.value ->> 'textbookId', plan_textbook.value ->> 'textbook_id', plan_textbook.value ->> 'id') = textbook.id::text
        )
    ),
    'teacherCatalogs', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order
        from public.teacher_catalogs as teacher
        where teacher.is_visible and (teacher.subjects = '{}'::text[] or class.subject = any(teacher.subjects))
        order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id
        limit 200
      ) as catalog
    ),
    'classroomCatalogs', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible
      ) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb)
      from (
        select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order
        from public.classroom_catalogs as classroom
        where classroom.is_visible and (classroom.subjects = '{}'::text[] or class.subject = any(classroom.subjects))
        order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id
        limit 200
      ) as catalog
    )
  )
  from public.classes as class
  left join public.class_terms as term on term.id = class.term_id
  where class.id = p_class_id
$function$;

create function public.get_operations_lesson_textbook_candidate_page_v1(
  p_class_id uuid,
  p_search text,
  p_cursor_title text,
  p_cursor_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_search text := pg_catalog.left(pg_catalog.btrim(pg_catalog.coalesce(p_search, '')), 100);
  v_rows jsonb;
  v_has_more boolean;
begin
  if p_class_id is null or p_limit <> 30 then
    raise exception 'operations_textbook_candidate_request_invalid' using errcode = '22023';
  end if;
  if (p_cursor_title is null) <> (p_cursor_id is null) then
    raise exception 'operations_textbook_candidate_cursor_invalid' using errcode = '22023';
  end if;

  with class_context as (
    select class.subject
    from public.classes as class
    where class.id = p_class_id
  ), matching as (
    select
      textbook.id,
      pg_catalog.coalesce(pg_catalog.nullif(pg_catalog.btrim(textbook.title), ''), pg_catalog.nullif(pg_catalog.btrim(textbook.name), ''), '교재') as sort_title,
      pg_catalog.jsonb_build_object(
        'id', textbook.id,
        'title', textbook.title,
        'name', textbook.name,
        'subject', textbook.subject,
        'publisher', textbook.publisher,
        'category', textbook.category,
        'subSubject', textbook.sub_subject,
        'status', textbook.status
      ) as row_data
    from public.textbooks as textbook
    join class_context on class_context.subject = textbook.subject
    where (
      v_search = ''
      or pg_catalog.coalesce(textbook.title, textbook.name, '') ilike '%' || v_search || '%'
      or pg_catalog.coalesce(textbook.publisher, '') ilike '%' || v_search || '%'
    )
  ), bounded as (
    select matching.*
    from matching
    where p_cursor_title is null
      or (matching.sort_title collate dashboard_private.ko_numeric, matching.id)
        > (p_cursor_title collate dashboard_private.ko_numeric, p_cursor_id)
    order by matching.sort_title collate dashboard_private.ko_numeric, matching.id
    limit 31
  ), visible as (
    select bounded.*
    from bounded
    order by bounded.sort_title collate dashboard_private.ko_numeric, bounded.id
    limit 30
  )
  select
    pg_catalog.coalesce(pg_catalog.jsonb_agg(
      visible.row_data || pg_catalog.jsonb_build_object('sortTitle', visible.sort_title)
      order by visible.sort_title collate dashboard_private.ko_numeric, visible.id
    ), '[]'::jsonb),
    (select pg_catalog.count(*) > 30 from bounded)
  into v_rows, v_has_more
  from visible;

  return pg_catalog.jsonb_build_object('rows', v_rows, 'hasMore', pg_catalog.coalesce(v_has_more, false));
end
$function$;

create function public.list_operations_catalogs_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'academicSchools', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'category', catalog.category) order by catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select school.id, school.name, school.category from public.academic_schools as school where pg_catalog.nullif(pg_catalog.btrim(school.name), '') is not null order by school.name collate dashboard_private.ko_numeric, school.id limit 200) as catalog),
    'teachers', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select teacher.id, teacher.name, teacher.subjects, teacher.is_visible, teacher.sort_order from public.teacher_catalogs as teacher where teacher.is_visible order by teacher.sort_order, teacher.name collate dashboard_private.ko_numeric, teacher.id limit 200) as catalog),
    'classrooms', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', catalog.id, 'name', catalog.name, 'subjects', catalog.subjects, 'isVisible', catalog.is_visible) order by catalog.sort_order, catalog.name collate dashboard_private.ko_numeric, catalog.id), '[]'::jsonb) from (select classroom.id, classroom.name, classroom.subjects, classroom.is_visible, classroom.sort_order from public.classroom_catalogs as classroom where classroom.is_visible order by classroom.sort_order, classroom.name collate dashboard_private.ko_numeric, classroom.id limit 200) as catalog),
    'subjects', (select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric), '[]'::jsonb) from (select distinct class.subject as value from public.classes as class where pg_catalog.nullif(pg_catalog.btrim(class.subject), '') is not null order by value collate dashboard_private.ko_numeric limit 200) as subject)
  )
$function$;

revoke all on function public.get_operations_calendar_range_v1(date, date) from public, anon, authenticated;
revoke all on function public.get_operations_annual_board_v1(integer) from public, anon, authenticated;
revoke all on function public.get_operations_class_schedule_page_v1(jsonb, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_academic_event_detail_v1(uuid) from public, anon, authenticated;
revoke all on function public.get_operations_class_lesson_design_detail_v1(uuid) from public, anon, authenticated;
revoke all on function public.get_operations_lesson_textbook_candidate_page_v1(uuid, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.list_operations_catalogs_v1() from public, anon, authenticated;
revoke all on function dashboard_private.extract_academic_event_meta_v1(text) from public, anon, authenticated;
revoke all on function dashboard_private.normalize_academic_exam_period_key_v1(text) from public, anon, authenticated;

grant execute on function public.get_operations_calendar_range_v1(date, date) to authenticated;
grant execute on function public.get_operations_annual_board_v1(integer) to authenticated;
grant execute on function public.get_operations_class_schedule_page_v1(jsonb, text, uuid, integer) to authenticated;
grant execute on function public.get_academic_event_detail_v1(uuid) to authenticated;
grant execute on function public.get_operations_class_lesson_design_detail_v1(uuid) to authenticated;
grant execute on function public.get_operations_lesson_textbook_candidate_page_v1(uuid, text, text, uuid, integer) to authenticated;
grant execute on function public.list_operations_catalogs_v1() to authenticated;
grant execute on function dashboard_private.extract_academic_event_meta_v1(text) to authenticated;
grant execute on function dashboard_private.normalize_academic_exam_period_key_v1(text) to authenticated;
