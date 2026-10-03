begin;
select no_plan();

-- Synthetic rollback-only fixtures. The independent control is the exact C15
-- body from 20261002134022_past_state_unknown_snapshot_reader_fast_path.sql.
-- Unchanged callees are shared; the candidate implementation is never shared.
-- BEGIN_C15_CONTROL
create function pg_temp.c15_reference()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare r jsonb; dated jsonb:='[]'; blockers jsonb:='[]'; c public.classes; v jsonb; tid uuid; rid uuid; dt date; a int; b int; state text; ident text; occupancy jsonb; raw jsonb:='[]'; legacy_raw jsonb[]:='{}'; legacy_dated jsonb[]:='{}'; legacy_blockers jsonb[]:='{}'; identity_counts jsonb; date_counts jsonb; defaults jsonb; regular jsonb; dated_hash text;
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
 -- An object without any retained timing/resource field reaches the existing
 -- unresolved branch with all four occupancy values NULL. Keep its exact date
 -- and fingerprint without opening an exception block for expected NULL history.
 if jsonb_typeof(v)='object'
 and not (v ?| array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName']) then
   legacy_blockers:=array_append(legacy_blockers,jsonb_build_object('classId',c.id,'label',c.name,'scope','all','resourceId',null,'reason','incomplete_read','date',dt,'startMinute',null,'endMinute',null,'teacherId',null,'classroomId',null,'occupancyFingerprint',md5(occupancy::text)));
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
 dated_hash:=md5((dated||blockers||raw)::text);
 return r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',dated_hash,'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||dated_hash));
end $f$;
-- END_C15_CONTROL


select is(encode(extensions.digest((select prosrc from pg_proc where oid='pg_temp.c15_reference()'::regprocedure),'sha256'),'hex'),
 'f15590b751798764ffd99eae08fd7d0d955f1eddbd31a51bcd587c2416db4ce6','control retains the exact frozen C15 reader body');

