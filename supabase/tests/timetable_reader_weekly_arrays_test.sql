-- #234 complete-schema synthetic regression: exact text results, errors and guarded lifecycle.
-- No operating input, actor or payload. Every fixture and mutation rolls back.
begin;
set local statement_timeout='8s';
set local timezone='Asia/Seoul';
select no_plan();
-- Execute the exact reviewed forward/recovery artifacts for lifecycle coverage.
create function pg_temp.weekly_arrays_migration_sql(direction text) returns text
language sql immutable as $wa_function$
 select case direction
 when 'forward' then $weekly_arrays_forward$do $weekly_arrays$
declare p pg_catalog.pg_proc; before_metadata jsonb; body text; definition text;
 patch record; contract_relation oid:=to_regclass('dashboard_private.timetable_validation_reuse_contracts');
 old_fingerprint bytea; changed integer;
begin
 select * into p from pg_catalog.pg_proc
 where oid=to_regprocedure('dashboard_private.read_timetable_operating_reference_v1()');
 if not found or md5(p.prosrc)<>'297fe1400b5313adbd978ea859d98fbb' or p.prosqlbody is not null then
  raise exception using errcode='55000',message='reader_weekly_arrays_definition_drift';end if;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or p.provolatile<>'s' or not p.prosecdef or p.proisstrict or p.proparallel<>'u'
 or p.procost<>100 or p.prorows<>0 or p.proleakproof
 or p.proconfig is null or cardinality(p.proconfig)<>1
 or not(p.proconfig[1]=any(array['search_path=','search_path=""']))
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception using errcode='55000',message='reader_weekly_arrays_boundary_drift';end if;
 -- Rebind exactly one existing dependency pin, only from its exact current
 -- metadata. A missing/stale contract is not repaired or silently accepted.
 if contract_relation is null then
  raise exception using errcode='55000',message='reader_weekly_arrays_contract_drift';end if;
 if not exists(select 1 from pg_catalog.pg_class c where c.oid=contract_relation
  and c.relowner='postgres'::regrole and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
  and not exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where a.grantee<>c.relowner))
 or exists(select 1 from pg_catalog.pg_policy where polrelid=contract_relation)
 or exists(select 1 from pg_catalog.pg_trigger where tgrelid=contract_relation and not tgisinternal)
 or exists(select 1 from pg_catalog.pg_attribute where attrelid=contract_relation and attnum>0 and not attisdropped and attacl is not null)
 or (select array_agg(attname::text||':'||atttypid::regtype::text||':'||attnotnull::text order by attnum)
     from pg_catalog.pg_attribute where attrelid=contract_relation and attnum>0 and not attisdropped)
    is distinct from array['object_kind:text:true','object_oid:oid:true','fingerprint:bytea:true']
 then raise exception using errcode='55000',message='reader_weekly_arrays_contract_boundary_drift';end if;
 if (select count(*) from dashboard_private.timetable_validation_reuse_contracts c
     where c.object_kind='function' and c.object_oid=p.oid)<>1 then
  raise exception using errcode='55000',message='reader_weekly_arrays_contract_drift';end if;
 select c.fingerprint into old_fingerprint from dashboard_private.timetable_validation_reuse_contracts c
 where c.object_kind='function' and c.object_oid=p.oid for update;
 if old_fingerprint is distinct from sha256(convert_to(to_jsonb(p)::text,'UTF8')) then
  raise exception using errcode='55000',message='reader_weekly_arrays_contract_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';body:=p.prosrc;
 for patch in select * from (values
    ($old0$default_single_resource boolean;$old0$,$new0$default_single_resource boolean; default_shadow_rows jsonb[]; default_blocker_rows jsonb[];$new0$),
    ($old1$ into default_bounds_complete,default_weekdays,default_single_resource;$old1$,$new1$ into default_bounds_complete,default_weekdays,default_single_resource;
 -- Preserve each producer array's order and duplicates once per class.
 -- The existing default checks above retain their original cast/error boundary.
 select coalesce(array(select value from jsonb_array_elements(defaults->'shadowSlots')),'{}'::jsonb[]),
        coalesce(array(select value from jsonb_array_elements(defaults->'unresolvedOccupancies')),'{}'::jsonb[])
 into default_shadow_rows,default_blocker_rows;$new1$),
    ($old2$for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
   end loop;$old2$,$new2$foreach regular in array default_shadow_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
    end if;
   end loop;$new2$),
    ($old3$for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
   end loop;$old3$,$new3$foreach regular in array default_shadow_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
    end if;
   end loop;$new3$),
    ($old4$for regular in select value from jsonb_array_elements(defaults->'unresolvedOccupancies') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
   end loop;$old4$,$new4$foreach regular in array default_blocker_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
    end if;
   end loop;$new4$)
 ) v(old_text,new_text) loop
  if length(body)-length(replace(body,patch.old_text,''))<>length(patch.old_text) then
   raise exception using errcode='55000',message='reader_weekly_arrays_anchor_drift';end if;
  body:=replace(body,patch.old_text,patch.new_text);
 end loop;
 if md5(body)<>'bbad57545ec4346d979cfe0b0b9056f3' then
  raise exception using errcode='55000',message='reader_weekly_arrays_candidate_drift';end if;
 definition:=pg_get_functiondef(p.oid);
 if length(definition)-length(replace(definition,p.prosrc,''))<>length(p.prosrc) then
  raise exception using errcode='55000',message='reader_weekly_arrays_definition_drift';end if;
 execute replace(definition,p.prosrc,body);
 select q.* into p from pg_catalog.pg_proc q where q.oid=p.oid;
 if md5(p.prosrc)<>'bbad57545ec4346d979cfe0b0b9056f3' or (to_jsonb(p)-'prosrc') is distinct from before_metadata then
  raise exception using errcode='55000',message='reader_weekly_arrays_metadata_changed';end if;
 update dashboard_private.timetable_validation_reuse_contracts c
 set fingerprint=sha256(convert_to(to_jsonb(p)::text,'UTF8'))
 where c.object_kind='function' and c.object_oid=p.oid and c.fingerprint=old_fingerprint;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception using errcode='55000',message='reader_weekly_arrays_contract_drift';end if;
