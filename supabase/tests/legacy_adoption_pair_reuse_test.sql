-- Full ordered-schema regression for the final pair-reuse current helper.
-- All domain inputs come from one synthetic approval through the real writer.
-- The prior 40 local boundary cases are separate evidence, not duplicated here.
-- No helper mock is used. Exception CONTEXT changes when inlining and is excluded;
-- query_canceled (57014) is not injected or claimed covered by WHEN OTHERS.
begin;
set local statement_timeout='8s';
set local timezone='UTC';
set local datestyle='ISO, MDY';
select no_plan();
select is(md5((select prosrc from pg_proc where oid='dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure)),
 '6566ec0f52e38ecea8aa4d63fd4cc7e9','regression targets the exact final pair-reuse current helper');
create temp table pair_contract as select p.oid,to_jsonb(p) definition from pg_proc p
where p.oid in('dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
 'dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb)'::regprocedure,
 'dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)'::regprocedure,
 'dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure);

-- BEGIN PAIR LIFECYCLE CORE
-- Extractable unchanged for the narrow native lifecycle check; no pgTAP dependency.
create function pg_temp.pair_migration_sql(direction text) returns text language sql immutable as $function$
 select case direction
 when 'forward' then $forward$do $legacy_adoption_pair_reuse$
declare
  target oid := to_regprocedure('dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)');
  snapshot_target oid := to_regprocedure('dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb)');
  c pg_catalog.pg_proc;
  s pg_catalog.pg_proc;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  applied_body text;
  candidate_body text := $candidate_body$
declare pair jsonb; ident text; expected jsonb; current_row jsonb; n int;
 adoption_lesson jsonb; adoption_marker jsonb; adoption_expected jsonb;
begin
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_after->'sessions')='array' then p_after->'sessions' else '[]'::jsonb end) s where s ? 'makeupAdoption') then return false;end if;
 pair:=dashboard_private.makeup_legacy_pair_v1(p_before,p_request);
 if pair is null then return false;end if;
 -- Inline the existing snapshot validation using this call's identical pair.
 -- The existing snapshot entry point and the plan's updated_at calculation stay
 -- unchanged. Keep validation ahead of the current-plan type/row checks.
 if jsonb_typeof(p_after->'sessions') is distinct from 'array' then return false;end if;
 adoption_lesson:=p_after#>array['sessions',pair->>'makeupIndex'];adoption_marker:=adoption_lesson->'makeupAdoption';
 if jsonb_typeof(adoption_marker) is distinct from 'object' or adoption_marker->'version' is distinct from '1'::jsonb
  or adoption_marker->>'originalId' is distinct from pair->>'originalId' or adoption_marker->>'makeupId' is distinct from pair->>'makeupId'
  or nullif(adoption_marker->>'requestUpdatedAt','') is null
  or adoption_lesson->>'classroomName' is distinct from pair->>'classroom'
  or not exists(select 1 from public.classroom_catalogs r where r.id::text=adoption_lesson->>'classroomCatalogId' and r.name=pair->>'classroom') then return false;end if;
 adoption_expected:=dashboard_private.makeup_legacy_adoption_plan_v1(p_before,p_request||jsonb_build_object('updated_at',adoption_marker->>'requestUpdatedAt'),
  jsonb_build_object('id',adoption_lesson->>'teacherCatalogId','name',adoption_lesson->>'teacherName'),jsonb_build_object('id',adoption_lesson->>'classroomCatalogId','name',adoption_lesson->>'classroomName'));
 if not (adoption_expected is not null and adoption_expected=p_after)
  or jsonb_typeof(p_current->'sessions') is distinct from 'array' then return false;end if;
 foreach ident in array array[pair->>'originalId',pair->>'makeupId'] loop
  select count(*) into n from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident or s->>'sessionKey'=ident;
  if n<>1 then return false;end if;
  select s into current_row from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident;
  select s into expected from jsonb_array_elements(p_after->'sessions') s where s->>'id'=ident;
  if current_row is null or expected is null or dashboard_private.legacy_effective_binding_v1(current_row) is distinct from dashboard_private.legacy_effective_binding_v1(expected)
   or current_row->'originalSessionId' is distinct from expected->'originalSessionId'
   or current_row->'makeupAdoption' is distinct from expected->'makeupAdoption' then return false;end if;
 end loop;
 return true;
