-- Full ordered-schema regression for the final installed reader. All rows are
-- synthetic and rolled back. This file does not install product helper mocks.
-- The frozen bc52 reader below changes only its function identity; it calls the
-- same current PR247 context/resolver as the installed candidate. Whole DTO text
-- equality includes array order, unresolved diagnostics and both fingerprints.
begin;
set local statement_timeout='8s';
set local timezone='UTC';
set local datestyle='ISO, MDY';
select no_plan();

select is(md5((select prosrc from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure)),
 '297fe1400b5313adbd978ea859d98fbb','regression targets the exact final date-override reader body');
create temp table date_override_reader_contract as
select p.oid,to_jsonb(p) definition from pg_proc p
where p.oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure;

create function pg_temp.reader_migration_sql(direction text) returns text language sql immutable as $function$
 select case direction
 when 'forward' then $forward$do $date_override_native_reader$
declare
  target oid := to_regprocedure('dashboard_private.read_timetable_operating_reference_v1()');
  original_body text;
  candidate_body text;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  patch record;
begin
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into original_body, metadata_before
    from pg_catalog.pg_proc p where p.oid = target;
  if metadata_before is null
    or md5(original_body) is distinct from 'bc52c94595c5b2cb294f2c1eebbb6bcc' then
    raise exception 'date_override_native_reader_definition_drift' using errcode = '55000';
  end if;
  candidate_body := original_body;
  for patch in select * from (values
    ($before0$start_hour int; end_hour int;$before0$, $after0$start_hour int; end_hour int; native_values jsonb; date_override jsonb;$after0$),
    ($before1$ native_resolved:=false;effective_input:=null;effective:=null;
$before1$, $after1$ native_resolved:=false;effective_input:=null;effective:=null;
 native_values:=v;
 date_override:=lookup_plan#>array['sessionSchedules',v->>'date'];
 if jsonb_typeof(date_override)='object' then
   -- Field presence owns priority: explicit null/invalid values never inherit.
   -- Keep the original row and plan intact for generic fallback and fingerprints.
   native_values:=jsonb_build_object(
     'startTime',case when v ? 'startTime' then v->'startTime' else date_override->'startTime' end,
     'endTime',case when v ? 'endTime' then v->'endTime' else date_override->'endTime' end,
     'teacherCatalogId',case when v ? 'teacherCatalogId' then v->'teacherCatalogId' else date_override->'teacherCatalogId' end,
     'classroomCatalogId',case when v ? 'classroomCatalogId' then v->'classroomCatalogId' else date_override->'classroomCatalogId' end);
 end if;
$after1$),
    ($before2$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and jsonb_typeof(lookup_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'$before2$, $after2$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and (jsonb_typeof(date_override) is distinct from 'object'
         or (v->'classroomUnresolved' is distinct from 'true'::jsonb
             and date_override->'classroomUnresolved' is distinct from 'true'::jsonb))$after2$),
    ($before3$    and jsonb_typeof(v->'startTime')='string' and jsonb_typeof(v->'endTime')='string'
    and jsonb_typeof(v->'teacherCatalogId')='string' and jsonb_typeof(v->'classroomCatalogId')='string' then
   start_text:=btrim(v->>'startTime');end_text:=btrim(v->>'endTime');
   teacher_text:=btrim(v->>'teacherCatalogId');room_text:=btrim(v->>'classroomCatalogId');
$before3$, $after3$    and jsonb_typeof(native_values->'startTime')='string' and jsonb_typeof(native_values->'endTime')='string'
    and jsonb_typeof(native_values->'teacherCatalogId')='string' and jsonb_typeof(native_values->'classroomCatalogId')='string' then
   start_text:=btrim(native_values->>'startTime');end_text:=btrim(native_values->>'endTime');
   teacher_text:=btrim(native_values->>'teacherCatalogId');room_text:=btrim(native_values->>'classroomCatalogId');
$after3$)
  ) changes(before_text, after_text) loop
    if length(candidate_body) - length(replace(candidate_body, patch.before_text, ''))
      <> length(patch.before_text) then
      raise exception 'date_override_native_reader_anchor_drift' using errcode = '55000';
    end if;
    candidate_body := replace(candidate_body, patch.before_text, patch.after_text);
  end loop;
  if md5(candidate_body) is distinct from '297fe1400b5313adbd978ea859d98fbb' then
    raise exception 'date_override_native_reader_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, original_body, '')) <> length(original_body) then
    raise exception 'date_override_native_reader_definition_drift' using errcode = '55000';
  end if;
  -- Retain the actual installed header, owner, ACL and per-function settings.
  execute replace(definition, original_body, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '297fe1400b5313adbd978ea859d98fbb'
    or metadata_after is distinct from metadata_before then
    raise exception 'date_override_native_reader_metadata_drift' using errcode = '55000';
  end if;
end
$date_override_native_reader$;$forward$
 when 'rollback' then $rollback$do $date_override_native_reader_rollback$
declare
  target oid := to_regprocedure('dashboard_private.read_timetable_operating_reference_v1()');
  original_body text;
  candidate_body text;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  patch record;
begin
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into original_body, metadata_before
    from pg_catalog.pg_proc p where p.oid = target;
  if metadata_before is null
    or md5(original_body) is distinct from '297fe1400b5313adbd978ea859d98fbb' then
    raise exception 'date_override_native_reader_rollback_definition_drift' using errcode = '55000';
  end if;
  candidate_body := original_body;
  for patch in select * from (values
    ($before0$    and jsonb_typeof(native_values->'startTime')='string' and jsonb_typeof(native_values->'endTime')='string'
    and jsonb_typeof(native_values->'teacherCatalogId')='string' and jsonb_typeof(native_values->'classroomCatalogId')='string' then
   start_text:=btrim(native_values->>'startTime');end_text:=btrim(native_values->>'endTime');
   teacher_text:=btrim(native_values->>'teacherCatalogId');room_text:=btrim(native_values->>'classroomCatalogId');
$before0$, $after0$    and jsonb_typeof(v->'startTime')='string' and jsonb_typeof(v->'endTime')='string'
    and jsonb_typeof(v->'teacherCatalogId')='string' and jsonb_typeof(v->'classroomCatalogId')='string' then
   start_text:=btrim(v->>'startTime');end_text:=btrim(v->>'endTime');
   teacher_text:=btrim(v->>'teacherCatalogId');room_text:=btrim(v->>'classroomCatalogId');
$after0$),
    ($before1$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and (jsonb_typeof(date_override) is distinct from 'object'
         or (v->'classroomUnresolved' is distinct from 'true'::jsonb
             and date_override->'classroomUnresolved' is distinct from 'true'::jsonb))$before1$, $after1$    and not (v ?| array['sourceSlotId','makeupRequestId','makeupRequestRole','makeupOf','makeupOfLessonId','makeupOfSessionId','makeup_of_session_id'])
    and jsonb_typeof(lookup_plan#>array['sessionSchedules',v->>'date']) is distinct from 'object'$after1$),
    ($before2$ native_resolved:=false;effective_input:=null;effective:=null;
 native_values:=v;
 date_override:=lookup_plan#>array['sessionSchedules',v->>'date'];
 if jsonb_typeof(date_override)='object' then
   -- Field presence owns priority: explicit null/invalid values never inherit.
   -- Keep the original row and plan intact for generic fallback and fingerprints.
   native_values:=jsonb_build_object(
     'startTime',case when v ? 'startTime' then v->'startTime' else date_override->'startTime' end,
     'endTime',case when v ? 'endTime' then v->'endTime' else date_override->'endTime' end,
     'teacherCatalogId',case when v ? 'teacherCatalogId' then v->'teacherCatalogId' else date_override->'teacherCatalogId' end,
     'classroomCatalogId',case when v ? 'classroomCatalogId' then v->'classroomCatalogId' else date_override->'classroomCatalogId' end);
 end if;
$before2$, $after2$ native_resolved:=false;effective_input:=null;effective:=null;
$after2$),
    ($before3$start_hour int; end_hour int; native_values jsonb; date_override jsonb;$before3$, $after3$start_hour int; end_hour int;$after3$)
  ) changes(before_text, after_text) loop
    if length(candidate_body) - length(replace(candidate_body, patch.before_text, ''))
      <> length(patch.before_text) then
      raise exception 'date_override_native_reader_rollback_anchor_drift' using errcode = '55000';
    end if;
    candidate_body := replace(candidate_body, patch.before_text, patch.after_text);
  end loop;
  if md5(candidate_body) is distinct from 'bc52c94595c5b2cb294f2c1eebbb6bcc' then
    raise exception 'date_override_native_reader_rollback_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, original_body, '')) <> length(original_body) then
    raise exception 'date_override_native_reader_rollback_definition_drift' using errcode = '55000';
  end if;
  -- Retain the actual installed header, owner, ACL and per-function settings.
  execute replace(definition, original_body, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from 'bc52c94595c5b2cb294f2c1eebbb6bcc'
    or metadata_after is distinct from metadata_before then
    raise exception 'date_override_native_reader_rollback_metadata_drift' using errcode = '55000';
  end if;
end
$date_override_native_reader_rollback$;$rollback$
 end
$function$;
create function pg_temp.reader_exec_state(command text) returns jsonb language plpgsql as $function$
declare s text;m text;begin
 execute command;return jsonb_build_object('state','00000','message','');
exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text;
 return jsonb_build_object('state',s,'message',m);
end $function$;
create function pg_temp.reader_lifecycle_checks() returns table(passed boolean,label text) language plpgsql as $function$
declare target oid:='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure;
 saved_definition text:=pg_get_functiondef(target);saved_body text;original_metadata jsonb;actual_metadata jsonb;
 expected_base constant text:='bc52c94595c5b2cb294f2c1eebbb6bcc';expected_candidate constant text:='297fe1400b5313adbd978ea859d98fbb';
 result jsonb;snapshot_body text;snapshot_metadata jsonb;command text;
begin
 select prosrc,to_jsonb(p)-'prosrc'-'prosqlbody' into saved_body,original_metadata from pg_proc p where oid=target;
 return query select md5(saved_body)=expected_candidate,'lifecycle starts at reviewed candidate';
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('rollback'));
 return query select result->>'state'='00000','recovery restores the baseline';
 return query select md5(prosrc)=expected_base and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'recovery preserves exact OID, owner, ACL and every nonbody attribute' from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('rollback'));
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_rollback_definition_drift'),
  'repeat recovery rejects exact 55000 and definition drift message';
 -- Altered artifact inputs must fail before replacing the function.
 command:=replace(pg_temp.reader_migration_sql('forward'),'$before0$start_hour int; end_hour int;$before0$','$before0$missing anchor$before0$');
 result:=pg_temp.reader_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_anchor_drift'),
  'missing exact anchor rejects before replacement';
 command:=replace(pg_temp.reader_migration_sql('forward'),'native_values:=v;','native_values:=v /* invalid candidate */;');
 result:=pg_temp.reader_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_candidate_drift'),
  'altered candidate bytes reject exact 55000';
 -- An unexpected attribute mutation must roll back the whole DO subtransaction.
 command:=replace(pg_temp.reader_migration_sql('forward'),
  'execute replace(definition, original_body, candidate_body);',
  'execute replace(definition, original_body, candidate_body); alter function dashboard_private.read_timetable_operating_reference_v1() cost 137;');
 result:=pg_temp.reader_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_metadata_drift'),
  'metadata drift rejects exact 55000';
 return query select md5(prosrc)=expected_base and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'all rejected mutations leave complete baseline state intact' from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('forward'));
 return query select result->>'state'='00000','actual forward DO applies to exact baseline';
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'forward installs exact candidate with complete metadata preserved' from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_definition_drift'),
  'reapplication fails closed with exact SQLSTATE and message';
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'reapplication failure does not change installed state' from pg_proc p where oid=target;
 execute replace(saved_definition,saved_body,saved_body||E'\n-- synthetic body drift\n');
 select prosrc,to_jsonb(p)-'prosrc'-'prosqlbody' into snapshot_body,snapshot_metadata from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('rollback'));
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_rollback_definition_drift'),
  'recovery refuses an intervening body change';
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_definition_drift'),
  'forward refuses an intervening body change';
 return query select prosrc=snapshot_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'unknown body is never overwritten' from pg_proc p where oid=target;
 execute saved_definition;
 alter function dashboard_private.read_timetable_operating_reference_v1() rename to issue234_reader_temporarily_missing;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','date_override_native_reader_definition_drift'),
  'missing target rejects before DDL';
 alter function dashboard_private.issue234_reader_temporarily_missing() rename to read_timetable_operating_reference_v1;
 -- Nondefault legitimate attributes must be preserved, not reset to defaults.
 perform pg_temp.reader_exec_state(pg_temp.reader_migration_sql('rollback'));
 alter function dashboard_private.read_timetable_operating_reference_v1() cost 139;
 alter function dashboard_private.read_timetable_operating_reference_v1() set work_mem='6MB';
 select to_jsonb(p)-'prosrc'-'prosqlbody' into snapshot_metadata from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('forward'));
 return query select result->>'state'='00000' and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'forward retains installed nondefault cost and runtime configuration' from pg_proc p where oid=target;
 result:=pg_temp.reader_exec_state(pg_temp.reader_migration_sql('rollback'));
 return query select result->>'state'='00000' and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'recovery retains installed nondefault cost and runtime configuration' from pg_proc p where oid=target;
 execute saved_definition;
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'lifecycle leaves exact original candidate and metadata for following tests' from pg_proc p where oid=target;
end $function$;

