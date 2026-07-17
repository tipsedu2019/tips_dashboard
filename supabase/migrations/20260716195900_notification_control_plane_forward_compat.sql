-- 이미 적용된 20260716112000 마이그레이션은 변경하지 않고,
-- 이벤트 시점 규칙 스냅샷, 레거시 전달 재실행, 전달 lease 복구 보완을 순방향으로 적용한다.

begin;

set local lock_timeout = '5s';

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
  v_rule_snapshot jsonb;
  v_state jsonb;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_dedupe_key text;
  v_template_checksum text;
  v_rendered_hash text;
  v_comparison_key text;
  v_pair_key text;
  v_intent_fingerprint text;
  v_subscription public.dashboard_push_subscriptions%rowtype;
  v_push_delivery dashboard_private.notification_deliveries%rowtype;
  v_push_dedupe_key text;
  v_scope_key text;
  v_dispatch_flag_key text;
  v_shadow_enabled boolean;
  v_dispatch_enabled boolean;
  v_flag dashboard_private.notification_runtime_flags%rowtype;
  v_cutover_owner dashboard_private.notification_cutover_owners%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;

  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id;

  select snapshot.value into v_rule_snapshot
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(value)
  where snapshot.value ->> 'rule_id' = p_rule_id::text
    and snapshot.value ->> 'rule_revision' = p_rule_revision::text
    and snapshot.value ->> 'template_id' = p_template_id::text;

  if v_rule_snapshot is null
    or v_rule.scope_key <> v_event.scope_key
    or v_rule.workflow_key <> v_event.workflow_key
    or v_rule.event_key <> v_event.event_key
    or v_rule.channel_key <> (v_rule_snapshot ->> 'channel_key')
    or v_rule.audience_key <> (v_rule_snapshot ->> 'audience_key')
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
    p_target_key <> 'audience:' || (v_rule_snapshot ->> 'audience_key')
    or p_target_profile_id is not null
    or p_connection_key is not null
    or p_target_snapshot <> pg_catalog.jsonb_build_object(
      'audience_key', v_rule_snapshot ->> 'audience_key'
    )
  ) then
    raise exception 'notification_delivery_recipient_invalid' using errcode = '22023';
  end if;

  v_scope_key := dashboard_private.notification_dispatch_scope_for_event_v1(
    v_event.workflow_key, v_event.event_key
  );
  select owner_row.dispatch_flag_key into v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key;
  if v_scope_key is null or v_dispatch_flag_key is null then
    raise exception 'notification_delivery_scope_invalid' using errcode = '22023';
  end if;

  -- Match activation/rollback lock order: flags by key, then the scope owner.
  -- These SHARE locks stay held through delivery and ownership reflection.
  v_shadow_enabled := null;
  v_dispatch_enabled := null;
  for v_flag in
    select flag_row.*
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key in (
      'notification_control_plane_shadow_write_enabled',
      v_dispatch_flag_key
    )
    order by flag_row.flag_key
    for share of flag_row
  loop
    if v_flag.flag_key = 'notification_control_plane_shadow_write_enabled' then
      v_shadow_enabled := v_flag.enabled;
    elsif v_flag.flag_key = v_dispatch_flag_key then
      v_dispatch_enabled := v_flag.enabled;
    end if;
  end loop;
  select owner_row.* into v_cutover_owner
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;
  if v_shadow_enabled is null
    or v_dispatch_enabled is null
    or not found
    or (v_cutover_owner.owner_kind = 'canonical' and not v_dispatch_enabled)
    or (v_cutover_owner.owner_kind = 'legacy' and v_dispatch_enabled)
  then
    raise exception 'notification_delivery_cutover_state_invalid' using errcode = '55000';
  end if;

  v_state := case
    when p_target_kind = 'audience' then pg_catalog.jsonb_build_object(
      'status', 'skipped', 'status_reason', 'no_recipient'
    )
    when not (v_rule_snapshot ->> 'enabled')::boolean then
      pg_catalog.jsonb_build_object(
        'status', 'disabled', 'status_reason', 'rule_disabled'
      )
    when v_cutover_owner.owner_kind = 'canonical' and v_dispatch_enabled then
      pg_catalog.jsonb_build_object('status', 'pending', 'status_reason', null)
    when v_cutover_owner.owner_kind = 'legacy' and v_shadow_enabled then
      pg_catalog.jsonb_build_object(
        'status', 'skipped', 'status_reason', 'shadow_mode'
      )
    else pg_catalog.jsonb_build_object(
      'status', 'skipped', 'status_reason', 'legacy_skipped'
    )
  end;
  v_dedupe_key := pg_catalog.md5(
    v_event.id::text || ':' || p_rule_id::text || ':' ||
    (v_rule_snapshot ->> 'channel_key') || ':' ||
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
    v_rule_snapshot ->> 'channel_key',
    v_rule_snapshot ->> 'audience_key',
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
      when v_rule_snapshot ->> 'channel_key' = 'in_app' then 1
      when v_event.workflow_key = 'registration'
        and v_event.event_key = 'registration.appointment_reminder_due' then 3
      else 5
    end,
    null
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
  elsif v_delivery.status = 'skipped'
    and v_delivery.status_reason = 'shadow_mode'
  then
    insert into dashboard_private.notification_dispatch_ownership_claims(
      workflow_key, occurrence_key, rule_id, channel_key, target_key,
      target_generation, owner_kind, owner_generation, state
    ) values (
      v_event.workflow_key, v_event.occurrence_key, v_delivery.rule_id,
      v_delivery.channel_key, v_delivery.target_key,
      v_delivery.target_generation, 'legacy', 0, 'reserved'
    ) on conflict (
      workflow_key, occurrence_key, rule_id, channel_key,
      target_key, target_generation
    ) do nothing;
    select ownership.* into strict v_ownership
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation
    for update of ownership;
    if v_ownership.owner_kind <> 'legacy' then
      raise exception 'notification_shadow_ownership_mismatch'
        using errcode = '55000';
    end if;

    select template.checksum into strict v_template_checksum
    from dashboard_private.notification_templates template
    where template.id = v_delivery.template_id
      and template.rule_id = v_delivery.rule_id;
    v_rendered_hash := dashboard_private.notification_normalized_rendered_hash_v1(
      v_delivery.rendered_title, v_delivery.rendered_body, v_delivery.href
    );
    v_comparison_key := dashboard_private.notification_shadow_comparison_key_v1(
      v_event.workflow_key, v_event.event_key, v_event.occurrence_key,
      v_delivery.rule_id, v_delivery.audience_key, v_delivery.channel_key,
      v_delivery.target_key, v_delivery.target_generation
    );
    v_pair_key := dashboard_private.notification_shadow_pair_key_v1(
      v_event.workflow_key, v_event.event_key, v_event.occurrence_key,
      v_delivery.rule_id, v_delivery.audience_key
    );
    v_intent_fingerprint := dashboard_private.notification_sha256_hex_v1(
      pg_catalog.concat_ws(
        E'\x1f', 'canonical', v_comparison_key,
        v_template_checksum, v_rendered_hash
      )
    );
    if not exists (
      select 1 from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'notification_shadow_intent'
        and audit.entity_id = v_intent_fingerprint
        and audit.action = 'canonical_intent_recorded'
    ) then
      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        after_summary, reason_code
      ) values (
        'notification_shadow_intent', v_intent_fingerprint,
        'canonical_intent_recorded', null, 'system',
        pg_catalog.jsonb_build_object(
          'workflow_key', v_event.workflow_key,
          'event_key', v_event.event_key,
          'event_id', v_event.id,
          'occurrence_key_hash', dashboard_private.notification_sha256_hex_v1(
            v_event.occurrence_key
          ),
          'rule_id', v_delivery.rule_id,
          'audience_key', v_delivery.audience_key,
          'channel_key', v_delivery.channel_key,
          'target_key_hash', dashboard_private.notification_sha256_hex_v1(
            v_delivery.target_key
          ),
          'target_generation', v_delivery.target_generation::text,
          'template_checksum', v_template_checksum,
          'normalized_rendered_hash', v_rendered_hash,
          'comparison_key', v_comparison_key,
          'pair_key', v_pair_key,
          'intent_fingerprint', v_intent_fingerprint
        ),
        'shadow_parity'
      );
      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        after_summary, reason_code
      ) values (
        'notification_delivery', v_delivery.id::text,
        'shadow_delivery_evaluated', null, 'system',
        pg_catalog.jsonb_build_object(
          'workflow_key', v_event.workflow_key,
          'event_key', v_event.event_key,
          'comparison_key', v_comparison_key
        ),
        'shadow_mode'
      );
    end if;
    perform dashboard_private.notification_compare_shadow_intent_v1(
      v_comparison_key
    );

    -- Canonical in-app commit creates one Web Push child for every current
    -- subscription. Materialize the same would-be fanout in shadow so parity
    -- cannot silently pass while legacy omits or changes a push target.
    if v_delivery.channel_key = 'in_app'
      and v_delivery.target_profile_id is not null
    then
      for v_subscription in
        select subscription.*
        from public.dashboard_push_subscriptions subscription
        where subscription.profile_id = v_delivery.target_profile_id
        order by subscription.id
        for share of subscription
      loop
        v_push_dedupe_key := pg_catalog.md5(
          v_delivery.dedupe_key || ':push:' || v_subscription.id::text
        );
        insert into dashboard_private.notification_deliveries(
          id, event_id, rule_id, rule_revision, template_id, channel_key,
          audience_key, target_generation, target_set_hash, target_kind,
          target_key, target_profile_id, connection_key, target_snapshot,
          parent_delivery_id, status, status_reason, dedupe_key,
          rendered_title, rendered_body, href, scheduled_for, max_attempts,
          next_attempt_at
        ) values (
          dashboard_private.notification_deterministic_uuid_v1(
            'canonical-shadow-web-push-delivery-v1',
            v_delivery.id::text || ':' || v_subscription.id::text
          ),
          v_delivery.event_id,
          v_delivery.rule_id,
          v_delivery.rule_revision,
          v_delivery.template_id,
          'web_push',
          v_delivery.audience_key,
          v_delivery.target_generation,
          v_delivery.target_set_hash || ':push',
          'push_subscription',
          'push_subscription:' || v_subscription.id::text,
          v_delivery.target_profile_id,
          null,
          pg_catalog.jsonb_build_object(
            'subscription_id', v_subscription.id,
            'endpoint', v_subscription.endpoint,
            'p256dh', v_subscription.p256dh,
            'auth', v_subscription.auth,
            'active', true
          ),
          v_delivery.id,
          'skipped',
          'shadow_mode',
          v_push_dedupe_key,
          v_delivery.rendered_title,
          v_delivery.rendered_body,
          v_delivery.href,
          v_delivery.scheduled_for,
          5,
          null
        ) on conflict (dedupe_key) do nothing;

        select delivery.* into strict v_push_delivery
        from dashboard_private.notification_deliveries delivery
        where delivery.dedupe_key = v_push_dedupe_key
        for update of delivery;
        if v_push_delivery.event_id <> v_delivery.event_id
          or v_push_delivery.rule_id <> v_delivery.rule_id
          or v_push_delivery.channel_key <> 'web_push'
          or v_push_delivery.target_key <>
            'push_subscription:' || v_subscription.id::text
          or v_push_delivery.target_generation <> v_delivery.target_generation
          or v_push_delivery.parent_delivery_id <> v_delivery.id
          or v_push_delivery.rendered_title <> v_delivery.rendered_title
          or v_push_delivery.rendered_body <> v_delivery.rendered_body
          or v_push_delivery.href is distinct from v_delivery.href
        then
          raise exception 'notification_shadow_push_replay_mismatch'
            using errcode = '22023';
        end if;

        insert into dashboard_private.notification_dispatch_ownership_claims(
          workflow_key, occurrence_key, rule_id, channel_key, target_key,
          target_generation, owner_kind, owner_generation, state
        ) values (
          v_event.workflow_key, v_event.occurrence_key,
          v_push_delivery.rule_id, v_push_delivery.channel_key,
          v_push_delivery.target_key, v_push_delivery.target_generation,
          'legacy', 0, 'reserved'
        ) on conflict (
          workflow_key, occurrence_key, rule_id, channel_key,
          target_key, target_generation
        ) do nothing;
        select ownership.* into strict v_ownership
        from dashboard_private.notification_dispatch_ownership_claims ownership
        where ownership.workflow_key = v_event.workflow_key
          and ownership.occurrence_key = v_event.occurrence_key
          and ownership.rule_id = v_push_delivery.rule_id
          and ownership.channel_key = v_push_delivery.channel_key
          and ownership.target_key = v_push_delivery.target_key
          and ownership.target_generation = v_push_delivery.target_generation
        for update of ownership;
        if v_ownership.owner_kind <> 'legacy' then
          raise exception 'notification_shadow_push_ownership_mismatch'
            using errcode = '55000';
        end if;

        v_comparison_key := dashboard_private.notification_shadow_comparison_key_v1(
          v_event.workflow_key, v_event.event_key, v_event.occurrence_key,
          v_push_delivery.rule_id, v_push_delivery.audience_key,
          v_push_delivery.channel_key, v_push_delivery.target_key,
          v_push_delivery.target_generation
        );
        v_pair_key := dashboard_private.notification_shadow_pair_key_v1(
          v_event.workflow_key, v_event.event_key, v_event.occurrence_key,
          v_push_delivery.rule_id, v_push_delivery.audience_key
        );
        v_intent_fingerprint := dashboard_private.notification_sha256_hex_v1(
          pg_catalog.concat_ws(
            E'\x1f', 'canonical', v_comparison_key,
            v_template_checksum, v_rendered_hash
          )
        );
        if not exists (
          select 1 from dashboard_private.notification_audit_logs audit
          where audit.entity_kind = 'notification_shadow_intent'
            and audit.entity_id = v_intent_fingerprint
            and audit.action = 'canonical_intent_recorded'
        ) then
          insert into dashboard_private.notification_audit_logs(
            entity_kind, entity_id, action, actor_profile_id, actor_kind,
            after_summary, reason_code
          ) values (
            'notification_shadow_intent', v_intent_fingerprint,
            'canonical_intent_recorded', null, 'system',
            pg_catalog.jsonb_build_object(
              'workflow_key', v_event.workflow_key,
              'event_key', v_event.event_key,
              'event_id', v_event.id,
              'occurrence_key_hash', dashboard_private.notification_sha256_hex_v1(
                v_event.occurrence_key
              ),
              'rule_id', v_push_delivery.rule_id,
              'audience_key', v_push_delivery.audience_key,
              'channel_key', v_push_delivery.channel_key,
              'target_key_hash', dashboard_private.notification_sha256_hex_v1(
                v_push_delivery.target_key
              ),
              'target_generation', v_push_delivery.target_generation::text,
              'template_checksum', v_template_checksum,
              'normalized_rendered_hash', v_rendered_hash,
              'comparison_key', v_comparison_key,
              'pair_key', v_pair_key,
              'intent_fingerprint', v_intent_fingerprint
            ),
            'shadow_parity'
          );
          insert into dashboard_private.notification_audit_logs(
            entity_kind, entity_id, action, actor_profile_id, actor_kind,
            after_summary, reason_code
          ) values (
            'notification_delivery', v_push_delivery.id::text,
            'shadow_delivery_evaluated', null, 'system',
            pg_catalog.jsonb_build_object(
              'workflow_key', v_event.workflow_key,
              'event_key', v_event.event_key,
              'comparison_key', v_comparison_key,
              'derived_channel', 'web_push'
            ),
            'shadow_mode'
          );
        end if;
        perform dashboard_private.notification_compare_shadow_intent_v1(
          v_comparison_key
        );
      end loop;
    end if;
  end if;
  return v_delivery.id;