end $candidate_body$;
begin
  select * into c from pg_catalog.pg_proc where oid = target;
  select * into s from pg_catalog.pg_proc where oid = snapshot_target;
  if c.oid is null or s.oid is null
    or md5(c.prosrc) is distinct from '16e95d3286be2806078c30c254bcf2b8'
    or md5(s.prosrc) is distinct from '1d686cc9db164e9d43fe350f5d79c18a'
    or (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = to_regprocedure('dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)')) is distinct from 'c73f03d09adb2972604eb5fb558a611f'
    or (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = to_regprocedure('dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)')) is distinct from 'b9d10c2c5e9de854f44ce8a3d4061e35' then
    raise exception 'legacy_adoption_pair_reuse_definition_drift' using errcode = '55000';
  end if;
  -- Inlining may not remove an independently restricted snapshot boundary.
  -- Only the reviewed same-owner private, stable invoker, empty-path boundary
  -- is supported. A customized snapshot STRICT/GUC/ACL contract is rejected.
  if c.proowner is distinct from s.proowner or c.proacl is distinct from s.proacl
    or exists(select 1 from pg_catalog.aclexplode(coalesce(c.proacl, pg_catalog.acldefault('f', c.proowner))) a where a.grantee <> c.proowner)
    or c.provolatile <> 's' or s.provolatile <> 's' or c.prosecdef or s.prosecdef
    or s.proisstrict
    or c.proconfig is distinct from s.proconfig
    or c.proconfig is null or cardinality(c.proconfig) <> 1
    or not (c.proconfig[1] = any(array['search_path=', 'search_path=""'])) then
    raise exception 'legacy_adoption_pair_reuse_boundary_drift' using errcode = '55000';
  end if;
  if md5(candidate_body) is distinct from '6566ec0f52e38ecea8aa4d63fd4cc7e9' then
    raise exception 'legacy_adoption_pair_reuse_candidate_drift' using errcode = '55000';
  end if;
  metadata_before := to_jsonb(c) - 'prosrc' - 'prosqlbody';
  definition := pg_catalog.pg_get_functiondef(c.oid);
  if length(definition) - length(replace(definition, c.prosrc, '')) <> length(c.prosrc) then
    raise exception 'legacy_adoption_pair_reuse_definition_drift' using errcode = '55000';
  end if;
  -- Reuse the installed header: owner, ACL, COST, STRICT, PARALLEL and settings
  -- are never reset by a static CREATE declaration. Any failed guard is atomic.
  execute replace(definition, c.prosrc, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into applied_body, metadata_after from pg_catalog.pg_proc p where p.oid = c.oid;
  if md5(applied_body) is distinct from '6566ec0f52e38ecea8aa4d63fd4cc7e9'
    or metadata_after is distinct from metadata_before then
    raise exception 'legacy_adoption_pair_reuse_metadata_drift' using errcode = '55000';
  end if;
end
$legacy_adoption_pair_reuse$;$forward$
 when 'rollback' then $rollback$do $legacy_adoption_pair_reuse_rollback$
declare
  target oid := to_regprocedure('dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)');
  snapshot_target oid := to_regprocedure('dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb)');
  c pg_catalog.pg_proc;
  s pg_catalog.pg_proc;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  applied_body text;
  candidate_body text := $candidate_body$
declare pair jsonb; ident text; expected jsonb; current_row jsonb; n int;
begin
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_after->'sessions')='array' then p_after->'sessions' else '[]'::jsonb end) s where s ? 'makeupAdoption') then return false;end if;
 pair:=dashboard_private.makeup_legacy_pair_v1(p_before,p_request);
 if pair is null or not dashboard_private.makeup_legacy_adoption_snapshot_v1(p_before,p_after,p_request)
  or jsonb_typeof(p_current->'sessions') is distinct from 'array' then return false;end if;
 foreach ident in array array[pair->>'originalId',pair->>'makeupId'] loop
  select count(*) into n from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident or s->>'sessionKey'=ident;
  if n<>1 then return false;end if;
  select s into current_row from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident;
  select s into expected from jsonb_array_elements(p_after->'sessions') s where s->>'id'=ident;
  if current_row is null or expected is null or dashboard_private.legacy_effective_binding_v1(current_row) is distinct from dashboard_private.legacy_effective_binding_v1(expected)
   or current_row->'originalSessionId' is distinct from expected->'originalSessionId'
   or current_row->'makeupAdoption' is distinct from expected->'makeupAdoption' then return false;end if;
 end loop;
 return true;
