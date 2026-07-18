import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const registryUrl = new URL("../src/features/notifications/server/notification-workflow-registry.ts", import.meta.url)
const routeUrl = new URL("../src/app/api/notifications/worker/route.ts", import.meta.url)
const workerUrl = new URL("../src/features/notifications/server/notification-worker.ts", import.meta.url)
const immediateAdapterUrl = new URL("../src/features/notifications/server/adapters/immediate-notification-adapter.ts", import.meta.url)
const immediateSourceReaderUrl = new URL("../src/features/notifications/server/adapters/immediate-notification-source-reader.ts", import.meta.url)
const settingsSeedUrl = new URL("../supabase/migrations/20260716112500_notification_workflow_settings_seed.sql", import.meta.url)
const makeupTemplateSeedUrl = new URL("../supabase/migrations/20260707104347_makeup_notification_templates.sql", import.meta.url)

const PROFILE_A = "00000000-0000-4000-8000-000000000001"
const PROFILE_B = "00000000-0000-4000-8000-000000000002"
const PROFILE_C = "00000000-0000-4000-8000-000000000003"
const PROFILE_D = "00000000-0000-4000-8000-000000000004"
const RULE_ID = "00000000-0000-4000-8000-000000000010"
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000011"

function resolveInput(overrides = {}) {
  return {
    eventId: "00000000-0000-4000-8000-000000000020",
    workflowKey: "tasks",
    eventKey: "task.created",
    sourceType: "ops_task_event",
    sourceId: "00000000-0000-4000-8000-000000000030",
    sourceRevision: null,
    payloadSchemaVersion: 1,
    payload: {
      task_id: "00000000-0000-4000-8000-000000000040",
      task_title: "확인 업무",
      management_profile_ids: [PROFILE_B, PROFILE_A, PROFILE_A],
      href: "https://attacker.invalid/ignored",
    },
    rule: {
      ruleId: RULE_ID,
      ruleRevision: "1",
      templateId: TEMPLATE_ID,
      audienceKey: "management_team",
      channelKey: "in_app",
      connectionKey: null,
      ruleVariantKey: "created",
    },
    scheduledFor: "2026-07-17T10:00:00.000Z",
    ...overrides,
  }
}

const STANDARD_ALLOWED_VARIABLES = [
  { key: "workflow_label", token: "workflow_label", piiClass: "none" },
  { key: "event_label", token: "event_label", piiClass: "none" },
  { key: "occurred_at", token: "occurred_at", piiClass: "schedule" },
  { key: "deep_link", token: "deep_link", piiClass: "same_origin_path" },
]

const TRANSITION_ALLOWED_VARIABLES = [
  { key: "student_name", token: "학생", piiClass: "student_name" },
  { key: "grade", token: "학년", piiClass: "none" },
  { key: "inquiry_at", token: "문의일시", piiClass: "schedule" },
  { key: "status", token: "진행상태", piiClass: "none" },
  { key: "class_name", token: "수업", piiClass: "class_name" },
  { key: "registration_checked", token: "등록 확인", piiClass: "none" },
  { key: "teacher_name", token: "담당선생님", piiClass: "staff_name" },
  { key: "before_class", token: "전 수업", piiClass: "class_name" },
  { key: "after_class", token: "후 수업", piiClass: "class_name" },
  { key: "before_end_date", token: "전 수업 종료일", piiClass: "schedule" },
  { key: "after_start_date", token: "후 수업 시작일", piiClass: "schedule" },
  { key: "withdrawal_date", token: "퇴원일", piiClass: "schedule" },
  { key: "withdrawal_round", token: "퇴원회차", piiClass: "none" },
]

