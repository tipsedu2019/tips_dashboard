-- #241: adopt one verified legacy cancellation/makeup pair without replacing
-- its identities or lesson content. All new helpers remain owner-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Pins were captured from the complete base migration chain at 00899d1f.
-- prosrc hashes are independent of a session's type-name/search-path formatting.
do $precondition$
declare item record;
begin
 for item in select * from (values
  ('dashboard_private.legacy_effective_binding_v1(jsonb)','901e6110800bcf2eb04b6c6990749821'),
  ('dashboard_private.legacy_effective_context_v1(public.classes,jsonb)','5a71f41f27b46ad317de775686c3ab80'),
  ('dashboard_private.legacy_effective_context_for_dates_v1(public.classes,jsonb,date,date)','7e162d44b33f7cff9a7e457c9d88bf8f'),
  ('dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)','ccfe362f16236fc0537abaa58bbbdcd6'),
  ('dashboard_private.makeup_effective_class_context_v1(jsonb)','db80f6fa7572516dbfab6d47bdcf0c41'),
  ('dashboard_private.transition_makeup_request_v2_unguarded(uuid,text,jsonb,text,uuid)','6c273c82d05a2b0e8f596c52ec248641'),
  ('public.get_makeup_reservation_context_v1(jsonb,uuid[])','70a3b34f2345c2b5df3599514ba69f69'),
  ('public.get_makeup_approval_collision_context_v1(jsonb)','401048cc43824c2e63a9dc1d5cc90d59')
 ) t(signature,source_md5) loop
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.source_md5 then
   raise exception 'makeup_legacy_adoption_base_drift: %',item.signature;end if;
 end loop;
end $precondition$;

