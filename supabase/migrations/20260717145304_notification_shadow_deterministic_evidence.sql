-- 저빈도 결정적 계산은 코드·미리보기 진단 자료로만 보존한다. 운영 전환
-- 완전성은 모든 활성 규칙의 현재 자연 발생 비교만 인정하며, 서비스 역할도
-- 아래 결정적 준비·기록·재생 RPC를 실행할 수 없다. 활성 규칙이 0개인 범위만
-- 현재 설정과 그림자 변경 번호에 묶인 무활성 증거를 사용한다.

begin;

set local lock_timeout = '5s';

-- 기존 설정 RPC가 생성한 MD5 체크섬은 자연 비교 호환을 위해 읽을 수 있게
-- 유지하되, 이 migration 이후 새로 쓰는 템플릿은 입력값을 신뢰하지 않고
-- 서버의 SHA-256 계약으로 항상 다시 계산한다.
create or replace function dashboard_private.notification_template_checksum_sha256_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  new.checksum := dashboard_private.notification_seed_template_checksum_v1(
    new.title_template,
    new.body_template,
    new.allowed_variables,
    new.payload_schema_version
  );
  return new;
end;
$$;

drop trigger if exists notification_templates_checksum_sha256_v1
  on dashboard_private.notification_templates;
create trigger notification_templates_checksum_sha256_v1
before insert or update of
  title_template, body_template, allowed_variables, payload_schema_version,
  checksum
on dashboard_private.notification_templates
for each row
execute function dashboard_private.notification_template_checksum_sha256_v1();

-- 과거 설정 편집으로 저장된 32자리 MD5 체크섬도 그림자 자연 비교에서
-- 기록할 수 있게 한다. 렌더링 본문 hash는 계속 SHA-256만 허용한다.
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
    or p_legacy_template_checksum !~ '^([a-f0-9]{32}|[a-f0-9]{64})$'
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
  -- 그림자 밖의 no-op는 요청 원장에 넣지 않는다. 같은 결정적 intent가
  -- 이후 승인된 그림자 epoch에서 관찰되면 그때 정상 기록할 수 있어야 한다.
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
    or p_legacy_template_checksum !~ '^([a-f0-9]{32}|[a-f0-9]{64})$'
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

-- 등록 core legacy plan도 현재 템플릿의 한글 token을 실제로 치환해야 한다.
-- 기존 함수는 specialized handoff용 영문 token만 처리해 core canonical과
-- 영구 불일치를 만들었다. 기존 영문 계약을 유지하면서 seed의 한글 token을
-- 같은 payload key로 보강한다.
create or replace function dashboard_private.registration_render_fixed_template_v1(
  p_template text,
  p_payload jsonb
) returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  rendered text := p_template;
begin
  rendered := pg_catalog.replace(rendered, '{student_name}', pg_catalog.coalesce(p_payload ->> 'student_name', ''));
  rendered := pg_catalog.replace(rendered, '{subject}', pg_catalog.coalesce(p_payload ->> 'subject', ''));
  rendered := pg_catalog.replace(rendered, '{subjects}', pg_catalog.coalesce(p_payload ->> 'subjects', ''));
  rendered := pg_catalog.replace(rendered, '{scheduled_at}', pg_catalog.coalesce(p_payload ->> 'scheduled_at', ''));
  rendered := pg_catalog.replace(rendered, '{place}', pg_catalog.coalesce(p_payload ->> 'place', ''));
  rendered := pg_catalog.replace(rendered, '{grade}', pg_catalog.coalesce(p_payload ->> 'grade', ''));
  rendered := pg_catalog.replace(rendered, '{inquiry_at}', pg_catalog.coalesce(p_payload ->> 'inquiry_at', ''));
  rendered := pg_catalog.replace(rendered, '{status}', pg_catalog.coalesce(p_payload ->> 'status', ''));
  rendered := pg_catalog.replace(rendered, '{class_name}', pg_catalog.coalesce(p_payload ->> 'class_name', ''));
  rendered := pg_catalog.replace(rendered, '{registration_checked}', pg_catalog.coalesce(p_payload ->> 'registration_checked', ''));
  rendered := pg_catalog.replace(rendered, '{학생}', pg_catalog.coalesce(p_payload ->> 'student_name', ''));
  rendered := pg_catalog.replace(rendered, '{학년}', pg_catalog.coalesce(p_payload ->> 'grade', ''));
  rendered := pg_catalog.replace(rendered, '{문의일시}', pg_catalog.coalesce(p_payload ->> 'inquiry_at', ''));
  rendered := pg_catalog.replace(rendered, '{진행상태}', pg_catalog.coalesce(p_payload ->> 'status', ''));
  rendered := pg_catalog.replace(rendered, '{수업}', pg_catalog.coalesce(p_payload ->> 'class_name', ''));
  rendered := pg_catalog.replace(rendered, '{등록 확인}', pg_catalog.coalesce(p_payload ->> 'registration_checked', ''));
  rendered := pg_catalog.replace(rendered, '{담당선생님}', pg_catalog.coalesce(p_payload ->> 'teacher_name', ''));
  rendered := pg_catalog.replace(rendered, '{전 수업}', pg_catalog.coalesce(p_payload ->> 'before_class', ''));
  rendered := pg_catalog.replace(rendered, '{후 수업}', pg_catalog.coalesce(p_payload ->> 'after_class', ''));
  rendered := pg_catalog.replace(rendered, '{전 수업 종료일}', pg_catalog.coalesce(p_payload ->> 'before_end_date', ''));
  rendered := pg_catalog.replace(rendered, '{후 수업 시작일}', pg_catalog.coalesce(p_payload ->> 'after_start_date', ''));
  rendered := pg_catalog.replace(rendered, '{퇴원일}', pg_catalog.coalesce(p_payload ->> 'withdrawal_date', ''));
  rendered := pg_catalog.replace(rendered, '{퇴원회차}', pg_catalog.coalesce(p_payload ->> 'withdrawal_round', ''));
  return rendered;
end;
$$;

create table dashboard_private.notification_shadow_deterministic_evidence (
  request_id uuid primary key,
  batch_request_id uuid not null,
  scope_key text not null,
  rule_id uuid not null,
  rule_revision bigint not null,
  template_id uuid not null,
  template_checksum text not null,
  scope_config_digest text not null,
  active_rule_manifest_digest text not null,
  shadow_revision bigint not null,
  enabled_rule_count integer not null,
  build_revision_hash text not null,
  fixture_result_digest text not null,
  created_at timestamp with time zone not null
    default pg_catalog.clock_timestamp(),
  constraint notification_shadow_deterministic_evidence_scope_check
    check (scope_key in (
      'tasks', 'word_retests', 'approvals', 'transfer', 'withdrawal',
      'makeup_requests', 'registration', 'registration_phone',
      'registration_visit', 'registration_solapi'
    )),
  constraint notification_shadow_deterministic_evidence_rule_revision_check
    check (rule_revision > 0),
  constraint notification_shadow_deterministic_evidence_count_check
    check (enabled_rule_count > 0),
  constraint notification_shadow_deterministic_evidence_hashes_check
    check (
      template_checksum ~ '^([a-f0-9]{32}|[a-f0-9]{64})$'
      and scope_config_digest ~ '^[a-f0-9]{64}$'
      and active_rule_manifest_digest ~ '^[a-f0-9]{64}$'
      and build_revision_hash ~ '^[a-f0-9]{64}$'
      and fixture_result_digest ~ '^[a-f0-9]{64}$'
    ),
  constraint notification_shadow_deterministic_evidence_shadow_revision_check
    check (shadow_revision > 0)
);

alter table dashboard_private.notification_shadow_deterministic_evidence
  enable row level security;
