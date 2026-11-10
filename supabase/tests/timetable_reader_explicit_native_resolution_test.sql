begin;
set local statement_timeout='8s';
set local timezone='Asia/Seoul';
set local datestyle='ISO, MDY';
select no_plan();

-- Exact frozen final fe872 reader. Existing C12/C15 controls intentionally
-- change dated semantics and cannot serve as this optimization's parity oracle.
-- Source 20261006103004_timetable_date_override_lookup_reuse.sql.
create or replace function pg_temp.original_explicit_batch_reader()
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

select is(md5((select prosrc from pg_proc where oid='pg_temp.original_explicit_batch_reader()'::regprocedure)),
 '2ec758b210741c41f12eee81e21f34e4','control is the exact final fe872 reader body');
create function pg_temp.bid(n int) returns uuid language sql immutable as
$$select ('eb130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.batch_day(delta int default 0) returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date+delta$$;
create function pg_temp.explicit_row(ident text,delta int default 0,native_probe boolean default false) returns jsonb language sql stable as
$$select jsonb_build_object('id',ident,'date',pg_temp.batch_day(delta),'scheduleState','active','isForced',false,
 'startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.bid(101),'classroomCatalogId',pg_temp.bid(201),'_nativeProbe',native_probe)$$;

create temp table protected_contract as
select p.oid,p.oid::regprocedure::text signature,p.prosrc,p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.proparallel,p.prolang,p.prorettype
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='dashboard_private' and p.proname in('read_timetable_operating_reference_v1','read_timetable_weekly_reference_v1',
 'read_timetable_class_weekly_v2','legacy_effective_context_v1','legacy_effective_input_v1','legacy_effective_binding_v1',
 'resolve_legacy_effective_schedule_v1','timetable_effective_date_v1','timetable_occupancy_key_v1',
 'validate_timetable_operating_reference_v1','assert_timetable_operational_conflicts_v1',
 'capture_timetable_operating_baseline_v1','finalize_timetable_operating_transaction_v1'))
or (n.nspname='public' and p.proname in('close_class_atomic_v1','update_class_operational_v1'));
create temp table saved_helpers(signature text primary key,definition text not null);
insert into saved_helpers values
 ('dashboard_private.legacy_effective_input_v1(jsonb,jsonb,jsonb,integer,integer)',pg_get_functiondef('dashboard_private.legacy_effective_input_v1(jsonb,jsonb,jsonb,integer,integer)'::regprocedure)),
 ('dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)',pg_get_functiondef('dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)'::regprocedure));

create temp table batch_cases(n int primary key,label text not null,sessions jsonb not null,
 schedule text not null default '월 09:00-10:00',status text not null default '수강',mode text not null default 'legacy',date_map jsonb);
insert into batch_cases(n,label,sessions) values
 (1,'ordinary explicit',jsonb_build_array(pg_temp.explicit_row('native-ordinary',-1,true))),
 (2,'trimmed UUID and time',jsonb_build_array(pg_temp.explicit_row('native-trimmed',0,true)||jsonb_build_object('startTime',' 9:00 ','endTime',' 10:00 ','teacherCatalogId',' '||pg_temp.bid(101)::text||' ','classroomCatalogId',' '||pg_temp.bid(201)::text||' '))),
 (3,'zero seconds and zero fraction',jsonb_build_array(pg_temp.explicit_row('native-zero-seconds',1,true)||'{"startTime":"09:00:00.0000","endTime":"10:00:00"}')),
 (4,'full day midnight endpoint',jsonb_build_array(pg_temp.explicit_row('native-midnight',2,true)||'{"startTime":"00:00","endTime":"24:00:00.000"}')),
 (5,'valid IDs take precedence over invalid names',jsonb_build_array(pg_temp.explicit_row('native-name-precedence',3,true)||'{"teacherName":"missing teacher","classroomName":null}')),
 (6,'absent isForced',jsonb_build_array(pg_temp.explicit_row('native-no-forced-marker',4,true)-'isForced')),
 (7,'hidden catalog remains occupancy',jsonb_build_array(pg_temp.explicit_row('native-hidden',5,true)||jsonb_build_object('teacherCatalogId',pg_temp.bid(103),'classroomCatalogId',pg_temp.bid(203)))),
 (8,'empty primary state uses secondary active',jsonb_build_array(pg_temp.explicit_row('native-secondary-state',6,true)||'{"scheduleState":"","state":"active"}')),
 (9,'NULL id uses unique sessionKey',jsonb_build_array(pg_temp.explicit_row('native-key',7,true)||'{"id":null,"sessionKey":"native-key"}')),
 (10,'missing id uses unique sessionKey',jsonb_build_array((pg_temp.explicit_row('native-key-missing',8,true)-'id')||'{"sessionKey":"native-key-missing"}'));
insert into batch_cases(n,label,sessions,status,mode) values
 (11,'closed explicit past history',jsonb_build_array(pg_temp.explicit_row('native-closed',-300,true)),'종강','legacy'),
 (12,'shadow explicit retained history',jsonb_build_array(pg_temp.explicit_row('native-shadow',-7,true)),'수강','shadow'),
 (13,'preparing explicit history',jsonb_build_array(pg_temp.explicit_row('native-preparing',30,true)),'수업 준비 중','legacy');

-- Each present/absent field shape is a real reader fallback, not a resolver mock.
insert into batch_cases(n,label,sessions)
select 20+f.ord::int*5+t.ord::int,'field '||field||' is '||kind,
 jsonb_build_array(case kind when 'absent' then pg_temp.explicit_row('field-'||field||'-'||kind)-field
 else pg_temp.explicit_row('field-'||field||'-'||kind)||jsonb_build_object(field,value) end)
from unnest(array['startTime','endTime','teacherCatalogId','classroomCatalogId']) with ordinality f(field,ord)
cross join (values(0,'absent',null::jsonb),(1,'null','null'::jsonb),(2,'empty','""'::jsonb),(3,'number','1'::jsonb),(4,'object','{}'::jsonb)) t(ord,kind,value);
insert into batch_cases(n,label,sessions) values
 (50,'uppercase UUID must not be normalized',jsonb_build_array(pg_temp.explicit_row('uppercase-id')||jsonb_build_object('teacherCatalogId',upper(pg_temp.bid(101)::text)))),
 (51,'unknown valid UUID suppresses known name',jsonb_build_array(pg_temp.explicit_row('unknown-id')||jsonb_build_object('teacherCatalogId',pg_temp.bid(999),'teacherName','Batch teacher'))),
 (52,'malformed UUID suppresses known name',jsonb_build_array(pg_temp.explicit_row('malformed-id')||'{"teacherCatalogId":"not-a-uuid","teacherName":"Batch teacher"}')),
 (53,'unique trimmed names',jsonb_build_array((pg_temp.explicit_row('name-only')-array['teacherCatalogId','classroomCatalogId'])||'{"teacherName":" Batch teacher ","classroomName":" Batch room "}')),
 (54,'ambiguous names remain unknown',jsonb_build_array((pg_temp.explicit_row('ambiguous-name')-array['teacherCatalogId','classroomCatalogId'])||'{"teacherName":"Duplicate teacher","classroomName":"Duplicate room"}')),
 (55,'name case mismatch remains unknown',jsonb_build_array((pg_temp.explicit_row('case-name')-'teacherCatalogId')||'{"teacherName":"batch teacher"}')),
 (56,'empty identity cannot use valid sessionKey count',jsonb_build_array(pg_temp.explicit_row('empty-id')||'{"id":"","sessionKey":"valid-key"}')),
 (57,'nonstring numeric identity remains generic',jsonb_build_array(pg_temp.explicit_row('numeric-id')||'{"id":1}')),
 (58,'nonstring object identity remains generic',jsonb_build_array(pg_temp.explicit_row('object-id')||'{"id":{"key":"value"}}')),
 (59,'absent identity',jsonb_build_array(pg_temp.explicit_row('missing-id')-'id'));
insert into batch_cases(n,label,sessions)
select 60+ord,'time syntax '||label,jsonb_build_array(pg_temp.explicit_row('time-'||ord)||patch)
from (values
 (0,'start24','{"startTime":"24:00","endTime":"24:00"}'::jsonb),
 (1,'end24-nonzero-minute','{"endTime":"24:01"}'),(2,'nonzero-seconds','{"startTime":"09:00:01"}'),
 (3,'submicrosecond-fraction','{"startTime":"09:00:00.00000001"}'),(4,'end-submicrosecond','{"endTime":"10:00:00.00000001"}'),
 (5,'minute-overflow','{"startTime":"09:60"}'),(6,'hour-overflow','{"endTime":"25:00"}'),
 (7,'equal-range','{"startTime":"10:00","endTime":"10:00"}'),(8,'reversed-range','{"startTime":"11:00","endTime":"10:00"}'),
 (9,'tabs-not-btrim-spaces','{"startTime":"\t09:00\t"}'),(10,'newline-not-btrim-spaces','{"endTime":"10:00\n"}'),
 (11,'string-array','{"startTime":["09:00"]}'),(12,'boolean','{"endTime":true}'),
 (13,'short-minute','{"startTime":"9:0"}'),(14,'huge-hour','{"startTime":"999999999999:00"}')
) t(ord,label,patch);
insert into batch_cases(n,label,sessions)
select 80+k.ord::int*2+v.ord,'linked key '||key||' present '||kind,
 jsonb_build_array(pg_temp.explicit_row('linked-'||key||'-'||kind)||jsonb_build_object(key,value))
from unnest(array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id']) with ordinality k(key,ord)
cross join (values(0,'null','null'::jsonb),(1,'empty','""'::jsonb)) v(ord,kind,value);
insert into batch_cases(n,label,sessions) values
 (100,'makeup state',jsonb_build_array(pg_temp.explicit_row('makeup')||'{"scheduleState":"makeup"}')),
 (101,'forced JSON true',jsonb_build_array(pg_temp.explicit_row('forced')||'{"isForced":true}')),
 (102,'forced string false',jsonb_build_array(pg_temp.explicit_row('forced-string')||'{"isForced":"false"}')),
 (103,'NULL forced marker',jsonb_build_array(pg_temp.explicit_row('forced-null')||'{"isForced":null}')),
 (104,'original date linkage',jsonb_build_array(pg_temp.explicit_row('original-linked')||jsonb_build_object('originalDate',pg_temp.batch_day(-1)))),
 (105,'makeup date linkage',jsonb_build_array(pg_temp.explicit_row('makeup-linked')||jsonb_build_object('makeupDate',pg_temp.batch_day(1)))),
 (106,'unknown state',jsonb_build_array(pg_temp.explicit_row('unknown-state')||'{"scheduleState":"unknown-state"}')),
 (107,'unique cancelled exception',jsonb_build_array(pg_temp.explicit_row('cancel-exception')||'{"scheduleState":"exception"}')),
 (108,'unique cancelled skipped',jsonb_build_array(pg_temp.explicit_row('cancel-skipped')||'{"scheduleState":"skipped"}')),
 (109,'unique cancelled tbd',jsonb_build_array(pg_temp.explicit_row('cancel-tbd')||'{"scheduleState":"tbd"}')),
 (110,'noncanonical date',jsonb_build_array(pg_temp.explicit_row('date-noncanonical')||'{"date":"2026-1-1"}')),
 (111,'invalid date retains known components',jsonb_build_array(pg_temp.explicit_row('date-invalid')||'{"date":"2026-02-30"}')),
 (112,'NULL date',jsonb_build_array(pg_temp.explicit_row('date-null')||'{"date":null}')),
 (113,'missing date',jsonb_build_array(pg_temp.explicit_row('date-missing')-'date')),
 (114,'duplicate identity across dates',jsonb_build_array(pg_temp.explicit_row('duplicate-id'),pg_temp.explicit_row('duplicate-id',1))),
 (115,'same date distinct identities',jsonb_build_array(pg_temp.explicit_row('same-date-first'),pg_temp.explicit_row('same-date-second'))),
 (116,'empty sessions','[]'),(117,'NULL sessions','null'),(118,'scalar sessions','"bad"'),(119,'object sessions','{}'),
 (120,'scalar and array entries',jsonb_build_array('"scalar"'::jsonb,'null'::jsonb,'[]'::jsonb)),
 (121,'plain inherited row',jsonb_build_array(pg_temp.explicit_row('inherited')-array['startTime','endTime','teacherCatalogId','classroomCatalogId'])),
 (122,'partial explicit field',jsonb_build_array(pg_temp.explicit_row('partial')-array['endTime','teacherCatalogId','classroomCatalogId']));
insert into batch_cases(n,label,sessions,date_map) values
 (130,'empty object date override',jsonb_build_array(pg_temp.explicit_row('empty-map')),jsonb_build_object(pg_temp.batch_day()::text,'{}'::jsonb)),
 (131,'date override replaces explicit fields',jsonb_build_array(pg_temp.explicit_row('full-map')),jsonb_build_object(pg_temp.batch_day()::text,jsonb_build_object('startTime','11:00','endTime','12:00','teacherCatalogId',pg_temp.bid(102),'classroomCatalogId',pg_temp.bid(202)))),
 (132,'partial date override',jsonb_build_array(pg_temp.explicit_row('partial-map')),jsonb_build_object(pg_temp.batch_day()::text,'{"startTime":"08:00"}'::jsonb)),
 (133,'date override clear',jsonb_build_array(pg_temp.explicit_row('clear-map')),jsonb_build_object(pg_temp.batch_day()::text,'{"teacherCatalogId":null}'::jsonb)),
 (134,'date override cannot identify duplicate date',jsonb_build_array(pg_temp.explicit_row('map-dup-a'),pg_temp.explicit_row('map-dup-b')),jsonb_build_object(pg_temp.batch_day()::text,jsonb_build_object('teacherCatalogId',pg_temp.bid(102)))),
 (135,'JSON null date override is not object',jsonb_build_array(pg_temp.explicit_row('null-map',0,true)),jsonb_build_object(pg_temp.batch_day()::text,'null'::jsonb));
insert into batch_cases(n,label,sessions,schedule) values
 (140,'multiple weekly slots cannot infer override',jsonb_build_array(pg_temp.explicit_row('multiple-weekly',0,true)),'월 09:00-10:00; 월 11:00-12:00'),
 (141,'incomplete weekly producer stays present',jsonb_build_array(pg_temp.explicit_row('incomplete-weekly',0,true)),'월 09:00-10:00; malformed fragment'),
 (142,'empty weekly producer',jsonb_build_array(pg_temp.explicit_row('no-weekly',0,true)),''),
 (143,'weekly duplicate multiplicity',jsonb_build_array(pg_temp.explicit_row('duplicate-weekly')-array['startTime','endTime','teacherCatalogId','classroomCatalogId']),'월 09:00-10:00; 월 09:00-10:00');
insert into batch_cases(n,label,sessions) values
 (150,'interleaved native and fallback order',jsonb_build_array(pg_temp.explicit_row('mixed-native-a',0,true),
  pg_temp.explicit_row('mixed-name',1)-'teacherCatalogId'||'{"teacherName":"Batch teacher"}',
  pg_temp.explicit_row('mixed-native-b',2,true),pg_temp.explicit_row('mixed-invalid',3)||'{"teacherCatalogId":null}',
  pg_temp.explicit_row('mixed-cancel',4)||'{"scheduleState":"skipped"}',pg_temp.explicit_row('mixed-duplicate',5),pg_temp.explicit_row('mixed-duplicate',6),
  pg_temp.explicit_row('mixed-native-c',7,true)));

-- Real native-path call instrumentation delegates to the original functions;
-- it is confined to this rolled-back test and absent from all timing evidence.
create sequence pg_temp.native_input_calls;
create sequence pg_temp.native_resolver_calls;
-- These four unique-date explicit rows now use the approved date-override
-- native path. Track them separately so all remaining fallback counts stay exact.
create sequence pg_temp.date_override_input_calls;
create sequence pg_temp.date_override_resolver_calls;
create sequence pg_temp.generic_input_calls;
create sequence pg_temp.generic_resolver_calls;
create sequence pg_temp.approval_input_calls;
create sequence pg_temp.approval_resolver_calls;
do $p$begin
 execute replace(pg_get_functiondef('dashboard_private.legacy_effective_input_v1(jsonb,jsonb,jsonb,integer,integer)'::regprocedure),'dashboard_private.legacy_effective_input_v1(','pg_temp.original_batch_input(');
 execute replace(pg_get_functiondef('dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)'::regprocedure),'dashboard_private.resolve_legacy_effective_schedule_v1(','pg_temp.original_batch_resolver(');
end $p$;
create or replace function dashboard_private.legacy_effective_input_v1(p_plan jsonb,p_session jsonb,p_context jsonb,p_identity_count int,p_date_count int)
returns jsonb language plpgsql immutable security invoker set search_path='' as $p$
begin
 if p_session->>'id'='makeup-request:eb130000-0000-4000-8000-000000910040:0' then perform nextval('pg_temp.approval_input_calls');end if;
 if p_session->'_nativeProbe'='true'::jsonb then perform nextval('pg_temp.native_input_calls');
 elsif p_session->>'id'=any(array['empty-map','full-map','partial-map','clear-map']) then perform nextval('pg_temp.date_override_input_calls');
 else perform nextval('pg_temp.generic_input_calls');end if;
 return pg_temp.original_batch_input(p_plan,p_session,p_context,p_identity_count,p_date_count);
end $p$;
create or replace function dashboard_private.resolve_legacy_effective_schedule_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $p$
begin
 if p#>>'{session,id}'='makeup-request:eb130000-0000-4000-8000-000000910040:0' then perform nextval('pg_temp.approval_resolver_calls');end if;
 if p#>'{session,_nativeProbe}'='true'::jsonb then perform nextval('pg_temp.native_resolver_calls');
 elsif p#>>'{session,id}'=any(array['empty-map','full-map','partial-map','clear-map']) then perform nextval('pg_temp.date_override_resolver_calls');
 else perform nextval('pg_temp.generic_resolver_calls');end if;
 return pg_temp.original_batch_resolver(p);
end $p$;
create function pg_temp.reset_probes() returns void language plpgsql as $p$begin
 perform setval('pg_temp.native_input_calls',1,false);perform setval('pg_temp.native_resolver_calls',1,false);
 perform setval('pg_temp.date_override_input_calls',1,false);perform setval('pg_temp.date_override_resolver_calls',1,false);
 perform setval('pg_temp.generic_input_calls',1,false);perform setval('pg_temp.generic_resolver_calls',1,false);
 perform setval('pg_temp.approval_input_calls',1,false);perform setval('pg_temp.approval_resolver_calls',1,false);
end $p$;
create function pg_temp.probes() returns jsonb language sql as $p$
select jsonb_build_object('nativeInput',(select case when is_called then last_value else 0 end from pg_temp.native_input_calls),
 'nativeResolver',(select case when is_called then last_value else 0 end from pg_temp.native_resolver_calls),
 'dateOverrideInput',(select case when is_called then last_value else 0 end from pg_temp.date_override_input_calls),
 'dateOverrideResolver',(select case when is_called then last_value else 0 end from pg_temp.date_override_resolver_calls),
 'genericInput',(select case when is_called then last_value else 0 end from pg_temp.generic_input_calls),
 'genericResolver',(select case when is_called then last_value else 0 end from pg_temp.generic_resolver_calls),
 'approvalInput',(select case when is_called then last_value else 0 end from pg_temp.approval_input_calls),
 'approvalResolver',(select case when is_called then last_value else 0 end from pg_temp.approval_resolver_calls))
$p$;

-- Actual server approval, calendar proof and source freshness; setup payload
-- bootstrap is restored exactly before all reader captures.
set local role postgres;

create function pg_temp.ebr_approval_id(n int) returns uuid
language sql immutable as $id$
 select ('eb130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$id$;
create function pg_temp.ebr_owned_lesson() returns text
language sql immutable as $id$
 select 'makeup-request:'||pg_temp.ebr_approval_id(910040)::text||':0'
$id$;
create temp table ebr_approval_original_writer as
 select pg_get_functiondef('dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)'::regprocedure) ddl;
create temp table ebr_approval_original_claims as
 select current_setting('request.jwt.claim.sub',true) sub,
        current_setting('request.jwt.claim.role',true) role,
        current_setting('request.jwt.claims',true) claims;
create temp table ebr_approval_deliveries_before as
 select count(*) n from dashboard_private.notification_deliveries;

-- BEGIN CURRENT MAKEUP PAYLOAD WRITER
create or replace function dashboard_private.notification_makeup_payload_v1(
  p_request_id uuid,
  p_source_event_id uuid,
  p_event_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'makeup_request_id', request.id,
    'process', case p_event_key
      when 'makeup.submitted' then '신청 제출'
      when 'makeup.refund_requested' then '환불 신청'
      when 'makeup.approved' then '결재 승인'
      when 'makeup.refund_completed' then '환불 완료'
      when 'makeup.approval_canceled' then '승인 취소'
      when 'makeup.revision_requested' then '보완 요청'
      when 'makeup.rejected' then '반려'
      when 'makeup.deleted' then '삭제'
      else p_event_key
    end,
    'status', case request.status
      when 'approval_pending' then '결재자 승인 대기'
      when 'revision_requested' then '보완 요청'
      when 'rejected' then '반려'
      when 'manager_pending' then '이전 관리팀 전달'
      when 'makeup_pending' then '보강대기'
      when 'refund_pending' then '환불대기'
      when 'completed' then '완료'
      when 'canceled' then '승인 취소'
      else request.status
    end,
    'workflow_status', request.status,
    'request_kind', request.request_kind,
    'class_name', request.class_name,
    'subject', request.subject,
    'approval_group', request.approval_group,
    'subject_team_key', request.approval_group,
    'teacher_name', teacher.name,
    'reason', request.reason,
    'memo', request.final_note,
    'event_note', source_event.note,
    'cancel_date', request.cancel_date,
    'makeup_schedule', coalesce(
      nullif(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'start_at', coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at'),
              'end_at', coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at'),
              'place', coalesce(
                nullif(pg_catalog.btrim(coalesce(
                  slot.value ->> 'classroom', slot.value ->> 'place', slot.value ->> 'room'
                )), ''),
                nullif(pg_catalog.btrim(request.makeup_classroom), '')
              )
            ))
            order by slot.ordinality
          )
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
              then request.makeup_slots else '[]'::jsonb end
          ) with ordinality slot(value, ordinality)
        ),
        '[]'::jsonb
      ),
      case when request.makeup_start_at is not null
        then pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'start_at', request.makeup_start_at,
            'end_at', request.makeup_end_at,
            'place', nullif(pg_catalog.btrim(request.makeup_classroom), '')
          )
        ))
        else '[]'::jsonb
      end
    ),
    'makeup_places', coalesce(
      (
        select pg_catalog.jsonb_agg(place_row.place order by place_row.place)
        from (
          select distinct coalesce(
            nullif(pg_catalog.btrim(coalesce(
              slot.value ->> 'classroom', slot.value ->> 'place', slot.value ->> 'room'
            )), ''),
            nullif(pg_catalog.btrim(request.makeup_classroom), '')
          ) as place
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
              then request.makeup_slots else '[]'::jsonb end
          ) slot(value)
        ) place_row
        where place_row.place is not null
      ),
      case when nullif(pg_catalog.btrim(request.makeup_classroom), '') is null
        then '[]'::jsonb
        else pg_catalog.jsonb_build_array(pg_catalog.btrim(request.makeup_classroom))
      end
    ),
    'makeup_at', coalesce(
      (
        select pg_catalog.string_agg(
          coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at', '')
            || case when coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at', '') = ''
              then '' else ' - ' || coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at') end,
          ', ' order by slot.ordinality
        )
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
            then request.makeup_slots else '[]'::jsonb end
        ) with ordinality slot(value, ordinality)
      ),
      request.makeup_start_at::text
    ),
    'makeup_room_spaced', request.makeup_classroom,
    'makeup_room', request.makeup_classroom,
    'requester_name', requester.name,
    'approver_name', approver.name,
    'actor_name', actor.name,
    'requester_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.requester_id)
        then request.requester_id
      else null
    end,
    'approver_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.approver_profile_id)
        then request.approver_profile_id
      else null
    end,
    'management_profile_ids', (
      select coalesce(pg_catalog.jsonb_agg(profile.id order by profile.id), '[]'::jsonb)
      from public.profiles profile
      where profile.role in ('admin', 'staff')
        and dashboard_private.notification_profile_is_active_v1(profile.id)
    ),
    'submitted_at', coalesce(
      (
        select pg_catalog.max(history.created_at)
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type in ('submitted', 'resubmitted')
      ),
      request.created_at
    ),
    'revision_requested_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
    ),
    'revision_reason', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'approved_at', request.approved_at,
    'approval_note', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'approved'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.final_note
    ),
    'rejected_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'rejected'
    ),
    'rejected_reason', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'rejected'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.rejected_reason
    ),
    'canceled_at', request.canceled_at,
    'canceled_note', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type in ('approval_canceled', 'completed_canceled')
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'status_changed_at', source_event.created_at,
    'attachment_count', 0,
    'attachment_types', '[]'::jsonb,
    'fallback_title', '휴보강 알림',
    'fallback_body', request.class_name || ' · ' || request.status,
    'occurred_at', source_event.created_at
  ))
  from public.makeup_requests request
  join public.makeup_request_events source_event
    on source_event.id = p_source_event_id
   and source_event.request_id = request.id
  left join public.profiles requester on requester.id = request.requester_id
  left join public.profiles actor on actor.id = source_event.actor_id
  left join public.teacher_catalogs teacher on teacher.id = request.teacher_catalog_id
  left join public.teacher_catalogs approver on approver.id = request.approver_teacher_catalog_id
  where request.id = p_request_id;
