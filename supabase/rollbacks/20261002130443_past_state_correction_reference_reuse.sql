begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Restore the exact C11 function bodies; retain all data, private audit and ACLs.
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb;
begin
 r:=dashboard_private.read_timetable_weekly_reference_v1();
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
 defaults:=dashboard_private.read_timetable_class_weekly_v2(c);
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
 begin dt:=(v->>'date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then dt:=null;
 end;
 a:=null;b:=null;tid:=null;rid:=null;
 -- Legacy exception means no lesson (unlike normalized exception overrides).
 -- Only a unique, dated producer row may suppress that date's weekly defaults.
 if jsonb_typeof(v)='object' and dt is not null and state in('exception','skipped','tbd')
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and (select count(*) from jsonb_array_elements(c.schedule_plan->'sessions') z where z->>'date'=v->>'date')=1 then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
   end loop;
   continue;
 end if;
 if jsonb_typeof(v)='object' and dt >= (now() at time zone 'Asia/Seoul')::date and state='active'
    and v->'isForced'='false'::jsonb and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
    and not (v ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and not exists(select 1 from jsonb_array_elements(defaults->'unresolvedOccupancies') z where z->>'weekday' is null or z->>'startMinute' is null or z->>'endMinute' is null)
    and exists(select 1 from jsonb_array_elements((defaults->'shadowSlots')||(defaults->'unresolvedOccupancies')) z where (z->>'weekday')::int=extract(dow from dt)::int) then
   for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
   end loop;
   for regular in select value from jsonb_array_elements(defaults->'unresolvedOccupancies') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
   end loop;
   continue;
 end if;
 -- A plain future regular row may outlive a change to its weekday. Its time
 -- remains unknown. Only a complete, single-resource weekly definition can
 -- establish its teacher/room; never grant this to makeup/forced/override rows,
 -- past history, duplicate identities, ambiguous catalogs or mixed resources.
 if jsonb_typeof(v)='object' and dt >= (now() at time zone 'Asia/Seoul')::date and state='active'
    and v->'isForced'='false'::jsonb and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
    and not (v ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])
    and coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')) is not null
    and coalesce((identity_counts->>coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey','')))::bigint,0)=1
    and defaults->'unresolvedOccupancies'='[]'::jsonb
    and (select count(distinct jsonb_build_array(z->'teacherId',z->'classroomId'))=1
         and bool_and(z->>'teacherId' is not null and z->>'classroomId' is not null)
         from jsonb_array_elements(defaults->'shadowSlots') z) then
   legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',dt,'startMinute',null,'endMinute',null,'teacherId',defaults#>>'{shadowSlots,0,teacherId}','classroomId',defaults#>>'{shadowSlots,0,classroomId}','occupancyFingerprint',md5(occupancy::text)));
   continue;
 end if;
 begin
 if jsonb_typeof(v)<>'object' then raise exception 'unresolved';end if;
 -- Validate the original text before casting: even sub-microsecond fractions
 -- must not be rounded into an apparently whole-minute reservation.
 if (v->>'startTime') !~ '^[0-9]{1,2}:[0-9]{2}(:00([.]0+)?)?$'
   or (v->>'endTime') !~ '^[0-9]{1,2}:[0-9]{2}(:00([.]0+)?)?$' then raise exception 'unresolved';end if;
 a:=extract(epoch from (v->>'startTime')::time)::int/60;b:=extract(epoch from (v->>'endTime')::time)::int/60;
 tid:=nullif(v->>'teacherCatalogId','')::uuid;rid:=nullif(v->>'classroomCatalogId','')::uuid;
 if tid is null then select min(id::text)::uuid into tid from public.teacher_catalogs where name=v->>'teacherName' having count(*)=1;end if;
 if rid is null then select min(id::text)::uuid into rid from public.classroom_catalogs where name=v->>'classroomName' having count(*)=1;end if;
 if dt is null or a is null or b is null or a>=b or tid is null or rid is null or state not in('active','exception','makeup') or not exists(select 1 from public.teacher_catalogs where id=tid) or not exists(select 1 from public.classroom_catalogs where id=rid) then raise exception 'unresolved';end if;
 ident:=coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''));
 if ident is null or coalesce((identity_counts->>ident)::bigint,0)>1 then raise exception 'unresolved';end if;
 -- An explicit regular lesson overrides its single weekly occurrence. It is
 -- not an additional lesson. Never infer this for makeup/forced rows, duplicate
 -- dates, multiple weekly slots, or incomplete weekly definitions.
 regular:=null;
 if dt >= (now() at time zone 'Asia/Seoul')::date and state='active'
 and v->'isForced'='false'::jsonb and coalesce(v->>'originalDate','')='' and coalesce(v->>'makeupDate','')=''
 and coalesce((date_counts->>(v->>'date'))::bigint,0)=1
 and defaults->'unresolvedOccupancies'='[]'::jsonb
 and (select count(*) from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int)=1 then
 select x into regular from jsonb_array_elements(defaults->'shadowSlots') x where (x->>'weekday')::int=extract(dow from dt)::int;
 end if;
 legacy_dated:=array_append(legacy_dated,jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0)
 ||case when regular is not null then jsonb_build_object('overriddenWeeklySlotId',regular->>'id') else '{}'::jsonb end);
 exception when others then
 legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',dt,'startMinute',case when a>=0 and a<b and b<=1440 then a end,'endMinute',case when a>=0 and a<b and b<=1440 then b end,'teacherId',tid,'classroomId',rid,'occupancyFingerprint',md5(occupancy::text)));
 end;
 end loop;
 end loop;
 -- PL/pgSQL expanded arrays append without repeatedly copying the JSONB history.
 -- Materialize each legacy array once, after the normalized rows, in original order.
 raw:=raw||to_jsonb(legacy_raw);
 dated:=dated||to_jsonb(legacy_dated);
 blockers:=blockers||to_jsonb(legacy_blockers);
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',md5((dated||blockers||raw)::text),'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||md5((dated||blockers||raw)::text)));
end $f$;