end $weekly_arrays$;$weekly_arrays_forward$
 when 'recovery' then $weekly_arrays_recovery$do $weekly_arrays$
declare p pg_catalog.pg_proc; before_metadata jsonb; body text; definition text;
 patch record; contract_relation oid:=to_regclass('dashboard_private.timetable_validation_reuse_contracts');
 old_fingerprint bytea; changed integer;
begin
 select * into p from pg_catalog.pg_proc
 where oid=to_regprocedure('dashboard_private.read_timetable_operating_reference_v1()');
 if not found or md5(p.prosrc)<>'bbad57545ec4346d979cfe0b0b9056f3' or p.prosqlbody is not null then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_definition_drift';end if;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
 or p.provolatile<>'s' or not p.prosecdef or p.proisstrict or p.proparallel<>'u'
 or p.procost<>100 or p.prorows<>0 or p.proleakproof
 or p.proconfig is null or cardinality(p.proconfig)<>1
 or not(p.proconfig[1]=any(array['search_path=','search_path=""']))
 or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception using errcode='55000',message='reader_weekly_arrays_recovery_boundary_drift';end if;
 -- Rebind exactly one existing dependency pin, only from its exact current
 -- metadata. A missing/stale contract is not repaired or silently accepted.
 if contract_relation is null then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_contract_drift';end if;
 if not exists(select 1 from pg_catalog.pg_class c where c.oid=contract_relation
  and c.relowner='postgres'::regrole and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
  and not exists(select 1 from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a where a.grantee<>c.relowner))
 or exists(select 1 from pg_catalog.pg_policy where polrelid=contract_relation)
 or exists(select 1 from pg_catalog.pg_trigger where tgrelid=contract_relation and not tgisinternal)
 or exists(select 1 from pg_catalog.pg_attribute where attrelid=contract_relation and attnum>0 and not attisdropped and attacl is not null)
 or (select array_agg(attname::text||':'||atttypid::regtype::text||':'||attnotnull::text order by attnum)
     from pg_catalog.pg_attribute where attrelid=contract_relation and attnum>0 and not attisdropped)
    is distinct from array['object_kind:text:true','object_oid:oid:true','fingerprint:bytea:true']
 then raise exception using errcode='55000',message='reader_weekly_arrays_recovery_contract_boundary_drift';end if;
 if (select count(*) from dashboard_private.timetable_validation_reuse_contracts c
     where c.object_kind='function' and c.object_oid=p.oid)<>1 then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_contract_drift';end if;
 select c.fingerprint into old_fingerprint from dashboard_private.timetable_validation_reuse_contracts c
 where c.object_kind='function' and c.object_oid=p.oid for update;
 if old_fingerprint is distinct from sha256(convert_to(to_jsonb(p)::text,'UTF8')) then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_contract_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';body:=p.prosrc;
 for patch in select * from (values
    ($old0$foreach regular in array default_blocker_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
    end if;
   end loop;$old0$,$new0$for regular in select value from jsonb_array_elements(defaults->'unresolvedOccupancies') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_blockers:=array_append(legacy_blockers,regular||jsonb_build_object('date',dt,'occupancyFingerprint',md5(jsonb_build_array(occupancy,regular->'occupancyFingerprint')::text)));
   end loop;$new0$),
    ($old1$foreach regular in array default_shadow_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
    end if;
   end loop;$old1$,$new1$for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-session:'||c.id::text||':'||coalesce(nullif(v->>'id',''),nullif(v->>'sessionKey',''))||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','active','revision',0));
   end loop;$new1$),
    ($old2$foreach regular in array default_shadow_rows loop
    if (regular->>'weekday')::int=extract(dow from dt)::int then
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
    end if;
   end loop;$old2$,$new2$for regular in select value from jsonb_array_elements(defaults->'shadowSlots') z where (z->>'weekday')::int=extract(dow from dt)::int loop
    legacy_dated:=array_append(legacy_dated,regular||jsonb_build_object('id','legacy-cancel:'||c.id::text||':'||dt::text||':'||(regular->>'id'),'sourceSlotId',null,'inheritedWeeklySlotId',regular->>'id','date',dt,'state','skipped','revision',0));
   end loop;$new2$),
    ($old3$ into default_bounds_complete,default_weekdays,default_single_resource;
 -- Preserve each producer array's order and duplicates once per class.
 -- The existing default checks above retain their original cast/error boundary.
 select coalesce(array(select value from jsonb_array_elements(defaults->'shadowSlots')),'{}'::jsonb[]),
        coalesce(array(select value from jsonb_array_elements(defaults->'unresolvedOccupancies')),'{}'::jsonb[])
 into default_shadow_rows,default_blocker_rows;$old3$,$new3$ into default_bounds_complete,default_weekdays,default_single_resource;$new3$),
    ($old4$default_single_resource boolean; default_shadow_rows jsonb[]; default_blocker_rows jsonb[];$old4$,$new4$default_single_resource boolean;$new4$)
 ) v(old_text,new_text) loop
  if length(body)-length(replace(body,patch.old_text,''))<>length(patch.old_text) then
   raise exception using errcode='55000',message='reader_weekly_arrays_recovery_anchor_drift';end if;
  body:=replace(body,patch.old_text,patch.new_text);
 end loop;
 if md5(body)<>'297fe1400b5313adbd978ea859d98fbb' then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_candidate_drift';end if;
 definition:=pg_get_functiondef(p.oid);
 if length(definition)-length(replace(definition,p.prosrc,''))<>length(p.prosrc) then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_definition_drift';end if;
 execute replace(definition,p.prosrc,body);
 select q.* into p from pg_catalog.pg_proc q where q.oid=p.oid;
 if md5(p.prosrc)<>'297fe1400b5313adbd978ea859d98fbb' or (to_jsonb(p)-'prosrc') is distinct from before_metadata then
  raise exception using errcode='55000',message='reader_weekly_arrays_recovery_metadata_changed';end if;
 update dashboard_private.timetable_validation_reuse_contracts c
 set fingerprint=sha256(convert_to(to_jsonb(p)::text,'UTF8'))
 where c.object_kind='function' and c.object_oid=p.oid and c.fingerprint=old_fingerprint;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception using errcode='55000',message='reader_weekly_arrays_recovery_contract_drift';end if;