create temporary table reader_lifecycle_results on commit drop as select * from pg_temp.reader_lifecycle_checks();
select is((select count(*) from reader_lifecycle_results),19::bigint,'all nineteen lifecycle checks execute');
select ok(passed,label) from reader_lifecycle_results;


-- Exact pre-change reader: /workspace catalog artifact body MD5 bc52c945...
-- No namespace or helper substitution appears inside this frozen body.
create function pg_temp.date_override_baseline_reader()
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
 return dashboard_private.project_class_close_occupancy_v1(r||jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,'datedSessions',dated,'datedUnresolvedOccupancies',blockers,'datedComplete',jsonb_array_length(blockers)=0,'datedFingerprint',dated_hash,'shadowFingerprint',md5((r->>'shadowFingerprint')||((now() at time zone 'Asia/Seoul')::date)::text||dated_hash)));
end $f$;

select is(md5((select prosrc from pg_proc where oid='pg_temp.date_override_baseline_reader()'::regprocedure)),
 'bc52c94595c5b2cb294f2c1eebbb6bcc','baseline alias retains the exact pre-change reader body');
select ok(p.provolatile='s' and p.prosecdef and p.prorettype='jsonb'::regtype and p.pronargs=0
 and row(p.prolang,p.provolatile,p.prosecdef,p.proconfig,p.proparallel,p.prorettype,p.pronargs)
 is not distinct from row(b.prolang,b.provolatile,b.prosecdef,b.proconfig,b.proparallel,b.prorettype,b.pronargs),
 'candidate retains the baseline stable SECURITY DEFINER header and empty search path')
