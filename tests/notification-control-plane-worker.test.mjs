import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const workerMigrationUrl = new URL(
  "../supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql",
  import.meta.url,
)
const workerForwardMigrationUrl = new URL(
  "../supabase/migrations/20260716195900_notification_control_plane_forward_compat.sql",
  import.meta.url,
)
const adapterModuleUrl = new URL(
  "../src/features/notifications/server/notification-workflow-adapter.ts",
  import.meta.url,
)
const approvalAdapterModuleUrl = new URL(
  "../src/features/notifications/server/adapters/approvals-notification-adapter.ts",
  import.meta.url,
)
const workerModuleUrl = new URL(
  "../src/features/notifications/server/notification-worker.ts",
  import.meta.url,
)
const legacyProjectionModuleUrl = new URL(
  "../src/features/notifications/server/legacy-in-app-projection.ts",
  import.meta.url,
)
const googleChatProviderModuleUrl = new URL(
  "../src/features/notifications/server/providers/google-chat-provider.ts",
  import.meta.url,
)
const webPushProviderModuleUrl = new URL(
  "../src/features/notifications/server/providers/web-push-provider.ts",
  import.meta.url,
)
const webPushEndpointModuleUrl = new URL(
  "../src/features/notifications/server/web-push-endpoint.ts",
  import.meta.url,
)
const pushReadinessRouteUrl = new URL(
  "../src/features/notifications/server/notification-push-readiness-route.ts",
  import.meta.url,
)
const pushSubscriptionsRouteUrl = new URL(
  "../src/app/api/push-subscriptions/route.ts",
  import.meta.url,
)
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url)

const RUN_ID = "70000000-0000-4000-8000-000000000001"
const PROFILE_ID = "70000000-0000-4000-8000-000000000002"
const EVENT_ID = "70000000-0000-4000-8000-000000000003"
const RULE_ID = "70000000-0000-4000-8000-000000000004"
const TEMPLATE_ID = "70000000-0000-4000-8000-000000000005"
const DELIVERY_ID = "70000000-0000-4000-8000-000000000006"
const CLAIM_TOKEN = "70000000-0000-4000-8000-000000000007"
const DISPATCH_TOKEN = "70000000-0000-4000-8000-000000000008"
const CLAIM_ID = "70000000-0000-4000-8000-000000000009"
const REQUEST_ID = "70000000-0000-4000-8000-000000000010"
const BIG_REVISION = "9007199254740997"
const TARGET_GENERATION = "9007199254740999"
const OWNER_GENERATION = "9007199254741001"
const GOOGLE_CHAT_URL =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/private-endpoint-secret"
const PUSH_P256DH = "private-p256dh-secret"
const PUSH_AUTH = "private-auth-secret"

const originalFetch = globalThis.fetch
let unexpectedNetworkCalls = 0
globalThis.fetch = async () => {
  unexpectedNetworkCalls += 1
  throw new Error("실제 네트워크 호출 금지")
}

test.after(() => {
  globalThis.fetch = originalFetch
  assert.equal(unexpectedNetworkCalls, 0, "주입하지 않은 실제 fetch 호출은 0건이어야 한다")
})

const WORKER_RPC_SIGNATURES = [
  `dashboard_private.record_notification_event_v1(
    p_scope_key text,
    p_workflow_key text,
    p_event_key text,
    p_source_type text,
    p_source_id text,
    p_source_revision bigint,
    p_occurrence_key text,
    p_actor_profile_id uuid,
    p_occurred_at timestamptz,
    p_payload_schema_version integer,
    p_payload jsonb,
    p_materialized_rule_id uuid default null,
    p_materialized_rule_revision bigint default null
  ) returns jsonb`,
  `dashboard_private.enqueue_notification_target_reconciliation_job_v1(
    p_workflow_key text,
    p_source_type text,
    p_source_id text,
    p_source_revision bigint,
    p_source_event_id uuid,
    p_reconciliation_kind text,
    p_target_generation bigint,
    p_previous_target_set_hash text,
    p_current_target_set_hash text
  ) returns uuid`,
  `public.claim_notification_fanout_jobs_v1(
    p_worker_id text,
    p_batch_size integer,
    p_lease_seconds integer
  ) returns setof jsonb`,
  `public.claim_notification_rule_reconciliation_jobs_v1(
    p_worker_id text,
    p_batch_size integer,
    p_lease_seconds integer
  ) returns setof jsonb`,
  `public.claim_notification_target_reconciliation_jobs_v1(
    p_worker_id text,
    p_batch_size integer,
    p_lease_seconds integer
  ) returns setof jsonb`,
  `public.apply_notification_rule_reconciliation_batch_v1(
    p_job_id uuid,
    p_claim_token uuid,
    p_expected_cursor text,
    p_batch jsonb,
    p_next_cursor text,
    p_done boolean
  ) returns jsonb`,
  `public.apply_notification_target_reconciliation_batch_v1(
    p_job_id uuid,
    p_claim_token uuid,
    p_expected_cursor text,
    p_batch jsonb,
    p_next_cursor text,
    p_done boolean
  ) returns jsonb`,
  `public.finish_notification_orchestration_job_v1(
    p_job_kind text,
    p_job_id uuid,
    p_claim_token uuid,
    p_disposition text,
    p_outcome_summary jsonb,
    p_error_code text,
    p_next_attempt_at timestamptz
  ) returns jsonb`,
  `public.get_notification_orchestration_job_status_v1(
    p_job_kind text,
    p_job_id uuid
  ) returns jsonb`,
  `public.retry_notification_orchestration_job_v1(
    p_job_kind text,
    p_job_id uuid,
    p_expected_attempt_count integer,
    p_request_id uuid
  ) returns jsonb`,
  `public.claim_notification_deliveries_v1(
    p_worker_id text,
    p_batch_size integer,
    p_lease_seconds integer
  ) returns setof jsonb`,
  `public.record_notification_worker_heartbeat_v1(
    p_worker_id text,
    p_run_id uuid,
    p_phase text,
    p_counts jsonb,
    p_error_code text
  ) returns void`,
  `public.begin_notification_delivery_send_v1(
    p_delivery_id uuid,
    p_claim_token uuid
  ) returns jsonb`,
  `public.commit_notification_in_app_delivery_v1(
    p_delivery_id uuid,
    p_claim_token uuid
  ) returns jsonb`,
  `public.finalize_notification_delivery_v1(
    p_delivery_id uuid,
    p_claim_token uuid,
    p_status text,
    p_status_reason text,
    p_provider_message_id text,
    p_provider_response_code text,
    p_error_code text,
    p_error_summary text,
    p_next_attempt_at timestamptz
  ) returns jsonb`,
  `public.reap_notification_leases_v1(
    p_worker_id text,
    p_batch_size integer
  ) returns jsonb`,
  `public.reconcile_notification_delivery_v1(
    p_delivery_id uuid,
    p_resolution text,
    p_reason text,
    p_request_id uuid,
    p_duplicate_risk_accepted boolean default false
  ) returns jsonb`,
  `public.get_dashboard_notification_inbox_v1(
    p_limit integer default 20,
    p_before_created_at timestamptz default null,
    p_before_id uuid default null
  ) returns jsonb`,
  `public.get_dashboard_notification_unread_count_v1() returns jsonb`,
  `public.mark_dashboard_notification_read_v1(
    p_notification_id uuid
  ) returns jsonb`,
  `dashboard_private.reserve_canonical_dispatch_ownership_v1(
    p_delivery_id uuid
  ) returns uuid`,
  `public.begin_legacy_notification_dispatch_v1(
    p_workflow_key text,
    p_occurrence_key text,
    p_rule_id uuid,
    p_channel_key text,
    p_target_key text,
    p_target_generation bigint,
    p_legacy_owner_key text,
    p_expected_owner_generation bigint,
    p_request_id uuid
  ) returns jsonb`,
  `public.finalize_legacy_notification_dispatch_v1(
    p_claim_id uuid,
    p_owner_generation bigint,
    p_dispatch_token uuid,
    p_outcome text,
    p_provider_reference text
  ) returns jsonb`,
  `public.commit_legacy_notification_in_app_projection_v1(
    p_delivery_id uuid,
    p_claim_id uuid,
    p_owner_generation bigint,
    p_dispatch_token uuid
  ) returns jsonb`,
  `public.transfer_notification_dispatch_ownership_v1(
    p_claim_id uuid,
    p_expected_owner_generation bigint,
    p_to_owner_kind text,
    p_request_id uuid,
    p_reason_code text
  ) returns jsonb`,
]

const SERVICE_ROLE_ONLY_RPCS = [
  "record_notification_event_v1",
  "enqueue_notification_target_reconciliation_job_v1",
  "claim_notification_fanout_jobs_v1",
  "claim_notification_rule_reconciliation_jobs_v1",
  "claim_notification_target_reconciliation_jobs_v1",
  "apply_notification_rule_reconciliation_batch_v1",
  "apply_notification_target_reconciliation_batch_v1",
  "finish_notification_orchestration_job_v1",
  "claim_notification_deliveries_v1",
  "record_notification_worker_heartbeat_v1",
  "begin_notification_delivery_send_v1",
  "commit_notification_in_app_delivery_v1",
  "finalize_notification_delivery_v1",
  "reap_notification_leases_v1",
  "reserve_canonical_dispatch_ownership_v1",
  "begin_legacy_notification_dispatch_v1",
  "finalize_legacy_notification_dispatch_v1",
  "commit_legacy_notification_in_app_projection_v1",
  "transfer_notification_dispatch_ownership_v1",
]

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeSql(source) {
  return source.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

function signaturePattern(signature) {
  return new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegex(normalizeSql(signature)).replace(/\s+/g, "\\s+")}`,
    "i",
  )
}

function functionBlock(source, functionName) {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public|dashboard_private)\\.${escapeRegex(functionName)}\\b`,
    "i",
  )
  const match = pattern.exec(source)
  assert.ok(match, `${functionName} 함수가 있어야 한다`)
  const remainder = source.slice(match.index + match[0].length)
  const next = /\ncreate\s+or\s+replace\s+function\s+/i.exec(remainder)
  return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length)
}

function assertNoSensitiveValue(value, message = "안전 경계 밖으로 비밀정보가 나오면 안 된다") {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(
    serialized,
    /key-secret|token-secret|private-endpoint-secret|private-p256dh-secret|private-auth-secret|SPACEIDENTIFIER123456|webhook_url|webhookUrl|endpoint|p256dh|\bauth\b/i,
    message,
  )
}

function assertExactKeys(value, expected, message) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), message)
}

function clone(value) {
  return structuredClone(value)
}

function createRpcHarness(responders = {}) {
  const calls = []
  const defaults = {
    claim_notification_fanout_jobs_v1: [],
    claim_notification_rule_reconciliation_jobs_v1: [],
    claim_notification_target_reconciliation_jobs_v1: [],
    reap_notification_leases_v1: { reaped_count: 0 },
    claim_notification_deliveries_v1: [],
    record_notification_worker_heartbeat_v1: null,
    finish_notification_orchestration_job_v1: { ok: true },
    finalize_notification_delivery_v1: { ok: true },
    prepare_notification_immediate_delivery_v1: createBegunGoogleChatContext(),
    register_notification_external_attempt_v1: {
      allowed: true,
      attempt_id: "70000000-0000-4000-8000-000000000011",
    },
  }
  return {
    calls,
    async rpc(name, parameters) {
      calls.push({ name, parameters: clone(parameters) })
      const responder = Object.hasOwn(responders, name) ? responders[name] : defaults[name]
      if (typeof responder === "function") return responder(parameters, calls)
      if (responder === undefined) throw new Error(`정의되지 않은 RPC 호출: ${name}`)
      return clone(responder)
    },
  }
}

function createDeliveryClaim(overrides = {}) {
  return {
    delivery_id: DELIVERY_ID,
    claim_token: CLAIM_TOKEN,
    event_id: EVENT_ID,
    workflow_key: "tasks",
    event_key: "task.created",
    source_type: "ops_task",
    source_id: "task-42",
    source_revision: BIG_REVISION,
    rule_id: RULE_ID,
    rule_revision: BIG_REVISION,
    attempt_count: 0,
    max_attempts: 5,
    target_generation: TARGET_GENERATION,
    scheduled_for: "2026-07-17T01:00:00.000Z",
    retry_window_ends_at: null,
    channel_key: "google_chat",
    target: {
      target_kind: "profile",
      target_key: `profile:${PROFILE_ID}`,
      target_profile_id: PROFILE_ID,
      connection_key: "google_chat.management",
      target_snapshot: { role: "staff", active: true },
    },
    ...overrides,
  }
}

function createAdapter(overrides = {}) {
  return {
    workflowKey: "tasks",
    async resolveTargets() {
      return { targetGeneration: TARGET_GENERATION, targetSetHash: "fixture-hash", targets: [] }
    },
    async buildRenderContext() {
      return {}
    },
    async buildDeepLink() {
      return "/admin/tasks"
    },
    async revalidateBeforeSend() {
      return { ok: true }
    },
    ...overrides,
  }
}

function createBegunGoogleChatContext(overrides = {}) {
  return {
    delivery_id: DELIVERY_ID,
    claim_token: CLAIM_TOKEN,
    dispatch_token: DISPATCH_TOKEN,
    status: "sending",
    channel_key: "google_chat",
    connection_key: "google_chat.management",
    webhook_url: GOOGLE_CHAT_URL,
    rendered_title: "새 할 일",
    rendered_body: "확인할 할 일이 있습니다.",
    href: "/admin/tasks",
    ...overrides,
  }
}

function createBegunWebPushContext(overrides = {}) {
  return {
    delivery_id: DELIVERY_ID,
    claim_token: CLAIM_TOKEN,
    dispatch_token: DISPATCH_TOKEN,
    status: "sending",
    channel_key: "web_push",
    subscription: {
      endpoint: PUSH_ENDPOINT,
      keys: { p256dh: PUSH_P256DH, auth: PUSH_AUTH },
    },
    rendered_title: "새 할 일",
    rendered_body: "확인할 할 일이 있습니다.",
    href: "/admin/tasks",
    ...overrides,
  }
}

