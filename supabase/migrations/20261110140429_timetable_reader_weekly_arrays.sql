-- #234: reuse this class's ordered weekly arrays instead of per-lesson SPI queries.
-- The full reader and validator still run. No date/state/auth/lock policy changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $weekly_arrays$
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
end $weekly_arrays$;
commit;
