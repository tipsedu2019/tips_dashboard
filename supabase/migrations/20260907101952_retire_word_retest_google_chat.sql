begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep rules, templates, and content contracts for historical audit references.
update dashboard_private.notification_rules
set enabled = false, revision = revision + 1,
    updated_by = null, updated_actor_kind = 'system', updated_at = pg_catalog.now()
where workflow_key = 'word_retests' and channel_key = 'google_chat' and enabled;

alter table dashboard_private.notification_rules
  add constraint notification_rules_word_retest_chat_retired_check
  check (not (workflow_key = 'word_retests' and channel_key = 'google_chat' and enabled))
  not valid;
-- Validate in the following migration after this transaction releases its table lock.

-- Cancel work that has not entered sending. Preserve sent/unknown/sending evidence.
update dashboard_private.notification_deliveries delivery
set status = 'canceled', status_reason = 'cutover_rollback',
    claimed_by = null, claim_token = null, lease_expires_at = null, next_attempt_at = null,
    cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.now()),
    cancel_reason = 'word_retest_google_chat_retired',
    resolved_at = coalesce(delivery.resolved_at, pg_catalog.now()), updated_at = pg_catalog.now()
from dashboard_private.notification_events event_row
where event_row.id = delivery.event_id
  and event_row.workflow_key = 'word_retests'
  and delivery.channel_key = 'google_chat'
  and delivery.status in ('pending', 'claimed', 'retry_wait');

-- Patch the final ordered definitions rather than restoring an older copy.
do $retire_word_retest_chat$
declare
  v_definition text;
  v_anchor text;
  v_replacement text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.get_ops_task_legacy_dispatch_plan_v1(uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor := $anchor$  select event_row.* into v_canonical
  from dashboard_private.notification_events event_row$anchor$;
  v_replacement := $replacement$  if v_task.type = 'word_retest' then
    return pg_catalog.jsonb_build_object('items', '[]'::jsonb, 'retired', true);
  end if;
  select event_row.* into v_canonical
  from dashboard_private.notification_events event_row$replacement$;
  if pg_catalog.strpos(v_definition, 'ops_task_legacy_dispatch_forbidden') = 0
    or pg_catalog.strpos(v_definition, 'retired') > 0
    or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
      <> pg_catalog.length(v_anchor)
  then
    raise exception 'word_retest_legacy_retirement_anchor_invalid' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);

  v_definition := pg_catalog.pg_get_functiondef(
    'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor := $anchor$  v_entity_id := v_claim.id::text || ':'$anchor$;
  v_replacement := $replacement$  if v_claim.workflow_key = 'word_retests' and v_claim.channel_key = 'google_chat' then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'word_retest_google_chat_retired');
  end if;

  v_entity_id := v_claim.id::text || ':'$replacement$;
  if pg_catalog.strpos(v_definition, 'registration_management_notification_source_current_v2') = 0
    or pg_catalog.strpos(v_definition, 'word_retest_google_chat_retired') > 0
    or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
      <> pg_catalog.length(v_anchor)
  then
    raise exception 'word_retest_external_retirement_anchor_invalid' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$retire_word_retest_chat$;

commit;