const MAKEUP_ALLOWED_VARIABLES = [
  ["process", "프로세스", "none"],
  ["status", "상태", "none"],
  ["class_name", "수업", "class_name"],
  ["subject", "과목", "none"],
  ["teacher_name", "선생님", "staff_name"],
  ["reason", "사유", "free_text"],
  ["cancel_date", "휴강일", "schedule"],
  ["makeup_at", "보강일시", "schedule"],
  ["makeup_room_spaced", "보강 강의실", "location"],
  ["makeup_room", "보강강의실", "location"],
  ["requester_name", "신청자", "staff_name"],
  ["submitted_at", "상신일시", "schedule"],
  ["revision_requested_at", "보완요청일시", "schedule"],
  ["revision_reason", "보완 사유", "free_text"],
  ["approved_at", "승인일시", "schedule"],
  ["approval_note", "승인 메모", "free_text"],
  ["rejected_at", "반려일시", "schedule"],
  ["rejected_reason", "반려 사유", "free_text"],
  ["canceled_at", "승인취소일시", "schedule"],
  ["canceled_note", "승인취소 메모", "free_text"],
  ["approver_name", "결재자", "staff_name"],
  ["fallback_title", "제목", "none"],
  ["fallback_body", "본문", "none"],
].map(([key, token, piiClass]) => ({ key, token, piiClass }))

test("registry has seven exclusive ordered workflow owners", async () => {
  const source = await readFile(registryUrl, "utf8")
  assert.deepEqual(
    [...source.matchAll(/^\s{2}(tasks|word_retests|registration|transfer|withdrawal|makeup_requests|approvals):/gm)]
      .map((match) => match[1]),
    ["tasks", "word_retests", "registration", "transfer", "withdrawal", "makeup_requests", "approvals"],
  )
  assert.match(source, /registrationNotificationAdapter/)
  assert.match(source, /return adapters\[workflowKey as NotificationWorkflowKey\] \?\? null/)

  const registry = await import(registryUrl.href)
  assert.equal(registry.getNotificationWorkflowAdapter("unknown"), null)
  assert.equal(registry.getNotificationWorkflowAdapter("registration")?.workflowKey, "registration")
})