end $candidate_body$;
begin
  select * into c from pg_catalog.pg_proc where oid = target;
  select * into s from pg_catalog.pg_proc where oid = snapshot_target;
  if c.oid is null or s.oid is null
    or md5(c.prosrc) is distinct from '6566ec0f52e38ecea8aa4d63fd4cc7e9'
    or md5(s.prosrc) is distinct from '1d686cc9db164e9d43fe350f5d79c18a'
    or (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = to_regprocedure('dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)')) is distinct from 'c73f03d09adb2972604eb5fb558a611f'
    or (select md5(p.prosrc) from pg_catalog.pg_proc p where p.oid = to_regprocedure('dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)')) is distinct from 'b9d10c2c5e9de854f44ce8a3d4061e35' then
    raise exception 'legacy_adoption_pair_reuse_rollback_definition_drift' using errcode = '55000';
  end if;
  -- Inlining may not remove an independently restricted snapshot boundary.
  -- Only the reviewed same-owner private, stable invoker, empty-path boundary
  -- is supported. A customized snapshot STRICT/GUC/ACL contract is rejected.
  if c.proowner is distinct from s.proowner or c.proacl is distinct from s.proacl
    or exists(select 1 from pg_catalog.aclexplode(coalesce(c.proacl, pg_catalog.acldefault('f', c.proowner))) a where a.grantee <> c.proowner)
    or c.provolatile <> 's' or s.provolatile <> 's' or c.prosecdef or s.prosecdef
    or s.proisstrict
    or c.proconfig is distinct from s.proconfig
    or c.proconfig is null or cardinality(c.proconfig) <> 1
    or not (c.proconfig[1] = any(array['search_path=', 'search_path=""'])) then
    raise exception 'legacy_adoption_pair_reuse_rollback_boundary_drift' using errcode = '55000';
  end if;
  if md5(candidate_body) is distinct from '16e95d3286be2806078c30c254bcf2b8' then
    raise exception 'legacy_adoption_pair_reuse_rollback_candidate_drift' using errcode = '55000';
  end if;
  metadata_before := to_jsonb(c) - 'prosrc' - 'prosqlbody';
  definition := pg_catalog.pg_get_functiondef(c.oid);
  if length(definition) - length(replace(definition, c.prosrc, '')) <> length(c.prosrc) then
    raise exception 'legacy_adoption_pair_reuse_rollback_definition_drift' using errcode = '55000';
  end if;
  -- Reuse the installed header: owner, ACL, COST, STRICT, PARALLEL and settings
  -- are never reset by a static CREATE declaration. Any failed guard is atomic.
  execute replace(definition, c.prosrc, candidate_body);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into applied_body, metadata_after from pg_catalog.pg_proc p where p.oid = c.oid;
  if md5(applied_body) is distinct from '16e95d3286be2806078c30c254bcf2b8'
    or metadata_after is distinct from metadata_before then
    raise exception 'legacy_adoption_pair_reuse_rollback_metadata_drift' using errcode = '55000';
  end if;
end
$legacy_adoption_pair_reuse_rollback$;$rollback$
 end
$function$;
create function pg_temp.pair_exec_state(command text) returns jsonb language plpgsql as $function$
declare s text;m text;
begin
 execute command;
 return jsonb_build_object('state','00000','message','');
exception when others then
 get stacked diagnostics s=returned_sqlstate,m=message_text;
 return jsonb_build_object('state',s,'message',m);
