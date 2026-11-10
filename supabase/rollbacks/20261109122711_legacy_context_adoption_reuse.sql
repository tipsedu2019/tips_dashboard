-- #234: restore only the same candidate row's proven TRUE adoption result.
-- Reviewed main 87df8d978902da22def71b90a4cad10c74b6b073. No helper, ACL or lock changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $legacy_context_adoption_reuse_rollback$
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
$legacy_context_adoption_reuse_rollback$;

commit;