$$;
-- END CURRENT MAKEUP PAYLOAD WRITER


insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.ebr_approval_id(910001),'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','explicit-batch-approval@test.invalid');
insert into public.profiles(id,role,name) values
 (pg_temp.ebr_approval_id(910001),'admin','Synthetic explicit batch approver')
 on conflict(id) do update set role=excluded.role;
-- Profile insertion can create its own teacher catalog row. Avoid a second
-- catalog for the same approver identity, as in the inherited approval fixture.
delete from public.teacher_catalogs where profile_id=pg_temp.ebr_approval_id(910001);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values
 (pg_temp.ebr_approval_id(910010),'EBR approver teacher',array['영어'],pg_temp.ebr_approval_id(910001)),
 (pg_temp.ebr_approval_id(910011),'EBR requested teacher',array['영어'],null);
update public.profiles set teacher_catalog_id=pg_temp.ebr_approval_id(910010) where id=pg_temp.ebr_approval_id(910001);
insert into dashboard_private.makeup_subject_directors_v1 values('영어',pg_temp.ebr_approval_id(910001),pg_temp.ebr_approval_id(910010));
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.ebr_approval_id(910020),'EBR conflicting map room',array['영어']),
 (pg_temp.ebr_approval_id(910021),'EBR approved room',array['영어']);