end;
$$;

create or replace function dashboard_private.apply_notification_fanout_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_target_set_hash text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_event_fanout_jobs%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_rule_index integer;
  v_rule_count integer;
  v_delivery jsonb;
  v_delivery_id uuid;
  v_delivery_count integer := 0;
  v_targets jsonb := '[]'::jsonb;
begin
  if p_job_id is null or p_claim_token is null or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_target_set_hash is null or p_target_set_hash !~ '^[a-f0-9]{64}$'
    or p_batch is null or pg_catalog.jsonb_typeof(p_batch) <> 'object'
    or not (p_batch ? 'deliveries')
    or p_batch - 'deliveries' <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_batch -> 'deliveries') <> 'array'
    or p_done is null
    or (p_done and p_next_cursor is not null)
    or (not p_done and nullif(p_next_cursor, '') is null)
  then
    raise exception 'notification_fanout_batch_invalid' using errcode = '22023';
  end if;

  select job.* into v_job
  from dashboard_private.notification_event_fanout_jobs job
  where job.id = p_job_id
  for update of job;
  if not found or v_job.status <> 'claimed' or v_job.claim_token <> p_claim_token then
    raise exception 'notification_fanout_claim_mismatch' using errcode = '40001';
  end if;
  if coalesce((v_job.cursor ->> 'done')::boolean, false)
    or nullif(v_job.cursor ->> 'value', '') is distinct from nullif(p_expected_cursor, '')
  then
    raise exception 'notification_fanout_cursor_conflict' using errcode = '40001';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_job.event_id;
  v_rule_count := pg_catalog.jsonb_array_length(v_event.rule_snapshot);
  v_rule_index := coalesce(nullif(v_job.cursor ->> 'value', '')::integer, 0);
  v_rule_snapshot := v_event.rule_snapshot -> v_rule_index;
  if v_rule_snapshot is null
    or v_rule_snapshot ->> 'rule_id' <> p_rule_id::text
    or v_rule_snapshot ->> 'rule_revision' <> p_rule_revision::text
    or (
      p_done and p_next_cursor is not null
      or not p_done and p_next_cursor <> (v_rule_index + 1)::text
    )
    or p_done is distinct from (v_rule_index >= v_rule_count - 1)
  then
    raise exception 'notification_fanout_rule_cursor_mismatch' using errcode = '40001';
  end if;

  for v_delivery in select value from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
  loop
    if pg_catalog.jsonb_typeof(v_delivery) <> 'object'
      or not (v_delivery ?& array[
        'template_id', 'target_kind', 'target_key', 'target_profile_id',
        'connection_key', 'target_snapshot', 'rendered_title', 'rendered_body',
        'href', 'scheduled_for'
      ]::text[])
      or v_delivery - array[
        'template_id', 'target_kind', 'target_key', 'target_profile_id',
        'connection_key', 'target_snapshot', 'rendered_title', 'rendered_body',
        'href', 'scheduled_for'
      ]::text[] <> '{}'::jsonb
      or v_delivery ->> 'template_id' <> v_rule_snapshot ->> 'template_id'
      or pg_catalog.jsonb_typeof(v_delivery -> 'target_snapshot') <> 'object'
      or (v_delivery ->> 'scheduled_for')::timestamptz is distinct from v_job.scheduled_for
    then
      raise exception 'notification_fanout_delivery_invalid' using errcode = '22023';
    end if;
    v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
      v_event.id,
      p_rule_id,
      p_rule_revision,
      (v_delivery ->> 'template_id')::uuid,
      p_target_generation,
      p_target_set_hash,
      v_delivery ->> 'target_kind',
      v_delivery ->> 'target_key',
      case when v_delivery -> 'target_profile_id' = 'null'::jsonb then null
        else (v_delivery ->> 'target_profile_id')::uuid end,
      case when v_delivery -> 'connection_key' = 'null'::jsonb then null
        else v_delivery ->> 'connection_key' end,
      v_delivery -> 'target_snapshot',
      v_delivery ->> 'rendered_title',
      v_delivery ->> 'rendered_body',
      case when v_delivery -> 'href' = 'null'::jsonb then null
        else v_delivery ->> 'href' end,
      (v_delivery ->> 'scheduled_for')::timestamptz
    );
    perform v_delivery_id;
    v_delivery_count := v_delivery_count + 1;
    v_targets := v_targets || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', v_delivery ->> 'target_kind',
      'target_key', v_delivery ->> 'target_key',
      'target_profile_id', v_delivery -> 'target_profile_id',
      'connection_key', v_delivery -> 'connection_key',
      'target_snapshot', v_delivery -> 'target_snapshot'
    ));
  end loop;

  if dashboard_private.notification_target_set_hash_v1(p_batch -> 'deliveries')
    <> p_target_set_hash
  then
    raise exception 'notification_target_set_hash_mismatch' using errcode = '22023';
  end if;

  update dashboard_private.notification_event_fanout_jobs job
  set cursor = case when p_done then pg_catalog.jsonb_build_object('done', true)
    else pg_catalog.jsonb_build_object('value', p_next_cursor, 'done', false) end,
      target_generation = p_target_generation,
      target_set_hash = p_target_set_hash,
      target_snapshot = v_targets,
      outcome_summary = pg_catalog.jsonb_build_object(
        'delivery_count', v_delivery_count,
        'done', p_done
      ),
      updated_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'delivery_count', v_delivery_count,
    'cursor', p_next_cursor,
    'done', p_done
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'notification_fanout_batch_invalid' using errcode = '22023';
end;
$$;