create or replace function dashboard_private.prepare_past_lesson_state_correction_v1(p_class_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare actor uuid; c public.classes; d date; v jsonb; old_state text; next_state text;
 ident text; ordinal bigint; a int; b int; tid uuid; rid uuid; state_map jsonb; detail_map jsonb;
 next_plan jsonb; next_row jsonb; reference jsonb; candidate jsonb; blockers jsonb; review_hash text;
 before_hash text; after_hash text; summary jsonb;
begin
 actor:=dashboard_private.agent_require_admin_v1();
 perform dashboard_private.lock_timetable_operating_resources_v1();
 if p_class_id is null or jsonb_typeof(p_command) is distinct from 'object'
 or p_command->>'kind' is distinct from 'past_lesson_state_correction'
 or exists(select 1 from jsonb_object_keys(p_command) k where k not in('kind','lessonId','date','expectedState','state','reason','window','unknownOccupancyReviewHash','acknowledgeUnknownOccupancy'))
 or jsonb_typeof(p_command->'lessonId') is distinct from 'string'
 or length(p_command->>'lessonId') not between 1 and 240
 or jsonb_typeof(p_command->'date') is distinct from 'string'
 or (p_command->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(p_command->'expectedState') is distinct from 'string'
 or p_command->>'expectedState' not in('active','exception','skipped')
 or jsonb_typeof(p_command->'state') is distinct from 'string'
 or p_command->>'state' not in('active','exception')
 or jsonb_typeof(p_command->'reason') is distinct from 'string'
 or length(btrim(p_command->>'reason')) not between 1 and 300
 or jsonb_typeof(p_command->'window') is distinct from 'object'
 or p_command#>>'{window,from}' is distinct from p_command->>'date'
 or p_command#>>'{window,to}' is distinct from p_command->>'date'
 or exists(select 1 from jsonb_object_keys(p_command->'window') k where k not in('from','to'))
 or (p_command ? 'acknowledgeUnknownOccupancy' and jsonb_typeof(p_command->'acknowledgeUnknownOccupancy') is distinct from 'boolean')
 or (p_command ? 'unknownOccupancyReviewHash' and (jsonb_typeof(p_command->'unknownOccupancyReviewHash') is distinct from 'string' or (p_command->>'unknownOccupancyReviewHash') !~ '^[a-f0-9]{64}$')) then
 raise exception using errcode='22023',message='agent_invalid';end if;
 begin d:=(p_command->>'date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then
 raise exception using errcode='22023',message='agent_invalid_range';end;
 if d >= (clock_timestamp() at time zone 'Asia/Seoul')::date then
 raise exception using errcode='22023',message='agent_invalid_range';end if;
 select * into c from public.classes where id=p_class_id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if c.schedule_storage_mode is distinct from 'legacy' or c.status<>'수강' or c.closed_at is not null then
 raise exception using errcode='42501',message='agent_class_not_active';end if;
 if jsonb_typeof(c.schedule_plan) is distinct from 'object'
 or jsonb_typeof(c.schedule_plan->'sessions') is distinct from 'array'
 or (c.schedule_plan ? 'sessionStates' and jsonb_typeof(c.schedule_plan->'sessionStates') is distinct from 'object')
 or (c.schedule_plan ? 'sessionSchedules' and jsonb_typeof(c.schedule_plan->'sessionSchedules') is distinct from 'object') then
 raise exception using errcode='22023',message='agent_invalid';end if;
 if (select count(*) from jsonb_array_elements(c.schedule_plan->'sessions') x where x->>'date'=d::text)<>1
 or (select count(*) from jsonb_array_elements(c.schedule_plan->'sessions') x where coalesce(nullif(x->>'id',''),nullif(x->>'sessionKey',''))=p_command->>'lessonId')<>1 then
 raise exception using errcode='22023',message='agent_ambiguous_lesson';end if;
 select x,ord into v,ordinal from jsonb_array_elements(c.schedule_plan->'sessions') with ordinality entries(x,ord)
 where x->>'date'=d::text and x->>'id'=p_command->>'lessonId';
 if v is null then raise exception using errcode='P0001',message='agent_stale';end if;
 if jsonb_typeof(v->'id') is distinct from 'string' or length(v->>'id') not between 1 and 240
 or btrim(v->>'id')='' or btrim(v->>'id')<>v->>'id' then
 raise exception using errcode='22023',message='agent_ambiguous_lesson';end if;
 ident:=v->>'id';
 old_state:=coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active');
 next_state:=p_command->>'state';
 if old_state is distinct from p_command->>'expectedState' then raise exception using errcode='P0001',message='agent_stale';end if;
 if old_state=next_state then raise exception using errcode='22023',message='agent_no_change';end if;
 if old_state not in('active','exception','skipped')
 or (v ? 'isForced' and v->'isForced' is distinct from 'false'::jsonb)
 or coalesce(v->>'originalDate','')<>'' or coalesce(v->>'makeupDate','')<>''
 or coalesce(v->>'makeupOf','')<>'' or coalesce(v->>'makeupOfSessionId','')<>''
 or coalesce(v->>'makeup_of_session_id','')<>''
 or exists(select 1 from jsonb_array_elements(c.schedule_plan->'sessions') x where x->>'originalDate'=d::text or x->>'makeupDate'=d::text) then
 raise exception using errcode='22023',message='agent_edit_makeup_source';end if;
 state_map:=c.schedule_plan#>array['sessionStates',d::text];
 detail_map:=c.schedule_plan#>array['sessionSchedules',d::text];
 if (state_map is not null and jsonb_typeof(state_map)<>'object')
 or (detail_map is not null and jsonb_typeof(detail_map)<>'object') then
 raise exception using errcode='22023',message='agent_invalid';end if;
 if coalesce(state_map->>'makeupDate','')<>'' or coalesce(state_map->>'originalDate','')<>''
 or (state_map->>'state' is not null and state_map->>'state'<>old_state) then
 raise exception using errcode='22023',message='agent_edit_makeup_source';end if;
 -- No inference from today's weekly defaults, date-map values or catalog labels.
 -- Historical catalog IDs may be hidden; preserving an existing known reservation
 -- does not reassign a resource and does not require current catalog visibility.
 if not (v ?& array['startTime','endTime','teacherCatalogId','classroomCatalogId'])
 or jsonb_typeof(v->'startTime') is distinct from 'string'
 or jsonb_typeof(v->'endTime') is distinct from 'string'
 or jsonb_typeof(v->'teacherCatalogId') is distinct from 'string'
 or jsonb_typeof(v->'classroomCatalogId') is distinct from 'string'
 or (v->>'startTime') !~ '^[0-9]{1,2}:[0-9]{2}(:00([.]0+)?)?$'
 or (v->>'endTime') !~ '^[0-9]{1,2}:[0-9]{2}(:00([.]0+)?)?$' then
 raise exception using errcode='22023',message='agent_timing_required';end if;
 begin
 a:=extract(epoch from (v->>'startTime')::time)::int/60;
 b:=extract(epoch from (v->>'endTime')::time)::int/60;
 tid:=(v->>'teacherCatalogId')::uuid;rid:=(v->>'classroomCatalogId')::uuid;
 exception when others then raise exception using errcode='22023',message='agent_timing_required';end;
 if a is null or b is null or a<0 or a>=b or b>1440 or tid is null or rid is null
 or not exists(select 1 from public.teacher_catalogs where id=tid)
 or not exists(select 1 from public.classroom_catalogs where id=rid)
 or exists(select 1 from jsonb_object_keys(coalesce(detail_map,'{}')) k
           where k in('startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName')
           and (not v ? k or detail_map->k is distinct from v->k)) then
 raise exception using errcode='22023',message='agent_timing_required';end if;
 if exists(select 1 from public.makeup_requests m where m.class_id=c.id and (
 m.status in('approval_pending','revision_requested','manager_pending')
 or (m.status='completed' and (m.cancel_date=d or (m.makeup_start_at at time zone 'Asia/Seoul')::date=d
 or exists(select 1 from jsonb_array_elements(m.makeup_slots) x where (coalesce(x->>'startAt',x->>'start_at')::timestamptz at time zone 'Asia/Seoul')::date=d))))) then
 raise exception using errcode='P0001',message='agent_approval_workflow_required';end if;
 next_row:=v;
 if v ? 'scheduleState' then next_row:=jsonb_set(next_row,'{scheduleState}',to_jsonb(next_state));end if;
 if v ? 'state' or not v ? 'scheduleState' then next_row:=jsonb_set(next_row,'{state}',to_jsonb(next_state));end if;
 next_plan:=jsonb_set(c.schedule_plan,'{sessions}',(select jsonb_agg(case when ord=ordinal then next_row else x end order by ord) from jsonb_array_elements(c.schedule_plan->'sessions') with ordinality entries(x,ord)));
 next_plan:=jsonb_set(next_plan,'{sessionStates}',coalesce(c.schedule_plan->'sessionStates','{}')
            ||jsonb_build_object(d::text,coalesce(state_map,'{}')||jsonb_build_object('state',next_state)));
 candidate:=jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'date',d,
             'state','active','startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid);
 reference:=dashboard_private.read_timetable_operating_reference_v1();
 if exists(select 1 from dashboard_private.timetable_effective_date_v1(reference,d) x
           where dashboard_private.timetable_intersects_v1(candidate,x)) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 select coalesce(jsonb_agg(x-'label' order by (x-'label')::text),'[]') into blockers
 from jsonb_array_elements((reference->'unresolvedOccupancies')||(reference->'datedUnresolvedOccupancies')) x
 where (x->>'date' is null or (x->>'date')::date=d)
 and dashboard_private.timetable_blocker_intersects_v2(candidate,x);
 before_hash:=encode(sha256(convert_to(c.schedule_plan::text,'UTF8')),'hex');
 after_hash:=encode(sha256(convert_to(next_plan::text,'UTF8')),'hex');
 review_hash:=encode(sha256(convert_to(jsonb_build_object('actor',actor,'classId',c.id,'lessonId',ident,'date',d,
              'expectedState',old_state,'state',next_state,'beforePlanHash',before_hash,'occupancy',candidate,'blockers',blockers)::text,'UTF8')),'hex');
 summary:=jsonb_build_object('kind','past_lesson_state_correction','classId',c.id,'lessonId',ident,'date',d,
          'expectedState',old_state,'state',next_state,'planHash',before_hash,
          'unknownOccupancyReviewHash',review_hash,'unknownOccupancyCount',jsonb_array_length(blockers),
          'warnings',case when blockers='[]'::jsonb then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','unknown_occupancy','count',jsonb_array_length(blockers))) end);
 return jsonb_build_object('summary',summary,'beforePlan',c.schedule_plan,'afterPlan',next_plan,'beforePlanHash',before_hash,
                          'afterPlanHash',after_hash,'targetOccupancy',candidate,'reviewedBlockers',blockers);
end $f$;

create or replace function dashboard_private.apply_past_lesson_state_correction_v1(p_class_id uuid,p_command jsonb,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare review jsonb; actor uuid; result jsonb;
begin
 actor:=dashboard_private.agent_require_admin_v1();
 if p_request_key is null then raise exception using errcode='22023',message='agent_invalid';end if;
 review:=dashboard_private.prepare_past_lesson_state_correction_v1(p_class_id,p_command);
 if p_command->'acknowledgeUnknownOccupancy' is distinct from 'true'::jsonb then
 raise exception using errcode='22023',message='agent_unknown_occupancy_ack_required';end if;
 if p_command->>'unknownOccupancyReviewHash' is distinct from review#>>'{summary,unknownOccupancyReviewHash}' then
 raise exception using errcode='P0001',message='agent_review_stale';end if;
 -- Only this private writer can create the exemption; no JWT or GUC claim enables it.
 insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
 values(txid_current(),dashboard_private.read_timetable_operating_reference_v1()) on conflict(transaction_id) do nothing;
 insert into dashboard_private.past_lesson_state_correction_contexts(transaction_id,actor_profile_id,class_id,lesson_id,session_date,corrected_plan,target_occupancy,reviewed_blockers,review_hash)
 values(txid_current(),actor,p_class_id,p_command->>'lessonId',(p_command->>'date')::date,review->'afterPlan',review->'targetOccupancy',review->'reviewedBlockers',review#>>'{summary,unknownOccupancyReviewHash}');
 perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id,p_request_key,'past_lesson_state_correction_v1',p_command->>'reason');
 update public.classes set schedule_plan=review->'afterPlan' where id=p_class_id;
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
 insert into dashboard_private.past_lesson_state_correction_attestations(actor_profile_id,request_key,class_id,lesson_id,session_date,previous_state,next_state,before_plan_hash,after_plan_hash,review_hash,reviewed_blockers,reason)
 values(actor,p_request_key,p_class_id,p_command->>'lessonId',(p_command->>'date')::date,p_command->>'expectedState',p_command->>'state',review->>'beforePlanHash',review->>'afterPlanHash',review#>>'{summary,unknownOccupancyReviewHash}',review->'reviewedBlockers',p_command->>'reason');
 result:=review->'summary'||jsonb_build_object('planHash',review->>'afterPlanHash','reviewRequired',false,'requestKey',p_request_key,'outcome','applied','notifications',jsonb_build_object('state','not_requested'));
 return result;
end $f$;

create or replace function public.agent_api_v2(p_token_hash text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cred dashboard_private.agent_credentials; preview dashboard_private.agent_edit_previews; op dashboard_private.agent_edit_operations;
 cid uuid; key uuid; token uuid; context jsonb; after_state jsonb; result jsonb; command jsonb; review jsonb; page int; err text; statecode text;
 claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true); jwtrole text:=current_setting('request.jwt.claim.role',true);
begin
 select * into cred from dashboard_private.agent_credentials where token_hash=p_token_hash for update;
 if not found or cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='28000',message='agent_unauthorized';end if;
 if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=cred.created_by and p.role='admin' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then raise exception using errcode='42501',message='agent_forbidden';end if;
 if cred.rate_window is null or cred.rate_window<date_trunc('minute',clock_timestamp()) then cred.rate_count:=0;end if;
 if cred.rate_count>=60 then return jsonb_build_object('error',jsonb_build_object('code','agent_rate_limited'));end if;
 update dashboard_private.agent_credentials set last_used_at=clock_timestamp(),rate_window=date_trunc('minute',clock_timestamp()),rate_count=cred.rate_count+1 where id=cred.id;
 if not 'class-details:read'=any(cred.scopes) or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cred.created_by,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cred.created_by::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 if p_action='health' then
 result:=jsonb_build_object('apiVersion','2','credentialId',cred.id,'executor',cred.label,'scopes',cred.scopes,'classIds',cred.class_ids,'classAccess',jsonb_build_object('mode',case when cred.all_classes then 'all' when cardinality(cred.class_ids)=0 then 'legacy_all_read' else 'selected' end,'includesFutureClasses',cred.all_classes),'expiresAt',cred.expires_at,'timezone','Asia/Seoul');
 elsif p_action in('context','preview') then
 cid:=(p_input->>'classId')::uuid;
 if not (cred.all_classes or cid=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 if p_action='preview' then perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=cid for update;end if;
 context:=dashboard_private.agent_edit_context_v2(cid);
 if p_action='context' then result:=context;
 else
 command:=p_input->'command';
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,command);
 if p_input->>'expectedVersion' is distinct from context->>'version' then raise exception using errcode='P0001',message='agent_stale';end if;
 if command->>'kind'='past_lesson_state_correction' then
 review:=dashboard_private.prepare_past_lesson_state_correction_v1(cid,command);
 if command->'acknowledgeUnknownOccupancy' is distinct from 'true'::jsonb then
 if command ? 'unknownOccupancyReviewHash' then raise exception using errcode='22023',message='agent_invalid';end if;
 result:=review->'summary'||jsonb_build_object('reviewOnly',true,'reviewRequired',true,'previewToken',null,'beforeContext',context,'afterContext',context,'window',command->'window','notifications',jsonb_build_object('state','not_requested'));
 else
 begin
 perform dashboard_private.agent_apply_edit_v2(cid,command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(cid);
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_edit_previews(credential_id,class_id,base_version,command,before_state,after_state) values(cred.id,cid,context->>'version',command,context,after_state) returning * into preview;
 result:=review->'summary'||jsonb_build_object('reviewOnly',false,'reviewRequired',false,'previewToken',preview.id,'expiresAt',preview.expires_at,'beforeContext',context,'afterContext',after_state,'window',command->'window','notifications',jsonb_build_object('state','not_requested'));
 end if;
 else
 begin
 perform dashboard_private.agent_apply_edit_v2(cid,command,gen_random_uuid());
 after_state:=dashboard_private.agent_edit_context_v2(cid);
 raise exception using errcode='ZA001',message='agent_preview_rollback';
 exception when sqlstate 'ZA001' then null;
 end;
 insert into dashboard_private.agent_edit_previews(credential_id,class_id,base_version,command,before_state,after_state) values(cred.id,cid,context->>'version',command,context,after_state) returning * into preview;
 result:=jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'beforeContext',context,'afterContext',after_state,'window',command->'window','notifications',jsonb_build_object('state','not_requested'));
 end if;
 end if;
 elsif p_action='commit' then
 key:=(p_input->>'requestKey')::uuid;token:=(p_input->>'previewToken')::uuid;
 if key is null or token is null or length(coalesce(p_input->>'sourceReference',''))>500 then raise exception using errcode='22023',message='agent_invalid';end if;
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=key;
 if found then
 if op.preview_id<>token or op.source_reference is distinct from nullif(p_input->>'sourceReference','') then raise exception using errcode='22023',message='agent_idempotency_key_reused';end if;
 result:=op.result||jsonb_build_object('replayed',true);
 else
 select * into preview from dashboard_private.agent_edit_previews where id=token and credential_id=cred.id for update;
 if not found then raise exception using errcode='P0002',message='agent_not_found';end if;
 if not (cred.all_classes or preview.class_id=any(cred.class_ids)) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
 perform dashboard_private.agent_edit_require_scopes_v2(cred.scopes,preview.command);
 if exists(select 1 from dashboard_private.agent_edit_operations where preview_id=token) then raise exception using errcode='22023',message='agent_preview_consumed';end if;
 begin
 if preview.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='agent_preview_expired';end if;
 perform dashboard_private.lock_timetable_operating_resources_v1();perform 1 from public.classes where id=preview.class_id for update;
 context:=dashboard_private.agent_edit_context_v2(preview.class_id);
 if context->>'version' is distinct from preview.base_version then raise exception using errcode='P0001',message='agent_stale';end if;
 perform dashboard_private.agent_apply_edit_v2(preview.class_id,preview.command,case when preview.command->>'kind'='past_lesson_state_correction' then key else gen_random_uuid() end);
 after_state:=dashboard_private.agent_edit_context_v2(preview.class_id);
 result:=jsonb_build_object('operationId',key,'state','applied','classContext',after_state,'window',preview.command->'window','appliedAt',clock_timestamp(),'executor',cred.label,'actorProfileId',cred.created_by,'sourceReference',nullif(p_input->>'sourceReference',''),'requesterVerified',false);
 exception when others then
 get stacked diagnostics err=message_text,statecode=returned_sqlstate;
 result:=jsonb_build_object('operationId',key,'state','failed','error',jsonb_build_object('code',case when statecode='23P01' then 'timetable_resource_conflict' when err='class_schedule_catalog_invalid' then 'agent_invalid_catalog' when err in('agent_stale','agent_preview_expired','agent_not_found','agent_approval_workflow_required','agent_class_not_active','agent_past_change','class_schedule_stale','continuous_class_schedule_runtime_not_ready','agent_review_stale','agent_unknown_occupancy_ack_required','agent_timing_required','agent_ambiguous_lesson','agent_no_change','agent_invalid_range','agent_edit_makeup_source','agent_invalid') then err else 'agent_write_failed' end,'sqlstate',statecode));
 end;
 result:=result||jsonb_build_object('notifications',jsonb_build_object('state','not_requested'),'externalSync',jsonb_build_object('state','not_requested'),'reply',jsonb_build_object('state','not_requested'));
 insert into dashboard_private.agent_edit_operations(credential_id,request_key,preview_id,class_id,source_reference,state,result) values(cred.id,key,token,preview.class_id,nullif(p_input->>'sourceReference',''),result->>'state',result);
 end if;
 elsif p_action='operation' then
 select * into op from dashboard_private.agent_edit_operations where credential_id=cred.id and request_key=(p_input->>'requestKey')::uuid;
 result:=case when found then op.result else jsonb_build_object('operationId',p_input->>'requestKey','state','unknown','retryWithNewKey',false) end;
 elsif p_action='operations' then
 page:=coalesce((p_input->>'page')::int,1);
 if page<1 or page>10000 then raise exception using errcode='22023',message='agent_invalid';end if;
 select jsonb_build_object('page',page,'pageSize',20,'total',(select count(*) from dashboard_private.agent_edit_operations where credential_id=cred.id),'items',coalesce(jsonb_agg(jsonb_build_object('operationId',request_key,'classId',class_id,'state',state,'createdAt',created_at,'sourceReference',source_reference) order by created_at desc,request_key),'[]')) into result from (select * from dashboard_private.agent_edit_operations where credential_id=cred.id order by created_at desc,request_key limit 20 offset (page-1)*20) x;
 else raise exception using errcode='22023',message='agent_invalid';
 end if;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);perform set_config('request.jwt.claim.role',coalesce(jwtrole,''),true);
 return jsonb_build_object('data',result);
end$$;

notify pgrst,'reload schema';
commit;
