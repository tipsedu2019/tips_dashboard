begin;
set local lock_timeout='5s';
set local statement_timeout='8s';

-- Unassigned rooms are optional occupancy resources. Known teachers, timing,
-- identity, malformed catalog input and the existing writer guards are retained.
-- CREATE OR REPLACE preserves each existing signature, owner and private ACL.

-- Baseline: 20260927071716_timetable_scoped_occupancy.sql (read_timetable_class_weekly_v2)
create or replace function dashboard_private.read_timetable_class_weekly_v2(c public.classes)
returns jsonb language plpgsql stable set search_path='' as $f$
declare s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; count_parts int; invalid boolean; raw_state jsonb:='[]'; room_unassigned boolean;
begin
 count_parts:=0; invalid:=false;
 if c.schedule_storage_mode='normalized' then
 for s in select * from public.class_schedule_slots where class_id=c.id order by id loop
 count_parts:=count_parts+1;
 raw_state:=raw_state||jsonb_build_object('normalizedSlot',to_jsonb(s));
 tid:=s.teacher_catalog_id; rid:=s.classroom_catalog_id;
 if tid is null then select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(s.teacher_name) having count(*)=1;end if;
 if rid is null then select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(s.classroom_name) having count(*)=1;end if;
 room_unassigned:=s.classroom_catalog_id is null and btrim(coalesce(s.classroom_name,'')) in('','미정','강의실 미정')
  and not exists(select 1 from public.classroom_catalogs where name=btrim(s.classroom_name));
 if extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0 then invalid:=true; continue; end if;
 if tid is null or (rid is null and not room_unassigned) then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','unresolved_resource','weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',tid,'classroomId',rid,'classroomUnresolved',rid is null and not room_unassigned,'occupancyFingerprint',md5(jsonb_build_array(s.id,s.weekday,s.start_time,s.end_time,tid,rid,s.teacher_name,s.classroom_name)::text)));
 continue;end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||s.id::text,'sourceSlotId',s.id,'classId',c.id,'weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 elsif nullif(btrim(c.schedule),'') is not null then
 -- Strict complete tokens only. Multi-resource legacy strings remain blocked
 -- unless each whole schedule line can resolve its exact catalog labels.
 for piece in select btrim(x) from regexp_split_to_table(coalesce(c.schedule,''), E'[\\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x loop
 parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]*),[[:space:]]*([^()]*)[)])?$');
 if parts is null then invalid:=true; continue; end if;
 select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(coalesce(parts[5],c.teacher)) having count(*)=1;
 select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(coalesce(parts[6],c.room)) having count(*)=1;
 room_unassigned:=btrim(coalesce(parts[6],c.room,'')) in('','미정','강의실 미정')
  and not exists(select 1 from public.classroom_catalogs where name=btrim(coalesce(parts[6],c.room)));
 startm:=split_part(parts[2],':',1)::int*60+split_part(parts[2],':',2)::int;
 endm:=split_part(parts[3],':',1)::int*60+split_part(parts[3],':',2)::int;
 if split_part(parts[2],':',2)::int>59 or split_part(parts[3],':',2)::int>59 or startm<0 or startm>=endm or endm>1440 then invalid:=true;continue;end if;
 days:=regexp_replace(parts[1],'[ /,]','','g');
 for d in select regexp_split_to_table(days,'') loop
 count_parts:=count_parts+1;
 sid:=md5(c.id::text||':'||piece||':'||d)::uuid;
 if tid is null or (rid is null and not room_unassigned) then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','unresolved_resource','weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'classroomUnresolved',rid is null and not room_unassigned,'occupancyFingerprint',md5(jsonb_build_array(sid,tid,rid)::text)));
 continue;end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||sid::text,'sourceSlotId',null,'classId',c.id,'weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 end loop;
 end if;
 -- No weekly rows means unplaced, not an unknown reservation of every room.
 if invalid then blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','occupancyFingerprint',md5((jsonb_build_object('id',c.id,'status',c.status,'schedule_storage_mode',c.schedule_storage_mode,'schedule',c.schedule,'teacher',c.teacher,'room',c.room)||jsonb_build_object('slots',(select coalesce(jsonb_agg(jsonb_build_array(z.id,z.weekday,z.start_time,z.end_time,z.teacher_catalog_id,z.classroom_catalog_id) order by z.id),'[]') from public.class_schedule_slots z where z.class_id=c.id)))::text))); end if;
 return jsonb_build_object('shadowSlots',slots,'unresolvedOccupancies',blockers,'source',raw_state);
end $f$;