-- Internal worker wrappers. These are intentionally outside the locked 25
-- domain/operator interfaces: PostgREST can reach public, while the actual
-- implementations stay in dashboard_private and are never granted directly.

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
  v_rearm_ledger boolean := false;
  v_ledger_generation bigint;
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
        and (
          rule.channel_key = p_channel_key
          or (p_channel_key = 'web_push' and rule.channel_key = 'in_app')
        )
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
    begin
      v_ledger_generation := nullif(
        v_ledger.response_payload ->> 'owner_generation', ''
      )::bigint;
    exception
      when invalid_text_representation then v_ledger_generation := null;
    end;
    if nullif(v_ledger.response_payload ->> 'claim_id', '') is not null then
      select ownership.* into v_claim
      from dashboard_private.notification_dispatch_ownership_claims ownership
      where ownership.id = (v_ledger.response_payload ->> 'claim_id')::uuid;
      if found
        and p_expected_owner_generation = 0
        and v_claim.owner_kind = 'legacy'
        and v_claim.state = 'reserved'
        and v_claim.owner_generation > coalesce(v_ledger_generation, -1)
      then
        v_rearm_ledger := true;
      elsif found and v_claim.state in ('dispatch_started', 'closed') then
        return pg_catalog.jsonb_build_object(
          'acquired', false,
          'claim_id', v_claim.id,
          'owner_generation', v_claim.owner_generation::text,
          'dispatch_token', v_claim.dispatch_token,
          'status', case when v_claim.state = 'closed'
            then coalesce(v_claim.terminal_outcome, 'closed')
            else 'dispatch_already_started' end,
          'reason', 'idempotent_dispatch_replay'
        );
      end if;
    end if;
    if not v_rearm_ledger then return v_ledger.response_payload; end if;
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
    or (
      v_claim.owner_generation <> p_expected_owner_generation
      and not (
        p_expected_owner_generation = 0 and v_claim.owner_generation > 0
      )
    )
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

  if v_rearm_ledger then
    update dashboard_private.notification_request_ledger ledger
    set response_payload = v_response
    where ledger.request_id = p_request_id
      and ledger.request_kind = 'legacy_dispatch_begin'
      and ledger.request_fingerprint = v_fingerprint;
  else
    insert into dashboard_private.notification_request_ledger(
      request_id, request_kind, request_fingerprint, response_payload
    ) values (p_request_id, 'legacy_dispatch_begin', v_fingerprint, v_response);
  end if;
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

-- Ownership handback is valid only after the global scope owner/flag already
-- names the receiving side. It never transfers a started/provider-known
-- attempt, and it repairs the delivery state without violating retry checks.
create or replace function public.transfer_notification_dispatch_ownership_v1(
  p_claim_id uuid,
  p_expected_owner_generation bigint,
  p_to_owner_kind text,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_flag_enabled boolean;
  v_scope_key text;
  v_dispatch_flag_key text;
  v_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_claim_id is null
    or p_expected_owner_generation is null or p_expected_owner_generation < 0
    or p_to_owner_kind not in ('legacy', 'canonical')
    or p_request_id is null
    or p_reason_code !~ '^[a-z0-9_]{3,96}$'
  then
    raise exception 'notification_ownership_transfer_invalid' using errcode = '22023';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'claim_id', p_claim_id,
    'expected_owner_generation', p_expected_owner_generation::text,
    'to_owner_kind', p_to_owner_kind,
    'reason_code', p_reason_code
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    if v_ledger.request_kind <> 'dispatch_ownership_transfer'
      or v_ledger.request_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_ledger.response_payload;
  end if;

  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found then
    raise exception 'notification_ownership_claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.state <> 'reserved'
    or v_claim.owner_generation <> p_expected_owner_generation
    or v_claim.owner_kind = p_to_owner_kind
    or v_claim.dispatch_started_at is not null
    or v_claim.dispatch_token is not null
    or v_claim.provider_reference is not null
    or v_claim.terminal_outcome is not null
  then
    raise exception 'notification_ownership_transfer_conflict' using errcode = '40001';
  end if;

  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = v_claim.rule_id
    and rule_row.workflow_key = v_claim.workflow_key;
  v_scope_key := dashboard_private.notification_dispatch_scope_for_event_v1(
    v_rule.workflow_key, v_rule.event_key
  );
  select owner_row.dispatch_flag_key into v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key;
  select flag_row.enabled into v_flag_enabled
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = v_dispatch_flag_key
  for share of flag_row;
  select owner_row.* into v_owner
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = v_scope_key
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;
  if v_dispatch_flag_key is null
    or v_flag_enabled is null
    or v_owner.scope_key is null
    or (p_to_owner_kind = 'canonical'
      and (v_owner.owner_kind <> 'canonical' or not v_flag_enabled))
    or (p_to_owner_kind = 'legacy'
      and (v_owner.owner_kind <> 'legacy' or v_flag_enabled))
  then
    raise exception 'notification_ownership_transfer_target_inactive'
      using errcode = '55000';
  end if;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set owner_kind = p_to_owner_kind,
      owner_generation = ownership.owner_generation + 1,
      updated_at = pg_catalog.clock_timestamp()
  where ownership.id = v_claim.id
  returning pg_catalog.jsonb_build_object(
    'claim_id', ownership.id,
    'owner_kind', ownership.owner_kind,
    'owner_generation', ownership.owner_generation::text,
    'state', ownership.state,
    'reason_code', p_reason_code
  ) into v_response;

  if p_to_owner_kind = 'canonical' then
    update dashboard_private.notification_deliveries delivery
    set status = 'pending',
        status_reason = null,
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        cancel_requested_at = null,
        cancel_reason = null,
        resolved_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_claim.workflow_key
      and event_row.occurrence_key = v_claim.occurrence_key
      and delivery.rule_id = v_claim.rule_id
      and delivery.channel_key = v_claim.channel_key
      and delivery.target_key = v_claim.target_key
      and delivery.target_generation = v_claim.target_generation
      and (
        (delivery.status = 'skipped' and delivery.status_reason in (
          'legacy_deduped'
        ))
        or (delivery.status = 'canceled'
          and delivery.status_reason = 'cutover_rollback')
      );
  else
    update dashboard_private.notification_deliveries delivery
    set status = 'skipped',
        status_reason = 'legacy_deduped',
        next_attempt_at = null,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        cancel_requested_at = null,
        cancel_reason = null,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_claim.workflow_key
      and event_row.occurrence_key = v_claim.occurrence_key
      and delivery.rule_id = v_claim.rule_id
      and delivery.channel_key = v_claim.channel_key
      and delivery.target_key = v_claim.target_key
      and delivery.target_generation = v_claim.target_generation
      and (
        delivery.status in ('pending', 'retry_wait', 'claimed')
        or (delivery.status = 'canceled'
          and delivery.status_reason = 'cutover_rollback')
      );
  end if;

  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'dispatch_ownership_transfer', v_fingerprint, v_response);
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
    before_summary, after_summary, reason_code
  ) values (
    'notification_dispatch_ownership', v_claim.id::text,
    'ownership_transferred_pre_dispatch', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'owner_kind', v_claim.owner_kind,
      'owner_generation', v_claim.owner_generation::text,
      'state', v_claim.state
    ),
    pg_catalog.jsonb_build_object(
      'owner_kind', p_to_owner_kind,
      'owner_generation', (v_claim.owner_generation + 1)::text,
      'state', 'reserved',
      'scope_key', v_scope_key
    ),
    p_reason_code
  );
  return v_response;
end;
$$;