function assertProviderResult(result, status, statusReason) {
  assertExactKeys(result, [
    "status",
    "statusReason",
    "providerMessageId",
    "providerResponseCode",
    "errorCode",
    "errorSummary",
    "nextAttemptAt",
  ], "provider 결과는 finalization용 닫힌 필드만 가져야 한다")
  assert.equal(result.status, status)
  assert.equal(result.statusReason, statusReason)
  assertNoSensitiveValue(result, "provider 결과에 목적지·키·원문·응답 비밀정보가 포함되면 안 된다")
}

test("worker migration은 잠긴 25개 RPC 서명을 정확히 구현하고 이후 작업 계약을 당겨오지 않는다", async () => {
  const source = await readFile(workerMigrationUrl, "utf8")

  assert.equal(WORKER_RPC_SIGNATURES.length, 25)
  for (const signature of WORKER_RPC_SIGNATURES) {
    assert.match(source, signaturePattern(signature), `${normalizeSql(signature)} 서명이 정확해야 한다`)
  }
  assert.doesNotMatch(source, /common_notification_control_plane_runtime_version/i)
  assert.doesNotMatch(source, /notification_workflow_adapters_runtime_version/i)
  assert.doesNotMatch(source, /notification_worker_secret|pg_cron|cron\.schedule|notification-worker\/run/i)
})

test("이미 적용된 worker migration은 보존하고 공통 안전성 변경은 순방향 migration으로 적용한다", async () => {
  const [historical, forward] = await Promise.all([
    readFile(workerMigrationUrl, "utf8"),
    readFile(workerForwardMigrationUrl, "utf8"),
  ])
  assert.doesNotMatch(forward, /^\+/m)

  const historicalMaterialize = functionBlock(historical, "materialize_notification_delivery_v1")
  const historicalFanout = functionBlock(historical, "apply_notification_fanout_batch_v1")
  const historicalBeginLegacy = functionBlock(historical, "begin_legacy_notification_dispatch_v1")
  assert.doesNotMatch(historicalMaterialize, /v_rule_snapshot\s+jsonb/i)
  assert.match(historicalFanout, /'outcome',\s*'superseded'/i)
  assert.doesNotMatch(historicalBeginLegacy, /idempotent_dispatch_replay/i)

  const materialize = functionBlock(forward, "materialize_notification_delivery_v1")
  assert.match(materialize, /jsonb_array_elements\(v_event\.rule_snapshot\)/i)
  assert.match(materialize, /v_rule_snapshot\s*->>\s*'enabled'/i)
  assert.doesNotMatch(materialize, /v_rule\.revision\s*<>\s*p_rule_revision/i)
  assert.doesNotMatch(materialize, /v_rule\.active_template_id\s*<>\s*p_template_id/i)
  assert.doesNotMatch(
    materialize,
    /case when v_state\s*->>\s*'status'\s*=\s*'pending' then pg_catalog\.clock_timestamp\(\)/i,
  )
  assert.match(materialize, /else 5\s+end,\s+null\s*\)\s*on conflict/i)

  const fanout = functionBlock(forward, "apply_notification_fanout_batch_v1")
  assert.doesNotMatch(
    fanout,
    /rule\.revision\s*=\s*p_rule_revision[\s\S]*?'outcome',\s*'superseded'/i,
  )

  const beginLegacy = functionBlock(forward, "begin_legacy_notification_dispatch_v1")
  assert.match(beginLegacy, /p_channel_key = 'web_push' and rule\.channel_key = 'in_app'/i)
  assert.match(beginLegacy, /v_claim\.state in \('dispatch_started', 'closed'\)/i)
  assert.match(beginLegacy, /idempotent_dispatch_replay/i)
  assert.match(
    beginLegacy,
    /'dispatch_token',\s*v_claim\.dispatch_token[\s\S]*?'dispatch_already_started'/i,
  )

  const reaper = functionBlock(forward, "reap_notification_leases_v1")
  assert.match(
    reaper,
    /delivery\.status = 'claimed'[\s\S]*?set status = 'pending', status_reason = null,\s*next_attempt_at = null/i,
  )
  assert.match(
    reaper,
    /delivery\.channel_key = 'customer_message'[\s\S]*?complete_registration_admission_delivery_v1\(/i,
  )
  assert.match(
    reaper,
    /complete_registration_admission_delivery_v1\([\s\S]*?'unknown'[\s\S]*?'delivery_unknown'[\s\S]*?'solapi_worker_lost_after_send_start'/i,
  )
  assert.match(
    reaper,
    /delivery\.status = 'sending'[\s\S]*?delivery\.channel_key <> 'customer_message'/i,
  )
  assert.match(
    reaper,
    /delivery\.status = 'claimed'[\s\S]*?delivery\.channel_key = 'customer_message'[\s\S]*?set status = 'pending'/i,
  )
  assert.match(reaper, /pg_try_advisory_xact_lock[\s\S]*?registration-admission-message:/i)
  assert.match(reaper, /join public\.ops_registration_messages message[\s\S]*?message\.id::text = event_row\.source_id/i)
  assert.match(reaper, /message\.template_key = 'admission_application'/i)
  assert.match(reaper, /message\.status = 'pending'[\s\S]*?message\.claim_active/i)
  assert.match(reaper, /ownership\.owner_kind = 'canonical'[\s\S]*?ownership\.state = 'reserved'/i)
  assert.doesNotMatch(reaper, /event_row\.source_id::uuid/i)
  assert.doesNotMatch(
    reaper,
    /for v_candidate in[\s\S]*?for update[\s\S]*?complete_registration_admission_delivery_v1\(/i,
  )
})

test("worker migration은 원자 이벤트·SKIP LOCKED·claim token·lease 복구·begin-send 시도 증가를 고정한다", async () => {
  const [source, forward] = await Promise.all([
    readFile(workerMigrationUrl, "utf8"),
    readFile(workerForwardMigrationUrl, "utf8"),
  ])
  const trimmed = source.trim()

  assert.match(trimmed, /^begin;\s*/i)
  assert.match(trimmed, /commit;$/i)
  assert.equal((trimmed.match(/^begin;$/gim) || []).length, 1)
  assert.equal((trimmed.match(/^commit;$/gim) || []).length, 1)

  const record = functionBlock(source, "record_notification_event_v1")
  assert.match(record, /notification_events/i)
  assert.match(record, /notification_event_fanout_jobs/i)
  assert.match(record, /scheduled_for[\s\S]*occurred_at/i)
  assert.match(record, /on\s+conflict/i)
  assert.match(record, /jsonb_build_object\s*\(\s*'event_id'[\s\S]*?'fanout_job_id'/i)
  assert.doesNotMatch(
    record.match(/return\s+jsonb_build_object[\s\S]*?;/i)?.[0] || "",
    /payload|cursor|lease|rule_snapshot/i,
    "producer 응답은 event_id와 fanout_job_id 외의 내부값을 반환하면 안 된다",
  )

  for (const claimName of [
    "claim_notification_fanout_jobs_v1",
    "claim_notification_rule_reconciliation_jobs_v1",
    "claim_notification_target_reconciliation_jobs_v1",
    "claim_notification_deliveries_v1",
  ]) {
    const block = functionBlock(source, claimName)
    assert.match(block, /for\s+update\s+skip\s+locked/i, `${claimName}은 SKIP LOCKED를 사용해야 한다`)
    assert.match(block, /claim_token[\s\S]*gen_random_uuid\s*\(/i, `${claimName}은 새 claim token을 발급해야 한다`)
    assert.match(block, /lease_expires_at/i)
  }

  const beginSend = functionBlock(source, "begin_notification_delivery_send_v1")
  assert.match(beginSend, /status\s*=\s*'sending'/i)
  assert.match(beginSend, /attempt_count\s*=\s*[^,;]+\+\s*1/i)
  assert.match(beginSend, /dispatch_started/i)
  assert.match(beginSend, /claim_token/i)
  assert.match(beginSend, /cancel_requested_at/i)

  const upsert = functionBlock(forward, "materialize_notification_delivery_v1")
  assert.match(upsert, /workflow_key\s*=\s*'registration'[\s\S]*event_key\s*=\s*'registration\.appointment_reminder_due'[\s\S]*then\s+3/i)
  assert.match(upsert, /jsonb_array_elements\(v_event\.rule_snapshot\)/i)
  assert.match(upsert, /v_rule_snapshot\s*->>\s*'enabled'/i)
  assert.doesNotMatch(upsert, /v_rule\.revision\s*<>\s*p_rule_revision/i)
  assert.doesNotMatch(upsert, /v_rule\.active_template_id\s*<>\s*p_template_id/i)

  const applyFanout = functionBlock(forward, "apply_notification_fanout_batch_v1")
  assert.doesNotMatch(
    applyFanout,
    /rule\.revision\s*=\s*p_rule_revision[\s\S]*?'outcome',\s*'superseded'/i,
    "이미 기록된 이벤트의 규칙 스냅샷은 이후 설정 변경으로 무효화되면 안 된다",
  )

  const claimDeliveries = functionBlock(source, "claim_notification_deliveries_v1")
  assert.match(claimDeliveries, /'attempt_count',\s*v_delivery\.attempt_count/i)
  assert.match(claimDeliveries, /'max_attempts',\s*v_delivery\.max_attempts/i)
  assert.match(claimDeliveries, /'retry_window_ends_at'[\s\S]*event_row\.payload\s*#>>\s*'\{appointment,scheduled_at\}'/i)

  const reaper = functionBlock(source, "reap_notification_leases_v1")
  assert.match(reaper, /'claimed'[\s\S]*?'pending'/i)
  assert.match(reaper, /'sending'[\s\S]*?'delivery_unknown'/i)
  assert.match(reaper, /worker_lost_after_send_start/i)

  const heartbeat = functionBlock(source, "record_notification_worker_heartbeat_v1")
  assert.match(heartbeat, /notification-worker-run:/i)
  assert.match(heartbeat, /phase\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*\)/i)
  assert.match(heartbeat, /notification_worker_heartbeat_conflict/i)
})

test("등록 외부 예약 알림 재시도는 초회 후 1분·다음 5분이며 총 3회 계약을 사용한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const cases = [
    { attemptCount: 0, expected: "2026-07-17T01:01:00.000Z" },
    { attemptCount: 1, expected: "2026-07-17T01:05:00.000Z" },
  ]
  for (const fixture of cases) {
    const claim = createDeliveryClaim({
      workflow_key: "registration",
      event_key: "registration.appointment_reminder_due",
      source_type: "registration_appointment",
      source_id: "71000000-0000-4000-8000-000000000451",
      source_revision: "7",
      rule_revision: "1",
      attempt_count: fixture.attemptCount,
      max_attempts: 3,
      retry_window_ends_at: "2026-07-17T02:00:00.000Z",
    })
    const harness = createRpcHarness({
      claim_notification_deliveries_v1: [claim],
      begin_notification_delivery_send_v1: createBegunGoogleChatContext(),
    })
    const worker = createNotificationWorkerRuntime({
      getAdapter: () => createAdapter({ workflowKey: "registration" }),
      rpc: harness.rpc,
      getProvider: () => ({
        async send() {
          return {
            status: "retry_wait",
            statusReason: "provider_rate_limited",
            providerMessageId: null,
            providerResponseCode: "429",
            errorCode: "provider_rate_limited",
            errorSummary: "safe",
            nextAttemptAt: null,
          }
        },
      }),
      createRunId: () => RUN_ID,
      now: () => new Date("2026-07-17T01:00:00.000Z"),
    })

    await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })
    const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
    assert.equal(finalize.parameters.p_status, "retry_wait")
    assert.equal(finalize.parameters.p_next_attempt_at, fixture.expected)
  }
})

test("등록 예약 알림의 다음 재시도가 예약 시각 이상이면 즉시 retry_window_closed로 닫는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const claim = createDeliveryClaim({
    workflow_key: "registration",
    event_key: "registration.appointment_reminder_due",
    source_type: "registration_appointment",
    source_id: "71000000-0000-4000-8000-000000000452",
    source_revision: "7",
    rule_revision: "1",
    attempt_count: 0,
    max_attempts: 3,
    retry_window_ends_at: "2026-07-17T01:00:30.000Z",
  })
  const harness = createRpcHarness({
    claim_notification_deliveries_v1: [claim],
    begin_notification_delivery_send_v1: createBegunGoogleChatContext(),
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter({ workflowKey: "registration" }),
    rpc: harness.rpc,
    getProvider: () => ({
      async send() {
        return {
          status: "retry_wait",
          statusReason: "provider_rate_limited",
          providerMessageId: null,
          providerResponseCode: "429",
          errorCode: "provider_rate_limited",
          errorSummary: "safe",
          nextAttemptAt: null,
        }
      },
    }),
    createRunId: () => RUN_ID,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })
  const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
  assert.equal(finalize.parameters.p_status, "failed")
  assert.equal(finalize.parameters.p_status_reason, "retry_window_closed")
  assert.equal(finalize.parameters.p_next_attempt_at, null)
})

test("규칙 재계산은 변경된 규칙의 delivery만 취소하고 같은 소스의 다른 규칙은 보존한다", async () => {
  const source = await readFile(workerMigrationUrl, "utf8")
  const reconcile = functionBlock(source, "apply_notification_rule_reconciliation_batch_v1")
  const cancellationSection = reconcile.slice(
    reconcile.indexOf("with canceled as"),
    reconcile.indexOf("for v_occurrence"),
  )

  assert.equal(
    (cancellationSection.match(/v_job\.rule_revision_map\s*\?\s*delivery\.rule_id::text/g) ?? []).length,
    2,
    "pending/retry_wait 취소와 claimed 취소 요청 모두 변경 규칙 ID로 제한해야 한다",
  )
  assert.equal(
    (cancellationSection.match(/delivery\.rule_revision\s*<>\s*\(v_job\.rule_revision_map\s*->>\s*delivery\.rule_id::text\)::bigint/g) ?? []).length,
    2,
    "같은 규칙의 최신 리비전 delivery는 pending/claimed 모두 보존해야 한다",
  )
})