-- Baseline: 20261004160000_legacy_effective_schedule_inheritance.sql (resolve_legacy_effective_schedule_v1)
create or replace function dashboard_private.resolve_legacy_effective_schedule_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare
 lesson jsonb:=coalesce(p->'session','{}'); d text:=coalesce(lesson->>'date',''); dt date;
 state text:=coalesce(nullif(lesson->>'scheduleState',''),nullif(lesson->>'state',''),'active');
 kind text:='unresolved'; vals jsonb:='{}'; provenance jsonb:='{}'; missing jsonb:='[]'; errors jsonb:='[]';
 allslots jsonb:=coalesce(p->'basicSlots','[]'); slots jsonb; basic_source text;
 sources jsonb; source jsonb; chosen jsonb; source_name text; source_error text;
 field text; name_field text; catalogs jsonb; candidate text; value text;
 n int; distinct_n int; common_value jsonb; has_choice boolean; request_owned boolean:=false; request_id text:=lesson->>'makeupRequestId'; prefix text; unassigned_room boolean;
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
    if source_error is null and field='classroomCatalogId' and chosen->'classroomUnresolved'='true'::jsonb then source_error:='invalid_resource';end if;
    exit;
   end if;
  end loop;
  if not has_choice then
   select count(*),count(distinct coalesce(s->field,'null'::jsonb)),(jsonb_agg(coalesce(s->field,'null'::jsonb)))->0 into n,distinct_n,common_value from jsonb_array_elements(slots) s;
   if n>0 and distinct_n=1 then chosen:=jsonb_build_object(field,common_value);end if;
   if field='classroomCatalogId' then
    if exists(select 1 from jsonb_array_elements(slots) s where s->'classroomUnresolved'='true'::jsonb) then source_error:='invalid_resource';
    elsif n>0 and distinct_n>1 then source_error:='ambiguous_basic_resource';end if;
   end if;
  end if;
  provenance:=provenance||jsonb_build_object(field,source_name);
  unassigned_room:=field='classroomCatalogId' and source_error is null;
  if source_error is not null then errors:=errors||to_jsonb(field||':'||source_error);
  elsif name_field is not null then
   if chosen ? field then
    candidate:=btrim(coalesce(chosen->>field,''));
    if candidate<>'' and (select count(*) from jsonb_array_elements(catalogs) c where c->>'id'=candidate)=1 then value:=candidate;end if;
    if field='classroomCatalogId' and (candidate<>'' or jsonb_typeof(chosen->field) not in('null','string')) then
     unassigned_room:=false;
     if value is null then errors:=errors||to_jsonb(field||':invalid_resource');end if;
    end if;
   elsif chosen ? name_field then
    candidate:=btrim(coalesce(chosen->>name_field,''));
    select count(*),min(c->>'id') into n,value from jsonb_array_elements(catalogs) c where candidate<>'' and btrim(c->>'name')=candidate;
    if n<>1 or coalesce(value,'')='' then value:=null;end if;
    if field='classroomCatalogId' then
     unassigned_room:=jsonb_typeof(chosen->name_field) in('null','string') and n=0 and candidate in('','미정','강의실 미정');
     if value is null and not unassigned_room then errors:=errors||to_jsonb(field||':invalid_resource');end if;
    end if;
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
  if value is null and not unassigned_room then missing:=missing||to_jsonb(field);end if;
 end loop;
 if vals->>'startTime' is not null and vals->>'endTime' is not null and vals->>'startTime'>=vals->>'endTime' then errors:=errors||'"invalid_time_range"'::jsonb;end if;
 if missing='[]'::jsonb and errors='[]'::jsonb then kind:='resolved';end if;
 return jsonb_build_object('date',d,'state',state,'kind',kind,'values',vals,'provenance',provenance,'missing',missing,'errors',errors);
end $fn$;