create or replace function public.reap_notification_leases_v1(
  p_worker_id text,
  p_batch_size integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fanout integer := 0;
  v_rule integer := 0;
  v_target integer := 0;
  v_claimed integer := 0;
  v_sending integer := 0;
  v_candidate record;
  v_affected integer := 0;
begin
  if nullif(pg_catalog.btrim(p_worker_id), '') is null
    or p_batch_size is null
    or p_batch_size not between 1 and 100
  then
    raise exception 'notification_lease_reap_invalid' using errcode = '22023';
  end if;

  with expired as (
    select job.id
    from dashboard_private.notification_event_fanout_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_event_fanout_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_fanout from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_rule_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_rule_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_rule from reaped;

  with expired as (
    select job.id
    from dashboard_private.notification_target_reconciliation_jobs job
    where job.status = 'claimed'
      and job.lease_expires_at < pg_catalog.clock_timestamp()
    order by job.lease_expires_at, job.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_target_reconciliation_jobs job
    set status = 'pending', next_attempt_at = pg_catalog.clock_timestamp(),
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired', updated_at = pg_catalog.clock_timestamp()
    from expired where job.id = expired.id returning job.id
  ) select count(*) into v_target from reaped;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'claimed'
      and delivery.channel_key <> 'customer_message'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'pending', status_reason = null,
        next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lease_expired',
        last_error_summary = 'worker lease expired before dispatch start',
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select count(*) into v_claimed from reaped;

  -- SOLAPI claims are owned by the registration executor. A claim that
  -- expired before dispatch can be returned to pending, but it must remain
  -- outside the generic worker so the business-message ledger stays aligned.
  for v_candidate in
    select delivery.id as delivery_id, message.id as message_id
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    join public.ops_registration_messages message
      on message.id::text = event_row.source_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key = event_row.workflow_key
     and ownership.occurrence_key = event_row.occurrence_key
     and ownership.rule_id = delivery.rule_id
     and ownership.channel_key = delivery.channel_key
     and ownership.target_key = delivery.target_key
     and ownership.target_generation = delivery.target_generation
    where delivery.status = 'claimed'
      and delivery.channel_key = 'customer_message'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
      and event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.admission_message_requested'
      and event_row.source_type = 'ops_registration_message'
      and message.template_key = 'admission_application'
      and message.status = 'pending'
      and message.claim_active
      and ownership.owner_kind = 'canonical'
      and ownership.state = 'reserved'
    order by delivery.lease_expires_at, delivery.id
    limit p_batch_size
  loop
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'registration-admission-message:' || v_candidate.message_id::text, 0
    )) then
      update dashboard_private.notification_deliveries delivery
      set status = 'pending', status_reason = null, next_attempt_at = null,
          claimed_by = null, claim_token = null, lease_expires_at = null,
          last_error_code = 'worker_lease_expired',
          last_error_summary = 'specialized provider lease expired before dispatch start',
          updated_at = pg_catalog.clock_timestamp()
      where delivery.id = v_candidate.delivery_id
        and delivery.status = 'claimed'
        and delivery.channel_key = 'customer_message'
        and delivery.lease_expires_at < pg_catalog.clock_timestamp();
      get diagnostics v_affected = row_count;
      v_claimed := v_claimed + v_affected;
    end if;
  end loop;

  -- Once SOLAPI dispatch started, provider success is ambiguous. Close the
  -- registration business row, delivery and ownership together through the
  -- specialized atomic completion boundary; never resend the provider call.
  for v_candidate in
    select
      delivery.id as delivery_id,
      message.id as message_id,
      ownership.id as claim_id,
      ownership.owner_generation,
      delivery.claim_token,
      ownership.dispatch_token
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    join public.ops_registration_messages message
      on message.id::text = event_row.source_id
    join dashboard_private.notification_dispatch_ownership_claims ownership
      on ownership.workflow_key = event_row.workflow_key
     and ownership.occurrence_key = event_row.occurrence_key
     and ownership.rule_id = delivery.rule_id
     and ownership.channel_key = delivery.channel_key
     and ownership.target_key = delivery.target_key
     and ownership.target_generation = delivery.target_generation
    where delivery.status = 'sending'
      and delivery.channel_key = 'customer_message'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
      and event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.admission_message_requested'
      and event_row.source_type = 'ops_registration_message'
      and message.template_key = 'admission_application'
      and message.status = 'pending'
      and message.claim_active
      and ownership.owner_kind = 'canonical'
      and ownership.state = 'dispatch_started'
      and delivery.claim_token is not null
      and ownership.dispatch_token is not null
    order by delivery.lease_expires_at, delivery.id
    limit p_batch_size
  loop
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'registration-admission-message:' || v_candidate.message_id::text, 0
    )) and exists (
      select 1
      from dashboard_private.notification_deliveries delivery
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.id = v_candidate.claim_id
      where delivery.id = v_candidate.delivery_id
        and delivery.status = 'sending'
        and delivery.channel_key = 'customer_message'
        and delivery.claim_token = v_candidate.claim_token
        and delivery.lease_expires_at < pg_catalog.clock_timestamp()
        and ownership.state = 'dispatch_started'
        and ownership.dispatch_token = v_candidate.dispatch_token
    ) then
      perform public.complete_registration_admission_delivery_v1(
        v_candidate.message_id,
        v_candidate.delivery_id,
        v_candidate.claim_id,
        v_candidate.owner_generation,
        v_candidate.claim_token,
        v_candidate.dispatch_token,
        'unknown',
        pg_catalog.jsonb_build_object(
          'errorMessage', 'SOLAPI worker lease expired after dispatch start'
        ),
        'delivery_unknown',
        'solapi_worker_lost_after_send_start'
      );
      v_sending := v_sending + 1;
    end if;
  end loop;

  with expired as (
    select delivery.id
    from dashboard_private.notification_deliveries delivery
    where delivery.status = 'sending'
      and delivery.channel_key <> 'customer_message'
      and delivery.lease_expires_at < pg_catalog.clock_timestamp()
    order by delivery.lease_expires_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), reaped as (
    update dashboard_private.notification_deliveries delivery
    set status = 'delivery_unknown',
        status_reason = 'worker_lost_after_send_start',
        next_attempt_at = null,
        claimed_by = null, claim_token = null, lease_expires_at = null,
        last_error_code = 'worker_lost_after_send_start',
        last_error_summary = 'worker lease expired after dispatch start',
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from expired where delivery.id = expired.id returning delivery.id
  ) select v_sending + count(*) into v_sending from reaped;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed', updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_deliveries delivery,
       dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and delivery.status = 'delivery_unknown'
    and delivery.status_reason = 'worker_lost_after_send_start'
    and ownership.workflow_key = event_row.workflow_key
    and ownership.occurrence_key = event_row.occurrence_key
    and ownership.rule_id = delivery.rule_id
    and ownership.channel_key = delivery.channel_key
    and ownership.target_key = delivery.target_key
    and ownership.target_generation = delivery.target_generation
    and ownership.owner_kind = 'canonical'
    and ownership.state = 'dispatch_started';

  return pg_catalog.jsonb_build_object(
    'reaped_count', v_fanout + v_rule + v_target + v_claimed + v_sending,
    'fanout', v_fanout,
    'rule_reconciliation', v_rule,
    'target_reconciliation', v_target,
    'claimed_deliveries', v_claimed,
    'unknown_deliveries', v_sending,
    'worker_id', p_worker_id
  );
end;
$$;

create or replace function dashboard_private.notification_normalized_rendered_hash_v1(
  p_title text,
  p_body text,
  p_href text
) returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
  v_href text;
  v_serialized text;