end $function$;
create function pg_temp.pair_registry() returns jsonb language sql stable as $function$
 select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
 where p.oid in('dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
  'dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb)'::regprocedure,
  'dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)'::regprocedure,
  'dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure)
$function$;
create function pg_temp.pair_lifecycle_checks() returns table(passed boolean,label text)
language plpgsql as $function$
declare
 target oid:='dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 saved_registry jsonb:=pg_temp.pair_registry();baseline_registry jsonb;
 saved_metadata jsonb;snapshot_registry jsonb;custom_metadata jsonb;
 result jsonb;recovery_result jsonb;item record;body text;definition text;
 intact boolean;applied boolean;recovered boolean;
begin
 select to_jsonb(p)-'prosrc'-'prosqlbody' into saved_metadata from pg_proc p where oid=target;
 return query select md5(prosrc)='6566ec0f52e38ecea8aa4d63fd4cc7e9',
  'lifecycle starts at the exact installed candidate' from pg_proc where oid=target;
 result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('rollback'));
 return query select result->>'state'='00000','actual guarded recovery restores the baseline';
 return query select md5(prosrc)='16e95d3286be2806078c30c254bcf2b8' and (to_jsonb(p)-'prosrc'-'prosqlbody')=saved_metadata,
  'recovery preserves the current OID and every non-body attribute' from pg_proc p where oid=target;
 baseline_registry:=pg_temp.pair_registry();
 result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('rollback'));
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_rollback_definition_drift')
  and pg_temp.pair_registry()=baseline_registry,'repeated recovery rejects exact 55000 without mutation';
 -- Each fault is inside an exception subtransaction. The sentinel rolls back
 -- deliberate DDL, including ACLs, after preserving the observed result.
 for item in select * from (values
  ('current','dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)'),
  ('snapshot','dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb)'),
  ('pair','dashboard_private.makeup_legacy_pair_v1(jsonb,jsonb)'),
  ('plan','dashboard_private.makeup_legacy_adoption_plan_v1(jsonb,jsonb,jsonb,jsonb)')
 ) v(helper,signature) loop
  begin
   select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=to_regprocedure(item.signature);
   execute replace(definition,body,body||E'\n-- synthetic dependency drift\n');
   snapshot_registry:=pg_temp.pair_registry();
   result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
   intact:=pg_temp.pair_registry()=snapshot_registry;
   raise exception using errcode='P0T01',message='rollback synthetic lifecycle fault';
  exception when sqlstate 'P0T01' then null;
  end;
  return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_definition_drift')
   and intact and pg_temp.pair_registry()=baseline_registry,
   item.helper||' body drift rejects exact 55000 and preserves rejected and restored state';
 end loop;
 for item in select * from (values
  ('snapshot STRICT','alter function dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) strict'),
  ('snapshot extra GUC','alter function dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) set work_mem=''6MB'''),
  ('matching extra GUCs','alter function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb) set work_mem=''6MB''; alter function dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) set work_mem=''6MB'''),
  ('unequal snapshot ACL','grant execute on function dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) to public'),
  ('matching non-owner ACLs','grant execute on function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb), dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) to public')
 ) v(fault,command) loop
  begin
   execute item.command;
   snapshot_registry:=pg_temp.pair_registry();
   result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
   intact:=pg_temp.pair_registry()=snapshot_registry;
   raise exception using errcode='P0T01',message='rollback synthetic lifecycle fault';
  exception when sqlstate 'P0T01' then null;
  end;
  return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_boundary_drift')
   and intact and pg_temp.pair_registry()=baseline_registry,
   item.fault||' rejects exact 55000 without crossing the snapshot boundary';
 end loop;
 result:=pg_temp.pair_exec_state(replace(pg_temp.pair_migration_sql('forward'),
  '-- Inline the existing snapshot validation using this call''s identical pair.',
  '-- Synthetic candidate-body drift.'));
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_candidate_drift')
  and pg_temp.pair_registry()=baseline_registry,'a changed candidate literal rejects exact 55000 before DDL';
 begin
  alter function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb) cost 139;
  alter function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb) strict;
  select to_jsonb(p)-'prosrc'-'prosqlbody' into custom_metadata from pg_proc p where oid=target;
  result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
  select md5(prosrc)='6566ec0f52e38ecea8aa4d63fd4cc7e9' and (to_jsonb(p)-'prosrc'-'prosqlbody')=custom_metadata
   into applied from pg_proc p where oid=target;
  recovery_result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('rollback'));
  select md5(prosrc)='16e95d3286be2806078c30c254bcf2b8' and (to_jsonb(p)-'prosrc'-'prosqlbody')=custom_metadata
   into recovered from pg_proc p where oid=target;
  raise exception using errcode='P0T01',message='rollback synthetic current attributes';
 exception when sqlstate 'P0T01' then null;
 end;
 return query select result->>'state'='00000' and applied,'forward retains current STRICT, nondefault COST and all remaining attributes';
 return query select recovery_result->>'state'='00000' and recovered and pg_temp.pair_registry()=baseline_registry,
  'recovery retains those attributes and the probe restores the original registry';
 begin
  alter function dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb) rename to issue234_pair_temporarily_missing;
  result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
  raise exception using errcode='P0T01',message='rollback synthetic missing target';
 exception when sqlstate 'P0T01' then null;
 end;
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_definition_drift')
  and pg_temp.pair_registry()=baseline_registry,'missing target rejects exact 55000 before DDL';
 result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
 return query select result->>'state'='00000','actual guarded forward applies after recovery';
 return query select pg_temp.pair_registry()=saved_registry,'forward restores all four exact bodies, OIDs, owners, ACLs and attributes';
 result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('forward'));
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_definition_drift')
  and pg_temp.pair_registry()=saved_registry,'forward reapplication rejects exact 55000 without mutation';
 begin
  select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=target;
  execute replace(definition,body,body||E'\n-- synthetic recovery drift\n');
  snapshot_registry:=pg_temp.pair_registry();
  result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('rollback'));
  intact:=pg_temp.pair_registry()=snapshot_registry;
  raise exception using errcode='P0T01',message='rollback synthetic recovery fault';
 exception when sqlstate 'P0T01' then null;
 end;
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_rollback_definition_drift')
  and intact and pg_temp.pair_registry()=saved_registry,'recovery refuses an intervening body and never overwrites it';
 begin
  alter function dashboard_private.makeup_legacy_adoption_snapshot_v1(jsonb,jsonb,jsonb) strict;
  snapshot_registry:=pg_temp.pair_registry();
  result:=pg_temp.pair_exec_state(pg_temp.pair_migration_sql('rollback'));
  intact:=pg_temp.pair_registry()=snapshot_registry;
  raise exception using errcode='P0T01',message='rollback synthetic recovery boundary';
 exception when sqlstate 'P0T01' then null;
 end;
 return query select result=jsonb_build_object('state','55000','message','legacy_adoption_pair_reuse_rollback_boundary_drift')
  and intact and pg_temp.pair_registry()=saved_registry,'recovery also rejects a customized STRICT snapshot boundary';
 return query select pg_temp.pair_registry()=saved_registry,'lifecycle leaves the exact candidate and untouched dependencies for domain tests';