end $weekly_arrays$;$weekly_arrays_recovery$
 end
$wa_function$;

create function pg_temp.wa_registry() returns jsonb language sql stable as $$
 select jsonb_build_object('reader',(select to_jsonb(p) from pg_proc p where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure),
 'contracts',(select jsonb_agg(to_jsonb(c) order by object_kind,object_oid) from dashboard_private.timetable_validation_reuse_contracts c),
 'table',(select jsonb_build_array(relowner,relacl,relrowsecurity,relforcerowsecurity) from pg_class where oid='dashboard_private.timetable_validation_reuse_contracts'::regclass))
$$;
create temp table wa_initial as select pg_temp.wa_registry() snapshot;
select is(md5((select prosrc from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure)),
 'bbad57545ec4346d979cfe0b0b9056f3','final installed reader is the reviewed array candidate');
create function pg_temp.wa_state(command text) returns jsonb language plpgsql as $$
declare st text:='00000';msg text;
begin begin execute command;exception when others then get stacked diagnostics st=returned_sqlstate,msg=message_text;end;
return jsonb_build_object('state',st,'message',msg);end $$;
create function pg_temp.wa_reject(mutation text,direction text,expected_message text) returns boolean language plpgsql as $$
declare before_value jsonb;answer jsonb;
begin
 begin
  if mutation<>'' then execute mutation;end if;
  before_value:=pg_temp.wa_registry();answer:=pg_temp.wa_state(pg_temp.weekly_arrays_migration_sql(direction));
  if answer is distinct from jsonb_build_object('state','55000','message',expected_message)
   or pg_temp.wa_registry() is distinct from before_value then raise exception 'atomic rejection mismatch %',answer;end if;
  raise exception using errcode='ZW001';
 exception when sqlstate 'ZW001' then return true;end;
