begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Trusted-server input only. The DB retains authoritative event/rule/recipient,
-- href, schedule, generation and dispatch ownership. It verifies the immutable
-- template binding; it does not claim to prove TS presentation semantics from a
-- checksum. The HTTP route alone constructs these strings with the canonical
-- presenter/renderer. Existing v1 entry points and old snapshots are unchanged.
create or replace function dashboard_private.notification_with_makeup_rendered_snapshot_v1(
  p_item jsonb,
  p_template_id uuid,
  p_template_checksum text,
  p_rendered_title text,
  p_rendered_body text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_item is null or pg_catalog.jsonb_typeof(p_item) <> 'object'
    or p_template_id is null
    or p_template_id::text is distinct from p_item ->> 'templateId'
    or p_template_checksum is null
    or p_template_checksum !~ '^([a-f0-9]{32}|[a-f0-9]{64})$'
    or p_template_checksum is distinct from p_item ->> 'templateChecksum'
    or nullif(pg_catalog.btrim(p_rendered_title), '') is null
    or nullif(pg_catalog.btrim(p_rendered_body), '') is null
    or pg_catalog.char_length(p_rendered_title) > 200
    or pg_catalog.char_length(p_rendered_body) > 4000
    or (p_rendered_title || p_rendered_body) ~ '<[^>]*>'
    or (p_rendered_title || p_rendered_body) ~* '(https?://|www\.|@(all|everyone|here|channel)\y)'
    or (p_rendered_title || p_rendered_body) ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F]'
  then
    raise exception 'makeup_legacy_render_snapshot_invalid' using errcode = '22023';
  end if;
  return p_item || pg_catalog.jsonb_build_object(
    'renderedTitle', p_rendered_title,
    'renderedBody', p_rendered_body
  );
end;
$$;

create or replace function public.materialize_makeup_legacy_google_chat_v2(
  p_source_event_id uuid,
  p_rule_id uuid,
  p_connection_key text,
  p_target_generation bigint,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_template_id uuid,
  p_template_checksum text,
  p_rendered_title text,
  p_rendered_body text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  plan jsonb;
  item jsonb;
  delivery_id uuid;
  target_set_hash text;
  ownership jsonb;
  claim_row dashboard_private.notification_dispatch_ownership_claims%rowtype;
  replay_outcome text;
  recovered_unknown boolean := false;
begin
  if p_source_event_id is null or p_rule_id is null
    or nullif(pg_catalog.btrim(p_connection_key), '') is null
    or p_target_generation is distinct from 0 or p_actor_profile_id is null or p_request_id is null
  then
    raise exception 'makeup_legacy_google_chat_projection_invalid' using errcode = '22023';
  end if;
  plan := public.get_makeup_legacy_dispatch_plan_v1(
    p_source_event_id,
    p_actor_profile_id
  );
  select value into item
  from pg_catalog.jsonb_array_elements(plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'connectionKey' = p_connection_key
    and value ->> 'channelKey' = 'google_chat'
  limit 1;
  if item is null then
    raise exception 'makeup_legacy_google_chat_projection_forbidden'
      using errcode = '42501';
  end if;

  item := dashboard_private.notification_with_makeup_rendered_snapshot_v1(
    item, p_template_id, p_template_checksum, p_rendered_title, p_rendered_body
  );

  target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', item -> 'targetKind',
      'target_key', item -> 'targetKey',
      'target_profile_id', item -> 'targetProfileId',
      'connection_key', item -> 'connectionKey',
      'target_snapshot', item -> 'targetSnapshot'
    ))
  );
  delivery_id := dashboard_private.materialize_notification_delivery_v1(
    (item ->> 'eventId')::uuid,
    (item ->> 'ruleId')::uuid,
    (item ->> 'ruleRevision')::bigint,
    (item ->> 'templateId')::uuid,
    p_target_generation,
    target_set_hash,
    item ->> 'targetKind',
    item ->> 'targetKey',
    null,
    item ->> 'connectionKey',
    item -> 'targetSnapshot',
    item ->> 'renderedTitle',
    item ->> 'renderedBody',
    item ->> 'href',
    (item ->> 'scheduledFor')::timestamptz,
    null
  );
  ownership := public.begin_legacy_notification_dispatch_v1(
    'makeup_requests',
    item ->> 'occurrenceKey',
    (item ->> 'ruleId')::uuid,
    item ->> 'channelKey',
    item ->> 'targetKey',
    p_target_generation,
    'makeup_legacy_google_chat_v1',
    0,
    p_request_id
  );
  if not (ownership ->> 'acquired')::boolean then
    select claim.* into claim_row
    from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.id = (ownership ->> 'claim_id')::uuid
    for update of claim;
    if found
      and claim_row.owner_kind = 'legacy'
      and claim_row.state = 'dispatch_started'
      and claim_row.dispatch_token is not null
    then
      replay_outcome := 'delivery_unknown';
      recovered_unknown := true;
    elsif found and claim_row.state = 'closed' then
      replay_outcome := claim_row.terminal_outcome;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'deliveryId', delivery_id,
    'occurrenceKey', item ->> 'occurrenceKey',
    'ruleId', item ->> 'ruleId',
    'channelKey', item ->> 'channelKey',
    'targetKey', item ->> 'targetKey',
    'targetGeneration', p_target_generation::text,
    'requestId', p_request_id,
    'acquired', (ownership ->> 'acquired')::boolean,
    'claimId', ownership ->> 'claim_id',
    'ownerGeneration', coalesce(
      ownership ->> 'owner_generation',
      claim_row.owner_generation::text
    ),
    'dispatchToken', coalesce(
      ownership ->> 'dispatch_token',
      claim_row.dispatch_token::text
    ),
    'replayOutcome', replay_outcome,
    'recoveredUnknown', recovered_unknown
  );
end;
$$;

revoke all on function dashboard_private.notification_with_makeup_rendered_snapshot_v1(
  jsonb, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.materialize_makeup_legacy_google_chat_v2(
  uuid, uuid, text, bigint, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.materialize_makeup_legacy_google_chat_v2(
  uuid, uuid, text, bigint, uuid, uuid, uuid, text, text, text
) to service_role;
alter function dashboard_private.notification_with_makeup_rendered_snapshot_v1(
  jsonb, uuid, text, text, text
) owner to postgres;
alter function public.materialize_makeup_legacy_google_chat_v2(
  uuid, uuid, text, bigint, uuid, uuid, uuid, text, text, text
) owner to postgres;
commit;