from pg_proc p cross join pg_proc b
where p.oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure
 and b.oid='pg_temp.date_override_baseline_reader()'::regprocedure;
revoke all on function pg_temp.date_override_baseline_reader() from public,anon,authenticated,service_role;

create function pg_temp.ndid(n int) returns uuid language sql immutable as $$
 select ('af091109-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create temp table date_override_captures(label text primary key,candidate jsonb,baseline jsonb);
create function pg_temp.nd_rows(reference jsonb,class_n int,key text) returns jsonb language sql immutable as $$
 select coalesce(jsonb_agg(v order by ord),'[]'::jsonb)
 from jsonb_array_elements(reference->key) with ordinality e(v,ord)
 where v->>'classId'=pg_temp.ndid(class_n)::text
$$;

-- Five unique historical dates isolate row priority, mixed field inheritance,
-- explicit null, and both row/map unresolved-resource generic fallbacks.
insert into public.teacher_catalogs(id,name,subjects) values
 (pg_temp.ndid(11),'Native override row teacher',array['영어']),
 (pg_temp.ndid(12),'Native override map teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.ndid(21),'Native override row room',array['영어']),
 (pg_temp.ndid(22),'Native override map room',array['영어']);
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.ndid(31),'Native override mixed','영어','Native override row teacher','Native override row room',
 '월 08:00-09:00','수강','legacy',jsonb_build_object(
 'sessions',jsonb_build_array(
  jsonb_build_object('id','row-wins','date','2001-01-01','scheduleState','active','startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.ndid(11),'classroomCatalogId',pg_temp.ndid(21)),
  jsonb_build_object('id','mixed-fields','date','2001-01-02','scheduleState','active','startTime','09:30','teacherCatalogId',pg_temp.ndid(11)),
  jsonb_build_object('id','explicit-null','date','2001-01-03','scheduleState','active','startTime',null),
  jsonb_build_object('id','map-unresolved','date','2001-01-04','scheduleState','active'),
  jsonb_build_object('id','row-unresolved','date','2001-01-05','scheduleState','active','classroomCatalogId',pg_temp.ndid(21),'classroomUnresolved',true)),
 'sessionSchedules',(select jsonb_object_agg(d::text,
   jsonb_build_object('startTime','11:00','endTime','12:00','teacherCatalogId',pg_temp.ndid(12),'classroomCatalogId',pg_temp.ndid(22))
   ||case when d=date '2001-01-04' then '{"classroomUnresolved":true}'::jsonb else '{}'::jsonb end)
  from generate_series(date '2001-01-01',date '2001-01-05',interval '1 day') g(ts)
  cross join lateral (select ts::date d) dates)));
-- Fixture admission only, following the existing isolated reader/adoption suites.
-- All product triggers remain enabled; no baseline is changed during captures.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
insert into date_override_captures values('mixed',dashboard_private.read_timetable_operating_reference_v1(),pg_temp.date_override_baseline_reader());
select is(candidate::text,baseline::text,'mixed override whole DTO, ordering and fingerprints match baseline')
from date_override_captures where label='mixed';
select is((select jsonb_agg(jsonb_build_array(v->>'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId') order by v->>'date')
 from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,31,'datedSessions')) v where label='mixed'),
 jsonb_build_array(jsonb_build_array('2001-01-01',540,600,pg_temp.ndid(11),pg_temp.ndid(21)),
                   jsonb_build_array('2001-01-02',570,720,pg_temp.ndid(11),pg_temp.ndid(22))),
 'explicit row values win; missing fields inherit independently from the date map');
