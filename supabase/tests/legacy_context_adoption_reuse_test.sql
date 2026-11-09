-- Full ordered-schema regression for the exact final context and guarded
-- forward/recovery artifacts. All accounts, plans and histories are synthetic.
-- No helper mock, spy, policy or privilege change is used by the domain fixture.
begin;
set local statement_timeout='8s';
set local timezone='UTC';
set local datestyle='ISO, MDY';
select no_plan();
select is(md5((select prosrc from pg_proc where oid='dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure)),
 '543848851efa970fad481397db52c402','regression targets the exact final adoption-reuse context');
create temp table context_contract as
select p.oid,to_jsonb(p) definition from pg_proc p
where p.oid in('dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure,
 'dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
 'dashboard_private.legacy_effective_binding_v1(jsonb)'::regprocedure,
 'dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)'::regprocedure);

create function pg_temp.context_migration_sql(direction text) returns text language sql immutable as $function$
 select case direction
 when 'forward' then $forward$do $legacy_context_adoption_reuse$
declare
  target oid := to_regprocedure('dashboard_private.legacy_effective_context_v1(public.classes,jsonb)');
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
    or md5(original_body) is distinct from '258eb764cbff8b93ce7a8374a7d9d6b9' then
    raise exception 'legacy_context_adoption_reuse_definition_drift' using errcode = '55000';
  end if;
  candidate_body := original_body;
  for patch in select * from (values
    ($before0$declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
$before0$, $after0$declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text; adoption_verified_by_gate boolean;
begin
$after0$),
    ($before1$ loop
  source_id:=candidate.lesson->>'id';
$before1$, $after1$ loop
  -- The unchanged dated WHERE admitted this row. If neither ordinary gate
  -- was TRUE, its guarded adoption call necessarily returned TRUE (including
  -- a NULL ordinary gate). The four arguments survive requests/linked/dated
  -- unchanged. Reuse only that proven result within this candidate row;
  -- reset on every iteration and retain all other original evaluations.
  adoption_verified_by_gate:=(candidate.lesson->>'makeupRequestId' is distinct from candidate.id::text
    or candidate.lesson->>'id'='makeup-request:'||candidate.id::text||':'||candidate.slot_index::text) is not true;
  source_id:=candidate.lesson->>'id';
$after1$),
    ($before2$     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or (dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));
  if dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) then
   source:=source||jsonb_build_object('legacyAdoptionVerified',true);
$before2$, $after2$     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or ((case when adoption_verified_by_gate then true else dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) end)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));
  if (case when adoption_verified_by_gate then true else dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) end) then
   source:=source||jsonb_build_object('legacyAdoptionVerified',true);
$after2$)
  ) changes(before_text, after_text) loop
    if length(candidate_body) - length(replace(candidate_body, patch.before_text, ''))
      <> length(patch.before_text) then
      raise exception 'legacy_context_adoption_reuse_anchor_drift' using errcode = '55000';
    end if;
    candidate_body := replace(candidate_body, patch.before_text, patch.after_text);
  end loop;
  if md5(candidate_body) is distinct from '543848851efa970fad481397db52c402' then
    raise exception 'legacy_context_adoption_reuse_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, original_body, '')) <> length(original_body) then
    raise exception 'legacy_context_adoption_reuse_definition_drift' using errcode = '55000';
  end if;
  -- Retain the actual installed header, owner, ACL and per-function settings.
  execute replace(definition, original_body, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '543848851efa970fad481397db52c402'
    or metadata_after is distinct from metadata_before then
    raise exception 'legacy_context_adoption_reuse_metadata_drift' using errcode = '55000';
  end if;
end
$legacy_context_adoption_reuse$;$forward$
 when 'rollback' then $rollback$do $legacy_context_adoption_reuse_rollback$
declare
  target oid := to_regprocedure('dashboard_private.legacy_effective_context_v1(public.classes,jsonb)');
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
    or md5(original_body) is distinct from '543848851efa970fad481397db52c402' then
    raise exception 'legacy_context_adoption_reuse_rollback_definition_drift' using errcode = '55000';
  end if;
  candidate_body := original_body;
  for patch in select * from (values
    ($before0$     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or ((case when adoption_verified_by_gate then true else dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) end)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));
  if (case when adoption_verified_by_gate then true else dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) end) then
   source:=source||jsonb_build_object('legacyAdoptionVerified',true);