end $$;
select ok(pg_temp.wa_reject('','forward','reader_weekly_arrays_definition_drift'),'reapplication rejects exact 55000 without changing reader or contracts');
select ok(pg_temp.wa_reject('alter function dashboard_private.read_timetable_operating_reference_v1() cost 99','recovery','reader_weekly_arrays_recovery_boundary_drift'),'recovery rejects changed function metadata atomically');
select ok(pg_temp.wa_reject($m$delete from dashboard_private.timetable_validation_reuse_contracts where object_kind='function' and object_oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure$m$,'recovery','reader_weekly_arrays_recovery_contract_drift'),'missing contract cannot be silently repaired');
select ok(pg_temp.wa_reject($m$update dashboard_private.timetable_validation_reuse_contracts set fingerprint=decode(repeat('00',32),'hex') where object_kind='function' and object_oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure$m$,'recovery','reader_weekly_arrays_recovery_contract_drift'),'stale contract rejects recovery atomically');
select ok(pg_temp.wa_reject('grant select on dashboard_private.timetable_validation_reuse_contracts to authenticated','recovery','reader_weekly_arrays_recovery_contract_boundary_drift'),'widened table access rejects recovery');
select is(pg_temp.wa_state(pg_temp.weekly_arrays_migration_sql('recovery'))->>'state','00000','exact guarded recovery executes');
select is(md5((select prosrc from pg_proc where oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure)),
 '297fe1400b5313adbd978ea859d98fbb','recovery restores the exact previous body');
