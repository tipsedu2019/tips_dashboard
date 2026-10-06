begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function dashboard_private.resolve_legacy_effective_schedule_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare
 lesson jsonb:=coalesce(p->'session','{}'); d text:=coalesce(lesson->>'date',''); dt date;
 state text:=coalesce(nullif(lesson->>'scheduleState',''),nullif(lesson->>'state',''),'active');
 kind text:='unresolved'; vals jsonb:='{}'; provenance jsonb:='{}'; missing jsonb:='[]'; errors jsonb:='[]';
 allslots jsonb:=coalesce(p->'basicSlots','[]'); slots jsonb; basic_source text;
 sources jsonb; source jsonb; chosen jsonb; source_name text; source_error text;
 field text; name_field text; catalogs jsonb; candidate text; value text;
 n int; distinct_n int; common_value jsonb; has_choice boolean; request_owned boolean:=false; request_id text:=lesson->>'makeupRequestId'; prefix text;
begin
 if jsonb_typeof(p->'session') is distinct from 'object' then errors:=errors||'"invalid_session"'::jsonb;end if;
 if coalesce(nullif(lesson->>'id',''),nullif(lesson->>'sessionKey',''),'')='' or coalesce((p->>'identityCount')::int,1)<>1 then errors:=errors||'"ambiguous_identity"'::jsonb;end if;
 begin
  dt:=d::date;
  if d!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or dt::text<>d then raise exception 'invalid date';end if;
 exception when others then errors:=errors||'"invalid_date"'::jsonb;end;
 if state not in('active','makeup','exception','skipped','tbd') then errors:=errors||'"invalid_state"'::jsonb;end if;
 if errors<>'[]'::jsonb and not (errors='["invalid_date"]'::jsonb and lesson ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName']) then
  return jsonb_build_object('date',d,'state',state,'kind',kind,'values',vals,'provenance',provenance,'missing',missing,'errors',errors);
 end if;
 if errors='[]'::jsonb and state in('exception','skipped','tbd') then
  return jsonb_build_object('date',d,'state',state,'kind','cancelled','values',vals,'provenance',provenance,'missing',missing,'errors',errors);
 end if;
 if errors ? 'invalid_date' then allslots:='[]';dt:=null;end if;
 if lesson ? 'sourceSlotId' then
  select coalesce(jsonb_agg(s),'[]') into slots from jsonb_array_elements(allslots) s where coalesce(lesson->>'sourceSlotId','')<>'' and s->>'id'=lesson->>'sourceSlotId';
  basic_source:='basic_bound_slot';
 else
  select coalesce(jsonb_agg(s),'[]') into slots from jsonb_array_elements(allslots) s where (s->>'weekday')::int=extract(dow from dt)::int;
  basic_source:=case when slots='[]'::jsonb then 'basic_shared' else 'basic_weekday' end;
  if slots='[]'::jsonb then slots:=allslots;end if;
 end if;
 -- Preserve the planner's ordinary date-map replacement and request-lesson bypass.
 if request_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  prefix:='makeup-request:'||request_id||':';
  request_owned:=coalesce((lesson->>'makeupRequestRole'='cancel' and jsonb_typeof(coalesce(nullif(lesson->'id','""'::jsonb),lesson->'sessionKey'))='string')
   or (lesson->>'id'='makeup-cancel:'||request_id and lesson->>'sessionKey'=lesson->>'id')
   or (left(lesson->>'id',length(prefix))=prefix and substring(lesson->>'id' from length(prefix)+1)~'^[0-9]+$' and lesson->>'sessionKey'=lesson->>'id'),false);
 end if;
 if not request_owned and jsonb_typeof(p->'dateOverride')='object' then sources:=jsonb_build_array(jsonb_build_object('name','date_override','value',p->'dateOverride'));
 else sources:=jsonb_build_array(jsonb_build_object('name','session','value',lesson));end if;
 if jsonb_typeof(p->'approvedOverride')='object' then sources:=sources||jsonb_build_array(jsonb_build_object('name','approved_override','value',p->'approvedOverride'));end if;
 foreach field in array array['startTime','endTime','teacherCatalogId','classroomCatalogId'] loop
  name_field:=case field when 'teacherCatalogId' then 'teacherName' when 'classroomCatalogId' then 'classroomName' end;
  catalogs:=case field when 'teacherCatalogId' then coalesce(p#>'{catalogs,teachers}','[]') when 'classroomCatalogId' then coalesce(p#>'{catalogs,rooms}','[]') end;
  has_choice:=false; chosen:='{}';source_error:=null;source_name:=basic_source;value:=null;
  for source in select s from jsonb_array_elements(sources) s loop
   if (source->'value') ? field or (name_field is not null and (source->'value') ? name_field) then
    has_choice:=true; chosen:=source->'value';source_name:=source->>'name';
    if source_name='date_override' and coalesce((p->>'sessionCountOnDate')::int,1)<>1 then source_error:='ambiguous_date_override';end if;
    if source_name='approved_override' and (p->'approvedOverrideVerified') is distinct from 'true'::jsonb then source_error:='unverified_approved_override';end if;
    exit;
   end if;
  end loop;
  if not has_choice then
   select count(*),count(distinct coalesce(s->field,'null'::jsonb)),(jsonb_agg(coalesce(s->field,'null'::jsonb)))->0 into n,distinct_n,common_value from jsonb_array_elements(slots) s;
   if n>0 and distinct_n=1 then chosen:=jsonb_build_object(field,common_value);end if;
  end if;
  provenance:=provenance||jsonb_build_object(field,source_name);
  if source_error is not null then errors:=errors||to_jsonb(field||':'||source_error);
  elsif name_field is not null then
   if chosen ? field then
    candidate:=btrim(coalesce(chosen->>field,''));
    if candidate<>'' and (select count(*) from jsonb_array_elements(catalogs) c where c->>'id'=candidate)=1 then value:=candidate;end if;
   elsif chosen ? name_field then
    candidate:=btrim(coalesce(chosen->>name_field,''));
    select count(*),min(c->>'id') into n,value from jsonb_array_elements(catalogs) c where candidate<>'' and btrim(c->>'name')=candidate;
    if n<>1 or coalesce(value,'')='' then value:=null;end if;
   end if;
  else
   candidate:=btrim(coalesce(chosen->>field,''));
   if candidate~'^[0-9]{1,2}:[0-5][0-9](:00([.]0+)?)?$' then
    if split_part(candidate,':',1)::int<=23 or (field='endTime' and split_part(candidate,':',1)::int=24 and split_part(candidate,':',2)='00') then
     value:=lpad(split_part(candidate,':',1),2,'0')||':'||split_part(candidate,':',2);
    end if;
   end if;
  end if;
  vals:=vals||jsonb_build_object(field,value);
  if value is null then missing:=missing||to_jsonb(field);end if;
 end loop;
 if vals->>'startTime' is not null and vals->>'endTime' is not null and vals->>'startTime'>=vals->>'endTime' then errors:=errors||'"invalid_time_range"'::jsonb;end if;
 if missing='[]'::jsonb and errors='[]'::jsonb then kind:='resolved';end if;
 return jsonb_build_object('date',d,'state',state,'kind',kind,'values',vals,'provenance',provenance,'missing',missing,'errors',errors);
end $fn$;


-- Binding is based on stable schedule identity, never notes/progress/billing.
create function dashboard_private.legacy_effective_binding_v1(s jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $f$
 select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(case when jsonb_typeof(s)='object' then s else '{}' end) e(k,v)
 where k=any(array['id','date','scheduleState','state','originalDate','makeupDate','isForced','sourceSlotId','makeupRequestId','makeupRequestRole'])
$f$;

-- One class read builds defaults and approved source bindings once. No writes,
-- snapshot repair, historical audit scan, or client-provided verification flag.
create function dashboard_private.legacy_effective_context_v1(c public.classes,p_catalogs jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
 if catalogs is null then
  select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),
   'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(s->>'sourceSlotId',s->>'id'),'weekday',s->'weekday',
  'startTime',case when s->>'startMinute' is not null then lpad(((s->>'startMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'startMinute')::int%60)::text,2,'0') end,
  'endTime',case when s->>'endMinute' is not null then lpad(((s->>'endMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'endMinute')::int%60)::text,2,'0') end,
  'teacherCatalogId',s->'teacherId','classroomCatalogId',s->'classroomId')),'[]') into slots
 from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) s;
 -- Only after-snapshot makeup identities still present in this class can bind.
 -- Multiple matching requests/slots are retained as an unverified source.
 for candidate in
 with requests as materialized(
  select m.*,to_jsonb(m) request_json from public.makeup_requests m
  where m.class_id=c.id and jsonb_typeof(m.schedule_plan_after->'sessions')='array'
 ), linked as materialized(
  select m.*,v lesson,s slot,ord-1 slot_index,
   public.makeup_numbered_source_instant_v1(s->>'startAt') a,
   public.makeup_numbered_source_instant_v1(s->>'endAt') b
  from requests m cross join lateral jsonb_array_elements(m.schedule_plan_after->'sessions') v
  cross join lateral jsonb_array_elements(public.makeup_numbered_slots_v1(m.request_json)) with ordinality e(s,ord)
  where coalesce(v->>'scheduleState',v->>'state')='makeup'
   and nullif(v->>'id','') is not null
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]' end) current_row
    where dashboard_private.legacy_effective_binding_v1(current_row)=dashboard_private.legacy_effective_binding_v1(v))
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_before->'sessions')='array' then m.schedule_plan_before->'sessions' else '[]' end) previous_row
    where dashboard_private.legacy_effective_binding_v1(previous_row)=dashboard_private.legacy_effective_binding_v1(v))
 ), dated as materialized(
  select * from linked where lesson->>'date'=to_char(a at time zone 'Asia/Seoul','YYYY-MM-DD')
   and (lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text)
 )
 select d.*,tc.id verified_teacher_id,
  (select min(id::text) from public.classroom_catalogs where name=d.slot->>'classroom' having count(*)=1) room_id,
  (select e.payload from public.makeup_request_events e where e.request_id=d.id and e.event_type='approved' order by e.created_at desc,e.id desc limit 1) approval_payload,
  exists(select 1 from public.academic_events a cross join lateral (select dashboard_private.makeup_approval_event_meta_v1(a.note) meta) parsed
   where (a.id=d.makeup_academic_event_id or d.makeup_academic_event_ids ? a.id::text)
    and a.date::text=d.lesson->>'date' and meta->>'requestId'=d.id::text and meta->>'kind'='makeup'
    and meta->>'slotIndex'=d.slot_index::text and meta->>'classroom'=d.slot->>'classroom'
    and public.makeup_numbered_source_instant_v1(meta->>'startAt')=d.a
    and public.makeup_numbered_source_instant_v1(meta->>'endAt')=d.b) calendar_matches
 from dated d left join public.teacher_catalogs tc on tc.id=d.teacher_catalog_id
 loop
  source_id:=candidate.lesson->>'id';
  source:=jsonb_build_object('binding',dashboard_private.legacy_effective_binding_v1(candidate.lesson),
   'approvedOverride',jsonb_build_object('startTime',to_char(candidate.a at time zone 'Asia/Seoul','HH24:MI'),
    'endTime',case when (candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time then '24:00' else to_char(candidate.b at time zone 'Asia/Seoul','HH24:MI') end,'teacherCatalogId',candidate.teacher_catalog_id,'classroomCatalogId',candidate.room_id),
   'approvedOverrideVerified',coalesce(candidate.status in('completed','makeup_pending') and candidate.approved_at is not null
    and candidate.a<candidate.b and ((candidate.a at time zone 'Asia/Seoul')::date=(candidate.b at time zone 'Asia/Seoul')::date or ((candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time))
    and extract(second from candidate.a)=0 and extract(second from candidate.b)=0 and candidate.calendar_matches
    and candidate.approval_payload->>'makeup_request_id'=candidate.id::text
    and candidate.verified_teacher_id=candidate.teacher_catalog_id
    and nullif(btrim(candidate.approval_payload->>'teacher_name'),'') is not null
    and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b),false));
  if sources ? source_id then source:=jsonb_set(source,'{approvedOverrideVerified}','false');end if;
  sources:=sources||jsonb_build_object(source_id,source);
 end loop;
 return jsonb_build_object('version',1,'classId',c.id,'basicSlots',slots,'catalogs',catalogs,'approvedByIdentity',sources,'weekly',defaults);
end $f$;

create function dashboard_private.legacy_effective_input_v1(p_plan jsonb,p_session jsonb,p_context jsonb,p_identity_count int,p_date_count int)
returns jsonb language sql immutable security invoker set search_path='' as $f$
 select jsonb_build_object('session',p_session,'basicSlots',p_context->'basicSlots','catalogs',p_context->'catalogs',
  'identityCount',p_identity_count,'sessionCountOnDate',p_date_count)
 ||case when jsonb_typeof(p_plan#>array['sessionSchedules',p_session->>'date'])='object'
    then jsonb_build_object('dateOverride',p_plan#>array['sessionSchedules',p_session->>'date']) else '{}' end
 ||case when (p_context#>array['approvedByIdentity',p_session->>'id','binding'])=dashboard_private.legacy_effective_binding_v1(p_session)
    then (p_context#>array['approvedByIdentity',p_session->>'id'])-'binding' else '{}' end
$f$;

create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb; dated_hash text; default_bounds_complete boolean; default_weekdays integer[]; default_single_resource boolean; effective_context jsonb; effective_input jsonb; effective jsonb; catalogs jsonb;
begin
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 -- Aggregate once, preserving exact lesson.id ordering and full dated history.
 -- Repeated JSONB concatenation copied growing arrays quadratically.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'start',s.start_time,'end',s.end_time,'teacher',s.teacher_catalog_id,'room',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'startMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.start_time)::int/60 end,'endMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.end_time)::int/60 end,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sessionId',s.id,'occupancyFingerprint',md5(jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)::text)) order by s.id) filter(where s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or s.classroom_catalog_id is null or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0)),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb)
 into raw,blockers,dated
 from (select lesson.id,lesson.class_id,lesson.source_schedule_slot_id,lesson.session_date,lesson.schedule_state,lesson.start_time,lesson.end_time,lesson.revision,class_row.name,
       coalesce(lesson.teacher_catalog_id,(select min(id::text)::uuid from public.teacher_catalogs where name=btrim(lesson.teacher_name_snapshot) having count(*)=1)) teacher_catalog_id,
       coalesce(lesson.classroom_catalog_id,(select min(id::text)::uuid from public.classroom_catalogs where name=btrim(lesson.classroom_name_snapshot) having count(*)=1)) classroom_catalog_id
       from public.class_lesson_sessions lesson join public.classes class_row on class_row.id=lesson.class_id
       where class_row.schedule_storage_mode='normalized') s;
 for c in select * from public.classes where schedule_storage_mode<>'normalized' order by id loop
 if c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions')<>'array' then
 legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null));continue;end if;
 effective_context:=dashboard_private.legacy_effective_context_v1(c,catalogs);
 defaults:=effective_context->'weekly';
 -- These facts depend only on this class's freshly read weekly defaults.
 -- Compute them once per class, retaining every complete reader invocation.
 -- The unchanged weekly producer emits integer weekdays or missing weekdays.
 select not exists(select 1 from jsonb_array_elements(defaults->'unresolvedOccupancies') z
                   where z->>'weekday' is null or z->>'startMinute' is null or z->>'endMinute' is null),
        coalesce((select array_agg(distinct (z->>'weekday')::int)
                  from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) z
                  where z->>'weekday' is not null),'{}'::integer[]),
        (select count(distinct jsonb_build_array(z->'teacherId',z->'classroomId'))=1
                and bool_and(z->>'teacherId' is not null and z->>'classroomId' is not null)
         from jsonb_array_elements(defaults->'shadowSlots') z)
 into default_bounds_complete,default_weekdays,default_single_resource;
 -- Count legacy identities once per class; preserve the original COALESCE semantics.
 select coalesce(jsonb_object_agg(identity_key,n),'{}'::jsonb) into identity_counts
 from (select coalesce(x->>'id',x->>'sessionKey') identity_key,count(*) n
       from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) x
       where coalesce(x->>'id',x->>'sessionKey') is not null group by 1) counts;
 select coalesce(jsonb_object_agg(date_key,n),'{}'::jsonb) into date_counts
 from (select x->>'date' date_key,count(*) n from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) x where x->>'date' is not null group by 1) counts;
 for v in select value from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) loop
 -- Scalar legacy entries are diagnostic data, never JSON-object operations.
 -- Content-only fields remain absent from an object's occupancy fingerprint.
 occupancy:=case when jsonb_typeof(v)='object' then v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent','textbookEntries','progressStatus','sessionKey','session_key','billingId','billingLabel','billingColor','sessionNumber','state'] || jsonb_build_object('identity',coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')),'scheduleState',coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active')) else v end;
 state:=coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active');
 legacy_raw:=array_append(legacy_raw,jsonb_build_object('classId',c.id,'session',occupancy));
 -- Date knowledge is independent of time/resource validity and must survive it.
 dt:=null;
 begin dt:=(v->>'date')::date; if v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or dt::text is distinct from v->>'date' then dt:=null;end if;
 exception when invalid_datetime_format or datetime_field_overflow then dt:=null;
 end;
 a:=null;b:=null;tid:=null;rid:=null;
 -- Legacy exception means no lesson (unlike normalized exception overrides).
 -- Only a unique, dated producer row may suppress that date's weekly defaults.
 if jsonb_typeof(v)='object' and dt is not null and state in('exception','skipped','tbd')
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and coalesce((date_counts->>(v->>'date'))::bigint,0)=1 then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
   end loop;
   continue;
 end if;
 if jsonb_typeof(v)='object' and dt is not null and state='active'
    and coalesce(v->'isForced','false'::jsonb)='false'::jsonb and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
    and not (v ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])
    and not (v ? 'sourceSlotId')
    and jsonb_typeof(c.schedule_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'
    and not ((effective_context->'approvedByIdentity') ? coalesce(v->>'id',''))
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and default_bounds_complete
    and coalesce(extract(dow from dt)::int=any(default_weekdays),false) then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
   end loop;
   for regular in select value from jsonb_array_elements(defaults->'unresolvedOccupancies') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
   end loop;
   continue;
 end if;

 -- Every other legacy row follows the same per-field contract, on any date.
 -- Keep immutable raw plans and the established cancellation/weekly dedup.
 ident:=coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''));
 effective_input:=dashboard_private.legacy_effective_input_v1(c.schedule_plan,v,effective_context,
  coalesce((identity_counts->>ident)::int,0),coalesce((date_counts->>(v->>'date'))::int,0));
 effective:=dashboard_private.resolve_legacy_effective_schedule_v1(effective_input);
 if effective#>>'{values,startTime}' is not null then a:=extract(epoch from (effective#>>'{values,startTime}')::time)::int/60;end if;
 if effective#>>'{values,endTime}' is not null then b:=extract(epoch from (effective#>>'{values,endTime}')::time)::int/60;end if;
 if effective->'errors' ? 'invalid_time_range' then a:=null;b:=null;end if;
 tid:=(effective#>>'{values,teacherCatalogId}')::uuid;rid:=(effective#>>'{values,classroomCatalogId}')::uuid;
 if effective->>'kind'='resolved' and dt is not null then
  regular:=null;
  if state='active' and coalesce(v->'isForced','false'::jsonb)='false'::jsonb
   and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
   and coalesce((date_counts->>(v->>'date'))::int,0)=1 and defaults->'unresolvedOccupancies'='[]'::jsonb then
   if v ? 'sourceSlotId' then
    if (select count(*) from jsonb_array_elements(defaults->'shadowSlots') x where coalesce(x->>'sourceSlotId',x->>'id')=v->>'sourceSlotId')=1 then
     select x into regular from jsonb_array_elements(defaults->'shadowSlots') x where coalesce(x->>'sourceSlotId',x->>'id')=v->>'sourceSlotId';
    end if;
   elsif (select count(*) from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int)=1 then
    select x into regular from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int;
   end if;
  end if;
  legacy_dated:=array_append(legacy_dated,jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,
   'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0)
   ||case when regular is not null then jsonb_build_object('overriddenWeeklySlotId',regular->>'id') else '{}'::jsonb end);
 else
  -- A cancelled row reaches here only if its identity/date cannot safely own
  -- a weekly tombstone. It stays diagnostic instead of silently deleting slots.
  legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read',
   'date',dt,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,
   'occupancyFingerprint',md5(jsonb_build_array(occupancy,effective_input->'dateOverride',effective->'values',effective->'errors')::text)));
 end if;
 end loop;
 end loop;
 -- PL/pgSQL expanded arrays append without repeatedly copying the JSONB history.
 -- Materialize each legacy array once, after the normalized rows, in original order.
 raw:=raw||to_jsonb(legacy_raw);
 dated:=dated||to_jsonb(legacy_dated);
 blockers:=blockers||to_jsonb(legacy_blockers);
 dated_hash:=md5((dated||blockers||raw)::text);
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',dated_hash,'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||dated_hash));
end $f$;


