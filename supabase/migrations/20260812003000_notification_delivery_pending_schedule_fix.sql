begin;

set local lock_timeout = '5s';

-- A pending delivery is immediately eligible from scheduled_for.  The retry
-- timestamp belongs only to retry_wait, as enforced by the ledger constraint.
create or replace function dashboard_private.materialize_notification_delivery_v1(
  p_event_id uuid,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_template_id uuid,
  p_target_generation bigint,
  p_target_set_hash text,
  p_target_kind text,
  p_target_key text,
  p_target_profile_id uuid,
  p_connection_key text,
  p_target_snapshot jsonb,
  p_rendered_title text,
  p_rendered_body text,
  p_href text,
  p_scheduled_for timestamptz,
  p_parent_delivery_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_state jsonb;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_dedupe_key text;
begin
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;

  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id;

  if v_rule.scope_key <> v_event.scope_key
    or v_rule.workflow_key <> v_event.workflow_key
    or v_rule.event_key <> v_event.event_key
    or v_rule.revision <> p_rule_revision
    or v_rule.active_template_id <> p_template_id
    or p_target_generation is null
    or p_target_generation < 0
    or nullif(pg_catalog.btrim(p_target_set_hash), '') is null
    or p_target_kind is null
    or p_target_kind not in (
      'profile', 'connection', 'push_subscription', 'customer_endpoint', 'audience'
    )
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_snapshot is null
    or pg_catalog.jsonb_typeof(p_target_snapshot) <> 'object'
    or nullif(pg_catalog.btrim(p_rendered_title), '') is null
    or nullif(pg_catalog.btrim(p_rendered_body), '') is null
    or p_scheduled_for is null
    or (p_href is not null and (p_href not like '/admin/%' or p_href like '//%'))
    or not exists (
      select 1
      from dashboard_private.notification_templates template
      where template.id = p_template_id
        and template.rule_id = p_rule_id
        and template.payload_schema_version = v_event.payload_schema_version
    )
  then
    raise exception 'notification_delivery_materialization_invalid' using errcode = '22023';
  end if;

  if p_target_profile_id is not null
    and not dashboard_private.notification_profile_is_active_v1(p_target_profile_id)
  then
    raise exception 'notification_delivery_recipient_invalid' using errcode = '22023';
  end if;

  if p_target_kind = 'audience' and (
    p_target_key <> 'audience:' || v_rule.audience_key
    or p_target_profile_id is not null
    or p_connection_key is not null
    or p_target_snapshot <> pg_catalog.jsonb_build_object(
      'audience_key', v_rule.audience_key
    )
  ) then
    raise exception 'notification_delivery_recipient_invalid' using errcode = '22023';
  end if;

  v_state := case when p_target_kind = 'audience'
    then pg_catalog.jsonb_build_object(
      'status', 'skipped',
      'status_reason', 'no_recipient'
    )
    else dashboard_private.notification_initial_delivery_state_v1(
      v_event.workflow_key,
      v_event.event_key,
      v_rule.enabled
    )
  end;
  v_dedupe_key := pg_catalog.md5(
    v_event.id::text || ':' || p_rule_id::text || ':' || v_rule.channel_key || ':' ||
    p_target_kind || ':' || p_target_key || ':' || p_target_generation::text
  );

  insert into dashboard_private.notification_deliveries(
    event_id,
    rule_id,
    rule_revision,
    template_id,
    channel_key,
    audience_key,
    target_generation,
    target_set_hash,
    target_kind,
    target_key,
    target_profile_id,
    connection_key,
    target_snapshot,
    parent_delivery_id,
    status,
    status_reason,
    dedupe_key,
    rendered_title,
    rendered_body,
    href,
    scheduled_for,
    max_attempts,
    next_attempt_at
  ) values (
    p_event_id,
    p_rule_id,
    p_rule_revision,
    p_template_id,
    v_rule.channel_key,
    v_rule.audience_key,
    p_target_generation,
    p_target_set_hash,
    p_target_kind,
    p_target_key,
    p_target_profile_id,
    p_connection_key,
    p_target_snapshot,
    p_parent_delivery_id,
    v_state ->> 'status',
    v_state ->> 'status_reason',
    v_dedupe_key,
    p_rendered_title,
    p_rendered_body,
    p_href,
    p_scheduled_for,
    case
      when v_rule.channel_key = 'in_app' then 1
      when v_event.workflow_key = 'registration'
        and v_event.event_key = 'registration.appointment_reminder_due' then 3
      else 5
    end,
    case when v_state ->> 'status' = 'retry_wait'
      then pg_catalog.clock_timestamp() else null end
  )
  on conflict (dedupe_key) do nothing
  returning * into v_delivery;

  if not found then
    select delivery.*
    into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.dedupe_key = v_dedupe_key
    for update of delivery;
    if v_delivery.event_id <> p_event_id
      or v_delivery.rule_id <> p_rule_id
      or v_delivery.rule_revision <> p_rule_revision
      or v_delivery.template_id <> p_template_id
      or v_delivery.target_generation <> p_target_generation
      or v_delivery.target_set_hash <> p_target_set_hash
      or v_delivery.target_kind <> p_target_kind
      or v_delivery.target_key <> p_target_key
      or v_delivery.target_profile_id is distinct from p_target_profile_id
      or v_delivery.connection_key is distinct from p_connection_key
      or v_delivery.target_snapshot <> p_target_snapshot
      or v_delivery.rendered_title <> p_rendered_title
      or v_delivery.rendered_body <> p_rendered_body
      or v_delivery.href is distinct from p_href
      or v_delivery.scheduled_for <> p_scheduled_for
    then
      raise exception 'notification_delivery_replay_mismatch' using errcode = '22023';
    end if;
  end if;

  if v_delivery.status = 'pending' then
    perform dashboard_private.reserve_canonical_dispatch_ownership_v1(v_delivery.id);
  end if;
  return v_delivery.id;
end;
$$;

alter function dashboard_private.materialize_notification_delivery_v1(
  uuid, uuid, bigint, uuid, bigint, text, text, text, uuid, text, jsonb,
  text, text, text, timestamptz, uuid
) owner to postgres;
revoke all on function dashboard_private.materialize_notification_delivery_v1(
  uuid, uuid, bigint, uuid, bigint, text, text, text, uuid, text, jsonb,
  text, text, text, timestamptz, uuid
) from public, anon, authenticated;

commit;