select is((select jsonb_agg(jsonb_build_array(v->>'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId') order by v->>'date')
 from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,31,'datedUnresolvedOccupancies')) v where label='mixed'),
 jsonb_build_array(jsonb_build_array('2001-01-03',null,720,pg_temp.ndid(12),pg_temp.ndid(22)),
                   jsonb_build_array('2001-01-04',660,720,pg_temp.ndid(12),null),
                   jsonb_build_array('2001-01-05',660,720,pg_temp.ndid(12),null)),
 'present null does not inherit; row and map unresolved flags retain date-known blockers');

-- A real PR247 approval establishes the source; no resolver/context, notification
-- producer or writer is replaced. The independent expected plan is the small
-- adoption fixture's ownership/resource delta, with its real updated_at value.
create function pg_temp.date_override_adoption_plan() returns jsonb language sql immutable as $f$ select $j${"subject":"영어","className":"Native override adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]}$j$::jsonb $f$;

create function pg_temp.nd_expected(p_request jsonb) returns jsonb language sql immutable as $f$
 select jsonb_set(jsonb_set(pg_temp.date_override_adoption_plan(),'{sessions,0}',
  pg_temp.date_override_adoption_plan()#>'{sessions,0}'||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','cancel')),
  '{sessions,1}',pg_temp.date_override_adoption_plan()#>'{sessions,1}'||jsonb_build_object(
   'makeupRequestId',p_request->>'id','makeupRequestRole','makeup',
   'makeupAdoption',jsonb_build_object('version',1,'requestUpdatedAt',p_request->>'updated_at','originalId','legacy-original-alpha','makeupId','legacy-makeup-alpha'),
   'startTime','18:00','endTime','20:00','teacherCatalogId',pg_temp.ndid(1),'teacherName','Native override adoption teacher',
   'classroomCatalogId',pg_temp.ndid(2),'classroomName','Native override adoption room'))
$f$;
insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.ndid(801),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','native-override-adoption@synthetic.invalid');
insert into public.profiles(id,role,name) values(pg_temp.ndid(801),'admin','Native override adoption actor')
on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id=pg_temp.ndid(801);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values
 (pg_temp.ndid(1),'Native override adoption teacher',array['영어'],pg_temp.ndid(801));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.ndid(2),'Native override adoption room',array['영어']);
