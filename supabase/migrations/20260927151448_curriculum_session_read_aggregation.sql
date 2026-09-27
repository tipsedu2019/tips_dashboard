begin;
set local lock_timeout='5s';
set local statement_timeout='10s';

-- Validate each saved date once before reuse, preserving the canonical date
-- predicate and original state/key rules. Carry max(updated_at::text) through
-- the existing session aggregate instead of scanning all sessions per page row.
-- Metadata-free all-view pages only read sessions for the selected classes;
-- scope metadata and state-filtered views still aggregate every eligible class.
-- No stored schedules, ACLs, RLS policies or mutation functions change.
do $patch$
declare
 target regprocedure := 'public.get_academic_curriculum_numbered_page_v2(jsonb,integer,integer,boolean)'::regprocedure;
 definition text := pg_get_functiondef(target);
 owner_id oid; acl aclitem[]; change record;
begin
 select proowner,proacl into owner_id,acl from pg_proc where oid=target;
 for change in select * from (values
($old$  ), schedule_sessions as materialized (
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
$old$,$new$  ), session_classes as materialized (
    -- Only the all-view without scope metadata can page before session work.
    -- Other views need every class's counts to decide membership and totals.
    select * from eligible_classes order by sort_key,id
    offset case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then ((p_page::bigint-1)*p_page_size::bigint) else 0 end
    limit case when not p_include_scope_metadata and v_filters->>'viewMode'='all'
      then p_page_size else null end
  ), saved_sessions (class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at) as materialized (
    select eligible.id, coalesce(nullif(item->>'id',''),nullif(item->>'sessionKey',''),eligible.id::text || ':' || ordinality),
      coalesce(nullif(item->>'sessionKey',''),nullif(item->>'id',''),eligible.id::text || ':' || ordinality),
      case when dashboard_private.is_canonical_class_date_v1(item->>'date') then nullif(item->>'date','')::date end, coalesce(item->>'startTime',''), coalesce(item->>'endTime',''),
      case when coalesce(item->>'scheduleState',item->>'state','active')='force_active' then 'active'
        else coalesce(item->>'scheduleState',item->>'state','active') end, ''
    from session_classes eligible
    cross join lateral jsonb_array_elements(case when jsonb_typeof(eligible.schedule_plan->'sessions')='array'
      then eligible.schedule_plan->'sessions' else '[]'::jsonb end) with ordinality entries(item,ordinality)
    where eligible.schedule_storage_mode <> 'normalized'
      and nullif(item->>'date','') is not null
      and coalesce(item->>'scheduleState',item->>'state','active') in ('active','force_active','exception','makeup','tbd')

  ), schedule_sessions as materialized (
    select session.class_id, session.id::text as id, session.session_key, session.session_date,
      session.start_time::text as start_time, session.end_time::text as end_time,
      session.schedule_state, session.updated_at::text as updated_at
    from public.class_lesson_sessions session
    join session_classes eligible on eligible.id=session.class_id
    where eligible.schedule_storage_mode='normalized' and session.schedule_state <> 'skipped'
    union all
    select class_id,id,session_key,session_date,start_time,end_time,schedule_state,updated_at
    from saved_sessions where session_date is not null
$new$),
($old$as upcoming_count
    from schedule_sessions$old$,$new$as upcoming_count,
      max(updated_at) as last_updated_at
    from schedule_sessions$new$),
($old$eligible.term_name, eligible.textbook_count,$old$,$new$eligible.term_name, eligible.textbook_count, session_agg.last_updated_at,$new$),
($old$base.normalized_status, base.term_name, base.textbook_count,$old$,$new$base.normalized_status, base.term_name, base.textbook_count, base.last_updated_at,$new$),
($old$classified.term_name, classified.textbook_count, classified.session_count,$old$,$new$classified.term_name, classified.textbook_count, classified.session_count, classified.last_updated_at,$new$),
($old$next_unplanned.next_end_time, next_unplanned.next_schedule_state,
      (select max(session.updated_at) from schedule_sessions session where session.class_id=filtered.id) as last_updated_at$old$,$new$next_unplanned.next_end_time, next_unplanned.next_schedule_state$new$)
 ) changes(old_value,new_value) loop
   if length(definition)-length(replace(definition,change.old_value,''))<>length(change.old_value) then
     raise exception using errcode='55000',message='curriculum_session_aggregation_target_missing';
   end if;
   definition:=replace(definition,change.old_value,change.new_value);
 end loop;
 execute definition;
 if exists(select 1 from pg_proc where oid=target and (proowner is distinct from owner_id or proacl is distinct from acl)) then
   raise exception using errcode='55000',message='curriculum_session_aggregation_acl_changed';
 end if;
end $patch$;
commit;