revoke all on table dashboard_private.notification_shadow_deterministic_evidence
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.notification_shadow_active_rule_manifest_digest_v1(
  p_scope_key text
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(
    pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'rule_id', rule_row.id,
          'rule_revision', rule_row.revision,
          'workflow_key', rule_row.workflow_key,
          'event_key', rule_row.event_key,
          'audience_key', rule_row.audience_key,
          'channel_key', rule_row.channel_key,
          'template_id', rule_row.active_template_id,
          'template_checksum', template_row.checksum
        ) order by rule_row.event_key, rule_row.audience_key,
          rule_row.channel_key, rule_row.id
      ),
      '[]'::jsonb
    )::text
  )
  from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
   and template_row.rule_id = rule_row.id
  where rule_row.enabled
    and dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key;
$$;

-- prepare 당시의 설정·규칙·그림자·단일 build를 cycle 요청 ID 자체에 묶는다.
-- record가 같은 현재값으로 ID를 재도출하지 못하면 이전 build의 계산 결과를
-- 새 build 증거로 저장할 수 없다.
create or replace function dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(
  p_batch_request_id uuid,
  p_scope_key text,
  p_rule_id uuid,
  p_rule_revision bigint,
  p_template_checksum text,
  p_scope_config_digest text,
  p_active_rule_manifest_digest text,
  p_shadow_revision bigint,
  p_enabled_rule_count integer,
  p_build_revision_hash text
) returns uuid
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-cycle-request-v3',
    pg_catalog.concat_ws(
      E'\x1f',
      p_batch_request_id::text,
      p_scope_key,
      p_rule_id::text,
      p_rule_revision::text,
      p_template_checksum,
      p_scope_config_digest,
      p_active_rule_manifest_digest,
      p_shadow_revision::text,
      p_enabled_rule_count::text,
      p_build_revision_hash
    )
  );
$$;