create temp table ebr_approval_fixture as
with original as (
 select jsonb_build_object('id','ebr-original','sessionKey','ebr-original',
  'date','2000-02-07','state','active','scheduleState','active','isForced',false,
  'originalDate','','makeupDate','','teacherNote','Retain synthetic lesson content') row_value
), plans as (
 select jsonb_build_object('sessions',jsonb_build_array(row_value),
   'sessionStates','{}'::jsonb) before_plan,
  jsonb_build_object('sessions',jsonb_build_array(
    row_value||jsonb_build_object('state','exception','scheduleState','exception',
      'makeupRequestId',pg_temp.ebr_approval_id(910040),'makeupRequestRole','cancel','memo','휴강'),
    jsonb_build_object('id',pg_temp.ebr_owned_lesson(),'sessionKey',pg_temp.ebr_owned_lesson(),
      'date','2000-02-08','state','makeup','scheduleState','makeup','isForced',false,
      'originalDate','2000-02-07','makeupDate','',
      'makeupRequestId',pg_temp.ebr_approval_id(910040),'makeupRequestRole','makeup',
      'memo','보강','progressStatus','pending','textbookEntries','[]'::jsonb)),
    'sessionStates',jsonb_build_object('2000-02-07',jsonb_build_object('state','exception','memo','휴강','makeupDate','')),
    -- Deliberately conflicts with the verified approved source. Request-owned
    -- rows must bypass the entire map object, rather than fill its missing keys.
    'sessionSchedules',jsonb_build_object('2000-02-08',jsonb_build_object(
      'startTime','09:00','endTime','10:00',
      'teacherCatalogId',pg_temp.ebr_approval_id(910010),
      'classroomCatalogId',pg_temp.ebr_approval_id(910020)))) after_plan
 from original
)
select before_plan,after_plan,
 jsonb_build_object('actor_profile_id',pg_temp.ebr_approval_id(910001),
  'final_note','Synthetic explicit batch approved source',
  'schedule_plan_before',before_plan,'schedule_plan_after',after_plan,
  'cancel_academic_event_id',pg_temp.ebr_approval_id(910050),
  'makeup_academic_event_id',pg_temp.ebr_approval_id(910051),
  'makeup_academic_event_ids',jsonb_build_array(pg_temp.ebr_approval_id(910051)),
  'calendar_events',jsonb_build_array(
   jsonb_build_object('id',pg_temp.ebr_approval_id(910050),'title','EBR synthetic cancellation',
    'date','2000-02-07','type','팁스','grade','all','note','[[TIPS_MAKEUP]] '||
      jsonb_build_object('kind','cancel','requestId',pg_temp.ebr_approval_id(910040),
       'className','EBR actual approved class','subject','영어','cancelDate','2000-02-07','reason','')::text),
   jsonb_build_object('id',pg_temp.ebr_approval_id(910051),'title','EBR synthetic makeup',
    'date','2000-02-08','type','팁스','grade','all','note','[[TIPS_MAKEUP]] '||
      jsonb_build_object('kind','makeup','requestId',pg_temp.ebr_approval_id(910040),
       'className','EBR actual approved class','subject','영어','classroom','EBR approved room',
       'startAt','2000-02-08T15:00:00+09:00','endAt','2000-02-08T17:00:00+09:00',
       'slotIndex',0,'reason','')::text))) patch