test("fanout 권위 원본 일시 장애는 영구 실패시키지 않고 bounded retry로 돌려놓는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const job = {
    job_id: "71000000-0000-4000-8000-000000000401",
    claim_token: "71000000-0000-4000-8000-000000000402",
    workflow_key: "registration",
    event_id: EVENT_ID,
    event_key: "registration.appointment_reminder_due",
    source_type: "registration_appointment",
    source_id: "71000000-0000-4000-8000-000000000403",
    source_revision: "7",
    occurrence_key: "registration:fixture:transient",
    occurred_at: "2026-07-17T01:00:00.000Z",
    scheduled_for: "2026-07-17T01:10:00.000Z",
    payload_schema_version: 2,
    payload: { fixture: true },
    rule_id: RULE_ID,
    rule_revision: "1",
    template_id: TEMPLATE_ID,
    channel_key: "in_app",
    audience_key: "track_director",
    rule_variant_key: "same_day_at",
    title_template: "{학생}",
    body_template: "{장소}",
    allowed_variables: [
      { key: "student_name", token: "학생", pii_class: "student_name" },
      { key: "place", token: "장소", pii_class: "business_text" },
    ],
    template_payload_schema_version: 2,
    cursor: null,
    next_cursor: null,
    last_rule: true,
    attempt_count: 1,
  }
  const harness = createRpcHarness({ claim_notification_fanout_jobs_v1: [job] })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter({
      workflowKey: "registration",
      async resolveTargets() {
        throw Object.assign(new Error("safe"), { code: "notification_source_unavailable" })
      },
    }),
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  const finish = harness.calls.find((call) => (
    call.name === "finish_notification_orchestration_job_v1"
    && call.parameters.p_job_kind === "fanout"
  ))
  assert.equal(finish.parameters.p_disposition, "retry")
  assert.equal(finish.parameters.p_error_code, "notification_source_unavailable")
  assert.equal(finish.parameters.p_next_attempt_at, "2026-07-17T01:00:10.000Z")
})

test("reconciliation 영구 오류와 일시 오류는 각 job을 failed/retry로 닫고 뒤 단계 실행을 막지 않는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness({
    claim_notification_rule_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000411",
      claim_token: "71000000-0000-4000-8000-000000000412",
      workflow_key: "registration",
      rule_revision_map: { [RULE_ID]: "2" },
      cursor: null,
      attempt_count: 1,
    }],
    claim_notification_target_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000413",
      claim_token: "71000000-0000-4000-8000-000000000414",
      workflow_key: "registration",
      source_type: "registration_appointment",
      source_id: "71000000-0000-4000-8000-000000000415",
      source_revision: "7",
      source_event_id: "71000000-0000-4000-8000-000000000416",
      reconciliation_kind: "recipient_set_changed",
      target_generation: "2",
      previous_target_set_hash: "a".repeat(64),
      current_target_set_hash: "b".repeat(64),
      cursor: null,
      attempt_count: 1,
    }],
  })
  const adapter = createAdapter({
    workflowKey: "registration",
    async reconcileScheduledRules() {
      throw Object.assign(new Error("safe"), { code: "payload_schema_unsupported" })
    },
    async reconcileTargets() {
      throw Object.assign(new Error("safe"), { code: "notification_source_unavailable" })
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => adapter,
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(result.ruleReconciliation, 1)
  assert.equal(result.targetReconciliation, 1)
  assert.ok(harness.calls.some((call) => call.name === "reap_notification_leases_v1"))
  assert.ok(harness.calls.some((call) => call.name === "claim_notification_deliveries_v1"))
  const finishes = harness.calls.filter((call) => call.name === "finish_notification_orchestration_job_v1")
  assert.deepEqual(finishes.map((call) => ({
    kind: call.parameters.p_job_kind,
    disposition: call.parameters.p_disposition,
    errorCode: call.parameters.p_error_code,
  })), [
    { kind: "rule_reconciliation", disposition: "failed", errorCode: "payload_schema_unsupported" },
    { kind: "target_reconciliation", disposition: "retry", errorCode: "notification_source_unavailable" },
  ])
})

test("worker migration은 원자 inbox 투영·개인 receipt·legacy 소유권과 서비스 역할 경계를 유지한다", async () => {
  const source = await readFile(workerMigrationUrl, "utf8")

  const canonicalCommit = functionBlock(source, "commit_notification_in_app_delivery_v1")
  assert.match(canonicalCommit, /dashboard_notifications/i)
  assert.match(canonicalCommit, /source_delivery_id/i)
  assert.match(canonicalCommit, /dashboard_push_subscriptions/i)
  assert.match(canonicalCommit, /parent_delivery_id/i)
  assert.match(canonicalCommit, /read_at[\s\S]*null/i)

  const legacyCommit = functionBlock(source, "commit_legacy_notification_in_app_projection_v1")
  assert.match(legacyCommit, /dashboard_notifications/i)
  assert.match(legacyCommit, /source_delivery_id/i)
  assert.match(legacyCommit, /read_at[\s\S]*null/i)
  assert.doesNotMatch(legacyCommit, /dashboard_push_subscriptions|parent_delivery_id/i)

  const visibleRows = functionBlock(source, "visible_dashboard_notification_rows_v1")
  assert.match(visibleRows, /dashboard_notification_read_receipts/i)
  assert.match(visibleRows, /revoked_at\s+is\s+null/i)
  assert.match(visibleRows, /coalesce[\s\S]*read_at/i)
  assert.match(
    visibleRows,
    /recipient_profile_id\s+is\s+null[\s\S]*recipient_team\s*=\s*'관리팀'/i,
    "관리팀 shared row가 개인 수신자 row를 넓혀 노출하면 안 된다",
  )

  const markRead = functionBlock(source, "mark_dashboard_notification_read_v1")
  assert.match(markRead, /on\s+conflict\s*\([^)]*notification_id[^)]*profile_id[^)]*\)\s+do\s+nothing/i)
  assert.doesNotMatch(markRead, /update[\s\S]*dashboard_notifications[\s\S]*read_at/i)

  const reserve = functionBlock(source, "reserve_canonical_dispatch_ownership_v1")
  assert.match(reserve, /rule_id/i)
  assert.match(reserve, /target_generation/i)
  assert.match(reserve, /owner_generation/i)
  assert.match(reserve, /legacy_deduped|ownership_not_acquired/i)

  const transfer = functionBlock(source, "transfer_notification_dispatch_ownership_v1")
  assert.match(transfer, /state\s*=\s*'reserved'|state\s*<>\s*'reserved'/i)
  assert.match(transfer, /owner_generation[\s\S]*\+\s*1/i)
  assert.match(transfer, /ownership_transferred_pre_dispatch/i)

  const reconcile = functionBlock(source, "reconcile_notification_delivery_v1")
  assert.match(reconcile, /p_duplicate_risk_accepted\s+is\s+null/i)
  assert.match(reconcile, /owner_generation[\s\S]*\+\s*1[\s\S]*state\s*=\s*'reserved'/i)

  const finalizeLegacy = functionBlock(source, "finalize_legacy_notification_dispatch_v1")
  assert.match(finalizeLegacy, /terminal_outcome\s+is\s+distinct\s+from\s+p_outcome/i)
  assert.match(finalizeLegacy, /notification_legacy_finalize_replay_mismatch/i)

  const pushAudit = functionBlock(source, "record_push_connection_test_audit_v1")
  assert.match(pushAudit, /coalesce\s*\(\s*\(\s*select\s+auth\.role\(\)\s*\)/i)
  assert.match(pushAudit, /p_outcome\s+is\s+null[\s\S]*p_code\s+is\s+null/i)
  assert.match(pushAudit, /push_connection_tested/i)
  assert.doesNotMatch(pushAudit, /endpoint|p256dh|webhook|rendered_(?:title|body)/i)

  const pushRebind = functionBlock(source, "rebind_dashboard_push_subscription_v1")
  assert.match(pushRebind, /auth\.uid\(\)/i)
  assert.match(pushRebind, /v_subscription\.p256dh\s*<>\s*p_p256dh/i)
  assert.match(pushRebind, /v_subscription\.auth\s*<>\s*p_auth/i)
  assert.match(pushRebind, /push_subscription_rebound/i)
  assert.doesNotMatch(pushRebind, /service_role|previous_profile|prior_profile/i)

  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+public\.record_push_connection_test_audit_v1\s*\([^;]+?\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  )
  assert.match(
    source,
    /grant\s+execute\s+on\s+function\s+public\.record_push_connection_test_audit_v1\s*\([^;]+?\)\s+to\s+service_role/i,
  )
  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+public\.rebind_dashboard_push_subscription_v1\s*\([^;]+?\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  )
  assert.match(
    source,
    /grant\s+execute\s+on\s+function\s+public\.rebind_dashboard_push_subscription_v1\s*\([^;]+?\)\s+to\s+authenticated/i,
  )

  for (const rpcName of SERVICE_ROLE_ONLY_RPCS) {
    const qualified = rpcName === "record_notification_event_v1" ||
      rpcName === "enqueue_notification_target_reconciliation_job_v1" ||
      rpcName === "reserve_canonical_dispatch_ownership_v1"
      ? `dashboard_private.${rpcName}`
      : `public.${rpcName}`
    assert.match(
      source,
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escapeRegex(qualified)}\\s*\\([^;]+?\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, "i"),
      `${qualified}은 브라우저 역할에서 회수되어야 한다`,
    )
    assert.match(
      source,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escapeRegex(qualified)}\\s*\\([^;]+?\\)\\s+to\\s+service_role`, "i"),
      `${qualified}은 service_role만 실행해야 한다`,
    )
  }
})

test("adapter 소스는 잠긴 타입·두 렌더 callback·선검증·선택 reconciliation 경계만 노출한다", async () => {
  const source = await readFile(adapterModuleUrl, "utf8")
  const normalized = source.replace(/\s+/g, " ")

  for (const fragment of [
    "export type DbBigInt = string",
    "targetGeneration: DbBigInt targetSetHash: string targets: ReadonlyArray<NotificationTarget>",
    "sourceEventId: string",
    "reconciliationKind: \"recipient_set_changed\"",
    "resolveTargets(input: NotificationResolveInput): Promise<NotificationTargetSet>",
    "buildRenderContext(input: NotificationRenderInput): Promise<NotificationRenderContext>",
    "buildDeepLink(input: NotificationRenderInput): Promise<string | null>",
    "revalidateBeforeSend(input: NotificationRevalidationInput): Promise<NotificationRevalidationResult>",
    "reconcileScheduledRules?(input: RuleReconciliationInput): Promise<RuleReconciliationBatch>",
    "reconcileTargets?(input: TargetReconciliationInput): Promise<TargetReconciliationBatch>",
  ]) {
    assert.ok(normalized.includes(fragment), `adapter 계약 조각이 필요하다: ${fragment}`)
  }
  assert.match(source, /status:\s*"canceled"[\s\S]*source_status_changed[\s\S]*recipient_revoked/i)
  assert.match(source, /status:\s*"failed"[\s\S]*retry_window_closed[\s\S]*render_validation_failed/i)
  assert.doesNotMatch(source, /titleTemplate|bodyTemplate|renderedTitle|renderedBody|webhookUrl|subscriptionEndpoint/)
})

test("worker 공개 factory는 getAdapter 하나만 받고 workflow 구현을 직접 import하지 않는다", async () => {
  const source = await readFile(workerModuleUrl, "utf8")
  const normalized = source.replace(/\s+/g, " ")
  const workerModule = await import(workerModuleUrl)

  assert.ok(normalized.includes(
    "runBatch(input: { workerId: string; batchSize: number; leaseSeconds: number }): Promise<{",
  ))
  for (const field of [
    "fanout: number",
    "ruleReconciliation: number",
    "targetReconciliation: number",
    "deliveries: number",
    "reaped: number",
  ]) {
    assert.ok(normalized.includes(field), `worker 결과에 ${field}가 필요하다`)
  }
  assert.match(
    normalized,
    /export function createNotificationWorker\s*\(\s*input:\s*\{\s*getAdapter:\s*\(workflowKey:\s*string\)\s*=>\s*NotificationWorkflowAdapter\s*\|\s*null\s*}\s*\):\s*NotificationWorker/,
  )
  assert.equal(typeof workerModule.createNotificationWorker, "function")
  assert.equal(workerModule.createNotificationWorker.length, 1)
  assert.equal(typeof workerModule.createNotificationWorkerRuntime, "function")
  assert.match(
    source,
    /scheduledFor:\s*requiredString\(job\.scheduled_for\)/,
    "예약 발송 시각이 claim에서 빠지면 occurred_at으로 추측하지 말고 fail-closed해야 한다",
  )
  assert.match(source, /transientSupabaseRpcError\(error\)/)
  assert.match(source, /notification_rpc_unavailable/)

  const importLines = source.match(/^import[^\n]+(?:\n[^\n]+)*?from\s+["'][^"']+["']/gm)?.join("\n") || ""
  assert.doesNotMatch(
    importLines,
    /\/(?:tasks|word-retests|registration|transfer|withdrawal|makeup-requests|approvals)\//i,
    "공통 worker가 workflow 구현을 직접 import하면 안 된다",
  )
})

test("공통 renderer는 target hash를 안정화하고 허용 변수·schema·workflow deep link를 fail-closed로 검증한다", async () => {
  const { hashNotificationTargets, renderNotificationSnapshot } = await import(workerModuleUrl)
  const first = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_ID}`,
    targetProfileId: PROFILE_ID,
    connectionKey: null,
    targetSnapshot: { active: true, attributes: { b: 2, a: 1 } },
  }
  const second = {
    targetKind: "connection",
    targetKey: "connection:google_chat.management",
    targetProfileId: null,
    connectionKey: "google_chat.management",
    targetSnapshot: { team: "management" },
  }
  const reorderedFirst = {
    targetSnapshot: { attributes: { a: 1, b: 2 }, active: true },
    connectionKey: null,
    targetProfileId: PROFILE_ID,
    targetKey: `profile:${PROFILE_ID}`,
    targetKind: "profile",
  }
  const hashA = hashNotificationTargets([first, second])
  const hashB = hashNotificationTargets([second, reorderedFirst])
  const changedHash = hashNotificationTargets([{ ...first, targetKey: "profile:changed" }, second])

  assert.match(hashA, /^[a-f0-9]{64}$/)
  assert.equal(hashA, hashB, "배열·객체 key 순서가 달라도 같은 target set hash여야 한다")
  assert.notEqual(hashA, changedHash)
  assert.equal(hashA, hashNotificationTargets([first, second]), "A→B→A는 원래 A hash로 돌아와야 한다")

  const input = {
    workflowKey: "tasks",
    payloadSchemaVersion: 1,
    template: {
      titleTemplate: "{담당자}님 새 할 일",
      bodyTemplate: "{업무} 업무를 확인해 주세요.",
      allowedVariables: [
        { key: "assignee_name", token: "담당자", piiClass: "profile_name" },
        { key: "task_title", token: "업무", piiClass: "business_text" },
      ],
      payloadSchemaVersion: 1,
    },
    renderContext: { assignee_name: "김선생", task_title: "교재 확인" },
    href: "/admin/tasks?focus=task-42",
  }
  assert.deepEqual(renderNotificationSnapshot(input), {
    renderedTitle: "김선생님 새 할 일",
    renderedBody: "교재 확인 업무를 확인해 주세요.",
    href: "/admin/tasks?focus=task-42",
  })
  assert.deepEqual(renderNotificationSnapshot(input), renderNotificationSnapshot(clone(input)))

  const invalidInputs = [
    { ...input, payloadSchemaVersion: 2 },
    { ...input, renderContext: { ...input.renderContext, unknown: "금지" } },
    { ...input, renderContext: { assignee_name: "김선생" } },
    { ...input, renderContext: { ...input.renderContext, task_title: "<b>원문 HTML</b>" } },
    { ...input, renderContext: { ...input.renderContext, task_title: "@everyone 호출" } },
    { ...input, href: "https://evil.invalid/admin/tasks" },
    { ...input, href: "//evil.invalid/admin/tasks" },
    { ...input, href: "javascript:alert(1)" },
    { ...input, href: "/admin/withdrawal" },
    { ...input, href: "/login?next=/admin/tasks" },
  ]
  for (const invalid of invalidInputs) {
    assert.throws(
      () => renderNotificationSnapshot(invalid),
      (error) => error?.code === "render_validation_failed",
      "잘못된 렌더 입력은 provider 전에 닫혀야 한다",
    )
  }
})

