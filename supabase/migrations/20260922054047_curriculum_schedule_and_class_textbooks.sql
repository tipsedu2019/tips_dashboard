begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.classes add column textbook_usage jsonb not null default '{}'::jsonb;

create function dashboard_private.class_textbook_usage_valid_v1(p_usage jsonb, p_ids jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item record; start_date date; end_date date;
begin
  if jsonb_typeof(p_usage) is distinct from 'object' then return false; end if;
  for item in select * from jsonb_each(p_usage) loop
    if not coalesce(p_ids,'[]'::jsonb) ? item.key
      or jsonb_typeof(item.value) is distinct from 'object'
      or item.value - array['startDate','endDate','title'] <> '{}'::jsonb
      or exists(select 1 from jsonb_each(item.value) f where jsonb_typeof(f.value) not in ('string','null'))
    then return false; end if;
    start_date := nullif(item.value->>'startDate','')::date;
    end_date := nullif(item.value->>'endDate','')::date;
    if (start_date is not null and (item.value->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' or to_char(start_date,'YYYY-MM-DD')<>item.value->>'startDate'))
      or (end_date is not null and (item.value->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' or to_char(end_date,'YYYY-MM-DD')<>item.value->>'endDate'))
      or (start_date is not null and end_date is not null and start_date>end_date)
    then return false; end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function dashboard_private.class_textbook_usage_valid_v1(jsonb,jsonb) from public, anon;
grant execute on function dashboard_private.class_textbook_usage_valid_v1(jsonb,jsonb) to authenticated;

-- One-time reconciliation: keep all existing IDs and historical plan links,
-- including titles of books removed from the catalog. Never infer missing dates.
with plan_books as materialized (
  select c.id as class_id,e.item,e.ordinality,
    coalesce(e.item->>'textbookId',e.item->>'textbook_id',e.item->>'id') as book_id
  from public.classes c cross join lateral jsonb_array_elements(
    case when jsonb_typeof(c.schedule_plan->'textbooks')='array' then c.schedule_plan->'textbooks' else '[]'::jsonb end
  ) with ordinality e(item,ordinality)
), merged as (
  select c.id,
    (select coalesce(jsonb_agg(book_id order by first_order,book_id),'[]'::jsonb)
      from (select book_id,min(sort_order) as first_order from (
        select value #>> '{}' as book_id,ordinality as sort_order
          from jsonb_array_elements(coalesce(c.textbook_ids,'[]'::jsonb)) with ordinality
        union all select b.book_id,10000+b.ordinality from plan_books b where b.class_id=c.id and nullif(b.book_id,'') is not null
      ) all_books group by book_id) unique_books) as ids,
    (select coalesce(jsonb_object_agg(book_id,usage),'{}'::jsonb) from (
      select distinct on (b.book_id) b.book_id,
        jsonb_build_object('title',coalesce(b.item->>'alias',''),
          'startDate',(select nullif(s->>'date','') from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]'::jsonb)) s where coalesce(s->>'id',s->>'sessionKey')=nullif(b.item->>'startSessionId','') limit 1),
          'endDate',(select nullif(s->>'date','') from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]'::jsonb)) s where coalesce(s->>'id',s->>'sessionKey')=nullif(b.item->>'endSessionId','') limit 1)) as usage
      from plan_books b where b.class_id=c.id and nullif(b.book_id,'') is not null order by b.book_id,b.ordinality
    ) ranges) as usage
  from public.classes c
)
update public.classes c set textbook_ids=m.ids,textbook_usage=m.usage from merged m
where c.id=m.id and (c.textbook_ids is distinct from m.ids or c.textbook_usage is distinct from m.usage);

-- An old client may only change IDs. Remove the corresponding retired usage
-- entries in the same row update so dates cannot become orphaned.
create function dashboard_private.prune_class_textbook_usage_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(new.textbook_usage)='object' then
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into new.textbook_usage
    from jsonb_each(new.textbook_usage) where coalesce(new.textbook_ids,'[]'::jsonb) ? key;
  end if;
  return new;
end;
$$;
revoke all on function dashboard_private.prune_class_textbook_usage_v1() from public,anon,authenticated;
create trigger class_textbook_usage_prune before insert or update of textbook_ids,textbook_usage on public.classes
for each row execute function dashboard_private.prune_class_textbook_usage_v1();
alter table public.classes add constraint classes_textbook_usage_valid
check (dashboard_private.class_textbook_usage_valid_v1(textbook_usage,textbook_ids)) not valid;
alter table public.classes validate constraint classes_textbook_usage_valid;

-- Patch the final active reader; retain its student status, ACL and all other branches.
do $$
declare definition text; old_text text := $old$'textbookIds',coalesce(v_raw -> 'textbook_ids','[]'::jsonb),'updatedAt'$old$;
begin
  definition := pg_get_functiondef('public.get_management_detail_v1(text,uuid)'::regprocedure);
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then
    raise exception 'class_textbook_detail_patch_target_missing' using errcode='55000';
  end if;
  execute replace(definition,old_text,$new$'textbookIds',coalesce(v_raw -> 'textbook_ids','[]'::jsonb),'textbookUsage',coalesce(v_raw -> 'textbook_usage','{}'::jsonb),'updatedAt'$new$);
end;
$$;

create or replace function public.get_academic_curriculum_numbered_page_v1(
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
  if v_filters->>'viewMode'='unlinked' then v_filters:=jsonb_set(v_filters,'{viewMode}','"all"'); end if;
  with eligible_classes as materialized (
    select
      class.id, class.name, class.subject, class.subject_area_key, class.grade,
      class.teacher, class.room, class.schedule, class.status, class.start_date,
      class.end_date, class.term_id, class.period, class.schedule_storage_mode, class.schedule_plan,
      dashboard_private.academic_class_status_v1(class.status, nullif(pg_catalog.btrim(class.start_date), '')::date, nullif(pg_catalog.btrim(class.end_date), '')::date) as normalized_status,
      coalesce(nullif(pg_catalog.btrim(class.period), ''), term.name, '') as term_name,
      0::integer as textbook_count,
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
  ), schedule_sessions as materialized (
    select session.class_id, session.id::text as id, session.session_key, session.session_date,
      session.start_time::text as start_time, session.end_time::text as end_time,
      session.schedule_state, session.updated_at::text as updated_at
    from public.class_lesson_sessions session
    join eligible_classes eligible on eligible.id=session.class_id
    where eligible.schedule_storage_mode='normalized' and session.schedule_state <> 'skipped'
    union all
    select eligible.id, coalesce(nullif(item->>'id',''),nullif(item->>'sessionKey',''),eligible.id::text || ':' || ordinality),
      coalesce(nullif(item->>'sessionKey',''),nullif(item->>'id',''),eligible.id::text || ':' || ordinality),
      case when dashboard_private.is_canonical_class_date_v1(item->>'date') then nullif(item->>'date','')::date end, coalesce(item->>'startTime',''), coalesce(item->>'endTime',''),
      case when coalesce(item->>'scheduleState',item->>'state','active')='force_active' then 'active'
        else coalesce(item->>'scheduleState',item->>'state','active') end, ''
    from eligible_classes eligible
    cross join lateral jsonb_array_elements(case when jsonb_typeof(eligible.schedule_plan->'sessions')='array'
      then eligible.schedule_plan->'sessions' else '[]'::jsonb end) with ordinality entries(item,ordinality)
    where eligible.schedule_storage_mode <> 'normalized'
      and nullif(item->>'date','') is not null and dashboard_private.is_canonical_class_date_v1(item->>'date')
      and coalesce(item->>'scheduleState',item->>'state','active') in ('active','force_active','exception','makeup','tbd')
  ), session_agg as materialized (
    select class_id, count(*)::integer as session_count,
      count(*) filter(where session_date < (current_timestamp at time zone 'Asia/Seoul')::date)::integer as planned_count,
      count(*) filter(where session_date >= (current_timestamp at time zone 'Asia/Seoul')::date)::integer as upcoming_count
    from schedule_sessions group by class_id
  ), base as materialized (
    select
      eligible.id, eligible.name, eligible.subject, eligible.subject_area_key,
      eligible.grade, eligible.teacher, eligible.room, eligible.schedule,
      eligible.status, eligible.start_date, eligible.end_date, eligible.term_id,
      eligible.period, eligible.normalized_status,
      eligible.term_name, eligible.textbook_count,
      coalesce(session_agg.session_count, 0)::integer as session_count,
      coalesce(session_agg.planned_count, 0)::integer as planned_count,
      coalesce(session_agg.upcoming_count,0)::integer as upcoming_count,
      eligible.sort_key
    from eligible_classes eligible
    left join session_agg on session_agg.class_id = eligible.id
  ), classified as materialized (
    select
      base.id, base.name, base.subject, base.subject_area_key, base.grade,
      base.teacher, base.room, base.schedule, base.status, base.start_date,
      base.end_date, base.term_id, base.period,
      base.normalized_status, base.term_name, base.textbook_count,
      base.session_count, base.planned_count, base.upcoming_count,
      base.sort_key,
      case
        when base.session_count = 0 then '회차 미생성'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then '일정 연장 필요'
        else '일정 편성'
      end as state_label,
      case
        when base.session_count = 0 then 'unscheduled'
        when base.upcoming_count = 0 and base.normalized_status <> '종강' then 'update'
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
    select distinct on (session.class_id) session.class_id,
      session.id as next_session_id,session.session_key as next_session_key,
      session.session_date as next_session_date,session.start_time as next_start_time,
      session.end_time as next_end_time,session.schedule_state as next_schedule_state
    from schedule_sessions session join page_keys selected on selected.id=session.class_id
    where session.session_date >= (current_timestamp at time zone 'Asia/Seoul')::date
    order by session.class_id,session.session_date,session.start_time nulls last,session.id
  ), page_candidates as materialized (
    select filtered.*, next_unplanned.next_session_id, next_unplanned.next_session_key,
      next_unplanned.next_session_date, next_unplanned.next_start_time,
      next_unplanned.next_end_time, next_unplanned.next_schedule_state,
      (select max(session.updated_at) from schedule_sessions session where session.class_id=filtered.id) as last_updated_at
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
        'textbookSummary', '',
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
      'unlinkedClassCount', 0,
      'noScheduleClassCount', pg_catalog.count(*) filter (where view_mode='unscheduled')::integer,
      'updateNeededClassCount', pg_catalog.count(*) filter (where state_label='일정 연장 필요')::integer,
      'completedClassCount', pg_catalog.count(*) filter (where state_label='일정 편성')::integer,
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
      'periods', '[]'::jsonb,
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

revoke all on function public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean) from public, anon, authenticated;
revoke all on function public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean) to authenticated;
grant execute on function public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
-- The scheduling reader no longer scans or returns the textbook catalog.
do $$
declare definition text; old_text text := $old$    'textbooks', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', textbook.id,
        'title', textbook.title,
        'name', textbook.name,
        'subject', textbook.subject,
        'publisher', textbook.publisher,
        'category', textbook.category,
        'subSubject', textbook.sub_subject,
        'status', textbook.status
      ) order by coalesce(textbook.title, textbook.name) collate dashboard_private.ko_numeric, textbook.id), '[]'::jsonb)
      from public.textbooks as textbook
      where coalesce(class.textbook_ids, '[]'::jsonb) ? textbook.id::text
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(class.schedule_plan -> 'textbooks') = 'array' then class.schedule_plan -> 'textbooks' else '[]'::jsonb end) as plan_textbook(value)
          where coalesce(plan_textbook.value ->> 'textbookId', plan_textbook.value ->> 'textbook_id', plan_textbook.value ->> 'id') = textbook.id::text
        )
    ),
