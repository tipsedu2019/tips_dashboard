import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const evaluatorUrl = new URL(
  "../scripts/notification-shadow-deterministic-evidence.mjs",
  import.meta.url,
)
const runnerUrl = new URL("../scripts/run-notification-shadow-fixtures.mjs", import.meta.url)
const migrationsUrl = new URL("../supabase/pending-migrations/notification-cutover/", import.meta.url)

const UUIDS = Object.freeze({
  request: "11111111-1111-4111-8111-111111111111",
  event: "22222222-2222-4222-8222-222222222222",
  source: "33333333-3333-4333-8333-333333333333",
  rule: "44444444-4444-4444-8444-444444444444",
  template: "55555555-5555-4555-8555-555555555555",
  task: "66666666-6666-4666-8666-666666666666",
  recipient: "77777777-7777-4777-8777-777777777777",
  cycleTwo: "88888888-8888-4888-8888-888888888888",
  ruleTwo: "99999999-9999-4999-8999-999999999999",
})

function taskPlan() {
  const checksum = "a".repeat(64)
  const template = {
    titleTemplate: "[{workflow_label}] {event_label}",
    bodyTemplate: "{event_label} · {occurred_at}\n{deep_link}",
    allowedVariables: [
      { key: "workflow_label", token: "workflow_label", piiClass: "none" },
      { key: "event_label", token: "event_label", piiClass: "none" },
      { key: "occurred_at", token: "occurred_at", piiClass: "schedule" },
      { key: "deep_link", token: "deep_link", piiClass: "same_origin_path" },
    ],
    payloadSchemaVersion: 1,
    checksum,
  }
  const href = `/admin/tasks?taskId=${UUIDS.task}`
  return {
    schemaVersion: 1,
    evidenceKind: "deterministic_no_delivery",
    scopeKey: "tasks",
    requestId: UUIDS.request,
    scopeConfigDigest: "d".repeat(64),
    activeRuleManifestDigest: "e".repeat(64),
    shadowRevision: "7",
    enabledRuleCount: 1,
    buildRevisionHash: "f".repeat(64),
    fixture: {
      occurrenceKey: "notification-shadow-deterministic:tasks:v1",
      canonical: {
        eventId: UUIDS.event,
        workflowKey: "tasks",
        eventKey: "task.created",
        sourceType: "ops_task_event",
        sourceId: UUIDS.source,
        sourceRevision: null,
        payloadSchemaVersion: 1,
        payload: {
          task_id: UUIDS.task,
          primary_assignee_profile_id: UUIDS.recipient,
          occurred_at: "2026-07-17T03:00:00.000Z",
        },
        rule: {
          ruleId: UUIDS.rule,
          ruleRevision: "1",
          templateId: UUIDS.template,
          audienceKey: "primary_assignee",
          channelKey: "in_app",
          connectionKey: null,
          ruleVariantKey: "immediate",
        },
        scheduledFor: "2026-07-17T03:00:00.000Z",
        template,
      },
      legacy: {
        workflowKey: "tasks",
        eventKey: "task.created",
        audienceKey: "primary_assignee",
        channelKey: "in_app",
        template: structuredClone(template),
        context: {
          workflow_label: "할 일",
          event_label: "할 일 생성",
          occurred_at: "2026-07-17T03:00:00.000Z",
          deep_link: href,
        },
        href,
        targets: [{ targetKey: `profile:${UUIDS.recipient}`, targetGeneration: "0" }],
      },
    },
  }
}

function taskBatch(batchRequestId, plans = [taskPlan()]) {
  return {
    schemaVersion: 1,
    scopeKey: "tasks",
    batchRequestId,
    plans,
  }
}

async function deterministicMigrationSource() {
  const names = await readdir(migrationsUrl)
  const name = names.find((candidate) => (
    candidate.endsWith("_notification_shadow_deterministic_evidence.sql")
  ))
  assert.ok(name, "196000 뒤의 결정적 무발송 증거 마이그레이션이 필요합니다.")
  assert.ok(name > "20260716196000_notification_shadow_fixture_runner.sql")
  return readFile(new URL(name, migrationsUrl), "utf8")
}