$before0$, $after0$     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or (dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));
  if dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) then
   source:=source||jsonb_build_object('legacyAdoptionVerified',true);
$after0$),
    ($before1$ loop
  -- The unchanged dated WHERE admitted this row. If neither ordinary gate
  -- was TRUE, its guarded adoption call necessarily returned TRUE (including
  -- a NULL ordinary gate). The four arguments survive requests/linked/dated
  -- unchanged. Reuse only that proven result within this candidate row;
  -- reset on every iteration and retain all other original evaluations.
  adoption_verified_by_gate:=(candidate.lesson->>'makeupRequestId' is distinct from candidate.id::text
    or candidate.lesson->>'id'='makeup-request:'||candidate.id::text||':'||candidate.slot_index::text) is not true;
  source_id:=candidate.lesson->>'id';
$before1$, $after1$ loop
  source_id:=candidate.lesson->>'id';
$after1$),
    ($before2$declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text; adoption_verified_by_gate boolean;
begin
$before2$, $after2$declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
$after2$)
  ) changes(before_text, after_text) loop
    if length(candidate_body) - length(replace(candidate_body, patch.before_text, ''))
      <> length(patch.before_text) then
      raise exception 'legacy_context_adoption_reuse_rollback_anchor_drift' using errcode = '55000';
    end if;
    candidate_body := replace(candidate_body, patch.before_text, patch.after_text);
  end loop;
  if md5(candidate_body) is distinct from '258eb764cbff8b93ce7a8374a7d9d6b9' then
    raise exception 'legacy_context_adoption_reuse_rollback_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  if length(definition) - length(replace(definition, original_body, '')) <> length(original_body) then
    raise exception 'legacy_context_adoption_reuse_rollback_definition_drift' using errcode = '55000';
  end if;
  -- Retain the actual installed header, owner, ACL and per-function settings.
  execute replace(definition, original_body, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '258eb764cbff8b93ce7a8374a7d9d6b9'
    or metadata_after is distinct from metadata_before then
    raise exception 'legacy_context_adoption_reuse_rollback_metadata_drift' using errcode = '55000';
  end if;
end
$legacy_context_adoption_reuse_rollback$;$rollback$
 end
$function$;
create function pg_temp.context_exec_state(command text) returns jsonb language plpgsql as $function$
declare s text;m text;begin
 execute command;return jsonb_build_object('state','00000','message','');
exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text;
 return jsonb_build_object('state',s,'message',m);
end $function$;
create function pg_temp.context_lifecycle_checks() returns table(passed boolean,label text) language plpgsql as $function$
declare target oid:='dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure;
 saved_definition text:=pg_get_functiondef(target);saved_body text;original_metadata jsonb;actual_metadata jsonb;
 expected_base constant text:='258eb764cbff8b93ce7a8374a7d9d6b9';expected_candidate constant text:='543848851efa970fad481397db52c402';
 result jsonb;snapshot_body text;snapshot_metadata jsonb;command text;
begin
 select prosrc,to_jsonb(p)-'prosrc'-'prosqlbody' into saved_body,original_metadata from pg_proc p where oid=target;
 return query select md5(saved_body)=expected_candidate,'lifecycle starts at reviewed candidate';
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('rollback'));
 return query select result->>'state'='00000','recovery restores the baseline';
 return query select md5(prosrc)=expected_base and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'recovery preserves exact OID, owner, ACL and every nonbody attribute' from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('rollback'));
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_rollback_definition_drift'),
  'repeat recovery rejects exact 55000 and definition drift message';
 -- Altered artifact inputs must fail before replacing the function.
 command:=replace(pg_temp.context_migration_sql('forward'),$invalid_anchor$$before0$declare defaults jsonb:=dashboard_private.read_timetable_class_weekly_v2(c); catalogs jsonb:=p_catalogs;
 slots jsonb; sources jsonb:='{}'; candidate record; source jsonb; source_id text;
begin
$before0$$invalid_anchor$,'$before0$missing anchor$before0$');
 result:=pg_temp.context_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_anchor_drift'),
  'missing exact anchor rejects before replacement';
 command:=replace(pg_temp.context_migration_sql('forward'),'adoption_verified_by_gate boolean;','adoption_verified_by_gate boolean /* invalid candidate */;');
 result:=pg_temp.context_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_candidate_drift'),
  'altered candidate bytes reject exact 55000';
 -- An unexpected attribute mutation must roll back the whole DO subtransaction.
 command:=replace(pg_temp.context_migration_sql('forward'),
  'execute replace(definition, original_body, candidate_body);',
  'execute replace(definition, original_body, candidate_body); alter function dashboard_private.legacy_effective_context_v1(public.classes,jsonb) cost 137;');
 result:=pg_temp.context_exec_state(command);
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_metadata_drift'),
  'metadata drift rejects exact 55000';
 return query select md5(prosrc)=expected_base and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'all rejected mutations leave complete baseline state intact' from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('forward'));
 return query select result->>'state'='00000','actual forward DO applies to exact baseline';
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'forward installs exact candidate with complete metadata preserved' from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_definition_drift'),
  'reapplication fails closed with exact SQLSTATE and message';
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'reapplication failure does not change installed state' from pg_proc p where oid=target;
 execute replace(saved_definition,saved_body,saved_body||E'\n-- synthetic body drift\n');
 select prosrc,to_jsonb(p)-'prosrc'-'prosqlbody' into snapshot_body,snapshot_metadata from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('rollback'));
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_rollback_definition_drift'),
  'recovery refuses an intervening body change';
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_definition_drift'),
  'forward refuses an intervening body change';
 return query select prosrc=snapshot_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'unknown body is never overwritten' from pg_proc p where oid=target;
 execute saved_definition;
 alter function dashboard_private.legacy_effective_context_v1(public.classes,jsonb) rename to issue234_context_temporarily_missing;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','legacy_context_adoption_reuse_definition_drift'),
  'missing target rejects before DDL';
 alter function dashboard_private.issue234_context_temporarily_missing(public.classes,jsonb) rename to legacy_effective_context_v1;
 -- Nondefault legitimate attributes must be preserved, not reset to defaults.
 perform pg_temp.context_exec_state(pg_temp.context_migration_sql('rollback'));
 alter function dashboard_private.legacy_effective_context_v1(public.classes,jsonb) cost 139;
 alter function dashboard_private.legacy_effective_context_v1(public.classes,jsonb) set work_mem='6MB';
 select to_jsonb(p)-'prosrc'-'prosqlbody' into snapshot_metadata from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('forward'));
 return query select result->>'state'='00000' and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'forward retains installed nondefault cost and runtime configuration' from pg_proc p where oid=target;
 result:=pg_temp.context_exec_state(pg_temp.context_migration_sql('rollback'));
 return query select result->>'state'='00000' and (to_jsonb(p)-'prosrc'-'prosqlbody')=snapshot_metadata,
  'recovery retains installed nondefault cost and runtime configuration' from pg_proc p where oid=target;
 execute saved_definition;
 return query select prosrc=saved_body and (to_jsonb(p)-'prosrc'-'prosqlbody')=original_metadata,
  'lifecycle leaves exact original candidate and metadata for following tests' from pg_proc p where oid=target;