test("worker는 시작 heartbeat 뒤 정해진 순서로 bounded batch를 처리하고 같은 run ID로 한 번만 성공 종료한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness()
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => null,
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
  })
  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 7, leaseSeconds: 45 })

  assert.deepEqual(result, {
    fanout: 0,
    ruleReconciliation: 0,
    targetReconciliation: 0,
    deliveries: 0,
    reaped: 0,
  })
  assert.deepEqual(harness.calls.map((call) => call.name), [
    "record_notification_worker_heartbeat_v1",
    "claim_notification_fanout_jobs_v1",
    "claim_notification_rule_reconciliation_jobs_v1",
    "claim_notification_target_reconciliation_jobs_v1",
    "reap_notification_leases_v1",
    "claim_notification_deliveries_v1",
    "record_notification_worker_heartbeat_v1",
  ])
  const heartbeats = harness.calls.filter((call) => call.name === "record_notification_worker_heartbeat_v1")
  assert.equal(heartbeats.length, 2)
  assert.deepEqual(heartbeats.map((call) => call.parameters.p_phase), ["started", "succeeded"])
  assert.deepEqual(heartbeats.map((call) => call.parameters.p_run_id), [RUN_ID, RUN_ID])
  for (const heartbeat of heartbeats) {
    assert.deepEqual(heartbeat.parameters.p_counts, {
      fanout: 0,
      rule_reconciliation: 0,
      target_reconciliation: 0,
      deliveries: 0,
      reaped: 0,
    })
    assertNoSensitiveValue(heartbeat.parameters)
  }
  for (const name of [
    "claim_notification_fanout_jobs_v1",
    "claim_notification_rule_reconciliation_jobs_v1",
    "claim_notification_target_reconciliation_jobs_v1",
    "claim_notification_deliveries_v1",
  ]) {
    const call = harness.calls.find((entry) => entry.name === name)
    assert.deepEqual(call.parameters, {
      p_worker_id: "worker-fixture",
      p_batch_size: 7,
      p_lease_seconds: 45,
    })
  }
})

test("worker는 adapter나 선택 reconciler가 없으면 다른 workflow를 추측하지 않고 job을 닫는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness({
    claim_notification_fanout_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000001",
      claim_token: "71000000-0000-4000-8000-000000000002",
      workflow_key: "approvals",
    }],
    claim_notification_rule_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000003",
      claim_token: "71000000-0000-4000-8000-000000000004",
      workflow_key: "tasks",
      cursor: null,
    }],
    claim_notification_target_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000005",
      claim_token: "71000000-0000-4000-8000-000000000006",
      workflow_key: "tasks",
      cursor: null,
    }],
  })
  let providerLookups = 0
  const worker = createNotificationWorkerRuntime({
    getAdapter: (workflowKey) => workflowKey === "tasks" ? createAdapter() : null,
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return null
    },
    createRunId: () => RUN_ID,
  })
  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 3, leaseSeconds: 30 })

  assert.deepEqual(result, {
    fanout: 1,
    ruleReconciliation: 1,
    targetReconciliation: 1,
    deliveries: 0,
    reaped: 0,
  })
  const finishes = harness.calls.filter((call) => call.name === "finish_notification_orchestration_job_v1")
  assert.deepEqual(finishes.map((call) => ({
    kind: call.parameters.p_job_kind,
    disposition: call.parameters.p_disposition,
    errorCode: call.parameters.p_error_code,
  })), [
    { kind: "fanout", disposition: "failed", errorCode: "payload_schema_unsupported" },
    { kind: "rule_reconciliation", disposition: "failed", errorCode: "reconciler_missing" },
    { kind: "target_reconciliation", disposition: "failed", errorCode: "reconciler_missing" },
  ])
  assert.equal(providerLookups, 0)
  for (const finish of finishes) assertNoSensitiveValue(finish.parameters)
})

test("대상 재계산 A→B→A는 live 세대·hash를 apply에 넘겨 superseded로 닫고 렌더·provider를 실행하지 않는다", async () => {
  const { createNotificationWorkerRuntime, hashNotificationTargets } = await import(workerModuleUrl)
  const liveTarget = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_ID}`,
    targetProfileId: PROFILE_ID,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_ID },
  }
  const liveHash = hashNotificationTargets([liveTarget])
  const capturedHash = "b".repeat(64)
  const harness = createRpcHarness({
    claim_notification_target_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000090",
      claim_token: "71000000-0000-4000-8000-000000000091",
      workflow_key: "registration",
      source_type: "registration_appointment",
      source_id: "71000000-0000-4000-8000-000000000092",
      source_revision: "7",
      source_event_id: "71000000-0000-4000-8000-000000000093",
      reconciliation_kind: "recipient_set_changed",
      target_generation: "2",
      previous_target_set_hash: liveHash,
      current_target_set_hash: capturedHash,
      cursor: null,
    }],
    apply_notification_target_reconciliation_batch_v1: {
      outcome: "superseded",
      canceled_count: 0,
      delivery_count: 0,
      revoked_count: 0,
    },
  })
  let renderCalls = 0
  let providerLookups = 0
  const adapter = createAdapter({
    workflowKey: "registration",
    async reconcileTargets() {
      return {
        sourceRevision: "7",
        targetGeneration: "3",
        targetSetHash: liveHash,
        items: [{
          eventId: EVENT_ID,
          rule: {
            ruleId: RULE_ID,
            ruleRevision: "21",
            templateId: TEMPLATE_ID,
            audienceKey: "track_director",
            channelKey: "in_app",
            connectionKey: null,
            ruleVariantKey: "visit_previous_day_at",
          },
          scheduledFor: "2026-07-22T05:00:00.000Z",
          targetSet: {
            targetGeneration: "3",
            targetSetHash: liveHash,
            targets: [liveTarget],
          },
        }],
        nextCursor: null,
        done: true,
      }
    },
    async buildRenderContext() {
      renderCalls += 1
      return {}
    },
    async buildDeepLink() {
      renderCalls += 1
      return "/admin/registration"
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: (workflowKey) => workflowKey === "registration" ? adapter : null,
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return null
    },
    createRunId: () => RUN_ID,
  })

  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(result.targetReconciliation, 1)
  const apply = harness.calls.find((call) => call.name === "apply_notification_target_reconciliation_batch_v1")
  assert.deepEqual(apply.parameters.p_batch, {
    source_revision: "7",
    target_generation: "3",
    target_set_hash: liveHash,
    deliveries: [],
  })
  assert.equal(harness.calls.some((call) => call.name === "get_notification_render_snapshot_v1"), false)
  assert.equal(renderCalls, 0)
  assert.equal(providerLookups, 0)
  const finish = harness.calls.find((call) => call.name === "finish_notification_orchestration_job_v1")
  assert.equal(finish.parameters.p_disposition, "succeeded")
  assert.equal(finish.parameters.p_outcome_summary.outcome, "superseded")
})

test("대상 재계산 정상 경로는 같은 source revision의 전체 target을 렌더해 정확한 apply batch만 만든다", async () => {
  const { createNotificationWorkerRuntime, hashNotificationTargets } = await import(workerModuleUrl)
  const sourceId = "71000000-0000-4000-8000-000000000192"
  const jobId = "71000000-0000-4000-8000-000000000190"
  const claimToken = "71000000-0000-4000-8000-000000000191"
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_ID}`,
    targetProfileId: PROFILE_ID,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_ID },
  }
  const targetSetHash = hashNotificationTargets([target])
  const rule = {
    ruleId: RULE_ID,
    ruleRevision: BIG_REVISION,
    templateId: TEMPLATE_ID,
    audienceKey: "track_director",
    channelKey: "in_app",
    connectionKey: null,
    ruleVariantKey: "same_day_at",
  }
  const harness = createRpcHarness({
    claim_notification_target_reconciliation_jobs_v1: [{
      job_id: jobId,
      claim_token: claimToken,
      workflow_key: "registration",
      source_type: "registration_appointment",
      source_id: sourceId,
      source_revision: BIG_REVISION,
      source_event_id: "71000000-0000-4000-8000-000000000193",
      reconciliation_kind: "recipient_set_changed",
      target_generation: TARGET_GENERATION,
      previous_target_set_hash: "a".repeat(64),
      current_target_set_hash: targetSetHash,
      cursor: null,
    }],
    get_notification_render_snapshot_v1: {
      event: {
        event_id: EVENT_ID,
        workflow_key: "registration",
        event_key: "registration.appointment_reminder_due",
        source_type: "registration_appointment",
        source_id: sourceId,
        source_revision: BIG_REVISION,
        occurrence_key: "registration:fixture",
        occurred_at: "2026-07-22T05:00:00.000Z",
        payload_schema_version: 2,
        payload: { fixture: true },
      },
      rule: {
        rule_id: RULE_ID,
        rule_revision: BIG_REVISION,
        template_id: TEMPLATE_ID,
        audience_key: "track_director",
        channel_key: "in_app",
        connection_key: null,
        rule_variant_key: "same_day_at",
      },
      template: {
        title_template: "{학생} 예약",
        body_template: "{장소}",
        allowed_variables: [
          { key: "student_name", token: "학생", pii_class: "student_name" },
          { key: "place", token: "장소", pii_class: "business_text" },
        ],
        payload_schema_version: 2,
      },
    },
    apply_notification_target_reconciliation_batch_v1: {
      outcome: "applied",
      canceled_count: 1,
      delivery_count: 1,
      revoked_count: 0,
    },
  })
  let providerLookups = 0
  const adapter = createAdapter({
    workflowKey: "registration",
    async reconcileTargets() {
      return {
        sourceRevision: BIG_REVISION,
        targetGeneration: TARGET_GENERATION,
        targetSetHash,
        items: [{
          eventId: EVENT_ID,
          rule,
          scheduledFor: "2026-07-22T05:00:00.000Z",
          targetSet: { targetGeneration: TARGET_GENERATION, targetSetHash, targets: [target] },
        }],
        nextCursor: null,
        done: true,
      }
    },
    async buildRenderContext() {
      return { student_name: "김학생", place: "3층 테스트실" }
    },
    async buildDeepLink() {
      return `/admin/registration?taskId=fixture&appointmentId=${sourceId}&view=calendar`
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: (workflowKey) => workflowKey === "registration" ? adapter : null,
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return null
    },
    createRunId: () => RUN_ID,
  })

  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(result.targetReconciliation, 1)
  const apply = harness.calls.find((call) => call.name === "apply_notification_target_reconciliation_batch_v1")
  assert.deepEqual(apply.parameters, {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_expected_cursor: null,
    p_batch: {
      source_revision: BIG_REVISION,
      target_generation: TARGET_GENERATION,
      target_set_hash: targetSetHash,
      deliveries: [{
        event_id: EVENT_ID,
        rule_id: RULE_ID,
        rule_revision: BIG_REVISION,
        template_id: TEMPLATE_ID,
        target_kind: "profile",
        target_key: `profile:${PROFILE_ID}`,
        target_profile_id: PROFILE_ID,
        connection_key: null,
        target_snapshot: { profile_id: PROFILE_ID },
        rendered_title: "김학생 예약",
        rendered_body: "3층 테스트실",
        href: `/admin/registration?taskId=fixture&appointmentId=${sourceId}&view=calendar`,
        scheduled_for: "2026-07-22T05:00:00.000Z",
      }],
    },
    p_next_cursor: null,
    p_done: true,
  })
  assert.equal(providerLookups, 0)
})