select ok(pg_temp.wa_reject('','recovery','reader_weekly_arrays_recovery_definition_drift'),'repeated recovery rejects exact 55000');
select ok(pg_temp.wa_reject('alter function dashboard_private.read_timetable_operating_reference_v1() cost 99','forward','reader_weekly_arrays_boundary_drift'),'forward rejects changed attributes');
select ok(pg_temp.wa_reject('grant execute on function dashboard_private.read_timetable_operating_reference_v1() to authenticated','forward','reader_weekly_arrays_boundary_drift'),'forward rejects widened reader ACL');
select ok(pg_temp.wa_reject($m$update dashboard_private.timetable_validation_reuse_contracts set fingerprint=decode(repeat('00',32),'hex') where object_kind='function' and object_oid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure$m$,'forward','reader_weekly_arrays_contract_drift'),'forward rejects stale existing dependency pin');
-- Freeze the exact previous implementation under a temporary test identity.
do $original$declare definition text;begin
 definition:=pg_get_functiondef('dashboard_private.read_timetable_operating_reference_v1()'::regprocedure);
 execute replace(definition,'dashboard_private.read_timetable_operating_reference_v1()','pg_temp.wa_original_reader()');
end $original$;
revoke all on function pg_temp.wa_original_reader() from public,anon,authenticated,service_role;
select is(pg_temp.wa_state(pg_temp.weekly_arrays_migration_sql('forward'))->>'state','00000','exact forward artifact installs');
select is(pg_temp.wa_registry(),(select snapshot from wa_initial),'roundtrip restores OID, every function attribute/ACL and all dependency rows exactly');

create function pg_temp.wa_id(n int) returns uuid language sql immutable as $$select ('de234010-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
-- Seeding alone bypasses application triggers. Comparisons use ordinary triggers
-- and the final current helper chain, including the installed makeup fix.
set local session_replication_role=replica;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.wa_id(101),'Weekly array synthetic teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.wa_id(201),'Weekly array synthetic room',array['영어']);
insert into public.classes(id,name,subject,class_type,grade,teacher,room,schedule,status,capacity,fee,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.wa_id(n),'Weekly array synthetic class '||n,'영어','정규','중1','Weekly array synthetic teacher','Weekly array synthetic room',
 case when n=1 then '월 09:00-10:00' when n=2 then '수 11:00-12:00' else '금 13:00-14:00' end,
 '수강',12,100000,'[]','[]','[]','{}','[]','legacy',
 jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','active-'||n,'date',case when n=1 then '2050-01-03' when n=2 then '2050-01-05' else '2050-01-07' end,'scheduleState','active'),
 jsonb_build_object('id','cancel-'||n,'date',case when n=1 then '2050-01-10' when n=2 then '2050-01-12' else '2050-01-14' end,'scheduleState','exception')))
from generate_series(1,3) n;
set local session_replication_role=origin;

create function pg_temp.wa_capture(original boolean) returns jsonb language plpgsql as $$
declare v jsonb;st text:='00000';msg text;detail text;
begin begin
 if original then v:=pg_temp.wa_original_reader();else v:=dashboard_private.read_timetable_operating_reference_v1();end if;
 exception when query_canceled or others then get stacked diagnostics st=returned_sqlstate,msg=message_text,detail=pg_exception_detail;end;
 return jsonb_build_object('state',st,'message',msg,'detail',detail,'value',v);end $$;
