begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Additive numbered siblings. Existing cursor/detail APIs and RLS stay unchanged.
create function public.get_academic_curriculum_numbered_page_v1(
  p_filters jsonb,
  p_page integer,
  p_page_size integer,
  p_include_scope_metadata boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_filters jsonb;
  v_keys text[];
  v_result jsonb;
  v_default_period_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  -- Shape validation must precede jsonb expansion, and bigint math precedes OFFSET.
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['classroom','grade','periodId','search','status','subject','teacher','viewMode']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) or p_include_scope_metadata is null then
    raise exception 'academic_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case
    when key = 'search' then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    when key = 'viewMode' then pg_catalog.to_jsonb(coalesce(nullif(pg_catalog.btrim(value #>> '{}'),''),'all'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if v_filters ->> 'viewMode' not in ('all','unscheduled','unlinked','update','done')
    or ((v_filters ->> 'status') is not null and v_filters ->> 'status' not in ('수강','개강 준비','종강')) then
    raise exception 'academic_numbered_filters_invalid' using errcode = '22023';
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
      class.end_date, class.term_id, class.period,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), term.name, '') as term_name,
      pg_catalog.jsonb_array_length(coalesce(class.textbook_ids, '[]'::jsonb))::integer as textbook_count,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), U&'\FFFF') collate dashboard_private.ko_numeric as sort_key
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
        or dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) = pg_catalog.btrim(v_filters ->> 'status'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'subject'), '') is null or pg_catalog.btrim(class.subject) = pg_catalog.btrim(v_filters ->> 'subject'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'grade'), '') is null or pg_catalog.btrim(class.grade) = pg_catalog.btrim(v_filters ->> 'grade'))
      and (nullif(pg_catalog.btrim(v_filters ->> 'teacher'), '') is null or coalesce(class.teacher, '') ilike '%' || pg_catalog.btrim(v_filters ->> 'teacher') || '%')
      and (
        nullif(pg_catalog.btrim(v_filters ->> 'classroom'), '') is null
        or exists (
          select 1
          from pg_catalog.regexp_split_to_table(coalesce(class.room, ''), '[,/&·]+') token
          where dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token))
            = dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(v_filters ->> 'classroom'))
        )
      )
      and (nullif(pg_catalog.btrim(v_filters ->> 'search'), '') is null or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, class.room, class.schedule) ilike '%' || pg_catalog.btrim(v_filters ->> 'search') || '%')
  ), progress_agg as materialized (
    select log.class_id,
      pg_catalog.count(distinct coalesce(nullif(log.session_id, ''), nullif(log.progress_key, ''), log.id::text))
        filter (where coalesce(log.status, '') in ('partial','done'))::integer as planned_count
    from public.progress_logs log
    join eligible_classes eligible on eligible.id = log.class_id
    group by log.class_id
  ), session_agg as materialized (
    select session.class_id,
      pg_catalog.count(*) filter (where session.schedule_state <> 'skipped')::integer as session_count
    from public.class_lesson_sessions session
    join eligible_classes eligible on eligible.id = session.class_id
    group by session.class_id
  ), base as materialized (
    select
      eligible.id, eligible.name, eligible.subject, eligible.subject_area_key,
      eligible.grade, eligible.teacher, eligible.room, eligible.schedule,
      eligible.status, eligible.start_date, eligible.end_date, eligible.term_id,
      eligible.period, eligible.normalized_status,
      eligible.term_name, eligible.textbook_count,
      coalesce(session_agg.session_count, 0)::integer as session_count,
      coalesce(progress_agg.planned_count, 0)::integer as planned_count,
      eligible.sort_key
    from eligible_classes eligible
    left join progress_agg on progress_agg.class_id = eligible.id
    left join session_agg on session_agg.class_id = eligible.id
  ), classified as materialized (
    select
      base.id, base.name, base.subject, base.subject_area_key, base.grade,
      base.teacher, base.room, base.schedule, base.status, base.start_date,
      base.end_date, base.term_id, base.period,
      base.normalized_status, base.term_name, base.textbook_count,
      base.session_count, base.planned_count,
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
      classified.period, classified.normalized_status,
      classified.term_name, classified.textbook_count, classified.session_count,
      classified.planned_count,
      classified.sort_key, classified.state_label, classified.view_mode
    from classified
    where coalesce(nullif(pg_catalog.btrim(v_filters ->> 'viewMode'), ''), 'all') = 'all'
       or view_mode = pg_catalog.btrim(v_filters ->> 'viewMode')
  ), page_keys as materialized (
    select id, sort_key from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
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
    join page_keys selected on selected.id = session.class_id
    where session.schedule_state <> 'skipped'
      and not exists (
        select 1
        from public.progress_logs log
        where log.class_id = session.class_id
          and (
            log.session_id in (session.id::text, session.session_key)
            or log.progress_key in (session.id::text, session.session_key)
          )
          and coalesce(log.status, '') in ('partial','done')
      )
    order by session.class_id, session.session_date, session.start_time nulls last, session.id

  ), page_candidates as materialized (
    select filtered.*, next_unplanned.next_session_id, next_unplanned.next_session_key,
      next_unplanned.next_session_date, next_unplanned.next_start_time,
      next_unplanned.next_end_time, next_unplanned.next_schedule_state,
      (select pg_catalog.max(log.updated_at) from public.progress_logs log where log.class_id = filtered.id) as last_updated_at
    from page_keys selected
    join filtered on filtered.id = selected.id
    left join next_unplanned on next_unplanned.class_id = selected.id
  ), page_rows as materialized (
    select
      id,
      sort_key::text as sort_key,
      pg_catalog.jsonb_build_object(
        'id', id,
        'title', pg_catalog.regexp_replace(coalesce(name, ''), '^\[[^]]+\]\s*', ''),
        'fullTitle', coalesce(name, ''),
        'subject', coalesce(subject, ''),
        'subjectAreaKey', coalesce(subject_area_key, ''),
        'grade', coalesce(grade, ''),
        'term', term_name,
        'teacherNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(teacher, ''), '\s*[,/&·]\s*')),
        'teacherSummary', coalesce(teacher, ''),
        'classroomNames', pg_catalog.to_jsonb(pg_catalog.regexp_split_to_array(coalesce(room, ''), '\s*[,/&·]\s*')),
        'classroomSummary', coalesce(room, ''),
        'schedule', coalesce(schedule, ''),
        'status', normalized_status,
        'statusFilter', normalized_status,
        'classGroupIds', coalesce((select pg_catalog.jsonb_agg(member.group_id::text order by member.sort_order, member.group_id) from public.class_schedule_sync_group_members member where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupNames', coalesce((select pg_catalog.jsonb_agg(group_row.name order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '[]'::jsonb),
        'classGroupLabel', coalesce((select pg_catalog.string_agg(group_row.name, ', ' order by member.sort_order, group_row.name) from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id = member.group_id where member.class_id = page_candidates.id), '미분류'),
        'textbookCount', textbook_count,
        'textbookCatalog', '[]'::jsonb,
        'textbookTitles', '[]'::jsonb,
        'textbookSummary', case when textbook_count > 0 then textbook_count::text || '권 연결' else '교재 미연결' end,
        'textbookOverflowCount', 0,
        'textbookScopeLabels', '[]'::jsonb,
        'totalSessions', session_count,
        'completedSessions', planned_count,
        'updatedSessions', planned_count,
        'delayedSessions', greatest(session_count - planned_count, 0),
        'plannedSessions', planned_count,
        'progressTargetSessions', case when textbook_count > 0 then session_count else 0 end,
        'delayedProgressSessions', case when textbook_count > 0 then greatest(session_count - planned_count, 0) else 0 end,
        'plannedProgressSessions', planned_count,
        'progressPercent', case when session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'progressTargetPercent', case when textbook_count > 0 and session_count > 0 then pg_catalog.round(planned_count::numeric * 100 / session_count)::integer else 0 end,
        'lastUpdatedAt', coalesce(last_updated_at::text, ''),
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
      'totalSessions', coalesce(pg_catalog.sum(session_count),0)::integer,
      'completedSessions', coalesce(pg_catalog.sum(planned_count),0)::integer,
      'pendingSessions', coalesce(pg_catalog.sum(greatest(session_count-planned_count,0)),0)::integer,
      'linkedTextbooks', coalesce(pg_catalog.sum(textbook_count),0)::integer,
      'unlinkedClassCount', pg_catalog.count(*) filter (where textbook_count=0)::integer,
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
      'periods', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value',id,'label',name,'isDefault',is_default) order by sort_order,name) from (select id,name,is_default,sort_order from public.class_schedule_sync_groups order by sort_order,name limit 500) bounded), '[]'::jsonb),
      'statuses', pg_catalog.to_jsonb(array['수강','개강 준비','종강']),
      'subjects', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct subject as value from base where nullif(pg_catalog.btrim(subject),'') is not null order by subject limit 500) bounded), '[]'::jsonb),
      'grades', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct grade as value from base where nullif(pg_catalog.btrim(grade),'') is not null order by grade limit 500) bounded), '[]'::jsonb),
      'teachers', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct pg_catalog.btrim(token) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(teacher,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb),
      'classrooms', coalesce((select pg_catalog.jsonb_agg(value order by value) from (select distinct dashboard_private.academic_classroom_name_v1(pg_catalog.btrim(token)) as value from base cross join lateral pg_catalog.regexp_split_to_table(coalesce(room,''), '[,/&·]+') token where pg_catalog.btrim(token)<>'' order by value limit 500) bounded), '[]'::jsonb)
    ) as data
    where p_include_scope_metadata
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows), '[]'::jsonb),
    'page', p_page, 'pageSize', p_page_size,
    'totalCount', (select pg_catalog.count(*) from filtered),
    'stats', case when p_include_scope_metadata then (select data from stats) else null end,
    'filterOptions', case when p_include_scope_metadata then (select data from filter_options) else null end,
    'resolvedPeriodId', v_filters ->> 'periodId'
  ) into v_result;

  return v_result;
