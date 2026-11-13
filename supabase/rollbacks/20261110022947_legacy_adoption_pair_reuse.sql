-- #234: restore the previous adoption-current body only.
-- Source main 54f5182c77bf5eba6521294a1ab14fd67bcc4533. No data, ACL or lock changes.
-- Exact source/dependency pins reject drift; this is not an operational approval.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $legacy_adoption_pair_reuse_rollback$
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
$legacy_adoption_pair_reuse_rollback$;

commit;
