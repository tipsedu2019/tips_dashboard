-- shadow 전환 증거는 운영에서 자연 발생한 canonical/legacy 비교만 인정한다.
-- 활성 규칙이 없는 범위는 현재 설정 digest와 shadow revision에 묶인 별도
-- DB 증거를 남긴다. 규칙이 활성화되거나 설정이 바뀌면 즉시 무효가 된다.

begin;

set local lock_timeout = '5s';

create table dashboard_private.notification_shadow_no_active_rule_evidence (
  request_id uuid primary key,
  scope_key text not null,
  scope_config_digest text not null,
  shadow_revision bigint not null,
  enabled_rule_count integer not null,
  created_at timestamp with time zone not null
    default pg_catalog.clock_timestamp(),
  constraint notification_shadow_no_active_rule_evidence_scope_check
    check (scope_key in (
      'tasks', 'word_retests', 'approvals', 'transfer', 'withdrawal',
      'makeup_requests', 'registration', 'registration_phone',
      'registration_visit', 'registration_solapi'
    )),
  constraint notification_shadow_no_active_rule_evidence_digest_check
    check (scope_config_digest ~ '^[a-f0-9]{64}$'),
  constraint notification_shadow_no_active_rule_evidence_revision_check
    check (shadow_revision > 0),
  constraint notification_shadow_no_active_rule_evidence_count_check
    check (enabled_rule_count = 0)
);

alter table dashboard_private.notification_shadow_no_active_rule_evidence
  enable row level security;
revoke all on table dashboard_private.notification_shadow_no_active_rule_evidence
  from public, anon, authenticated, service_role;

