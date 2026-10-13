begin;
set local lock_timeout='5s';
set local statement_timeout='8s';

-- Resolve only proven ordinary explicit rows natively within each complete read.
-- Every complex, invalid or incomplete row retains its original resolver path.
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

-- CREATE OR REPLACE retains the existing owner and private EXECUTE ACL.
commit;