-- Canonical dates only; malformed dates remain conservative global blockers.
create function dashboard_private.makeup_effective_date_key_v1(p text)
returns date language plpgsql immutable security invoker set search_path='' as $f$
declare d date;
begin
 if p is null or p!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 begin d:=p::date;exception when invalid_datetime_format or datetime_field_overflow then return null;end;
 if d::text is distinct from p then return null;end if;
 return d;
end $f$;

create function dashboard_private.legacy_effective_context_for_dates_v1(c public.classes,p_catalogs jsonb,p_date_from date,p_date_to date)
returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
 if catalogs is null then
  select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),
   'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(s->>'sourceSlotId',s->>'id'),'weekday',s->'weekday',
  'startTime',case when s->>'startMinute' is not null then lpad(((s->>'startMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'startMinute')::int%60)::text,2,'0') end,
  'endTime',case when s->>'endMinute' is not null then lpad(((s->>'endMinute')::int/60)::text,2,'0')||':'||lpad(((s->>'endMinute')::int%60)::text,2,'0') end,
  'teacherCatalogId',s->'teacherId','classroomCatalogId',s->'classroomId')),'[]') into slots
 from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) s;
 -- Only after-snapshot makeup identities still present in this class can bind.
 -- Multiple matching requests/slots are retained as an unverified source.
 for candidate in
 -- Filter eligible bindings before materializing anything from request history.
 -- Neither full before/after snapshots nor private request fields enter the CTE.
 with selected as materialized(
  select m.id,m.status,m.approved_at,m.teacher_catalog_id,m.makeup_academic_event_id,m.makeup_academic_event_ids,
   dashboard_private.legacy_effective_binding_v1(v) lesson,
   jsonb_build_object('makeup_slots',m.makeup_slots,'makeup_start_at',m.makeup_start_at,
    'makeup_end_at',m.makeup_end_at,'makeup_classroom',m.makeup_classroom) request_json
  from public.makeup_requests m cross join lateral jsonb_array_elements(
   case when jsonb_typeof(m.schedule_plan_after->'sessions')='array' then m.schedule_plan_after->'sessions' else '[]' end) v
  where m.class_id=c.id
   and dashboard_private.makeup_effective_date_key_v1(v->>'date') between p_date_from and p_date_to
   and coalesce(v->>'scheduleState',v->>'state')='makeup' and nullif(v->>'id','') is not null
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]' end) current_row
    where dashboard_private.legacy_effective_binding_v1(current_row)=dashboard_private.legacy_effective_binding_v1(v))
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_before->'sessions')='array' then m.schedule_plan_before->'sessions' else '[]' end) previous_row
    where dashboard_private.legacy_effective_binding_v1(previous_row)=dashboard_private.legacy_effective_binding_v1(v))
 ), linked as materialized(
  select m.*,s slot,ord-1 slot_index,
   public.makeup_numbered_source_instant_v1(s->>'startAt') a,
   public.makeup_numbered_source_instant_v1(s->>'endAt') b
  from selected m
  cross join lateral jsonb_array_elements(public.makeup_numbered_slots_v1(m.request_json)) with ordinality e(s,ord)
 ), dated as materialized(
  select * from linked where lesson->>'date'=to_char(a at time zone 'Asia/Seoul','YYYY-MM-DD')
   and (lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text)
 )
 select d.*,tc.id verified_teacher_id,
  (select min(id::text) from public.classroom_catalogs where name=d.slot->>'classroom' having count(*)=1) room_id,
  (select e.payload from public.makeup_request_events e where e.request_id=d.id and e.event_type='approved' order by e.created_at desc,e.id desc limit 1) approval_payload,
  exists(select 1 from public.academic_events a cross join lateral (select dashboard_private.makeup_approval_event_meta_v1(a.note) meta) parsed
   where (a.id=d.makeup_academic_event_id or d.makeup_academic_event_ids ? a.id::text)
    and a.date::text=d.lesson->>'date' and meta->>'requestId'=d.id::text and meta->>'kind'='makeup'
    and meta->>'slotIndex'=d.slot_index::text and meta->>'classroom'=d.slot->>'classroom'
    and public.makeup_numbered_source_instant_v1(meta->>'startAt')=d.a
    and public.makeup_numbered_source_instant_v1(meta->>'endAt')=d.b) calendar_matches
 from dated d left join public.teacher_catalogs tc on tc.id=d.teacher_catalog_id
 loop
  source_id:=candidate.lesson->>'id';
  source:=jsonb_build_object('binding',dashboard_private.legacy_effective_binding_v1(candidate.lesson),
   'approvedOverride',jsonb_build_object('startTime',to_char(candidate.a at time zone 'Asia/Seoul','HH24:MI'),
    'endTime',case when (candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time then '24:00' else to_char(candidate.b at time zone 'Asia/Seoul','HH24:MI') end,'teacherCatalogId',candidate.teacher_catalog_id,'classroomCatalogId',candidate.room_id),
   'approvedOverrideVerified',coalesce(candidate.status in('completed','makeup_pending') and candidate.approved_at is not null
    and candidate.a<candidate.b and ((candidate.a at time zone 'Asia/Seoul')::date=(candidate.b at time zone 'Asia/Seoul')::date or ((candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time))
    and extract(second from candidate.a)=0 and extract(second from candidate.b)=0 and candidate.calendar_matches
    and candidate.approval_payload->>'makeup_request_id'=candidate.id::text
    and candidate.verified_teacher_id=candidate.teacher_catalog_id
    and nullif(btrim(candidate.approval_payload->>'teacher_name'),'') is not null
    and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b),false));
  if sources ? source_id then source:=jsonb_set(source,'{approvedOverrideVerified}','false');end if;
  sources:=sources||jsonb_build_object(source_id,source);
 end loop;
 return jsonb_build_object('version',1,'classId',c.id,'basicSlots',slots,'catalogs',catalogs,'approvedByIdentity',sources,'weekly',defaults);
end $f$;
create function dashboard_private.read_makeup_operating_reference_v1(p_date_from date,p_date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb; dated_hash text; default_bounds_complete boolean; default_weekdays integer[]; default_single_resource boolean; effective_context jsonb; effective_input jsonb; effective jsonb; catalogs jsonb;
begin
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>13 then
  raise exception using errcode='22023',message='makeup_effective_window_invalid';
 end if;
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 -- Filter normalized source dates before aggregation or resource resolution.
 -- Repeated JSONB concatenation copied growing arrays quadratically.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'start',s.start_time,'end',s.end_time,'teacher',s.teacher_catalog_id,'room',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'startMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.start_time)::int/60 end,'endMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.end_time)::int/60 end,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sessionId',s.id,'occupancyFingerprint',md5(jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)::text)) order by s.id) filter(where s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or s.classroom_catalog_id is null or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0)),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb)
 into raw,blockers,dated
 from (select lesson.id,lesson.class_id,lesson.source_schedule_slot_id,lesson.session_date,lesson.schedule_state,lesson.start_time,lesson.end_time,lesson.revision,class_row.name,
       coalesce(lesson.teacher_catalog_id,(select min(id::text)::uuid from public.teacher_catalogs where name=btrim(lesson.teacher_name_snapshot) having count(*)=1)) teacher_catalog_id,
       coalesce(lesson.classroom_catalog_id,(select min(id::text)::uuid from public.classroom_catalogs where name=btrim(lesson.classroom_name_snapshot) having count(*)=1)) classroom_catalog_id
       from public.class_lesson_sessions lesson join public.classes class_row on class_row.id=lesson.class_id
       where class_row.schedule_storage_mode='normalized' and lesson.session_date between p_date_from and p_date_to) s;
 for c in select * from public.classes where schedule_storage_mode<>'normalized' order by id loop
 if c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions')<>'array' then
 legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null));continue;end if;
 effective_context:=dashboard_private.legacy_effective_context_for_dates_v1(c,catalogs,p_date_from,p_date_to);
 defaults:=effective_context->'weekly';
 -- These facts depend only on this class's freshly read weekly defaults.
 -- Compute them once per class, retaining every complete reader invocation.
 -- The unchanged weekly producer emits integer weekdays or missing weekdays.
 select not exists(select 1 from jsonb_array_elements(defaults->'unresolvedOccupancies') z
                   where z->>'weekday' is null or z->>'startMinute' is null or z->>'endMinute' is null),
        coalesce((select array_agg(distinct (z->>'weekday')::int)
                  from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) z
                  where z->>'weekday' is not null),'{}'::integer[]),
        (select count(distinct jsonb_build_array(z->'teacherId',z->'classroomId'))=1
                and bool_and(z->>'teacherId' is not null and z->>'classroomId' is not null)
         from jsonb_array_elements(defaults->'shadowSlots') z)
 into default_bounds_complete,default_weekdays,default_single_resource;
 -- Count legacy identities once per class; preserve the original COALESCE semantics.
 select coalesce(jsonb_object_agg(identity_key,n),'{}'::jsonb) into identity_counts
 from (select coalesce(x->>'id',x->>'sessionKey') identity_key,count(*) n
       from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) x
       where coalesce(x->>'id',x->>'sessionKey') is not null group by 1) counts;
 select coalesce(jsonb_object_agg(date_key,n),'{}'::jsonb) into date_counts
 from (select x->>'date' date_key,count(*) n from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) x where x->>'date' is not null group by 1) counts;
 -- Count across the complete plan above, but resolve only selected/unknown dates.
 -- Keep every row on those dates: even an out-of-time override can suppress basics.
 for v in select value from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]'))
 where dashboard_private.makeup_effective_date_key_v1(value->>'date') is null
  or dashboard_private.makeup_effective_date_key_v1(value->>'date') between p_date_from and p_date_to loop
 -- Scalar legacy entries are diagnostic data, never JSON-object operations.
 -- Content-only fields remain absent from an object's occupancy fingerprint.
 occupancy:=case when jsonb_typeof(v)='object' then v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent','textbookEntries','progressStatus','sessionKey','session_key','billingId','billingLabel','billingColor','sessionNumber','state'] || jsonb_build_object('identity',coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')),'scheduleState',coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active')) else v end;
 state:=coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active');
 legacy_raw:=array_append(legacy_raw,jsonb_build_object('classId',c.id,'session',occupancy));
 -- Date knowledge is independent of time/resource validity and must survive it.
 dt:=null;
 begin dt:=(v->>'date')::date; if v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or dt::text is distinct from v->>'date' then dt:=null;end if;
 exception when invalid_datetime_format or datetime_field_overflow then dt:=null;
 end;
 a:=null;b:=null;tid:=null;rid:=null;
 -- Legacy exception means no lesson (unlike normalized exception overrides).
 -- Only a unique, dated producer row may suppress that date's weekly defaults.
 if jsonb_typeof(v)='object' and dt is not null and state in('exception','skipped','tbd')
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and coalesce((date_counts->>(v->>'date'))::bigint,0)=1 then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
   end loop;
   continue;
 end if;
 if jsonb_typeof(v)='object' and dt is not null and state='active'
    and coalesce(v->'isForced','false'::jsonb)='false'::jsonb and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
    and not (v ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])
    and not (v ? 'sourceSlotId')
    and jsonb_typeof(c.schedule_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'
    and not ((effective_context->'approvedByIdentity') ? coalesce(v->>'id',''))
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and default_bounds_complete
    and coalesce(extract(dow from dt)::int=any(default_weekdays),false) then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
   end loop;
   for regular in select value from jsonb_array_elements(defaults->'unresolvedOccupancies') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
   end loop;
   continue;
 end if;

 -- Every other legacy row follows the same per-field contract, on any date.
 -- Keep immutable raw plans and the established cancellation/weekly dedup.
 ident:=coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''));
 effective_input:=dashboard_private.legacy_effective_input_v1(c.schedule_plan,v,effective_context,
  coalesce((identity_counts->>ident)::int,0),coalesce((date_counts->>(v->>'date'))::int,0));
 effective:=dashboard_private.resolve_legacy_effective_schedule_v1(effective_input);
 if effective#>>'{values,startTime}' is not null then a:=extract(epoch from (effective#>>'{values,startTime}')::time)::int/60;end if;
 if effective#>>'{values,endTime}' is not null then b:=extract(epoch from (effective#>>'{values,endTime}')::time)::int/60;end if;
 if effective->'errors' ? 'invalid_time_range' then a:=null;b:=null;end if;
 tid:=(effective#>>'{values,teacherCatalogId}')::uuid;rid:=(effective#>>'{values,classroomCatalogId}')::uuid;
 if effective->>'kind'='resolved' and dt is not null then
  regular:=null;
  if state='active' and coalesce(v->'isForced','false'::jsonb)='false'::jsonb
   and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
   and coalesce((date_counts->>(v->>'date'))::int,0)=1 and defaults->'unresolvedOccupancies'='[]'::jsonb then
   if v ? 'sourceSlotId' then
    if (select count(*) from jsonb_array_elements(defaults->'shadowSlots') x where coalesce(x->>'sourceSlotId',x->>'id')=v->>'sourceSlotId')=1 then
     select x into regular from jsonb_array_elements(defaults->'shadowSlots') x where coalesce(x->>'sourceSlotId',x->>'id')=v->>'sourceSlotId';
    end if;
   elsif (select count(*) from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int)=1 then
    select x into regular from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int;
   end if;
  end if;
  legacy_dated:=array_append(legacy_dated,jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,
   'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0)
   ||case when regular is not null then jsonb_build_object('overriddenWeeklySlotId',regular->>'id') else '{}'::jsonb end);
 else
  -- A cancelled row reaches here only if its identity/date cannot safely own
  -- a weekly tombstone. It stays diagnostic instead of silently deleting slots.
  legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read',
   'date',dt,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,
   'occupancyFingerprint',md5(jsonb_build_array(occupancy,effective_input->'dateOverride',effective->'values',effective->'errors')::text)));
 end if;
 end loop;
 end loop;
 -- PL/pgSQL expanded arrays append without repeatedly copying the JSONB history.
 -- Materialize each legacy array once, after the normalized rows, in original order.
 raw:=raw||to_jsonb(legacy_raw);
 dated:=dated||to_jsonb(legacy_dated);
 blockers:=blockers||to_jsonb(legacy_blockers);
 dated_hash:=md5((dated||blockers||raw)::text);
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',dated_hash,'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||dated_hash));
end $f$;