create or replace function dashboard_private.notification_shadow_deterministic_render_v1(
  p_template text,
  p_allowed_variables jsonb,
  p_context jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_rendered text := p_template;
  v_variable jsonb;
  v_key text;
  v_token text;
  v_value text;
begin
  if pg_catalog.jsonb_typeof(p_allowed_variables) <> 'array'
    or pg_catalog.jsonb_typeof(p_context) <> 'object'
  then
    raise exception 'notification_shadow_deterministic_render_invalid'
      using errcode = '22023';
  end if;
  for v_variable in
    select item.value
    from pg_catalog.jsonb_array_elements(p_allowed_variables) item(value)
  loop
    v_key := v_variable ->> 'key';
    v_token := v_variable ->> 'token';
    if nullif(v_key, '') is null
      or nullif(v_token, '') is null
      or v_token ~ '[{}]'
    then
      raise exception 'notification_shadow_deterministic_render_invalid'
        using errcode = '22023';
    end if;
    -- 실제 renderer처럼 템플릿에서 쓰는 token만 context 값이 필수다.
    -- 허용 목록에만 있고 현재 문구에서 쓰지 않는 변수까지 요구하면 유효한
    -- 템플릿이 DB 재계산에서만 거절되는 런타임 불일치가 생긴다.
    if pg_catalog.strpos(v_rendered, '{' || v_token || '}') > 0 then
      v_value := p_context ->> v_key;
      if v_value is null then
        raise exception 'notification_shadow_deterministic_render_invalid'
          using errcode = '22023';
      end if;
      v_rendered := pg_catalog.replace(
        v_rendered, '{' || v_token || '}', v_value
      );
    end if;
  end loop;
  if v_rendered ~ '\{[^{}]+\}' then
    raise exception 'notification_shadow_deterministic_render_invalid'
      using errcode = '22023';
  end if;
  return v_rendered;
end;
$$;

create or replace function dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
  p_scope_key text,
  p_batch_request_id uuid,
  p_rule_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
  v_rule dashboard_private.notification_rules%rowtype;
  v_template dashboard_private.notification_templates%rowtype;
  v_enabled_rule_count integer;
  v_scope_config_digest text;
  v_active_rule_manifest_digest text;
  v_build_revision_hash text;
  v_request_id uuid;
  v_workflow_label text;
  v_event_label text;
  v_source_type text;
  v_source_id uuid;
  v_approval_id uuid;
  v_makeup_request_id uuid;
  v_task_id uuid;
  v_requester_profile_id uuid;
  v_primary_profile_id uuid;
  v_secondary_profile_id uuid;
  v_secondary_profile_id_2 uuid;
  v_requesting_teacher_profile_id uuid;
  v_assistant_profile_id uuid;
  v_approver_profile_id uuid;
  v_management_profile_id uuid;
  v_management_profile_id_2 uuid;
  v_executive_profile_id uuid;
  v_executive_profile_id_2 uuid;
  v_subject_profile_id uuid;
  v_subject_profile_id_2 uuid;
  v_director_profile_id uuid;
  v_director_profile_id_2 uuid;
  v_target_profile_ids uuid[];
  v_track_id uuid;
  v_appointment_id uuid;
  v_message_id uuid;
  v_source_revision text;
  v_target_generation text := '0';
  v_connection_key text;
  v_href text;
  v_payload jsonb;
  v_registration_render_payload jsonb;
  v_canonical_context jsonb;
  v_canonical_targets jsonb;
  v_legacy_title text;
  v_legacy_body text;
  v_legacy_allowed jsonb;
  v_legacy_schema_version integer;
  v_legacy_checksum text;
  v_legacy_context jsonb;
  v_legacy_targets jsonb;
  v_subject_connection_variants jsonb;
  v_current_allowed jsonb;
  v_legacy_allowed_wire jsonb;
  v_occurrence_key text;
begin
  if p_batch_request_id is null
    or p_rule_id is null
    or not p_scope_key = any(
      dashboard_private.notification_cutover_scope_order_v1()
    )
  then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));

  select flag_row.* into strict v_shadow
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key =
    'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  if not v_shadow.enabled
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_dispatch_flag_keys_v1()
      ) and flag_row.enabled
    )
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key =
        'notification_control_plane_settings_ui_enabled'
        and flag_row.enabled
    )
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_runtime_flag_keys_v1()
      )
    ) <> 12
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind = 'legacy'
    ) <> 10
  then
    raise exception 'notification_shadow_deterministic_phase_invalid'
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
    raise exception 'notification_shadow_deterministic_runtime_invalid'
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
  if v_enabled_rule_count < 1 then
    raise exception 'notification_shadow_deterministic_active_rule_required'
      using errcode = '55000';
  end if;
  select rule_row.* into v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
    and rule_row.enabled
    and rule_row.delivery_mode = 'immediate'
    and dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key
  ;
  if v_rule.id is null then
    raise exception 'notification_shadow_deterministic_fixture_unavailable'
      using errcode = '55000';
  end if;

  select template_row.* into strict v_template
  from dashboard_private.notification_templates template_row
  where template_row.id = v_rule.active_template_id
    and template_row.rule_id = v_rule.id;

  select registry.workflow_label, registry.event_label
  into v_workflow_label, v_event_label
  from dashboard_private.notification_settings_ui_registry registry
  where registry.rule_id = v_rule.id;
  v_workflow_label := pg_catalog.coalesce(v_workflow_label, '등록');
  v_event_label := pg_catalog.coalesce(
    v_event_label,
    case v_rule.event_key
      when 'registration.phone_consultation_ready' then '전화상담 대기'
      when 'registration.visit_scheduled' then '방문상담 예약 배정'
      when 'registration.visit_rescheduled' then '방문상담 예약 변경'
      when 'registration.visit_replaced' then '방문상담 예약 교체'
      when 'registration.visit_subject_deselected' then '방문상담 과목 제외'
      when 'registration.visit_canceled' then '방문상담 예약 취소'
      when 'registration.admission_message_requested' then '입학신청서 안내'
      else v_rule.event_key
    end
  );

  -- 대부분의 실제 legacy dispatch plan도 event snapshot이 가리키는 같은
  -- 불변 template row를 읽는다. 다만 SOLAPI 입학 안내 provider는 본문을
  -- 고정 문구로 만들고 template checksum만 snapshot 값을 기록한다.
  -- 이 차이를 그대로 보존해야 custom SOLAPI template drift를 숨기지 않는다.
  if p_scope_key = 'registration_solapi' then
    v_legacy_title := '입학신청서 안내';
    v_legacy_body := '{student_name} 학생 입학신청서 안내';
    v_legacy_allowed := '[
      {"key":"student_name","token":"student_name","pii_class":"student_name"}
    ]'::jsonb;
    v_legacy_schema_version := 2;
  else
    v_legacy_title := v_template.title_template;
    v_legacy_body := v_template.body_template;
    v_legacy_allowed := v_template.allowed_variables;
    v_legacy_schema_version := v_template.payload_schema_version;
  end if;
  v_legacy_checksum := v_template.checksum;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'key', variable.value ->> 'key',
    'token', variable.value ->> 'token',
    'piiClass', variable.value ->> 'pii_class'
  ) order by variable.ordinality), '[]'::jsonb)
  into v_current_allowed
  from pg_catalog.jsonb_array_elements(v_template.allowed_variables)
    with ordinality variable(value, ordinality);
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'key', variable.value ->> 'key',
    'token', variable.value ->> 'token',
    'piiClass', variable.value ->> 'pii_class'
  ) order by variable.ordinality), '[]'::jsonb)
  into v_legacy_allowed_wire
  from pg_catalog.jsonb_array_elements(v_legacy_allowed)
    with ordinality variable(value, ordinality);

  v_task_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|task'
  );
  v_requester_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|requester'
  );
  v_primary_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|primary'
  );
  v_secondary_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|secondary'
  );
  v_secondary_profile_id_2 := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|secondary-2'
  );
  v_requesting_teacher_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|requesting-teacher'
  );
  v_assistant_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|assistant'
  );
  v_approver_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|approver'
  );
  v_management_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|management'
  );
  v_management_profile_id_2 := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|management-2'
  );
  v_executive_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|executive'
  );
  v_executive_profile_id_2 := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|executive-2'
  );
  v_subject_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|subject'
  );
  v_subject_profile_id_2 := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|subject-2'
  );
  v_director_profile_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|director'
  );
  v_director_profile_id_2 := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|director-2'
  );
  v_track_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|track'
  );
  v_appointment_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|appointment'
  );
  v_message_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|message'
  );
  v_approval_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|approval-entity'
  );
  v_makeup_request_id := dashboard_private.notification_deterministic_uuid_v1(
    'notification-shadow-deterministic-v1', p_scope_key || '|makeup-entity'
  );
  v_source_id := case
    when p_scope_key = 'registration_visit' then v_appointment_id
    when p_scope_key = 'registration_solapi' then v_message_id
    else dashboard_private.notification_deterministic_uuid_v1(
      'notification-shadow-deterministic-v1', p_scope_key || '|source'
    )
  end;
  v_source_revision := case
    when p_scope_key = 'registration_visit' then '3'
    else null
  end;
  if p_scope_key in ('registration_phone', 'registration_visit') then
    v_target_generation := '4';
  end if;
  v_source_type := case
    when p_scope_key = 'tasks' and v_rule.event_key = 'task.comment_added'
      then 'ops_task_comment'
    when p_scope_key = 'approvals' and v_rule.event_key = 'approval.comment_added'
      then 'approval_comment'
    when p_scope_key = 'approvals' then 'approval_event'
    when p_scope_key = 'makeup_requests' then 'makeup_request_event'
    when p_scope_key = 'registration_visit' then 'registration_appointment'
    when p_scope_key = 'registration_solapi' then 'ops_registration_message'
    else 'ops_task_event'
  end;
  v_connection_key := case
    when v_rule.channel_key <> 'google_chat' then null
    when v_rule.audience_key = 'management_team' then 'google_chat.management'
    when v_rule.audience_key = 'executive_team' then 'google_chat.executive'
    when v_rule.audience_key = 'subject_team' then 'google_chat.english'
    else null
  end;
  v_target_profile_ids := case v_rule.audience_key
    when 'requester_profile' then array[v_requester_profile_id]
    when 'primary_assignee' then array[v_primary_profile_id]
    when 'secondary_assignee' then array[
      v_secondary_profile_id, v_secondary_profile_id_2
    ]
    when 'requesting_teacher' then array[v_requesting_teacher_profile_id]
    when 'assigned_assistant' then array[v_assistant_profile_id]
    when 'approver_profile' then array[v_approver_profile_id]
    when 'management_team' then array[
      v_management_profile_id, v_management_profile_id_2
    ]
    when 'executive_team' then array[
      v_executive_profile_id, v_executive_profile_id_2
    ]
    when 'subject_team' then array[
      v_subject_profile_id, v_subject_profile_id_2
    ]
    when 'track_director' then array[
      v_director_profile_id, v_director_profile_id_2
    ]
    else array[dashboard_private.notification_deterministic_uuid_v1(
      'notification-shadow-deterministic-v1',
      p_scope_key || '|unknown-audience|' || v_rule.audience_key
    )]
  end;

  v_payload := pg_catalog.jsonb_build_object(
    'task_id', v_task_id,
    'approval_id', v_approval_id,
    'makeup_request_id', v_makeup_request_id,
    'track_id', v_track_id,
    'appointment_id', v_appointment_id,
    'message_id', v_message_id,
    'message_request_key', 'notification-shadow-deterministic-message-v1',
    'notification_revision', '3',
    'recipient_revision', '4',
    'requester_profile_id', v_requester_profile_id,
    'primary_assignee_profile_id', v_primary_profile_id,
    'secondary_assignee_profile_id', v_secondary_profile_id,
    'secondary_assignee_profile_ids', pg_catalog.jsonb_build_array(
      v_secondary_profile_id_2, v_secondary_profile_id
    ),
    'requesting_teacher_profile_id', v_requesting_teacher_profile_id,
    'assigned_assistant_profile_id', v_assistant_profile_id,
    'approver_profile_id', v_approver_profile_id,
    'management_profile_ids', pg_catalog.jsonb_build_array(
      v_management_profile_id, v_management_profile_id_2
    ),
    'executive_profile_ids', pg_catalog.jsonb_build_array(
      v_executive_profile_id, v_executive_profile_id_2
    ),
    'subject_profile_ids', pg_catalog.jsonb_build_array(
      v_subject_profile_id, v_subject_profile_id_2
    ),
    'director_profile_id', v_director_profile_id,
    'director_profile_ids', pg_catalog.jsonb_build_array(
      v_director_profile_id_2, v_director_profile_id
    ),
    'approval_group', 'english',
    'workflow_label', v_workflow_label,
    'event_label', v_event_label,
    'occurred_at', '2026-07-17T03:00:00.000Z',
    'student_name', '검증학생',
    'grade', '중2',
    'inquiry_at', '2026-07-17 12:00 KST',
    'status', '검증 상태',
    'workflow_status', '검증 상태',
    'class_name', '검증 수업',
    'registration_checked', '확인',
    'teacher_name', '검증선생님',
    'requester_name', '검증선생님',
    'before_class', '기존 수업',
    'from_class_name', '기존 수업',
    'after_class', '변경 수업',
    'to_class_name', '변경 수업',
    'before_end_date', '2026-07-20',
    'after_start_date', '2026-07-21',
    'withdrawal_date', '2026-07-31',
    'withdrawal_round', '4회차',
    'process', '휴보강',
    'subject', '영어',
    'subjects', '영어',
    'reason', '결정적 검증',
    'cancel_date', '2026-07-18',
    'makeup_at', '2026-07-19 14:00',
    'makeup_room_spaced', '301호',
    'makeup_room', '301호',
    'submitted_at', '2026-07-17 12:00 KST',
    'revision_requested_at', '2026-07-17 13:00 KST',
    'revision_reason', '결정적 검증',
    'approved_at', '2026-07-17 14:00 KST',
    'approval_note', '결정적 검증',
    'rejected_at', '2026-07-17 15:00 KST',
    'rejected_reason', '결정적 검증',
    'canceled_at', '2026-07-17 16:00 KST',
    'canceled_note', '결정적 검증',
    'approver_name', '검증결재자',
    'fallback_title', '검증 제목',
    'fallback_body', '검증 본문',
    'scheduled_at', '2026-07-22T06:00:00.000Z',
    'place', '검증 상담실'
  );
  if v_rule.workflow_key = 'registration' then
    select pg_catalog.coalesce(pg_catalog.jsonb_object_agg(
      variable.value ->> 'key',
      v_payload -> (variable.value ->> 'key')
    ), '{}'::jsonb)
    into v_registration_render_payload
    from pg_catalog.jsonb_array_elements(v_template.allowed_variables) variable(value)
    where variable.value ->> 'key' = any(array[
      'student_name', 'grade', 'inquiry_at', 'status', 'class_name',
      'registration_checked', 'subject', 'subjects', 'scheduled_at', 'place'
    ]::text[])
      and v_payload ? (variable.value ->> 'key');
    -- registration immediate adapter는 payload에 존재하는 10개 render field를
    -- 모두 context로 내보낸다. 현재 template이 허용하지 않는 field는 실제
    -- renderer에서 extra-context 오류가 되므로 fixture payload에서도 제거한다.
    v_payload := (v_payload - array[
      'student_name', 'grade', 'inquiry_at', 'status', 'class_name',
      'registration_checked', 'subject', 'subjects', 'scheduled_at', 'place'
    ]::text[]) || v_registration_render_payload;
  end if;
  v_href := case p_scope_key
    when 'tasks' then '/admin/tasks?taskId=' || v_task_id::text
    when 'word_retests' then '/admin/word-retests?taskId=' || v_task_id::text
    when 'approvals' then '/admin/approvals?approvalId=' || v_approval_id::text
    when 'transfer' then '/admin/transfer?taskId=' || v_task_id::text
    when 'withdrawal' then '/admin/withdrawal?taskId=' || v_task_id::text
    when 'makeup_requests' then '/admin/makeup-requests?request='
      || v_makeup_request_id::text
    when 'registration_phone' then '/admin/registration?taskId=' || v_task_id::text
      || '&trackId=' || v_track_id::text
    when 'registration_visit' then '/admin/registration?taskId=' || v_task_id::text
      || '&appointmentId=' || v_appointment_id::text || '&view=calendar'
    else '/admin/registration?taskId=' || v_task_id::text
  end;

  v_canonical_context := case
    when p_scope_key in ('tasks', 'word_retests', 'approvals') then
      pg_catalog.jsonb_build_object(
        'workflow_label', v_workflow_label,
        'event_label', v_event_label,
        'occurred_at', '2026-07-17T03:00:00.000Z',
        'deep_link', v_href
      )
    when p_scope_key in ('registration', 'registration_phone',
      'registration_visit', 'registration_solapi') then
      pg_catalog.jsonb_build_object(
        'student_name', '검증학생', 'grade', '중2',
        'inquiry_at', '2026-07-17 12:00 KST', 'status', '검증 상태',
        'class_name', '검증 수업', 'registration_checked', '확인',
        'subject', '영어', 'subjects', '영어',
        'scheduled_at', '2026-07-22T06:00:00.000Z',
        'place', '검증 상담실'
      )
    else v_payload - array[
      'task_id', 'approval_id', 'makeup_request_id', 'track_id',
      'appointment_id', 'message_id', 'message_request_key',
      'notification_revision', 'recipient_revision',
      'requester_profile_id', 'primary_assignee_profile_id',
      'secondary_assignee_profile_id', 'secondary_assignee_profile_ids',
      'requesting_teacher_profile_id', 'assigned_assistant_profile_id',
      'approver_profile_id', 'management_profile_ids',
      'executive_profile_ids', 'subject_profile_ids',
      'director_profile_id', 'director_profile_ids', 'approval_group',
      'workflow_label', 'event_label', 'occurred_at'
    ]
  end;
  -- 실제 adapter는 등록되지 않은 context key를 거부하므로 현재 템플릿의
  -- 허용 변수에 해당하는 값만 서버 기대 context에도 남긴다.
  select pg_catalog.coalesce(pg_catalog.jsonb_object_agg(
    variable.value ->> 'key',
    v_canonical_context -> (variable.value ->> 'key')
  ), '{}'::jsonb)
  into v_canonical_context
  from pg_catalog.jsonb_array_elements(v_template.allowed_variables) variable(value)
  where v_canonical_context ? (variable.value ->> 'key');

  v_legacy_context := v_canonical_context;
  select pg_catalog.coalesce(pg_catalog.jsonb_object_agg(variable.value ->> 'key',
    (case
      when v_payload ? (variable.value ->> 'key')
        then v_payload -> (variable.value ->> 'key')
      else v_canonical_context -> (variable.value ->> 'key')
    end)), '{}'::jsonb)
  into v_legacy_context
  from pg_catalog.jsonb_array_elements(v_legacy_allowed) variable(value);

  v_occurrence_key := 'notification-shadow-deterministic:' || p_scope_key
    || ':' || v_rule.event_key || ':' || v_rule.id::text || ':v1';
  if v_rule.channel_key = 'google_chat'
    and v_rule.audience_key = 'subject_team'
  then
    -- subject_team은 같은 rule이라도 approval_group에 따라 실제 연결이 갈린다.
    -- 영어와 수학을 서로 다른 occurrence로 실행해 두 분기를 모두 검증한다.
    v_subject_connection_variants := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'approvalGroup', 'english',
        'connectionKey', 'google_chat.english',
        'occurrenceKey', v_occurrence_key || ':english'
      ),
      pg_catalog.jsonb_build_object(
        'approvalGroup', 'math_middle',
        'connectionKey', 'google_chat.math',
        'occurrenceKey', v_occurrence_key || ':math'
      )
    );
    v_canonical_targets := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:google_chat.english',
        'targetGeneration', v_target_generation,
        'occurrenceKey', v_occurrence_key || ':english'
      ),
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:google_chat.math',
        'targetGeneration', v_target_generation,
        'occurrenceKey', v_occurrence_key || ':math'
      )
    );
  elsif v_rule.channel_key = 'google_chat' then
    v_canonical_targets := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:' || v_connection_key,
        'targetGeneration', v_target_generation
      )
    );
  elsif v_rule.channel_key = 'customer_message' then
    v_canonical_targets := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'registration-message:' || v_message_id::text,
        'targetGeneration', v_target_generation
      )
    );
  else
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'targetKey', 'profile:' || target.target_id::text,
      'targetGeneration', v_target_generation
    ) order by target.target_id::text)
    into v_canonical_targets
    from pg_catalog.unnest(v_target_profile_ids) target(target_id);
  end if;
  -- legacy oracle target는 canonical 결과를 복사하지 않고 고정 업무 의미에서
  -- 별도로 계산한다.
  v_legacy_targets := case
    when v_rule.channel_key = 'google_chat'
      and v_rule.audience_key = 'subject_team'
    then pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:google_chat.english',
        'targetGeneration', v_target_generation,
        'occurrenceKey', v_occurrence_key || ':english'
      ),
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:google_chat.math',
        'targetGeneration', v_target_generation,
        'occurrenceKey', v_occurrence_key || ':math'
      )
    )
    when v_rule.channel_key = 'google_chat' then pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'connection:' || case v_rule.audience_key
          when 'management_team' then 'google_chat.management'
          when 'executive_team' then 'google_chat.executive'
          else 'google_chat.english'
        end,
        'targetGeneration', v_target_generation
      )
    )
    when v_rule.channel_key = 'customer_message' then pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'targetKey', 'registration-message:' || v_message_id::text,
        'targetGeneration', v_target_generation
      )
    )
    else (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'targetKey', 'profile:' || target.target_id::text,
        'targetGeneration', v_target_generation
      ) order by target.target_id::text)
      from pg_catalog.unnest(v_target_profile_ids) target(target_id)
    )
  end;

  v_scope_config_digest :=
    dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key);
  v_active_rule_manifest_digest :=
    dashboard_private.notification_shadow_active_rule_manifest_digest_v1(p_scope_key);
  v_build_revision_hash :=
    dashboard_private.notification_current_contract_build_revision_hash_v1(
      v_shadow.updated_at
    );
  if v_build_revision_hash is null then
    raise exception 'notification_shadow_deterministic_build_revision_invalid'
      using errcode = '55000';
  end if;
  v_request_id :=
    dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(
      p_batch_request_id,
      p_scope_key,
      v_rule.id,
      v_rule.revision,
      v_template.checksum,
      v_scope_config_digest,
      v_active_rule_manifest_digest,
      v_shadow.revision,
      v_enabled_rule_count,
      v_build_revision_hash
    );
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'evidenceKind', 'deterministic_no_delivery',
    'scopeKey', p_scope_key,
    'batchRequestId', p_batch_request_id,
    'requestId', v_request_id,
    'scopeConfigDigest', v_scope_config_digest,
    'activeRuleManifestDigest', v_active_rule_manifest_digest,
    'shadowRevision', v_shadow.revision::text,
    'enabledRuleCount', v_enabled_rule_count,
    'buildRevisionHash', v_build_revision_hash,
    'fixture', pg_catalog.jsonb_build_object(
      'occurrenceKey', v_occurrence_key,
      'canonical', pg_catalog.jsonb_build_object(
        'eventId', dashboard_private.notification_deterministic_uuid_v1(
          'notification-shadow-deterministic-v1', p_scope_key || '|event'
        ),
        'workflowKey', v_rule.workflow_key,
        'eventKey', v_rule.event_key,
        'sourceType', v_source_type,
        'sourceId', v_source_id,
        'sourceRevision', v_source_revision,
        'payloadSchemaVersion', v_template.payload_schema_version,
        'payload', v_payload,
        'rule', pg_catalog.jsonb_build_object(
          'ruleId', v_rule.id,
          'ruleRevision', v_rule.revision::text,
          'templateId', v_template.id,
          'audienceKey', v_rule.audience_key,
          'channelKey', v_rule.channel_key,
          'connectionKey', v_connection_key,
          'ruleVariantKey', v_rule.rule_variant_key
        ),
        'scheduledFor', '2026-07-17T03:00:00.000Z',
        'template', pg_catalog.jsonb_build_object(
          'titleTemplate', v_template.title_template,
          'bodyTemplate', v_template.body_template,
          'allowedVariables', v_current_allowed,
          'payloadSchemaVersion', v_template.payload_schema_version,
          'checksum', v_template.checksum
        )
      ),
      'legacy', pg_catalog.jsonb_build_object(
        'workflowKey', v_rule.workflow_key,
        'eventKey', v_rule.event_key,
        'audienceKey', v_rule.audience_key,
        'channelKey', v_rule.channel_key,
        'template', pg_catalog.jsonb_build_object(
          'titleTemplate', v_legacy_title,
          'bodyTemplate', v_legacy_body,
          'allowedVariables', v_legacy_allowed_wire,
          'payloadSchemaVersion', v_legacy_schema_version,
          'checksum', v_legacy_checksum
        ),
        'context', v_legacy_context,
        'href', v_href,
        'targets', v_legacy_targets
      ),
      'serverExpected', pg_catalog.jsonb_build_object(
        'canonicalContext', v_canonical_context,
        'canonicalHref', v_href,
        'canonicalTargets', v_canonical_targets
      )
    ) || case
      when v_subject_connection_variants is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object(
        'subjectConnectionVariants', v_subject_connection_variants
      )
    end
  );