test("six immediate adapters render the installed seed templates with canonical variables and links", async () => {
  const [registry, worker, settingsSeed, makeupTemplateSeed] = await Promise.all([
    import(registryUrl.href),
    import(workerUrl.href),
    readFile(settingsSeedUrl, "utf8"),
    readFile(makeupTemplateSeedUrl, "utf8"),
  ])
  assert.match(settingsSeed, /else '\[\{workflow_label\}\] \{event_label\}'/)
  assert.match(settingsSeed, /then E'\{담당선생님\} 선생님이 \{학생\} 학생의 전반을 신청했습니다/)
  assert.match(settingsSeed, /then E'\{담당선생님\} 선생님이 \{학생\} 학생의 퇴원을 신청했습니다/)
  assert.match(makeupTemplateSeed, /\{수업\} · \{휴강일\} 휴강 \/ \{보강일시\} · \{보강강의실\} 보강/)

  const occurredAt = "2026-07-17T10:00:00.000Z"
  const cases = [
    {
      workflowKey: "tasks",
      eventKey: "task.created",
      sourceType: "ops_task_event",
      payload: { task_id: PROFILE_A, occurred_at: occurredAt },
      template: {
        titleTemplate: "[{workflow_label}] {event_label}",
        bodyTemplate: "{event_label} · {occurred_at}\n{deep_link}",
        allowedVariables: STANDARD_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "[할 일] 할 일 생성",
      body: `할 일 생성 · ${occurredAt}\n/admin/tasks?taskId=${PROFILE_A}`,
      href: `/admin/tasks?taskId=${PROFILE_A}`,
    },
    {
      workflowKey: "word_retests",
      eventKey: "word_retest.created",
      sourceType: "ops_task_event",
      payload: { task_id: PROFILE_A, occurred_at: occurredAt },
      template: {
        titleTemplate: "[{workflow_label}] {event_label}",
        bodyTemplate: "{event_label} · {occurred_at}\n{deep_link}",
        allowedVariables: STANDARD_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "[영어 단어 재시험] 재시험 생성",
      body: `재시험 생성 · ${occurredAt}\n/admin/word-retests?taskId=${PROFILE_A}`,
      href: `/admin/word-retests?taskId=${PROFILE_A}`,
    },
    {
      workflowKey: "transfer",
      eventKey: "transfer.submitted",
      sourceType: "ops_task_event",
      payload: {
        task_id: PROFILE_A,
        student_name: "김학생",
        requester_name: "이선생",
        from_class_name: "중1 A",
        to_class_name: "중1 B",
      },
      template: {
        titleTemplate: "전반 신청 접수 · {학생}",
        bodyTemplate: "{담당선생님} 선생님이 {학생} 학생의 전반을 신청했습니다.\n전 수업: {전 수업}\n후 수업: {후 수업}",
        allowedVariables: TRANSITION_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "전반 신청 접수 · 김학생",
      body: "이선생 선생님이 김학생 학생의 전반을 신청했습니다.\n전 수업: 중1 A\n후 수업: 중1 B",
      href: `/admin/transfer?taskId=${PROFILE_A}`,
    },
    {
      workflowKey: "withdrawal",
      eventKey: "withdrawal.submitted",
      sourceType: "ops_task_event",
      payload: {
        task_id: PROFILE_A,
        student_name: "김학생",
        requester_name: "이선생",
        class_name: "중1 A",
      },
      template: {
        titleTemplate: "퇴원 신청 접수 · {학생}",
        bodyTemplate: "{담당선생님} 선생님이 {학생} 학생의 퇴원을 신청했습니다.\n수업: {수업}",
        allowedVariables: TRANSITION_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "퇴원 신청 접수 · 김학생",
      body: "이선생 선생님이 김학생 학생의 퇴원을 신청했습니다.\n수업: 중1 A",
      href: `/admin/withdrawal?taskId=${PROFILE_A}`,
    },
    {
      workflowKey: "makeup_requests",
      eventKey: "makeup.submitted",
      sourceType: "makeup_request_event",
      payload: {
        makeup_request_id: PROFILE_A,
        class_name: "중1 A",
        cancel_date: "2026-07-18",
        makeup_at: "2026-07-19 14:00",
        makeup_room: "301호",
      },
      template: {
        titleTemplate: "휴보강 신청서가 올라왔습니다",
        bodyTemplate: "{수업} · {휴강일} 휴강 / {보강일시} · {보강강의실} 보강",
        allowedVariables: MAKEUP_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "휴보강 신청서가 올라왔습니다",
      body: "중1 A · 2026-07-18 휴강 / 2026-07-19 14:00 · 301호 보강",
      href: `/admin/makeup-requests?request=${PROFILE_A}`,
    },
    {
      workflowKey: "approvals",
      eventKey: "approval.created",
      sourceType: "approval_event",
      payload: { approval_id: PROFILE_A, occurred_at: occurredAt },
      template: {
        titleTemplate: "[{workflow_label}] {event_label}",
        bodyTemplate: "{event_label} · {occurred_at}\n{deep_link}",
        allowedVariables: STANDARD_ALLOWED_VARIABLES,
        payloadSchemaVersion: 1,
      },
      title: "[전자결재] 생성",
      body: `생성 · ${occurredAt}\n/admin/approvals?approvalId=${PROFILE_A}`,
      href: `/admin/approvals?approvalId=${PROFILE_A}`,
    },
  ]

  for (const fixture of cases) {
    const adapter = registry.getNotificationWorkflowAdapter(fixture.workflowKey)
    const renderInput = {
      ...resolveInput({
        workflowKey: fixture.workflowKey,
        eventKey: fixture.eventKey,
        sourceType: fixture.sourceType,
        payload: fixture.payload,
      }),
      targetGeneration: "0",
      target: {
        targetKind: "profile",
        targetKey: `profile:${PROFILE_B}`,
        targetProfileId: PROFILE_B,
        connectionKey: null,
        targetSnapshot: { profile_id: PROFILE_B },
      },
    }
    const [renderContext, href] = await Promise.all([
      adapter.buildRenderContext(renderInput),
      adapter.buildDeepLink(renderInput),
    ])
    const rendered = worker.renderNotificationSnapshot({
      workflowKey: fixture.workflowKey,
      payloadSchemaVersion: 1,
      template: fixture.template,
      renderContext,
      href,
    })
    assert.deepEqual(rendered, {
      renderedTitle: fixture.title,
      renderedBody: fixture.body,
      href: fixture.href,
    }, fixture.workflowKey)
  }
})

test("six immediate adapters resolve one deterministic sorted target set and own no reconciler", async () => {
  const registry = await import(registryUrl.href)
  const immediateKeys = ["tasks", "word_retests", "transfer", "withdrawal", "makeup_requests", "approvals"]
  for (const workflowKey of immediateKeys) {
    const adapter = registry.getNotificationWorkflowAdapter(workflowKey)
    assert.equal(adapter?.workflowKey, workflowKey)
    assert.equal(adapter?.reconcileScheduledRules, undefined)
    assert.equal(adapter?.reconcileTargets, undefined)
  }

  const adapter = registry.getNotificationWorkflowAdapter("tasks")
  const targets = await adapter.resolveTargets(resolveInput())
  assert.equal(targets.targetGeneration, "0")
  assert.deepEqual(targets.targets.map((target) => target.targetKey), [
    `profile:${PROFILE_A}`,
    `profile:${PROFILE_B}`,
  ])
  assert.match(targets.targetSetHash, /^[0-9a-f]{64}$/)
  assert.equal(targets.targetSetHash, (await adapter.resolveTargets(resolveInput())).targetSetHash)

  const renderInput = {
    ...resolveInput(),
    targetGeneration: targets.targetGeneration,
    target: targets.targets[0],
  }
  assert.deepEqual(await adapter.buildRenderContext(renderInput), {
    workflow_label: "할 일",
    event_label: "할 일 생성",
    occurred_at: "2026-07-17T10:00:00.000Z",
    deep_link: "/admin/tasks?taskId=00000000-0000-4000-8000-000000000040",
  })
  assert.equal(
    await adapter.buildDeepLink(renderInput),
    "/admin/tasks?taskId=00000000-0000-4000-8000-000000000040",
  )

})

test("immediate adapter revalidates the authoritative source and current recipient before provider work", async () => {
  const { createImmediateNotificationAdapter } = await import(immediateAdapterUrl.href)
  const calls = []
  const adapter = createImmediateNotificationAdapter({
    workflowKey: "tasks",
    sourceTypes: ["ops_task_event"],
    linkRoot: "/admin/tasks",
    linkPayloadKey: "task_id",
    linkQueryKey: "taskId",
    workflowLabel: "할 일",
    eventLabels: { "task.created": "할 일 생성" },
    audienceProfileFields: { management_team: ["management_profile_ids"] },
    renderFields: {},
  }, {
    async revalidateAuthoritativeSource(input) {
      calls.push(input)
      return { ok: false, status: "canceled", reason: "recipient_revoked" }
    },
  })
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_A}`,
    targetProfileId: PROFILE_A,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_A },
  }
  const result = await adapter.revalidateBeforeSend({
    eventId: resolveInput().eventId,
    deliveryId: "00000000-0000-4000-8000-000000000041",
    eventKey: "task.created",
    sourceType: "ops_task_event",
    sourceId: resolveInput().sourceId,
    sourceRevision: null,
    ruleId: RULE_ID,
    ruleRevision: "1",
    targetGeneration: "0",
    scheduledFor: "2026-07-17T10:00:00.000Z",
    target,
  })
  assert.deepEqual(result, { ok: false, status: "canceled", reason: "recipient_revoked" })
  assert.deepEqual(calls, [{
    workflowKey: "tasks",
    eventId: resolveInput().eventId,
    deliveryId: "00000000-0000-4000-8000-000000000041",
    eventKey: "task.created",
    sourceType: "ops_task_event",
    sourceId: resolveInput().sourceId,
    sourceRevision: null,
    ruleId: RULE_ID,
    ruleRevision: "1",
    targetGeneration: "0",
    scheduledFor: "2026-07-17T10:00:00.000Z",
    target,
  }])
})

test("production immediate source reader uses one closed service-role RPC and rejects malformed success", async () => {
  const source = await readFile(immediateSourceReaderUrl, "utf8").catch(() => "")
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(source, /revalidate_immediate_notification_delivery_v1/)
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/)

  const { createImmediateNotificationRpcDependencies } = await import(immediateSourceReaderUrl.href)
  const calls = []
  const dependencies = createImmediateNotificationRpcDependencies({
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      return { ok: false, status: "canceled", reason: "recipient_revoked" }
    },
  })
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_A}`,
    targetProfileId: PROFILE_A,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_A },
  }
  const input = {
    workflowKey: "approvals",
    eventId: resolveInput().eventId,
    deliveryId: "00000000-0000-4000-8000-000000000041",
    eventKey: "approval.approver_changed",
    sourceType: "approval_event",
    sourceId: resolveInput().sourceId,
    sourceRevision: null,
    ruleId: RULE_ID,
    ruleRevision: "7",
    targetGeneration: "0",
    scheduledFor: "2026-07-17T10:00:00.000Z",
    target,
  }
  assert.deepEqual(await dependencies.revalidateAuthoritativeSource(input), {
    ok: false,
    status: "canceled",
    reason: "recipient_revoked",
  })
  assert.deepEqual(calls, [{
    name: "revalidate_immediate_notification_delivery_v1",
    parameters: {
      p_workflow_key: "approvals",
      p_event_id: resolveInput().eventId,
      p_delivery_id: "00000000-0000-4000-8000-000000000041",
      p_event_key: "approval.approver_changed",
      p_source_type: "approval_event",
      p_source_id: resolveInput().sourceId,
      p_source_revision: null,
      p_rule_id: RULE_ID,
      p_rule_revision: "7",
      p_target_generation: "0",
      p_scheduled_for: "2026-07-17T10:00:00.000Z",
      p_target: {
        target_kind: "profile",
        target_key: `profile:${PROFILE_A}`,
        target_profile_id: PROFILE_A,
        connection_key: null,
        target_snapshot: { profile_id: PROFILE_A },
      },
    },
  }])

  const malformed = createImmediateNotificationRpcDependencies({
    async rpc() {
      return { ok: true, ignored: "unsafe" }
    },
  })
  assert.deepEqual(await malformed.revalidateAuthoritativeSource(input), {
    ok: false,
    status: "failed",
    reason: "payload_schema_unsupported",
  })
})

test("UUID immediate event sources require null sourceRevision before every adapter callback", async () => {
  const { createImmediateNotificationAdapter } = await import(immediateAdapterUrl.href)
  let authoritativeReads = 0
  const adapter = createImmediateNotificationAdapter({
    workflowKey: "tasks",
    sourceTypes: ["ops_task_event"],
    linkRoot: "/admin/tasks",
    linkPayloadKey: "task_id",
    linkQueryKey: "taskId",
    workflowLabel: "할 일",
    eventLabels: { "task.created": "할 일 생성" },
    audienceProfileFields: { management_team: ["management_profile_ids"] },
    renderFields: {},
  }, {
    async revalidateAuthoritativeSource() {
      authoritativeReads += 1
      return { ok: true }
    },
  })
  const invalidResolveInput = resolveInput({ sourceRevision: "1" })
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_A}`,
    targetProfileId: PROFILE_A,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_A },
  }
  const invalidRenderInput = {
    ...invalidResolveInput,
    targetGeneration: "0",
    target,
  }

  await assert.rejects(
    adapter.resolveTargets(invalidResolveInput),
    /notification_payload_schema_unsupported/,
  )
  await assert.rejects(
    adapter.buildRenderContext(invalidRenderInput),
    /notification_payload_schema_unsupported/,
  )
  await assert.rejects(
    adapter.buildDeepLink(invalidRenderInput),
    /notification_payload_schema_unsupported/,
  )
  assert.deepEqual(await adapter.revalidateBeforeSend({
    eventId: invalidResolveInput.eventId,
    deliveryId: "00000000-0000-4000-8000-000000000041",
    eventKey: invalidResolveInput.eventKey,
    sourceType: invalidResolveInput.sourceType,
    sourceId: invalidResolveInput.sourceId,
    sourceRevision: "1",
    ruleId: RULE_ID,
    ruleRevision: "1",
    targetGeneration: "0",
    scheduledFor: invalidResolveInput.scheduledFor,
    target,
  }), { ok: false, status: "failed", reason: "payload_schema_unsupported" })
  assert.equal(authoritativeReads, 0)
})

test("six immediate adapters resolve only their exact profile and Chat audiences", async () => {
  const registry = await import(registryUrl.href)
  const payload = {
    task_id: "00000000-0000-4000-8000-000000000060",
    makeup_request_id: "00000000-0000-4000-8000-000000000061",
    approval_id: "00000000-0000-4000-8000-000000000062",
    requester_profile_id: PROFILE_A,
    primary_assignee_profile_id: PROFILE_B,
    secondary_assignee_profile_ids: [PROFILE_D, PROFILE_C, PROFILE_C],
    management_profile_ids: [PROFILE_D, PROFILE_A],
    requesting_teacher_profile_id: PROFILE_A,
    assigned_assistant_profile_id: PROFILE_B,
    approver_profile_id: PROFILE_B,
    executive_profile_ids: [PROFILE_C],
    subject_profile_ids: [PROFILE_D],
    approval_group: "math_middle",
  }
  const sourceTypes = {
    tasks: "ops_task_event",
    word_retests: "ops_task_event",
    transfer: "ops_task_event",
    withdrawal: "ops_task_event",
    makeup_requests: "makeup_request_event",
    approvals: "approval_event",
  }
  const cases = [
    ["tasks", "requester_profile", "in_app", [`profile:${PROFILE_A}`]],
    ["tasks", "primary_assignee", "in_app", [`profile:${PROFILE_B}`]],
    ["tasks", "secondary_assignee", "in_app", [`profile:${PROFILE_C}`, `profile:${PROFILE_D}`]],
    ["tasks", "management_team", "in_app", [`profile:${PROFILE_A}`, `profile:${PROFILE_D}`]],
    ["tasks", "management_team", "google_chat", ["connection:google_chat.management"]],
    ["word_retests", "requesting_teacher", "in_app", [`profile:${PROFILE_A}`]],
    ["word_retests", "assigned_assistant", "in_app", [`profile:${PROFILE_B}`]],
    ["word_retests", "secondary_assignee", "in_app", [`profile:${PROFILE_C}`, `profile:${PROFILE_D}`]],
    ["word_retests", "management_team", "google_chat", ["connection:google_chat.management"]],
    ["transfer", "requester_profile", "in_app", [`profile:${PROFILE_A}`]],
    ["transfer", "management_team", "google_chat", ["connection:google_chat.management"]],
    ["withdrawal", "requester_profile", "in_app", [`profile:${PROFILE_A}`]],
    ["withdrawal", "management_team", "google_chat", ["connection:google_chat.management"]],
    ["makeup_requests", "requester_profile", "in_app", [`profile:${PROFILE_A}`]],
    ["makeup_requests", "approver_profile", "in_app", [`profile:${PROFILE_B}`]],
    ["makeup_requests", "management_team", "in_app", [`profile:${PROFILE_A}`, `profile:${PROFILE_D}`]],
    ["makeup_requests", "executive_team", "google_chat", ["connection:google_chat.executive"]],
    ["makeup_requests", "subject_team", "google_chat", ["connection:google_chat.math"]],
    ["approvals", "requester_profile", "in_app", [`profile:${PROFILE_A}`]],
    ["approvals", "approver_profile", "in_app", [`profile:${PROFILE_B}`]],
    ["approvals", "management_team", "google_chat", ["connection:google_chat.management"]],
  ]
  for (const [workflowKey, audienceKey, channelKey, expected] of cases) {
    const adapter = registry.getNotificationWorkflowAdapter(workflowKey)
    const targets = await adapter.resolveTargets(resolveInput({
      workflowKey,
      sourceType: sourceTypes[workflowKey],
      payload,
      rule: {
        ...resolveInput().rule,
        audienceKey,
        channelKey,
      },
    }))
    assert.deepEqual(targets.targets.map((target) => target.targetKey), expected, `${workflowKey}/${audienceKey}/${channelKey}`)
    assert.equal(targets.targetGeneration, "0")
  }

  const makeup = registry.getNotificationWorkflowAdapter("makeup_requests")
  for (const [subject, expected] of [
    ["math_high", "connection:google_chat.math"],
    ["english", "connection:google_chat.english"],
    ["unknown", "audience:subject_team"],
  ]) {
    const targets = await makeup.resolveTargets(resolveInput({
      workflowKey: "makeup_requests",
      sourceType: "makeup_request_event",
      payload: { ...payload, approval_group: subject },
      rule: { ...resolveInput().rule, audienceKey: "subject_team", channelKey: "google_chat" },
    }))
    assert.deepEqual(targets.targets.map((target) => target.targetKey), [expected])
  }
})

test("immediate adapters preserve no-recipient evidence with one canonical audience target", async () => {
  const registry = await import(registryUrl.href)
  const tasks = registry.getNotificationWorkflowAdapter("tasks")
  const noProfiles = await tasks.resolveTargets(resolveInput({
    payload: {
      task_id: "00000000-0000-4000-8000-000000000060",
      management_profile_ids: ["not-a-profile-id"],
    },
  }))
  const audienceTarget = {
    targetKind: "audience",
    targetKey: "audience:management_team",
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: { audience_key: "management_team" },
  }
  assert.deepEqual(noProfiles.targets, [audienceTarget])
  assert.equal(noProfiles.targetSetHash, (await tasks.resolveTargets(resolveInput({
    payload: {
      task_id: "00000000-0000-4000-8000-000000000060",
      management_profile_ids: ["not-a-profile-id"],
    },
  }))).targetSetHash)

  const makeup = registry.getNotificationWorkflowAdapter("makeup_requests")
  const unknownSubject = await makeup.resolveTargets(resolveInput({
    workflowKey: "makeup_requests",
    sourceType: "makeup_request_event",
    payload: {
      makeup_request_id: "00000000-0000-4000-8000-000000000061",
      approval_group: "unknown",
    },
    rule: {
      ...resolveInput().rule,
      audienceKey: "subject_team",
      channelKey: "google_chat",
    },
  }))
  assert.deepEqual(unknownSubject.targets, [{
    targetKind: "audience",
    targetKey: "audience:subject_team",
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: { audience_key: "subject_team" },
  }])
})

test("휴보강 과목 Chat은 권위 approval_group 세 값만 허용하고 audience와 connection 불일치를 닫는다", async () => {
  const registry = await import(registryUrl.href)
  const adapter = registry.getNotificationWorkflowAdapter("makeup_requests")
  for (const subject of ["math", "수학", "영어", "ENGLISH", "Math_High", "unknown"]) {
    const request = resolveInput({
      workflowKey: "makeup_requests",
      eventKey: "makeup.submitted",
      sourceType: "makeup_request_event",
      payload: { makeup_request_id: PROFILE_A, approval_group: subject, subject: "영어" },
      rule: {
        ...resolveInput().rule,
        audienceKey: "subject_team",
        channelKey: "google_chat",
        connectionKey: null,
      },
    })
    if (subject === "unknown") {
      const targets = await adapter.resolveTargets(request)
      assert.deepEqual(targets.targets, [{
        targetKind: "audience",
        targetKey: "audience:subject_team",
        targetProfileId: null,
        connectionKey: null,
        targetSnapshot: { audience_key: "subject_team" },
      }], subject)
    } else {
      await assert.rejects(adapter.resolveTargets(request), /notification_payload_schema_unsupported/, subject)
    }
  }
  await assert.rejects(
    adapter.resolveTargets(resolveInput({
      workflowKey: "makeup_requests",
      eventKey: "makeup.submitted",
      sourceType: "makeup_request_event",
      payload: { makeup_request_id: PROFILE_A, approval_group: "english" },
      rule: {
        ...resolveInput().rule,
        audienceKey: "management_team",
        channelKey: "google_chat",
        connectionKey: "google_chat.executive",
      },
    })),
    /notification_payload_schema_unsupported/,
  )
  await assert.rejects(
    adapter.resolveTargets(resolveInput({
      workflowKey: "makeup_requests",
      eventKey: "makeup.submitted",
      sourceType: "makeup_request_event",
      payload: { makeup_request_id: PROFILE_A, approval_group: "english" },
      rule: {
        ...resolveInput().rule,
        audienceKey: "unknown_audience",
        channelKey: "in_app",
        connectionKey: null,
      },
    })),
    /notification_payload_schema_unsupported/,
  )
})

test("callback-free workflow target reconciliation fails closed without apply or provider work", async () => {
  const [{ createNotificationWorkerRuntime }, registry] = await Promise.all([
    import(workerUrl.href),
    import(registryUrl.href),
  ])
  const calls = []
  let providerLookups = 0
  const worker = createNotificationWorkerRuntime({
    getAdapter: registry.getNotificationWorkflowAdapter,
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      if (name === "claim_notification_target_reconciliation_jobs_v1") {
        return [{
          job_id: "00000000-0000-4000-8000-000000000050",
          claim_token: "00000000-0000-4000-8000-000000000051",
          workflow_key: "tasks",
        }]
      }
      if (name === "reap_notification_leases_v1") return { reaped_count: 0 }
      if (name.startsWith("claim_notification_")) return []
      return {}
    },
    getProvider() {
      providerLookups += 1
      return null
    },
    createRunId: () => "00000000-0000-4000-8000-000000000052",
  })

  const result = await worker.runBatch({ workerId: "registry-fixture", batchSize: 2, leaseSeconds: 30 })
  assert.equal(result.targetReconciliation, 1)
  const finish = calls.find((call) => call.name === "finish_notification_orchestration_job_v1")
  assert.equal(finish.parameters.p_job_kind, "target_reconciliation")
  assert.equal(finish.parameters.p_disposition, "failed")
  assert.equal(finish.parameters.p_error_code, "reconciler_missing")
  assert.equal(calls.some((call) => call.name === "apply_notification_target_reconciliation_batch_v1"), false)
  assert.equal(providerLookups, 0)
})

test("worker route authenticates with timing-safe Bearer comparison before running a batch", async () => {
  const source = await readFile(routeUrl, "utf8")
  assert.match(source, /timingSafeEqual/)
  assert.match(source, /Bearer \$\{workerSecret\}/)
  assert.match(source, /if \(!authorized\)[\s\S]*status:\s*401[\s\S]*worker\.runBatch/)
  assert.match(source, /export async function POST/)
  assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)/)
})