create function pg_temp.fid(n int) returns uuid language sql immutable as
$$select ('ad190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.future_day(dow int) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date+7+((dow-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)$$;
create function pg_temp.past_day(dow int default 1) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date-7-((extract(dow from (now() at time zone 'Asia/Seoul')::date)::int-dow+7)%7)$$;
create function pg_temp.plain_row(ident text,day date) returns jsonb language sql stable as
$$select jsonb_build_object('id',ident,'date',day,'state','active','isForced',false,'memo','Synthetic retained content')$$;
create function pg_temp.explicit_row(ident text,day date) returns jsonb language sql stable as
$$select pg_temp.plain_row(ident,day)||jsonb_build_object('startTime','09:30','endTime','10:30',
 'teacherCatalogId',pg_temp.fid(101),'classroomCatalogId',pg_temp.fid(201))$$;

create temp table cases(n int primary key,label text not null,sessions jsonb not null,
 schedule text not null default '월 09:00-10:00',teacher text not null default 'C19 synthetic teacher 1',
 status text not null default '수강',storage_mode text not null default 'legacy');
insert into cases(n,label,sessions) values
 (1,'plain past and future',jsonb_build_array(pg_temp.plain_row('past',pg_temp.past_day()),pg_temp.plain_row('future',pg_temp.future_day(1)))),
 (2,'many future rows share defaults',(select jsonb_agg(pg_temp.plain_row('future-'||i,pg_temp.future_day(1)+7*i) order by i) from generate_series(0,4) i)),
 (3,'unmatched weekday with one resource pair',jsonb_build_array(pg_temp.plain_row('unmatched',pg_temp.future_day(2)))),
 (4,'past plain history',jsonb_build_array(pg_temp.plain_row('past-only',pg_temp.past_day()))),
 (10,'unique past cancellation',jsonb_build_array(pg_temp.plain_row('cancel-past',pg_temp.past_day())||'{"state":"skipped"}')),
 (11,'unique future exception',jsonb_build_array(pg_temp.plain_row('cancel-exception',pg_temp.future_day(1))||'{"state":"exception"}')),
 (12,'unique future tbd',jsonb_build_array(pg_temp.plain_row('cancel-tbd',pg_temp.future_day(1))||'{"state":"tbd"}')),
 (13,'duplicate cancellation identities',jsonb_build_array(pg_temp.plain_row('duplicate',pg_temp.future_day(1))||'{"state":"skipped"}',pg_temp.plain_row('duplicate',pg_temp.future_day(1)+7)||'{"state":"skipped"}')),
 (14,'duplicate cancellation dates',jsonb_build_array(pg_temp.plain_row('first',pg_temp.future_day(1))||'{"state":"skipped"}',pg_temp.plain_row('second',pg_temp.future_day(1))||'{"state":"skipped"}')),
 (15,'unique explicit regular override',jsonb_build_array(pg_temp.explicit_row('override',pg_temp.future_day(1)))),
 (18,'JSON null date',jsonb_build_array(pg_temp.plain_row('null-date',null))),
 (19,'invalid date',jsonb_build_array(pg_temp.plain_row('invalid-date',pg_temp.past_day())||'{"date":"2026-13-99"}')),
 (20,'empty date',jsonb_build_array(pg_temp.plain_row('empty-date',pg_temp.past_day())||'{"date":""}')),
 (21,'missing date',jsonb_build_array(pg_temp.plain_row('missing-date',pg_temp.past_day())-'date')),
 (22,'invalid retained time',jsonb_build_array(pg_temp.explicit_row('bad-time',pg_temp.future_day(1))||'{"startTime":"not-a-time"}')),
 (23,'partial teacher and interval',jsonb_build_array(pg_temp.explicit_row('partial',pg_temp.past_day())-'classroomCatalogId')),
 (24,'malformed teacher UUID',jsonb_build_array(pg_temp.explicit_row('bad-teacher',pg_temp.past_day())||'{"teacherCatalogId":"not-a-uuid"}')),
 (25,'malformed room UUID after valid teacher',jsonb_build_array(pg_temp.explicit_row('bad-room',pg_temp.past_day())||'{"classroomCatalogId":"not-a-uuid"}')),
 (26,'forced plain future row',jsonb_build_array(pg_temp.plain_row('forced',pg_temp.future_day(1))||'{"isForced":true}')),
 (27,'makeup-linked plain future row',jsonb_build_array(pg_temp.plain_row('linked',pg_temp.future_day(1))||jsonb_build_object('makeupDate',pg_temp.future_day(2),'originalDate',pg_temp.past_day()))),
 (28,'empty identity',jsonb_build_array(pg_temp.plain_row('',pg_temp.future_day(1)))),
 (29,'present JSON null snapshot key',jsonb_build_array(pg_temp.plain_row('present-null',pg_temp.future_day(1))||'{"startTime":null}')),
 (30,'scalar lesson','["Synthetic scalar"]'),
 (31,'JSON null sessions','null'),
 (33,'scalar sessions','"Synthetic sessions"'),
 (38,'unknown state',jsonb_build_array(pg_temp.plain_row('unknown-state',pg_temp.future_day(1))||'{"scheduleState":"unknown-state"}')),
 (39,'missing producer marker',jsonb_build_array(pg_temp.plain_row('no-marker',pg_temp.future_day(1))-'isForced'));
insert into cases(n,label,sessions,schedule,teacher) values
 (5,'bounded unknown resources at midnight',jsonb_build_array(pg_temp.plain_row('midnight',pg_temp.future_day(0))),'일 00:00-24:00','C19 missing teacher'),
 (35,'unresolved defaults on another weekday',jsonb_build_array(pg_temp.plain_row('unmatched-unknown',pg_temp.future_day(2))),'일 00:00-24:00','C19 missing teacher');
insert into cases(n,label,sessions,schedule) values
 (6,'empty defaults',jsonb_build_array(pg_temp.plain_row('empty',pg_temp.future_day(1))),''),
 (7,'global incomplete default and known slot',jsonb_build_array(pg_temp.plain_row('incomplete',pg_temp.future_day(1))),'월 09:00-10:00; malformed fragment'),
 (8,'slot order and duplicate multiplicity',jsonb_build_array(pg_temp.plain_row('three-slots',pg_temp.future_day(1))),'월 11:00-12:00; 월 09:00-10:00; 월 09:00-10:00'),
 (9,'unmatched weekday with mixed pairs',jsonb_build_array(pg_temp.plain_row('mixed-unmatched',pg_temp.future_day(2))),'월 09:00-10:00(C19 synthetic teacher 1,C19 synthetic room 1); 월 11:00-12:00(C19 synthetic teacher 2,C19 synthetic room 2)'),
 (16,'multiple defaults cannot infer one override',jsonb_build_array(pg_temp.explicit_row('multiple-override',pg_temp.future_day(1))),'월 09:00-10:00; 월 11:00-12:00'),
 (32,'oversized schedule token becomes incomplete',jsonb_build_array(pg_temp.plain_row('huge-hour',pg_temp.future_day(1))),'월 999999999999:00-10:00'),
 (34,'empty history with incomplete defaults','[]',''),
 (36,'matched weekday with mixed pairs',jsonb_build_array(pg_temp.plain_row('mixed-matched',pg_temp.future_day(1))),'월 09:00-10:00(C19 synthetic teacher 1,C19 synthetic room 1); 월 11:00-12:00(C19 synthetic teacher 2,C19 synthetic room 2)'),
 (37,'unmatched weekday with multiple intervals and one pair',jsonb_build_array(pg_temp.plain_row('many-unmatched',pg_temp.future_day(2))),'월 11:00-12:00; 월 09:00-10:00'),
 (43,'unmatched weekday with one pair across weekdays',jsonb_build_array(pg_temp.plain_row('other-day',pg_temp.future_day(2))),'수 11:00-12:00; 월 09:00-10:00'),
 (44,'empty history with complete defaults','[]','월 09:00-10:00');
insert into cases(n,label,sessions,status) values
 (17,'closed plain and explicit historical rows',jsonb_build_array(pg_temp.plain_row('closed-plain',pg_temp.past_day()),pg_temp.explicit_row('closed-explicit',pg_temp.past_day()-7)),'종강'),
 (40,'academic active alias',jsonb_build_array(pg_temp.plain_row('active-alias',pg_temp.future_day(1))),'수업 진행 중'),
 (41,'closed future history',jsonb_build_array(pg_temp.plain_row('closed-future',pg_temp.future_day(1))),'종강');
insert into cases(n,label,sessions,storage_mode) values
 (42,'shadow storage',jsonb_build_array(pg_temp.plain_row('shadow',pg_temp.future_day(1))),'shadow');

create temp table seed_context as select
 current_setting('app.class_close_mutation',true) close_context,
 current_setting('app.class_schedule_mutation',true) schedule_context;
insert into public.teacher_catalogs(id,name,subjects) values
 (pg_temp.fid(101),'C19 synthetic teacher 1',array['영어']),(pg_temp.fid(102),'C19 synthetic teacher 2',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.fid(201),'C19 synthetic room 1',array['영어']),(pg_temp.fid(202),'C19 synthetic room 2',array['영어']);
-- The existing close guard permits this owner-only fixture context. It remains
-- enabled and is restored as soon as synthetic closed-class seeding finishes.
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids)
 select pg_temp.fid(300+n),'C19 synthetic case '||n,'영어',status,storage_mode,schedule,teacher,
 'C19 synthetic room 1',jsonb_build_object('sessions',sessions),'[]'::jsonb from cases order by n;

