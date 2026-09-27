begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Read-only compatibility: a unique exact retained label can identify a catalog
-- resource when the old row has no UUID. Never backfill or merge source rows.
create or replace function dashboard_private.read_timetable_class_weekly_v2(c public.classes)
returns jsonb language plpgsql stable set search_path='' as $f$
declare s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; count_parts int; invalid boolean; raw_state jsonb:='[]';
begin
 count_parts:=0; invalid:=false;
 if c.schedule_storage_mode='normalized' then
 for s in select * from public.class_schedule_slots where class_id=c.id order by id loop
 count_parts:=count_parts+1;
 raw_state:=raw_state||jsonb_build_object('normalizedSlot',to_jsonb(s));
 tid:=s.teacher_catalog_id; rid:=s.classroom_catalog_id;
 if tid is null then select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(s.teacher_name) having count(*)=1;end if;
 if rid is null then select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(s.classroom_name) having count(*)=1;end if;
 if extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0 then invalid:=true; continue; end if;
 if tid is null or rid is null then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','unresolved_resource','weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',tid,'classroomId',rid,'occupancyFingerprint',md5(jsonb_build_array(s.id,s.weekday,s.start_time,s.end_time,tid,rid,s.teacher_name,s.classroom_name)::text)));
 continue;end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||s.id::text,'sourceSlotId',s.id,'classId',c.id,'weekday',s.weekday,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 else
 -- Strict complete tokens only. Multi-resource legacy strings remain blocked
 -- unless each whole schedule line can resolve its exact catalog labels.
 for piece in select btrim(x) from regexp_split_to_table(coalesce(c.schedule,''), E'[\\n;]+|,[[:space:]]*(?=[월화수목금토일][월화수목금토일 /,]*[[:space:]]+[0-9])') x loop
 parts:=regexp_match(piece,'^([월화수목금토일][월화수목금토일 /,]*)[[:space:]]+([0-9]{1,2}:[0-9]{2})[[:space:]]*[-~][[:space:]]*([0-9]{1,2}:[0-9]{2})([[:space:]]*[(]([^,()]+),[[:space:]]*([^()]+)[)])?$');
 if parts is null then invalid:=true; continue; end if;
 select min(id::text)::uuid into tid from public.teacher_catalogs where name=btrim(coalesce(parts[5],c.teacher)) having count(*)=1;
 select min(id::text)::uuid into rid from public.classroom_catalogs where name=btrim(coalesce(parts[6],c.room)) having count(*)=1;
 startm:=split_part(parts[2],':',1)::int*60+split_part(parts[2],':',2)::int;
 endm:=split_part(parts[3],':',1)::int*60+split_part(parts[3],':',2)::int;
 if split_part(parts[2],':',2)::int>59 or split_part(parts[3],':',2)::int>59 or startm<0 or startm>=endm or endm>1440 then invalid:=true;continue;end if;
 days:=regexp_replace(parts[1],'[ /,]','','g');
 for d in select regexp_split_to_table(days,'') loop
 count_parts:=count_parts+1;
 sid:=md5(c.id::text||':'||piece||':'||d)::uuid;
 if tid is null or rid is null then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','unresolved_resource','weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'occupancyFingerprint',md5(jsonb_build_array(sid,tid,rid)::text)));
 continue;end if;
 slots:=slots||jsonb_build_array(jsonb_build_object('id','live:'||c.id::text||':'||sid::text,'sourceSlotId',null,'classId',c.id,'weekday',strpos('일월화수목금토',d)-1,'startMinute',startm,'endMinute',endm,'teacherId',tid,'classroomId',rid,'classRevision',c.schedule_revision));
 end loop;
 end loop;
 end if;
 if invalid or count_parts=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','occupancyFingerprint',md5((jsonb_build_object('id',c.id,'status',c.status,'schedule_storage_mode',c.schedule_storage_mode,'schedule',c.schedule,'teacher',c.teacher,'room',c.room)||jsonb_build_object('slots',(select coalesce(jsonb_agg(jsonb_build_array(z.id,z.weekday,z.start_time,z.end_time,z.teacher_catalog_id,z.classroom_catalog_id) order by z.id),'[]') from public.class_schedule_slots z where z.class_id=c.id)))::text))); end if;
 return jsonb_build_object('shadowSlots',slots,'unresolvedOccupancies',blockers,'source',raw_state);
end $f$;