end $function$;
-- END PAIR LIFECYCLE CORE

create temporary table pair_lifecycle_results on commit drop as select * from pg_temp.pair_lifecycle_checks();
select is((select count(*) from pair_lifecycle_results),23::bigint,'all twenty-three pair lifecycle checks execute');
select ok(passed,label) from pair_lifecycle_results;

-- Frozen control: only its qualified function identity differs from the original.
create function pg_temp.original_adoption_current(p_current jsonb,p_before jsonb,p_after jsonb,p_request jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $f$
declare pair jsonb; ident text; expected jsonb; current_row jsonb; n int;
begin
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_after->'sessions')='array' then p_after->'sessions' else '[]'::jsonb end) s where s ? 'makeupAdoption') then return false;end if;
 pair:=dashboard_private.makeup_legacy_pair_v1(p_before,p_request);
 if pair is null or not dashboard_private.makeup_legacy_adoption_snapshot_v1(p_before,p_after,p_request)
  or jsonb_typeof(p_current->'sessions') is distinct from 'array' then return false;end if;
 foreach ident in array array[pair->>'originalId',pair->>'makeupId'] loop
  select count(*) into n from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident or s->>'sessionKey'=ident;
  if n<>1 then return false;end if;
  select s into current_row from jsonb_array_elements(p_current->'sessions') s where s->>'id'=ident;
  select s into expected from jsonb_array_elements(p_after->'sessions') s where s->>'id'=ident;
  if current_row is null or expected is null or dashboard_private.legacy_effective_binding_v1(current_row) is distinct from dashboard_private.legacy_effective_binding_v1(expected)
   or current_row->'originalSessionId' is distinct from expected->'originalSessionId'
   or current_row->'makeupAdoption' is distinct from expected->'makeupAdoption' then return false;end if;
 end loop;
 return true;