-- Keep normalized closed history in the complete reader outside weekly admission.
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan,student_ids)
 values(pg_temp.fid(501),'C19 synthetic normalized history','영어','종강','normalized','{}','[]');
select set_config('app.class_close_mutation',coalesce((select close_context from seed_context),''),true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,
 start_time,end_time,teacher_catalog_id,classroom_catalog_id,teacher_name_snapshot,classroom_name_snapshot,origin,revision) values
 (pg_temp.fid(601),pg_temp.fid(501),'known',pg_temp.past_day(),'active','17:00','18:00',pg_temp.fid(101),pg_temp.fid(201),'','','manual',7),
 (pg_temp.fid(602),pg_temp.fid(501),'labels',pg_temp.future_day(1),'active','17:00','18:00',null,null,'  C19 synthetic teacher 1  ','  C19 synthetic room 1  ','legacy',3),
 (pg_temp.fid(603),pg_temp.fid(501),'partial',pg_temp.past_day()-7,'makeup','17:00','18:00',null,pg_temp.fid(201),'C19 missing teacher','','manual',2),
 (pg_temp.fid(604),pg_temp.fid(501),'fractional',pg_temp.past_day()-14,'exception','17:00:00.123','18:00',pg_temp.fid(101),pg_temp.fid(201),'','','manual',4),
 (pg_temp.fid(605),pg_temp.fid(501),'skipped',pg_temp.future_day(2),'skipped',null,null,null,null,'','','manual',1);
