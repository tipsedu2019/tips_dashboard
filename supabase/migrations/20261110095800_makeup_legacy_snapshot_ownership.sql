-- #249: distinguish an unchanged historical snapshot from ownership of a new pair.
-- Exact body replacement only; authentication, locks, owner/ACL and all other
-- adoption/occupancy checks are retained. No business records are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare p pg_catalog.pg_proc; before_metadata jsonb; replacement text:=$body$
 with candidates as materialized (
  select other.*,
   case when jsonb_typeof(other.schedule_plan_before->'sessions')='array' then other.schedule_plan_before->'sessions' else '[]'::jsonb end before_rows,
   case when jsonb_typeof(other.schedule_plan_after->'sessions')='array' then other.schedule_plan_after->'sessions' else '[]'::jsonb end after_rows
  from public.makeup_requests other
  where other.id<>p_request.id and other.class_id=p_request.class_id
   and other.status not in('rejected','canceled')
 ), conflicts as materialized (
  select other.* from candidates other
  where other.cancel_date=p_request.cancel_date or exists(
   select 1 from jsonb_array_elements(other.before_rows||other.after_rows) s
   where s->>'id' in(pair->>'originalId',pair->>'makeupId'))
 )
 select exists(select 1 from conflicts other where not coalesce(
  -- A completed, unrelated request carries the whole class snapshot. An
  -- unchanged ordinary original row is not ownership of a later makeup pair.
  -- All ambiguous/changed/claimed histories retain the original conflict.
  other.status='completed' and other.request_kind='cancel_makeup'
  and other.original_lesson_session_id is null
  and other.approved_at is not null and other.approved_by is not null
  and exists(select 1 from public.makeup_request_events e where e.request_id=other.id and e.event_type='approved')
  and other.cancel_date is distinct from p_request.cancel_date
  and other.cancel_date::text not in(pair->>'cancelDate',pair->>'makeupDate')
  and jsonb_typeof(other.schedule_plan_before)='object' and jsonb_typeof(other.schedule_plan_after)='object'
  and jsonb_typeof(other.schedule_plan_before->'sessions')='array'
  and jsonb_typeof(other.schedule_plan_after->'sessions')='array'
  and case when jsonb_typeof(other.makeup_slots)='array' and jsonb_typeof(other.makeup_slots->0)='object'
   then jsonb_array_length(other.makeup_slots)=1
    and other.makeup_start_at=public.makeup_numbered_source_instant_v1(other.makeup_slots#>>'{0,startAt}')
    and other.makeup_end_at=public.makeup_numbered_source_instant_v1(other.makeup_slots#>>'{0,endAt}')
    and other.makeup_start_at<other.makeup_end_at
    and not exists(select 1 from unnest(array[pair->>'cancelDate',pair->>'makeupDate']) d
     where d between to_char(other.makeup_start_at at time zone 'Asia/Seoul','YYYY-MM-DD')
      and to_char(other.makeup_end_at at time zone 'Asia/Seoul','YYYY-MM-DD'))
   else false end
  and not exists(select 1 from jsonb_array_elements(other.before_rows||other.after_rows) s
   where jsonb_typeof(s) is distinct from 'object'
    or s->>'id'=pair->>'makeupId' or s->>'sessionKey'=pair->>'makeupId'
    or s->>'originalSessionId' in(pair->>'originalId',pair->>'makeupId')
    or s->>'originalDate' in(pair->>'cancelDate',pair->>'makeupDate')
    or s->>'makeupDate' in(pair->>'cancelDate',pair->>'makeupDate'))
  and (select count(*) from jsonb_array_elements(other.before_rows) s
   where s->>'id'=pair->>'originalId' or s->>'sessionKey'=pair->>'originalId')=1
  and (select count(*) from jsonb_array_elements(other.after_rows) s
   where s->>'id'=pair->>'originalId' or s->>'sessionKey'=pair->>'originalId')=1
  and exists(select 1 from jsonb_array_elements(other.before_rows) b
   cross join jsonb_array_elements(other.after_rows) a
   where b->>'id'=pair->>'originalId' and a->>'id'=pair->>'originalId'
    and b::text=a::text and b->>'date'=pair->>'cancelDate'
    and jsonb_typeof(b->'id')='string'
    and (not(b?'sessionKey') or b->>'sessionKey'=b->>'id')
    and coalesce(nullif(b->>'scheduleState',''),nullif(b->>'state',''),'active')='active'
    and coalesce(nullif(b->>'state',''),'active')='active'
    and coalesce(b->>'originalDate','')='' and coalesce(b->>'originalSessionId','')=''
    and coalesce(b->>'makeupDate','')='' and coalesce(b->>'makeupRequestId','')=''
    and coalesce(b->>'makeupRequestRole','')='' and not(b?'makeupAdoption'))
  and not exists(select 1 from unnest(array['sessionStates','sessionSchedules']) k
   cross join unnest(array[pair->>'cancelDate',pair->>'makeupDate']) d
   where coalesce(jsonb_typeof(other.schedule_plan_before->k),'object')<>'object'
    or coalesce(jsonb_typeof(other.schedule_plan_after->k),'object')<>'object'
    or (other.schedule_plan_before#>array[k,d])::text is distinct from (other.schedule_plan_after#>array[k,d])::text),false))
$body$;
begin
 select * into p from pg_catalog.pg_proc
  where oid=to_regprocedure('dashboard_private.makeup_legacy_pair_competing_v1(public.makeup_requests,jsonb)');
 if not found or md5(p.prosrc)<>'c892cccbbc7f755e0a2ea3876c5408d8' or p.prosqlbody is not null then
  raise exception using errcode='55000',message='makeup_snapshot_ownership_definition_drift';end if;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_language where lanname='sql')
  or p.provolatile<>'s' or p.prosecdef or p.proisstrict or p.proparallel<>'u'
  or p.procost<>100 or p.prorows<>0 or p.proleakproof
  or p.proconfig is null or cardinality(p.proconfig)<>1
  or not(p.proconfig[1]=any(array['search_path=','search_path=""']))
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception using errcode='55000',message='makeup_snapshot_ownership_boundary_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';
 execute replace(pg_get_functiondef(p.oid),p.prosrc,replacement);
 if (select md5(prosrc)<>'d2864a81d9287b8956ba701b827b64a5' or (to_jsonb(q)-'prosrc') is distinct from before_metadata
  from pg_catalog.pg_proc q where q.oid=p.oid) then
  raise exception using errcode='55000',message='makeup_snapshot_ownership_metadata_changed';end if;
end $migration$;
commit;
