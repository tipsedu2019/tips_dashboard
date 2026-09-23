-- Measured 7800-session reference timed out at35s; preserve every row and fingerprint.
-- Original final definition:20260923085008. CREATE OR REPLACE retains owner/ACL.
begin;
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c record; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]';
begin
 r:=dashboard_private.read_timetable_weekly_reference_v1();
 -- Aggregate once, preserving exact lesson.id ordering and full dated history.
 -- Repeated JSONB concatenation copied growing arrays quadratically.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'start',s.start_time,'end',s.end_time,'teacher',s.teacher_catalog_id,'room',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('classId',s.class_id,'label',s.name,'scope','all','resourceId',null,'reason','incomplete_read','date',s.session_date,'sessionId',s.id,'occupancyFingerprint',md5(jsonb_build_array(s.class_id,s.source_schedule_slot_id,s.session_date,s.schedule_state,s.start_time,s.end_time,s.teacher_catalog_id,s.classroom_catalog_id)::text)) order by s.id) filter(where s.schedule_state in('active','exception','makeup') and (s.teacher_catalog_id is null or s.classroom_catalog_id is null or s.start_time is null or s.end_time is null or extract(second from s.start_time)<>0 or extract(second from s.end_time)<>0)),'[]'::jsonb),
        coalesce(jsonb_agg(jsonb_build_object('id','session:'||s.id::text,'classId',s.class_id,'sourceSlotId',s.source_schedule_slot_id,'date',s.session_date,'state',s.schedule_state,'startMinute',extract(epoch from s.start_time)::int/60,'endMinute',extract(epoch from s.end_time)::int/60,'teacherId',s.teacher_catalog_id,'classroomId',s.classroom_catalog_id,'revision',s.revision) order by s.id),'[]'::jsonb)
 into raw,blockers,dated
 from (select lesson.*,class_row.name from public.class_lesson_sessions lesson
       join public.classes class_row on class_row.id=lesson.class_id
       where class_row.schedule_storage_mode='normalized') s;
 for c in select id,name,schedule_plan from public.classes where schedule_storage_mode<>'normalized' order by id loop
 if c.schedule_plan ? 'sessions' and jsonb_typeof(c.schedule_plan->'sessions')<>'array' then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',null));continue;end if;
 for v in select value from jsonb_array_elements(coalesce(c.schedule_plan->'sessions','[]')) loop
 -- Scalar legacy entries are diagnostic data, never JSON-object operations.
 -- Content-only fields remain absent from an object's occupancy fingerprint.
 occupancy:=case when jsonb_typeof(v)='object' then v-array['memo','publicNote','teacherNote','textbook','textbooks','homework','content','lessonContent','learningContent'] else v end;
 state:=coalesce(nullif(v->>'scheduleState',''),'active');
 if state in('skipped','tbd') then continue;end if;
 raw:=raw||jsonb_build_array(jsonb_build_object('classId',c.id,'session',occupancy));
 -- Date knowledge is independent of time/resource validity and must survive it.
 dt:=null;
 begin dt:=(v->>'date')::date;
 exception when invalid_datetime_format or datetime_field_overflow then dt:=null;
 end;
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
 if ident is null or (select count(*) from jsonb_array_elements(c.schedule_plan->'sessions') x where coalesce(x->>'id',x->>'sessionKey')=ident)>1 then raise exception 'unresolved';end if;
 dated:=dated||jsonb_build_array(jsonb_build_object('id','legacy-session:'||c.id::text||':'||ident,'classId',c.id,'sourceSlotId',null,'date',dt,'state',state,'startMinute',a,'endMinute',b,'teacherId',tid,'classroomId',rid,'revision',0));
 exception when others then
 blockers:=blockers||jsonb_build_array(jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',dt,'occupancyFingerprint',md5(occupancy::text)));
 end;
 end loop;
 end loop;
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',md5((dated||blockers||raw)::text),'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||md5((dated||blockers||raw)::text)));
end $f$;
-- Measured unchanged dated-key scans cost11s per real write.
create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $f$
declare oldref jsonb; newref jsonb; x jsonb; y jsonb; d date; oldday jsonb; newday jsonb;
begin
 select reference into oldref from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if oldref is null then return;end if;
 newref:=dashboard_private.read_timetable_operating_reference_v1();
 -- Introducing unknown occupancy is not a safe partial save. Existing unknown
 -- rows can remain unchanged or be removed/repaired without touching history.
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where not exists(select 1 from jsonb_array_elements((oldref->'unresolvedOccupancies')||(oldref->'datedUnresolvedOccupancies')) ob where ob-'label'=b-'label')) then
 raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 for x in select value from jsonb_array_elements(newref->'shadowSlots') loop
 if exists(select 1 from jsonb_array_elements(oldref->'shadowSlots') b where dashboard_private.timetable_occupancy_key_v1(b)=dashboard_private.timetable_occupancy_key_v1(x)) then continue;end if;
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where b->>'date' is null or ((b->>'date')::date >= (newref->>'asOfDate')::date and extract(dow from (b->>'date')::date)::int=(x->>'weekday')::int)) or exists(select 1 from jsonb_array_elements(newref->'shadowSlots') b where b->>'weekday'=x->>'weekday' and dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
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
 if exists(select 1 from jsonb_array_elements((newref->'unresolvedOccupancies')||(newref->'datedUnresolvedOccupancies')) b where (b->>'date' is null or (b->>'date')::date=d)) or exists(select 1 from jsonb_array_elements(newday) b where dashboard_private.timetable_intersects_v1(x,b)) then raise exception using errcode='23P01',message='timetable_resource_conflict';end if;
 end loop;
 end loop;
end $f$;
commit;