end;
$$;

create or replace function dashboard_private.notification_shadow_deterministic_fixture_expected_v1(
  p_plan jsonb
) returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_fixture jsonb := p_plan -> 'fixture';
  v_canonical jsonb := v_fixture -> 'canonical';
  v_legacy jsonb := v_fixture -> 'legacy';
  v_server jsonb := v_fixture -> 'serverExpected';
  v_canonical_template jsonb := v_canonical -> 'template';
  v_legacy_template jsonb := v_legacy -> 'template';
  v_canonical_title text;
  v_canonical_body text;
  v_legacy_title text;
  v_legacy_body text;
  v_canonical_hash text;
  v_legacy_hash text;
  v_canonical_intents jsonb;
  v_legacy_intents jsonb;
begin
  v_canonical_title := dashboard_private.notification_shadow_deterministic_render_v1(
    v_canonical_template ->> 'titleTemplate',
    v_canonical_template -> 'allowedVariables',
    v_server -> 'canonicalContext'
  );
  v_canonical_body := dashboard_private.notification_shadow_deterministic_render_v1(
    v_canonical_template ->> 'bodyTemplate',
    v_canonical_template -> 'allowedVariables',
    v_server -> 'canonicalContext'
  );
  v_legacy_title := dashboard_private.notification_shadow_deterministic_render_v1(
    v_legacy_template ->> 'titleTemplate',
    v_legacy_template -> 'allowedVariables',
    v_legacy -> 'context'
  );
  v_legacy_body := dashboard_private.notification_shadow_deterministic_render_v1(
    v_legacy_template ->> 'bodyTemplate',
    v_legacy_template -> 'allowedVariables',
    v_legacy -> 'context'
  );
  v_canonical_hash := dashboard_private.notification_normalized_rendered_hash_v1(
    v_canonical_title, v_canonical_body, v_server ->> 'canonicalHref'
  );
  v_legacy_hash := dashboard_private.notification_normalized_rendered_hash_v1(
    v_legacy_title, v_legacy_body, v_legacy ->> 'href'
  );

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workflowKey', v_canonical ->> 'workflowKey',
    'eventKey', v_canonical ->> 'eventKey',
    'occurrenceKey', pg_catalog.coalesce(
      target.value ->> 'occurrenceKey', v_fixture ->> 'occurrenceKey'
    ),
    'audienceKey', v_canonical -> 'rule' ->> 'audienceKey',
    'channelKey', v_canonical -> 'rule' ->> 'channelKey',
    'targetKey', target.value ->> 'targetKey',
    'targetGeneration', target.value ->> 'targetGeneration',
    'templateChecksum', v_canonical_template ->> 'checksum',
    'normalizedRenderedContentHash', v_canonical_hash
  ) order by target.ordinality)
  into v_canonical_intents
  from pg_catalog.jsonb_array_elements(v_server -> 'canonicalTargets')
    with ordinality target(value, ordinality);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workflowKey', v_legacy ->> 'workflowKey',
    'eventKey', v_legacy ->> 'eventKey',
    'occurrenceKey', pg_catalog.coalesce(
      target.value ->> 'occurrenceKey', v_fixture ->> 'occurrenceKey'
    ),
    'audienceKey', v_legacy ->> 'audienceKey',
    'channelKey', v_legacy ->> 'channelKey',
    'targetKey', target.value ->> 'targetKey',
    'targetGeneration', target.value ->> 'targetGeneration',
    'templateChecksum', v_legacy_template ->> 'checksum',
    'normalizedRenderedContentHash', v_legacy_hash
  ) order by target.ordinality)
  into v_legacy_intents
  from pg_catalog.jsonb_array_elements(v_legacy -> 'targets')
    with ordinality target(value, ordinality);
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'canonicalIntents', v_canonical_intents,
    'legacyIntents', v_legacy_intents
  );
