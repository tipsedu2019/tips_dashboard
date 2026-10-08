begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Old requests may have no submitted event, or may have been submitted before
-- a last lesson was selected. Completion uses the validated current detail.
-- Preserve whatever was actually recorded; never backfill an original request
-- from today's detail or rewrite a historical notification/event.
do $withdrawal_request_snapshot$
declare
  v_target regprocedure := 'dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)'::regprocedure;
  v_definition text;
  v_anchor text;
  v_patch text;
  v_owner oid;
  v_acl aclitem[];
begin
  select proowner, proacl into v_owner, v_acl from pg_catalog.pg_proc where oid = v_target;
  v_definition := pg_catalog.pg_get_functiondef(v_target);
  v_anchor := '  v_requested_withdrawal_date date;';
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'withdrawal_request_snapshot_declaration_drift' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor,
    v_anchor || E'\n  v_requested_withdrawal_snapshot_status text;');

  v_anchor := $anchor$      if not found
        or v_requested_withdrawal_date is null
        or v_requested_withdrawal_round is null
      then
        raise exception 'ops_withdrawal_request_snapshot_required' using errcode = '23514';
      end if;$anchor$;
  v_patch := $patch$      v_requested_withdrawal_snapshot_status := case
        when not found then 'missing'
        when v_requested_withdrawal_date is null
          or v_requested_withdrawal_round is null then 'incomplete'
        else 'complete'
      end;$patch$;
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'withdrawal_request_snapshot_guard_drift' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor, v_patch);

  v_anchor := $anchor$    'requested_withdrawal_date', case when p_task.type = 'withdrawal' then v_requested_withdrawal_date end,$anchor$;
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'withdrawal_request_snapshot_payload_drift' using errcode = '55000';
  end if;
  v_definition := replace(v_definition, v_anchor,
    $patch$    'requested_withdrawal_snapshot_status', v_requested_withdrawal_snapshot_status,
$patch$ || v_anchor);
  execute v_definition;

  if exists (
    select 1 from pg_catalog.pg_proc where oid = v_target
      and (proowner is distinct from v_owner or proacl is distinct from v_acl)
  ) then
    raise exception 'withdrawal_request_snapshot_acl_drift' using errcode = '55000';
  end if;
end;
$withdrawal_request_snapshot$;
commit;