end $f$;
revoke all on function pg_temp.original_adoption_current(jsonb,jsonb,jsonb,jsonb) from public;
select is(md5((select prosrc from pg_proc where oid='pg_temp.original_adoption_current(jsonb,jsonb,jsonb,jsonb)'::regprocedure)),
 '16e95d3286be2806078c30c254bcf2b8','control alias preserves the exact original current body');
create function pg_temp.prid(n int) returns uuid language sql immutable as $$
 select ('af101110-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.capture_pair(control boolean,c jsonb,b jsonb,a jsonb,r jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare answer boolean;s text;m text;d text;h text;
begin
 if control then answer:=pg_temp.original_adoption_current(c,b,a,r);
 else answer:=dashboard_private.makeup_legacy_adoption_current_v1(c,b,a,r);end if;
 return jsonb_build_object('state','00000','message','','detail','','hint','','value',answer);
exception when others then
 get stacked diagnostics s=returned_sqlstate,m=message_text,d=pg_exception_detail,h=pg_exception_hint;
 return jsonb_build_object('state',s,'message',m,'detail',d,'hint',h,'value',null);
end $$;
-- Reuse the existing full-schema actual adoption writer setup, including real
-- notification producer, calendar evidence, row triggers and deferred guards.
create function pg_temp.pair_reuse_plan() returns jsonb language sql immutable as $f$ select $j${"subject":"영어","className":"Pair reuse adoption","selectedDays":[3,5],"billingPeriods":[{"id":"synthetic-billing","month":10,"label":"Synthetic billing","startDate":"2050-10-01","endDate":"2050-10-31"}],"sessionStates":{"2050-10-20":{"state":"exception","makeupDate":"2050-10-06","memo":"Preserved cancellation memo"}},"sessionSchedules":{},"extension":{"keep":true},"sessions":[{"id":"legacy-original-alpha","sessionKey":"legacy-original-alpha","date":"2050-10-20","state":"exception","scheduleState":"exception","makeupDate":"2050-10-06","billingId":"synthetic-billing","teacherNote":"Preserved original note","memo":"Preserved original memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":8,"end":10}}],"progressStatus":"done"},{"id":"legacy-makeup-alpha","sessionKey":"legacy-makeup-alpha","date":"2050-10-06","state":"makeup","scheduleState":"makeup","originalDate":"2050-10-20","originalSessionId":"legacy-original-alpha","billingId":"synthetic-billing","teacherNote":"Preserved makeup note","memo":"Preserved makeup memo","textbookEntries":[{"textbookId":"synthetic-book","actual":{"start":11,"end":14}}],"progressStatus":"done"}]}$j$::jsonb $f$;

create function pg_temp.pr_expected(p_request jsonb) returns jsonb language sql immutable as $f$
 select jsonb_set(jsonb_set(pg_temp.pair_reuse_plan(),'{sessions,0}',
  pg_temp.pair_reuse_plan()#>'{sessions,0}'||jsonb_build_object('makeupRequestId',p_request->>'id','makeupRequestRole','cancel')),
  '{sessions,1}',pg_temp.pair_reuse_plan()#>'{sessions,1}'||jsonb_build_object(
   'makeupRequestId',p_request->>'id','makeupRequestRole','makeup',
   'makeupAdoption',jsonb_build_object('version',1,'requestUpdatedAt',p_request->>'updated_at','originalId','legacy-original-alpha','makeupId','legacy-makeup-alpha'),
   'startTime','18:00','endTime','20:00','teacherCatalogId',pg_temp.prid(1),'teacherName','Pair reuse adoption teacher',
   'classroomCatalogId',pg_temp.prid(2),'classroomName','Pair reuse adoption room'))