create function pg_temp.wa_equivalent(mutation text,expected_state text default '00000') returns boolean language plpgsql as $$
declare a jsonb;b jsonb;
begin begin
 if mutation<>'' then perform set_config('session_replication_role','replica',true);execute mutation;perform set_config('session_replication_role','origin',true);end if;
 a:=pg_temp.wa_capture(true);b:=pg_temp.wa_capture(false);
 if a::text is distinct from b::text or a->>'state' is distinct from expected_state then raise exception 'reader difference % %',a->>'state',b->>'state';end if;
 raise exception using errcode='ZW002';exception when sqlstate 'ZW002' then return true;end;end $$;
select ok(pg_temp.wa_equivalent(''),'active/cancelled weekly inheritance, class-local reset and full fingerprints are identical');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}','[]') where id=pg_temp.wa_id(2)$m$),'empty sessions are preserved');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=schedule_plan-'sessions' where id=pg_temp.wa_id(2)$m$),'missing sessions are preserved');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}','null') where id=pg_temp.wa_id(2)$m$),'JSON null sessions preserve diagnostics');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}','{}') where id=pg_temp.wa_id(2)$m$),'non-array sessions preserve early diagnostic branch');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',(schedule_plan->'sessions')||jsonb_build_array(schedule_plan#>'{sessions,0}')) where id=pg_temp.wa_id(2)$m$),'duplicate identities/date multiplicity retain exact output');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}',(schedule_plan->'sessions')||'[null,42,true,"scalar"]'::jsonb) where id=pg_temp.wa_id(2)$m$),'scalar/null rows retain exact diagnostics and order');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,date}','"invalid-date"') where id=pg_temp.wa_id(2)$m$),'invalid dates remain diagnostic');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0}',(schedule_plan#>'{sessions,0}')-'id'||'{"sessionKey":"fallback-only"}'::jsonb) where id=pg_temp.wa_id(2)$m$),'sessionKey identity fallback remains identical');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,scheduleState}','"skipped"') where id=pg_temp.wa_id(2)$m$),'skipped rows preserve tombstone behavior');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,scheduleState}','"tbd"') where id=pg_temp.wa_id(2)$m$),'tbd rows preserve tombstone behavior');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule='unparseable synthetic schedule' where id=pg_temp.wa_id(2)$m$),'unresolved weekly inputs preserve blockers');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule='월,수 09:00-10:00' where id=pg_temp.wa_id(2)$m$),'multiple weekly defaults preserve output order');
-- Instrument only the synthetic upstream producer to prove nonzero SQLSTATE
-- and the early diagnostic branch. This is not an operating helper change.
do $weekly$declare definition text;begin
 definition:=pg_get_functiondef('dashboard_private.read_timetable_class_weekly_v2(public.classes)'::regprocedure);
 execute replace(definition,'dashboard_private.read_timetable_class_weekly_v2(','pg_temp.wa_original_weekly(');
end $weekly$;
create or replace function dashboard_private.read_timetable_class_weekly_v2(c public.classes) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if c.id=pg_temp.wa_id(2) then return jsonb_build_object('shadowSlots',jsonb_build_array(jsonb_build_object('id','invalid-weekday','weekday','not-an-integer','startMinute',540,'endMinute',600,'teacherId',pg_temp.wa_id(101),'classroomId',pg_temp.wa_id(201))),'unresolvedOccupancies','[]'::jsonb);end if;
 return pg_temp.wa_original_weekly(c);end $$;
select ok(pg_temp.wa_equivalent('','22P02'),'malformed weekday retains the original early cast error');
select ok(pg_temp.wa_equivalent($m$update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions}','{}') where id=pg_temp.wa_id(2)$m$),'unreached default branch does not become eagerly evaluated');
create or replace function dashboard_private.read_timetable_class_weekly_v2(c public.classes) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if c.id=pg_temp.wa_id(2) then raise exception 'synthetic_reader_cancel' using errcode='57014';end if;
 return pg_temp.wa_original_weekly(c);end $$;
select ok(pg_temp.wa_equivalent('','57014'),'cancellation SQLSTATE/message propagates unchanged');
select * from finish();
rollback;