end $function$;

create temporary table context_lifecycle_results on commit drop as select * from pg_temp.context_lifecycle_checks();
select is((select count(*) from context_lifecycle_results),19::bigint,'all nineteen context lifecycle checks execute');
select ok(passed,label) from context_lifecycle_results;


-- Frozen baseline; only the function identity differs from the reviewed source.
create function pg_temp.original_adoption_context(c public.classes,p_catalogs jsonb default null)
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
   and (lesson->>'makeupRequestId' is distinct from id::text or lesson->>'id'='makeup-request:'||id::text||':'||slot_index::text
    or (slot_index=0 and lesson->>'id'=lesson#>>'{makeupAdoption,makeupId}' and dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,schedule_plan_before,schedule_plan_after,request_json)))
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
    and (exists(select 1 from jsonb_array_elements(case when jsonb_typeof(candidate.approval_payload->'makeup_schedule')='array' then candidate.approval_payload->'makeup_schedule' else '[]' end) p
     where p->>'place'=candidate.slot->>'classroom' and public.makeup_numbered_source_instant_v1(p->>'start_at')=candidate.a and public.makeup_numbered_source_instant_v1(p->>'end_at')=candidate.b)
     or (dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json)
      and candidate.approval_payload->>'approved_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and public.makeup_numbered_instant_v1(candidate.approval_payload->>'approved_at')=candidate.approved_at)),false));
  if dashboard_private.makeup_legacy_adoption_current_v1(c.schedule_plan,candidate.schedule_plan_before,candidate.schedule_plan_after,candidate.request_json) then
   source:=source||jsonb_build_object('legacyAdoptionVerified',true);
  end if;
  if sources ? source_id then source:=jsonb_set(source,'{approvedOverrideVerified}','false');end if;
  sources:=sources||jsonb_build_object(source_id,source);
 end loop;
 return jsonb_build_object('version',1,'classId',c.id,'basicSlots',slots,'catalogs',catalogs,'approvedByIdentity',sources,'weekly',defaults);
end $f$;

select is(md5((select prosrc from pg_proc where oid='pg_temp.original_adoption_context(public.classes,jsonb)'::regprocedure)),
 '258eb764cbff8b93ce7a8374a7d9d6b9','original alias preserves the exact baseline context body');
select ok(p.provolatile='s' and not p.prosecdef and p.prorettype='jsonb'::regtype
 and row(p.prolang,p.provolatile,p.prosecdef,p.proconfig,p.proparallel,p.prorettype,p.pronargs,p.pronargdefaults)
 is not distinct from row(b.prolang,b.provolatile,b.prosecdef,b.proconfig,b.proparallel,b.prorettype,b.pronargs,b.pronargdefaults),
 'candidate retains original stable invoker header, empty search path and default argument')
from pg_proc p cross join pg_proc b
where p.oid='dashboard_private.legacy_effective_context_v1(public.classes,jsonb)'::regprocedure
 and b.oid='pg_temp.original_adoption_context(public.classes,jsonb)'::regprocedure;
create function pg_temp.crid(n int) returns uuid language sql immutable as $$
 select ('af091110-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create temp table context_captures(label text primary key,candidate jsonb,baseline jsonb);
create function pg_temp.capture_context(control boolean) returns jsonb language plpgsql as $$
declare result jsonb;s text;m text;d text;h text;
begin
 if control then
  select pg_temp.original_adoption_context(c,null) into result from public.classes c where id=pg_temp.crid(4);
 else
  select dashboard_private.legacy_effective_context_v1(c,null) into result from public.classes c where id=pg_temp.crid(4);
 end if;
 return jsonb_build_object('state','00000','message','','detail','','hint','','outputText',result::text);
exception when others then
 get stacked diagnostics s=returned_sqlstate,m=message_text,d=pg_exception_detail,h=pg_exception_hint;
 return jsonb_build_object('state',s,'message',m,'detail',d,'hint',h,'outputText',null);
end $$;
-- Reuse the existing full-schema actual adoption writer setup, including real
-- notification producer, calendar evidence, row triggers and deferred guards.
create function pg_temp.context_reuse_plan() returns jsonb language sql immutable as $f$ select $j${"subject":"영어","className":"Context reuse adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]}$j$::jsonb $f$;

create function pg_temp.cr_expected(p_request jsonb) returns jsonb language sql immutable as $f$
 select jsonb_set(jsonb_set(pg_temp.context_reuse_plan(),'{sessions,0}',
  pg_temp.context_reuse_plan()#>'{sessions,0}'||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','cancel')),
  '{sessions,1}',pg_temp.context_reuse_plan()#>'{sessions,1}'||jsonb_build_object(
   'makeupRequestId',p_request->>'id','makeupRequestRole','makeup',
   'makeupAdoption',jsonb_build_object('version',1,'requestUpdatedAt',p_request->>'updated_at','originalId','legacy-original-alpha','makeupId','legacy-makeup-alpha'),
   'startTime','18:00','endTime','20:00','teacherCatalogId',pg_temp.crid(1),'teacherName','Context reuse adoption teacher',
   'classroomCatalogId',pg_temp.crid(2),'classroomName','Context reuse adoption room'))
$f$;
insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.crid(801),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','context-reuse-adoption@synthetic.invalid');
insert into public.profiles(id,role,name) values(pg_temp.crid(801),'admin','Context reuse adoption actor')
on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id=pg_temp.crid(801);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values
 (pg_temp.crid(1),'Context reuse adoption teacher',array['영어'],pg_temp.crid(801));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.crid(2),'Context reuse adoption room',array['영어']);
update public.profiles set teacher_catalog_id=pg_temp.crid(1) where id=pg_temp.crid(801);
insert into dashboard_private.makeup_subject_directors_v1 values('영어',pg_temp.crid(801),pg_temp.crid(1));
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.crid(4),'Context reuse adoption','영어','Context reuse adoption teacher','Context reuse adoption room',
 '수금 19:30-21:30','수강','legacy',pg_temp.context_reuse_plan());
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,
 teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,
 makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.crid(3),'approval_pending','cancel_makeup','영어','english',pg_temp.crid(801),pg_temp.crid(4),
 'Context reuse adoption',pg_temp.crid(1),pg_temp.crid(801),pg_temp.crid(1),pg_temp.crid(801),'2050-10-20',
 '2050-10-06T09:00:00Z','2050-10-06T11:00:00Z','Context reuse adoption room',
 '[{"startAt":"2050-10-06T18:00:00+09:00","endAt":"2050-10-06T20:00:00+09:00","classroom":"Context reuse adoption room"}]');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table context_initial_request as select to_jsonb(r) value from public.makeup_requests r where id=pg_temp.crid(3);
create temp table context_no_send as select count(*) deliveries from dashboard_private.notification_deliveries;
select set_config('test.context_reuse_patch',jsonb_build_object(
 'actor_profile_id',pg_temp.crid(801),'final_note','Synthetic native override adoption',
 'schedule_plan_before',pg_temp.context_reuse_plan(),'schedule_plan_after',pg_temp.cr_expected(value),
 'cancel_academic_event_id',pg_temp.crid(100),'makeup_academic_event_id',pg_temp.crid(101),'makeup_academic_event_ids',jsonb_build_array(pg_temp.crid(101)),
 'calendar_events',jsonb_build_array(
  jsonb_build_object('id',pg_temp.crid(100),'title','[휴강] Context reuse adoption','date','2050-10-20','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','cancel','requestId',pg_temp.crid(3),'className','Context reuse adoption','subject','영어','cancelDate','2050-10-20','reason','')::text),
  jsonb_build_object('id',pg_temp.crid(101),'title','[보강] Context reuse adoption','date','2050-10-06','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','makeup','requestId',pg_temp.crid(3),'className','Context reuse adoption','subject','영어',
    'classroom','Context reuse adoption room','startAt','2050-10-06T18:00:00+09:00','endAt','2050-10-06T20:00:00+09:00','slotIndex',0,'reason','')::text)))::text,true)