begin
  v_title := pg_catalog.btrim(normalize(
    pg_catalog.replace(pg_catalog.replace(coalesce(p_title, ''), E'\r\n', E'\n'), E'\r', E'\n'),
    NFC
  ), E' \t\n\f\v');
  v_body := pg_catalog.btrim(normalize(
    pg_catalog.replace(pg_catalog.replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'),
    NFC
  ), E' \t\n\f\v');
  v_href := pg_catalog.btrim(normalize(
    pg_catalog.replace(pg_catalog.replace(coalesce(p_href, ''), E'\r\n', E'\n'), E'\r', E'\n'),
    NFC
  ), E' \t\n\f\v');
  v_serialized := '{"title":' || pg_catalog.to_jsonb(v_title)::text
    || ',"body":' || pg_catalog.to_jsonb(v_body)::text
    || ',"href":' || pg_catalog.to_jsonb(v_href)::text || '}';
  -- Cross-runtime proof fixture:
  -- 7c04d55426e204778748e9f7d310481fc10356103673d40edf50b0da5c1fa08e
  return dashboard_private.notification_sha256_hex_v1(v_serialized);
end;
$$;

create or replace function dashboard_private.notification_shadow_comparison_key_v1(
  p_workflow_key text,
  p_event_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_audience_key text,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(pg_catalog.concat_ws(
    E'\x1f', p_workflow_key, p_event_key, p_occurrence_key, p_rule_id::text,
    p_audience_key, p_channel_key, p_target_key, p_target_generation::text
  ));
$$;

create or replace function dashboard_private.notification_shadow_pair_key_v1(
  p_workflow_key text,
  p_event_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_audience_key text
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(pg_catalog.concat_ws(
    E'\x1f', p_workflow_key, p_event_key, p_occurrence_key,
    p_rule_id::text, p_audience_key
  ));
$$;

create or replace function dashboard_private.notification_compare_shadow_intent_v1(
  p_comparison_key text
) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_canonical record;
  v_legacy record;
  v_reason text;
  v_result_id text;
  v_count integer := 0;
begin
  if p_comparison_key is null or p_comparison_key !~ '^[a-f0-9]{64}$' then
    raise exception 'notification_shadow_comparison_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-shadow-comparison:' || p_comparison_key, 0
  ));
  for v_canonical in
    select audit.entity_id, audit.after_summary
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_shadow_intent'
      and audit.action = 'canonical_intent_recorded'
      and audit.after_summary ->> 'comparison_key' = p_comparison_key
    order by audit.created_at, audit.id
  loop
    for v_legacy in
      select audit.entity_id, audit.after_summary
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'notification_shadow_intent'
        and audit.action = 'legacy_intent_recorded'
        and audit.after_summary ->> 'comparison_key' = p_comparison_key
      order by audit.created_at, audit.id
    loop
      v_reason := case
        when v_canonical.after_summary ->> 'template_checksum'
          is distinct from v_legacy.after_summary ->> 'template_checksum'
          then 'template_mismatch'
        when v_canonical.after_summary ->> 'normalized_rendered_hash'
          is distinct from v_legacy.after_summary ->> 'normalized_rendered_hash'
          then 'render_mismatch'
        else 'matched'
      end;
      v_result_id := dashboard_private.notification_sha256_hex_v1(
        pg_catalog.concat_ws(
          E'\x1f', 'shadow-result', p_comparison_key,
          v_canonical.entity_id, v_legacy.entity_id, v_reason
        )
      );
      if not exists (
        select 1 from dashboard_private.notification_audit_logs audit
        where audit.entity_kind = 'notification_shadow_comparison'
          and audit.entity_id = v_result_id
          and audit.action = 'shadow_compare_result'
      ) then
        insert into dashboard_private.notification_audit_logs(
          entity_kind, entity_id, action, actor_profile_id, actor_kind,
          after_summary, reason_code
        ) values (
          'notification_shadow_comparison', v_result_id,
          'shadow_compare_result', null, 'system',
          pg_catalog.jsonb_build_object(
            'workflow_key', v_canonical.after_summary ->> 'workflow_key',
            'event_key', v_canonical.after_summary ->> 'event_key',
            'comparison_key', p_comparison_key,
            'pair_key', v_canonical.after_summary ->> 'pair_key',
            'canonical_intent_fingerprint', v_canonical.entity_id,
            'legacy_intent_fingerprint', v_legacy.entity_id
          ),
          v_reason
        );
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function public.record_legacy_notification_intent_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_legacy_template_checksum text,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_template dashboard_private.notification_templates%rowtype;
  v_fingerprint text;
  v_comparison_key text;
  v_pair_key text;
  v_replay jsonb;
  v_response jsonb;
  v_shadow_context boolean;
  v_shadow_flag dashboard_private.notification_runtime_flags%rowtype;
begin
  if (select auth.role()) <> 'service_role'
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_rule_id is null
    or p_channel_key not in ('in_app', 'web_push', 'google_chat', 'customer_message')
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_generation is null or p_target_generation < 0
    or p_legacy_template_checksum is null
    or p_legacy_template_checksum !~ '^[a-f0-9]{64}$'
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_intent_invalid' using errcode = '22023';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = p_workflow_key
    and event_row.occurrence_key = p_occurrence_key
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(event_row.rule_snapshot) snapshot(item)
      where snapshot.item ->> 'rule_id' = p_rule_id::text
    );
  select snapshot.item into strict v_rule_snapshot
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  where snapshot.item ->> 'rule_id' = p_rule_id::text;
  if (
      v_rule_snapshot ->> 'channel_key' is distinct from p_channel_key
      and not (
        v_rule_snapshot ->> 'channel_key' = 'in_app'
        and p_channel_key = 'web_push'
        and p_target_key like 'push_subscription:%'
      )
    )
    or coalesce((v_rule_snapshot ->> 'enabled')::boolean, false) is not true
    or nullif(v_rule_snapshot ->> 'template_id', '') is null
  then
    raise exception 'notification_legacy_intent_rule_mismatch' using errcode = '22023';
  end if;
  select template_row.* into strict v_template
  from dashboard_private.notification_templates template_row
  where template_row.id = (v_rule_snapshot ->> 'template_id')::uuid
    and template_row.rule_id = p_rule_id;

  v_comparison_key := dashboard_private.notification_shadow_comparison_key_v1(
    p_workflow_key, v_event.event_key, p_occurrence_key, p_rule_id,
    v_rule_snapshot ->> 'audience_key', p_channel_key, p_target_key,
    p_target_generation
  );
  v_pair_key := dashboard_private.notification_shadow_pair_key_v1(
    p_workflow_key, v_event.event_key, p_occurrence_key, p_rule_id,
    v_rule_snapshot ->> 'audience_key'
  );
  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.concat_ws(
      E'\x1f', 'legacy', v_comparison_key,
      p_legacy_template_checksum, p_normalized_rendered_hash
    )
  );
  select flag_row.* into strict v_shadow_flag
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = 'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  v_shadow_context := v_shadow_flag.enabled
    or coalesce(
      pg_catalog.current_setting(
        'app.notification_shadow_boundary_authorized', true
      ),
      'false'
    ) = 'true';
  -- Outside shadow this RPC is deliberately a no-op. Do not put that no-op in
  -- the request ledger: the same deterministic intent may later be observed
  -- during an authorized shadow epoch and must then be recordable.
  if not v_shadow_context then
    return pg_catalog.jsonb_build_object(
      'recorded', false,
      'shadow', false,
      'reason', 'shadow_inactive',
      'intentFingerprint', v_fingerprint,
      'templateChecksum', p_legacy_template_checksum,
      'canonicalTemplateChecksum', v_template.checksum
    );
  end if;
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'legacy_normalized_intent', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then return v_replay -> 'response'; end if;

  v_response := pg_catalog.jsonb_build_object(
    'recorded', true,
    'shadow', true,
    'intentFingerprint', v_fingerprint,
    'templateChecksum', p_legacy_template_checksum,
    'canonicalTemplateChecksum', v_template.checksum
  );
  if not exists (
      select 1 from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'notification_shadow_intent'
        and audit.entity_id = v_fingerprint
        and audit.action = 'legacy_intent_recorded'
    )
  then
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind, request_id,
      after_summary, reason_code
    ) values (
      'notification_shadow_intent', v_fingerprint, 'legacy_intent_recorded',
      null, 'system', p_request_id,
      pg_catalog.jsonb_build_object(
        'workflow_key', p_workflow_key,
        'event_key', v_event.event_key,
        'event_id', v_event.id,
        'occurrence_key_hash', dashboard_private.notification_sha256_hex_v1(
          p_occurrence_key
        ),
        'rule_id', p_rule_id,
        'audience_key', v_rule_snapshot ->> 'audience_key',
        'channel_key', p_channel_key,
        'target_key_hash', dashboard_private.notification_sha256_hex_v1(
          p_target_key
        ),
        'target_generation', p_target_generation::text,
        'template_checksum', p_legacy_template_checksum,
        'canonical_template_checksum', v_template.checksum,
        'normalized_rendered_hash', p_normalized_rendered_hash,
        'comparison_key', v_comparison_key,
        'pair_key', v_pair_key,
        'intent_fingerprint', v_fingerprint
      ),
      'shadow_parity'
    );
  end if;
  perform dashboard_private.notification_compare_shadow_intent_v1(v_comparison_key);
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'legacy_normalized_intent', v_fingerprint, v_response
  );
end;
$$;

-- Rolling-deploy compatibility: old bundles do not yet send the immutable
-- legacy plan checksum. Preserve their eight-argument contract by resolving
-- the canonical snapshot checksum and forwarding it to the independent
-- checksum overload. New bundles must call the overload above directly.
create or replace function public.record_legacy_notification_intent_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_template_checksum text;
begin
  if (select auth.role()) <> 'service_role'
    or p_workflow_key not in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )
    or nullif(pg_catalog.btrim(p_occurrence_key), '') is null
    or p_rule_id is null
    or p_channel_key not in ('in_app', 'web_push', 'google_chat', 'customer_message')
    or nullif(pg_catalog.btrim(p_target_key), '') is null
    or p_target_generation is null or p_target_generation < 0
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_intent_invalid' using errcode = '22023';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = p_workflow_key
    and event_row.occurrence_key = p_occurrence_key
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(event_row.rule_snapshot) snapshot(item)
      where snapshot.item ->> 'rule_id' = p_rule_id::text
    );
  select snapshot.item into strict v_rule_snapshot
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  where snapshot.item ->> 'rule_id' = p_rule_id::text;
  select template_row.checksum into strict v_template_checksum
  from dashboard_private.notification_templates template_row
  where template_row.id = (v_rule_snapshot ->> 'template_id')::uuid
    and template_row.rule_id = p_rule_id;
  return public.record_legacy_notification_intent_v1(
    p_workflow_key,
    p_occurrence_key,
    p_rule_id,
    p_channel_key,
    p_target_key,
    p_target_generation,
    v_template_checksum,
    p_normalized_rendered_hash,
    p_request_id
  );
end;
$$;