function sqlFunctionBlock(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`)
  assert.notEqual(start, -1, `${qualifiedName} 함수를 찾을 수 없습니다.`)
  const next = source.indexOf("\ncreate or replace function ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("후속 SQL은 새 템플릿 SHA-256과 과거 MD5 자연 비교를 함께 보장한다", async () => {
  const source = await deterministicMigrationSource()
  const checksumTrigger = sqlFunctionBlock(
    source,
    "dashboard_private.notification_template_checksum_sha256_v1",
  )
  const legacyIntent = sqlFunctionBlock(
    source,
    "public.record_legacy_notification_intent_v1",
  )
  const legacyDeliveryIntent = sqlFunctionBlock(
    source,
    "public.record_legacy_notification_delivery_intent_v1",
  )

  assert.match(
    checksumTrigger,
    /new\.checksum := dashboard_private\.notification_seed_template_checksum_v1\(/,
  )
  for (const field of [
    "new.title_template",
    "new.body_template",
    "new.allowed_variables",
    "new.payload_schema_version",
  ]) assert.match(checksumTrigger, new RegExp(field.replaceAll(".", "\\.")))
  assert.match(
    source,
    /create trigger notification_templates_checksum_sha256_v1[\s\S]*?before insert or update of[\s\S]*?checksum[\s\S]*?on dashboard_private\.notification_templates/,
  )
  assert.match(
    source,
    /revoke all on function dashboard_private\.notification_template_checksum_sha256_v1\(\)[\s\S]*?from public, anon, authenticated, service_role/,
  )

  assert.match(
    legacyIntent,
    /p_legacy_template_checksum !~ '\^\(\[a-f0-9\]\{32\}\|\[a-f0-9\]\{64\}\)\$'/,
  )
  assert.match(
    legacyDeliveryIntent,
    /p_legacy_template_checksum !~ '\^\(\[a-f0-9\]\{32\}\|\[a-f0-9\]\{64\}\)\$'/,
  )
  for (const block of [legacyIntent, legacyDeliveryIntent]) {
    assert.match(block, /p_normalized_rendered_hash !~ '\^\[a-f0-9\]\{64\}\$'/)
    assert.match(block, /security definer/)
    assert.match(block, /set search_path = ''/)
  }
  assert.match(legacyIntent, /notification_audit_logs/)
  assert.match(legacyIntent, /notification_compare_shadow_intent_v1/)
  assert.match(legacyDeliveryIntent, /notification_dispatch_ownership_claims/)
  assert.match(legacyDeliveryIntent, /notification_shadow_boundary_authorized/)
})

test("결정적 증거 계산기는 실제 adapter·renderer와 별도 legacy 계산만 반환한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?success=${Date.now()}`)
  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(taskPlan())

  assert.deepEqual(Object.keys(artifact).sort(), [
    "canonicalIntents",
    "legacyIntents",
    "schemaVersion",
  ])
  assert.equal(artifact.schemaVersion, 1)
  assert.equal(artifact.canonicalIntents.length, 1)
  assert.equal(artifact.legacyIntents.length, 1)
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
  assert.equal("matched" in artifact, false)
  assert.equal("scopeConfigDigest" in artifact, false)
  assert.equal("enabledRuleCount" in artifact, false)
  assert.equal("buildRevisionHash" in artifact, false)
})

test("정규 template만 바뀌면 결정적 증거 계산이 실패한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?drift=${Date.now()}`)
  const plan = taskPlan()
  plan.fixture.canonical.template = {
    ...plan.fixture.canonical.template,
    titleTemplate: `${plan.fixture.canonical.template.titleTemplate} [drift]`,
    checksum: "b".repeat(64),
  }
  await assert.rejects(
    evaluator.evaluateNotificationShadowDeterministicPlan(plan),
    /notification_shadow_deterministic_mismatch:tasks/,
  )
})

test("과거 32자리 template checksum plan도 실행기 입력 형식으로 허용한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?md5-template=${Date.now()}`)
  const plan = taskPlan()
  plan.fixture.canonical.template.checksum = "a".repeat(32)
  plan.fixture.legacy.template.checksum = "a".repeat(32)

  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(plan)

  assert.equal(artifact.canonicalIntents[0].templateChecksum, "a".repeat(32))
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
})

test("동시에 계산해도 외부 요청 차단 fetch가 먼저 복구되거나 전역에 남지 않는다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?concurrent-fetch=${Date.now()}`)
  const realFetch = globalThis.fetch
  let originalFetchCalls = 0
  const originalFetch = async () => {
    originalFetchCalls += 1
    return { ok: true }
  }
  let markSecondStarted
  let releaseSecond
  const secondStarted = new Promise((resolve) => { markSecondStarted = resolve })
  const secondReleased = new Promise((resolve) => { releaseSecond = resolve })
  const first = taskPlan()
  const second = taskPlan()
  second.fixture.canonical.eventId = UUIDS.cycleTwo
  const targetSet = {
    targetGeneration: "0",
    targets: [{ targetKey: `profile:${UUIDS.recipient}` }],
  }
  const adapter = {
    async resolveTargets(input) {
      if (input.eventId === first.fixture.canonical.eventId) {
        await secondStarted
      } else {
        markSecondStarted()
        await secondReleased
        await globalThis.fetch("https://forbidden.example.test")
      }
      return targetSet
    },
    async buildRenderContext() {
      return first.fixture.legacy.context
    },
    async buildDeepLink() {
      return first.fixture.legacy.href
    },
  }
  globalThis.fetch = originalFetch
  try {
    const firstRun = evaluator.evaluateNotificationShadowDeterministicPlan(first, {
      getAdapter: () => adapter,
    })
    const secondRun = evaluator.evaluateNotificationShadowDeterministicPlan(second, {
      getAdapter: () => adapter,
    })
    await firstRun
    releaseSecond()
    await assert.rejects(
      secondRun,
      /notification_shadow_deterministic_external_request_forbidden/,
    )
    assert.equal(originalFetchCalls, 0)
    assert.equal(globalThis.fetch, originalFetch)
  } finally {
    globalThis.fetch = realFetch
  }
})