test("빈 대상 재계산 batch도 64자리 소문자 hash가 아니면 apply 전에 실패 폐쇄한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness({
    claim_notification_target_reconciliation_jobs_v1: [{
      job_id: "71000000-0000-4000-8000-000000000290",
      claim_token: "71000000-0000-4000-8000-000000000291",
      workflow_key: "registration",
      source_type: "registration_appointment",
      source_id: "71000000-0000-4000-8000-000000000292",
      source_revision: "7",
      source_event_id: "71000000-0000-4000-8000-000000000293",
      reconciliation_kind: "recipient_set_changed",
      target_generation: "2",
      previous_target_set_hash: "a".repeat(64),
      current_target_set_hash: "b".repeat(64),
      cursor: null,
    }],
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter({
      workflowKey: "registration",
      async reconcileTargets() {
        return {
          sourceRevision: "7",
          targetGeneration: "2",
          targetSetHash: "NOT-A-HASH",
          items: [],
          nextCursor: null,
          done: true,
        }
      },
    }),
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
  })
  await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(
    harness.calls.some((call) => call.name === "apply_notification_target_reconciliation_batch_v1"),
    false,
  )
  const finish = harness.calls.find((call) => (
    call.name === "finish_notification_orchestration_job_v1"
    && call.parameters.p_job_kind === "target_reconciliation"
  ))
  assert.equal(finish.parameters.p_disposition, "failed")
  assert.equal(finish.parameters.p_error_code, "payload_schema_unsupported")
})