update public.profiles set teacher_catalog_id=pg_temp.ndid(1) where id=pg_temp.ndid(801);
insert into dashboard_private.makeup_subject_directors_v1 values('영어',pg_temp.ndid(801),pg_temp.ndid(1));
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.ndid(4),'Native override adoption','영어','Native override adoption teacher','Native override adoption room',
 '수금 19:30-21:30','수강','legacy',pg_temp.date_override_adoption_plan());
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,
 teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,
 makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.ndid(3),'approval_pending','cancel_makeup','영어','english',pg_temp.ndid(801),pg_temp.ndid(4),
 'Native override adoption',pg_temp.ndid(1),pg_temp.ndid(801),pg_temp.ndid(1),pg_temp.ndid(801),'2050-10-20',
 '2050-10-06T09:00:00Z','2050-10-06T11:00:00Z','Native override adoption room',
 '[{"startAt":"2050-10-06T18:00:00+09:00","endAt":"2050-10-06T20:00:00+09:00","classroom":"Native override adoption room"}]');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table date_override_initial_request as select to_jsonb(r) value from public.makeup_requests r where id=pg_temp.ndid(3);
create temp table date_override_no_send as select count(*) deliveries from dashboard_private.notification_deliveries;
select set_config('test.native_override_patch',jsonb_build_object(
 'actor_profile_id',pg_temp.ndid(801),'final_note','Synthetic native override adoption',
 'schedule_plan_before',pg_temp.date_override_adoption_plan(),'schedule_plan_after',pg_temp.nd_expected(value),
 'cancel_academic_event_id',pg_temp.ndid(100),'makeup_academic_event_id',pg_temp.ndid(101),'makeup_academic_event_ids',jsonb_build_array(pg_temp.ndid(101)),
 'calendar_events',jsonb_build_array(
  jsonb_build_object('id',pg_temp.ndid(100),'title','[휴강] Native override adoption','date','2050-10-20','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','cancel','requestId',pg_temp.ndid(3),'className','Native override adoption','subject','영어','cancelDate','2050-10-20','reason','')::text),
  jsonb_build_object('id',pg_temp.ndid(101),'title','[보강] Native override adoption','date','2050-10-06','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','makeup','requestId',pg_temp.ndid(3),'className','Native override adoption','subject','영어',
    'classroom','Native override adoption room','startAt','2050-10-06T18:00:00+09:00','endAt','2050-10-06T20:00:00+09:00','slotIndex',0,'reason','')::text)))::text,true)