-- Specialized legacy provider paths already have an immutable delivery. Let
-- callers submit only its ID and the hash of the payload they are about to
-- send; derive every comparison identity from server-owned rows.
create or replace function public.record_legacy_notification_delivery_intent_v1(
  p_delivery_id uuid,
  p_legacy_template_checksum text,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_shadow_context boolean;
begin
  if (select auth.role()) <> 'service_role'
    or p_delivery_id is null
    or p_legacy_template_checksum is null
    or p_legacy_template_checksum !~ '^[a-f0-9]{64}$'
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_delivery_intent_invalid'
      using errcode = '22023';
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for share of delivery;
  if not found then
    return pg_catalog.jsonb_build_object(
      'recorded', false, 'reason', 'delivery_not_found'
    );
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
  for share of event_row;
  select ownership.* into v_ownership
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = v_event.workflow_key
    and ownership.occurrence_key = v_event.occurrence_key
    and ownership.rule_id = v_delivery.rule_id
    and ownership.channel_key = v_delivery.channel_key
    and ownership.target_key = v_delivery.target_key
    and ownership.target_generation = v_delivery.target_generation
  for share of ownership;

  if not found
    or v_ownership.owner_kind <> 'legacy'
    or v_ownership.state <> 'dispatch_started'
  then
    return pg_catalog.jsonb_build_object(
      'recorded', false, 'reason', 'not_legacy_dispatch_started'
    );
  end if;
  v_shadow_context := dashboard_private.notification_shadow_enabled_v1()
    or coalesce(v_delivery.status_reason = 'shadow_mode', false);
  if not v_shadow_context then
    return pg_catalog.jsonb_build_object(
      'recorded', false, 'reason', 'shadow_inactive'
    );
  end if;

  if not dashboard_private.notification_shadow_enabled_v1() then
    perform pg_catalog.set_config(
      'app.notification_shadow_boundary_authorized', 'true', true
    );
  end if;
  return public.record_legacy_notification_intent_v1(
    v_event.workflow_key,
    v_event.occurrence_key,
    v_delivery.rule_id,
    v_delivery.channel_key,
    v_delivery.target_key,
    v_delivery.target_generation,
    p_legacy_template_checksum,
    p_normalized_rendered_hash,
    p_request_id
  );
end;
$$;

-- Rolling-deploy compatibility for the former three-argument delivery RPC.
create or replace function public.record_legacy_notification_delivery_intent_v1(
  p_delivery_id uuid,
  p_normalized_rendered_hash text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_template_checksum text;
begin
  if (select auth.role()) <> 'service_role'
    or p_delivery_id is null
    or p_normalized_rendered_hash !~ '^[a-f0-9]{64}$'
    or p_request_id is null
  then
    raise exception 'notification_legacy_delivery_intent_invalid'
      using errcode = '22023';
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for share of delivery;
  if not found then
    return pg_catalog.jsonb_build_object(
      'recorded', false, 'reason', 'delivery_not_found'
    );
  end if;
  select template.checksum into strict v_template_checksum
  from dashboard_private.notification_templates template
  where template.id = v_delivery.template_id
    and template.rule_id = v_delivery.rule_id;
  return public.record_legacy_notification_delivery_intent_v1(
    p_delivery_id,
    v_template_checksum,
    p_normalized_rendered_hash,
    p_request_id
  );
end;
$$;

-- A legacy inbox write is a legacy side effect, not a canonical projection.
-- Keep the canonical shadow evidence row immutable and create the live legacy
-- inbox row without source_delivery_id. A deterministic notification ID is the
-- replay receipt, while the shared ownership claim remains the send ledger.
create or replace function public.commit_legacy_notification_in_app_projection_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_notification_id uuid;
  v_rendered_hash text;
  v_intent jsonb;
  v_shadow_context boolean;
begin
  if (select auth.role()) <> 'service_role'
    or p_delivery_id is null or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
  then
    raise exception 'notification_legacy_projection_invalid' using errcode = '22023';
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for share of delivery;
  if not found or v_delivery.channel_key <> 'in_app'
    or v_delivery.target_profile_id is null
  then
    raise exception 'notification_legacy_projection_delivery_invalid'
      using errcode = '22023';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
  for share of event_row;
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.workflow_key <> v_event.workflow_key
    or v_claim.occurrence_key <> v_event.occurrence_key
    or v_claim.rule_id <> v_delivery.rule_id
    or v_claim.channel_key <> v_delivery.channel_key
    or v_claim.target_key <> v_delivery.target_key
    or v_claim.target_generation <> v_delivery.target_generation
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
    or v_claim.state not in ('dispatch_started', 'closed')
  then
    raise exception 'notification_legacy_ownership_mismatch' using errcode = '40001';
  end if;

  v_notification_id := dashboard_private.notification_deterministic_uuid_v1(
    'legacy-in-app-projection-v2',
    v_claim.id::text || ':' || p_owner_generation::text
  );
  if v_claim.state = 'closed' then
    if v_claim.terminal_outcome = 'sent' and v_delivery.status = 'sent' then
      select notification.id into v_notification_id
      from public.dashboard_notifications notification
      where notification.source_delivery_id = v_delivery.id;
      if found then
        return pg_catalog.jsonb_build_object(
          'delivery_id', v_delivery.id,
          'notification_id', v_notification_id,
          'status', 'sent',
          'canonical_delivery_status', v_delivery.status,
          'canonical_delivery_reason', v_delivery.status_reason,
          'historical_projection', true,
          'replayed', true
        );
      end if;
    end if;
    if v_claim.terminal_outcome <> 'sent'
      or not exists (
        select 1 from public.dashboard_notifications notification
        where notification.id = v_notification_id
          and notification.source_delivery_id is null
      )
    then
      raise exception 'notification_legacy_projection_state_invalid'
        using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'delivery_id', v_delivery.id,
      'notification_id', v_notification_id,
      'status', 'sent',
      'canonical_delivery_status', v_delivery.status,
      'canonical_delivery_reason', v_delivery.status_reason,
      'replayed', true
    );
  end if;
  if v_delivery.status <> 'skipped'
    or v_delivery.status_reason not in ('shadow_mode', 'legacy_skipped')
  then
    raise exception 'notification_legacy_projection_state_invalid'
      using errcode = '55000';
  end if;

  v_rendered_hash := dashboard_private.notification_normalized_rendered_hash_v1(
    v_delivery.rendered_title, v_delivery.rendered_body, v_delivery.href
  );
  v_intent := public.record_legacy_notification_delivery_intent_v1(
    v_delivery.id,
    v_rendered_hash,
    dashboard_private.notification_deterministic_uuid_v1(
      'legacy-in-app-shadow-intent-v1',
      v_delivery.id::text || ':' || p_owner_generation::text || ':' || v_rendered_hash
    )
  );
  v_shadow_context := v_delivery.status_reason = 'shadow_mode'
    or dashboard_private.notification_shadow_enabled_v1();
  if v_shadow_context and coalesce((v_intent ->> 'recorded')::boolean, false) is not true then
    raise exception 'notification_legacy_projection_intent_missing'
      using errcode = '55000';
  end if;

  insert into public.dashboard_notifications(
    id, recipient_profile_id, actor_profile_id, type, title, body, href,
    metadata, read_at, source_delivery_id
  ) values (
    v_notification_id,
    v_delivery.target_profile_id,
    v_event.actor_profile_id,
    'notification_control_plane',
    v_delivery.rendered_title,
    v_delivery.rendered_body,
    v_delivery.href,
    pg_catalog.jsonb_build_object(
      'workflow_key', v_event.workflow_key,
      'event_key', v_event.event_key,
      'source_type', v_event.source_type,
      'source_id', v_event.source_id,
      'legacy_claim_id', v_claim.id,
      'legacy_owner_generation', p_owner_generation::text,
      'canonical_shadow_delivery_id', v_delivery.id,
      'legacy_projection', true
    ),
    null,
    null
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.dashboard_notifications notification
    where notification.id = v_notification_id
      and notification.source_delivery_id is null
      and notification.recipient_profile_id = v_delivery.target_profile_id
      and notification.metadata ->> 'legacy_claim_id' = v_claim.id::text
  ) then
    raise exception 'notification_legacy_projection_replay_mismatch'
      using errcode = '22023';
  end if;

  perform public.finalize_legacy_notification_dispatch_v1(
    v_claim.id,
    p_owner_generation,
    p_dispatch_token,
    'sent',
    v_notification_id::text
  );
  return pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'notification_id', v_notification_id,
    'status', 'sent',
    'canonical_delivery_status', v_delivery.status,
    'canonical_delivery_reason', v_delivery.status_reason,
    'replayed', false
  );
end;
$$;

create or replace function dashboard_private.reconcile_notification_shadow_intents_v1()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intent record;
  v_opposite_action text;
  v_reason text;
  v_result_id text;
  v_count integer := 0;
begin
  if not dashboard_private.notification_shadow_enabled_v1() then return 0; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-shadow-reconcile-v1', 0
  ));
  for v_intent in
    select audit.action, audit.entity_id, audit.after_summary
    from dashboard_private.notification_audit_logs audit
    join dashboard_private.notification_runtime_flags shadow_flag
      on shadow_flag.flag_key = 'notification_control_plane_shadow_write_enabled'
     and shadow_flag.enabled
    where audit.entity_kind = 'notification_shadow_intent'
      and audit.action in ('canonical_intent_recorded', 'legacy_intent_recorded')
      and audit.created_at >= shadow_flag.updated_at
      and audit.created_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
      and not exists (
        select 1
        from dashboard_private.notification_event_fanout_jobs job
        where job.event_id = (audit.after_summary ->> 'event_id')::uuid
          and job.status in ('pending', 'claimed')
      )
      and not exists (
        select 1
        from dashboard_private.notification_audit_logs result
        where result.entity_kind = 'notification_shadow_comparison'
          and result.action = 'shadow_compare_result'
          and (
            result.after_summary ->> 'canonical_intent_fingerprint' = audit.entity_id
            or result.after_summary ->> 'legacy_intent_fingerprint' = audit.entity_id
            or result.after_summary ->> 'source_intent_fingerprint' = audit.entity_id
          )
      )
    order by audit.created_at, audit.id
    limit 1000
  loop
    v_opposite_action := case v_intent.action
      when 'canonical_intent_recorded' then 'legacy_intent_recorded'
      else 'canonical_intent_recorded'
    end;
    v_reason := case
      when not exists (
        select 1 from dashboard_private.notification_audit_logs counterpart
        where counterpart.entity_kind = 'notification_shadow_intent'
          and counterpart.action = v_opposite_action
          and counterpart.after_summary ->> 'pair_key'
            = v_intent.after_summary ->> 'pair_key'
      ) then case v_intent.action
        when 'canonical_intent_recorded' then 'missing_legacy_intent'
        else 'extra_legacy_intent'
      end
      when not exists (
        select 1 from dashboard_private.notification_audit_logs counterpart
        where counterpart.entity_kind = 'notification_shadow_intent'
          and counterpart.action = v_opposite_action
          and counterpart.after_summary ->> 'pair_key'
            = v_intent.after_summary ->> 'pair_key'
          and counterpart.after_summary ->> 'channel_key'
            = v_intent.after_summary ->> 'channel_key'
      ) then 'channel_mismatch'
      when not exists (
        select 1 from dashboard_private.notification_audit_logs counterpart
        where counterpart.entity_kind = 'notification_shadow_intent'
          and counterpart.action = v_opposite_action
          and counterpart.after_summary ->> 'pair_key'
            = v_intent.after_summary ->> 'pair_key'
          and counterpart.after_summary ->> 'channel_key'
            = v_intent.after_summary ->> 'channel_key'
          and counterpart.after_summary ->> 'target_key_hash'
            = v_intent.after_summary ->> 'target_key_hash'
      ) then 'target_mismatch'
      when not exists (
        select 1 from dashboard_private.notification_audit_logs counterpart
        where counterpart.entity_kind = 'notification_shadow_intent'
          and counterpart.action = v_opposite_action
          and counterpart.after_summary ->> 'pair_key'
            = v_intent.after_summary ->> 'pair_key'
          and counterpart.after_summary ->> 'channel_key'
            = v_intent.after_summary ->> 'channel_key'
          and counterpart.after_summary ->> 'target_key_hash'
            = v_intent.after_summary ->> 'target_key_hash'
          and counterpart.after_summary ->> 'target_generation'
            = v_intent.after_summary ->> 'target_generation'
      ) then 'target_generation_mismatch'
      else 'render_mismatch'
    end;
    v_result_id := dashboard_private.notification_sha256_hex_v1(
      'shadow-unmatched' || E'\x1f' || v_intent.entity_id || E'\x1f' || v_reason
    );
    if not exists (
      select 1 from dashboard_private.notification_audit_logs result
      where result.entity_kind = 'notification_shadow_comparison'
        and result.entity_id = v_result_id
        and result.action = 'shadow_compare_result'
    ) then
      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        after_summary, reason_code
      ) values (
        'notification_shadow_comparison', v_result_id,
        'shadow_compare_result', null, 'system',
        pg_catalog.jsonb_build_object(
          'workflow_key', v_intent.after_summary ->> 'workflow_key',
          'event_key', v_intent.after_summary ->> 'event_key',
          'comparison_key', v_intent.after_summary ->> 'comparison_key',
          'pair_key', v_intent.after_summary ->> 'pair_key',
          'source_intent_fingerprint', v_intent.entity_id
        ),
        v_reason
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.assert_notification_worker_run_allowed_v1(
  p_worker_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role'
    or p_worker_id is distinct from 'notification-worker-route-v1'
  then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.reconcile_notification_shadow_intents_v1();
  if exists (
    select 1
    from dashboard_private.notification_worker_stop_latch latch
    where latch.latch_key = 'global' and latch.stopped
  ) then
    insert into dashboard_private.notification_worker_health_probes(
      worker_id, succeeded_at
    ) values (
      p_worker_id, pg_catalog.clock_timestamp()
    )
    on conflict (worker_id) do update
    set succeeded_at = excluded.succeeded_at;
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'worker_stop_latch',
      'health_probe_recorded', true
    );
  end if;
  if dashboard_private.notification_active_cutover_scope_v1()
    and not dashboard_private.notification_recent_runtime_heartbeats_v1()
  then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'runtime_heartbeat_stale'
    );
  end if;
  return pg_catalog.jsonb_build_object('allowed', true);