create or replace function public.get_class_schedule_v1(p_class_id uuid, p_date_from date, p_date_to date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_class public.classes%rowtype; v_plan jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  select * into v_class from public.classes where id = p_class_id;
  if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 or v_class.schedule_storage_mode <> 'normalized' then
    return jsonb_build_object('authoritativeSource', 'legacy', 'runtimeVersion', public.continuous_class_schedule_runtime_version(), 'storageMode', v_class.schedule_storage_mode,
      'effectiveScheduleContext',case when v_class.schedule_storage_mode<>'normalized' then dashboard_private.legacy_effective_context_v1(v_class)-'weekly' end);
  end if;
  select schedule_plan into v_plan from public.classes where id = p_class_id;
  return jsonb_build_object(
    'authoritativeSource', 'normalized', 'runtimeVersion', 1, 'storageMode', v_class.schedule_storage_mode,
    'scheduleRevision', v_class.schedule_revision,
    'contentHash', dashboard_private.continuous_class_schedule_content_hash_v1(v_plan),
    'hasMoreBefore', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date < p_date_from),
    'hasMoreAfter', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date > p_date_to),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by session_date, start_time nulls last, session_key)
      from public.class_lesson_sessions s where class_id = p_class_id and session_date between p_date_from and p_date_to), '[]'::jsonb)
  );