-- Baseline: 20261014193500_legacy_context_binding_preparation.sql (legacy_effective_context_v1)
create or replace function dashboard_private.legacy_effective_context_v1(c public.classes,p_catalogs jsonb default null)
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
  'teacherCatalogId',s->'teacherId','classroomCatalogId',s->'classroomId',
  'classroomUnresolved',coalesce(s->'classroomUnresolved','false'::jsonb))),'[]') into slots
 from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) s;
 -- Only after-snapshot makeup identities still present in this class can bind.
 -- Multiple matching requests/slots are retained as an unverified source.
 for candidate in
 with current_bindings as materialized(
  -- Binding is a non-null, non-throwing JSONB projection. Preserve JSONB
  -- equality, including numeric equality, missing keys and explicit JSON null.
  -- This CTE is local to this fresh context; no earlier read is reused.
  select coalesce(array_agg(dashboard_private.legacy_effective_binding_v1(current_row)),'{}'::jsonb[]) bindings
  from jsonb_array_elements(case when jsonb_typeof(c.schedule_plan->'sessions')='array' then c.schedule_plan->'sessions' else '[]' end) current_row
 ), requests as materialized(
  select m.*,to_jsonb(m) request_json,
   -- Avoid preparing old history when no after-row can bind to this class.
   case when exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_after->'sessions')='array' then m.schedule_plan_after->'sessions' else '[]' end) after_row
    where coalesce(after_row->>'scheduleState',after_row->>'state')='makeup'
     and nullif(after_row->>'id','') is not null
     and dashboard_private.legacy_effective_binding_v1(after_row)=any((select bindings from current_bindings)::jsonb[])
   ) then array(select dashboard_private.legacy_effective_binding_v1(previous_row)
    from jsonb_array_elements(case when jsonb_typeof(m.schedule_plan_before->'sessions')='array' then m.schedule_plan_before->'sessions' else '[]' end) previous_row)
   else '{}'::jsonb[] end prior_bindings
  from public.makeup_requests m
  where m.class_id=c.id and jsonb_typeof(m.schedule_plan_after->'sessions')='array'
 ), linked as materialized(
  select m.*,v lesson,s slot,ord-1 slot_index,
   public.makeup_numbered_source_instant_v1(s->>'startAt') a,
   public.makeup_numbered_source_instant_v1(s->>'endAt') b
  from requests m cross join lateral jsonb_array_elements(m.schedule_plan_after->'sessions') v
  cross join lateral jsonb_array_elements(public.makeup_numbered_slots_v1(m.request_json)) with ordinality e(s,ord)
  where coalesce(v->>'scheduleState',v->>'state')='makeup'
   and nullif(v->>'id','') is not null
   and dashboard_private.legacy_effective_binding_v1(v)=any((select bindings from current_bindings)::jsonb[])
   and not (dashboard_private.legacy_effective_binding_v1(v)=any(m.prior_bindings))
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
    'endTime',case when (candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time then '24:00' else to_char(candidate.b at time zone 'Asia/Seoul','HH24:MI') end,'teacherCatalogId',candidate.teacher_catalog_id,'classroomCatalogId',candidate.room_id,
    'classroomUnresolved',candidate.room_id is null and
     (btrim(coalesce(candidate.slot->>'classroom','')) not in('','미정','강의실 미정')
      or exists(select 1 from public.classroom_catalogs where name=candidate.slot->>'classroom'))),
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

-- Baseline: 20261013070534_timetable_reader_explicit_native_resolution.sql (read_timetable_operating_reference_v1)
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb; dated_hash text; default_bounds_complete boolean; default_weekdays integer[]; default_single_resource boolean; effective_context jsonb; effective_input jsonb; effective jsonb; catalogs jsonb; lookup_plan jsonb; teacher_id_counts jsonb; room_id_counts jsonb; past_class_id uuid; past_lesson_id text; past_session_date date; native_resolved boolean; start_text text; end_text text; teacher_text text; room_text text; start_hour int; end_hour int;
begin
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 select jsonb_build_object('teachers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.teacher_catalogs),'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') from public.classroom_catalogs)) into catalogs;
 -- Membership is exact catalog ID text, including hidden rows, as in the resolver.
 -- Both maps come from this call's same fresh catalog object; no prior read is reused.
 select (select coalesce(jsonb_object_agg(k,n),'{}'::jsonb)
         from (select x->>'id' k,count(*) n from jsonb_array_elements(catalogs->'teachers') x group by 1) ids),
        (select coalesce(jsonb_object_agg(k,n),'{}'::jsonb)
         from (select x->>'id' k,count(*) n from jsonb_array_elements(catalogs->'rooms') x group by 1) ids)
 into teacher_id_counts,room_id_counts;
 -- The capability's relevant row keeps the generic path, without excluding peers.
 select class_id,lesson_id,session_date into past_class_id,past_lesson_id,past_session_date from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current();
 -- Aggregate once, preserving exact lesson.id ordering and full dated history.
 -- Repeated JSONB concatenation copied growing arrays quadratically.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'start',s.start_time,'end',s.end_time,'teacher',s.teacher_catalog_id,'room',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'startMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.start_time)::int/60 end,'endMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.end_time)::int/60 end,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sessionId',s.id,'occupancyFingerprint',md5((jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)||case when s.classroom_catalog_id is null and not s.classroom_unassigned then jsonb_build_array(s.classroom_name_snapshot) else '[]'::jsonb end)::text)) order by s.id) filter(where s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or (s.classroom_catalog_id is null and not s.classroom_unassigned) or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0)),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb)
 into raw,blockers,dated
 from (select lesson.id,lesson.class_id,lesson.source_schedule_slot_id,lesson.session_date,lesson.schedule_state,lesson.start_time,lesson.end_time,lesson.revision,lesson.classroom_name_snapshot,class_row.name,
       (lesson.classroom_catalog_id is null and btrim(coalesce(lesson.classroom_name_snapshot,'')) in('','미정','강의실 미정')
        and not exists(select 1 from public.classroom_catalogs where name=btrim(lesson.classroom_name_snapshot))) classroom_unassigned,
       coalesce(lesson.teacher_catalog_id,(select min(id::text)::uuid from public.teacher_catalogs where name=btrim(lesson.teacher_name_snapshot) having count(*)=1)) teacher_catalog_id,
       coalesce(lesson.classroom_catalog_id,(select min(id::text)::uuid from public.classroom_catalogs where name=btrim(lesson.classroom_name_snapshot) having count(*)=1)) classroom_catalog_id
       from public.class_lesson_sessions lesson join public.classes class_row on class_row.id=lesson.class_id
       where class_row.schedule_storage_mode='normalized') s;
 for c in select * from public.classes where schedule_storage_mode<>'normalized' order by id loop
 if c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions')<>'array' then
 legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null));continue;end if;
 -- Only the date-map is read by the effective input helper. Keep the immutable
 -- full class plan for source binding, identity counts and raw fingerprints.
 lookup_plan:=jsonb_build_object('sessionSchedules',c.schedule_plan->'sessionSchedules');
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
    and jsonb_typeof(lookup_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'
    and not ((effective_context->'approvedByIdentity') ? coalesce(v->>'id',''))
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    -- Multiple same-day lessons must reach the ordinary collision validator;
    -- they must not all collapse into one inherited weekly reservation.
    and coalesce((date_counts->>(v->>'date'))::int,0)=1
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
 native_resolved:=false;effective_input:=null;effective:=null;
 if jsonb_typeof(v)='object' and jsonb_typeof(v->'date')='string' and dt is not null and state='active'
    and ident is not null
    and (case when nullif(v->>'id','') is not null then jsonb_typeof(v->'id') else jsonb_typeof(v->'sessionKey') end)='string'
    and coalesce((identity_counts->>ident)::int,0)=1 and coalesce((date_counts->>(v->>'date'))::int,0)=1
    and coalesce(v->'isForced','false'::jsonb)='false'::jsonb
    and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and jsonb_typeof(lookup_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'
    and not ((effective_context->'approvedByIdentity') ? coalesce(v->>'id',''))
    and not coalesce(c.id=past_class_id and ident=past_lesson_id and dt=past_session_date,false)
    and jsonb_typeof(v->'startTime')='string' and jsonb_typeof(v->'endTime')='string'
    and jsonb_typeof(v->'teacherCatalogId')='string' and jsonb_typeof(v->'classroomCatalogId')='string' then
   start_text:=btrim(v->>'startTime');end_text:=btrim(v->>'endTime');
   teacher_text:=btrim(v->>'teacherCatalogId');room_text:=btrim(v->>'classroomCatalogId');
   -- Parse hours only after both bounded regex checks; never rely on AND cast order.
   if start_text~'^[0-9]{1,2}:[0-5][0-9](:00([.]0+)?)?$'
      and end_text~'^[0-9]{1,2}:[0-5][0-9](:00([.]0+)?)?$' then
     start_hour:=split_part(start_text,':',1)::int;end_hour:=split_part(end_text,':',1)::int;
     if start_hour<=23 and (end_hour<=23 or (end_hour=24 and split_part(end_text,':',2)='00')) then
       start_text:=lpad(split_part(start_text,':',1),2,'0')||':'||split_part(start_text,':',2);
       end_text:=lpad(split_part(end_text,':',1),2,'0')||':'||split_part(end_text,':',2);
       if start_text<end_text and teacher_id_counts->teacher_text='1'::jsonb and room_id_counts->room_text='1'::jsonb then
         a:=start_hour*60+split_part(start_text,':',2)::int;b:=end_hour*60+split_part(end_text,':',2)::int;
         -- Exact canonical catalog text was validated before UUID conversion.
         tid:=teacher_text::uuid;rid:=room_text::uuid;native_resolved:=true;
       end if;
     end if;
   end if;
 end if;
 if not native_resolved then
   effective_input:=dashboard_private.legacy_effective_input_v1(lookup_plan,v,effective_context,
    coalesce((identity_counts->>ident)::int,0),coalesce((date_counts->>(v->>'date'))::int,0));
   effective:=dashboard_private.resolve_legacy_effective_schedule_v1(effective_input);
   if effective#>>'{values,startTime}' is not null then a:=extract(epoch from (effective#>>'{values,startTime}')::time)::int/60;end if;
   if effective#>>'{values,endTime}' is not null then b:=extract(epoch from (effective#>>'{values,endTime}')::time)::int/60;end if;
   if effective->'errors' ? 'invalid_time_range' then a:=null;b:=null;end if;
   tid:=(effective#>>'{values,teacherCatalogId}')::uuid;rid:=(effective#>>'{values,classroomCatalogId}')::uuid;
 end if;
 if (native_resolved or effective->>'kind'='resolved') and dt is not null then
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

-- Baseline: 20261014180000_timetable_validation_unchanged_inputs.sql (validate_timetable_operating_reference_v1)
create or replace function dashboard_private.validate_timetable_operating_reference_v1()
returns jsonb language plpgsql security definer set search_path='' as $f$
declare skip_unchanged_days boolean:=false; comparison_cutoff date:=(now() at time zone 'Asia/Seoul')::date;
 changed_weekdays integer[]; old_weekly_keys jsonb[]; reuse_weekly_keys boolean:=false; weekly_key_exists boolean;
 oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday dashboard_private.timetable_validation_effective_row_v1[];
 newday dashboard_private.timetable_validation_effective_row_v1[];
 -- Assigned once per side below, then immutable through the whole date pipeline.
 old_workset dashboard_private.timetable_validation_row_v1[];
 new_workset dashboard_private.timetable_validation_row_v1[];
 old_bucket dashboard_private.timetable_validation_row_v1[];
 new_bucket dashboard_private.timetable_validation_row_v1[];
 old_dates jsonb; new_dates jsonb; old_date_reference jsonb; new_date_reference jsonb;
 diagnostic_mode text; diagnostic_message text; diagnostic_detail text;
 diagnostic_confirmed jsonb:='[]'; diagnostic_unresolved jsonb:='[]';
 diagnostic_confirmed_count int:=0; diagnostic_unresolved_count int:=0;
 diagnostic_missing text[]; diagnostic_row jsonb; diagnostic_class_name text;
 diagnostic_teacher_name text; diagnostic_classroom_name text;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return null;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then return newref;end if;
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select b-'label' from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
           except select ob-'label' from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob) then
 diagnostic_mode:='introduced_unknown';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 -- Cache only keys whose eager preparation cannot introduce a date-cast error.
 -- Empty/non-array inputs and any old date field retain the original EXISTS.
 if jsonb_typeof(oldref->'shadowSlots')='array' and jsonb_typeof(newref->'shadowSlots')='array' then
  if jsonb_array_length(oldref->'shadowSlots')>0 and jsonb_array_length(newref->'shadowSlots')>0 then
   if not exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where b ? 'date') then
    select array_agg(dashboard_private.timetable_occupancy_key_v1(b)) into old_weekly_keys
    from jsonb_array_elements(oldref->'shadowSlots') b;
    reuse_weekly_keys:=true;
   end if;
  end if;
 end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if reuse_weekly_keys then
  weekly_key_exists:=dashboard_private.timetable_occupancy_key_v1(x)=any(old_weekly_keys);
 else
  weekly_key_exists:=exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x));
 end if;
 if weekly_key_exists then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then diagnostic_mode:='weekly';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- A dated-only change cannot alter effective occupancy on any other date.
 -- Compare BOTH sides with multiplicity: removals can expose weekly defaults.
 -- Preserve the full original date universe and every closed/preparing row.
 -- Below, skip only dates whose complete effective inputs are proven equal.
 -- All selected dates retain their COMPLETE per-date reference.
 -- Decode each original array once. Old is fully built before new, retaining
 -- the original global date-cast error boundary. Missing/null dates remain raw
 -- members for the affected multiset but are excluded from the date index.
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(oldref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::dashboard_private.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::dashboard_private.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into old_workset,old_dates from prepared;
 with decoded as materialized (
   select v,(v->>'date')::date dt,ord
   from jsonb_array_elements(newref->'datedSessions') with ordinality entries(v,ord)
 ), prepared as materialized (
   select row(v,dt,ord,
     jsonb_build_array(case when v->>'sourceSlotId' is not null then to_jsonb('live:'||(v->>'classId')||':'||(v->>'sourceSlotId')) else v->'id' end,
       v->'classId',case when v ? 'date' then to_jsonb(extract(dow from dt)::int) else v->'weekday' end,
       v->'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'),
     v->>'classId',v->>'sourceSlotId',v->>'id',v->>'inheritedWeeklySlotId',v->>'overriddenWeeklySlotId',v->>'state'
   )::dashboard_private.timetable_validation_row_v1 w from decoded
 ), indexed as (
   select (w).dt::text dt,jsonb_agg((w).source_ordinal order by (w).source_ordinal) positions
   from prepared where (w).dt is not null group by 1
 )
 select coalesce(array_agg(w order by (w).source_ordinal),'{}'::dashboard_private.timetable_validation_row_v1[]),
   (select coalesce(jsonb_object_agg(dt,positions),'{}'::jsonb) from indexed)
 into new_workset,new_dates from prepared;

 -- Only exact complete dated equality and canonical reader cutoff qualify.
 -- All malformed or noncanonical weekly inputs retain the original path.
 skip_unchanged_days:=(oldref->'datedSessions')::text collate "C"=(newref->'datedSessions')::text collate "C"
  and oldref->'asOfDate'=to_jsonb(comparison_cutoff)
  and newref->'asOfDate'=to_jsonb(comparison_cutoff)
  and case when jsonb_typeof(oldref->'shadowSlots')='array' and jsonb_typeof(newref->'shadowSlots')='array'
  then not exists(select 1 from jsonb_array_elements((oldref->'shadowSlots')||(newref->'shadowSlots')) weekly_entry
    where jsonb_typeof(weekly_entry->'weekday') is distinct from 'number'
       or (weekly_entry->>'weekday') !~ '^[0-6]$') else false end;
 if skip_unchanged_days then
  select coalesce(array_agg(distinct (raw_weekly::jsonb->>'weekday')::int),'{}'::integer[]) into changed_weekdays
  from ((select value::text collate "C" as raw_weekly from jsonb_array_elements(oldref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots'))
        union all
        (select value::text collate "C" from jsonb_array_elements(newref->'shadowSlots')
         except all select value::text collate "C" from jsonb_array_elements(oldref->'shadowSlots'))) changed_weekly;
 end if;
 old_date_reference:=jsonb_build_object('asOfDate',oldref->'asOfDate','shadowSlots',oldref->'shadowSlots');
 new_date_reference:=jsonb_build_object('asOfDate',newref->'asOfDate','shadowSlots',newref->'shadowSlots');
 -- Date enumeration retains the original value-only multiset and raw-date
 -- expression. Source rows come from the immutable workset, not a second JSON
 -- expansion. Occupancy preparation remains separate from enumeration; no new
 -- sort or preferred date order is introduced.
 for d in
 with old_sessions as materialized (select value from dashboard_private.timetable_validation_workset_values_v1(old_workset)),
      new_sessions as materialized (select value from dashboard_private.timetable_validation_workset_values_v1(new_workset)),
      changed as (
        (select value from old_sessions except all select value from new_sessions)
        union all
        (select value from new_sessions except all select value from old_sessions)
      )
 select distinct (value->>'date')::date from (
   select value from changed
   where oldref->'shadowSlots'=newref->'shadowSlots' and oldref->'asOfDate'=newref->'asOfDate'
   union all
   select value from old_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
   union all
   select value from new_sessions
   where oldref->'shadowSlots' is distinct from newref->'shadowSlots' or oldref->'asOfDate' is distinct from newref->'asOfDate'
 ) affected loop
 if skip_unchanged_days and isfinite(d) and (d<comparison_cutoff
  or not (extract(dow from d)::int=any(changed_weekdays))) then continue;end if;
 -- The index contains positions, never a second copy of the raw rows.
 select coalesce(array_agg(old_workset[(pos::text)::int] order by ord),'{}'::dashboard_private.timetable_validation_row_v1[])
 into old_bucket from jsonb_array_elements(coalesce(old_dates->d::text,'[]'::jsonb)) with ordinality entries(pos,ord);
 select coalesce(array_agg(row(coalesce(e.v,'null'::jsonb),
   coalesce(e.occupancy_key,dashboard_private.timetable_occupancy_key_v1(coalesce(e.v,'null'::jsonb))))::dashboard_private.timetable_validation_effective_row_v1 order by e.emitted_ordinal),
   '{}'::dashboard_private.timetable_validation_effective_row_v1[])
 into oldday from dashboard_private.timetable_effective_workset_date_v1(old_date_reference,d,old_bucket)
 with ordinality e(v,occupancy_key,emitted_ordinal);
 -- The index contains positions, never a second copy of the raw rows.
 select coalesce(array_agg(new_workset[(pos::text)::int] order by ord),'{}'::dashboard_private.timetable_validation_row_v1[])
 into new_bucket from jsonb_array_elements(coalesce(new_dates->d::text,'[]'::jsonb)) with ordinality entries(pos,ord);
 select coalesce(array_agg(row(coalesce(e.v,'null'::jsonb),
   coalesce(e.occupancy_key,dashboard_private.timetable_occupancy_key_v1(coalesce(e.v,'null'::jsonb))))::dashboard_private.timetable_validation_effective_row_v1 order by e.emitted_ordinal),
   '{}'::dashboard_private.timetable_validation_effective_row_v1[])
 into newday from dashboard_private.timetable_effective_workset_date_v1(new_date_reference,d,new_bucket)
 with ordinality e(v,occupancy_key,emitted_ordinal);
 -- Multiplicity, not mere existence: newly exposed defaults and duplicate keys
 -- must still be checked. Compute each day's counts once against all its rows.
 for x in
 with old_counts as (
   select occupancy_key key,count(*) n
   from unnest(oldday) group by 1
 ), new_counts as (
   select occupancy_key key,count(*) n,
          (jsonb_agg(v order by ord))->0 representative,min(ord) first_ordinal
   from unnest(newday) with ordinality entries(v,occupancy_key,ord) group by 1
 )
 select representative from new_counts n left join old_counts o using(key)
 where n.n>coalesce(o.n,0) order by first_ordinal loop
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d) and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b) and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)) or exists(select 1 from unnest(newday) b where dashboard_private.timetable_intersects_v1(x,b.v)) then diagnostic_mode:='dated';
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
return newref;
exception when exclusion_violation then
 -- PostgREST forwards DETAIL through the existing writer RPC. The diagnostic is
 -- optional: formatter/authentication failures retain the conflict. Database
 -- cancellation still propagates normally and rolls the rejected write back.
 -- Require the actual API role, not a client-set JWT role or agent impersonation.
 get stacked diagnostics diagnostic_message=MESSAGE_TEXT;
 if diagnostic_message<>'timetable_resource_conflict'
 or current_setting('role',true) is distinct from 'authenticated' then raise;end if;
 begin
 perform dashboard_private.agent_require_admin_v1();
 -- Only the candidate rejected by the unchanged checks above is explained.
 -- Use the complete already-read final reference, never an old saved draft,
 -- a client-provided comparison, a scoped snapshot, or a second database read.
 if diagnostic_mode in('weekly','dated') then
 for y in select value from jsonb_array_elements(case when diagnostic_mode='weekly'
            then newref->'shadowSlots' else (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from unnest(newday) with ordinality entries(v,occupancy_key,ord)) end)
          where (diagnostic_mode<>'weekly' or value->>'weekday'=x->>'weekday')
          and dashboard_private.timetable_intersects_v1(x,value)
          order by value->>'classId',value->>'id' loop
 -- Optional rooms do not erase a confirmed teacher or same-class conflict.
 -- Malformed/incomplete rows remain in the separate unresolved diagnostics.
 if x->>'teacherId' is null or y->>'teacherId' is null
 or x->>'startMinute' is null or x->>'endMinute' is null
 or y->>'startMinute' is null or y->>'endMinute' is null then continue;end if;
 diagnostic_confirmed_count:=diagnostic_confirmed_count+1;
 if diagnostic_confirmed_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_teacher_name:=null;diagnostic_classroom_name:=null;
 if x->>'teacherId'=y->>'teacherId' then
 select name into diagnostic_teacher_name from public.teacher_catalogs where id=(y->>'teacherId')::uuid;end if;
 if x->>'classroomId'=y->>'classroomId' then
 select name into diagnostic_classroom_name from public.classroom_catalogs where id=(y->>'classroomId')::uuid;end if;
 diagnostic_row:=jsonb_strip_nulls(jsonb_build_object('className',diagnostic_class_name,
 'date',case when diagnostic_mode='dated' then to_jsonb(d) end,
 'weekday',case when diagnostic_mode='weekly' then y->'weekday' end,
 'startMinute',(y->>'startMinute')::int,'endMinute',(y->>'endMinute')::int,
 'overlapStartMinute',greatest((x->>'startMinute')::int,(y->>'startMinute')::int),
 'overlapEndMinute',least((x->>'endMinute')::int,(y->>'endMinute')::int),
 'teacherName',diagnostic_teacher_name,'classroomName',diagnostic_classroom_name,
 'sameClass',case when x->>'classId'=y->>'classId' then true end));
 diagnostic_confirmed:=diagnostic_confirmed||jsonb_build_array(diagnostic_row);
 end loop;
 end if;
 for y in
 select b from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
 where case when diagnostic_mode='introduced_unknown' then
 not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')
 when diagnostic_mode='weekly' then
 (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date)
 and dashboard_private.timetable_blocker_intersects_v2(x,b)
 when diagnostic_mode='dated' then
 (b->>'date' is null or (b->>'date')::date=d)
 and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b)
 and not dashboard_private.past_lesson_state_correction_allows_blocker_v1(x||jsonb_build_object('date',d),b,newref)
 else false end
 order by b->>'classId',b->>'date',b->>'occupancyFingerprint' loop
 diagnostic_unresolved_count:=diagnostic_unresolved_count+1;
 if diagnostic_unresolved_count>20 then continue;end if;
 select name into diagnostic_class_name from public.classes where id=(y->>'classId')::uuid;
 diagnostic_missing:='{}';
 if y->>'date' is null and y->>'weekday' is null then diagnostic_missing:=array_append(diagnostic_missing,'date');end if;
 if y->>'startMinute' is null or y->>'endMinute' is null then diagnostic_missing:=array_append(diagnostic_missing,'time');end if;
 if y->>'teacherId' is null then diagnostic_missing:=array_append(diagnostic_missing,'teacher');end if;
 if y->>'classroomId' is null then diagnostic_missing:=array_append(diagnostic_missing,'classroom');end if;
 if cardinality(diagnostic_missing)=0 then diagnostic_missing:=array['schedule'];end if;
 diagnostic_unresolved:=diagnostic_unresolved||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
 'className',diagnostic_class_name,'date',y->'date','weekday',y->'weekday',
 'missingFields',to_jsonb(diagnostic_missing))));
 end loop;
 diagnostic_detail:=jsonb_build_object('version',1,'confirmed',diagnostic_confirmed,'unresolved',diagnostic_unresolved,
 'confirmedCount',diagnostic_confirmed_count,'unresolvedCount',diagnostic_unresolved_count,
 'truncated',diagnostic_confirmed_count>20 or diagnostic_unresolved_count>20)::text;
 exception when others then diagnostic_detail:=null;
 end;
 if diagnostic_detail is null then raise;end if;
 raise exception using errcode='23P01',message='timetable_resource_conflict',detail=diagnostic_detail;