from context_initial_request;
insert into context_captures values('pending',pg_temp.capture_context(false),pg_temp.capture_context(true));
select is(candidate,baseline,'pending actual request retains whole context and SQLSTATE tuple parity') from context_captures where label='pending';
select is((candidate->>'outputText')::jsonb->'approvedByIdentity','{}'::jsonb,'pending request has no approved binding') from context_captures where label='pending';
select set_config('request.jwt.claim.sub',pg_temp.crid(801)::text,true),
 set_config('request.jwt.claim.role','service_role',true),
 set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.crid(801),'role','service_role')::text,true);
set local role service_role;
select lives_ok($$select public.transition_makeup_request_v2(pg_temp.crid(3),'approve',
 current_setting('test.context_reuse_patch')::jsonb,'approval_pending',pg_temp.crid(210))$$,
 'actual final approval writer admits the synthetic legacy pair');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.crid(4)),
 (select pg_temp.cr_expected(value) from context_initial_request),'actual approval preserves the independently expected adoption plan');


insert into context_captures values('approved',pg_temp.capture_context(false),pg_temp.capture_context(true));
select is(candidate,baseline,'actual approval retains whole context JSON text and SQLSTATE/message/detail/hint')
from context_captures where label='approved';
select is(candidate->>'state','00000','actual final context succeeds after real approval') from context_captures where label='approved';
select is(jsonb_build_array(
 ((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,approvedOverrideVerified}',
 ((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,legacyAdoptionVerified}'),
 '[true,true]'::jsonb,'approved legacy identity retains both independently established verification flags')
from context_captures where label='approved';
select is(((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,approvedOverride}',
 jsonb_build_object('startTime','18:00','endTime','20:00','teacherCatalogId',pg_temp.crid(1),
 'classroomCatalogId',pg_temp.crid(2),'classroomUnresolved',false),'actual context retains the approved instants and resources')
from context_captures where label='approved';

-- A separate call for the same class/request must re-read calendar evidence.
savepoint context_changed_calendar;
update public.academic_events set note='[[TIPS_MAKEUP]] {}' where id=pg_temp.crid(101);
insert into context_captures values('unverified',pg_temp.capture_context(false),pg_temp.capture_context(true));
select is(candidate,baseline,'changed calendar proof retains complete original context behavior')
from context_captures where label='unverified';
select is(jsonb_build_array(
 ((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,approvedOverrideVerified}',
 ((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,legacyAdoptionVerified}'),
 '[false,true]'::jsonb,'adoption proof does not turn failed calendar verification into approval')
from context_captures where label='unverified';
select isnt((select candidate->>'outputText' from context_captures where label='unverified'),
 (select candidate->>'outputText' from context_captures where label='approved'),'next invocation observes proof changes without reusing an earlier call');
rollback to context_changed_calendar;
release savepoint context_changed_calendar;

-- Owner-only adversarial synthetic input: preserve current/after binding
-- equality while the original ordinary gate admits an unowned legacy identity.
-- The shared adoption helper must still return false for this different input.
savepoint context_ordinary_gate;
update public.makeup_requests set schedule_plan_after=jsonb_set(schedule_plan_after,'{sessions,1}',
 (schedule_plan_after#>'{sessions,1}')-'makeupRequestId') where id=pg_temp.crid(3);
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,1}',
 (schedule_plan#>'{sessions,1}')-'makeupRequestId') where id=pg_temp.crid(4);
-- Explicit synthetic schedule proof keeps this ordinary-path case independent
-- of the notification payload version installed by the schema baseline.
update public.makeup_request_events set payload=jsonb_set(payload,'{makeup_schedule}',
 '[{"start_at":"2050-10-06T18:00:00+09:00","end_at":"2050-10-06T20:00:00+09:00","place":"Context reuse adoption room"}]'::jsonb)
where request_id=pg_temp.crid(3) and event_type='approved';
insert into context_captures values('ordinary_gate',pg_temp.capture_context(false),pg_temp.capture_context(true));
select is(candidate,baseline,'ordinary gate retains full context and original fallback evaluation result')
from context_captures where label='ordinary_gate';
select is(((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha,approvedOverrideVerified}',
 'true'::jsonb,'ordinary admitted row retains approval verified by the matching event payload schedule')
from context_captures where label='ordinary_gate';
select ok(not ((((candidate->>'outputText')::jsonb)#>'{approvedByIdentity,legacy-makeup-alpha}') ? 'legacyAdoptionVerified'),
 'ordinary row cannot inherit the earlier adopted row proof') from context_captures where label='ordinary_gate';
rollback to context_ordinary_gate;
release savepoint context_ordinary_gate;

select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from context_no_send),
 'isolated real approval and context calls create no provider delivery');
select ok(not exists(select 1 from context_contract s left join pg_proc p on p.oid=s.oid
 where to_jsonb(p) is distinct from s.definition),'context lifecycle and fixtures preserve all protected OIDs, bodies, owners, ACLs and attributes');
select ok(not has_function_privilege(role_name,'dashboard_private.legacy_effective_context_v1(public.classes,jsonb)','EXECUTE'),
 'private context execution remains denied for '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;
set local role anon;
select throws_ok('select dashboard_private.legacy_effective_context_v1(null::public.classes,null)',
 '42501',null,'actual anon call to the final context is denied with SQLSTATE 42501');
reset role;
select * from finish();
rollback;