end;
$$;



-- Date-scoped class occupancy only. This preserves all-authenticated occupancy
-- access while private source snapshots/payloads stay out of the nine-key DTO.
create function dashboard_private.makeup_effective_class_context_v1(p_slots jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare reference jsonb; result jsonb; slot_input jsonb; slot_start timestamptz; slot_end timestamptz; slot_date date; first_date date; last_date date; seen date[]:='{}'; role_name text:=current_setting('role',true);
begin
 if role_name is distinct from 'service_role' and auth.uid() is null then
  raise exception using errcode='42501',message='makeup_auth_required';
 end if;
 -- Bound the read batch, not the number of lessons in a business request.
 if jsonb_typeof(p_slots) is distinct from 'array' then raise exception using errcode='22023',message='makeup_effective_window_invalid';end if;
 if jsonb_array_length(p_slots)>14 then raise exception using errcode='22023',message='makeup_effective_window_invalid';end if;
 if jsonb_array_length(p_slots)=0 then return jsonb_build_object('version',1,'occupancies','[]'::jsonb);end if;
 for slot_input in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(slot_input) is distinct from 'object' then raise exception using errcode='22023',message='makeup_effective_window_invalid';end if;
  if not (slot_input ?& array['startAt','endAt']) or slot_input-array['startAt','endAt']<>'{}'::jsonb
   or jsonb_typeof(slot_input->'startAt') is distinct from 'string' or jsonb_typeof(slot_input->'endAt') is distinct from 'string'
   or length(slot_input->>'startAt')<>24 or length(slot_input->>'endAt')<>24 then
   raise exception using errcode='22023',message='makeup_effective_window_invalid';
  end if;
  slot_start:=public.makeup_numbered_source_instant_v1(slot_input->>'startAt');slot_end:=public.makeup_numbered_source_instant_v1(slot_input->>'endAt');
  if slot_start is null or slot_end is null or slot_start>=slot_end
   or to_char(slot_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') is distinct from slot_input->>'startAt'
   or to_char(slot_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') is distinct from slot_input->>'endAt' then
   raise exception using errcode='22023',message='makeup_effective_window_invalid';
  end if;
  slot_date:=(slot_start at time zone 'Asia/Seoul')::date;
  if slot_end>((slot_date+1)::timestamp at time zone 'Asia/Seoul') or slot_date=any(seen) then
   raise exception using errcode='22023',message='makeup_effective_window_invalid';
  end if;
  seen:=array_append(seen,slot_date);first_date:=least(first_date,slot_date);last_date:=greatest(last_date,slot_date);
 end loop;
 if last_date-first_date>13 then raise exception using errcode='22023',message='makeup_effective_window_invalid';end if;
 reference:=dashboard_private.read_makeup_operating_reference_v1(first_date,last_date);
 with target as materialized(select public.makeup_numbered_source_instant_v1(s->>'startAt') a,public.makeup_numbered_source_instant_v1(s->>'endAt') b from jsonb_array_elements(p_slots) s),
 dates as (select distinct (a at time zone 'Asia/Seoul')::date d from target),
 occupied as (
  select d,x,false unknown from dates cross join lateral dashboard_private.timetable_effective_date_v1(reference,d) x
  union all
  select d,x,true from dates cross join lateral jsonb_array_elements((reference->'unresolvedOccupancies')||(reference->'datedUnresolvedOccupancies')) x
   where (x->>'date' is null or x->>'date'=d::text) and (x->>'weekday' is null or (x->>'weekday')::int=extract(dow from d)::int)
 ), matched as (
 select jsonb_build_object('id',coalesce(x->>'id',x->>'occupancyFingerprint'),'classId',x->>'classId','className',c.name,
  'date',d,'startMinute',x->'startMinute','endMinute',x->'endMinute','classroom',room.name,
  'uncertain',unknown,'allRooms',unknown and (x->>'teacherId' is null or x->>'classroomId' is null)) value
 from occupied o join public.classes c on c.id::text=x->>'classId'
 left join public.classroom_catalogs room on room.id::text=x->>'classroomId'
 where exists(select 1 from target t
  where (t.a at time zone 'Asia/Seoul')::date=o.d
   and (x->>'startMinute' is null or x->>'endMinute' is null or
    (extract(epoch from (t.a at time zone 'Asia/Seoul')-o.d::timestamp)/60<(x->>'endMinute')::int
    and (x->>'startMinute')::int<extract(epoch from (t.b at time zone 'Asia/Seoul')-o.d::timestamp)/60)))
 -- The sentinel counts final overlapping DTO rows, never raw source candidates.
 order by d,c.id,x->>'id',x->>'occupancyFingerprint' limit 2001
 ) select coalesce(jsonb_agg(value),'[]') into result from matched;
 if jsonb_array_length(result)>2000 then raise exception using errcode='22023',message='makeup_effective_capacity_exceeded';end if;
 return jsonb_build_object('version',1,'occupancies',result);
end $f$;
revoke all on function dashboard_private.makeup_effective_class_context_v1(jsonb) from public,anon;
grant execute on function dashboard_private.makeup_effective_class_context_v1(jsonb) to authenticated,service_role;

-- Keep request/event membership reads independent of sequential occupancy batches.
create function public.get_makeup_effective_occupancy_v1(p_slots jsonb)
returns jsonb language sql stable security invoker set search_path='' as $f$
 select dashboard_private.makeup_effective_class_context_v1(p_slots)
$f$;
revoke all on function public.get_makeup_effective_occupancy_v1(jsonb) from public,anon;
grant execute on function public.get_makeup_effective_occupancy_v1(jsonb) to authenticated,service_role;

create or replace function public.get_makeup_approval_collision_context_v1(p_slots jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_slots) is distinct from 'array' then
   raise exception using errcode='22023',message='makeup_reservation_request_invalid';
 end if;
 if exists(select 1 from jsonb_array_elements(p_slots) s where jsonb_typeof(s) is distinct from 'object'
   or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string') then
   raise exception using errcode='22023',message='makeup_reservation_request_invalid';
 end if;
 with targets as materialized (
   select public.makeup_numbered_source_instant_v1(s->>'startAt') start_at,
          public.makeup_numbered_source_instant_v1(s->>'endAt') end_at
   from jsonb_array_elements(p_slots) s
 ), reservations as materialized (
   select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots
   from public.makeup_requests where status in('approval_pending','manager_pending','makeup_pending','completed')
 ), events as materialized (
   select id,title,note,dashboard_private.makeup_approval_event_meta_v1(note) meta
   from public.academic_events where strpos(note,'[[TIPS_MAKEUP]]')>0
 ) select jsonb_build_object(
   'classes',coalesce((select jsonb_agg(to_jsonb(c) order by id) from (
     select id,name,subject,grade,teacher,room,schedule from public.classes c
     -- Every regular collision requires a literal Korean weekday in schedule.
     -- Do not reinterpret legacy room overrides or impose newer validation.
     where exists(select 1 from targets t where t.start_at is null or t.end_at is null
       or strpos(c.schedule,substr('일월화수목금토',extract(dow from t.start_at at time zone 'Asia/Seoul')::integer+1,1))>0)
   ) c),'[]'::jsonb),
   'requests',coalesce((select jsonb_agg(to_jsonb(r) order by id) from reservations r
     where exists(select 1 from targets t where t.start_at is null or t.end_at is null
       or public.makeup_numbered_legacy_slots_v1(to_jsonb(r))
       or exists(select 1 from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(r))) s
         where public.makeup_numbered_source_instant_v1(s->>'startAt') is null
           or public.makeup_numbered_source_instant_v1(s->>'endAt') is null
           or (public.makeup_numbered_source_instant_v1(s->>'startAt')<t.end_at
             and t.start_at<public.makeup_numbered_source_instant_v1(s->>'endAt'))))),'[]'::jsonb),
   'academicEvents',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'note',e.note) order by e.id)
     from events e where e.meta->>'kind'='makeup' and exists(select 1 from targets t
       where t.start_at is null or t.end_at is null
         or public.makeup_numbered_source_instant_v1(e.meta->>'startAt') is null
         or public.makeup_numbered_source_instant_v1(e.meta->>'endAt') is null
         or (public.makeup_numbered_source_instant_v1(e.meta->>'startAt')<t.end_at
           and t.start_at<public.makeup_numbered_source_instant_v1(e.meta->>'endAt')))),'[]'::jsonb)
 ) into result;
 return result;