select set_config('app.class_schedule_mutation',coalesce((select schedule_context from seed_context),''),true);

-- Every guard remains enabled. Seeding supplies its own complete baseline.
update dashboard_private.timetable_operating_write_baselines
 set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table no_send as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.student_class_enrollment_history) enrollments,
 (select count(*) from public.dashboard_audit_logs) audits;
create temp table source_rows as select
 (select jsonb_agg(to_jsonb(c) order by c.id) from public.classes c
  where c.id in(select pg_temp.fid(300+n) from cases) or c.id=pg_temp.fid(501)) classes,
 (select jsonb_agg(to_jsonb(s) order by s.id) from public.class_lesson_sessions s where s.class_id=pg_temp.fid(501)) lessons;

create function pg_temp.reader_outcome(use_control boolean) returns jsonb
 language plpgsql stable security definer set search_path='' as $f$
declare reference jsonb;
begin
 if use_control then reference:=pg_temp.c15_reference();
 else reference:=dashboard_private.read_timetable_operating_reference_v1();end if;
 return jsonb_build_object('sqlstate','00000','reference',reference);
exception when others then return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end $f$;
create temp table reader_result as select pg_temp.reader_outcome(true) before_outcome,pg_temp.reader_outcome(false) after_outcome;
alter table reader_result add column before_reference jsonb;
alter table reader_result add column after_reference jsonb;
update reader_result set before_reference=before_outcome->'reference',after_reference=after_outcome->'reference';
select is(before_outcome->>'sqlstate','00000','C15 handles malformed fixture parsers with exact SQLSTATE00000') from reader_result;
select is(after_outcome->>'sqlstate','00000','installed candidate retains handled-parser SQLSTATE00000') from reader_result;
select is(after_reference,before_reference,'complete reader JSONB equals frozen C15') from reader_result;
select is(after_reference->>'datedFingerprint',before_reference->>'datedFingerprint','dated fingerprint equals frozen C15') from reader_result;
select is(after_reference->>'shadowFingerprint',before_reference->>'shadowFingerprint','complete shadow fingerprint equals frozen C15') from reader_result;
select is(
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(after_reference->'datedSessions') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(before_reference->'datedSessions') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 label||': dated payload and order') from cases order by n;
select is(
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,jsonb_array_elements(before_reference->'datedUnresolvedOccupancies') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text),
 label||': blocker payload and order') from cases order by n;

create function pg_temp.dated_for(n int) returns jsonb language sql stable as
$$select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,
 jsonb_array_elements(after_reference->'datedSessions') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text$$;