$f$;
insert into auth.users(id,instance_id,aud,role,email) values
 (pg_temp.prid(801),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','pair-reuse-adoption@synthetic.invalid');
insert into public.profiles(id,role,name) values(pg_temp.prid(801),'admin','Pair reuse adoption actor')
on conflict(id) do update set role=excluded.role;
delete from public.teacher_catalogs where profile_id=pg_temp.prid(801);
insert into public.teacher_catalogs(id,name,subjects,profile_id) values
 (pg_temp.prid(1),'Pair reuse adoption teacher',array['영어'],pg_temp.prid(801));
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.prid(2),'Pair reuse adoption room',array['영어']);
update public.profiles set teacher_catalog_id=pg_temp.prid(1) where id=pg_temp.prid(801);
insert into dashboard_private.makeup_subject_directors_v1 values('영어',pg_temp.prid(801),pg_temp.prid(1));
insert into public.classes(id,name,subject,teacher,room,schedule,status,schedule_storage_mode,schedule_plan)
values(pg_temp.prid(4),'Pair reuse adoption','영어','Pair reuse adoption teacher','Pair reuse adoption room',
 '수금 19:30-21:30','수강','legacy',pg_temp.pair_reuse_plan());
insert into public.makeup_requests(id,status,request_kind,subject,approval_group,requester_id,class_id,class_name,
 teacher_catalog_id,teacher_profile_id,approver_teacher_catalog_id,approver_profile_id,cancel_date,
 makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.prid(3),'approval_pending','cancel_makeup','영어','english',pg_temp.prid(801),pg_temp.prid(4),
 'Pair reuse adoption',pg_temp.prid(1),pg_temp.prid(801),pg_temp.prid(1),pg_temp.prid(801),'2050-10-20',
 '2050-10-06T09:00:00Z','2050-10-06T11:00:00Z','Pair reuse adoption room',
 '[{"startAt":"2050-10-06T18:00:00+09:00","endAt":"2050-10-06T20:00:00+09:00","classroom":"Pair reuse adoption room"}]');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table pair_initial_request as select to_jsonb(r) value from public.makeup_requests r where id=pg_temp.prid(3);
create temp table pair_no_send as select count(*) deliveries from dashboard_private.notification_deliveries;
select set_config('test.pair_reuse_patch',jsonb_build_object(
 'actor_profile_id',pg_temp.prid(801),'final_note','Synthetic native override adoption',
 'schedule_plan_before',pg_temp.pair_reuse_plan(),'schedule_plan_after',pg_temp.pr_expected(value),
 'cancel_academic_event_id',pg_temp.prid(100),'makeup_academic_event_id',pg_temp.prid(101),'makeup_academic_event_ids',jsonb_build_array(pg_temp.prid(101)),
 'calendar_events',jsonb_build_array(
  jsonb_build_object('id',pg_temp.prid(100),'title','[휴강] Pair reuse adoption','date','2050-10-20','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','cancel','requestId',pg_temp.prid(3),'className','Pair reuse adoption','subject','영어','cancelDate','2050-10-20','reason','')::text),
  jsonb_build_object('id',pg_temp.prid(101),'title','[보강] Pair reuse adoption','date','2050-10-06','type','팁스','grade','all',
   'note','[[TIPS_MAKEUP]] '||jsonb_build_object('kind','makeup','requestId',pg_temp.prid(3),'className','Pair reuse adoption','subject','영어',
    'classroom','Pair reuse adoption room','startAt','2050-10-06T18:00:00+09:00','endAt','2050-10-06T20:00:00+09:00','slotIndex',0,'reason','')::text)))::text,true)
from pair_initial_request;
select set_config('request.jwt.claim.sub',pg_temp.prid(801)::text,true),
 set_config('request.jwt.claim.role','service_role',true),
 set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.prid(801),'role','service_role')::text,true);