test("worker fanout은 한 규칙을 렌더한 뒤 service-role apply에만 전달하고 finish에는 안전한 집계만 남긴다", async () => {
  const {
    createNotificationWorkerRuntime,
    hashNotificationTargets,
  } = await import(workerModuleUrl)
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_ID}`,
    targetProfileId: PROFILE_ID,
    connectionKey: null,
    targetSnapshot: { role: "staff", active: true },
  }
  const targetSetHash = hashNotificationTargets([target])
  const fanoutJob = {
    job_id: "71000000-0000-4000-8000-000000000101",
    claim_token: "71000000-0000-4000-8000-000000000102",
    workflow_key: "tasks",
    event_id: EVENT_ID,
    event_key: "task.created",
    source_type: "ops_task",
    source_id: "task-42",
    source_revision: BIG_REVISION,
    occurrence_key: "task:42:created",
    occurred_at: "2026-07-17T01:00:00.000Z",
    scheduled_for: "2026-07-17T01:00:00.000Z",
    payload_schema_version: 1,
    payload: { assignee_name: "김선생", task_title: "교재 확인" },
    rule_id: RULE_ID,
    rule_revision: BIG_REVISION,
    template_id: TEMPLATE_ID,
    channel_key: "in_app",
    audience_key: "primary_assignee",
    rule_variant_key: "immediate",
    title_template: "{담당자}님 새 할 일",
    body_template: "{업무} 업무를 확인해 주세요.",
    allowed_variables: [
      { key: "assignee_name", token: "담당자", pii_class: "profile_name" },
      { key: "task_title", token: "업무", pii_class: "business_text" },
    ],
    template_payload_schema_version: 1,
    cursor: null,
    next_cursor: null,
    last_rule: true,
  }
  const harness = createRpcHarness({
    claim_notification_fanout_jobs_v1: [fanoutJob],
    apply_notification_fanout_batch_v1: {
      outcome: "applied",
      delivery_count: 1,
    },
  })
  const adapter = createAdapter({
    async resolveTargets() {
      return {
        targetGeneration: TARGET_GENERATION,
        targetSetHash,
        targets: [target],
      }
    },
    async buildRenderContext() {
      return { assignee_name: "김선생", task_title: "교재 확인" }
    },
    async buildDeepLink() {
      return "/admin/tasks?focus=task-42"
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => adapter,
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
  })

  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(result.fanout, 1)
  const apply = harness.calls.find((call) => (
    call.name === "apply_notification_fanout_batch_v1"
  ))
  assert.deepEqual(apply.parameters, {
    p_job_id: fanoutJob.job_id,
    p_claim_token: fanoutJob.claim_token,
    p_expected_cursor: null,
    p_rule_id: RULE_ID,
    p_rule_revision: BIG_REVISION,
    p_target_generation: TARGET_GENERATION,
    p_target_set_hash: targetSetHash,
    p_batch: {
      deliveries: [{
        template_id: TEMPLATE_ID,
        target_kind: "profile",
        target_key: `profile:${PROFILE_ID}`,
        target_profile_id: PROFILE_ID,
        connection_key: null,
        target_snapshot: { role: "staff", active: true },
        rendered_title: "김선생님 새 할 일",
        rendered_body: "교재 확인 업무를 확인해 주세요.",
        href: "/admin/tasks?focus=task-42",
        scheduled_for: "2026-07-17T01:00:00.000Z",
      }],
    },
    p_next_cursor: null,
    p_done: true,
  })
  const finish = harness.calls.find((call) => (
    call.name === "finish_notification_orchestration_job_v1"
  ))
  assert.equal(finish.parameters.p_disposition, "succeeded")
  assert.deepEqual(finish.parameters.p_outcome_summary, {
    outcome: "applied",
    delivery_count: 1,
    done: true,
  })
  assert.doesNotMatch(
    JSON.stringify(finish.parameters.p_outcome_summary),
    /target|rendered|title|body|href|payload/i,
  )
})

test("worker fanout은 중간 규칙이 superseded여도 다음 cursor를 재시도하고 뒤 규칙을 건너뛰지 않는다", async () => {
  const {
    createNotificationWorkerRuntime,
    hashNotificationTargets,
  } = await import(workerModuleUrl)
  const targetSetHash = hashNotificationTargets([])
  const fanoutJob = {
    job_id: "71000000-0000-4000-8000-000000000111",
    claim_token: "71000000-0000-4000-8000-000000000112",
    workflow_key: "tasks",
    event_id: EVENT_ID,
    event_key: "task.created",
    source_type: "ops_task",
    source_id: "task-42",
    source_revision: BIG_REVISION,
    occurrence_key: "task:42:created",
    occurred_at: "2026-07-17T01:00:00.000Z",
    scheduled_for: "2026-07-17T01:00:00.000Z",
    payload_schema_version: 1,
    payload: { assignee_name: "김선생", task_title: "교재 확인" },
    rule_id: RULE_ID,
    rule_revision: BIG_REVISION,
    template_id: TEMPLATE_ID,
    channel_key: "in_app",
    audience_key: "primary_assignee",
    rule_variant_key: "immediate",
    title_template: "{담당자}님 새 할 일",
    body_template: "{업무} 업무를 확인해 주세요.",
    allowed_variables: [
      { key: "assignee_name", token: "담당자", pii_class: "profile_name" },
      { key: "task_title", token: "업무", pii_class: "business_text" },
    ],
    template_payload_schema_version: 1,
    cursor: null,
    next_cursor: "1",
    last_rule: false,
  }
  const harness = createRpcHarness({
    claim_notification_fanout_jobs_v1: [fanoutJob],
    apply_notification_fanout_batch_v1: {
      outcome: "superseded",
      delivery_count: 0,
    },
  })
  const adapter = createAdapter({
    async resolveTargets() {
      return { targetGeneration: "0", targetSetHash, targets: [] }
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => adapter,
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })
  const apply = harness.calls.find((call) => call.name === "apply_notification_fanout_batch_v1")
  assert.equal(apply.parameters.p_target_generation, "0")
  assert.equal(apply.parameters.p_next_cursor, "1")
  assert.equal(apply.parameters.p_done, false)
  const finish = harness.calls.find((call) => (
    call.name === "finish_notification_orchestration_job_v1"
  ))
  assert.equal(finish.parameters.p_disposition, "retry")
  assert.equal(finish.parameters.p_next_attempt_at, "2026-07-17T01:00:05.000Z")
  assert.deepEqual(finish.parameters.p_outcome_summary, {
    outcome: "superseded",
    delivery_count: 0,
    done: false,
  })
})

test("worker는 adapter 선검증 취소를 begin-send보다 먼저 확정하고 provider를 0회 호출한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const claim = createDeliveryClaim()
  let revalidationInput = null
  let providerLookups = 0
  const adapter = createAdapter({
    async revalidateBeforeSend(input) {
      revalidationInput = clone(input)
      return { ok: false, status: "canceled", reason: "recipient_revoked" }
    },
  })
  const harness = createRpcHarness({ claim_notification_deliveries_v1: [claim] })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => adapter,
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return null
    },
    createRunId: () => RUN_ID,
  })
  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })

  assert.equal(result.deliveries, 1)
  assert.deepEqual(revalidationInput, {
    eventId: EVENT_ID,
    deliveryId: DELIVERY_ID,
    eventKey: "task.created",
    sourceType: "ops_task",
    sourceId: "task-42",
    sourceRevision: BIG_REVISION,
    ruleId: RULE_ID,
    ruleRevision: BIG_REVISION,
    targetGeneration: TARGET_GENERATION,
    scheduledFor: "2026-07-17T01:00:00.000Z",
    target: {
      targetKind: "profile",
      targetKey: `profile:${PROFILE_ID}`,
      targetProfileId: PROFILE_ID,
      connectionKey: "google_chat.management",
      targetSnapshot: { role: "staff", active: true },
    },
  })
  assert.equal(harness.calls.some((call) => call.name === "begin_notification_delivery_send_v1"), false)
  assert.equal(providerLookups, 0)
  const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
  assert.equal(finalize.parameters.p_status, "canceled")
  assert.equal(finalize.parameters.p_status_reason, "recipient_revoked")
  assert.equal(finalize.parameters.p_provider_message_id, null)
  assert.equal(finalize.parameters.p_provider_response_code, null)
  assertNoSensitiveValue(finalize.parameters)
})

test("전자결재의 비활성 수신자 재검증은 실제 승인 adapter 경로에서 provider를 0회 호출한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const { createApprovalsNotificationAdapter } = await import(approvalAdapterModuleUrl)
  const sourceId = "70000000-0000-4000-8000-000000000071"
  let authoritativeInput = null
  let providerLookups = 0
  const adapter = createApprovalsNotificationAdapter({
    async revalidateAuthoritativeSource(input) {
      authoritativeInput = clone(input)
      return { ok: false, status: "canceled", reason: "recipient_revoked" }
    },
  })
  const claim = createDeliveryClaim({
    workflow_key: "approvals",
    event_key: "approval.submitted",
    source_type: "approval_event",
    source_id: sourceId,
    source_revision: null,
    target_generation: "0",
    channel_key: "web_push",
    target: {
      target_kind: "profile",
      target_key: `profile:${PROFILE_ID}`,
      target_profile_id: PROFILE_ID,
      connection_key: null,
      target_snapshot: { profile_id: PROFILE_ID },
    },
  })
  const harness = createRpcHarness({ claim_notification_deliveries_v1: [claim] })
  const worker = createNotificationWorkerRuntime({
    getAdapter: (workflowKey) => workflowKey === "approvals" ? adapter : null,
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return {
        async send() {
          throw new Error("비활성 전자결재 수신자에게 provider를 호출하면 안 됩니다.")
        },
      }
    },
    createRunId: () => RUN_ID,
  })

  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 2, leaseSeconds: 30 })

  assert.equal(result.deliveries, 1)
  assert.equal(authoritativeInput.workflowKey, "approvals")
  assert.equal(authoritativeInput.eventKey, "approval.submitted")
  assert.equal(authoritativeInput.sourceType, "approval_event")
  assert.equal(authoritativeInput.sourceId, sourceId)
  assert.equal(authoritativeInput.sourceRevision, null)
  assert.equal(authoritativeInput.targetGeneration, "0")
  assert.equal(providerLookups, 0)
  assert.equal(harness.calls.some((call) => call.name === "begin_notification_delivery_send_v1"), false)
  const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
  assert.equal(finalize.parameters.p_status, "canceled")
  assert.equal(finalize.parameters.p_status_reason, "recipient_revoked")
  assert.equal(finalize.parameters.p_provider_message_id, null)
  assert.equal(finalize.parameters.p_provider_response_code, null)
  assertNoSensitiveValue(finalize.parameters)
})

test("worker는 begin-send가 돌려준 canonical context 하나만 provider에 넘기고 unknown을 자동 재시도하지 않는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const begunContext = createBegunGoogleChatContext()
  const timeline = []
  let providerInput = null
  const harness = createRpcHarness({
    claim_notification_deliveries_v1: [createDeliveryClaim()],
    prepare_notification_immediate_delivery_v1: async () => {
      timeline.push("prepare")
      return begunContext
    },
    register_notification_external_attempt_v1: async () => {
      timeline.push("register")
      return {
        allowed: true,
        attempt_id: "70000000-0000-4000-8000-000000000011",
      }
    },
    finalize_notification_delivery_v1: async () => {
      timeline.push("finalize")
      return { ok: true }
    },
  })
  const provider = {
    async send(input) {
      timeline.push("provider")
      providerInput = input
      return {
        status: "delivery_unknown",
        statusReason: "provider_timeout_after_dispatch",
        providerMessageId: null,
        providerResponseCode: null,
        errorCode: "provider_timeout",
        errorSummary: "provider result unavailable",
        nextAttemptAt: null,
      }
    },
  }
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter(),
    rpc: harness.rpc,
    getProvider: (channelKey) => channelKey === "google_chat" ? provider : null,
    createRunId: () => RUN_ID,
  })
  const result = await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })

  assert.equal(result.deliveries, 1)
  assert.deepEqual(timeline, ["prepare", "register", "provider", "finalize"])
  assert.deepEqual(providerInput, begunContext)
  const prepare = harness.calls.find((call) => (
    call.name === "prepare_notification_immediate_delivery_v1"
  ))
  assert.deepEqual(prepare.parameters, {
    p_workflow_key: "tasks",
    p_event_id: EVENT_ID,
    p_delivery_id: DELIVERY_ID,
    p_claim_token: CLAIM_TOKEN,
    p_event_key: "task.created",
    p_source_type: "ops_task",
    p_source_id: "task-42",
    p_source_revision: BIG_REVISION,
    p_rule_id: RULE_ID,
    p_rule_revision: BIG_REVISION,
    p_target_generation: TARGET_GENERATION,
    p_scheduled_for: "2026-07-17T01:00:00.000Z",
    p_target: {
      target_kind: "profile",
      target_key: `profile:${PROFILE_ID}`,
      target_profile_id: PROFILE_ID,
      connection_key: "google_chat.management",
      target_snapshot: { role: "staff", active: true },
    },
  })
  assert.equal(harness.calls.some((call) => call.name === "begin_notification_delivery_send_v1"), false)
  assert.equal(harness.calls.some((call) => call.name === "commit_notification_in_app_delivery_v1"), false)
  const attempt = harness.calls.find((call) => (
    call.name === "register_notification_external_attempt_v1"
  ))
  assert.deepEqual(attempt.parameters, {
    p_delivery_id: DELIVERY_ID,
    p_claim_id: null,
    p_owner_generation: null,
    p_claim_token: CLAIM_TOKEN,
    p_dispatch_token: DISPATCH_TOKEN,
    p_request_id: DISPATCH_TOKEN,
  })
  const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
  assert.equal(finalize.parameters.p_status, "delivery_unknown")
  assert.equal(finalize.parameters.p_status_reason, "provider_timeout_after_dispatch")
  assert.equal(finalize.parameters.p_next_attempt_at, null)
  assert.equal(
    harness.calls.filter((call) => call.name === "claim_notification_deliveries_v1").length,
    1,
  )
  assertNoSensitiveValue(finalize.parameters)
})

test("worker는 in-app 재검증과 투영을 단일 원자 prepare RPC로 처리한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  let providerLookups = 0
  const harness = createRpcHarness({
    claim_notification_deliveries_v1: [createDeliveryClaim({
      channel_key: "in_app",
      target: {
        target_kind: "profile",
        target_key: `profile:${PROFILE_ID}`,
        target_profile_id: PROFILE_ID,
        connection_key: null,
        target_snapshot: { role: "staff", active: true },
      },
    })],
    prepare_notification_immediate_delivery_v1: {
      delivery_id: DELIVERY_ID,
      notification_id: "72000000-0000-4000-8000-000000000001",
      push_children_created: 2,
      status: "sent",
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter(),
    rpc: harness.rpc,
    getProvider: () => {
      providerLookups += 1
      return null
    },
    createRunId: () => RUN_ID,
  })
  await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })

  assert.equal(providerLookups, 0)
  assert.equal(harness.calls.some((call) => call.name === "begin_notification_delivery_send_v1"), false)
  assert.equal(harness.calls.some((call) => call.name === "commit_notification_in_app_delivery_v1"), false)
  assert.equal(harness.calls.some((call) => call.name === "finalize_notification_delivery_v1"), false)
  assert.equal(harness.calls.some((call) => call.name === "register_notification_external_attempt_v1"), false)
  const prepare = harness.calls.find((call) => (
    call.name === "prepare_notification_immediate_delivery_v1"
  ))
  assert.equal(prepare.parameters.p_delivery_id, DELIVERY_ID)
  assert.equal(prepare.parameters.p_claim_token, CLAIM_TOKEN)
})

test("worker는 외부 시도 등록 거부 또는 응답 불명확 시 provider를 0회 호출하고 unknown으로 닫는다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  for (const fixture of [
    { name: "denied", responder: { allowed: false, reason: "attempt_already_registered" } },
    { name: "rpc_error", responder: () => { throw new Error("registrar response lost") } },
  ]) {
    let providerCalls = 0
    const harness = createRpcHarness({
      claim_notification_deliveries_v1: [createDeliveryClaim()],
      register_notification_external_attempt_v1: fixture.responder,
    })
    const worker = createNotificationWorkerRuntime({
      getAdapter: () => createAdapter(),
      rpc: harness.rpc,
      getProvider: () => ({
        async send() {
          providerCalls += 1
          throw new Error("외부 시도 등록 실패 뒤 provider를 호출하면 안 됩니다.")
        },
      }),
      createRunId: () => RUN_ID,
    })

    await worker.runBatch({ workerId: `worker-${fixture.name}`, batchSize: 1, leaseSeconds: 30 })
    assert.equal(providerCalls, 0)
    const finalize = harness.calls.find((call) => call.name === "finalize_notification_delivery_v1")
    assert.equal(finalize.parameters.p_status, "delivery_unknown")
    assert.equal(finalize.parameters.p_status_reason, "provider_ambiguous_response")
    assert.equal(finalize.parameters.p_next_attempt_at, null)
    assertNoSensitiveValue(finalize.parameters)
  }
})

test("forward 외부 시도 등록기는 dispatch identity를 검증하고 중복을 감사한 뒤 fail-closed한다", async () => {
  const forward = await readFile(workerForwardMigrationUrl, "utf8")
  const register = functionBlock(forward, "register_notification_external_attempt_v1")

  assert.match(register, /auth\.role\(\)[\s\S]*service_role/i)
  assert.match(register, /p_request_id\s*<>\s*p_dispatch_token/i)
  assert.match(register, /status\s*<>\s*'sending'/i)
  assert.match(register, /state\s*<>\s*'dispatch_started'/i)
  assert.match(register, /dispatch_token\s*<>\s*p_dispatch_token/i)
  assert.match(
    register,
    /v_entity_id\s*:=\s*v_claim\.id::text[\s\S]*notification_sha256_hex_v1\(p_dispatch_token::text\)/i,
  )
  assert.doesNotMatch(register, /v_entity_id\s*:=\s*v_claim\.id::text\s*\|\|\s*':'\s*\|\|\s*v_claim\.owner_generation::text/i)
  assert.match(register, /external_attempt_registered/i)
  assert.match(register, /duplicate_external_attempt/i)
  assert.match(register, /'allowed',\s*false/i)
  assert.doesNotMatch(register, /webhook_url|endpoint|rendered_title|rendered_body|phone|recipient/i)
})

test("forward prepare RPC는 가변 원본·수신자·delivery를 잠근 같은 트랜잭션에서 재검증 후 commit 또는 begin한다", async () => {
  const forward = await readFile(workerForwardMigrationUrl, "utf8")
  const prepare = functionBlock(forward, "prepare_notification_immediate_delivery_v1")

  assert.match(prepare, /auth\.role\(\)[\s\S]*service_role/i)
  assert.match(prepare, /notification_runtime_flags[\s\S]*for\s+share/i)
  assert.match(prepare, /ops_tasks[\s\S]*for\s+share/i)
  assert.match(prepare, /makeup_requests[\s\S]*for\s+share/i)
  assert.match(prepare, /approval_requests[\s\S]*for\s+share/i)
  assert.match(prepare, /ops_registration_appointments[\s\S]*for\s+share/i)
  assert.match(prepare, /ops_registration_consultations[\s\S]*for\s+share/i)
  assert.match(prepare, /auth\.users[\s\S]*for\s+share/i)
  assert.match(prepare, /profiles[\s\S]*for\s+share/i)
  assert.match(prepare, /teacher_catalogs[\s\S]*for\s+share/i)
  assert.match(prepare, /is_active_registration_director/i)
  assert.match(prepare, /notification_deliveries[\s\S]*for\s+update/i)
  assert.match(prepare, /revalidate_immediate_notification_delivery_v1/i)
  assert.match(prepare, /commit_notification_in_app_delivery_v1/i)
  assert.match(prepare, /begin_notification_delivery_send_v1/i)

  const sourceLock = prepare.indexOf("from public.ops_tasks")
  const deliveryLock = prepare.indexOf("select delivery.* into v_delivery")
  const sideEffect = Math.min(
    prepare.indexOf("commit_notification_in_app_delivery_v1"),
    prepare.indexOf("begin_notification_delivery_send_v1"),
  )
  assert.ok(sourceLock >= 0 && sourceLock < deliveryLock && deliveryLock < sideEffect)
  const flagLock = prepare.indexOf("from dashboard_private.notification_runtime_flags")
  const ownerLock = prepare.lastIndexOf("from dashboard_private.notification_cutover_owners")
  assert.ok(flagLock >= 0 && flagLock < ownerLock, "활성화와 같은 flag→owner 순서로 잠가야 한다")

  const appointmentBranch = prepare.slice(
    prepare.indexOf("elsif p_source_type = 'registration_appointment'"),
    prepare.indexOf("elsif p_source_type = 'ops_registration_message'"),
  )
  const appointmentOrder = [
    "from public.ops_tasks",
    "from public.ops_registration_details",
    "from public.ops_registration_subject_tracks",
    "select appointment.* into v_appointment",
    "from public.ops_registration_level_tests",
    "from public.ops_registration_consultations",
  ].map((needle) => appointmentBranch.indexOf(needle))
  assert.ok(appointmentOrder.every((index) => index >= 0))
  assert.deepEqual([...appointmentOrder].sort((left, right) => left - right), appointmentOrder)
})

test("forward prepare RPC는 등록 예약 알림의 revision·수신자·현재 예약시각을 원자 재확인한다", async () => {
  const forward = await readFile(workerForwardMigrationUrl, "utf8")
  const prepare = functionBlock(forward, "prepare_notification_immediate_delivery_v1")

  assert.match(prepare, /registration\.appointment_reminder_due/i)
  assert.match(prepare, /appointment\.status\s*<>\s*'scheduled'/i)
  assert.match(prepare, /appointment\.notification_revision\s*<>\s*p_source_revision/i)
  assert.match(prepare, /appointment\.recipient_revision\s*<>\s*p_target_generation/i)
  assert.match(
    prepare,
    /kind\s*=\s*'visit_consultation'[\s\S]*audience_key\s*=\s*'management_team'[\s\S]*channel_key\s*=\s*'google_chat'/i,
  )
  assert.match(prepare, /calculate_registration_reminder_schedule_v1/i)
  assert.match(prepare, /clock_timestamp\(\)\s*<\s*v_appointment\.scheduled_at/i)
  const reminderBranch = prepare.slice(
    prepare.indexOf("if p_workflow_key = 'registration'"),
    prepare.indexOf("else\n    v_revalidation := public.revalidate_immediate_notification_delivery_v1"),
  )
  assert.doesNotMatch(reminderBranch, /v_event\.payload\s*->>\s*'notification_revision'/i)
  assert.doesNotMatch(reminderBranch, /v_event\.payload\s*->>\s*'recipient_revision'/i)
})

test("forward prepare RPC의 원자 재검증 실패 응답은 provider context 없이 delivery를 종결한다", async () => {
  const forward = await readFile(workerForwardMigrationUrl, "utf8")
  const prepare = functionBlock(forward, "prepare_notification_immediate_delivery_v1")
  const invalidBranch = prepare.slice(
    prepare.indexOf("if coalesce((v_revalidation ->> 'ok')::boolean, false) is not true"),
    prepare.indexOf("if v_delivery.channel_key = 'in_app'"),
  )

  assert.match(invalidBranch, /finalize_notification_delivery_v1/i)
  assert.match(invalidBranch, /'prepared',\s*false/i)
  assert.doesNotMatch(invalidBranch, /webhook_url|subscription|customer_endpoint|rendered_body/i)
})

test("worker 실패 heartbeat는 started와 failed 한 쌍만 남기고 오류 원문·payload·비밀정보를 버린다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness({
    claim_notification_fanout_jobs_v1: async () => {
      throw new Error(`database unavailable ${GOOGLE_CHAT_URL}`)
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => null,
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
  })

  await assert.rejects(
    worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 }),
  )
  const heartbeats = harness.calls.filter((call) => call.name === "record_notification_worker_heartbeat_v1")
  assert.equal(heartbeats.length, 2)
  assert.deepEqual(heartbeats.map((call) => call.parameters.p_phase), ["started", "failed"])
  assert.deepEqual(heartbeats.map((call) => call.parameters.p_run_id), [RUN_ID, RUN_ID])
  assert.match(heartbeats[1].parameters.p_error_code, /^[a-z0-9_]{1,64}$/)
  assertNoSensitiveValue(heartbeats[1].parameters)
  assertExactKeys(heartbeats[1].parameters.p_counts, [
    "fanout",
    "rule_reconciliation",
    "target_reconciliation",
    "deliveries",
    "reaped",
  ], "실패 heartbeat도 닫힌 숫자 count map만 가져야 한다")
})

test("worker는 malformed claim을 추측 처리하지 않고 실패 heartbeat와 함께 fail-closed한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const harness = createRpcHarness({
    claim_notification_fanout_jobs_v1: [{
      job_id: "잘못된-job-id",
      claim_token: "71000000-0000-4000-8000-000000000122",
      workflow_key: "tasks",
    }],
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter(),
    rpc: harness.rpc,
    getProvider: () => null,
    createRunId: () => RUN_ID,
  })

  await assert.rejects(
    worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 }),
    (error) => error?.code === "worker_envelope_invalid",
  )
  const heartbeats = harness.calls.filter((call) => (
    call.name === "record_notification_worker_heartbeat_v1"
  ))
  assert.deepEqual(heartbeats.map((call) => call.parameters.p_phase), ["started", "failed"])
  assert.equal(
    harness.calls.some((call) => call.name === "finish_notification_orchestration_job_v1"),
    false,
  )
  assertNoSensitiveValue(heartbeats[1].parameters)
})

test("Google Chat provider는 주입 fetch만 쓰고 확정 성공·429·영구 거절·timeout/reset을 닫힌 결과로 분류한다", async () => {
  const { createGoogleChatProvider } = await import(googleChatProviderModuleUrl)
  const ledger = []
  const responses = [
    new Response(JSON.stringify({ name: "spaces/fixture/messages/message-1", text: "응답 원문 비노출" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(`rate limited token-secret ${GOOGLE_CHAT_URL}`, { status: 429 }),
    new Response("definite rejection token-secret", { status: 400 }),
    Object.assign(new Error(`timeout after dispatch ${GOOGLE_CHAT_URL}`), { code: "ETIMEDOUT" }),
    Object.assign(new Error(`reset after dispatch ${GOOGLE_CHAT_URL}`), { code: "ECONNRESET" }),
  ]
  const provider = createGoogleChatProvider({
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      ledger.push({ url, init: clone(init) })
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    },
  })

  assert.equal(provider.send.length, 1, "provider send는 begun context 한 인자만 받아야 한다")
  assertProviderResult(await provider.send(createBegunGoogleChatContext()), "sent", null)
  assertProviderResult(
    await provider.send(createBegunGoogleChatContext()),
    "retry_wait",
    "provider_rate_limited",
  )
  assertProviderResult(
    await provider.send(createBegunGoogleChatContext()),
    "failed",
    "provider_definite_rejection",
  )
  assertProviderResult(
    await provider.send(createBegunGoogleChatContext()),
    "delivery_unknown",
    "provider_timeout_after_dispatch",
  )
  assertProviderResult(
    await provider.send(createBegunGoogleChatContext()),
    "delivery_unknown",
    "connection_reset_after_dispatch",
  )
  assert.equal(ledger.length, 5)
  assert.deepEqual(new Set(ledger.map(({ url }) => new URL(url).host)), new Set(["chat.googleapis.com"]))
  assert.equal(unexpectedNetworkCalls, 0)

  const callsBeforeMissing = ledger.length
  assertProviderResult(
    await provider.send(createBegunGoogleChatContext({ webhook_url: null })),
    "failed",
    "connection_missing",
  )
  assert.equal(ledger.length, callsBeforeMissing, "연결이 없으면 fixture transport도 호출하면 안 된다")
})

test("Google Chat 5xx는 수락 여부가 불명하므로 unknown으로 닫히고 다음 worker에서 자동 재발송하지 않는다", async () => {
  const { createGoogleChatProvider } = await import(googleChatProviderModuleUrl)
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const secondClaimToken = "70000000-0000-4000-8000-000000000021"
  const secondDispatchToken = "70000000-0000-4000-8000-000000000022"
  let deliveryStatus = "pending"
  let claimIndex = 0
  let externalCalls = 0
  const claimTokens = [CLAIM_TOKEN, secondClaimToken]
  const dispatchTokens = [DISPATCH_TOKEN, secondDispatchToken]
  const harness = createRpcHarness({
    claim_notification_deliveries_v1: () => {
      if (!["pending", "retry_wait"].includes(deliveryStatus)) return []
      deliveryStatus = "claimed"
      return [createDeliveryClaim({ claim_token: claimTokens[claimIndex] })]
    },
    prepare_notification_immediate_delivery_v1: (parameters) => createBegunGoogleChatContext({
      claim_token: parameters.p_claim_token,
      dispatch_token: dispatchTokens[claimIndex],
    }),
    register_notification_external_attempt_v1: () => ({
      allowed: true,
      attempt_id: "70000000-0000-4000-8000-000000000023",
    }),
    finalize_notification_delivery_v1: (parameters) => {
      deliveryStatus = parameters.p_status
      if (deliveryStatus === "retry_wait") claimIndex += 1
      return { ok: true }
    },
  })
  const provider = createGoogleChatProvider({
    fetch: async () => {
      externalCalls += 1
      return new Response("ambiguous upstream failure", { status: 500 })
    },
  })
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter(),
    rpc: harness.rpc,
    getProvider: (channelKey) => channelKey === "google_chat" ? provider : null,
    createRunId: () => RUN_ID,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  })

  await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })
  await worker.runBatch({ workerId: "worker-fixture", batchSize: 1, leaseSeconds: 30 })

  assert.equal(externalCalls, 1, "5xx 응답 뒤 새 dispatch token으로 자동 재발송하면 안 된다")
  assert.equal(deliveryStatus, "delivery_unknown")
  const finalizations = harness.calls.filter((call) => call.name === "finalize_notification_delivery_v1")
  assert.equal(finalizations.length, 1)
  assert.equal(finalizations[0].parameters.p_status, "delivery_unknown")
  assert.equal(finalizations[0].parameters.p_status_reason, "provider_ambiguous_response")
  assert.equal(finalizations[0].parameters.p_provider_response_code, "500")
  assert.equal(finalizations[0].parameters.p_next_attempt_at, null)
})

test("Google Chat 408은 legacy 기본값에서는 재시도하고 canonical 명시 정책에서만 unknown으로 닫힌다", async () => {
  const { createGoogleChatProvider } = await import(googleChatProviderModuleUrl)
  const legacyProvider = createGoogleChatProvider({
    fetch: async () => new Response("request timeout", { status: 408 }),
  })
  const canonicalProvider = createGoogleChatProvider({
    fetch: async () => new Response("request timeout", { status: 408 }),
    http408Disposition: "delivery_unknown",
  })

  const legacyOutcome = await legacyProvider.send(createBegunGoogleChatContext())
  assertProviderResult(legacyOutcome, "retry_wait", "transient_pre_dispatch_failure")
  assert.equal(legacyOutcome.providerResponseCode, "408")
  assert.ok(legacyOutcome.nextAttemptAt)

  const canonicalOutcome = await canonicalProvider.send(createBegunGoogleChatContext())
  assertProviderResult(canonicalOutcome, "delivery_unknown", "provider_ambiguous_response")
  assert.equal(canonicalOutcome.providerResponseCode, "408")
  assert.equal(canonicalOutcome.nextAttemptAt, null)
})

test("Google Chat 425는 legacy와 canonical 모두 명시적 사전 거절로 재시도 대기에 남긴다", async () => {
  const { createGoogleChatProvider } = await import(googleChatProviderModuleUrl)
  const legacyProvider = createGoogleChatProvider({
    fetch: async () => new Response("too early", { status: 425 }),
  })
  const canonicalProvider = createGoogleChatProvider({
    fetch: async () => new Response("too early", { status: 425 }),
    http408Disposition: "delivery_unknown",
  })

  for (const provider of [legacyProvider, canonicalProvider]) {
    const outcome = await provider.send(createBegunGoogleChatContext())

    assertProviderResult(outcome, "retry_wait", "transient_pre_dispatch_failure")
    assert.equal(outcome.providerResponseCode, "425")
    assert.ok(outcome.nextAttemptAt)
  }
})

test("Web Push provider는 begun context 한 개와 주입 sender만 사용하고 endpoint·auth·응답 원문을 결과에서 제거한다", async () => {
  const { createWebPushProvider } = await import(webPushProviderModuleUrl)
  const calls = []
  const responses = [
    { statusCode: 201, body: `accepted ${PUSH_ENDPOINT}` },
    Object.assign(new Error(`rate limited ${PUSH_AUTH}`), { statusCode: 429 }),
    Object.assign(new Error(`gone ${PUSH_ENDPOINT}`), { statusCode: 410 }),
    Object.assign(new Error(`timeout ${PUSH_P256DH}`), { code: "ETIMEDOUT" }),
  ]
  const provider = createWebPushProvider({
    sendNotification: async (...args) => {
      calls.push(clone(args))
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    },
  })

  assert.equal(provider.send.length, 1, "provider send는 begun context 한 인자만 받아야 한다")
  assertProviderResult(await provider.send(createBegunWebPushContext()), "sent", null)
  assertProviderResult(
    await provider.send(createBegunWebPushContext()),
    "retry_wait",
    "provider_rate_limited",
  )
  assertProviderResult(
    await provider.send(createBegunWebPushContext()),
    "failed",
    "provider_definite_rejection",
  )
  assertProviderResult(
    await provider.send(createBegunWebPushContext()),
    "delivery_unknown",
    "provider_timeout_after_dispatch",
  )
  assert.equal(calls.length, 4)
  for (const [subscription, payload] of calls) {
    assert.equal(subscription.endpoint, PUSH_ENDPOINT)
    assert.deepEqual(subscription.keys, { p256dh: PUSH_P256DH, auth: PUSH_AUTH })
    assert.deepEqual(JSON.parse(payload), {
      title: "새 할 일",
      body: "확인할 할 일이 있습니다.",
      href: "/admin/tasks",
    })
  }
  const callsBeforeMissing = calls.length
  assertProviderResult(
    await provider.send(createBegunWebPushContext({ subscription: null })),
    "failed",
    "connection_missing",
  )
  assert.equal(calls.length, callsBeforeMissing)
  assert.equal(unexpectedNetworkCalls, 0)
})

test("Web Push 5xx는 수락 여부가 불명하므로 재시도 대기 없이 unknown으로 닫힌다", async () => {
  const { createWebPushProvider } = await import(webPushProviderModuleUrl)
  let externalCalls = 0
  const provider = createWebPushProvider({
    sendNotification: async () => {
      externalCalls += 1
      return { statusCode: 503, body: "ambiguous upstream failure" }
    },
  })

  const outcome = await provider.send(createBegunWebPushContext())

  assertProviderResult(outcome, "delivery_unknown", "provider_ambiguous_response")
  assert.equal(outcome.providerResponseCode, "503")
  assert.equal(outcome.nextAttemptAt, null)
  assert.equal(externalCalls, 1)
})

test("Web Push 408은 legacy 기본값에서는 재시도하고 canonical 명시 정책에서만 unknown으로 닫힌다", async () => {
  const { createWebPushProvider } = await import(webPushProviderModuleUrl)
  const legacyProvider = createWebPushProvider({
    sendNotification: async () => ({ statusCode: 408 }),
  })
  const canonicalProvider = createWebPushProvider({
    sendNotification: async () => ({ statusCode: 408 }),
    http408Disposition: "delivery_unknown",
  })

  const legacyOutcome = await legacyProvider.send(createBegunWebPushContext())
  assertProviderResult(legacyOutcome, "retry_wait", "transient_pre_dispatch_failure")
  assert.equal(legacyOutcome.providerResponseCode, "408")
  assert.ok(legacyOutcome.nextAttemptAt)

  const canonicalOutcome = await canonicalProvider.send(createBegunWebPushContext())
  assertProviderResult(canonicalOutcome, "delivery_unknown", "provider_ambiguous_response")
  assert.equal(canonicalOutcome.providerResponseCode, "408")
  assert.equal(canonicalOutcome.nextAttemptAt, null)
})

test("canonical production worker만 두 외부 provider에 408 unknown 종결 정책을 명시한다", async () => {
  const source = await readFile(workerModuleUrl, "utf8")
  const productionFactory = source.slice(
    source.indexOf("async function createProductionWorkerRuntime"),
  )

  assert.match(
    productionFactory,
    /createGoogleChatProvider\(\{[\s\S]*?http408Disposition:\s*"delivery_unknown"[\s\S]*?\}\)/,
  )
  assert.match(
    productionFactory,
    /createWebPushProvider\(\{[\s\S]*?http408Disposition:\s*"delivery_unknown"[\s\S]*?\}\)/,
  )
})

test("audience fallback은 strict shape에서만 no_recipient로 건너뛰고 worker claim 대상이 아니다", async () => {
  const [forward, worker] = await Promise.all([
    readFile(workerForwardMigrationUrl, "utf8"),
    readFile(workerMigrationUrl, "utf8"),
  ])
  const materialize = functionBlock(forward, "materialize_notification_delivery_v1")
  const claim = functionBlock(worker, "claim_notification_deliveries_v1")

  assert.match(materialize, /pg_catalog\.jsonb_typeof\(p_target_snapshot\)\s*<>\s*'object'/i)
  assert.match(
    materialize,
    /p_target_kind\s*=\s*'audience'[\s\S]*?p_target_key\s*<>\s*'audience:'\s*\|\|[\s\S]*?p_target_snapshot\s*<>\s*pg_catalog\.jsonb_build_object\(/i,
  )
  assert.match(
    materialize,
    /when\s+p_target_kind\s*=\s*'audience'\s+then\s+pg_catalog\.jsonb_build_object\([\s\S]*?'status',\s*'skipped'[\s\S]*?'status_reason',\s*'no_recipient'/i,
  )
  assert.match(claim, /where\s+delivery\.status\s+in\s*\('pending',\s*'retry_wait'\)/i)
  assert.doesNotMatch(claim, /'skipped'/i)
})

test("Web Push 425는 legacy와 canonical 모두 명시적 사전 거절로 재시도 대기에 남긴다", async () => {
  const { createWebPushProvider } = await import(webPushProviderModuleUrl)
  const legacyProvider = createWebPushProvider({
    sendNotification: async () => ({ statusCode: 425 }),
  })
  const canonicalProvider = createWebPushProvider({
    sendNotification: async () => ({ statusCode: 425 }),
    http408Disposition: "delivery_unknown",
  })

  for (const provider of [legacyProvider, canonicalProvider]) {
    const outcome = await provider.send(createBegunWebPushContext())

    assertProviderResult(outcome, "retry_wait", "transient_pre_dispatch_failure")
    assert.equal(outcome.providerResponseCode, "425")
    assert.ok(outcome.nextAttemptAt)
  }
})

test("Web Push provider는 사설망·비표준 포트·미허용 Push 호스트를 전송 전에 거절한다", async () => {
  const { createWebPushProvider } = await import(webPushProviderModuleUrl)
  const { validateWebPushEndpoint } = await import(webPushEndpointModuleUrl)
  let sendCount = 0
  const provider = createWebPushProvider({
    sendNotification: async () => {
      sendCount += 1
      return { statusCode: 201 }
    },
  })
  const unsafeEndpoints = [
    "https://127.0.0.1:8443/push",
    "https://localhost/push",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com:444/fcm/send/private-endpoint-secret",
    "https://attacker.invalid/push/private-endpoint-secret",
  ]

  for (const endpoint of unsafeEndpoints) {
    assertProviderResult(await provider.send(createBegunWebPushContext({
      subscription: {
        endpoint,
        keys: { p256dh: PUSH_P256DH, auth: PUSH_AUTH },
      },
    })), "failed", "connection_missing")
  }
  assert.equal(sendCount, 0)
  assert.equal(
    validateWebPushEndpoint("https://FCM.GOOGLEAPIS.COM:443/fcm/send/private-endpoint-secret"),
    PUSH_ENDPOINT,
    "동일 Push endpoint는 host 대소문자와 기본 포트 표기와 무관하게 한 canonical URL이어야 한다",
  )
})

test("legacy in-app projection은 8개 identity만 받고 authoritative 재조회·공통 렌더·원자 commit만 수행한다", async () => {
  const { createLegacyInAppProjection } = await import(legacyProjectionModuleUrl)
  const { hashNotificationTargets } = await import(workerModuleUrl)
  const calls = []
  const input = {
    workflowKey: "tasks",
    eventId: EVENT_ID,
    ruleId: RULE_ID,
    targetProfileId: PROFILE_ID,
    targetGeneration: TARGET_GENERATION,
    legacyOwnerKey: "legacy.tasks.in_app",
    expectedOwnerGeneration: OWNER_GENERATION,
    requestId: REQUEST_ID,
  }
  const repository = {
    async loadContext(received) {
      calls.push({ name: "loadContext", input: clone(received) })
      return {
        event: {
          eventId: EVENT_ID,
          workflowKey: "tasks",
          eventKey: "task.created",
          sourceType: "ops_task",
          sourceId: "task-42",
          sourceRevision: BIG_REVISION,
          payloadSchemaVersion: 1,
          payload: { assignee_name: "김선생", task_title: "교재 확인" },
          occurrenceKey: "task:42:created",
        },
        rule: {
          ruleId: RULE_ID,
          ruleRevision: BIG_REVISION,
          templateId: TEMPLATE_ID,
          audienceKey: "primary_assignee",
          channelKey: "in_app",
          ruleVariantKey: "immediate",
        },
        template: {
          titleTemplate: "{담당자}님 새 할 일",
          bodyTemplate: "{업무} 업무를 확인해 주세요.",
          allowedVariables: [
            { key: "assignee_name", token: "담당자", piiClass: "profile_name" },
            { key: "task_title", token: "업무", piiClass: "business_text" },
          ],
          payloadSchemaVersion: 1,
        },
        scheduledFor: "2026-07-17T01:00:00.000Z",
      }
    },
    async materializeDelivery(received) {
      calls.push({ name: "materializeDelivery", input: clone(received) })
      return { deliveryId: DELIVERY_ID }
    },
    async beginDispatch(received) {
      calls.push({ name: "beginDispatch", input: clone(received) })
      return { claimId: CLAIM_ID, ownerGeneration: OWNER_GENERATION, dispatchToken: DISPATCH_TOKEN }
    },
    async commitProjection(received) {
      calls.push({ name: "commitProjection", input: clone(received) })
      return { notificationId: "73000000-0000-4000-8000-000000000001" }
    },
  }
  const targets = [{
    targetKind: "profile",
    targetKey: `profile:${PROFILE_ID}`,
    targetProfileId: PROFILE_ID,
    connectionKey: null,
    targetSnapshot: { role: "staff", active: true },
  }]
  const targetSetHash = hashNotificationTargets(targets)
  const adapter = createAdapter({
    async resolveTargets() {
      return {
        targetGeneration: TARGET_GENERATION,
        targetSetHash,
        targets,
      }
    },
    async buildRenderContext() {
      return { assignee_name: "김선생", task_title: "교재 확인" }
    },
    async buildDeepLink() {
      return "/admin/tasks?focus=task-42"
    },
  })
  const projection = createLegacyInAppProjection({
    getAdapter: () => adapter,
    repository,
  })
  const result = await projection.project(input)

  assert.deepEqual(result, { notificationId: "73000000-0000-4000-8000-000000000001" })
  assert.deepEqual(calls.map((call) => call.name), [
    "loadContext",
    "materializeDelivery",
    "beginDispatch",
    "commitProjection",
  ])
  const materialize = calls.find((call) => call.name === "materializeDelivery").input
  assert.equal(materialize.channelKey, "in_app")
  assert.equal(materialize.ownerKind, "legacy")
  assert.equal(materialize.renderedTitle, "김선생님 새 할 일")
  assert.equal(materialize.renderedBody, "교재 확인 업무를 확인해 주세요.")
  assert.equal(materialize.href, "/admin/tasks?focus=task-42")
  assert.equal(materialize.targetSetHash, targetSetHash)
  const commit = calls.find((call) => call.name === "commitProjection").input
  assert.deepEqual(commit, {
    deliveryId: DELIVERY_ID,
    claimId: CLAIM_ID,
    ownerGeneration: OWNER_GENERATION,
    dispatchToken: DISPATCH_TOKEN,
  })
  assert.equal(calls.some((call) => /push|provider/i.test(call.name)), false)

  const callCount = calls.length
  await assert.rejects(
    projection.project({ ...input, title: "브라우저가 만든 제목" }),
    /입력|invalid|identity/i,
  )
  assert.equal(calls.length, callCount, "자유형 content 입력은 재조회 전 거절해야 한다")

  const faultyProjection = createLegacyInAppProjection({
    getAdapter: () => createAdapter({
      async resolveTargets() {
        return {
          targetGeneration: TARGET_GENERATION,
          targetSetHash: "0".repeat(64),
          targets,
        }
      },
      async buildRenderContext() {
        return { assignee_name: "김선생", task_title: "교재 확인" }
      },
      async buildDeepLink() {
        return "/admin/tasks?focus=task-42"
      },
    }),
    repository,
  })
  await assert.rejects(
    faultyProjection.project(input),
    /입력|invalid|identity/i,
  )
  assert.deepEqual(
    calls.slice(callCount).map((call) => call.name),
    ["loadContext"],
    "target hash가 어긋나면 materialize 전에 거절해야 한다",
  )
})

test("Push readiness는 정규화된 상태만 반환하고 self-test는 현재 profile endpoint와 고정 content만 허용한다", async () => {
  const productionSource = await readFile(pushReadinessRouteUrl, "utf8")
  assert.match(
    productionSource,
    /const\s*\{\s*error:\s*cleanupError\s*\}\s*=\s*await\s+serviceClient[\s\S]*push_subscription_expired_cleanup_unavailable/,
    "운영 만료 구독 삭제 실패를 성공으로 숨기면 안 된다",
  )

  const { createPushReadinessRouteHandlers } = await import(pushReadinessRouteUrl)
  const sends = []
  const audits = []
  let ownerMatches = true
  let auditFails = false
  let sendFails = false
  let sendOutcome = "sent"
  const handlers = createPushReadinessRouteHandlers({
    authenticate: async () => ({ userId: PROFILE_ID, role: "staff" }),
    inspectReadiness: async ({ userId, endpoint }) => ({
      state: ownerMatches ? "ready" : "subscription_owner_mismatch",
      publicKeyConfigured: true,
      privateKeyConfigured: true,
      keysMatch: true,
      contactConfigured: true,
      assetsAvailable: true,
      subscriptionOwned: ownerMatches && userId === PROFILE_ID && endpoint === PUSH_ENDPOINT,
      capability: true,
      endpoint,
      privateKey: "절대 응답하면 안 되는 private key",
    }),
    sendSelfTest: async (input) => {
      sends.push(clone(input))
      if (sendFails) throw new Error("fixture provider unavailable")
      if (sendOutcome === "expired") {
        return { accepted: false, outcome: "expired", code: "push_subscription_expired" }
      }
      if (sendOutcome === "expired_cleanup_unavailable") {
        return {
          accepted: false,
          outcome: "expired",
          code: "push_subscription_expired_cleanup_unavailable",
        }
      }
      return { accepted: true, providerCode: "201", providerBody: PUSH_AUTH }
    },
    recordSelfTestAudit: async (input) => {
      audits.push(clone(input))
      if (auditFails) throw new Error("fixture audit unavailable")
    },
  })
  const getResponse = await handlers.get(new Request(
    `https://dashboard.test/api/notifications/push-readiness?subscription_endpoint=${encodeURIComponent(PUSH_ENDPOINT)}`,
  ))
  assert.equal(getResponse.status, 200)
  const getBody = await getResponse.json()
  assert.match(JSON.stringify(getBody), /ready/)
  assertNoSensitiveValue(getBody, "readiness 응답은 endpoint·키·service 정보를 반환하면 안 된다")

  const postResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(postResponse.status, 200)
  assert.equal(sends.length, 1)
  assert.equal(sends[0].userId, PROFILE_ID)
  assert.equal(sends[0].endpoint, PUSH_ENDPOINT)
  assert.equal(typeof sends[0].title, "string")
  assert.equal(typeof sends[0].body, "string")
  assert.match(sends[0].href, /^\/admin(?:\/|$)/)
  assertNoSensitiveValue(await postResponse.json())
  assert.deepEqual(audits, [{
    userId: PROFILE_ID,
    outcome: "sent",
    code: "push_self_test_sent",
  }])
  assertNoSensitiveValue(audits[0], "자가진단 감사에는 endpoint·key·content가 없어야 한다")

  const extraContentResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_test",
        subscription_endpoint: PUSH_ENDPOINT,
        title: "임의 제목",
        body: "임의 본문",
        href: "https://evil.invalid",
      }),
    },
  ))
  assert.equal(extraContentResponse.status, 400)
  assert.equal(sends.length, 1)

  const unsafeEndpointResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_test",
        subscription_endpoint: "https://127.0.0.1:8443/internal",
      }),
    },
  ))
  assert.equal(unsafeEndpointResponse.status, 400)
  assert.equal(sends.length, 1)

  auditFails = true
  const auditFailureResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(auditFailureResponse.status, 200)
  const auditFailureBody = await auditFailureResponse.json()
  assert.equal(auditFailureBody.state, "sent")
  assert.equal(auditFailureBody.auditRecorded, false)
  assert.equal(auditFailureBody.warningCode, "push_self_test_audit_unavailable")
  assert.equal(sends.length, 2, "감사 실패 뒤 provider를 자동 재시도하면 안 된다")
  assert.equal(audits.length, 2)

  sendOutcome = "expired"
  const expiredAuditFailureResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(expiredAuditFailureResponse.status, 410)
  const expiredAuditFailureBody = await expiredAuditFailureResponse.json()
  assert.equal(expiredAuditFailureBody.state, "expired")
  assert.equal(expiredAuditFailureBody.auditRecorded, false)
  assert.equal(expiredAuditFailureBody.warningCode, "push_self_test_audit_unavailable")

  auditFails = false
  sendOutcome = "expired_cleanup_unavailable"
  const cleanupFailureResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(cleanupFailureResponse.status, 410)
  const cleanupFailureBody = await cleanupFailureResponse.json()
  assert.equal(cleanupFailureBody.state, "expired")
  assert.equal(cleanupFailureBody.code, "push_subscription_expired_cleanup_unavailable")
  assert.equal(cleanupFailureBody.auditRecorded, true)

  sendOutcome = "sent"
  sendFails = true
  const providerFailureResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(providerFailureResponse.status, 502)
  assert.match(JSON.stringify(await providerFailureResponse.json()), /push_self_test_failed/)
  assert.equal(sends.length, 5)
  assert.deepEqual(audits[4], {
    userId: PROFILE_ID,
    outcome: "failed",
    code: "push_self_test_failed",
  })
  sendFails = false

  ownerMatches = false
  const mismatchResponse = await handlers.post(new Request(
    "https://dashboard.test/api/notifications/push-readiness",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test", subscription_endpoint: PUSH_ENDPOINT }),
    },
  ))
  assert.equal(mismatchResponse.status, 409)
  assert.match(JSON.stringify(await mismatchResponse.json()), /subscription_owner_mismatch/)
  assert.equal(sends.length, 5)
})