from date_override_initial_request;
select set_config('request.jwt.claim.sub',pg_temp.ndid(801)::text,true),
 set_config('request.jwt.claim.role','service_role',true),
 set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ndid(801),'role','service_role')::text,true);
set local role service_role;
select lives_ok($$select public.transition_makeup_request_v2(pg_temp.ndid(3),'approve',
 current_setting('test.native_override_patch')::jsonb,'approval_pending',pg_temp.ndid(210))$$,
 'actual final approval writer admits the synthetic legacy pair');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.ndid(4)),
 (select pg_temp.nd_expected(value) from date_override_initial_request),'actual approval preserves the independently expected adoption plan');

-- Sparse current scalar fields retain the exact adopted binding. The current
-- helper intentionally compares identity/provenance, so approval supplies them.
-- This read fixture has no date map; a failed proof cannot inherit four defaults.
savepoint date_override_sparse;
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,1}',
 (schedule_plan#>'{sessions,1}')-array['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])
where id=pg_temp.ndid(4);
create function pg_temp.nd_context() returns jsonb language sql stable as $$
 select dashboard_private.legacy_effective_context_v1(c) from public.classes c where id=pg_temp.ndid(4)
$$;
select is(jsonb_build_array(pg_temp.nd_context()#>'{approvedByIdentity,legacy-makeup-alpha,approvedOverrideVerified}',
 pg_temp.nd_context()#>'{approvedByIdentity,legacy-makeup-alpha,legacyAdoptionVerified}),'[true,true]'::jsonb,
 'actual current context independently verifies sparse adopted identity and approval');
insert into date_override_captures values('adopted',dashboard_private.read_timetable_operating_reference_v1(),pg_temp.date_override_baseline_reader());
select is(candidate::text,baseline::text,'verified legacy adoption whole DTO matches baseline using current helpers')
from date_override_captures where label='adopted';
select is((select jsonb_agg(jsonb_build_array(v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'))
 from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,4,'datedSessions')) v
 where label='adopted' and v->>'date'='2050-10-06'),
 jsonb_build_array(jsonb_build_array(1080,1200,pg_temp.ndid(1),pg_temp.ndid(2))),
 'sparse adopted row resolves to the real approved 18:00-20:00 resources');

savepoint date_override_broken_calendar;
update public.academic_events set note='[[TIPS_MAKEUP]] {}' where id=pg_temp.ndid(101);
select is(pg_temp.nd_context()#>>'{approvedByIdentity,legacy-makeup-alpha,approvedOverrideVerified}','false',
 'calendar corruption leaves an actual bound but unverified source');
insert into date_override_captures values('unverified',dashboard_private.read_timetable_operating_reference_v1(),pg_temp.date_override_baseline_reader());
select is(candidate::text,baseline::text,'failed approval verification whole DTO matches baseline')
from date_override_captures where label='unverified';
select is((select count(*) from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,4,'datedSessions')) v
 where label='unverified' and v->>'date'='2050-10-06'),0::bigint,'unverified adopted source cannot resolve from weekly defaults');