set local role service_role;
select lives_ok($$select public.transition_makeup_request_v2(pg_temp.prid(3),'approve',
 current_setting('test.pair_reuse_patch')::jsonb,'approval_pending',pg_temp.prid(210))$$,
 'actual final approval writer admits the synthetic legacy pair');
reset role;
select is((select schedule_plan from public.classes where id=pg_temp.prid(4)),
 (select pg_temp.pr_expected(value) from pair_initial_request),'actual approval preserves the independently expected adoption plan');

-- The consumer sees actual persisted producer output, not a mocked plan helper.
create temp table pair_saved_inputs as
select c.schedule_plan c,r.schedule_plan_before b,r.schedule_plan_after a,to_jsonb(r) r
from public.classes c join public.makeup_requests r on r.class_id=c.id
where c.id=pg_temp.prid(4) and r.id=pg_temp.prid(3);
create temp table pair_cases(label text primary key,c jsonb,b jsonb,a jsonb,r jsonb,expected boolean);
insert into pair_cases
select v.* from pair_saved_inputs i cross join lateral (values
 ('actual approved producer output',i.c,i.b,i.a,i.r,true),
 ('SQL NULL current fails closed',null::jsonb,i.b,i.a,i.r,false),
 ('invalid marker and invalid current fail closed','false'::jsonb,i.b,
  jsonb_set(i.a,'{sessions,1,makeupAdoption,version}','2'::jsonb),i.r,false),
 ('plan teacher mismatch and invalid current fail closed','false'::jsonb,i.b,
  jsonb_set(i.a,'{sessions,1,teacherCatalogId}',to_jsonb(pg_temp.prid(999)::text)),i.r,false),
 ('malformed request date fails closed',i.c,i.b,i.a,
  jsonb_set(i.r,'{cancel_date}','"not-a-date"'::jsonb),false),
 ('duplicate current identity fails closed',jsonb_set(i.c,'{sessions}',
  (i.c->'sessions')||jsonb_build_array(i.c#>'{sessions,1}')),i.b,i.a,i.r,false),
 -- Current content/order are not adoption ownership. The remaining plan call
 -- must still use the saved marker generation rather than this fresh request.
 ('content/order and changed request generation retain saved proof',
  jsonb_set(i.c||'{"syntheticExtra":true}'::jsonb,'{sessions}',jsonb_build_array(
   (i.c#>'{sessions,1}')||'{"memo":"content-only change"}'::jsonb,i.c#>'{sessions,0}')),
  i.b,i.a,jsonb_set(i.r,'{updated_at}','"2051-01-01T00:00:00Z"'::jsonb),true)
) v(label,c,b,a,r,expected);
select is((select count(*) from pair_cases),7::bigint,'all seven real-schema producer boundary cases are present');
create temp table pair_captures as select label,expected,
 pg_temp.capture_pair(false,c,b,a,r) candidate,pg_temp.capture_pair(true,c,b,a,r) baseline
from pair_cases;
select is(candidate,baseline,label||': boolean and SQLSTATE/message/detail/hint match the frozen original')
from pair_captures order by label;
select is(candidate,jsonb_build_object('state','00000','message','','detail','','hint','','value',expected),
 label||': independently specified boolean and success envelope') from pair_captures order by label;
-- Invalid input outcomes above do not assert evaluation order. The prior local
-- pure-spy boundary evidence covers error priority; it is not replayed here.
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from pair_no_send),
 'real approval and current-helper probes create no provider delivery');
select ok(not exists(select 1 from pair_contract s left join pg_proc p on p.oid=s.oid
 where to_jsonb(p) is distinct from s.definition),'all four protected function bodies, OIDs, owners, ACLs and attributes remain intact');
select ok(not has_function_privilege(role_name,'dashboard_private.makeup_legacy_adoption_current_v1(jsonb,jsonb,jsonb,jsonb)','EXECUTE'),
 'private current helper remains denied for '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;
set local role anon;
select throws_ok('select dashboard_private.makeup_legacy_adoption_current_v1(null,null,null,null)',
 '42501',null,'actual anon call to the final current helper is denied with SQLSTATE 42501');
reset role;
select * from finish();
rollback;