create function dashboard_private.makeup_legacy_pair_v1(p_plan jsonb,p_request jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $f$
declare rows jsonb; original jsonb; makeup jsonb; slot jsonb; slots jsonb;
 cancel_date text:=p_request->>'cancel_date'; makeup_date text; original_id text; makeup_id text;
 original_index int; makeup_index int; a timestamptz; b timestamptz; k text; v jsonb; n int;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan->'sessions') is distinct from 'array'
  or jsonb_typeof(p_request) is distinct from 'object' or p_request->>'request_kind' is distinct from 'cancel_makeup'
  or coalesce(p_request->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or nullif(p_request->>'original_lesson_session_id','') is not null
  or cancel_date!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(cancel_date::date,'YYYY-MM-DD') is distinct from cancel_date
  then return null;end if;
 if p_request ? 'makeup_slots' and p_request->'makeup_slots'<>'null'::jsonb and jsonb_typeof(p_request->'makeup_slots') is distinct from 'array' then return null;end if;
 if jsonb_typeof(p_request->'makeup_slots')='array' and jsonb_array_length(p_request->'makeup_slots')>0 then
  if jsonb_array_length(p_request->'makeup_slots')<>1 then return null;end if;
  slot:=p_request#>'{makeup_slots,0}';
  if jsonb_typeof(slot) is distinct from 'object' or jsonb_typeof(slot->'startAt') is distinct from 'string'
   or jsonb_typeof(slot->'endAt') is distinct from 'string' or jsonb_typeof(slot->'classroom') is distinct from 'string'
   or nullif(btrim(slot->>'startAt'),'') is null or nullif(btrim(slot->>'endAt'),'') is null or nullif(btrim(slot->>'classroom'),'') is null then return null;end if;
 end if;
 slots:=public.makeup_numbered_slots_v1(jsonb_build_object('makeup_slots',p_request->'makeup_slots','makeup_start_at',p_request->'makeup_start_at',
  'makeup_end_at',p_request->'makeup_end_at','makeup_classroom',p_request->'makeup_classroom'));
 if jsonb_array_length(slots)<>1 then return null;end if;
 slot:=slots->0;
 if coalesce(slot->>'startAt','')!~'(Z|[+-][0-9]{2}:?[0-9]{2})$'
  or coalesce(slot->>'endAt','')!~'(Z|[+-][0-9]{2}:?[0-9]{2})$'
  or slot->>'startAt'~'[.][0-9]*[1-9][0-9]*' or slot->>'endAt'~'[.][0-9]*[1-9][0-9]*'
  or nullif(btrim(slot->>'classroom'),'') is null then return null;end if;
 a:=public.makeup_numbered_source_instant_v1(slot->>'startAt');b:=public.makeup_numbered_source_instant_v1(slot->>'endAt');
 if a is null or b is null or a>=b or b-a>interval '24 hours' or extract(second from a)<>0 or extract(second from b)<>0 then return null;end if;
 makeup_date:=to_char(a at time zone 'Asia/Seoul','YYYY-MM-DD');
 if makeup_date=cancel_date or not ((b at time zone 'Asia/Seoul')::date=(a at time zone 'Asia/Seoul')::date
  or ((b at time zone 'Asia/Seoul')::date=(a at time zone 'Asia/Seoul')::date+1 and (b at time zone 'Asia/Seoul')::time='00:00'::time and b-a<interval '24 hours')) then return null;end if;
 rows:=p_plan->'sessions';
 if exists(select 1 from jsonb_array_elements(rows) s where jsonb_typeof(s) is distinct from 'object') then return null;end if;
 select count(*) into n from jsonb_array_elements(rows) s where s->>'date'=cancel_date;
 if n<>1 then return null;end if;
 select s,ord::int-1 into original,original_index from jsonb_array_elements(rows) with ordinality t(s,ord) where s->>'date'=cancel_date;
 select count(*) into n from jsonb_array_elements(rows) s where s->>'date'=makeup_date;
 if n<>1 then return null;end if;
 select s,ord::int-1 into makeup,makeup_index from jsonb_array_elements(rows) with ordinality t(s,ord) where s->>'date'=makeup_date;
 original_id:=original->>'id';makeup_id:=makeup->>'id';
 if jsonb_typeof(original->'id') is distinct from 'string' or jsonb_typeof(makeup->'id') is distinct from 'string'
  or nullif(btrim(original_id),'') is null or nullif(btrim(makeup_id),'') is null or length(original_id)>512 or length(makeup_id)>512
  or btrim(original_id)<>original_id or btrim(makeup_id)<>makeup_id
  or original_id=makeup_id
  or (original ? 'sessionKey' and original->>'sessionKey' is distinct from original_id)
  or (makeup ? 'sessionKey' and makeup->>'sessionKey' is distinct from makeup_id)
  or (select count(*) from jsonb_array_elements(rows) s where s->>'id'=original_id or s->>'sessionKey'=original_id)<>1
  or (select count(*) from jsonb_array_elements(rows) s where s->>'id'=makeup_id or s->>'sessionKey'=makeup_id)<>1
  or coalesce(nullif(original->>'scheduleState',''),original->>'state') is distinct from 'exception'
  or coalesce(nullif(makeup->>'scheduleState',''),makeup->>'state') is distinct from 'makeup'
  or (nullif(original->>'state','') is not null and original->>'state'<>'exception')
  or (nullif(makeup->>'state','') is not null and makeup->>'state'<>'makeup')
  or original->>'makeupDate' is distinct from makeup_date or makeup->>'originalDate' is distinct from cancel_date
  or makeup->>'originalSessionId' is distinct from original_id
  or nullif(original->>'originalDate','') is not null or nullif(original->>'originalSessionId','') is not null or nullif(makeup->>'makeupDate','') is not null
  or original ? 'makeupAdoption' or makeup ? 'makeupAdoption'
  or nullif(original->>'makeupRequestId','') is not null or nullif(makeup->>'makeupRequestId','') is not null
  or nullif(original->>'makeupRequestRole','') is not null or nullif(makeup->>'makeupRequestRole','') is not null
  then return null;end if;
 if exists(select 1 from jsonb_array_elements(rows) s where s<>makeup and (s->>'originalSessionId'=original_id or s->>'originalDate'=cancel_date))
  or exists(select 1 from jsonb_array_elements(rows) s where s<>original and s->>'makeupDate'=makeup_date) then return null;end if;
 -- Date maps may carry unrelated notes; relationship/state overrides must agree.
 foreach k in array array['sessionStates','sessionSchedules'] loop
  if p_plan ? k and jsonb_typeof(p_plan->k) is distinct from 'object' then return null;end if;
  foreach v in array array[p_plan#>array[k,cancel_date],p_plan#>array[k,makeup_date]] loop
   if v is not null and jsonb_typeof(v) not in('object','string') then return null;end if;
  end loop;
  v:=p_plan#>array[k,cancel_date];
  if jsonb_typeof(v)='string' and v<>'"exception"'::jsonb then return null;end if;
  if jsonb_typeof(v)='object' and ((v ? 'state' and v->>'state' is distinct from 'exception') or (v ? 'scheduleState' and v->>'scheduleState' is distinct from 'exception')
   or (v ? 'makeupDate' and v->>'makeupDate' is distinct from makeup_date) or nullif(v->>'originalDate','') is not null or nullif(v->>'originalSessionId','') is not null) then return null;end if;
  v:=p_plan#>array[k,makeup_date];
  if jsonb_typeof(v)='string' and v<>'"makeup"'::jsonb then return null;end if;
  if jsonb_typeof(v)='object' and ((v ? 'state' and v->>'state' is distinct from 'makeup') or (v ? 'scheduleState' and v->>'scheduleState' is distinct from 'makeup')
   or (v ? 'originalDate' and v->>'originalDate' is distinct from cancel_date) or (v ? 'originalSessionId' and v->>'originalSessionId' is distinct from original_id)
   or nullif(v->>'makeupDate','') is not null) then return null;end if;
 end loop;
 return jsonb_build_object('originalId',original_id,'makeupId',makeup_id,'originalIndex',original_index,'makeupIndex',makeup_index,
  'cancelDate',cancel_date,'makeupDate',makeup_date,'startAt',to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'endAt',to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'classroom',slot->>'classroom');
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return null;
end $f$;

create function dashboard_private.makeup_legacy_adoption_plan_v1(p_plan jsonb,p_request jsonb,p_teacher jsonb,p_room jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $f$
declare pair jsonb:=dashboard_private.makeup_legacy_pair_v1(p_plan,p_request); result jsonb:=p_plan; old_row jsonb; next_row jsonb; a timestamptz; b timestamptz; marker jsonb;
begin
 if pair is null or jsonb_typeof(p_teacher) is distinct from 'object' or jsonb_typeof(p_room) is distinct from 'object'
  or p_teacher->>'id' is distinct from p_request->>'teacher_catalog_id' or nullif(btrim(p_teacher->>'name'),'') is null
  or coalesce(p_teacher->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(p_room->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or p_room->>'name' is distinct from pair->>'classroom' or nullif(p_request->>'updated_at','') is null then return null;end if;
 a:=(pair->>'startAt')::timestamptz;b:=(pair->>'endAt')::timestamptz;
 marker:=jsonb_build_object('version',1,'requestUpdatedAt',p_request->>'updated_at','originalId',pair->>'originalId','makeupId',pair->>'makeupId');
 old_row:=p_plan#>array['sessions',pair->>'originalIndex'];
 next_row:=old_row||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','cancel');
 result:=jsonb_set(result,array['sessions',pair->>'originalIndex'],next_row,false);
 old_row:=p_plan#>array['sessions',pair->>'makeupIndex'];
 next_row:=old_row||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','makeup','makeupAdoption',marker,
  'startTime',to_char(a at time zone 'Asia/Seoul','HH24:MI'),
  'endTime',case when (b at time zone 'Asia/Seoul')::date>(a at time zone 'Asia/Seoul')::date then '24:00' else to_char(b at time zone 'Asia/Seoul','HH24:MI') end,
  'teacherCatalogId',p_teacher->>'id','teacherName',p_teacher->>'name','classroomCatalogId',p_room->>'id','classroomName',p_room->>'name');
 return jsonb_set(result,array['sessions',pair->>'makeupIndex'],next_row,false);
end $f$;

create function dashboard_private.makeup_legacy_adoption_snapshot_v1(p_before jsonb,p_after jsonb,p_request jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $f$
declare pair jsonb:=dashboard_private.makeup_legacy_pair_v1(p_before,p_request); lesson jsonb; marker jsonb; expected jsonb;
begin
 if pair is null or jsonb_typeof(p_after->'sessions') is distinct from 'array' then return false;end if;
 lesson:=p_after#>array['sessions',pair->>'makeupIndex'];marker:=lesson->'makeupAdoption';
 if jsonb_typeof(marker) is distinct from 'object' or marker->'version' is distinct from '1'::jsonb
  or marker->>'originalId' is distinct from pair->>'originalId' or marker->>'makeupId' is distinct from pair->>'makeupId'
  or nullif(marker->>'requestUpdatedAt','') is null
  or lesson->>'classroomName' is distinct from pair->>'classroom'
  or not exists(select 1 from public.classroom_catalogs r where r.id::text=lesson->>'classroomCatalogId' and r.name=pair->>'classroom') then return false;end if;
 expected:=dashboard_private.makeup_legacy_adoption_plan_v1(p_before,p_request||jsonb_build_object('updated_at',marker->>'requestUpdatedAt'),
  jsonb_build_object('id',lesson->>'teacherCatalogId','name',lesson->>'teacherName'),jsonb_build_object('id',lesson->>'classroomCatalogId','name',lesson->>'classroomName'));
 return expected is not null and expected=p_after;
end $f$;

create function dashboard_private.makeup_legacy_pair_competing_v1(p_request public.makeup_requests,pair jsonb)
returns boolean language sql stable security invoker set search_path='' as $f$
 select exists(select 1 from public.makeup_requests other where other.id<>p_request.id and other.class_id=p_request.class_id
  and other.status not in('rejected','canceled')
  and (other.cancel_date=p_request.cancel_date or exists(
   select 1 from jsonb_array_elements(
    (case when jsonb_typeof(other.schedule_plan_before->'sessions')='array' then other.schedule_plan_before->'sessions' else '[]'::jsonb end)
    ||(case when jsonb_typeof(other.schedule_plan_after->'sessions')='array' then other.schedule_plan_after->'sessions' else '[]'::jsonb end)) s
   where s->>'id' in(pair->>'originalId',pair->>'makeupId'))))
$f$;

-- New functions are callable only by the existing trusted owners. No app role
-- receives a new executable function or a widened table/RLS policy.
revoke all on function dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb),dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb),dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb),dashboard_private.makeup_legacy_pair_competing_v1(public.makeup_requests,jsonb) from public,anon,authenticated,service_role;

create function dashboard_private.makeup_legacy_adoption_current_v1(p_current jsonb,p_before jsonb,p_after jsonb,p_request jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $f$
declare pair jsonb; ident text; expected jsonb; current_row jsonb; n int;
begin
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_after->'sessions')='array' then p_after->'sessions' else '[]'::jsonb end) s where s ? 'makeupAdoption') then return false;end if;
 pair:=dashboard_private.makeup_legacy_pair_v1(p_before,p_request);
 if pair is null or not dashboard_private.makeup_legacy_adoption_snapshot_v1(p_before,p_after,p_request)
  or jsonb_typeof(p_current->'sessions') is distinct from 'array' then return false;end if;
 foreach ident in array array[pair->>'originalId',pair->>'makeupId'] loop
  select count(*) into n from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident or s->>'sessionKey'=ident;
  if n<>1 then return false;end if;
  select s into current_row from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident;
  select s into expected from jsonb_array_elements(p_after->'sessions') s where s->>'id'=ident;
  if current_row is null or expected is null or dashboard_private.legacy_effective_binding_v1(current_row) is distinct from dashboard_private.legacy_effective_binding_v1(expected) then return false;end if;
 end loop;
 return true;