create function pg_temp.blockers_for(n int) returns jsonb language sql stable as
$$select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) from reader_result,
 jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') with ordinality e(v,ord) where v->>'classId'=pg_temp.fid(300+n)::text$$;

-- Fixed expectations prevent shared control/candidate mistakes from passing.
select is(jsonb_array_length(pg_temp.dated_for(1)),1,'plain future inherits while past remains unknown');
select is(jsonb_array_length(pg_temp.blockers_for(1)),1,'past plain row retains one dated blocker');
select is(jsonb_array_length(pg_temp.dated_for(2)),5,'every repeated future row uses current defaults');
select is(pg_temp.blockers_for(3)->0->'startMinute','null'::jsonb,'unmatched weekday keeps time unknown');
select is(pg_temp.blockers_for(3)->0->>'teacherId',pg_temp.fid(101)::text,'unmatched single pair retains teacher');
select is(pg_temp.blockers_for(3)->0->>'classroomId',pg_temp.fid(201)::text,'unmatched single pair retains room');
select is(jsonb_array_length(pg_temp.dated_for(4)),0,'past plain row never inherits');
select is(pg_temp.blockers_for(5)->0->>'reason','unresolved_resource','bounded unknown remains resource uncertainty');
select is(pg_temp.blockers_for(5)->0->'weekday','0'::jsonb,'Sunday weekday zero remains present in inherited unknown occupancy');
select is(pg_temp.blockers_for(5)->0->'startMinute','0'::jsonb,'midnight zero remains a known bound');
select is(pg_temp.blockers_for(5)->0->'endMinute','1440'::jsonb,'24-hour endpoint remains a known bound');
select is(pg_temp.blockers_for(5)->0->'teacherId','null'::jsonb,'unknown teacher stays NULL');
select is(pg_temp.blockers_for(5)->0->>'classroomId',pg_temp.fid(201)::text,'bounded unknown retains known room');
select is(jsonb_array_length(pg_temp.dated_for(6)),0,'empty defaults cannot create inherited occupancy');
select ok((pg_temp.blockers_for(6)->0) @> '{"startMinute":null,"endMinute":null,"teacherId":null,"classroomId":null}'::jsonb,'empty defaults grant no resources');
select is(jsonb_array_length(pg_temp.dated_for(7)),0,'global incomplete defaults block known-slot inheritance');
select ok((pg_temp.blockers_for(7)->0) @> '{"startMinute":null,"endMinute":null,"teacherId":null,"classroomId":null}'::jsonb,'global incomplete defaults remain conservative');
select is((select jsonb_agg(v->'startMinute' order by ord) from jsonb_array_elements(pg_temp.dated_for(8)) with ordinality e(v,ord)),
 '[660,540,540]'::jsonb,'weekday membership preserves original order and duplicates');