test("휴보강 subject_team 결정적 계산은 영어와 수학 연결을 모두 검증한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?subject-variants=${Date.now()}`)
  const plan = taskPlan()
  const href = `/admin/makeup-requests?request=${UUIDS.task}`
  const template = {
    titleTemplate: "휴보강 검증",
    bodyTemplate: "연결 분기 검증",
    allowedVariables: [],
    payloadSchemaVersion: 1,
    checksum: "a".repeat(64),
  }
  plan.scopeKey = "makeup_requests"
  plan.fixture.occurrenceKey = "notification-shadow-deterministic:makeup:subject:v1"
  plan.fixture.subjectConnectionVariants = [
    {
      approvalGroup: "english",
      connectionKey: "google_chat.english",
      occurrenceKey: `${plan.fixture.occurrenceKey}:english`,
    },
    {
      approvalGroup: "math_middle",
      connectionKey: "google_chat.math",
      occurrenceKey: `${plan.fixture.occurrenceKey}:math`,
    },
  ]
  plan.fixture.canonical = {
    ...plan.fixture.canonical,
    workflowKey: "makeup_requests",
    eventKey: "makeup.submitted",
    sourceType: "makeup_request_event",
    payload: {
      makeup_request_id: UUIDS.task,
      approval_group: "english",
    },
    rule: {
      ...plan.fixture.canonical.rule,
      audienceKey: "subject_team",
      channelKey: "google_chat",
      connectionKey: "google_chat.english",
    },
    template,
  }
  plan.fixture.legacy = {
    workflowKey: "makeup_requests",
    eventKey: "makeup.submitted",
    audienceKey: "subject_team",
    channelKey: "google_chat",
    template: structuredClone(template),
    context: {},
    href,
    targets: plan.fixture.subjectConnectionVariants.map((variant) => ({
      targetKey: `connection:${variant.connectionKey}`,
      targetGeneration: "0",
      occurrenceKey: variant.occurrenceKey,
    })),
  }

  assert.notEqual(
    plan.fixture.canonical.sourceId,
    plan.fixture.canonical.payload.makeup_request_id,
  )
  assert.equal(plan.fixture.legacy.href, href)
  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(plan)

  assert.deepEqual(
    artifact.canonicalIntents.map((intent) => intent.targetKey).sort(),
    ["connection:google_chat.english", "connection:google_chat.math"],
  )
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
})

test("댓글 sourceType과 scalar·array 다중 수신자 중복 제거를 실제 adapter로 검증한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?comment-recipients=${Date.now()}`)
  const plan = taskPlan()
  const recipientTwo = UUIDS.cycleTwo
  plan.fixture.canonical.eventKey = "task.comment_added"
  plan.fixture.canonical.sourceType = "ops_task_comment"
  plan.fixture.canonical.payload = {
    task_id: UUIDS.task,
    secondary_assignee_profile_id: UUIDS.recipient,
    secondary_assignee_profile_ids: [recipientTwo, UUIDS.recipient],
    occurred_at: "2026-07-17T03:00:00.000Z",
  }
  plan.fixture.canonical.rule.audienceKey = "secondary_assignee"
  plan.fixture.legacy.eventKey = "task.comment_added"
  plan.fixture.legacy.audienceKey = "secondary_assignee"
  plan.fixture.legacy.context.event_label = "댓글"
  plan.fixture.legacy.targets = [UUIDS.recipient, recipientTwo]
    .sort()
    .map((profileId) => ({
      targetKey: `profile:${profileId}`,
      targetGeneration: "0",
    }))

  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(plan)

  assert.equal(artifact.canonicalIntents.length, 2)
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
})