end;
$$;

create or replace function dashboard_private.notification_shadow_deterministic_intents_match_v1(
  p_output jsonb
) returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_output) = 'object'
      and pg_catalog.jsonb_typeof(p_output -> 'canonicalIntents') = 'array'
      and pg_catalog.jsonb_typeof(p_output -> 'legacyIntents') = 'array'
      and pg_catalog.jsonb_array_length(p_output -> 'canonicalIntents') > 0
      and pg_catalog.jsonb_array_length(p_output -> 'legacyIntents') > 0
    then (
      select pg_catalog.jsonb_agg(item.value order by item.value::text)
      from pg_catalog.jsonb_array_elements(
        p_output -> 'canonicalIntents'
      ) item(value)
    ) = (
      select pg_catalog.jsonb_agg(item.value order by item.value::text)
      from pg_catalog.jsonb_array_elements(
        p_output -> 'legacyIntents'
      ) item(value)
    )
    else false
  end;
$$;

create or replace function public.prepare_notification_shadow_deterministic_fixture_v1(
  p_scope_key text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plans jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_request_id is null
    or not p_scope_key = any(
      dashboard_private.notification_cutover_scope_order_v1()
    )
  then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '42501';
  end if;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(
    dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
      p_scope_key,
      p_request_id,
      rule_row.id
    ) order by rule_row.id::text
  ), '[]'::jsonb)
  into v_plans
  from dashboard_private.notification_rules rule_row
  where rule_row.enabled
    and rule_row.delivery_mode = 'immediate'
    and dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key;
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'scopeKey', p_scope_key,
    'batchRequestId', p_request_id,
    'plans', v_plans
  );