end;
$$;

create function public.get_operations_class_schedule_numbered_page_v1(
  p_filters jsonb, p_page integer, p_page_size integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_keys text[];
  v_filters jsonb;
  v_rows jsonb;
  v_stats jsonb;
  v_options jsonb;
  v_group_counts jsonb;
begin
  if p_filters is null or pg_catalog.jsonb_typeof(p_filters) <> 'object' then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) key;
  if v_keys is distinct from array['grade','search','subject','syncGroupId','teacher','termId']
    or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string'
    or exists (select 1 from pg_catalog.jsonb_each(p_filters) field where pg_catalog.jsonb_typeof(field.value) not in ('string','null'))
  then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'operations_numbered_request_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(key, case when key = 'search'
    then pg_catalog.to_jsonb(pg_catalog.btrim(value #>> '{}'))
    else coalesce(pg_catalog.to_jsonb(nullif(pg_catalog.btrim(value #>> '{}'),'')),'null'::jsonb)
  end) into v_filters from pg_catalog.jsonb_each(p_filters) field;
  if exists (select 1 from pg_catalog.jsonb_each_text(v_filters) field
    where key in ('termId','syncGroupId') and value is not null
      and value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'operations_numbered_filters_invalid' using errcode = '22023';
  end if;

  with filtered as materialized (
    select class.id, class.status,
      coalesce(nullif(pg_catalog.btrim(class.name), ''), '') collate dashboard_private.ko_numeric as sort_key,
      (select member.group_id
        from public.class_schedule_sync_group_members member
        where member.class_id = class.id
        order by (member.group_id::text = v_filters ->> 'syncGroupId') desc, member.sort_order asc, member.group_id asc
        limit 1) as sync_group_id
    from public.classes class
    left join public.class_terms term on term.id = class.term_id
    where (v_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', class.name, class.subject, class.grade, class.teacher, term.name) ilike '%' || (v_filters ->> 'search') || '%')
      and ((v_filters ->> 'termId') is null or class.term_id::text = v_filters ->> 'termId')
      and ((v_filters ->> 'subject') is null or class.subject = v_filters ->> 'subject')
      and ((v_filters ->> 'grade') is null or class.grade = v_filters ->> 'grade')
      and ((v_filters ->> 'teacher') is null or exists (
        select 1
        from pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value)
        where pg_catalog.btrim(teacher_name.value) = v_filters ->> 'teacher'
      ))
      and ((v_filters ->> 'syncGroupId') is null or exists (
        select 1 from public.class_schedule_sync_group_members as member
        where member.class_id = class.id and member.group_id::text = v_filters ->> 'syncGroupId'
      ))
  ), page_keys as materialized (
    select id, sort_key, sync_group_id from filtered
    order by sort_key, id
    offset ((p_page::bigint - 1) * p_page_size::bigint) limit p_page_size
  ), page_rows as (
    select selected.id, selected.sort_key,
      pg_catalog.jsonb_build_object(
        'id', class.id, 'name', coalesce(class.name,''),
        'subject', coalesce(class.subject,''), 'grade', coalesce(class.grade,''),
        'schedule', coalesce(class.schedule,''), 'termId', class.term_id,
        'teacherName', nullif(pg_catalog.btrim(class.teacher),''),
        'termName', term.name, 'syncGroupId', selected.sync_group_id,
        'syncGroupName', group_row.name, 'status', coalesce(class.status,''),
        'updatedAt', class.created_at
      ) as row_data
    from page_keys selected
    join public.classes class on class.id = selected.id
    left join public.class_terms term on term.id = class.term_id
    left join public.class_schedule_sync_groups group_row on group_row.id = selected.sync_group_id
  ), catalog_groups as materialized (
    select id, sort_order, name from public.class_schedule_sync_groups
    order by sort_order, name collate dashboard_private.ko_numeric, id limit 200
  ), group_counts as (
    select sync_group_id, pg_catalog.count(*) as member_count from filtered
    where sync_group_id is not null group by sync_group_id
  ), representatives as (
    select distinct on (sync_group_id) sync_group_id, id from filtered
    where sync_group_id is not null order by sync_group_id, sort_key, id
  )
  select
    coalesce((select pg_catalog.jsonb_agg(row_data order by sort_key,id) from page_rows),'[]'::jsonb),
    (select pg_catalog.jsonb_build_object(
      'total',pg_catalog.count(*),
      'active',pg_catalog.count(*) filter(where status in ('수강','수업 진행 중')),
      'draft',pg_catalog.count(*) filter(where status in ('개강 예정','개강 준비 중'))
    ) from filtered),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'groupId', catalog.id, 'memberCount', counts.member_count, 'representativeClassId', representative.id
    ) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id)
      from catalog_groups catalog
      join group_counts counts on counts.sync_group_id = catalog.id
      join representatives representative on representative.sync_group_id = catalog.id),'[]'::jsonb)
  into v_rows, v_stats, v_group_counts;

  select pg_catalog.jsonb_build_object(
    'terms', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', term.id, 'label', term.name) order by term.academic_year desc, term.sort_order asc, term.id asc), '[]'::jsonb) from (select * from public.class_terms order by academic_year desc, sort_order asc, id asc limit 200) as term),
    'subjects', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.subject as value, class.subject collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.subject), '') is not null order by sort_value limit 200) as option),
    'grades', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct class.grade as value, class.grade collate dashboard_private.ko_numeric as sort_value from public.classes as class where nullif(pg_catalog.btrim(class.grade), '') is not null order by sort_value limit 200) as option),
    'teachers', (select coalesce(pg_catalog.jsonb_agg(option.value order by option.sort_value), '[]'::jsonb) from (select distinct pg_catalog.btrim(teacher_name.value) as value, pg_catalog.btrim(teacher_name.value) collate dashboard_private.ko_numeric as sort_value from public.classes as class cross join lateral pg_catalog.regexp_split_to_table(coalesce(class.teacher, ''), E'[,/&·\\n]+') as teacher_name(value) where nullif(pg_catalog.btrim(teacher_name.value), '') is not null order by sort_value limit 200) as option),
    'syncGroups', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('value', sync_group.id, 'label', sync_group.name) order by sync_group.sort_order asc, sync_group.name collate dashboard_private.ko_numeric asc, sync_group.id asc), '[]'::jsonb) from (select * from public.class_schedule_sync_groups order by sort_order asc, name collate dashboard_private.ko_numeric asc, id asc limit 200) as sync_group)
  ) into v_options;

  return pg_catalog.jsonb_build_object(
    'rows',v_rows,'page',p_page,'pageSize',p_page_size,'totalCount',v_stats -> 'total',
    'stats',v_stats,'filterOptions',v_options,'syncGroupCounts',v_group_counts
  );
end
$function$;

revoke all on function public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean) from public, anon, authenticated;
revoke all on function public.get_operations_class_schedule_numbered_page_v1(jsonb,integer,integer) from public, anon, authenticated;
grant execute on function public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean) to authenticated;
grant execute on function public.get_operations_class_schedule_numbered_page_v1(jsonb,integer,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