CREATE OR REPLACE FUNCTION dashboard_private.read_timetable_weekly_reference_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.classes; s record; piece text; parts text[]; days text; d text; tid uuid; rid uuid; startm int; endm int; sid uuid;
 slots jsonb:='[]'; blockers jsonb:='[]'; classes jsonb:='[]'; teachers jsonb; rooms jsonb; payload jsonb; count_parts int; invalid boolean; raw_state jsonb:='[]';
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into teachers from public.teacher_catalogs;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isVisible',is_visible,'subjects',subjects) order by id),'[]') into rooms from public.classroom_catalogs;
 for c in select * from public.classes
 where dashboard_private.academic_class_status_v1(status,nullif(btrim(start_date),'')::date,nullif(btrim(end_date),'')::date)='수강' order by id loop
 classes:=classes||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status','수강','revision',c.schedule_revision));
 raw_state:=raw_state||jsonb_build_object('id',c.id,'name',c.name,'subject',c.subject,'grade',c.grade,'status',c.status,'schedule_revision',c.schedule_revision,'schedule_storage_mode',c.schedule_storage_mode,'schedule',c.schedule,'teacher',c.teacher,'room',c.room);
 payload:=dashboard_private.read_timetable_class_weekly_v2(c);
 slots:=slots||(payload->'shadowSlots');blockers:=blockers||(payload->'unresolvedOccupancies');
 raw_state:=raw_state||(payload->'source');
 end loop;
 payload:=jsonb_build_object('shadowSlots',slots,'shadowClasses',classes,'catalogs',jsonb_build_object('teachers',teachers,'classrooms',rooms),'unresolvedOccupancies',blockers,'complete',jsonb_array_length(blockers)=0,'occupancyValidationVersion',2);
 return payload||jsonb_build_object('shadowFingerprint',md5((payload||jsonb_build_object('source',raw_state))::text));
end $function$
;

-- Unknown resources reserve every resource only inside the known interval.
-- Missing bounds stay conservative. A date is never treated as another weekday.
create or replace function dashboard_private.timetable_blocker_intersects_v2(s jsonb,b jsonb)
returns boolean language sql immutable set search_path='' as $f$
 select (coalesce((b->>'weekday')::int,extract(dow from (b->>'date')::date)::int) is null
         or coalesce((b->>'weekday')::int,extract(dow from (b->>'date')::date)::int)=coalesce((s->>'weekday')::int,extract(dow from (s->>'date')::date)::int))
 and (b->>'startMinute' is null or b->>'endMinute' is null or
      ((s->>'startMinute')::int<(b->>'endMinute')::int and (b->>'startMinute')::int<(s->>'endMinute')::int))
 and case when b->>'scope'='resource' then b->>'resourceId' is null or b->>'resourceId' in(s->>'teacherId',s->>'classroomId')
          else b->>'teacherId' is null or b->>'classroomId' is null or b->>'teacherId'=s->>'teacherId' or b->>'classroomId'=s->>'classroomId' end
$f$;


create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; defaults jsonb; regular jsonb;
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
 for v in select value from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) loop
 -- Scalar legacy entries are diagnostic data, never JSON-object operations.
 -- Content-only fields remain absent from an object's occupancy fingerprint.
 occupancy:=case when jsonb_typeof(v)='object' then v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent','textbookEntries','progressStatus'] else v end;
 state:=coalesce(nullif(v->>'scheduleState',''),nullif(v->>'state',''),'active');
 if state in('skipped','tbd') then continue;end if;
 legacy_raw:=array_append(legacy_raw,jsonb_build_object('classId',c.id,'session',occupancy));
 -- Date knowledge is independent of time/resource validity and must survive it.
 dt:=null;
 begin dt:=(v->>'date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then dt:=null;
 end;
 a:=null;b:=null;tid:=null;rid:=null;
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
 legacy_dated:=array_append(legacy_dated,jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0));
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

create or replace function dashboard_private.timetable_effective_date_v1(r jsonb, d date)
returns setof jsonb language sql stable set search_path='' as $f$
 select x||jsonb_build_object('date',d) from jsonb_array_elements(r->'shadowSlots') x
 where d>=(r->>'asOfDate')::date and (x->>'weekday')::int=extract(dow from d)::int and not exists(
 select 1 from jsonb_array_elements(r->'datedSessions') s where s->>'classId'=x->>'classId' and s->>'sourceSlotId'=x->>'sourceSlotId' and (s->>'date')::date=d)
 union all
 select s from jsonb_array_elements(r->'datedSessions') s where (s->>'date')::date=d and s->>'state' in('active','exception','makeup') and not exists(select 1 from jsonb_array_elements(r->'shadowSlots') w where s->>'inheritedWeeklySlotId'=w->>'id' and d>=(r->>'asOfDate')::date and (w->>'weekday')::int=extract(dow from d)::int)
$f$;