test("결재 댓글 sourceType과 결재 entity 딥 링크를 실제 adapter로 검증한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?approval-comment=${Date.now()}`)
  const plan = taskPlan()
  const href = `/admin/approvals?approvalId=${UUIDS.task}`
  plan.scopeKey = "approvals"
  plan.fixture.canonical = {
    ...plan.fixture.canonical,
    workflowKey: "approvals",
    eventKey: "approval.comment_added",
    sourceType: "approval_comment",
    sourceId: UUIDS.source,
    payload: {
      approval_id: UUIDS.task,
      requester_profile_id: UUIDS.recipient,
      occurred_at: "2026-07-17T03:00:00.000Z",
    },
    rule: {
      ...plan.fixture.canonical.rule,
      audienceKey: "requester_profile",
    },
  }
  plan.fixture.legacy = {
    ...plan.fixture.legacy,
    workflowKey: "approvals",
    eventKey: "approval.comment_added",
    audienceKey: "requester_profile",
    context: {
      workflow_label: "전자결재",
      event_label: "댓글",
      occurred_at: "2026-07-17T03:00:00.000Z",
      deep_link: href,
    },
    href,
  }

  assert.notEqual(plan.fixture.canonical.sourceId, plan.fixture.canonical.payload.approval_id)
  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(plan)
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
})

test("결재 source event ID와 업무 entity ID가 달라도 entity 딥 링크를 검증한다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?approval-entity=${Date.now()}`)
  const plan = taskPlan()
  const href = `/admin/approvals?approvalId=${UUIDS.task}`
  plan.scopeKey = "approvals"
  plan.fixture.canonical = {
    ...plan.fixture.canonical,
    workflowKey: "approvals",
    eventKey: "approval.submitted",
    sourceType: "approval_event",
    sourceId: UUIDS.source,
    payload: {
      approval_id: UUIDS.task,
      requester_profile_id: UUIDS.recipient,
      occurred_at: "2026-07-17T03:00:00.000Z",
    },
    rule: {
      ...plan.fixture.canonical.rule,
      audienceKey: "requester_profile",
    },
  }
  plan.fixture.legacy = {
    ...plan.fixture.legacy,
    workflowKey: "approvals",
    eventKey: "approval.submitted",
    audienceKey: "requester_profile",
    context: {
      workflow_label: "전자결재",
      event_label: "제출",
      occurred_at: "2026-07-17T03:00:00.000Z",
      deep_link: href,
    },
    href,
  }

  assert.notEqual(plan.fixture.canonical.sourceId, plan.fixture.canonical.payload.approval_id)
  const artifact = await evaluator.evaluateNotificationShadowDeterministicPlan(plan)
  assert.deepEqual(artifact.canonicalIntents, artifact.legacyIntents)
})

test("운영 실행기는 자연 비교 부족을 결정적 RPC로 우회하지 않는다", async () => {
  const runner = await import(`${runnerUrl.href}?natural-only=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  const calls = []
  let evaluated = false

  await assert.rejects(
    runner.executeNotificationShadowFixturePlan(plan, {
      async evaluateDeterministicPlan() {
        evaluated = true
        return {}
      },
      async rpc(name) {
        calls.push(name)
        if (name === "record_notification_shadow_fixture_evidence_v1") {
          throw Object.assign(new Error("natural comparison required"), {
            code: "notification_shadow_natural_comparison_required",
          })
        }
        throw new Error(`unexpected_deterministic_rpc:${name}`)
      },
    }),
    /notification_shadow_natural_comparison_required:tasks/,
  )

  assert.equal(evaluated, false)
  assert.deepEqual(calls, ["record_notification_shadow_fixture_evidence_v1"])
})

test("운영 실행기는 자연 비교가 없으면 결정적 무발송 증거로 전환하지 않는다", async () => {
  const evaluator = await import(`${evaluatorUrl.href}?runner=${Date.now()}`)
  const runner = await import(`${runnerUrl.href}?deterministic=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  const calls = []
  await assert.rejects(runner.executeNotificationShadowFixturePlan(plan, {
    resolveLocalBuildRevisionHash: () => "f".repeat(64),
    evaluateDeterministicPlan: evaluator.evaluateNotificationShadowDeterministicPlan,
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      if (name === "replay_notification_shadow_evidence_v1") return null
      if (name === "record_notification_shadow_fixture_evidence_v1") {
        if (parameters.p_scope_key === "tasks") {
          throw Object.assign(new Error("natural comparison required"), {
            code: "notification_shadow_natural_comparison_required",
          })
        }
        return {
          recorded: true,
          scopeKey: parameters.p_scope_key,
          requestId: parameters.p_request_id,
          evidenceKind: "no_active_rule",
          enabledRuleCount: 0,
          comparisonKey: null,
          scopeConfigDigest: "c".repeat(64),
        }
      }
      if (name === "prepare_notification_shadow_deterministic_fixture_v1") {
        return taskBatch(parameters.p_request_id)
      }
      if (name === "record_notification_shadow_deterministic_evidence_v1") {
        assert.deepEqual(Object.keys(parameters).sort(), [
          "p_batch_request_id",
          "p_fixture_output",
          "p_request_id",
          "p_scope_key",
        ])
        assert.equal("matched" in parameters.p_fixture_output, false)
        assert.equal("scopeConfigDigest" in parameters.p_fixture_output, false)
        return {
          recorded: true,
          scopeKey: parameters.p_scope_key,
          batchRequestId: parameters.p_batch_request_id,
          requestId: parameters.p_request_id,
          ruleId: UUIDS.rule,
          evidenceKind: "deterministic_no_delivery",
          enabledRuleCount: 1,
          comparisonKey: null,
          scopeConfigDigest: "d".repeat(64),
          activeRuleManifestDigest: "e".repeat(64),
          shadowRevision: "7",
          buildRevisionHash: "f".repeat(64),
          fixtureResultDigest: "1".repeat(64),
        }
      }
      if (name === "verify_notification_shadow_evidence_complete_v1") {
        return { verified: true, scopeCount: 10 }
      }
      throw new Error(`unexpected_rpc:${name}`)
    },
  }), /notification_shadow_natural_comparison_required:tasks/)

  assert.deepEqual(calls.map((call) => call.name), [
    "record_notification_shadow_fixture_evidence_v1",
  ])
})