select is(jsonb_array_length(pg_temp.dated_for(8)),3,'weekly duplicates retain multiplicity');
select is((select count(distinct v->>'id') from jsonb_array_elements(pg_temp.dated_for(8)) v),2::bigint,'duplicate slot identity remains duplicated');
select ok((pg_temp.blockers_for(9)->0) @> '{"teacherId":null,"classroomId":null}'::jsonb,'mixed pairs cannot populate unmatched resources');
select is((select count(*) from jsonb_array_elements(pg_temp.dated_for(10)||pg_temp.dated_for(11)||pg_temp.dated_for(12)) v where v->>'state'='skipped'),3::bigint,'unique skipped exception and tbd rows preserve cancellation');
select is(jsonb_array_length(pg_temp.dated_for(13)||pg_temp.dated_for(14)),0,'duplicate identity or date cannot cancel');
select is(jsonb_array_length(pg_temp.blockers_for(13)||pg_temp.blockers_for(14)),4,'duplicate cancellation inputs remain four blockers');
select ok(pg_temp.dated_for(15)->0->>'overriddenWeeklySlotId' is not null,'unique explicit regular override is preserved');
select ok(not ((pg_temp.dated_for(16)->0) ? 'overriddenWeeklySlotId'),'multiple defaults cannot imply unique override');
select is(jsonb_array_length(pg_temp.dated_for(17)),1,'closed explicit historical occupancy remains present');
select is(jsonb_array_length(pg_temp.blockers_for(17)),1,'closed plain historical uncertainty remains present');
select ok(not exists(select 1 from reader_result,jsonb_array_elements(after_reference->'shadowClasses') c where c->>'id' in(pg_temp.fid(317)::text,pg_temp.fid(341)::text)),'closed classes stay outside weekly admission');
select ok((select bool_and(v->'date'='null'::jsonb) from jsonb_array_elements(pg_temp.blockers_for(18)||pg_temp.blockers_for(19)||pg_temp.blockers_for(20)||pg_temp.blockers_for(21)) v),'NULL missing empty and invalid dates stay explicitly undated');
select ok((pg_temp.blockers_for(22)->0) @> '{"startMinute":null,"endMinute":null,"teacherId":null,"classroomId":null}'::jsonb,'invalid time retains early parser boundary');
select is(pg_temp.blockers_for(23)->0->>'teacherId',pg_temp.fid(101)::text,'partial valid teacher survives fallback');
select is(pg_temp.blockers_for(23)->0->'startMinute','570'::jsonb,'partial valid interval survives fallback');
select is(pg_temp.blockers_for(24)->0->'teacherId','null'::jsonb,'malformed teacher UUID remains unresolved');
select is(pg_temp.blockers_for(25)->0->>'teacherId',pg_temp.fid(101)::text,'malformed room UUID retains parsed teacher');
select is(jsonb_array_length(pg_temp.dated_for(26)||pg_temp.dated_for(27)||pg_temp.dated_for(28)||pg_temp.dated_for(29)||pg_temp.dated_for(38)||pg_temp.dated_for(39)),0,'forced linked empty-identity present-null unknown-state and unmarked rows cannot inherit');
select is(jsonb_array_length(pg_temp.blockers_for(30)),1,'scalar lesson retains one handled blocker');
select ok(not ((pg_temp.blockers_for(31)->0) ? 'occupancyFingerprint'),'nonarray sessions retain class-level blocker');
select is(jsonb_array_length(pg_temp.dated_for(32)),0,'oversized schedule cannot create inherited occupancy');
select is(jsonb_array_length(pg_temp.blockers_for(34)),0,'empty history adds no dated blocker for incomplete defaults');
select ok((pg_temp.blockers_for(35)->0) @> '{"teacherId":null,"classroomId":null}'::jsonb,'unknown defaults from another weekday grant no resources');
select is(jsonb_array_length(pg_temp.dated_for(36)),2,'matched weekday keeps both mixed-resource slots');
select is(pg_temp.blockers_for(37)->0->>'teacherId',pg_temp.fid(101)::text,'multiple intervals with one pair retain unmatched teacher');
select is(pg_temp.blockers_for(43)->0->>'classroomId',pg_temp.fid(201)::text,'one pair across weekdays retains unmatched room');
select ok(exists(select 1 from reader_result,jsonb_array_elements(after_reference->'shadowClasses') c where c->>'id'=pg_temp.fid(340)::text),'academic active alias stays admitted weekly');
select is(jsonb_array_length(pg_temp.dated_for(41)),1,'closed future history keeps existing dated semantics');
select is(jsonb_array_length(pg_temp.dated_for(42)),1,'shadow storage keeps legacy inheritance');
select is(jsonb_array_length(pg_temp.dated_for(44)||pg_temp.blockers_for(44)),0,'empty complete history stays empty');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'classId'=pg_temp.fid(501)::text),5::bigint,'normalized closed history keeps all five source rows');
select is((select v->>'teacherId' from reader_result,jsonb_array_elements(after_reference->'datedSessions') v where v->>'id'='session:'||pg_temp.fid(602)::text),pg_temp.fid(101)::text,'normalized trimmed-label fallback stays unchanged');
select is((select count(*) from reader_result,jsonb_array_elements(after_reference->'datedUnresolvedOccupancies') v where v->>'classId'=pg_temp.fid(501)::text),2::bigint,'normalized partial and fractional rows stay unresolved');