from plans;

insert into public.classes(id,name,subject,schedule_storage_mode,status,teacher,room,schedule,schedule_plan)
select pg_temp.ebr_approval_id(910030),'EBR actual approved class','영어','legacy','수강',
 'EBR requested teacher','EBR approved room','월 19:30-21:30; 화 19:30-21:30',before_plan
from ebr_approval_fixture;
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,
 class_id,class_name,teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,
 approver_profile_id,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.ebr_approval_id(910040),'approval_pending','cancel_makeup','영어','english',
 pg_temp.ebr_approval_id(910001),pg_temp.ebr_approval_id(910030),'EBR actual approved class',
 pg_temp.ebr_approval_id(910011),null,pg_temp.ebr_approval_id(910010),pg_temp.ebr_approval_id(910001),
 '2000-02-07','2000-02-08T15:00:00+09:00','2000-02-08T17:00:00+09:00','EBR approved room',
 '[{"startAt":"2000-02-08T15:00:00+09:00","endAt":"2000-02-08T17:00:00+09:00","classroom":"EBR approved room"}]');

-- Fixture admission occurs before the real approval, never during a reader
-- capture. The real approval then performs its original operational validation.
update dashboard_private.timetable_operating_write_baselines
 set reference=dashboard_private.read_timetable_operating_reference_v1()
 where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