end $f$;

-- This owner-only resolver is reached through the existing authenticated
-- SECURITY DEFINER context, never through a newly granted function.
create function dashboard_private.makeup_legacy_bindings_v1(p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $f$
declare ids jsonb:=p_input->'requestIds'; slots jsonb:=p_input->'slots'; s jsonb; request_row public.makeup_requests; c public.classes;
 pair jsonb; request_json jsonb; occupancy jsonb; occupancies jsonb; occupancy_cache jsonb:='{}'; context jsonb; source jsonb; result jsonb:='[]'; mode text; n int;
 actor uuid:=auth.uid(); actor_role text; role_name text:=current_setting('role',true); day_start timestamptz; day_end timestamptz;
 a timestamptz; b timestamptz; d date; first_date date; last_date date;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['kind','requestIds','slots']<>'{}'::jsonb
  or p_input->>'kind' is distinct from 'legacyAdoption' or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>256
  or jsonb_typeof(slots) is distinct from 'array' or jsonb_array_length(slots)>256 then
  raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
 if exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x) is distinct from 'string'
  or (x#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  or (select count(distinct lower(x#>>'{}')) from jsonb_array_elements(ids) x)<>jsonb_array_length(ids) then
  raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
 for s in select value from jsonb_array_elements(slots) loop
  if jsonb_typeof(s) is distinct from 'object' or s-array['startAt','endAt']<>'{}'::jsonb
   or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string'
   or public.makeup_numbered_source_instant_v1(s->>'startAt') is null or public.makeup_numbered_source_instant_v1(s->>'endAt') is null
   or public.makeup_numbered_source_instant_v1(s->>'startAt')>=public.makeup_numbered_source_instant_v1(s->>'endAt') then
   raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
  a:=public.makeup_numbered_source_instant_v1(s->>'startAt');b:=public.makeup_numbered_source_instant_v1(s->>'endAt');d:=(a at time zone 'Asia/Seoul')::date;
  if b>((d+1)::timestamp at time zone 'Asia/Seoul') then raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
  first_date:=least(first_date,d);last_date:=greatest(last_date,d);
 end loop;
 if last_date-first_date>13 then raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
 if role_name is distinct from 'service_role' and actor is null then raise exception using errcode='42501',message='makeup_auth_required';end if;
 if jsonb_array_length(slots)=0 or jsonb_array_length(ids)=0 then return result;end if;
 select p.role into actor_role from public.profiles p where p.id=actor;
 for request_row in select r.* from public.makeup_requests r where r.id in(select (x#>>'{}')::uuid from jsonb_array_elements(ids) x) order by r.id loop
  -- No competitor identifiers, counts or denial reasons leave this boundary.
  if role_name is distinct from 'service_role' and not coalesce(actor_role<>'assistant' and
   (actor_role in('admin','staff','teacher') or actor in(request_row.requester_id,request_row.teacher_profile_id,request_row.approver_profile_id)),false) then continue;end if;
  select * into c from public.classes where id=request_row.class_id;
  if not found or c.schedule_storage_mode='normalized' then continue;end if;
  request_json:=to_jsonb(request_row);mode:=null;
  if request_row.status='approval_pending' and request_row.schedule_plan_before is null and request_row.schedule_plan_after is null
   and request_row.cancel_academic_event_id is null and request_row.makeup_academic_event_id is null
   and coalesce(request_row.makeup_academic_event_ids,'[]'::jsonb)='[]'::jsonb
   and not exists(select 1 from public.makeup_request_events e where e.request_id=request_row.id and e.event_type='approved') then
   pair:=dashboard_private.makeup_legacy_pair_v1(c.schedule_plan,request_json);
   if pair is null or dashboard_private.makeup_legacy_pair_competing_v1(request_row,pair) then continue;end if;
   mode:='reuse';
  elsif request_row.status in('completed','makeup_pending') and dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,request_row.schedule_plan_before,request_row.schedule_plan_after,request_json) then
   pair:=dashboard_private.makeup_legacy_pair_v1(request_row.schedule_plan_before,request_json);
   context:=dashboard_private.legacy_effective_context_for_dates_v1(c,null,(pair->>'makeupDate')::date,(pair->>'makeupDate')::date);
   source:=context#>array['approvedByIdentity',pair->>'makeupId'];
   if source->'approvedOverrideVerified' is distinct from 'true'::jsonb or source->'legacyAdoptionVerified' is distinct from 'true'::jsonb then continue;end if;
   mode:='bound';
  end if;
  if mode is null then continue;end if;
  if not exists(select 1 from jsonb_array_elements(slots) w where
   public.makeup_numbered_source_instant_v1(w->>'startAt')<=(pair->>'startAt')::timestamptz
   and public.makeup_numbered_source_instant_v1(w->>'endAt')>=(pair->>'endAt')::timestamptz) then continue;end if;
  day_start:=(pair->>'makeupDate')::date::timestamp at time zone 'Asia/Seoul';day_end:=day_start+interval '1 day';
  if not occupancy_cache ? (pair->>'makeupDate') then
   occupancies:=dashboard_private.makeup_effective_class_context_v1(jsonb_build_array(jsonb_build_object(
    'startAt',to_char(day_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt',to_char(day_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))->'occupancies';
   occupancy_cache:=occupancy_cache||jsonb_build_object(pair->>'makeupDate',occupancies);
  else occupancies:=occupancy_cache->(pair->>'makeupDate');end if;
  select count(*) into n from jsonb_array_elements(occupancies) o where o->>'classId'=c.id::text and o->>'id'='legacy-session:'||c.id::text||':'||(pair->>'makeupId');
  if n<>1 then continue;end if;
  select o into occupancy from jsonb_array_elements(occupancies) o where o->>'classId'=c.id::text and o->>'id'='legacy-session:'||c.id::text||':'||(pair->>'makeupId');
  if occupancy->'uncertain' is distinct from 'false'::jsonb or occupancy->'allRooms' is distinct from 'false'::jsonb
   or nullif(occupancy->>'classroom','') is null or occupancy->>'date' is distinct from pair->>'makeupDate'
   or (occupancy->>'startMinute')::int>=(occupancy->>'endMinute')::int then continue;end if;
  if mode='bound' and (occupancy->>'classroom' is distinct from pair->>'classroom'
   or (occupancy->>'startMinute')::int<>extract(epoch from ((pair->>'startAt')::timestamptz at time zone 'Asia/Seoul')-(pair->>'makeupDate')::date::timestamp)::int/60
   or (occupancy->>'endMinute')::int<>extract(epoch from ((pair->>'endAt')::timestamptz at time zone 'Asia/Seoul')-(pair->>'makeupDate')::date::timestamp)::int/60) then continue;end if;
  result:=result||jsonb_build_array(jsonb_build_object('version',1,'mode',mode,'requestId',request_row.id,'classId',c.id,
   'requestUpdatedAt',request_json->>'updated_at','cancelDate',pair->>'cancelDate','originalId',pair->>'originalId','makeupId',pair->>'makeupId',
   'startAt',pair->>'startAt','endAt',pair->>'endAt','classroom',pair->>'classroom','occupancy',occupancy));
 end loop;
 return result;
end $f$;

create function dashboard_private.makeup_assert_legacy_adoption_v1(p_request public.makeup_requests,p_patch jsonb)
returns void language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $f$
declare c public.classes; pair jsonb; expected jsonb; teacher jsonb; room jsonb; proof jsonb; result jsonb; occupied jsonb;
begin
 select * into c from public.classes where id=p_request.class_id;
 -- Existing normalized and normal-active legacy approval paths are unchanged.
 if c.schedule_storage_mode='normalized' then return;end if;
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]'::jsonb end) s
  where s->>'date'=p_request.cancel_date::text and coalesce(nullif(s->>'scheduleState',''),s->>'state')='exception')
  and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_patch#>'{schedule_plan_after,sessions}')='array' then p_patch#>'{schedule_plan_after,sessions}' else '[]'::jsonb end) s where s ? 'makeupAdoption' and s->>'makeupRequestId'=p_request.id::text) then return;end if;
 pair:=dashboard_private.makeup_legacy_pair_v1(c.schedule_plan,to_jsonb(p_request));
 if pair is null or dashboard_private.makeup_legacy_pair_competing_v1(p_request,pair)
  or p_request.schedule_plan_before is not null or p_request.schedule_plan_after is not null
  or p_request.cancel_academic_event_id is not null or p_request.makeup_academic_event_id is not null
  or coalesce(p_request.makeup_academic_event_ids,'[]'::jsonb)<>'[]'::jsonb
  or exists(select 1 from public.makeup_request_events e where e.request_id=p_request.id and e.event_type='approved') then
  raise exception using errcode='P0001',message='makeup_legacy_pair_invalid';end if;
 select jsonb_build_object('id',id,'name',name) into teacher from public.teacher_catalogs where id=p_request.teacher_catalog_id;
 select jsonb_build_object('id',min(id::text),'name',min(name)) into room from public.classroom_catalogs where name=pair->>'classroom' having count(*)=1;
 expected:=dashboard_private.makeup_legacy_adoption_plan_v1(c.schedule_plan,to_jsonb(p_request),teacher,room);
 if p_patch->'schedule_plan_before' is distinct from c.schedule_plan
  or p_patch#>>array['schedule_plan_after','sessions',pair->>'makeupIndex','makeupAdoption','requestUpdatedAt'] is distinct from to_jsonb(p_request)->>'updated_at' then
  raise exception using errcode='P0001',message='makeup_legacy_pair_stale';end if;
 if expected is null or p_patch->'schedule_plan_after' is distinct from expected then
  raise exception using errcode='P0001',message='makeup_legacy_pair_invalid';end if;
 result:=dashboard_private.makeup_legacy_bindings_v1(jsonb_build_object('kind','legacyAdoption','requestIds',jsonb_build_array(p_request.id),
  'slots',jsonb_build_array(jsonb_build_object('startAt',pair->>'startAt','endAt',pair->>'endAt'))));
 if jsonb_array_length(result)<>1 then raise exception using errcode='P0001',message='makeup_legacy_pair_invalid';end if;
 proof:=result->0;
 result:=dashboard_private.makeup_effective_class_context_v1(jsonb_build_array(jsonb_build_object('startAt',pair->>'startAt','endAt',pair->>'endAt')))->'occupancies';
 for occupied in select value from jsonb_array_elements(result) loop
  if occupied is distinct from proof->'occupancy' and (occupied->'allRooms'='true'::jsonb or occupied->>'classroom'=pair->>'classroom') then
   raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
end $f$;

revoke all on function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb),dashboard_private.makeup_legacy_bindings_v1(jsonb),dashboard_private.makeup_assert_legacy_adoption_v1(public.makeup_requests,jsonb) from public,anon,authenticated,service_role;

-- Each replacement is a single reviewed fragment in the final migration-chain
-- definition. CREATE OR REPLACE retains owner, SECURITY mode and existing ACL.
-- Any source drift aborts the transaction rather than patching another writer.
do $patch$
declare src text; old text; replacement text; signature text;
begin
 signature:='dashboard_private.legacy_effective_binding_v1(jsonb)';
 src:=pg_get_functiondef(signature::regprocedure);old:='''makeupRequestId'',''makeupRequestRole'']';replacement:='''makeupRequestId'',''makeupRequestRole'',''originalSessionId'',''makeupAdoption'']';
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_binding_source_drift';end if;
 execute replace(src,old,replacement);
 foreach signature in array array['dashboard_private.legacy_effective_context_v1(public.classes,jsonb)','dashboard_private.legacy_effective_context_for_dates_v1(public.classes,jsonb,date,date)'] loop
  src:=pg_get_functiondef(signature::regprocedure);
  if signature like '%_for_dates_v1%' then
   old:=$old$   dashboard_private.legacy_effective_binding_v1(v) lesson,$old$;
   replacement:=$new$   case when v ? 'makeupAdoption' then dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,m.schedule_plan_before,m.schedule_plan_after,to_jsonb(m)) else false end legacy_adoption_verified,
   dashboard_private.legacy_effective_binding_v1(v) lesson,$new$;
   if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_bounded_source_drift';end if;
   src:=replace(src,old,replacement);
  end if;
  old:=$old$(lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text)$old$;
  replacement:=$new$(lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text
    or (slot_index=0 and lesson->>'id'=lesson#>>'{makeupAdoption,makeupId}' and dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,schedule_plan_before,schedule_plan_after,request_json)))$new$;
  if signature like '%_for_dates_v1%' then replacement:=replace(replacement,'dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,schedule_plan_before,schedule_plan_after,request_json)','legacy_adoption_verified');end if;
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_context_source_drift';end if;
  src:=replace(src,old,replacement);
  old:=$old$'approvedOverride',jsonb_build_object($old$;
  replacement:=$new$'legacyAdoptionVerified',dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json),
   'approvedOverride',jsonb_build_object($new$;
  if signature like '%_for_dates_v1%' then replacement:=replace(replacement,'dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)','candidate.legacy_adoption_verified');end if;
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_context_source_drift';end if;
  src:=replace(src,old,replacement);
  old:=$old$and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b),false));$old$;
  replacement:=$new$and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or (dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));$new$;
  if signature like '%_for_dates_v1%' then replacement:=replace(replacement,'dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)','candidate.legacy_adoption_verified');end if;
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_approved_provenance_drift';end if;
  execute replace(src,old,replacement);
 end loop;
 signature:='dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)';src:=pg_get_functiondef(signature::regprocedure);
 old:=$old$or (left(lesson->>'id',length(prefix))=prefix and substring(lesson->>'id' from length(prefix)+1)~'^[0-9]+$' and lesson->>'sessionKey'=lesson->>'id'),false)$old$;
 replacement:=$new$or (left(lesson->>'id',length(prefix))=prefix and substring(lesson->>'id' from length(prefix)+1)~'^[0-9]+$' and lesson->>'sessionKey'=lesson->>'id')
   or (p->'legacyAdoptionVerified'='true'::jsonb and p->'approvedOverrideVerified'='true'::jsonb and lesson->>'makeupRequestRole'='makeup' and lesson->>'id'=lesson#>>'{makeupAdoption,makeupId}'),false)$new$;
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_scalar_source_drift';end if;
 execute replace(src,old,replacement);
 signature:='dashboard_private.makeup_effective_class_context_v1(jsonb)';src:=pg_get_functiondef(signature::regprocedure);
 old:=$old$ -- Bound the read batch, not the number of lessons in a business request.$old$;
 replacement:=$new$ if jsonb_typeof(p_slots)='object' then
  return jsonb_build_object('version',1,'legacyBindings',dashboard_private.makeup_legacy_bindings_v1(p_slots));
 end if;
 -- Bound the read batch, not the number of lessons in a business request.$new$;
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_trusted_source_drift';end if;
 execute replace(src,old,replacement);
 signature:='dashboard_private.transition_makeup_request_v2_unguarded(uuid,text,jsonb,text,uuid)';src:=pg_get_functiondef(signature::regprocedure);
 old:=$old$      perform dashboard_private.notification_assert_makeup_room_available_v1($old$;
 replacement:=$new$      -- Authority and receipt replay already passed; global/request/class
      -- locks are held. Recompute the complete permitted adoption delta here.
      perform dashboard_private.makeup_assert_legacy_adoption_v1(before_row,p_patch);
      perform dashboard_private.notification_assert_makeup_room_available_v1($new$;
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_writer_source_drift';end if;
 execute replace(src,old,replacement);
end $patch$;

-- Preserve both existing INVOKER context signatures and all original reads.
-- Optional proof selectors are accepted on the first slot only.
do $patch$
declare src text; old text; replacement text; signature text;
begin
 foreach signature in array array['public.get_makeup_reservation_context_v1(jsonb,uuid[])','public.get_makeup_approval_collision_context_v1(jsonb)'] loop
  src:=pg_get_functiondef(signature::regprocedure);
  old:='declare ';replacement:='declare legacy_ids jsonb; legacy_bindings jsonb; legacy_batch record; ';
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_public_declaration_drift';end if;
  src:=replace(src,old,replacement);
  old:=E'begin\n';
  replacement:=$new$begin
 if jsonb_typeof(p_slots)='array' then
  if exists(select 1 from jsonb_array_elements(p_slots) with ordinality q(s,i) where q.i>1 and q.s ? 'requestIds') then
   raise exception using errcode='22023',message='makeup_legacy_binding_request_invalid';end if;
  if p_slots->0 ? 'requestIds' then
   legacy_ids:=p_slots#>'{0,requestIds}';
   p_slots:=jsonb_set(p_slots,'{0}',(p_slots->0)-'requestIds',false);
   -- Validate proof selectors once without changing the original reservation
   -- query's wide-window contract. Historical/multiday slots need no proof.
   legacy_bindings:=dashboard_private.makeup_effective_class_context_v1(jsonb_build_object('kind','legacyAdoption','requestIds',legacy_ids,'slots','[]'::jsonb))->'legacyBindings';
    for legacy_batch in
     with windows as materialized(
      select q,public.makeup_numbered_source_instant_v1(q->>'startAt') a,public.makeup_numbered_source_instant_v1(q->>'endAt') b
      from jsonb_array_elements(p_slots) q where jsonb_typeof(q)='object'
     ), eligible as(
      select q,a,b,((a at time zone 'Asia/Seoul')::date-date '2000-01-03')/7 bucket
      from windows where a is not null and b is not null and a<b
       and b<=(((a at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul')
     ), numbered as(select *,row_number() over(partition by bucket order by a,b,q::text) ordinal from eligible)
     select jsonb_agg(jsonb_build_object('startAt',q->'startAt','endAt',q->'endAt')) slots
      from numbered group by bucket,(ordinal-1)/256
    loop
     legacy_bindings:=legacy_bindings||(dashboard_private.makeup_effective_class_context_v1(jsonb_build_object(
      'kind','legacyAdoption','requestIds',legacy_ids,'slots',legacy_batch.slots))->'legacyBindings');
    end loop;
   -- A request may occur in overlapping chunks. Identical evidence is one
   -- binding; contradictory evidence must never become a self-exclusion.
   select coalesce(jsonb_agg(proof order by request_id),'[]'::jsonb) into legacy_bindings
   from(select x->>'requestId' request_id,(jsonb_agg(x))->0 proof from jsonb_array_elements(legacy_bindings) x
    group by x->>'requestId' having count(distinct x)=1) unique_proofs;
  end if;
 end if;
$new$;
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_public_body_drift';end if;
  src:=replace(src,old,replacement);
  old:='return result;';replacement:='return result||case when legacy_bindings is not null then jsonb_build_object(''legacyBindings'',legacy_bindings) else ''{}''::jsonb end;';
  if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'makeup_adoption_public_return_drift';end if;
  execute replace(src,old,replacement);
 end loop;
end $patch$;
notify pgrst,'reload schema';
commit;