test("운영 실행기는 활성 규칙별 결정적 cycle을 운영 증거로 기록하지 않는다", async () => {
  const runner = await import(`${runnerUrl.href}?multi-plan=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  const evaluated = []
  const recorded = []
  await assert.rejects(runner.executeNotificationShadowFixturePlan(plan, {
    resolveLocalBuildRevisionHash: () => "f".repeat(64),
    async evaluateDeterministicPlan(fixturePlan) {
      evaluated.push(fixturePlan.requestId)
      return {
        schemaVersion: 1,
        canonicalIntents: [{ targetKey: `profile:${fixturePlan.requestId}` }],
        legacyIntents: [{ targetKey: `profile:${fixturePlan.requestId}` }],
      }
    },
    async rpc(name, parameters) {
      if (name === "replay_notification_shadow_evidence_v1") return null
      if (name === "record_notification_shadow_fixture_evidence_v1") {
        if (parameters.p_scope_key === "tasks") {
          throw Object.assign(new Error("natural comparison required"), {
            code: "notification_shadow_natural_comparison_required",
          })
        }
        return {
          recorded: true,
          scopeKey: parameters.p_scope_key,
          requestId: parameters.p_request_id,
          evidenceKind: "no_active_rule",
          enabledRuleCount: 0,
          comparisonKey: null,
          scopeConfigDigest: "c".repeat(64),
        }
      }
      if (name === "prepare_notification_shadow_deterministic_fixture_v1") {
        const first = taskPlan()
        first.requestId = UUIDS.request
        first.enabledRuleCount = 2
        const second = structuredClone(first)
        second.requestId = UUIDS.cycleTwo
        second.fixture.occurrenceKey += ":second"
        second.fixture.canonical.rule.ruleId = UUIDS.ruleTwo
        return {
          schemaVersion: 1,
          scopeKey: "tasks",
          batchRequestId: parameters.p_request_id,
          plans: [first, second],
        }
      }
      if (name === "record_notification_shadow_deterministic_evidence_v1") {
        recorded.push(parameters)
        return {
          recorded: true,
          scopeKey: parameters.p_scope_key,
          batchRequestId: parameters.p_batch_request_id,
          requestId: parameters.p_request_id,
          ruleId: parameters.p_request_id === UUIDS.request ? UUIDS.rule : UUIDS.ruleTwo,
          evidenceKind: "deterministic_no_delivery",
          enabledRuleCount: 2,
          comparisonKey: null,
          scopeConfigDigest: "d".repeat(64),
          activeRuleManifestDigest: "e".repeat(64),
          shadowRevision: "7",
          buildRevisionHash: "f".repeat(64),
          fixtureResultDigest: "1".repeat(64),
        }
      }
      if (name === "verify_notification_shadow_evidence_complete_v1") {
        return { verified: true, scopeCount: 10 }
      }
      throw new Error(`unexpected_rpc:${name}`)
    },
  }), /notification_shadow_natural_comparison_required:tasks/)

  assert.deepEqual(evaluated, [])
  assert.equal(recorded.length, 0)
})

test("예약 규칙만 남고 자연 비교가 없으면 결정적 증거로 우회하지 않는다", async () => {
  const runner = await import(`${runnerUrl.href}?scheduled-natural-only=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  await assert.rejects(
    runner.executeNotificationShadowFixturePlan(plan, {
      async rpc(name, parameters) {
        if (name === "replay_notification_shadow_evidence_v1") return null
        if (name === "record_notification_shadow_fixture_evidence_v1") {
          throw Object.assign(new Error("natural comparison required"), {
            code: "notification_shadow_natural_comparison_required",
          })
        }
        if (name === "prepare_notification_shadow_deterministic_fixture_v1") {
          return {
            schemaVersion: 1,
            scopeKey: parameters.p_scope_key,
            batchRequestId: parameters.p_request_id,
            plans: [],
          }
        }
        throw new Error(`unexpected_rpc:${name}`)
      },
    }),
    /notification_shadow_natural_comparison_required:tasks/,
  )
})

test("같은 묶음 요청 재실행도 record RPC 자체 멱등성만 사용한다", async () => {
  const runner = await import(`${runnerUrl.href}?replay=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  const ledger = new Map()
  const calls = []
  const rpc = async (name, parameters) => {
    calls.push(name)
    const requestId = parameters.p_request_id
    if (name === "record_notification_shadow_fixture_evidence_v1") {
      if (ledger.has(requestId)) return ledger.get(requestId)
      const natural = parameters.p_scope_key === "tasks"
      const result = {
        recorded: true,
        scopeKey: parameters.p_scope_key,
        requestId,
        evidenceKind: natural ? "natural_comparison" : "no_active_rule",
        enabledRuleCount: natural ? 1 : 0,
        comparisonKey: natural ? "b".repeat(64) : null,
        scopeConfigDigest: "a".repeat(64),
      }
      ledger.set(requestId, result)
      return result
    }
    if (name === "verify_notification_shadow_evidence_complete_v1") {
      return { verified: true, scopeCount: 10 }
    }
    throw new Error(`unexpected_rpc:${name}`)
  }
  const dependencies = { rpc }

  await runner.executeNotificationShadowFixturePlan(plan, dependencies)
  const secondRunStart = calls.length
  const replayed = await runner.executeNotificationShadowFixturePlan(plan, dependencies)

  assert.equal(replayed.completedScopes, 10)
  assert.deepEqual(
    calls.slice(secondRunStart),
    [
      ...Array(10).fill("record_notification_shadow_fixture_evidence_v1"),
      "verify_notification_shadow_evidence_complete_v1",
    ],
  )
})

test("자연 비교가 없으면 주입된 결정적 계산기도 실행하지 않는다", async () => {
  const runner = await import(`${runnerUrl.href}?build=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  let evaluated = false
  let recorded = false
  await assert.rejects(
    runner.executeNotificationShadowFixturePlan(plan, {
      resolveLocalBuildRevisionHash: () => "0".repeat(64),
      async evaluateDeterministicPlan() {
        evaluated = true
        return {}
      },
      async rpc(name) {
        if (name === "record_notification_shadow_fixture_evidence_v1") {
          throw Object.assign(new Error("natural comparison required"), {
            code: "notification_shadow_natural_comparison_required",
          })
        }
        if (name.includes("deterministic")) recorded = true
        throw new Error(`unexpected_rpc:${name}`)
      },
    }),
    /notification_shadow_natural_comparison_required:tasks/,
  )
  assert.equal(evaluated, false)
  assert.equal(recorded, false)
})

test("record RPC가 결정적 증거를 반환해도 운영 계약은 거절한다", async () => {
  const runner = await import(`${runnerUrl.href}?record-snapshot=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  await assert.rejects(
    runner.executeNotificationShadowFixturePlan(plan, {
      resolveLocalBuildRevisionHash: () => "f".repeat(64),
      async evaluateDeterministicPlan() {
        return { schemaVersion: 1, canonicalIntents: [], legacyIntents: [] }
      },
      async rpc(name, parameters) {
        if (name === "record_notification_shadow_fixture_evidence_v1") {
          return {
            recorded: true,
            scopeKey: parameters.p_scope_key,
            requestId: parameters.p_request_id,
            evidenceKind: "deterministic_no_delivery",
            enabledRuleCount: 1,
            comparisonKey: null,
            scopeConfigDigest: "c".repeat(64),
          }
        }
        throw new Error(`unexpected_rpc:${name}`)
      },
    }),
    /shadow_fixture_rpc_contract_invalid:tasks/,
  )
})

test("10개 응답 뒤 DB의 활성 rule별 최종 gate가 실패하면 완료로 보고하지 않는다", async () => {
  const runner = await import(`${runnerUrl.href}?complete=${Date.now()}`)
  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId: UUIDS.request,
  })
  await assert.rejects(
    runner.executeNotificationShadowFixturePlan(plan, {
      async rpc(name, parameters) {
        if (name === "replay_notification_shadow_evidence_v1") return null
        if (name === "record_notification_shadow_fixture_evidence_v1") {
          return {
            recorded: true,
            scopeKey: parameters.p_scope_key,
            requestId: parameters.p_request_id,
            evidenceKind: "no_active_rule",
            enabledRuleCount: 0,
            comparisonKey: null,
            scopeConfigDigest: "a".repeat(64),
          }
        }
        if (name === "verify_notification_shadow_evidence_complete_v1") {
          throw Object.assign(new Error("active rule evidence incomplete"), {
            code: "notification_shadow_scope_evidence_incomplete",
          })
        }
        throw new Error(`unexpected_rpc:${name}`)
      },
    }),
    /notification_shadow_scope_evidence_incomplete/,
  )
})

test("후속 SQL은 결정적 계산을 진단용으로 격리하고 운영 gate에는 자연 증거만 쓴다", async () => {
  const source = await deterministicMigrationSource()
  const prepare = sqlFunctionBlock(
    source,
    "public.prepare_notification_shadow_deterministic_fixture_v1",
  )
  const plan = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_deterministic_rule_fixture_plan_v1",
  )
  const cycleRequestId = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_deterministic_cycle_request_id_v1",
  )
  const expected = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_deterministic_fixture_expected_v1",
  )
  const record = sqlFunctionBlock(
    source,
    "public.record_notification_shadow_deterministic_evidence_v1",
  )
  const current = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_deterministic_evidence_current_v1",
  )
  const naturalPerRule = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_rule_natural_evidence_current_v1",
  )
  const complete = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_scope_evidence_complete_v1",
  )
  const replay = sqlFunctionBlock(
    source,
    "public.replay_notification_shadow_evidence_v1",
  )
  const verifyComplete = sqlFunctionBlock(
    source,
    "public.verify_notification_shadow_evidence_complete_v1",
  )

  assert.match(source, /create table dashboard_private\.notification_shadow_deterministic_evidence/)
  assert.match(source, /batch_request_id uuid not null/)
  assert.match(source, /active_rule_manifest_digest text not null/)
  assert.match(source, /build_revision_hash text not null/)
  assert.match(source, /fixture_result_digest text not null/)
  assert.match(source, /template_checksum ~ '\^\(\[a-f0-9\]\{32\}\|\[a-f0-9\]\{64\}\)\$'/)
  assert.match(source, /enable row level security/)
  assert.match(source, /revoke all on table dashboard_private\.notification_shadow_deterministic_evidence/)

  for (const block of [prepare, record]) {
    assert.match(block, /\(select auth\.role\(\)\) <> 'service_role'/)
    assert.match(block, /notification_shadow_deterministic_rule_fixture_plan_v1/)
  }
  assert.match(prepare, /pg_catalog\.jsonb_agg/)
  assert.match(prepare, /notification_shadow_deterministic_rule_fixture_plan_v1/)
  assert.match(prepare, /'batchRequestId', p_request_id/)
  assert.match(prepare, /rule_row\.delivery_mode = 'immediate'/)
  assert.match(cycleRequestId, /notification-shadow-deterministic-cycle-request-v3/)
  for (const stateField of [
    "p_rule_revision",
    "p_template_checksum",
    "p_scope_config_digest",
    "p_active_rule_manifest_digest",
    "p_shadow_revision",
    "p_enabled_rule_count",
    "p_build_revision_hash",
  ]) assert.match(cycleRequestId, new RegExp(stateField))
  assert.match(replay, /\(select auth\.role\(\)\) <> 'service_role'/)
  assert.match(replay, /notification_request_ledger/)
  assert.match(replay, /'notification_shadow_scope_evidence'/)
  assert.doesNotMatch(replay, /notification_shadow_deterministic_evidence/)
  assert.match(replay, /idempotency_key_reused/)
  assert.match(verifyComplete, /\(select auth\.role\(\)\) <> 'service_role'/)
  assert.match(verifyComplete, /notification_shadow_scope_evidence_complete_v1/)
  assert.match(verifyComplete, /notification_shadow_scope_evidence_incomplete/)
  assert.match(plan, /notification_shadow_scope_config_digest_v1/)
  assert.match(plan, /notification_shadow_active_rule_manifest_digest_v1/)
  assert.match(plan, /v_legacy_title := v_template\.title_template/)
  assert.match(plan, /v_legacy_body := v_template\.body_template/)
  assert.match(plan, /v_legacy_allowed := v_template\.allowed_variables/)
  assert.match(plan, /v_legacy_schema_version := v_template\.payload_schema_version/)
  assert.match(plan, /v_legacy_checksum := v_template\.checksum/)
  assert.match(plan, /if p_scope_key = 'registration_solapi'/)
  assert.match(plan, /v_legacy_title := '입학신청서 안내'/)
  assert.match(plan, /v_legacy_body := '\{student_name\} 학생 입학신청서 안내'/)
  assert.doesNotMatch(plan, /notification_seed_template_payload_v1/)
  assert.match(plan, /rule_row\.id = p_rule_id/)
  assert.match(plan, /rule_row\.delivery_mode = 'immediate'/)
  assert.doesNotMatch(plan, /v_enabled_rule_count <> 1/)
  assert.doesNotMatch(plan, /notification_shadow_deterministic_full_coverage_unavailable/)
  assert.match(plan, /v_requester_profile_id/)
  assert.match(plan, /v_primary_profile_id/)
  assert.match(plan, /v_secondary_profile_id/)
  assert.match(plan, /v_secondary_profile_id_2/)
  assert.match(plan, /v_management_profile_id/)
  assert.match(plan, /v_management_profile_id_2/)
  assert.match(plan, /v_director_profile_id/)
  assert.match(plan, /v_director_profile_id_2/)
  assert.match(plan, /secondary_assignee_profile_ids/)
  assert.match(plan, /pg_catalog\.unnest\(v_target_profile_ids\)/)
  assert.match(plan, /'ops_task_comment'/)
  assert.match(plan, /'approval_comment'/)
  assert.match(plan, /\|approval-entity/)
  assert.match(plan, /\|makeup-entity/)
  assert.match(plan, /subjectConnectionVariants/)
  assert.match(plan, /'google_chat\.english'/)
  assert.match(plan, /'google_chat\.math'/)
  assert.match(plan, /v_payload := \(v_payload - array/)
  assert.match(
    source,
    /registration_render_fixed_template_v1[\s\S]*?\{학생\}[\s\S]*?student_name/,
  )
  assert.match(plan, /notification_current_contract_build_revision_hash_v1/)
  assert.match(plan, /notification_control_plane_shadow_write_enabled/)
  assert.match(plan, /lock table dashboard_private\.notification_rules in share mode/)
  assert.match(plan, /lock table dashboard_private\.notification_templates in share mode/)
  assert.doesNotMatch(
    record,
    /p_scope_config_digest|p_enabled_rule_count|p_matched|p_build_revision_hash|p_rule_id/,
  )
  assert.match(record, /p_batch_request_id uuid/)
  assert.match(record, /notification_shadow_deterministic_cycle_request_id_v1/)
  assert.match(record, /v_scope_config_digest/)
  assert.match(record, /v_active_rule_manifest_digest/)
  assert.match(record, /v_shadow\.revision/)
  assert.match(record, /v_build_revision_hash/)
  assert.match(record, /v_plan ->> 'requestId' is distinct from p_request_id::text/)
  assert.match(record, /rule_row\.id into v_rule_id/)
  assert.match(record, /p_fixture_output jsonb/)
  assert.match(expected, /canonicalIntents/)
  assert.match(expected, /legacyIntents/)
  assert.match(record, /notification_shadow_deterministic_fixture_expected_v1/)
  assert.match(record, /notification_shadow_deterministic_intents_match_v1/)
  assert.match(record, /notification_shadow_deterministic_fixture_mismatch/)

  assert.match(current, /notification_shadow_scope_config_digest_v1\(p_scope_key\)/)
  assert.match(current, /notification_shadow_active_rule_manifest_digest_v1\(p_scope_key\)/)
  assert.match(current, /notification_shadow_deterministic_rule_fixture_plan_v1/)
  assert.match(current, /evidence\.request_id = \(v_current_plan ->> 'requestId'\)::uuid/)
  assert.match(current, /notification_shadow_deterministic_fixture_expected_v1/)
  assert.match(current, /evidence\.fixture_result_digest/)
  assert.match(current, /evidence\.shadow_revision = shadow_flag\.revision/)
  assert.match(
    current,
    /notification_current_contract_build_revision_hash_v1\(\s*p_shadow_since\s*\)/,
  )
  assert.match(naturalPerRule, /canonical\.after_summary ->> 'rule_id' = p_rule_id::text/)
  assert.match(naturalPerRule, /notification_shadow_comparison_current_v1/)
  assert.match(complete, /notification_shadow_rule_natural_evidence_current_v1/)
  assert.match(complete, /from dashboard_private\.notification_rules active_rule/)
  assert.doesNotMatch(complete, /notification_shadow_deterministic_evidence/)
  assert.match(complete, /notification_no_active_rule_evidence_current_v1/)

  for (const forbidden of [
    /insert into dashboard_private\.notification_events/,
    /insert into dashboard_private\.notification_deliveries/,
    /insert into dashboard_private\.notification_dispatch_ownership_claims/,
    /insert into public\.dashboard_notifications/,
    /register_notification_external_attempt_v1/,
    /begin_notification_delivery_send_v1/,
  ]) assert.doesNotMatch(source, forbidden)

  assert.match(
    source,
    /revoke all on function public\.prepare_notification_shadow_deterministic_fixture_v1\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.match(
    source,
    /revoke all on function public\.record_notification_shadow_deterministic_evidence_v1\([\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.match(
    source,
    /revoke all on function public\.replay_notification_shadow_evidence_v1\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.doesNotMatch(
    source,
    /grant execute on function public\.(?:prepare_notification_shadow_deterministic_fixture_v1|record_notification_shadow_deterministic_evidence_v1|replay_notification_shadow_evidence_v1)/,
  )
})