grant select on ebr_approval_fixture to service_role;
create function pg_temp.ebr_approve() returns jsonb language sql as $approve$
 select public.transition_makeup_request_v2(pg_temp.ebr_approval_id(910040),'approve',
  patch,'approval_pending',pg_temp.ebr_approval_id(910060)) from ebr_approval_fixture
$approve$;
select set_config('request.jwt.claim.sub',pg_temp.ebr_approval_id(910001)::text,true);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ebr_approval_id(910001),'role','service_role')::text,true);
set local role service_role;
select lives_ok('select pg_temp.ebr_approve()','real server transition approves sparse request-owned makeup');
reset role;
set constraints all immediate;
set constraints all deferred;
do $restore_writer$ begin execute (select ddl from ebr_approval_original_writer);end $restore_writer$;
select is(pg_get_functiondef('dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)'::regprocedure),
 (select ddl from ebr_approval_original_writer),'approval fixture restores exact original payload writer');
select is((select status from public.makeup_requests where id=pg_temp.ebr_approval_id(910040)),
 'completed','real request is completed rather than fabricated context flags');
select is((select schedule_plan from public.classes where id=pg_temp.ebr_approval_id(910030)),
 (select after_plan from ebr_approval_fixture),'approval preserves exact sparse owned row and conflicting date map');

create function pg_temp.ebr_context() returns jsonb language sql stable as $ctx$
 select dashboard_private.legacy_effective_context_v1(c) from public.classes c
 where c.id=pg_temp.ebr_approval_id(910030)
$ctx$;
create function pg_temp.ebr_dated_rows(reference jsonb) returns jsonb language sql immutable as $rows$
 select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb)
 from jsonb_array_elements(reference->'datedSessions') x
 where x->>'classId'=pg_temp.ebr_approval_id(910030)::text and x->>'date'='2000-02-08'
$rows$;
create function pg_temp.ebr_expected_row(a int,b int) returns jsonb language sql immutable as $rows$
 select jsonb_build_array(jsonb_build_object('id','legacy-session:'||pg_temp.ebr_approval_id(910030)::text||':'||pg_temp.ebr_owned_lesson(),
  'classId',pg_temp.ebr_approval_id(910030),'sourceSlotId',null,'date','2000-02-08',
  'state','makeup','startMinute',a,'endMinute',b,
  'teacherId',pg_temp.ebr_approval_id(910011),'classroomId',pg_temp.ebr_approval_id(910021),'revision',0))
$rows$;
-- For parent harness integration: enforce generic-helper traces for exactly
-- this identity on each labelled reader capture, with the expected proof flag.
create temp table ebr_expected_generic(case_name text,lesson_id text,verified boolean);
insert into ebr_expected_generic values
 ('approved_sparse',pg_temp.ebr_owned_lesson(),true),
 ('bound_unverified',pg_temp.ebr_owned_lesson(),false),
 ('fresh_approved',pg_temp.ebr_owned_lesson(),true);
create temp table ebr_reference_captures(case_name text primary key,reference jsonb);

-- CASE 1: actual approval binding, no explicit time/resource fields; request
-- owns the row, so approved source wins over conflicting date-map and basics.
select is(pg_temp.ebr_context()#>>array['approvedByIdentity',pg_temp.ebr_owned_lesson(),'approvedOverrideVerified'],
 'true','adapter verifies real approval event, calendar, slot and owned binding');