CREATE OR REPLACE FUNCTION dashboard_private.validate_timetable_item_slots_v1(p_plan uuid, p_item uuid, p_subject text, p_slots jsonb, p_reference jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb; other jsonb; old public.timetable_plan_slots; changed boolean; tid uuid; rid uuid; sid uuid; day int; a int; b int; target_from date; target_to date; dt date;
begin
 select target_start_date,target_end_date into target_from,target_to from public.timetable_plans where id=p_plan;
 if jsonb_typeof(p_slots) is distinct from 'array' then raise exception using errcode='22023',message='timetable_invalid';end if;
 if jsonb_array_length(p_slots)>2000 then raise exception using errcode='22023',message='timetable_capacity';end if;
 if (select count(*)<>count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_slots) x) then raise exception using errcode='22023',message='timetable_invalid';end if;
 for v in select value from jsonb_array_elements(p_slots) loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in('id','itemId','planId','weekday','startMinute','endMinute','teacherId','classroomId','sourceSlotId','teacherName','classroomName')) then raise exception using errcode='22023',message='timetable_invalid';end if;
 sid:=(v->>'id')::uuid;tid:=(v->>'teacherId')::uuid;rid:=(v->>'classroomId')::uuid;day:=(v->>'weekday')::int;a:=(v->>'startMinute')::int;b:=(v->>'endMinute')::int;
 if sid is null or tid is null or rid is null or (v->>'planId')::uuid is distinct from p_plan or (v->>'itemId')::uuid is distinct from p_item or day is null or day not between 0 and 6 or a is null or b is null or a<0 or b>1440 or a>=b then raise exception using errcode='22023',message='timetable_invalid';end if;
 select * into old from public.timetable_plan_slots where id=sid;
 if found and (old.plan_id<>p_plan or old.item_id<>p_item) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if (v->>'sourceSlotId')::uuid is distinct from old.source_slot_id then raise exception using errcode='22023',message='timetable_invalid';end if;
 changed:=old.id is null or (old.weekday,old.start_minute,old.end_minute,old.teacher_catalog_id,old.classroom_catalog_id) is distinct from (day,a,b,tid,rid);
 if not changed then continue;end if;
 if not exists(select 1 from public.teacher_catalogs where id=tid and is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(p_subject,subjects)) or not exists(select 1 from public.classroom_catalogs where id=rid and is_visible and (cardinality(subjects)=0 or p_subject=any(subjects))) then raise exception using errcode='22023',message='timetable_invalid';end if;
 if exists(select 1 from jsonb_array_elements(p_reference->'unresolvedOccupancies') z where dashboard_private.timetable_blocker_intersects_v2(v,z)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_slots) x where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from public.timetable_plan_slots s join public.timetable_plan_items i on i.id=s.item_id where s.plan_id=p_plan and s.item_id<>p_item and i.state='draft' and s.weekday=day and s.start_minute<b and s.end_minute>a and (s.teacher_catalog_id=tid or s.classroom_catalog_id=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if exists(select 1 from jsonb_array_elements(p_reference->'shadowSlots') x where (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 if target_from is not null and target_to is not null then
 if exists(select 1 from jsonb_array_elements(p_reference->'datedUnresolvedOccupancies') z where (z->>'date' is null or (z->>'date')::date between target_from and target_to) and dashboard_private.timetable_blocker_intersects_v2(v,z)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for dt in select distinct (value->>'date')::date from jsonb_array_elements(p_reference->'datedSessions') where (value->>'date')::date between target_from and target_to loop
 if extract(dow from dt)::int=day and exists(select 1 from jsonb_array_elements(p_reference->'datedSessions') x where x->>'state' in('active','exception','makeup') and (x->>'date')::date=dt and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a and ((x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end if;
 end loop;
end $function$
;

create or replace function dashboard_private.evaluate_timetable_transfer_v1(r jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source_id uuid:=(r#>>'{source,planId}')::uuid; target_id uuid:=(r#>>'{target,planId}')::uuid;
 source_snapshot jsonb; target_snapshot jsonb; ref jsonb; selected uuid[];
 i public.timetable_plan_items; s public.timetable_plan_slots; code text; label text;
 blockers jsonb:='[]'; warnings jsonb:='[]'; mappings jsonb:='[]'; pending_ids jsonb:='[]'; entry jsonb;
 keep_pending boolean:=r->>'onConflict'='keep_pending'; period_from date; period_to date;
begin
 source_snapshot:=public.get_timetable_plan_v1(source_id);
 if target_id is not null then target_snapshot:=public.get_timetable_plan_v1(target_id); end if;
 ref:=dashboard_private.read_timetable_operating_reference_v1();
 select array_agg(value::uuid order by value::uuid) into selected from jsonb_array_elements_text(r->'itemIds');
 if source_snapshot#>>'{plan,state}'<>'draft' or (target_id is not null and target_snapshot#>>'{plan,state}'<>'draft') then
   raise exception using errcode='42501',message='timetable_forbidden';
 end if;
 perform dashboard_private.timetable_check_capacity_v1(source_id);
 if target_id is not null then
   perform dashboard_private.timetable_check_capacity_v1(target_id);
   period_from:=(target_snapshot#>>'{plan,targetStartDate}')::date;
   period_to:=(target_snapshot#>>'{plan,targetEndDate}')::date;
   if (target_snapshot#>>'{capacity,itemCount}')::int+cardinality(selected)>500 then
     raise exception using errcode='22023',message='timetable_capacity'; end if;
 else period_from:=(ref->>'asOfDate')::date; period_to:='infinity'::date;
 end if;
 foreach source_id in array selected loop
   select * into i from public.timetable_plan_items where id=source_id and plan_id=(r#>>'{source,planId}')::uuid;
   if not found or i.state<>'draft' then raise exception using errcode='22023',message='timetable_invalid'; end if;
   mappings:=mappings||jsonb_build_array(jsonb_build_object('sourceId',i.id,'action',case when target_id is null then 'create_active_class' else 'create_plan_item' end));
   if jsonb_array_length(i.pending_slots)>0 or not exists(select 1 from public.timetable_plan_slots where item_id=i.id) then
     entry:=jsonb_build_object('sourceId',i.id,'code','unplaced','label','미배치 슬롯을 모두 해결하세요.','relatedIds','[]'::jsonb);
     if keep_pending then warnings:=warnings||jsonb_build_array(entry); else blockers:=blockers||jsonb_build_array(entry); end if;
   end if;
   if target_id is null and ((select count(*) from public.timetable_plan_slots where item_id=i.id)>64
     or (i.subject='과학' and (i.grade not in('고1','고2','고3') or i.subject_area_key is null))
     or (i.subject<>'과학' and i.subject_area_key is not null)
     or (i.subject_area_key is not null and not exists(select 1 from public.academic_subject_areas a where a.subject=i.subject and a.area_key=i.subject_area_key and a.is_active))) then
     blockers:=blockers||jsonb_build_array(jsonb_build_object('sourceId',i.id,'code','metadata','label','수업 기본정보 또는 배치 개수를 확인하세요.','relatedIds','[]'::jsonb));
   end if;
   for s in select * from public.timetable_plan_slots where item_id=i.id order by id loop
     code:=null; label:=null;
     if not exists(select 1 from public.teacher_catalogs t where t.id=s.teacher_catalog_id and t.is_visible and dashboard_private.registration_observation_teacher_subject_matches_v1(i.subject,t.subjects))
       or not exists(select 1 from public.classroom_catalogs c where c.id=s.classroom_catalog_id and c.is_visible and (cardinality(c.subjects)=0 or i.subject=any(c.subjects))) then
       code:='missing_resource'; label:='사용 가능한 선생님·강의실을 선택하세요.';
     elsif exists(select 1 from jsonb_array_elements(ref->'unresolvedOccupancies') x where dashboard_private.timetable_blocker_intersects_v2(jsonb_build_object('weekday',s.weekday,'startMinute',s.start_minute,'endMinute',s.end_minute,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id),x))
       or exists(select 1 from public.timetable_plan_slots x where x.item_id=any(selected) and x.id<>s.id and x.weekday=s.weekday and x.start_minute<s.end_minute and x.end_minute>s.start_minute and (x.item_id=s.item_id or x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id))
       or exists(select 1 from public.timetable_plan_slots x join public.timetable_plan_items xi on xi.id=x.item_id where x.plan_id=target_id and xi.state='draft' and x.weekday=s.weekday and x.start_minute<s.end_minute and x.end_minute>s.start_minute and (x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id))
       or exists(select 1 from jsonb_array_elements(ref->'shadowSlots') x where (x->>'weekday')::int=s.weekday and (x->>'startMinute')::int<s.end_minute and (x->>'endMinute')::int>s.start_minute and ((x->>'teacherId')::uuid=s.teacher_catalog_id or (x->>'classroomId')::uuid=s.classroom_catalog_id))
       or (period_from is not null and exists(select 1 from jsonb_array_elements(ref->'datedUnresolvedOccupancies') x where (x->>'date' is null or (x->>'date')::date between period_from and period_to) and dashboard_private.timetable_blocker_intersects_v2(jsonb_build_object('weekday',s.weekday,'startMinute',s.start_minute,'endMinute',s.end_minute,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id),x)))
       or (period_from is not null and exists(select 1 from jsonb_array_elements(ref->'datedSessions') x where x->>'state' in('active','exception','makeup') and (x->>'date')::date between period_from and period_to and extract(dow from (x->>'date')::date)::int=s.weekday and (x->>'startMinute')::int<s.end_minute and (x->>'endMinute')::int>s.start_minute and ((x->>'teacherId')::uuid=s.teacher_catalog_id or (x->>'classroomId')::uuid=s.classroom_catalog_id))) then
       code:='conflict'; label:='선택한 수업 또는 목적지 시간표와 겹칩니다.';
     end if;
     if code is not null then
       entry:=jsonb_build_object('sourceId',i.id,'code',code,'label',label,'relatedIds',jsonb_build_array(s.id));
       if keep_pending then warnings:=warnings||jsonb_build_array(entry); pending_ids:=pending_ids||jsonb_build_array(s.id);
       else blockers:=blockers||jsonb_build_array(entry); end if;
     end if;
   end loop;
   if keep_pending and jsonb_array_length(i.pending_slots)+(select count(*) from public.timetable_plan_slots where item_id=i.id and pending_ids ? id::text)>2000 then
     raise exception using errcode='22023',message='timetable_capacity';
   end if;
 end loop;
 if target_id is not null and (target_snapshot#>>'{capacity,slotCount}')::int+(select count(*) from public.timetable_plan_slots where item_id=any(selected) and not pending_ids ? id::text)>2000 then
   raise exception using errcode='22023',message='timetable_capacity'; end if;
 return jsonb_build_object('request',r,'fingerprint',md5(jsonb_build_object('request',r,'source',source_snapshot,'target',target_snapshot,'reference',ref,'actor',auth.uid(),'role',dashboard_private.timetable_actor_role_v1(),'subjectAreas',(select jsonb_agg(to_jsonb(a) order by a.subject,a.area_key) from public.academic_subject_areas a))::text),
   'shadowFingerprint',ref->>'shadowFingerprint','mappings',mappings,'blockers',blockers,'warnings',warnings,'pendingSlotIds',pending_ids);
end $$;

create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- A catalog or content write may change metadata while leaving every occupancy
 -- unchanged. This is the same no-new-occupancy outcome as the checks below.
 if oldref->'shadowSlots'=newref->'shadowSlots'
 and oldref->'datedSessions'=newref->'datedSessions'
 and oldref->'unresolvedOccupancies'=newref->'unresolvedOccupancies'
 and oldref->'datedUnresolvedOccupancies'=newref->'datedUnresolvedOccupancies' then return;end if;
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select b-'label' from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b
           except select ob-'label' from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date >= (newref->>'asOfDate')::date) and dashboard_private.timetable_blocker_intersects_v2(x,b)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 -- All actual dates are checked, including sessions under closed/preparing classes.
 -- Comparing effective occupancy also detects a removed skipped override which
 -- newly exposes a weekly default at that date.
 for d in select distinct (value->>'date')::date from jsonb_array_elements((oldref->'datedSessions')||(newref->'datedSessions')) loop
 select coalesce(jsonb_agg(v),'[]') into oldday from dashboard_private.timetable_effective_date_v1(oldref,d) v;
 select coalesce(jsonb_agg(v),'[]') into newday from dashboard_private.timetable_effective_date_v1(newref,d) v;
 -- Multiplicity, not mere existence: newly exposed defaults and duplicate keys
 -- must still be checked. Compute each day's counts once against all its rows.
 for x in
 with old_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n
   from jsonb_array_elements(oldday) v group by 1
 ), new_counts as (
   select dashboard_private.timetable_occupancy_key_v1(v) key,count(*) n,
          (jsonb_agg(v order by ord))->0 representative,min(ord) first_ordinal
   from jsonb_array_elements(newday) with ordinality entries(v,ord) group by 1
 )
 select representative from new_counts n left join old_counts o using(key)
 where n.n>coalesce(o.n,0) order by first_ordinal loop
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d) and dashboard_private.timetable_blocker_intersects_v2(x||jsonb_build_object('date',d),b)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
end $f$;
alter function dashboard_private.read_timetable_class_weekly_v2(public.classes) owner to postgres;
revoke all on function dashboard_private.read_timetable_class_weekly_v2(public.classes) from public,anon,authenticated;
alter function dashboard_private.timetable_blocker_intersects_v2(jsonb,jsonb) owner to postgres;
revoke all on function dashboard_private.timetable_blocker_intersects_v2(jsonb,jsonb) from public,anon,authenticated;
commit;