end;
$$;

create or replace function public.record_notification_shadow_deterministic_evidence_v1(
  p_scope_key text,
  p_batch_request_id uuid,
  p_request_id uuid,
  p_fixture_output jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_expected jsonb;
  v_result_digest text;
  v_fingerprint text;
  v_replay jsonb;
  v_response jsonb;
  v_rule_id uuid;
  v_rule_revision bigint;
  v_template_id uuid;
  v_template_checksum text;
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
  v_enabled_rule_count integer;
  v_scope_config_digest text;
  v_active_rule_manifest_digest text;
  v_build_revision_hash text;
begin
  if (select auth.role()) <> 'service_role'
    or p_batch_request_id is null
    or p_request_id is null
    or p_fixture_output is null
    or pg_catalog.jsonb_typeof(p_fixture_output) <> 'object'
  then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  select flag_row.* into strict v_shadow
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key =
    'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
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
  v_active_rule_manifest_digest :=
    dashboard_private.notification_shadow_active_rule_manifest_digest_v1(p_scope_key);
  v_build_revision_hash :=
    dashboard_private.notification_current_contract_build_revision_hash_v1(
      v_shadow.updated_at
    );
  if v_build_revision_hash is null then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '22023';
  end if;
  select rule_row.id into v_rule_id
  from dashboard_private.notification_rules rule_row
  join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
   and template_row.rule_id = rule_row.id
  where rule_row.enabled
    and rule_row.delivery_mode = 'immediate'
    and dashboard_private.notification_dispatch_scope_for_event_v1(
      rule_row.workflow_key, rule_row.event_key
    ) = p_scope_key
    and dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(
      p_batch_request_id,
      p_scope_key,
      rule_row.id,
      rule_row.revision,
      template_row.checksum,
      v_scope_config_digest,
      v_active_rule_manifest_digest,
      v_shadow.revision,
      v_enabled_rule_count,
      v_build_revision_hash
    ) = p_request_id;
  if v_rule_id is null then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '22023';
  end if;
  v_plan := dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
    p_scope_key, p_batch_request_id, v_rule_id
  );
  if v_plan ->> 'requestId' is distinct from p_request_id::text then
    raise exception 'notification_shadow_deterministic_request_invalid'
      using errcode = '22023';
  end if;
  v_expected := dashboard_private.notification_shadow_deterministic_fixture_expected_v1(
    v_plan
  );
  if p_fixture_output is distinct from v_expected
    or not dashboard_private.notification_shadow_deterministic_intents_match_v1(
      v_expected
    )
  then
    raise exception 'notification_shadow_deterministic_fixture_mismatch'
      using errcode = '55000';
  end if;
  v_result_digest := dashboard_private.notification_sha256_hex_v1(
    v_expected::text
  );
  v_rule_revision :=
    (v_plan -> 'fixture' -> 'canonical' -> 'rule' ->> 'ruleRevision')::bigint;
  v_template_id :=
    (v_plan -> 'fixture' -> 'canonical' -> 'rule' ->> 'templateId')::uuid;
  v_template_checksum :=
    v_plan -> 'fixture' -> 'canonical' -> 'template' ->> 'checksum';
  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    pg_catalog.concat_ws(
      E'\x1f', 'notification-shadow-deterministic-evidence-v2', p_scope_key,
      p_batch_request_id::text, p_request_id::text, v_rule_id::text,
      v_plan ->> 'scopeConfigDigest',
      v_plan ->> 'activeRuleManifestDigest',
      v_plan ->> 'shadowRevision',
      v_plan ->> 'enabledRuleCount',
      v_plan ->> 'buildRevisionHash',
      v_result_digest
    )
  );
  v_replay := dashboard_private.notification_cutover_request_replay_v1(
    p_request_id, 'notification_shadow_deterministic_evidence', v_fingerprint
  );
  if (v_replay ->> 'replayed')::boolean then
    return v_replay -> 'response';
  end if;

  insert into dashboard_private.notification_shadow_deterministic_evidence(
    request_id, batch_request_id, scope_key, rule_id, rule_revision, template_id,
    template_checksum, scope_config_digest, active_rule_manifest_digest,
    shadow_revision, enabled_rule_count, build_revision_hash,
    fixture_result_digest, created_at
  ) values (
    p_request_id, p_batch_request_id, p_scope_key, v_rule_id,
    v_rule_revision, v_template_id,
    v_template_checksum, v_plan ->> 'scopeConfigDigest',
    v_plan ->> 'activeRuleManifestDigest',
    (v_plan ->> 'shadowRevision')::bigint,
    (v_plan ->> 'enabledRuleCount')::integer,
    v_plan ->> 'buildRevisionHash', v_result_digest,
    pg_catalog.clock_timestamp()
  );
  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    request_id, after_summary, reason_code
  ) values (
    'notification_shadow_deterministic_evidence', p_request_id::text,
    'shadow_deterministic_no_delivery_verified', null, 'system', p_request_id,
    pg_catalog.jsonb_build_object(
      'scope_key', p_scope_key,
      'batch_request_id', p_batch_request_id,
      'evidence_kind', 'deterministic_no_delivery',
      'rule_id', v_rule_id,
      'rule_revision', v_rule_revision,
      'template_id', v_template_id,
      'template_checksum', v_template_checksum,
      'scope_config_digest', v_plan ->> 'scopeConfigDigest',
      'active_rule_manifest_digest', v_plan ->> 'activeRuleManifestDigest',
      'shadow_revision', v_plan ->> 'shadowRevision',
      'enabled_rule_count', v_plan ->> 'enabledRuleCount',
      'build_revision_hash', v_plan ->> 'buildRevisionHash',
      'fixture_result_digest', v_result_digest,
      'external_requests', 0,
      'canonical_inbox_projections', 0
    ),
    'deterministic_no_delivery_current_build'
  );
  v_response := pg_catalog.jsonb_build_object(
    'recorded', true,
    'scopeKey', p_scope_key,
    'batchRequestId', p_batch_request_id,
    'requestId', p_request_id,
    'ruleId', v_rule_id,
    'evidenceKind', 'deterministic_no_delivery',
    'enabledRuleCount', (v_plan ->> 'enabledRuleCount')::integer,
    'comparisonKey', null,
    'scopeConfigDigest', v_plan ->> 'scopeConfigDigest',
    'activeRuleManifestDigest', v_plan ->> 'activeRuleManifestDigest',
    'shadowRevision', v_plan ->> 'shadowRevision',
    'buildRevisionHash', v_plan ->> 'buildRevisionHash',
    'fixtureResultDigest', v_result_digest
  );
  return dashboard_private.finish_notification_cutover_request_v1(
    p_request_id, 'notification_shadow_deterministic_evidence',
    v_fingerprint, v_response
  );
