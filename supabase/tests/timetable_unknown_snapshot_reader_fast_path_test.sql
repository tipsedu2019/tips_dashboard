begin;
select no_plan();

-- Synthetic owner-only reader fixtures. No student, real account or credential
-- is loaded. The control is the exact C12 reader body, not the active reader.
-- Source: 20261002123000_past_state_correction_reference_reuse.sql.
-- BEGIN_C12_CONTROL
create function pg_temp.c12_reference()
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
    and coalesce((date_counts->>(v->>'date'))::bigint,0)=1 then
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
 if tid is null and v->>'teacherName' is not null then select min(id::text)::uuid into tid from public.teacher_catalogs where name=v->>'teacherName' having count(*)=1;end if;
 if rid is null and v->>'classroomName' is not null then select min(id::text)::uuid into rid from public.classroom_catalogs where name=v->>'classroomName' having count(*)=1;end if;
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
-- END_C12_CONTROL

select is(encode(extensions.digest((select prosrc from pg_proc where oid='pg_temp.c12_reference()'::regprocedure),'sha256'),'hex'),
 'b3daaf85b5cd9848e4c6c98ffd1bc3f7ba6787770c9a642ebaad18361584f220',
 'independent control retains the exact reviewed C12 function body');

create function pg_temp.fid(n int) returns uuid language sql immutable as
$$select ('ad150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.past_day() returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date-1$$;
create function pg_temp.future_day(dow int) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date+7+((dow-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)$$;
create function pg_temp.unknown_row(id text default 'synthetic-row') returns jsonb language sql stable as
$$select jsonb_build_object('id',id,'date',pg_temp.past_day(),'state','active','isForced',false,'memo','Synthetic retained content')$$;

create temp table cases(n int primary key,label text not null,sessions jsonb not null,
 schedule text not null default '월 09:00-10:00',teacher text not null default 'Synthetic reader teacher');
insert into cases(n,label,sessions) values
 (1,'all six snapshot keys absent',jsonb_build_array(pg_temp.unknown_row())),
 (2,'absent date',jsonb_build_array(pg_temp.unknown_row()-'date')),
 (3,'JSON null date',jsonb_build_array(pg_temp.unknown_row()||'{"date":null}')),
 (4,'empty date',jsonb_build_array(pg_temp.unknown_row()||'{"date":""}')),
 (5,'invalid date',jsonb_build_array(pg_temp.unknown_row()||'{"date":"2026-13-99"}')),
 (6,'scalar',jsonb_build_array('"Synthetic scalar"'::jsonb)),
 (7,'array',jsonb_build_array('["startTime",{"date":"2001-01-01"}]'::jsonb)),
 (8,'JSON null row',jsonb_build_array('null'::jsonb)),
 (9,'forced row',jsonb_build_array(pg_temp.unknown_row()||'{"isForced":true}')),
 (10,'makeup-linked row',jsonb_build_array(pg_temp.unknown_row()||'{"makeupDate":"2001-01-02","originalDate":"2001-01-01"}')),
 (11,'unknown schedule state',jsonb_build_array(pg_temp.unknown_row()||'{"scheduleState":"not-a-schedule-state"}')),
 (12,'misspelled snapshot keys',jsonb_build_array(pg_temp.unknown_row()||'{"start_time":"09:00","end_time":"10:00","teacherId":"retained","roomId":"retained"}')),
 (13,'partial known interval and teacher',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.fid(101)))),
 (14,'retained teacher name without interval',jsonb_build_array(pg_temp.unknown_row()||'{"teacherName":"Synthetic reader teacher"}')),
 (15,'empty retained resource key',jsonb_build_array(pg_temp.unknown_row()||'{"teacherCatalogId":""}')),
 (16,'duplicate cancelled identities',jsonb_build_array(
   pg_temp.unknown_row('duplicate')||jsonb_build_object('state','skipped','date',pg_temp.past_day()),
   pg_temp.unknown_row('duplicate')||jsonb_build_object('state','skipped','date',pg_temp.past_day()-1))),
 (17,'duplicate cancelled dates',jsonb_build_array(
   pg_temp.unknown_row('first')||jsonb_build_object('state','skipped','date',pg_temp.future_day(1)),
   pg_temp.unknown_row('second')||jsonb_build_object('state','skipped','date',pg_temp.future_day(1)))),
 (18,'future inherited weekly slot',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(1)))),
 (19,'future unmatched weekday keeps known resources',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(2)))),
 (20,'future unique cancellation',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('state','skipped','date',pg_temp.future_day(1)))),
 (21,'future unique exception',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('state','exception','date',pg_temp.future_day(1)))),
 (22,'future unique tbd',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('state','tbd','date',pg_temp.future_day(1)))),
 (23,'future forced row cannot inherit',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(1),'isForced',true))),
 (24,'future makeup row cannot inherit',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(1),'state','makeup'))),
 (25,'future missing producer marker',jsonb_build_array((pg_temp.unknown_row()-'isForced')||jsonb_build_object('date',pg_temp.future_day(1)))),
 (26,'empty identity',jsonb_build_array(pg_temp.unknown_row()||'{"id":""}')),
 (27,'null identity',jsonb_build_array(pg_temp.unknown_row()||'{"id":null}')),
 (28,'session-key identity',jsonb_build_array((pg_temp.unknown_row()-'id')||'{"sessionKey":"retained-session-key"}')),
 (29,'content fields omitted only from occupancy fingerprint',jsonb_build_array(pg_temp.unknown_row()||'{"teacherNote":"Synthetic note","textbookEntries":[{"id":"synthetic-entry"}],"customField":{"keep":true}}'));
