-- #249: distinguish an unchanged historical snapshot from ownership of a new pair.
-- Exact body replacement only; authentication, locks, owner/ACL and all other
-- adoption/occupancy checks are retained. No business records are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare p pg_catalog.pg_proc; before_metadata jsonb; replacement text:=$body$
 select exists(select 1 from public.makeup_requests other where other.id<>p_request.id and other.class_id=p_request.class_id
  and other.status not in('rejected','canceled')
  and (other.cancel_date=p_request.cancel_date or exists(
   select 1 from jsonb_array_elements(
    (case when jsonb_typeof(other.schedule_plan_before->'sessions')='array' then other.schedule_plan_before->'sessions' else '[]'::jsonb end)
    ||(case when jsonb_typeof(other.schedule_plan_after->'sessions')='array' then other.schedule_plan_after->'sessions' else '[]'::jsonb end)) s
   where s->>'id' in(pair->>'originalId',pair->>'makeupId'))))
$body$;
begin
 select * into p from pg_catalog.pg_proc
  where oid=to_regprocedure('dashboard_private.makeup_legacy_pair_competing_v1(public.makeup_requests,jsonb)');
 if not found or md5(p.prosrc)<>'d2864a81d9287b8956ba701b827b64a5' or p.prosqlbody is not null then
  raise exception using errcode='55000',message='makeup_snapshot_ownership_recovery_definition_drift';end if;
 if p.proowner<>'postgres'::regrole or p.prolang<>(select oid from pg_language where lanname='sql')
  or p.provolatile<>'s' or p.prosecdef or p.proisstrict or p.proparallel<>'u'
  or p.procost<>100 or p.prorows<>0 or p.proleakproof
  or p.proconfig is null or cardinality(p.proconfig)<>1
  or not(p.proconfig[1]=any(array['search_path=','search_path=""']))
  or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception using errcode='55000',message='makeup_snapshot_ownership_boundary_drift';end if;
 before_metadata:=to_jsonb(p)-'prosrc';
 execute replace(pg_get_functiondef(p.oid),p.prosrc,replacement);
 if (select md5(prosrc)<>'c892cccbbc7f755e0a2ea3876c5408d8' or (to_jsonb(q)-'prosrc') is distinct from before_metadata
  from pg_catalog.pg_proc q where q.oid=p.oid) then
  raise exception using errcode='55000',message='makeup_snapshot_ownership_metadata_changed';end if;
end $migration$;
commit;