end;
$$;

create or replace function dashboard_private.notification_shadow_deterministic_evidence_current_v1(
  p_scope_key text,
  p_request_id uuid,
  p_shadow_since timestamp with time zone
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current_build_revision_hash text;
  v_current_plan jsonb;
  v_current_expected jsonb;
  v_current_fixture_result_digest text;
  v_rule_id uuid;
  v_batch_request_id uuid;
begin
  if p_shadow_since is null or p_request_id is null then return false; end if;
  select evidence.rule_id, evidence.batch_request_id
  into v_rule_id, v_batch_request_id
  from dashboard_private.notification_shadow_deterministic_evidence evidence
  where evidence.request_id = p_request_id
    and evidence.scope_key = p_scope_key;
  if not found then return false; end if;
  v_current_build_revision_hash :=
    dashboard_private.notification_current_contract_build_revision_hash_v1(
      p_shadow_since
    );
  if v_current_build_revision_hash is null then return false; end if;
  begin
    v_current_plan :=
      dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
        p_scope_key, v_batch_request_id, v_rule_id
      );
  exception when others then
    return false;
  end;
  v_current_expected :=
    dashboard_private.notification_shadow_deterministic_fixture_expected_v1(
      v_current_plan
    );
  if not dashboard_private.notification_shadow_deterministic_intents_match_v1(
    v_current_expected
  ) then return false; end if;
  v_current_fixture_result_digest :=
    dashboard_private.notification_sha256_hex_v1(v_current_expected::text);
  return exists (
    select 1
    from dashboard_private.notification_shadow_deterministic_evidence evidence
    join dashboard_private.notification_runtime_flags shadow_flag
      on shadow_flag.flag_key =
        'notification_control_plane_shadow_write_enabled'
    join dashboard_private.notification_rules rule_row
      on rule_row.id = evidence.rule_id
     and rule_row.active_template_id = evidence.template_id
    join dashboard_private.notification_templates template_row
      on template_row.id = evidence.template_id
     and template_row.rule_id = evidence.rule_id
    cross join lateral (
      select pg_catalog.greatest(
        p_shadow_since,
        pg_catalog.coalesce(pg_catalog.max(pg_catalog.greatest(
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
    where evidence.request_id = p_request_id
      and evidence.scope_key = p_scope_key
      and evidence.rule_id = v_rule_id
      and evidence.batch_request_id = v_batch_request_id
      and evidence.request_id = (v_current_plan ->> 'requestId')::uuid
      and shadow_flag.enabled
      and evidence.shadow_revision = shadow_flag.revision
      and evidence.scope_config_digest =
        dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key)
      and evidence.active_rule_manifest_digest =
        dashboard_private.notification_shadow_active_rule_manifest_digest_v1(p_scope_key)
      and evidence.build_revision_hash = v_current_build_revision_hash
      and evidence.fixture_result_digest = v_current_fixture_result_digest
      and rule_row.enabled
      and rule_row.delivery_mode = 'immediate'
      and rule_row.revision = evidence.rule_revision
      and template_row.checksum = evidence.template_checksum
      and evidence.created_at >= boundary.evidence_since
      and evidence.enabled_rule_count = (
        select pg_catalog.count(*)::integer
        from dashboard_private.notification_rules enabled_rule
        where enabled_rule.enabled
          and dashboard_private.notification_dispatch_scope_for_event_v1(
            enabled_rule.workflow_key, enabled_rule.event_key
          ) = p_scope_key
      )
      and exists (
        select 1
        from dashboard_private.notification_audit_logs audit_row
        where audit_row.entity_kind =
            'notification_shadow_deterministic_evidence'
          and audit_row.entity_id = evidence.request_id::text
          and audit_row.action =
            'shadow_deterministic_no_delivery_verified'
          and audit_row.reason_code =
            'deterministic_no_delivery_current_build'
          and audit_row.request_id = evidence.request_id
          and audit_row.after_summary ->> 'batch_request_id' =
            evidence.batch_request_id::text
          and audit_row.after_summary ->> 'rule_id' = evidence.rule_id::text
          and audit_row.after_summary ->> 'scope_config_digest' =
            evidence.scope_config_digest
          and audit_row.after_summary ->> 'active_rule_manifest_digest' =
            evidence.active_rule_manifest_digest
          and audit_row.after_summary ->> 'build_revision_hash' =
            evidence.build_revision_hash
          and audit_row.after_summary ->> 'fixture_result_digest' =
            evidence.fixture_result_digest
          and audit_row.after_summary ->> 'external_requests' = '0'
          and audit_row.after_summary ->> 'canonical_inbox_projections' = '0'
      )
  );
end;
$$;

create or replace function dashboard_private.notification_shadow_rule_natural_evidence_current_v1(
  p_scope_key text,
  p_rule_id uuid,
  p_shadow_since timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shadow_since is not null
    and p_rule_id is not null
    and exists (
      select 1
      from dashboard_private.notification_rules current_rule
      where current_rule.id = p_rule_id
        and current_rule.enabled
        and dashboard_private.notification_dispatch_scope_for_event_v1(
          current_rule.workflow_key, current_rule.event_key
        ) = p_scope_key
        and exists (
          select 1
          from dashboard_private.notification_audit_logs comparison
          join dashboard_private.notification_audit_logs canonical
            on canonical.entity_kind = 'notification_shadow_intent'
           and canonical.action = 'canonical_intent_recorded'
           and canonical.entity_id =
             comparison.after_summary ->> 'canonical_intent_fingerprint'
          where comparison.entity_kind = 'notification_shadow_comparison'
            and comparison.action = 'shadow_compare_result'
            and comparison.reason_code = 'matched'
            and canonical.after_summary ->> 'rule_id' = p_rule_id::text
            and dashboard_private.notification_shadow_comparison_current_v1(
              p_scope_key,
              comparison.after_summary ->> 'comparison_key',
              p_shadow_since
            )
        )
    );
$$;

-- 과거 완료 영수증을 읽더라도 운영 증거로 인정하는 종류는 자연 비교와
-- 무활성 증거뿐이다. 결정적 증거는 로컬 코드/preview 검증에만 사용하며
-- 운영 replay 및 cutover 완료 조건에는 참여하지 않는다.
create or replace function public.replay_notification_shadow_evidence_v1(
  p_scope_key text,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
  v_response jsonb;
  v_current_scope_digest text;
  v_valid boolean := false;
begin
  if (select auth.role()) <> 'service_role'
    or p_request_id is null
    or not p_scope_key = any(
      dashboard_private.notification_cutover_scope_order_v1()
    )
  then
    raise exception 'notification_shadow_evidence_replay_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  select ledger.* into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if not found then return null; end if;
  if v_ledger.request_kind <> 'notification_shadow_scope_evidence' then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;

  v_response := v_ledger.response_payload;
  if pg_catalog.jsonb_typeof(v_response) is distinct from 'object'
    or v_response ->> 'recorded' is distinct from 'true'
    or v_response ->> 'scopeKey' is distinct from p_scope_key
    or v_response ->> 'requestId' is distinct from p_request_id::text
  then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;

  select flag_row.* into strict v_shadow
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key =
    'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  if not v_shadow.enabled
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_dispatch_flag_keys_v1()
      ) and flag_row.enabled
    )
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key =
        'notification_control_plane_settings_ui_enabled'
        and flag_row.enabled
    )
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_runtime_flag_keys_v1()
      )
    ) <> 12
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind = 'legacy'
    ) <> 10
    or not exists (
      select 1
      from dashboard_private.notification_worker_stop_latch latch
      where latch.latch_key = 'global' and not latch.stopped
    )
    or not dashboard_private.notification_recent_runtime_heartbeats_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
  then
    raise exception 'notification_shadow_evidence_replay_stale'
      using errcode = '55000';
  end if;

  lock table dashboard_private.notification_rules in share mode;
  lock table dashboard_private.notification_templates in share mode;
  v_current_scope_digest :=
    dashboard_private.notification_shadow_scope_config_digest_v1(p_scope_key);
  if v_response ->> 'scopeConfigDigest'
      is distinct from v_current_scope_digest
  then
    raise exception 'notification_shadow_evidence_replay_stale'
      using errcode = '55000';
  end if;

  if v_response ->> 'evidenceKind' = 'natural_comparison'
  then
    v_valid := dashboard_private.notification_shadow_comparison_current_v1(
      p_scope_key, v_response ->> 'comparisonKey', v_shadow.updated_at
    );
  elsif v_response ->> 'evidenceKind' = 'no_active_rule'
  then
    v_valid := dashboard_private.notification_no_active_rule_evidence_current_v1(
      p_scope_key, p_request_id, v_shadow.updated_at
    );
  end if;
  if not pg_catalog.coalesce(v_valid, false) then
    raise exception 'notification_shadow_evidence_replay_stale'
      using errcode = '55000';
  end if;
  return v_response;