$old$;
begin
 definition := pg_get_functiondef('public.get_operations_class_lesson_design_detail_v1(uuid)'::regprocedure);
 if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then
  raise exception 'schedule_reader_patch_target_missing' using errcode='55000';
 end if;
 execute replace(definition,old_text,$new$    'textbooks','[]'::jsonb,
$new$);
end;
$$;

-- Class creation and editing accept the same canonical usage dates.
do $$
declare definition text; old_text text; new_text text;
begin
 definition := pg_get_functiondef('public.create_class_with_group_memberships_v1(jsonb,uuid[])'::regprocedure);
 old_text := $old$'teacher', 'schedule', 'room', 'capacity', 'fee', 'status', 'textbook_ids'$old$;
 new_text := $new$'teacher', 'schedule', 'room', 'capacity', 'fee', 'status', 'textbook_ids', 'textbook_usage'$new$;
 if strpos(definition,old_text)=0 then raise exception 'class_create_usage_patch_missing' using errcode='55000'; end if;
 definition := replace(definition,old_text,new_text);
 old_text := E'    textbook_ids\n  )';
 if strpos(definition,old_text)=0 then raise exception 'class_create_usage_columns_missing' using errcode='55000'; end if;
 definition := replace(definition,old_text,E'    textbook_ids,\n    textbook_usage\n  )');
 old_text := $old$    coalesce(p_class -> 'textbook_ids', '[]'::jsonb)
  )$old$;
 if strpos(definition,old_text)=0 then raise exception 'class_create_usage_values_missing' using errcode='55000'; end if;
 definition := replace(definition,old_text,$new$    coalesce(p_class -> 'textbook_ids', '[]'::jsonb),
    coalesce(p_class -> 'textbook_usage', '{}'::jsonb)
  )$new$);
 execute definition;
end;
$$;

commit;