select is((select jsonb_agg(jsonb_build_array(v->>'date',v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'))
 from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,4,'datedUnresolvedOccupancies')) v where label='unverified'),
 '[["2050-10-06",null,null,null,null]]'::jsonb,'failed proof retains one date-known blocker with four unknown values');
select isnt((select candidate->>'datedFingerprint' from date_override_captures where label='unverified'),
 (select candidate->>'datedFingerprint' from date_override_captures where label='adopted'),
 'fresh proof failure changes the dated fingerprint while the raw plan is unchanged');
rollback to date_override_broken_calendar;
release savepoint date_override_broken_calendar;
rollback to date_override_sparse;
release savepoint date_override_sparse;

-- Marker presence without any owned request is not server approval. An ordinary
-- active row still applies row/map field priority through the current resolver.
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.ndid(32),'Native override marker only','영어','Native override map teacher','Native override map room',
 '화 08:00-09:00','수강','legacy',jsonb_build_object(
 'sessions',jsonb_build_array(jsonb_build_object('id','marker-only','date','2001-01-06','scheduleState','active',
  'startTime','09:15','makeupAdoption',jsonb_build_object('version',1,'makeupId','marker-only','originalId','unbound'))),
 'sessionSchedules',jsonb_build_object('2001-01-06',jsonb_build_object('startTime','11:00','endTime','12:00',
  'teacherCatalogId',pg_temp.ndid(12),'classroomCatalogId',pg_temp.ndid(22)))));
select is((select dashboard_private.legacy_effective_context_v1(c)->'approvedByIdentity' from public.classes c where id=pg_temp.ndid(32)),
 '{}'::jsonb,'marker-only active row has no server-bound approved source');
insert into date_override_captures values('marker_only',dashboard_private.read_timetable_operating_reference_v1(),pg_temp.date_override_baseline_reader());
select is(candidate::text,baseline::text,'marker-only active whole DTO matches baseline with current PR247 resolver')
from date_override_captures where label='marker_only';
select is((select jsonb_agg(jsonb_build_array(v->'startMinute',v->'endMinute',v->'teacherId',v->'classroomId'))
 from date_override_captures,jsonb_array_elements(pg_temp.nd_rows(candidate,32,'datedSessions')) v where label='marker_only'),
 jsonb_build_array(jsonb_build_array(555,720,pg_temp.ndid(12),pg_temp.ndid(22))),
 'unbound marker does not alter ordinary explicit-start and map-resource priority');

select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from date_override_no_send),
 'synthetic approval and reader comparisons create no provider delivery');
select is(to_jsonb(p),s.definition,'installed reader OID, body, owner, ACL and all catalog attributes remain unchanged')
from date_override_reader_contract s join pg_proc p on p.oid=s.oid;
select ok(not has_function_privilege(role_name,'dashboard_private.read_timetable_operating_reference_v1()','EXECUTE'),
 'private reader remains unexecutable for '||role_name)
from unnest(array['anon','authenticated','service_role']) role_name;
set local role anon;
select throws_ok('select dashboard_private.read_timetable_operating_reference_v1()','42501',null,
 'actual anon call to the final private reader is denied with SQLSTATE 42501');
reset role;
select * from finish();
rollback;
