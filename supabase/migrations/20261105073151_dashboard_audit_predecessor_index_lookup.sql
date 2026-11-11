-- #234: use the existing entity/sequence index without changing NULL semantics.
-- Only predecessor selection changes; audit locking, chain validation, sequence,
-- record writes, function identity/attributes, ownership and privileges remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $audit_predecessor_lookup$
declare
  target oid := to_regprocedure('dashboard_private.log_dashboard_audit_event_v2()');
  original_body text;
  candidate_body text;
  definition text;
  metadata_before jsonb;
  metadata_after jsonb;
  anchor text := $anchor$    select * into audit_predecessor
      from public.dashboard_audit_logs
      where entity_table = tg_table_name and entity_id is not distinct from audit_entity_id
        and record_format in ('full_v2', 'diff_v2')
      order by event_sequence desc limit 1;$anchor$;
  replacement text := $replacement$    if audit_entity_id is null then
      select * into audit_predecessor
        from public.dashboard_audit_logs
        where entity_table = tg_table_name and entity_id is null
          and record_format in ('full_v2', 'diff_v2')
        order by event_sequence desc limit 1;
    else
      select * into audit_predecessor
        from public.dashboard_audit_logs
        where entity_table = tg_table_name and entity_id = audit_entity_id
          and record_format in ('full_v2', 'diff_v2')
        order by event_sequence desc limit 1;
    end if;$replacement$;
begin
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into original_body, metadata_before
    from pg_catalog.pg_proc p where p.oid = target;
  if metadata_before is null
    or md5(original_body) is distinct from 'f7951cd0fc505c7f70adff982d8a5684'
    or length(original_body) - length(replace(original_body, anchor, '')) <> length(anchor) then
    raise exception 'audit_predecessor_lookup_definition_drift' using errcode = '55000';
  end if;
  candidate_body := replace(original_body, anchor, replacement);
  if md5(candidate_body) is distinct from '1a0d2be77da0876869cfa21505419988' then
    raise exception 'audit_predecessor_lookup_candidate_drift' using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target);
  execute replace(definition, anchor, replacement);
  select p.prosrc, to_jsonb(p) - 'prosrc' - 'prosqlbody'
    into candidate_body, metadata_after
    from pg_catalog.pg_proc p where p.oid = target;
  if md5(candidate_body) is distinct from '1a0d2be77da0876869cfa21505419988'
    or metadata_after is distinct from metadata_before then
    raise exception 'audit_predecessor_lookup_metadata_drift' using errcode = '55000';
  end if;
end
$audit_predecessor_lookup$;

commit;