-- self-parity fixture는 전환 증거가 아니다. 현재 활성 규칙/템플릿과 일치하고,
-- canonical은 shadow로 건너뛰었으며 실제 legacy 소유자가 sent로 종료한 비교만
-- 현재 운영 비교로 인정한다.
create or replace function dashboard_private.notification_shadow_comparison_current_v1(
  p_scope_key text,
  p_comparison_key text,
  p_shadow_since timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shadow_since is not null
    and p_scope_key = any(dashboard_private.notification_cutover_scope_order_v1())
    and p_comparison_key ~ '^[a-f0-9]{64}$'
    and exists (
      select 1
      from dashboard_private.notification_audit_logs comparison
      join dashboard_private.notification_audit_logs canonical
        on canonical.entity_kind = 'notification_shadow_intent'
       and canonical.action = 'canonical_intent_recorded'
       and canonical.entity_id =
         comparison.after_summary ->> 'canonical_intent_fingerprint'
      join dashboard_private.notification_audit_logs legacy
        on legacy.entity_kind = 'notification_shadow_intent'
       and legacy.action = 'legacy_intent_recorded'
       and legacy.entity_id =
         comparison.after_summary ->> 'legacy_intent_fingerprint'
      join dashboard_private.notification_events event_row
        on event_row.id::text = canonical.after_summary ->> 'event_id'
       and event_row.id::text = legacy.after_summary ->> 'event_id'
      join dashboard_private.notification_rules rule_row
        on rule_row.id::text = canonical.after_summary ->> 'rule_id'
       and rule_row.id::text = legacy.after_summary ->> 'rule_id'
       and rule_row.workflow_key = event_row.workflow_key
      join dashboard_private.notification_templates template_row
        on template_row.id = rule_row.active_template_id
       and template_row.rule_id = rule_row.id
      join lateral pg_catalog.jsonb_array_elements(event_row.rule_snapshot)
        snapshot(item)
        on snapshot.item ->> 'rule_id' = rule_row.id::text
      join dashboard_private.notification_audit_logs delivery_audit
        on delivery_audit.entity_kind = 'notification_delivery'
       and delivery_audit.action = 'shadow_delivery_evaluated'
       and delivery_audit.reason_code = 'shadow_mode'
       and delivery_audit.after_summary ->> 'comparison_key' = p_comparison_key
      join dashboard_private.notification_deliveries delivery
        on delivery.id::text = delivery_audit.entity_id
       and delivery.event_id = event_row.id
       and delivery.rule_id = rule_row.id
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.workflow_key = event_row.workflow_key
       and ownership.occurrence_key = event_row.occurrence_key
       and ownership.rule_id = delivery.rule_id
       and ownership.channel_key = delivery.channel_key
       and ownership.target_key = delivery.target_key
       and ownership.target_generation = delivery.target_generation
      cross join lateral (
        select pg_catalog.greatest(
          p_shadow_since,
          coalesce(pg_catalog.max(pg_catalog.greatest(
            scoped_rule.updated_at, scoped_template.created_at
          )), p_shadow_since)
        ) as evidence_since
        from dashboard_private.notification_rules scoped_rule
        join dashboard_private.notification_templates scoped_template
          on scoped_template.id = scoped_rule.active_template_id
         and scoped_template.rule_id = scoped_rule.id
        where dashboard_private.notification_dispatch_scope_for_event_v1(
          scoped_rule.workflow_key, scoped_rule.event_key
        ) = p_scope_key
      ) boundary
      where comparison.entity_kind = 'notification_shadow_comparison'
        and comparison.action = 'shadow_compare_result'
        and comparison.reason_code = 'matched'
        and comparison.after_summary ->> 'comparison_key' = p_comparison_key
        and comparison.after_summary ->> 'workflow_key' = event_row.workflow_key
        and comparison.after_summary ->> 'event_key' = event_row.event_key
        and dashboard_private.notification_dispatch_scope_for_event_v1(
          event_row.workflow_key, event_row.event_key
        ) = p_scope_key
        and event_row.source_type <> 'notification_shadow_fixture_v1'
        and canonical.after_summary ->> 'comparison_key' = p_comparison_key
        and legacy.after_summary ->> 'comparison_key' = p_comparison_key
        and canonical.after_summary ->> 'template_checksum' = template_row.checksum
        and legacy.after_summary ->> 'template_checksum' = template_row.checksum
        and canonical.after_summary ->> 'normalized_rendered_hash'
          = legacy.after_summary ->> 'normalized_rendered_hash'
        and snapshot.item ->> 'rule_revision' = rule_row.revision::text
        and snapshot.item ->> 'template_id' = rule_row.active_template_id::text
        and rule_row.enabled
        and delivery.rule_revision = rule_row.revision
        and delivery.template_id = rule_row.active_template_id
        and delivery.channel_key = canonical.after_summary ->> 'channel_key'
        and delivery.audience_key = canonical.after_summary ->> 'audience_key'
        and delivery.target_generation::text =
          canonical.after_summary ->> 'target_generation'
        and dashboard_private.notification_sha256_hex_v1(delivery.target_key)
          = canonical.after_summary ->> 'target_key_hash'
        and delivery.status = 'skipped'
        and delivery.status_reason = 'shadow_mode'
        and ownership.owner_kind = 'legacy'
        and ownership.state = 'closed'
        and ownership.terminal_outcome = 'sent'
        and exists (
          select 1
          from dashboard_private.notification_audit_logs ownership_audit
          where ownership_audit.entity_kind = 'notification_dispatch_ownership'
            and ownership_audit.entity_id = ownership.id::text
            and ownership_audit.action = 'legacy_dispatch_finalized'
            and ownership_audit.reason_code = 'sent'
            and ownership_audit.after_summary ->> 'state' = 'closed'
            and ownership_audit.after_summary ->> 'outcome' = 'sent'
        )
        and comparison.created_at >= boundary.evidence_since
        and canonical.created_at >= boundary.evidence_since
        and legacy.created_at >= boundary.evidence_since
        and delivery.created_at >= boundary.evidence_since
        and not exists (
          select 1
          from public.dashboard_notifications notification
          where notification.source_delivery_id = delivery.id
        )
        and not exists (
          select 1
          from dashboard_private.notification_audit_logs dispatch_audit
          where dispatch_audit.entity_kind = 'notification_delivery'
            and dispatch_audit.entity_id = delivery.id::text
            and dispatch_audit.action = 'dispatch_started'
        )
    );
$$;

create or replace function dashboard_private.notification_no_active_rule_evidence_current_v1(
  p_scope_key text,
  p_request_id uuid,
  p_shadow_since timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shadow_since is not null
    and p_request_id is not null
    and p_scope_key = any(dashboard_private.notification_cutover_scope_order_v1())
    and exists (
      select 1
      from dashboard_private.notification_shadow_no_active_rule_evidence evidence
      join dashboard_private.notification_runtime_flags shadow_flag
        on shadow_flag.flag_key =
          'notification_control_plane_shadow_write_enabled'
      cross join lateral (
        select pg_catalog.greatest(
          p_shadow_since,
          coalesce(pg_catalog.max(pg_catalog.greatest(
            rule_row.updated_at, template_row.created_at
          )), p_shadow_since)
        ) as evidence_since
        from dashboard_private.notification_rules rule_row
        join dashboard_private.notification_templates template_row
          on template_row.id = rule_row.active_template_id
         and template_row.rule_id = rule_row.id
        where dashboard_private.notification_dispatch_scope_for_event_v1(
          rule_row.workflow_key, rule_row.event_key
        ) = p_scope_key
      ) boundary
      where evidence.request_id = p_request_id
        and evidence.scope_key = p_scope_key
        and evidence.enabled_rule_count = 0
        and shadow_flag.enabled
        and evidence.shadow_revision = shadow_flag.revision
        and evidence.scope_config_digest =
          dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key)
        and not exists (
          select 1
          from dashboard_private.notification_rules rule_row
          where rule_row.enabled
            and dashboard_private.notification_dispatch_scope_for_event_v1(
              rule_row.workflow_key, rule_row.event_key
            ) = p_scope_key
        )
        and evidence.created_at >= boundary.evidence_since
        and exists (
          select 1
          from dashboard_private.notification_audit_logs evidence_audit
          where evidence_audit.entity_kind =
              'notification_shadow_no_active_rule'
            and evidence_audit.entity_id = evidence.request_id::text
            and evidence_audit.action = 'shadow_no_active_rule_verified'
            and evidence_audit.reason_code = 'no_active_rule_current_config'
            and evidence_audit.request_id = evidence.request_id
            and evidence_audit.after_summary ->> 'scope_key' = p_scope_key
            and evidence_audit.after_summary ->> 'scope_config_digest'
              = evidence.scope_config_digest
            and evidence_audit.after_summary ->> 'enabled_rule_count' = '0'
            and evidence_audit.after_summary ->> 'shadow_revision'
              = evidence.shadow_revision::text
        )
    );
$$;

create or replace function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  p_shadow_since timestamp with time zone
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope_key text;
  v_enabled_rule_count integer;
begin
  if p_shadow_since is null then return false; end if;

  foreach v_scope_key in array
    dashboard_private.notification_cutover_scope_order_v1()
  loop
    select pg_catalog.count(*)::integer into v_enabled_rule_count
    from dashboard_private.notification_rules rule_row
    where rule_row.enabled
      and dashboard_private.notification_dispatch_scope_for_event_v1(
        rule_row.workflow_key, rule_row.event_key
      ) = v_scope_key;

    if v_enabled_rule_count > 0 then
      if not exists (
        select 1
        from dashboard_private.notification_audit_logs comparison
        where comparison.entity_kind = 'notification_shadow_comparison'
          and comparison.action = 'shadow_compare_result'
          and comparison.reason_code = 'matched'
          and dashboard_private.notification_shadow_comparison_current_v1(
            v_scope_key,
            comparison.after_summary ->> 'comparison_key',
            p_shadow_since
          )
      ) then
        return false;
      end if;
    else
      if not exists (
        select 1
        from dashboard_private.notification_shadow_no_active_rule_evidence evidence
        where evidence.scope_key = v_scope_key
          and dashboard_private.notification_no_active_rule_evidence_current_v1(
            v_scope_key, evidence.request_id, p_shadow_since
          )
      ) then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

-- 서비스 역할은 증거 내용을 제출하지 않는다. DB가 잠근 현재 상태에서 활성
-- 규칙 수를 계산하고 자연 발생 비교 또는 무활성 증거 중 하나를 선택한다.
create or replace function public.record_notification_shadow_fixture_evidence_v1(
  p_scope_key text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_flag dashboard_private.notification_runtime_flags%rowtype;
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
  v_owner dashboard_private.notification_cutover_owners%rowtype;
  v_flag_count integer := 0;
  v_owner_count integer := 0;
  v_enabled_rule_count integer := 0;
  v_comparison_key text;
  v_scope_config_digest text;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_request_id is null
    or not p_scope_key = any(
      dashboard_private.notification_cutover_scope_order_v1()
    )
  then
    raise exception 'notification_shadow_fixture_request_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));

  for v_flag in
    select flag_row.*
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = any(
      dashboard_private.notification_runtime_flag_keys_v1()
    )
    order by flag_row.flag_key
    for share of flag_row
  loop
    v_flag_count := v_flag_count + 1;
    if v_flag.flag_key =
      'notification_control_plane_shadow_write_enabled'
    then
      v_shadow := v_flag;
    elsif v_flag.flag_key = any(
      dashboard_private.notification_dispatch_flag_keys_v1()
    ) and v_flag.enabled then
      raise exception 'notification_shadow_fixture_phase_invalid'
        using errcode = '55000';
    elsif v_flag.flag_key =
      'notification_control_plane_settings_ui_enabled'
      and v_flag.enabled
    then
      raise exception 'notification_shadow_fixture_phase_invalid'
        using errcode = '55000';
    end if;
  end loop;
  if v_flag_count <> 12 or v_shadow.flag_key is null or not v_shadow.enabled then
    raise exception 'notification_shadow_fixture_phase_invalid'
      using errcode = '55000';
  end if;

  for v_owner in
    select owner_row.*
    from dashboard_private.notification_cutover_owners owner_row
    order by owner_row.scope_key
    for share of owner_row
  loop
    v_owner_count := v_owner_count + 1;
    if v_owner.owner_kind <> 'legacy' then
      raise exception 'notification_shadow_fixture_phase_invalid'
        using errcode = '55000';
    end if;
  end loop;
  if v_owner_count <> 10 then
    raise exception 'notification_shadow_fixture_phase_invalid'
      using errcode = '55000';
  end if;

  perform 1
  from dashboard_private.notification_worker_stop_latch latch
  where latch.latch_key = 'global' and not latch.stopped
  for share of latch;
  if not found
    or not dashboard_private.notification_recent_runtime_heartbeats_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
  then
    raise exception 'notification_shadow_fixture_runtime_invalid'
      using errcode = '55000';
  end if;

  lock table dashboard_private.notification_rules in share mode;
  lock table dashboard_private.notification_templates in share mode;

  select pg_catalog.count(*)::integer into v_enabled_rule_count
  from dashboard_private.notification_rules rule_row
  where rule_row.enabled
    and dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key;

  v_scope_config_digest :=
    dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key);
  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.concat_ws(
      E'\x1f', 'notification-shadow-scope-evidence-v2', p_scope_key,
      v_shadow.revision::text, v_enabled_rule_count::text,
      v_scope_config_digest
    )
  );
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_shadow_scope_evidence', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then
    return v_replay -> 'response';
  end if;

  if v_enabled_rule_count > 0 then
    select comparison.after_summary ->> 'comparison_key'
    into v_comparison_key
    from dashboard_private.notification_audit_logs comparison
    join dashboard_private.notification_audit_logs canonical
      on canonical.entity_kind = 'notification_shadow_intent'
     and canonical.action = 'canonical_intent_recorded'
     and canonical.entity_id =
       comparison.after_summary ->> 'canonical_intent_fingerprint'
    join dashboard_private.notification_events event_row
      on event_row.id::text = canonical.after_summary ->> 'event_id'
    where comparison.entity_kind = 'notification_shadow_comparison'
      and comparison.action = 'shadow_compare_result'
      and comparison.reason_code = 'matched'
      and event_row.source_type <> 'notification_shadow_fixture_v1'
      and dashboard_private.notification_shadow_comparison_current_v1(
        p_scope_key,
        comparison.after_summary ->> 'comparison_key',
        v_shadow.updated_at
      )
    order by comparison.created_at desc, comparison.id desc
    limit 1;

    if v_comparison_key is null then
      raise exception 'notification_shadow_natural_comparison_required'
        using errcode = '55000';
    end if;

    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      request_id, after_summary, reason_code
    ) values (
      'notification_shadow_scope_evidence', p_request_id::text,
      'natural_comparison_verified', null, 'system', p_request_id,
      pg_catalog.jsonb_build_object(
        'scope_key', p_scope_key,
        'evidence_kind', 'natural_comparison',
        'enabled_rule_count', v_enabled_rule_count,
        'comparison_key', v_comparison_key,
        'scope_config_digest', v_scope_config_digest,
        'shadow_revision', v_shadow.revision
      ),
      'natural_traffic_required'
    );

    v_response := pg_catalog.jsonb_build_object(
      'recorded', true,
      'scopeKey', p_scope_key,
      'requestId', p_request_id,
      'evidenceKind', 'natural_comparison',
      'enabledRuleCount', v_enabled_rule_count,
      'comparisonKey', v_comparison_key,
      'scopeConfigDigest', v_scope_config_digest
    );
  elsif v_enabled_rule_count = 0 then
    insert into dashboard_private.notification_shadow_no_active_rule_evidence(
      request_id, scope_key, scope_config_digest, shadow_revision,
      enabled_rule_count, created_at
    ) values (
      p_request_id, p_scope_key, v_scope_config_digest, v_shadow.revision,
      0, pg_catalog.clock_timestamp()
    );

    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      request_id, after_summary, reason_code
    ) values (
      'notification_shadow_no_active_rule', p_request_id::text,
      'shadow_no_active_rule_verified', null, 'system', p_request_id,
      pg_catalog.jsonb_build_object(
        'scope_key', p_scope_key,
        'evidence_kind', 'no_active_rule',
        'enabled_rule_count', 0,
        'scope_config_digest', v_scope_config_digest,
        'shadow_revision', v_shadow.revision
      ),
      'no_active_rule_current_config'
    );

    if not dashboard_private.notification_no_active_rule_evidence_current_v1(
      p_scope_key, p_request_id, v_shadow.updated_at
    ) then
      raise exception 'notification_shadow_no_active_rule_evidence_unverified'
        using errcode = '55000';
    end if;

    v_response := pg_catalog.jsonb_build_object(
      'recorded', true,
      'scopeKey', p_scope_key,
      'requestId', p_request_id,
      'evidenceKind', 'no_active_rule',
      'enabledRuleCount', 0,
      'comparisonKey', null,
      'scopeConfigDigest', v_scope_config_digest
    );
  else
    raise exception 'notification_shadow_enabled_rule_count_invalid'
      using errcode = '55000';
  end if;

  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_shadow_scope_evidence',
    v_fingerprint, v_response
  );
end;
$$;

-- 이전 caller-supplied digest/count 계약은 최종 스키마에서 제거한다.
drop function if exists public.record_notification_shadow_fixture_evidence_v1(
  text, text, integer, integer, integer, integer, uuid
);

alter table dashboard_private.notification_shadow_no_active_rule_evidence
  owner to postgres;
alter function dashboard_private.notification_shadow_comparison_current_v1(
  text, text, timestamp with time zone
) owner to postgres;
alter function dashboard_private.notification_no_active_rule_evidence_current_v1(
  text, uuid, timestamp with time zone
) owner to postgres;
alter function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) owner to postgres;
alter function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) owner to postgres;

revoke all on function dashboard_private.notification_shadow_comparison_current_v1(
  text, text, timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_no_active_rule_evidence_current_v1(
  text, uuid, timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.record_notification_shadow_fixture_evidence_v1(
  text, uuid
) to service_role;

commit;
