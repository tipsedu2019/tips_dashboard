begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.begin_legacy_notification_dispatch_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_legacy_owner_key text,
  p_expected_owner_generation bigint,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_dispatch_token uuid;
  v_response jsonb;
begin
  if p_workflow_key is null
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_rule_id is null
    or p_channel_key is null
    or p_channel_key not in ('in_app', 'web_push', 'google_chat', 'customer_message')
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_generation is null or p_target_generation < 0
    or nullif(pg_catalog.btrim(p_legacy_owner_key), '') is null
    or pg_catalog.octet_length(p_legacy_owner_key) > 96
    or p_expected_owner_generation is null or p_expected_owner_generation < 0
    or p_request_id is null
    or not exists (
      select 1 from dashboard_private.notification_rules rule
      where rule.id = p_rule_id
        and rule.workflow_key = p_workflow_key
        and rule.channel_key = p_channel_key
    )
  then
    raise exception 'notification_legacy_dispatch_invalid' using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'workflow_key', p_workflow_key, 'occurrence_key', p_occurrence_key,
    'rule_id', p_rule_id, 'channel_key', p_channel_key, 'target_key', p_target_key,
    'target_generation', p_target_generation::text,
    'legacy_owner_key', p_legacy_owner_key,
    'expected_owner_generation', p_expected_owner_generation::text
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'legacy_dispatch_begin'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    if coalesce((v_ledger.response_payload ->> 'acquired')::boolean, false) then
      select ownership.* into v_claim
      from dashboard_private.notification_dispatch_ownership_claims ownership
      where ownership.id = (v_ledger.response_payload ->> 'claim_id')::uuid
      for update of ownership;
      if not found
        or v_claim.owner_kind <> 'legacy'
        or v_claim.owner_generation
          <> (v_ledger.response_payload ->> 'owner_generation')::bigint
        or v_claim.dispatch_token
          <> (v_ledger.response_payload ->> 'dispatch_token')::uuid
      then
        raise exception 'notification_legacy_replay_state_mismatch'
          using errcode = '23514';
      end if;
      if v_claim.state = 'dispatch_started' then
        return pg_catalog.jsonb_build_object(
          'acquired', false,
          'claim_id', v_claim.id,
          'owner_generation', v_claim.owner_generation::text,
          'dispatch_token', v_claim.dispatch_token,
          'status', 'dispatch_already_started',
          'reason', 'idempotent_dispatch_replay'
        );
      end if;
      if v_claim.state = 'closed' then
        return pg_catalog.jsonb_build_object(
          'acquired', false,
          'claim_id', v_claim.id,
          'owner_generation', v_claim.owner_generation::text,
          'status', coalesce(v_claim.terminal_outcome, 'closed'),
          'reason', 'idempotent_dispatch_replay'
        );
      end if;
      raise exception 'notification_legacy_replay_state_mismatch'
        using errcode = '23514';
    end if;
    return v_ledger.response_payload;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workflow_key || ':' || p_occurrence_key || ':' || p_rule_id::text || ':' ||
    p_channel_key || ':' || p_target_key || ':' || p_target_generation::text,
    0
  ));
  insert into dashboard_private.notification_dispatch_ownership_claims(
    workflow_key, occurrence_key, rule_id, channel_key, target_key,
    target_generation, owner_kind, owner_generation, state
  ) values (
    p_workflow_key, p_occurrence_key, p_rule_id, p_channel_key, p_target_key,
    p_target_generation, 'legacy', p_expected_owner_generation, 'reserved'
  )
  on conflict (
    workflow_key, occurrence_key, rule_id, channel_key, target_key, target_generation
  ) do nothing
  returning * into v_claim;
  if not found then
    select ownership.* into strict v_claim
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = p_workflow_key
      and ownership.occurrence_key = p_occurrence_key
      and ownership.rule_id = p_rule_id
      and ownership.channel_key = p_channel_key
      and ownership.target_key = p_target_key
      and ownership.target_generation = p_target_generation
    for update of ownership;
  end if;

  if v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_expected_owner_generation
    or v_claim.state <> 'reserved'
  then
    v_response := pg_catalog.jsonb_build_object(
      'acquired', false,
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'status', 'legacy_deduped',
      'reason', 'ownership_not_acquired'
    );
  else
    v_dispatch_token := gen_random_uuid();
    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state = 'dispatch_started',
        dispatch_started_at = pg_catalog.clock_timestamp(),
        dispatch_token = v_dispatch_token,
        updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_claim.id;
    v_response := pg_catalog.jsonb_build_object(
      'acquired', true,
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'dispatch_token', v_dispatch_token,
      'status', 'dispatch_started'
    );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'legacy_dispatch_begin', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text,
    case when (v_response ->> 'acquired')::boolean then 'legacy_dispatch_started'
      else 'ownership_not_acquired' end,
    null, 'system', p_request_id,
    pg_catalog.jsonb_build_object('owner_kind', v_claim.owner_kind, 'state', v_claim.state),
    pg_catalog.jsonb_build_object('status', v_response ->> 'status'),
    p_legacy_owner_key
  );
  return v_response;
end;
$$;

create or replace function public.finalize_legacy_notification_dispatch_v1(
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  if p_claim_id is null or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'notification_legacy_finalize_invalid' using errcode = '22023';
  end if;
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
    or v_claim.state not in ('dispatch_started', 'closed')
  then
    raise exception 'notification_legacy_ownership_mismatch' using errcode = '23514';
  end if;
  if v_claim.state = 'closed' then
    if v_claim.terminal_outcome is distinct from p_outcome
      or v_claim.provider_reference is distinct from p_provider_reference
    then
      raise exception 'notification_legacy_finalize_replay_mismatch'
        using errcode = '23514';
    end if;
    return pg_catalog.jsonb_build_object(
      'claim_id', v_claim.id,
      'owner_generation', v_claim.owner_generation::text,
      'status', 'closed',
      'outcome', v_claim.terminal_outcome,
      'replayed', true
    );
  end if;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed',
      provider_reference = p_provider_reference,
      terminal_outcome = p_outcome,
      updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_claim.id;
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text, 'legacy_dispatch_finalized',
    null, 'system',
    pg_catalog.jsonb_build_object('state', 'dispatch_started'),
    pg_catalog.jsonb_build_object('state', 'closed', 'outcome', p_outcome),
    p_outcome
  );
  return pg_catalog.jsonb_build_object(
    'claim_id', v_claim.id,
    'owner_generation', v_claim.owner_generation::text,
    'status', 'closed',
    'outcome', p_outcome,
    'replayed', false
  );
end;
$$;

alter function public.begin_legacy_notification_dispatch_v1(
  text, text, uuid, text, text, bigint, text, bigint, uuid
) owner to postgres;
alter function public.finalize_legacy_notification_dispatch_v1(
  uuid, bigint, uuid, text, text
) owner to postgres;

revoke all on function public.begin_legacy_notification_dispatch_v1(
  text, text, uuid, text, text, bigint, text, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_legacy_notification_dispatch_v1(
  uuid, bigint, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.begin_legacy_notification_dispatch_v1(
  text, text, uuid, text, text, bigint, text, bigint, uuid
) to service_role;
grant execute on function public.finalize_legacy_notification_dispatch_v1(
  uuid, bigint, uuid, text, text
) to service_role;

commit;