insert into cases(n,label,sessions)
select 30+ord::int,'present JSON null snapshot key: '||key,jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object(key,null))
from unnest(array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName']) with ordinality keys(key,ord);
insert into cases(n,label,sessions,teacher) values
 (40,'future inherited incomplete weekly resources',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(1))),'미정');
insert into cases(n,label,sessions,schedule) values
 (41,'future inheritance of multiple intervals',jsonb_build_array(pg_temp.unknown_row()||jsonb_build_object('date',pg_temp.future_day(1))),'월 09:00-10:00; 월 11:00-12:00');

insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.fid(101),'Synthetic reader teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.fid(201),'Synthetic reader room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids)
select pg_temp.fid(300+n),'Synthetic reader case '||n,'영어','수강','legacy',schedule,teacher,'Synthetic reader room',
 jsonb_build_object('sessions',sessions),'[]'::jsonb from cases order by n;
-- Historical fixture seeding establishes its own baseline. Every deferred guard
-- remains enabled; rollback below discards all fixtures and the baseline.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1()
where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;

create temp table reader_result as select
 pg_temp.c12_reference() before_reference,
 dashboard_private.read_timetable_operating_reference_v1() after_reference;
select is(after_reference,before_reference,'all edge fixtures preserve complete reader JSONB') from reader_result;
select is(after_reference->>'datedFingerprint',before_reference->>'datedFingerprint','full dated fingerprint is unchanged') from reader_result;
select is(after_reference->>'shadowFingerprint',before_reference->>'shadowFingerprint','full weekly-and-dated shadow fingerprint is unchanged') from reader_result;
select is(after_reference->>'datedComplete','false','unknown snapshots retain fail-closed completeness') from reader_result;
select is(
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') with ordinality entries(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(before_reference->'datedUnresolvedOccupancies') with ordinality entries(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 label||': blocker payload and order parity') from cases order by n;
select is(
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(after_reference->'datedSessions') with ordinality entries(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(before_reference->'datedSessions') with ordinality entries(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 label||': dated occupancy parity') from cases order by n;

-- Fixed expectations prevent a shared control/candidate bug from declaring an
-- unknown row resolved or erasing its exact known date or fingerprint.
select is((select v from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId'=pg_temp.fid(301)::text),
 jsonb_build_object('classId',pg_temp.fid(301),'label','Synthetic reader case 1','scope','all','resourceId',null,'reason','incomplete_read',
  'date',pg_temp.past_day(),'startMinute',null,'endMinute',null,'teacherId',null,'classroomId',null,
  'occupancyFingerprint',md5(((pg_temp.unknown_row()-array['memo','state'])||jsonb_build_object('identity','synthetic-row','scheduleState','active'))::text)),
 'absent snapshots retain the exact conservative blocker and occupancy fingerprint');
select ok(not exists(select 1 from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'classId'=pg_temp.fid(301)::text),
 'absent historical snapshots never become a resolved dated lesson');
select ok((select bool_and(v->'date'='null'::jsonb) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId' in(pg_temp.fid(302)::text,pg_temp.fid(303)::text,pg_temp.fid(304)::text,pg_temp.fid(305)::text)),
 'absent/null/invalid dates remain explicit undated blockers');
select is((select v->'teacherId' from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId'=pg_temp.fid(313)::text),
 to_jsonb(pg_temp.fid(101)),'partial retained teacher UUID survives fallback validation');
select is((select v->'startMinute' from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId'=pg_temp.fid(313)::text),
 '540'::jsonb,'partial retained interval survives fallback validation');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'classId'=pg_temp.fid(318)::text and v->>'state'='active' and v->>'inheritedWeeklySlotId' is not null),
 1::bigint,'valid future producer still inherits its weekly slot before fast path');
select ok((select v->'startMinute'='null'::jsonb and v->'endMinute'='null'::jsonb and v->>'teacherId'=pg_temp.fid(101)::text and v->>'classroomId'=pg_temp.fid(201)::text
 from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId'=pg_temp.fid(319)::text),
 'unmatched future weekday retains uniquely known teacher and room before fast path');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'classId' in(pg_temp.fid(320)::text,pg_temp.fid(321)::text,pg_temp.fid(322)::text) and v->>'state'='skipped'),
 3::bigint,'unique skipped/exception/tbd rows preserve existing cancellation authority');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId' in(pg_temp.fid(316)::text,pg_temp.fid(317)::text)),
 4::bigint,'duplicate identities or dates cannot acquire cancellation authority');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId' in(pg_temp.fid(323)::text,pg_temp.fid(324)::text,pg_temp.fid(325)::text)),
 3::bigint,'forced/makeup/unmarked future rows stay unknown');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'classId'=pg_temp.fid(341)::text),
 2::bigint,'future inheritance still includes every matching weekly interval');

select * from finish();
rollback;
