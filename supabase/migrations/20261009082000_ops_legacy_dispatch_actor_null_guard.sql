begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve the existing actor relationships and server-only call boundary.
-- A NULL optional assignee must not turn a failed authorization into success.
do $ops_legacy_actor_guard$
declare
  target regprocedure := 'public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)'::regprocedure;
  definition text;
  anchor text;
  replacement text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
begin
  select proowner, proacl, proconfig into original_owner, original_acl, original_config
  from pg_catalog.pg_proc where oid = target;
  definition := pg_catalog.pg_get_functiondef(target);
  if pg_catalog.md5(definition) <> '0960819fac3c984d0ae471e02eafb03a' then
    raise exception 'ops_legacy_dispatch_actor_guard_definition_drift' using errcode = '55000';
  end if;
  anchor := $anchor$  if not (
    v_source.actor_id = p_actor_profile_id
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or v_actor_role in ('admin', 'staff')
  ) then
    raise exception 'ops_task_legacy_dispatch_forbidden' using errcode = '42501';$anchor$;
  replacement := $replacement$  if not coalesce((
    v_source.actor_id = p_actor_profile_id
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or v_actor_role in ('admin', 'staff')
  ), false) then
    raise exception 'ops_task_legacy_dispatch_forbidden' using errcode = '42501';$replacement$;
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception 'ops_legacy_dispatch_actor_guard_anchor_drift' using errcode = '55000';
  end if;
  execute replace(definition, anchor, replacement);
  if exists (
    select 1 from pg_catalog.pg_proc where oid = target
      and (proowner is distinct from original_owner
        or proacl is distinct from original_acl
        or proconfig is distinct from original_config)
  ) then
    raise exception 'ops_legacy_dispatch_actor_guard_security_drift' using errcode = '55000';
  end if;
end;
$ops_legacy_actor_guard$;

commit;