test("Push subscription route는 현재 profile 소유권을 유지하고 자유형 알림 content나 service key를 받지 않는다", async () => {
  const source = await readFile(pushSubscriptionsRouteUrl, "utf8")

  assert.match(source, /profile_id\s*:\s*user\.id/i)
  assert.match(source, /\.eq\(\s*["']profile_id["']\s*,\s*user\.id\s*\)/i)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)
  assert.doesNotMatch(source, /title\??\s*:|body\??\s*:|href\??\s*:|url\??\s*:/i)
  assert.match(source, /exactKeys|Object\.keys\s*\(/i)
  assert.match(source, /validateWebPushEndpoint/)
  assert.match(source, /action\s*!==\s*["']rebind["']|action\s*===\s*["']rebind["']/)
  assert.match(source, /rebind_dashboard_push_subscription_v1/)
  assert.match(source, /\.delete\(\)[\s\S]*\.eq\(\s*["']profile_id["']\s*,\s*user\.id\s*\)[\s\S]*\.select\(\s*["']id["']\s*\)/i)
  assert.match(source, /deleted\s*:\s*data\.length\s*===\s*1/)
})

test("service worker는 잘못된 Push JSON을 안전하게 기본값으로 처리하고 same-origin admin 경로만 연다", async () => {
  const source = await readFile(serviceWorkerUrl, "utf8")
  const handlers = new Map()
  const shown = []
  const opened = []
  const self = {
    location: { origin: "https://dashboard.test" },
    addEventListener(name, handler) {
      handlers.set(name, handler)
    },
    skipWaiting: async () => {},
    registration: {
      async showNotification(title, options) {
        shown.push({ title, options: clone(options) })
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      async openWindow(url) {
        opened.push(url)
        return null
      },
    },
  }
  vm.runInNewContext(source, { self, URL, Boolean }, { filename: "public/sw.js" })

  let pushWork = null
  assert.doesNotThrow(() => handlers.get("push")({
    data: { json() { throw new Error("잘못된 JSON") } },
    waitUntil(promise) { pushWork = promise },
  }))
  await pushWork
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, "TIPS Dashboard")
  assert.match(shown[0].options.data.url, /^\/admin(?:\/|$)/)

  let clickWork = null
  handlers.get("notificationclick")({
    notification: {
      data: { url: "https://evil.invalid/phishing" },
      close() {},
    },
    waitUntil(promise) { clickWork = promise },
  })
  await clickWork
  assert.equal(opened.length, 1)
  assert.match(opened[0], /^\/admin(?:\/|$)/)
  assert.doesNotMatch(opened[0], /evil\.invalid/)

  handlers.get("notificationclick")({
    notification: {
      data: { url: "/admin/tasks?focus=task-42" },
      close() {},
    },
    waitUntil(promise) { clickWork = promise },
  })
  await clickWork
  assert.equal(opened[1], "/admin/tasks?focus=task-42")
})
