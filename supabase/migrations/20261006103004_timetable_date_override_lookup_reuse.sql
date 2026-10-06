begin;
set local lock_timeout='5s';

-- Preserve the complete reference and immutable class plan while avoiding
-- repeated traversal of the full plan for a single per-date override lookup.
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb; dated_hash text; default_bounds_complete boolean; default_weekdays integer[]; default_single_resource boolean; effective_context jsonb; effective_input jsonb; effective jsonb; catalogs jsonb; lookup_plan jsonb;
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
 effective_input:=dashboard_private.legacy_effective_input_v1(lookup_plan,v,effective_context,
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

-- CREATE OR REPLACE retains the existing owner and private EXECUTE ACL.
commit;