end;
$$;

alter function dashboard_private.notification_normalized_rendered_hash_v1(text, text, text)
  owner to postgres;
alter function dashboard_private.notification_shadow_comparison_key_v1(
  text, text, text, uuid, text, text, text, bigint
) owner to postgres;
alter function dashboard_private.notification_shadow_pair_key_v1(
  text, text, text, uuid, text
) owner to postgres;
alter function dashboard_private.notification_compare_shadow_intent_v1(text)
  owner to postgres;
alter function dashboard_private.reconcile_notification_shadow_intents_v1()
  owner to postgres;
alter function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) owner to postgres;
alter function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, text, uuid
) owner to postgres;
alter function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, uuid
) owner to postgres;
alter function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) owner to postgres;
alter function public.assert_notification_worker_run_allowed_v1(text)
  owner to postgres;

revoke all on function dashboard_private.notification_normalized_rendered_hash_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_comparison_key_v1(
  text, text, text, uuid, text, text, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_pair_key_v1(
  text, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_compare_shadow_intent_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reconcile_notification_shadow_intents_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) from public, anon, authenticated;
revoke all on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.assert_notification_worker_run_allowed_v1(text)
  from public, anon, authenticated;
grant execute on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, uuid
) to service_role;
grant execute on function public.record_legacy_notification_intent_v1(
  text, text, uuid, text, text, bigint, text, text, uuid
) to service_role;
grant execute on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, uuid
) to service_role;
grant execute on function public.record_legacy_notification_delivery_intent_v1(
  uuid, text, text, uuid
) to service_role;
grant execute on function public.assert_notification_worker_run_allowed_v1(text)
  to service_role;

-- Mutable source/recipient state must remain locked from the authoritative
-- revalidation through the in-app projection or external dispatch start.
create or replace function public.prepare_notification_immediate_delivery_v1(
  p_workflow_key text,
  p_event_id uuid,
  p_delivery_id uuid,
  p_claim_token uuid,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_target_generation bigint,
  p_scheduled_for timestamptz,
  p_target jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_source_uuid uuid;
  v_parent_uuid uuid;
  v_track_ids uuid[] := array[]::uuid[];
  v_target_profile_id uuid;
  v_dispatch_flag_key text;
  v_revalidation jsonb;
  v_status text;
  v_reason text;
  v_expected_scheduled_for timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_access_denied' using errcode = '42501';
  end if;
  if p_workflow_key is null
    or p_event_id is null
    or p_delivery_id is null
    or p_claim_token is null
    or nullif(pg_catalog.btrim(p_event_key), '') is null
    or p_source_type not in (
      'ops_task_event', 'ops_task_comment', 'makeup_request_event',
      'approval_event', 'approval_comment', 'registration_appointment',
      'ops_registration_message'
    )
    or nullif(pg_catalog.btrim(p_source_id), '') is null
    or p_rule_id is null
    or p_rule_revision is null or p_rule_revision < 1
    or p_target_generation is null or p_target_generation < 0
    or p_scheduled_for is null
    or p_target is null or pg_catalog.jsonb_typeof(p_target) <> 'object'
  then
    raise exception 'notification_delivery_prepare_invalid' using errcode = '22023';
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;

  -- Dispatch activation takes flag -> source -> delivery -> ownership locks.
  select owner_row.dispatch_flag_key into strict v_dispatch_flag_key
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
    p_workflow_key, p_event_key
  );
  perform 1
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key = v_dispatch_flag_key
  for share of flag_row;
  if not found then
    raise exception 'notification_dispatch_flag_missing' using errcode = '55000';
  end if;
  perform 1
  from dashboard_private.notification_cutover_owners owner_row
  where owner_row.scope_key = dashboard_private.notification_dispatch_scope_for_event_v1(
    p_workflow_key, p_event_key
  )
    and owner_row.dispatch_flag_key = v_dispatch_flag_key
  for share of owner_row;
  if not found then
    raise exception 'notification_dispatch_owner_missing' using errcode = '55000';
  end if;

  begin
    v_source_uuid := p_source_id::uuid;
    v_target_profile_id := nullif(p_target ->> 'target_profile_id', '')::uuid;
  exception
    when invalid_text_representation then
      v_source_uuid := null;
      v_target_profile_id := null;
  end;

  -- Lock each mutable parent before its immutable history/source row. This is
  -- the same direction used by the domain mutations that cancel deliveries.
  if p_source_type = 'ops_task_event' and v_source_uuid is not null then
    select source.task_id into v_parent_uuid
    from public.ops_task_events source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    if p_workflow_key = 'registration'
      and p_event_key = 'registration.phone_consultation_ready'
    then
      begin
        perform 1 from public.ops_registration_consultations consultation
        where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
        for share of consultation;
      exception when invalid_text_representation then null;
      end;
    end if;
    perform 1 from public.ops_task_events source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type = 'ops_task_comment' and v_source_uuid is not null then
    select source.task_id into v_parent_uuid
    from public.ops_task_comments source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    perform 1 from public.ops_task_comments source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type = 'makeup_request_event' and v_source_uuid is not null then
    select source.request_id into v_parent_uuid
    from public.makeup_request_events source
    where source.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.makeup_requests request_row
      where request_row.id = v_parent_uuid for share of request_row;
    end if;
    perform 1 from public.makeup_request_events source
    where source.id = v_source_uuid for share of source;
  elsif p_source_type in ('approval_event', 'approval_comment')
    and v_source_uuid is not null
  then
    if p_source_type = 'approval_event' then
      select source.approval_id into v_parent_uuid
      from public.approval_events source where source.id = v_source_uuid;
    else
      select source.approval_id into v_parent_uuid
      from public.approval_comments source where source.id = v_source_uuid;
    end if;
    -- A deleted approval event is valid even when its parent is already gone.
    if v_parent_uuid is not null then
      perform 1 from public.approval_requests request_row
      where request_row.id = v_parent_uuid for share of request_row;
    end if;
    if p_source_type = 'approval_event' then
      perform 1 from public.approval_events source
      where source.id = v_source_uuid for share of source;
    else
      perform 1 from public.approval_comments source
      where source.id = v_source_uuid for share of source;
    end if;
  elsif p_source_type = 'registration_appointment' and v_source_uuid is not null then
    select appointment.task_id into v_parent_uuid
    from public.ops_registration_appointments appointment
    where appointment.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
      perform 1 from public.ops_registration_details detail
      where detail.task_id = v_parent_uuid for share of detail;
      v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
        v_source_uuid
      );
      perform 1 from public.ops_registration_subject_tracks track
      where track.id = any(v_track_ids)
      order by track.id for share of track;
      select appointment.* into v_appointment
      from public.ops_registration_appointments appointment
      where appointment.id = v_source_uuid
      for share of appointment;
      perform 1 from public.ops_registration_level_tests level_test
      where level_test.appointment_id = v_source_uuid
      order by level_test.id for share of level_test;
      perform 1 from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_source_uuid
      order by consultation.id for share of consultation;
    end if;
  elsif p_source_type = 'ops_registration_message' and v_source_uuid is not null then
    select message.task_id into v_parent_uuid
    from public.ops_registration_messages message where message.id = v_source_uuid;
    if v_parent_uuid is not null then
      perform 1 from public.ops_tasks task
      where task.id = v_parent_uuid for share of task;
    end if;
    perform 1 from public.ops_registration_messages message
    where message.id = v_source_uuid for share of message;
  end if;

  if v_target_profile_id is not null then
    perform 1 from auth.users user_row
    where user_row.id = v_target_profile_id for share of user_row;
    perform 1 from public.profiles profile
    where profile.id = v_target_profile_id for share of profile;
    perform 1 from public.teacher_catalogs teacher
    where teacher.profile_id = v_target_profile_id
    order by teacher.id for share of teacher;
  end if;

  select rule_row.* into v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
  for share of rule_row;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update of delivery;
  if not found
    or v_delivery.status <> 'claimed'
    or v_delivery.claim_token <> p_claim_token
    or v_delivery.event_id <> p_event_id
    or v_delivery.rule_id <> p_rule_id
    or v_delivery.rule_revision <> p_rule_revision
    or v_delivery.target_generation <> p_target_generation
    or v_delivery.scheduled_for <> p_scheduled_for
  then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;

  if p_workflow_key = 'registration'
    and p_event_key = 'registration.appointment_reminder_due'
    and p_source_type = 'registration_appointment'
  then
    if v_event.workflow_key <> p_workflow_key
      or v_event.event_key <> p_event_key
      or v_event.source_type <> p_source_type
      or v_event.source_id <> p_source_id
      or v_event.source_revision is distinct from p_source_revision
      or p_target ->> 'target_kind' is distinct from v_delivery.target_kind
      or p_target ->> 'target_key' is distinct from v_delivery.target_key
      or v_target_profile_id is distinct from v_delivery.target_profile_id
      or p_target ->> 'connection_key' is distinct from v_delivery.connection_key
      or p_target -> 'target_snapshot' is distinct from v_delivery.target_snapshot
      or v_rule.id is null
      or v_rule.workflow_key <> p_workflow_key
      or v_rule.event_key <> p_event_key
      or v_rule.delivery_mode <> 'scheduled'
    then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'failed', 'reason', 'payload_schema_unsupported'
      );
    elsif not v_rule.enabled or v_rule.revision <> p_rule_revision then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'rule_revision_changed'
      );
    elsif v_appointment.id is null or v_appointment.status <> 'scheduled' then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'source_status_changed'
      );
    elsif v_appointment.notification_revision <> p_source_revision then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'source_revision_changed'
      );
    elsif (
        not (
          v_appointment.kind = 'visit_consultation'
          and v_delivery.audience_key = 'management_team'
          and v_delivery.channel_key = 'google_chat'
        )
        and (
          v_appointment.recipient_revision <> p_target_generation
        )
      )
      or (
        v_delivery.target_profile_id is not null
        and (
          not dashboard_private.notification_profile_is_active_v1(
            v_delivery.target_profile_id
          )
          or (
            v_delivery.audience_key = 'management_team'
            and not exists (
              select 1 from public.profiles profile
              where profile.id = v_delivery.target_profile_id
                and profile.role in ('admin', 'staff')
            )
          )
          or (
            v_delivery.audience_key = 'track_director'
            and not exists (
              select 1
              from public.ops_registration_subject_tracks track
              where track.id = any(
                dashboard_private.registration_appointment_track_ids_v1(
                  v_appointment.id
                )
              )
                and track.director_profile_id = v_delivery.target_profile_id
            )
          )
        )
      )
    then
      v_revalidation := pg_catalog.jsonb_build_object(
        'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
      );
    else
      v_expected_scheduled_for :=
        dashboard_private.calculate_registration_reminder_schedule_v1(
          v_rule.schedule_key, v_rule.schedule_config, v_appointment.scheduled_at
        );
      if v_expected_scheduled_for <> p_scheduled_for then
        v_revalidation := pg_catalog.jsonb_build_object(
          'ok', false, 'status', 'canceled', 'reason', 'source_schedule_changed'
        );
      elsif not (pg_catalog.clock_timestamp() < v_appointment.scheduled_at) then
        v_revalidation := pg_catalog.jsonb_build_object(
          'ok', false, 'status', 'failed', 'reason', 'retry_window_closed'
        );
      else
        v_revalidation := pg_catalog.jsonb_build_object('ok', true);
      end if;
    end if;
  else
    v_revalidation := public.revalidate_immediate_notification_delivery_v1(
      p_workflow_key, p_event_id, p_delivery_id, p_event_key, p_source_type,
      p_source_id, p_source_revision, p_rule_id, p_rule_revision,
      p_target_generation, p_scheduled_for, p_target
    );
  end if;

  if coalesce((v_revalidation ->> 'ok')::boolean, false)
    and p_workflow_key = 'registration'
    and v_delivery.audience_key = 'track_director'
    and (
      v_delivery.target_profile_id is null
      or not dashboard_private.is_active_registration_director(
        v_delivery.target_profile_id
      )
    )
  then
    v_revalidation := pg_catalog.jsonb_build_object(
      'ok', false, 'status', 'canceled', 'reason', 'recipient_revoked'
    );
  end if;

  if coalesce((v_revalidation ->> 'ok')::boolean, false) is not true then
    v_status := v_revalidation ->> 'status';
    v_reason := v_revalidation ->> 'reason';
    if v_status not in ('failed', 'canceled', 'skipped')
      or nullif(pg_catalog.btrim(v_reason), '') is null
    then
      raise exception 'notification_revalidation_envelope_invalid' using errcode = '55000';
    end if;
    perform public.finalize_notification_delivery_v1(
      p_delivery_id, p_claim_token, v_status, v_reason,
      null, null, case when v_status = 'failed' then v_reason else null end,
      case when v_status = 'failed' then 'authoritative revalidation failed' else null end,
      null
    );
    return pg_catalog.jsonb_build_object(
      'prepared', false, 'delivery_id', p_delivery_id,
      'status', v_status, 'status_reason', v_reason
    );
  end if;

  if v_delivery.channel_key = 'in_app' then
    return public.commit_notification_in_app_delivery_v1(
      p_delivery_id, p_claim_token
    ) || pg_catalog.jsonb_build_object('prepared', true);
  end if;
  return public.begin_notification_delivery_send_v1(
    p_delivery_id, p_claim_token
  ) || pg_catalog.jsonb_build_object('prepared', true);