end;
$$;

-- 196000의 무활성 조건은 그대로 둔다. 활성 범위는 각 현재 rule마다 현재 자연
-- 비교가 반드시 있어야 한다. 결정적 결과는 운영 완료 조건으로 인정하지 않는다.
create or replace function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  p_shadow_since timestamp with time zone
) returns boolean
language plpgsql
volatile
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
      if exists (
        select 1
        from dashboard_private.notification_rules active_rule
        where active_rule.enabled
          and dashboard_private.notification_dispatch_scope_for_event_v1(
            active_rule.workflow_key, active_rule.event_key
          ) = v_scope_key
          and not dashboard_private.notification_shadow_rule_natural_evidence_current_v1(
            v_scope_key, active_rule.id, p_shadow_since
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

create or replace function public.verify_notification_shadow_evidence_complete_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shadow dashboard_private.notification_runtime_flags%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'notification_shadow_evidence_verify_invalid'
      using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-orchestration-cutover-transition-v1', 0
  ));
  select flag_row.* into strict v_shadow
  from dashboard_private.notification_runtime_flags flag_row
  where flag_row.flag_key =
    'notification_control_plane_shadow_write_enabled'
  for share of flag_row;
  if not v_shadow.enabled
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_dispatch_flag_keys_v1()
      ) and flag_row.enabled
    )
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key =
        'notification_control_plane_settings_ui_enabled'
        and flag_row.enabled
    )
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key = any(
        dashboard_private.notification_runtime_flag_keys_v1()
      )
    ) <> 12
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind = 'legacy'
    ) <> 10
    or not exists (
      select 1
      from dashboard_private.notification_worker_stop_latch latch
      where latch.latch_key = 'global' and not latch.stopped
    )
    or not dashboard_private.notification_recent_runtime_heartbeats_v1()
    or not dashboard_private.notification_schedule_contract_ready_v1()
  then
    raise exception 'notification_shadow_scope_evidence_incomplete'
      using errcode = '55000';
  end if;
  lock table dashboard_private.notification_rules in share mode;
  lock table dashboard_private.notification_templates in share mode;
  if not dashboard_private.notification_shadow_scope_evidence_complete_v1(
    v_shadow.updated_at
  ) then
    raise exception 'notification_shadow_scope_evidence_incomplete'
      using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object(
    'verified', true,
    'scopeCount', pg_catalog.cardinality(
      dashboard_private.notification_cutover_scope_order_v1()
    ),
    'shadowRevision', v_shadow.revision::text
  );
end;
$$;

alter table dashboard_private.notification_shadow_deterministic_evidence
  owner to postgres;
alter function dashboard_private.notification_template_checksum_sha256_v1()
  owner to postgres;
alter function dashboard_private.registration_render_fixed_template_v1(text, jsonb)
  owner to postgres;
alter function dashboard_private.notification_shadow_active_rule_manifest_digest_v1(text)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(
  uuid, text, uuid, bigint, text, text, text, bigint, integer, text
)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_render_v1(text, jsonb, jsonb)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
  text, uuid, uuid
)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_fixture_expected_v1(jsonb)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_intents_match_v1(jsonb)
  owner to postgres;
alter function public.prepare_notification_shadow_deterministic_fixture_v1(text, uuid)
  owner to postgres;
alter function public.record_notification_shadow_deterministic_evidence_v1(
  text, uuid, uuid, jsonb
)
  owner to postgres;
alter function dashboard_private.notification_shadow_deterministic_evidence_current_v1(
  text, uuid, timestamp with time zone
) owner to postgres;
alter function dashboard_private.notification_shadow_rule_natural_evidence_current_v1(
  text, uuid, timestamp with time zone
) owner to postgres;
alter function public.replay_notification_shadow_evidence_v1(text, uuid)
  owner to postgres;
alter function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) owner to postgres;
alter function public.verify_notification_shadow_evidence_complete_v1()
  owner to postgres;

revoke all on function dashboard_private.notification_shadow_active_rule_manifest_digest_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_template_checksum_sha256_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(
  uuid, text, uuid, bigint, text, text, text, bigint, integer, text
)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_render_fixed_template_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_render_v1(text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1(
  text, uuid, uuid
)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_fixture_expected_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_intents_match_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_deterministic_evidence_current_v1(
  text, uuid, timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_rule_natural_evidence_current_v1(
  text, uuid, timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function public.replay_notification_shadow_evidence_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_shadow_scope_evidence_complete_v1(
  timestamp with time zone
) from public, anon, authenticated, service_role;
revoke all on function public.verify_notification_shadow_evidence_complete_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_notification_shadow_deterministic_fixture_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_notification_shadow_deterministic_evidence_v1(
  text, uuid, uuid, jsonb
)
  from public, anon, authenticated, service_role;
grant execute on function public.verify_notification_shadow_evidence_complete_v1()
  to service_role;

commit;
