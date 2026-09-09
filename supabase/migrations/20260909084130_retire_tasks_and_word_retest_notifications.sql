begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep historical rules and delivery evidence, but retire every delivery channel.
update dashboard_private.notification_rules
set enabled=false, revision=revision+1, updated_by=null,
  updated_actor_kind='system', updated_at=pg_catalog.now()
where workflow_key in ('tasks','word_retests') and enabled;

alter table dashboard_private.notification_rules
  add constraint notification_rules_unused_workflows_retired_check
  check (not enabled or workflow_key not in ('tasks','word_retests')) not valid;

update dashboard_private.notification_deliveries delivery
set status='canceled', status_reason='cutover_rollback',
  claimed_by=null, claim_token=null, lease_expires_at=null, next_attempt_at=null,
  cancel_requested_at=coalesce(delivery.cancel_requested_at,pg_catalog.now()),
  cancel_reason='notification_workflow_retired',
  resolved_at=coalesce(delivery.resolved_at,pg_catalog.now()), updated_at=pg_catalog.now()
from dashboard_private.notification_events event_row
where event_row.id=delivery.event_id
  and event_row.workflow_key in ('tasks','word_retests')
  and delivery.status in ('pending','claimed','retry_wait');

-- Patch the current definitions so registration/transfer/withdrawal protections
-- and the existing authentication and ownership checks stay intact.
do $retire_unused_workflows$
declare v_definition text; v_anchor text; v_patch text;
begin
  v_definition:=pg_catalog.pg_get_functiondef(
    'public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor:=$anchor$  if v_task.type = 'word_retest' then$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
    or strpos(v_definition,'ops_task_legacy_dispatch_forbidden')=0 then
    raise exception 'unused_workflow_legacy_retirement_anchor_invalid' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,$patch$  if v_task.type in ('general','word_retest') then
    if not dashboard_private.notification_profile_is_active_v1(p_actor_profile_id) then
      raise exception 'ops_task_legacy_dispatch_forbidden' using errcode='42501';
    end if;$patch$);

  v_definition:=pg_catalog.pg_get_functiondef(
    'dashboard_private.get_subject_completion_legacy_plan_v1(uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor:=$anchor$and event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed','word_retest.result_reported');$anchor$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
    or strpos(v_definition,'notification_profile_is_active_v1')=0 then
    raise exception 'unused_workflow_subject_retirement_anchor_invalid' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,$patch$and event_key in ('registration.subject_registration_completed','transfer.completed','withdrawal.completed');$patch$);

  v_definition:=pg_catalog.pg_get_functiondef(
    'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor:=$anchor$  v_entity_id := v_claim.id::text || ':'$anchor$;
  v_patch:=$patch$  if v_claim.workflow_key in ('tasks','word_retests') then
    return pg_catalog.jsonb_build_object('allowed',false,'reason','notification_workflow_retired');
  end if;

  v_entity_id := v_claim.id::text || ':'$patch$;
  if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
    or strpos(v_definition,'registration_management_notification_preview_changed')=0
    or strpos(v_definition,'ops_subject_completion_source_stale')=0 then
    raise exception 'unused_workflow_external_retirement_anchor_invalid' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,v_patch);
end;
$retire_unused_workflows$;

commit;