select pg_temp.reset_probes();
insert into ebr_reference_captures values('approved_sparse',dashboard_private.read_timetable_operating_reference_v1());
select is((pg_temp.probes()->>'approvalInput')::int,1,'approved_sparse: actual server-bound lesson takes generic input');
select is((pg_temp.probes()->>'approvalResolver')::int,1,'approved_sparse: actual server-bound lesson takes generic resolver');
select is((select reference from ebr_reference_captures where case_name='approved_sparse'),pg_temp.original_explicit_batch_reader(),'approved_sparse: entire source-fresh reference matches frozen reader');
select is((select pg_temp.ebr_dated_rows(reference) from ebr_reference_captures where case_name='approved_sparse'),
 pg_temp.ebr_expected_row(900,1020),'sparse owned makeup uses approved 15:00-17:00 and approved identities');
select is((select count(*) from ebr_reference_captures,jsonb_array_elements(reference->'datedUnresolvedOccupancies') x
 where case_name='approved_sparse' and x->>'classId'=pg_temp.ebr_approval_id(910030)::text),
 0::bigint,'verified sparse source creates no unresolved blocker');

-- CASE 2: keep the valid after/current binding and request slot, but remove
-- actual calendar proof. It remains a bound UNVERIFIED source, never defaults.
savepoint ebr_bound_unverified;
update public.academic_events set note='[[TIPS_MAKEUP]] {}' where id=pg_temp.ebr_approval_id(910051);
select ok((pg_temp.ebr_context()->'approvedByIdentity') ? pg_temp.ebr_owned_lesson(),
 'broken calendar proof retains a bound source instead of deleting its binding');
select is(pg_temp.ebr_context()#>>array['approvedByIdentity',pg_temp.ebr_owned_lesson(),'approvedOverrideVerified'],
 'false','real adapter marks bound calendar-tampered source unverified');
select pg_temp.reset_probes();
insert into ebr_reference_captures values('bound_unverified',dashboard_private.read_timetable_operating_reference_v1());
select is((pg_temp.probes()->>'approvalInput')::int,1,'bound_unverified: actual server-bound lesson takes generic input');
select is((pg_temp.probes()->>'approvalResolver')::int,1,'bound_unverified: actual server-bound lesson takes generic resolver');
select is((select reference from ebr_reference_captures where case_name='bound_unverified'),pg_temp.original_explicit_batch_reader(),'bound_unverified: entire source-fresh reference matches frozen reader');
select is((select pg_temp.ebr_dated_rows(reference) from ebr_reference_captures where case_name='bound_unverified'),
 '[]'::jsonb,'unverified bound source cannot resolve from date map or weekly basics');
select is((select count(*) from ebr_reference_captures,jsonb_array_elements(reference->'datedUnresolvedOccupancies') x
 where case_name='bound_unverified' and x->>'classId'=pg_temp.ebr_approval_id(910030)::text and x->>'date'='2000-02-08'
 and x->>'startMinute' is null and x->>'endMinute' is null and x->>'teacherId' is null and x->>'classroomId' is null),
 1::bigint,'unverified source emits exactly one date-known blocker with all four values unknown');
select isnt((select reference->>'datedFingerprint' from ebr_reference_captures where case_name='bound_unverified'),
 (select reference->>'datedFingerprint' from ebr_reference_captures where case_name='approved_sparse'),
 'changing proof affects full dated fingerprint despite identical raw class plan');
rollback to ebr_bound_unverified;
release savepoint ebr_bound_unverified;

-- CASE 3: same raw plan/binding, changed real request slot + matching calendar
-- and approved event payload. This owner-only adversarial update is not another
-- business approval. It proves source reads are fresh rather than memoized.
savepoint ebr_fresh_approved;
update public.makeup_requests set
 makeup_start_at='2000-02-08T16:00:00+09:00',makeup_end_at='2000-02-08T18:00:00+09:00',
 makeup_slots='[{"startAt":"2000-02-08T16:00:00+09:00","endAt":"2000-02-08T18:00:00+09:00","classroom":"EBR approved room"}]'
where id=pg_temp.ebr_approval_id(910040);
update public.academic_events set note='[[TIPS_MAKEUP]] '||jsonb_build_object(
 'kind','makeup','requestId',pg_temp.ebr_approval_id(910040),'className','EBR actual approved class','subject','영어',
 'classroom','EBR approved room','startAt','2000-02-08T16:00:00+09:00','endAt','2000-02-08T18:00:00+09:00',
 'slotIndex',0,'reason','')::text where id=pg_temp.ebr_approval_id(910051);
update public.makeup_request_events set payload=jsonb_set(payload,'{makeup_schedule}',
 '[{"start_at":"2000-02-08T16:00:00+09:00","end_at":"2000-02-08T18:00:00+09:00","place":"EBR approved room"}]')
where id=(select id from public.makeup_request_events where request_id=pg_temp.ebr_approval_id(910040)
 and event_type='approved' order by created_at desc,id desc limit 1);
select is((select schedule_plan from public.classes where id=pg_temp.ebr_approval_id(910030)),
 (select after_plan from ebr_approval_fixture),'source freshness probe keeps entire raw plan identical');
select is(pg_temp.ebr_context()#>>array['approvedByIdentity',pg_temp.ebr_owned_lesson(),'approvedOverrideVerified'],
 'true','changed request/calendar/payload still pass real source verification');
select pg_temp.reset_probes();
insert into ebr_reference_captures values('fresh_approved',dashboard_private.read_timetable_operating_reference_v1());
select is((pg_temp.probes()->>'approvalInput')::int,1,'fresh_approved: actual server-bound lesson takes generic input');
select is((pg_temp.probes()->>'approvalResolver')::int,1,'fresh_approved: actual server-bound lesson takes generic resolver');
select is((select reference from ebr_reference_captures where case_name='fresh_approved'),pg_temp.original_explicit_batch_reader(),'fresh_approved: entire source-fresh reference matches frozen reader');
select is((select pg_temp.ebr_dated_rows(reference) from ebr_reference_captures where case_name='fresh_approved'),
 pg_temp.ebr_expected_row(960,1080),'next reader invocation observes fresh approved 16:00-18:00 source');
select isnt((select reference->>'shadowFingerprint' from ebr_reference_captures where case_name='fresh_approved'),
 (select reference->>'shadowFingerprint' from ebr_reference_captures where case_name='approved_sparse'),
 'fresh source values affect complete shadow fingerprint');
rollback to ebr_fresh_approved;
release savepoint ebr_fresh_approved;

select is((select count(*) from dashboard_private.notification_deliveries),
 (select n from ebr_approval_deliveries_before),'actual approval and adversarial reads dispatch no delivery');
select set_config('request.jwt.claim.sub',coalesce(sub,''),true),
       set_config('request.jwt.claim.role',coalesce(role,''),true),
       set_config('request.jwt.claims',coalesce(claims,''),true)
from ebr_approval_original_claims;