end $f$;

-- Baseline: 20261004160000_legacy_effective_schedule_inheritance.sql
-- Keep the bounded makeup reader and its source adapter on the same room policy.
create or replace function dashboard_private.legacy_effective_context_for_dates_v1(c public.classes,p_catalogs jsonb,p_date_from date,p_date_to date)
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
  'teacherCatalogId',s->'teacherId','classroomCatalogId',s->'classroomId',
  'classroomUnresolved',coalesce(s->'classroomUnresolved','false'::jsonb))),'[]') into slots
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
    'endTime',case when (candidate.b at time zone 'Asia/Seoul')::date=(candidate.a at time zone 'Asia/Seoul')::date+1 and (candidate.b at time zone 'Asia/Seoul')::time='00:00'::time then '24:00' else to_char(candidate.b at time zone 'Asia/Seoul','HH24:MI') end,'teacherCatalogId',candidate.teacher_catalog_id,'classroomCatalogId',candidate.room_id,
    'classroomUnresolved',candidate.room_id is null and
     (btrim(coalesce(candidate.slot->>'classroom','')) not in('','미정','강의실 미정')
      or exists(select 1 from public.classroom_catalogs where name=candidate.slot->>'classroom'))),
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
create or replace function dashboard_private.read_makeup_operating_reference_v1(p_date_from date,p_date_to date)
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
        coalesce(jsonb_agg(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'startMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.start_time)::int/60 end,'endMinute',case when extract(second from s.start_time)=0 and extract(second from s.end_time)=0 then extract(epoch from s.end_time)::int/60 end,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'sessionId',s.id,'occupancyFingerprint',md5((jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)||case when s.classroom_catalog_id is null and not s.classroom_unassigned then jsonb_build_array(s.classroom_name_snapshot) else '[]'::jsonb end)::text)) order by s.id) filter(where s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or (s.classroom_catalog_id is null and not s.classroom_unassigned) or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0)),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb)
 into raw,blockers,dated
 from (select lesson.id,lesson.class_id,lesson.source_schedule_slot_id,lesson.session_date,lesson.schedule_state,lesson.start_time,lesson.end_time,lesson.revision,lesson.classroom_name_snapshot,class_row.name,
       (lesson.classroom_catalog_id is null and btrim(coalesce(lesson.classroom_name_snapshot,'')) in('','미정','강의실 미정')
        and not exists(select 1 from public.classroom_catalogs where name=btrim(lesson.classroom_name_snapshot))) classroom_unassigned,
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
    -- Multiple same-day lessons must reach the ordinary collision validator;
    -- they must not all collapse into one inherited weekly reservation.
    and coalesce((date_counts->>(v->>'date'))::int,0)=1
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

commit;