end $$;

create or replace function public.get_makeup_reservation_context_v1(p_slots jsonb,p_event_request_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare s jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or p_event_request_ids is null or array_position(p_event_request_ids,null) is not null then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string' or public.makeup_numbered_instant_v1(s->>'startAt') is null or public.makeup_numbered_instant_v1(s->>'endAt') is null or public.makeup_numbered_instant_v1(s->>'startAt')>=public.makeup_numbered_instant_v1(s->>'endAt') then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 end loop;
 with active as materialized (
  select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots from public.makeup_requests where status in('approval_pending','manager_pending','makeup_pending','completed')
 ), overlapping as (
  select a.* from active a where (jsonb_array_length(p_slots)>0 and public.makeup_numbered_legacy_slots_v1(to_jsonb(a))) or exists(select 1 from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(a)))r cross join jsonb_array_elements(p_slots)t
   where public.makeup_numbered_source_instant_v1(r->>'startAt') is null or public.makeup_numbered_source_instant_v1(r->>'endAt') is null
    or (public.makeup_numbered_source_instant_v1(r->>'startAt')<public.makeup_numbered_instant_v1(t->>'endAt') and public.makeup_numbered_instant_v1(t->>'startAt')<public.makeup_numbered_source_instant_v1(r->>'endAt')))
 ) select jsonb_build_object('reservations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'className',public.makeup_numbered_trim_v1(class_name),'makeupStartAt',coalesce(to_jsonb(makeup_start_at)#>>'{}',''),'makeupEndAt',coalesce(to_jsonb(makeup_end_at)#>>'{}',''),'makeupClassroom',public.makeup_numbered_trim_v1(makeup_classroom),'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(o)))||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(o)) then jsonb_build_object('rawMakeupSlots',makeup_slots) else '{}'::jsonb end order by id) from overlapping o),'[]'),
  'activeEventRequestIds',coalesce((select jsonb_agg(id order by id) from active where id=any(p_event_request_ids)),'[]')) into result;
 return result;
end $$;

revoke all on function dashboard_private.resolve_legacy_effective_schedule_v1(jsonb),dashboard_private.legacy_effective_binding_v1(jsonb),dashboard_private.legacy_effective_context_v1(public.classes,jsonb),dashboard_private.legacy_effective_input_v1(jsonb,jsonb,jsonb,int,int) from public,anon,authenticated,service_role;
revoke all on function dashboard_private.makeup_effective_date_key_v1(text),dashboard_private.legacy_effective_context_for_dates_v1(public.classes,jsonb,date,date),dashboard_private.read_makeup_operating_reference_v1(date,date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