create temp table arrangement_context as select current_setting('app.class_close_mutation',true) close_context,current_setting('app.class_schedule_mutation',true) schedule_context;
insert into public.teacher_catalogs(id,name,subjects,is_visible) values
 (pg_temp.bid(101),'Batch teacher',array['영어'],true),(pg_temp.bid(102),'Other teacher',array['영어'],true),
 (pg_temp.bid(103),'Hidden teacher',array['영어'],false),(pg_temp.bid(104),'Duplicate teacher',array['영어'],true),(pg_temp.bid(105),' Duplicate teacher ',array['영어'],true);
insert into public.classroom_catalogs(id,name,subjects,is_visible) values
 (pg_temp.bid(201),'Batch room',array['영어'],true),(pg_temp.bid(202),'Other room',array['영어'],true),
 (pg_temp.bid(203),'Hidden room',array['영어'],false),(pg_temp.bid(204),'Duplicate room',array['영어'],true),(pg_temp.bid(205),' Duplicate room ',array['영어'],true);
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan,student_ids)
select pg_temp.bid(10000+n),'Batch case '||n,'영어',status,mode,schedule,'Batch teacher','Batch room',
 jsonb_build_object('sessions',sessions)||case when date_map is not null then jsonb_build_object('sessionSchedules',date_map) else '{}'::jsonb end,'[]'
from batch_cases order by n desc;
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan,student_ids)
values(pg_temp.bid(20000),'Batch normalized history','영어','종강','normalized',jsonb_build_object('sessions',jsonb_build_array(pg_temp.explicit_row('ignored-legacy'))),'[]');
select set_config('app.class_close_mutation',coalesce((select close_context from arrangement_context),''),true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,teacher_name_snapshot,classroom_name_snapshot,origin,revision) values
 (pg_temp.bid(21003),pg_temp.bid(20000),'partial',pg_temp.batch_day(-100),'makeup','09:00','10:00',null,pg_temp.bid(201),'missing','','manual',3),
 (pg_temp.bid(21002),pg_temp.bid(20000),'fractional',pg_temp.batch_day(-200),'exception','09:00:00.001','10:00',pg_temp.bid(101),pg_temp.bid(201),'','','manual',2),
 (pg_temp.bid(21001),pg_temp.bid(20000),'snapshot',pg_temp.batch_day(-300),'active','09:00','10:00',null,null,' Batch teacher ',' Batch room ','legacy',1);
select set_config('app.class_schedule_mutation',coalesce((select schedule_context from arrangement_context),''),true);
-- Existing guards stay enabled. This baseline is fixture arrangement only;
-- measured writer tests below never advance their captured original baseline.
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;

create temp table source_snapshot as select
 (select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id::text like 'eb130000-%') classes,
 (select jsonb_agg(to_jsonb(s) order by id) from public.class_lesson_sessions s where class_id=pg_temp.bid(20000)) lessons,
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.student_class_enrollment_history) enrollments,
 (select count(*) from public.dashboard_audit_logs) audits;
create function pg_temp.reader_result(control boolean) returns jsonb language plpgsql stable security definer set search_path='' as $p$
declare result jsonb; detail text; hint text;
begin
 if control then result:=pg_temp.original_explicit_batch_reader();else result:=dashboard_private.read_timetable_operating_reference_v1();end if;
 return jsonb_build_object('sqlstate','00000','reference',result);
exception when others then
 get stacked diagnostics detail=PG_EXCEPTION_DETAIL,hint=PG_EXCEPTION_HINT;
 return jsonb_build_object('sqlstate',SQLSTATE,'message',SQLERRM,'detail',detail,'hint',hint);