exception
  when invalid_text_representation then
    raise exception 'notification_delivery_prepare_invalid' using errcode = '22023';
end;
$$;

alter function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) owner to postgres;
revoke all on function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.prepare_notification_immediate_delivery_v1(
  text, uuid, uuid, uuid, text, text, text, bigint, uuid, bigint, bigint,
  timestamptz, jsonb
) to service_role;

-- Every external provider call must cross this boundary immediately before
-- I/O. A replay is intentionally denied, even with the same request ID, since
-- a lost caller response cannot prove that the provider was not contacted.
create or replace function public.register_notification_external_attempt_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_claim_token uuid,
  p_dispatch_token uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_derived_claim_id uuid;
  v_attempt_id uuid;
  v_entity_id text;
  v_reason text;
begin
  if (select auth.role()) <> 'service_role'
    or p_dispatch_token is null
    or p_request_id is null
    or p_request_id <> p_dispatch_token
    or (p_delivery_id is null and p_claim_id is null)
    or (p_delivery_id is null and p_claim_token is not null)
    or (p_delivery_id is null and p_owner_generation is null)
    or (p_delivery_id is not null and p_claim_token is null)
    or (p_owner_generation is not null and p_owner_generation < 0)
  then
    raise exception 'notification_external_attempt_invalid' using errcode = '22023';
  end if;

  if p_delivery_id is not null then
    select delivery.* into v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id = p_delivery_id
    for update of delivery;
    if not found
      or v_delivery.status <> 'sending'
      or v_delivery.claim_token <> p_claim_token
      or v_delivery.channel_key not in ('google_chat', 'web_push', 'customer_message')
    then
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'reason', 'delivery_dispatch_identity_mismatch'
      );
    end if;

    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_delivery.event_id;
    select ownership.id into v_derived_claim_id
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation;
  else
    v_derived_claim_id := p_claim_id;
  end if;

  if v_derived_claim_id is null then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'dispatch_ownership_missing'
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-external-attempt:' || v_derived_claim_id::text, 0
  ));

  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = v_derived_claim_id
  for update of ownership;
  if not found then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'dispatch_ownership_missing'
    );
  end if;

  -- A retry creates a fresh dispatch token without advancing owner_generation.
  -- Deduplicate one provider boundary crossing, not every attempt in the same
  -- ownership generation. Keep the raw token out of the audit identity.
  v_entity_id := v_claim.id::text || ':'
    || dashboard_private.notification_sha256_hex_v1(p_dispatch_token::text);
  if (p_claim_id is not null and p_claim_id <> v_claim.id)
    or (p_owner_generation is not null
      and p_owner_generation <> v_claim.owner_generation)
    or (p_owner_generation is null and (
      p_delivery_id is null or v_claim.owner_kind <> 'canonical'
    ))
    or v_claim.state <> 'dispatch_started'
    or v_claim.dispatch_token <> p_dispatch_token
    or (
      p_delivery_id is not null
      and (
        v_claim.workflow_key <> v_event.workflow_key
        or v_claim.occurrence_key <> v_event.occurrence_key
        or v_claim.rule_id <> v_delivery.rule_id
        or v_claim.channel_key <> v_delivery.channel_key
        or v_claim.target_key <> v_delivery.target_key
        or v_claim.target_generation <> v_delivery.target_generation
      )
    )
  then
    v_reason := 'dispatch_identity_mismatch';
  elsif exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.entity_id = v_entity_id
      and audit.action = 'external_attempt_registered'
  ) then
    v_reason := 'attempt_already_registered';
  end if;

  if v_reason is not null then
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      request_id, after_summary, reason_code
    ) values (
      'notification_external_attempt', v_entity_id,
      'duplicate_external_attempt', null, 'system', p_request_id,
      pg_catalog.jsonb_build_object(
        'workflow_key', v_claim.workflow_key,
        'channel_key', v_claim.channel_key,
        'owner_kind', v_claim.owner_kind,
        'owner_generation', v_claim.owner_generation::text,
        'dispatch_token_hash', dashboard_private.notification_sha256_hex_v1(
          p_dispatch_token::text
        )
      ),
      v_reason
    );
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', v_reason);
  end if;

  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    request_id, after_summary, reason_code
  ) values (
    'notification_external_attempt', v_entity_id,
    'external_attempt_registered', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'workflow_key', v_claim.workflow_key,
      'channel_key', v_claim.channel_key,
      'owner_kind', v_claim.owner_kind,
      'owner_generation', v_claim.owner_generation::text,
      'dispatch_token_hash', dashboard_private.notification_sha256_hex_v1(
        p_dispatch_token::text
      )
    ),
    'provider_boundary'
  ) returning id into v_attempt_id;

  return pg_catalog.jsonb_build_object(
    'allowed', true, 'attempt_id', v_attempt_id
  );
end;
$$;

alter function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) owner to postgres;
revoke all on function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.register_notification_external_attempt_v1(
  uuid, uuid, bigint, uuid, uuid, uuid
) to service_role;

-- Activation is fail-closed between the schedule migration and this final
-- forward-compat package. Keep the dependency lookup closed and dynamic so a
-- missing marker returns false instead of allowing a partially applied stack.
create or replace function dashboard_private.notification_runtime_dependency_ready_v1(
  p_dependency text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_function_name text;
  v_signature text;
  v_version integer;
begin
  v_function_name := case p_dependency
    when 'common' then 'common_notification_' || 'control_plane_runtime_version'
    when 'adapters' then 'notification_workflow_adapters_runtime_version'
    when 'registration' then 'registration_appointment_reminders_runtime_version'
    when 'registration_handoffs' then 'registration_notification_handoffs_runtime_version'
    when 'forward_compat' then 'notification_control_plane_forward_compat_runtime_version'
    else null
  end;
  if v_function_name is null then return false; end if;

  v_signature := pg_catalog.format('%I.%I()', 'public', v_function_name);
  if pg_catalog.to_regprocedure(v_signature) is null then return false; end if;
  begin
    execute 'select ' || v_signature into v_version;
  exception
    when others then return false;
  end;
  return v_version = 1;
end;
$$;

alter function dashboard_private.notification_runtime_dependency_ready_v1(text)
  owner to postgres;
revoke all on function dashboard_private.notification_runtime_dependency_ready_v1(text)
  from public, anon, authenticated, service_role;

-- This capability marker is the final object in the forward-compat package.
create or replace function public.notification_control_plane_forward_compat_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1; $$;

alter function public.notification_control_plane_forward_compat_runtime_version()
  owner to postgres;
revoke all on function public.notification_control_plane_forward_compat_runtime_version()
  from public, anon;
grant execute on function public.notification_control_plane_forward_compat_runtime_version()
  to authenticated, service_role;

commit;