-- Keep final-schema constraints rather than inventing unreachable reader errors.
select ok(exists(select 1 from pg_constraint where conrelid='public.classes'::regclass
 and conname='classes_start_date_canonical_check' and contype='c'),
 'final-schema canonical class-date check is installed');
select throws_ok($q$update public.classes set start_date='not-a-date' where id=pg_temp.fid(301)$q$,
 '23514',null,'canonical class-date check retains exact SQLSTATE23514');

-- The deliberate metadata edit and its audit are rolled back before returning.
-- Only the sentinel is caught: a setup/read failure cannot masquerade as parity.
create function pg_temp.fresh_metadata_case() returns jsonb language plpgsql as $f$
declare result jsonb; before_control jsonb; before_candidate jsonb; after_control jsonb; after_candidate jsonb;
begin
 begin
  before_control:=pg_temp.c15_reference();
  before_candidate:=dashboard_private.read_timetable_operating_reference_v1();
  update public.classes set name='C19 synthetic changed metadata' where id=pg_temp.fid(301);
  after_control:=pg_temp.c15_reference();
  after_candidate:=dashboard_private.read_timetable_operating_reference_v1();
  result:=jsonb_build_object('beforeEqual',before_candidate=before_control,'afterEqual',after_candidate=after_control,
   'freshFingerprint',before_candidate->>'shadowFingerprint' is distinct from after_candidate->>'shadowFingerprint');
  raise exception using errcode='Z1901',message='synthetic_metadata_rollback';
 exception when sqlstate 'Z1901' then null;
 end;
 return result;
end $f$;
create temp table fresh_result as select pg_temp.fresh_metadata_case() value;
select is(value->'beforeEqual','true'::jsonb,'freshness probe starts with full control parity') from fresh_result;
select is(value->'afterEqual','true'::jsonb,'new invocation keeps control parity after metadata edit') from fresh_result;
select is(value->'freshFingerprint','true'::jsonb,'new invocation recomputes full metadata fingerprint') from fresh_result;

select is((select jsonb_agg(to_jsonb(c) order by c.id) from public.classes c where c.id in(select pg_temp.fid(300+n) from cases) or c.id=pg_temp.fid(501)),
 (select classes from source_rows),'reader and rollbacked probes preserve every synthetic class field');
select is((select jsonb_agg(to_jsonb(s) order by s.id) from public.class_lesson_sessions s where s.class_id=pg_temp.fid(501)),
 (select lessons from source_rows),'reader preserves every normalized source field');
select is((select count(*) from dashboard_private.notification_events),(select events from no_send),'reader creates no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from no_send),'reader creates no delivery');
select is((select count(*) from public.student_class_enrollment_history),(select enrollments from no_send),'reader changes no enrollment history');
select is((select count(*) from public.dashboard_audit_logs),(select audits from no_send),'reader and probes leave no audit record');
select is((select provolatile::text from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),'s','reader remains STABLE');
select is(encode(extensions.digest((select prosrc from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),'sha256'),'hex'),
 '1138c86e711b05d4a89f95ab1db72953a81612657e5ffceb18109f5cf54ac789',
 'assertions execute the exact final C19 reader body');
select ok((select prosecdef from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),'reader remains SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),
 'reader retains empty search_path');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),'postgres'::name,'reader retains private owner');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_operating_reference_v1()','execute'),'authenticated cannot execute private reader');
select ok(not has_function_privilege('anon','dashboard_private.read_timetable_operating_reference_v1()','execute'),'anon cannot execute private reader');

select * from finish();
rollback;