end $p$;
create temp table reader_pair as select pg_temp.reader_result(true) control,pg_temp.reader_result(false) candidate;
select is(control->>'sqlstate','00000','baseline reader handles the complete adversarial fixture') from reader_pair;
select is(candidate,control,'whole reference JSON and exact error envelope match frozen final reader') from reader_pair;
select is((candidate->'reference')::text,(control->'reference')::text,'canonical serialized reference matches without field exclusions') from reader_pair;
select is(candidate#>'{reference,datedSessions}',control#>'{reference,datedSessions}','dated session order and multiplicity match') from reader_pair;
select is(candidate#>'{reference,datedUnresolvedOccupancies}',control#>'{reference,datedUnresolvedOccupancies}','blocker order, known components and raw fingerprints match') from reader_pair;
select is(candidate#>'{reference,datedFingerprint}',control#>'{reference,datedFingerprint}','complete dated fingerprint matches') from reader_pair;
select is(candidate#>'{reference,shadowFingerprint}',control#>'{reference,shadowFingerprint}','complete shadow fingerprint matches') from reader_pair;
select is(candidate#>'{reference,datedComplete}',control#>'{reference,datedComplete}','dated completeness matches') from reader_pair;
create function pg_temp.case_dated(n int) returns jsonb language sql stable as
$$select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(candidate#>'{reference,datedSessions}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text$$;
create function pg_temp.case_blockers(n int) returns jsonb language sql stable as
$$select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(candidate#>'{reference,datedUnresolvedOccupancies}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text$$;
select is((select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(candidate#>'{reference,datedSessions}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(control#>'{reference,datedSessions}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text),label||': full dated rows') from batch_cases order by n;
select is((select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(candidate#>'{reference,datedUnresolvedOccupancies}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text),
 (select coalesce(jsonb_agg(v order by ord),'[]') from reader_pair cross join lateral jsonb_array_elements(control#>'{reference,datedUnresolvedOccupancies}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(10000+n)::text),label||': full blockers') from batch_cases order by n;
select is(jsonb_array_length(pg_temp.case_dated(50)),0,'uppercase UUID text stays unresolved');
select is(pg_temp.case_blockers(50)#>'{0,teacherId}','null'::jsonb,'uppercase UUID does not gain canonical catalog identity');
select is(pg_temp.case_dated(2)#>'{0,startMinute}','540'::jsonb,'trimmed one-digit hour retains minute normalization');
select is(pg_temp.case_dated(4)#>'{0,endMinute}','1440'::jsonb,'whole-day end remains 24:00');
select is(jsonb_array_length(pg_temp.case_dated(56)),0,'raw empty id/sessionKey count mismatch remains unresolved');
select is(jsonb_array_length(pg_temp.case_dated(9)),1,'JSON-null id can use unique sessionKey');
select is(jsonb_array_length(pg_temp.case_dated(10)),1,'missing id can use unique sessionKey');
select is(jsonb_array_length(pg_temp.case_dated(63)),0,'submicrosecond text does not round into a resolved row');
select is(pg_temp.case_blockers(63)#>'{0,startMinute}','null'::jsonb,'invalid start retains unknown start bound');
select is(pg_temp.case_blockers(63)#>'{0,endMinute}','600'::jsonb,'invalid start retains known end bound');
select is(jsonb_array_length(pg_temp.case_dated(115)),2,'same-date distinct identities retain multiplicity');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.case_dated(115)) v where v ? 'overriddenWeeklySlotId'),'same-date duplicates cannot acquire single-weekly suppression');
select is(pg_temp.case_dated(131)#>'{0,startMinute}','540'::jsonb,'explicit row start precedes the shared date fallback');
select is(pg_temp.case_dated(133)#>'{0,teacherId}',to_jsonb(pg_temp.bid(101)),'explicit row teacher precedes a shared date clear');
select is(jsonb_array_length(pg_temp.case_dated(114)),0,'duplicate identities remain diagnostics across dates');
select is(jsonb_array_length(pg_temp.case_blockers(114)),2,'duplicate identity diagnostics preserve multiplicity');
select is(jsonb_array_length(pg_temp.case_dated(11)),1,'closed past explicit history is retained');
select is(jsonb_array_length(pg_temp.case_dated(12)),1,'shadow storage explicit history is retained');
select is((select jsonb_agg(v->>'id' order by ord) from reader_pair cross join lateral jsonb_array_elements(candidate#>'{reference,datedSessions}') with ordinality e(v,ord) where v->>'classId'=pg_temp.bid(20000)::text),
 jsonb_build_array('session:'||pg_temp.bid(21001),'session:'||pg_temp.bid(21002),'session:'||pg_temp.bid(21003)),'normalized history retains UUID order ahead of legacy rows');

select pg_temp.reset_probes();
create temp table control_probe as select pg_temp.original_explicit_batch_reader() reference;
alter table control_probe add column calls jsonb;
update control_probe set calls=pg_temp.probes();
select ok((calls->>'nativeInput')::int>10,'frozen baseline really invokes input helper for ordinary explicit cohort') from control_probe;
select ok((calls->>'nativeResolver')::int>10,'frozen baseline really resolves ordinary explicit cohort') from control_probe;
select is((calls->>'dateOverrideInput')::int,4,'frozen baseline invokes input for all four eligible date-override rows') from control_probe;
select is((calls->>'dateOverrideResolver')::int,4,'frozen baseline resolves all four eligible date-override rows') from control_probe;
select pg_temp.reset_probes();
create temp table native_probe as select dashboard_private.read_timetable_operating_reference_v1() reference;
alter table native_probe add column calls jsonb;
update native_probe set calls=pg_temp.probes();
select is((select reference from native_probe),(select reference from control_probe),'instrumented reader remains exact whole-reference parity');
select is((select (calls->>'nativeInput')::int from native_probe),0,'native ordinary rows bypass actual generic input helper');
select is((select (calls->>'nativeResolver')::int from native_probe),0,'native ordinary rows bypass actual generic resolver');
select is((select (calls->>'dateOverrideInput')::int from native_probe),0,'eligible date overrides bypass actual generic input helper');
select is((select (calls->>'dateOverrideResolver')::int from native_probe),0,'eligible date overrides bypass actual generic resolver');
select is((select calls->'genericInput' from native_probe),(select calls->'genericInput' from control_probe),'every generic fallback still invokes original input path');
select is((select calls->'genericResolver' from native_probe),(select calls->'genericResolver' from control_probe),'every generic fallback still invokes original resolver path');

-- Owner-only synthetic private context tests exact tuple eligibility. Existing
-- real preview/save suites separately establish capability authorization.
insert into dashboard_private.timetable_operating_write_baselines(transaction_id,reference)
values(txid_current(),dashboard_private.read_timetable_operating_reference_v1()) on conflict(transaction_id) do nothing;
insert into dashboard_private.past_lesson_state_correction_contexts(transaction_id,actor_profile_id,class_id,lesson_id,session_date,corrected_plan,target_occupancy,reviewed_blockers,review_hash)
values(txid_current(),pg_temp.bid(901),pg_temp.bid(10001),'native-ordinary',pg_temp.batch_day(-1),'{}','{}','[]','synthetic test context');
select pg_temp.reset_probes();
select is(dashboard_private.read_timetable_operating_reference_v1(),pg_temp.original_explicit_batch_reader(),'matching past context preserves complete output');
-- Evaluate candidate separately from control so counts identify actual selection.
select pg_temp.reset_probes();
select count(*) from (select dashboard_private.read_timetable_operating_reference_v1() reference) q where reference is not null;
select is((pg_temp.probes()->>'nativeInput')::int,1,'only matching past context row falls back to generic input');
select is((pg_temp.probes()->>'nativeResolver')::int,1,'only matching past context row falls back to generic resolver');
update dashboard_private.past_lesson_state_correction_contexts set lesson_id='different-lesson';
select pg_temp.reset_probes();
select count(*) from (select dashboard_private.read_timetable_operating_reference_v1() reference) q where reference is not null;
select is((pg_temp.probes()->>'nativeResolver')::int,0,'unrelated context does not exclude ordinary native rows');
delete from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current();
delete from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();

do $p$declare row record;begin for row in select definition from saved_helpers loop execute row.definition;end loop;end $p$;
select ok(not exists(select 1 from protected_contract s join pg_proc p on p.oid=s.oid where
 row(p.proowner,p.proacl,p.provolatile,p.prosecdef,p.proconfig,p.proparallel,p.prolang,p.prorettype)
 is distinct from row(s.proowner,s.proacl,s.provolatile,s.prosecdef,s.proconfig,s.proparallel,s.prolang,s.prorettype)),
 'all protected function contracts and helper ACLs are restored exactly');
select ok(not exists(select 1 from protected_contract s join pg_proc p on p.oid=s.oid where p.prosrc is distinct from s.prosrc),
 'test instrumentation restores every original installed function body');
select ok(not has_function_privilege('anon','dashboard_private.read_timetable_operating_reference_v1()','EXECUTE'),'anon has no private reader execution');
select ok(not has_function_privilege('authenticated','dashboard_private.read_timetable_operating_reference_v1()','EXECUTE'),'authenticated has no private reader execution');
select ok(not has_function_privilege('service_role','dashboard_private.read_timetable_operating_reference_v1()','EXECUTE'),'service role gains no private reader execution');
set local role authenticated;
select throws_ok('select dashboard_private.read_timetable_operating_reference_v1()','42501',null,'actual authenticated direct private reader call denied');
reset role;
set local role anon;
select throws_ok('select dashboard_private.read_timetable_operating_reference_v1()','42501',null,'actual anon direct private reader call denied');
reset role;

select is(pg_temp.reader_result(false),pg_temp.reader_result(true),'unwrapped final reader retains whole-reference parity');
set local datestyle='ISO, DMY';
set local timezone='UTC';
select is(pg_temp.reader_result(false),pg_temp.reader_result(true),'DateStyle and TimeZone changes preserve original reader result');
set local datestyle='ISO, MDY';
set local timezone='Asia/Seoul';
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id::text like 'eb130000-%'),(select classes from source_snapshot),'reader leaves immutable full class source unchanged');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.class_lesson_sessions s where class_id=pg_temp.bid(20000)),(select lessons from source_snapshot),'reader leaves normalized historical source unchanged');
select is((select count(*) from dashboard_private.notification_events),(select events from source_snapshot),'reader creates no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from source_snapshot),'reader creates no delivery');
select is((select count(*) from public.student_class_enrollment_history),(select enrollments from source_snapshot),'reader changes no enrollment history');
select is((select count(*) from public.dashboard_audit_logs),(select audits from source_snapshot),'reader creates no audit entry');
select * from finish();
rollback;

