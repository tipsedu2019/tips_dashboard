import assert from "node:assert/strict"
import test from "node:test"

const adapterModuleUrl = new URL(
  "../src/features/notifications/server/adapters/registration-notification-adapter.ts",
  import.meta.url,
)
const workerModuleUrl = new URL(
  "../src/features/notifications/server/notification-worker.ts",
  import.meta.url,
)

const APPOINTMENT_A = "81000000-0000-4000-8000-000000000001"
const APPOINTMENT_B = "81000000-0000-4000-8000-000000000002"
const TASK_A = "81000000-0000-4000-8000-000000000011"
const TASK_B = "81000000-0000-4000-8000-000000000012"
const TRACK_ENGLISH = "81000000-0000-4000-8000-000000000021"
const TRACK_MATH = "81000000-0000-4000-8000-000000000022"
const PROFILE_A = "81000000-0000-4000-8000-000000000031"
const PROFILE_B = "81000000-0000-4000-8000-000000000032"
const PROFILE_C = "81000000-0000-4000-8000-000000000033"
const EVENT_A = "81000000-0000-4000-8000-000000000041"
const EVENT_B = "81000000-0000-4000-8000-000000000042"
const RULE_PREVIOUS = "81000000-0000-4000-8000-000000000051"
const RULE_SAME_DAY = "81000000-0000-4000-8000-000000000052"
const RULE_OFFSET = "81000000-0000-4000-8000-000000000053"
const RULE_CHAT = "81000000-0000-4000-8000-000000000054"
const TEMPLATE_A = "81000000-0000-4000-8000-000000000061"
const BIG_GENERATION = "9007199254740993123456789"

function rule(overrides = {}) {
  return {
    ruleId: RULE_SAME_DAY,
    ruleRevision: "7",
    templateId: TEMPLATE_A,
    audienceKey: "management_team",
    channelKey: "in_app",
    connectionKey: null,
    ruleVariantKey: "same_day_at",
    scheduleKey: "same_day_at",
    scheduleConfig: {
      anchor_key: "appointment_scheduled_at",
      local_time: "14:00",
      timezone: "Asia/Seoul",
    },
    enabled: true,
    ...overrides,
  }
}

function levelTestSource(overrides = {}) {
  return {
    appointmentId: APPOINTMENT_A,
    taskId: TASK_A,
    studentName: "김학생",
    kind: "level_test",
    scheduledAt: "2026-07-22T06:00:00.000Z",
    place: "3층 테스트실",
    status: "scheduled",
    notificationRevision: 7,
    recipientRevision: BIG_GENERATION,
    managementProfileIds: [PROFILE_B, PROFILE_A, PROFILE_A],
    directorProfileIds: [PROFILE_B, PROFILE_A, PROFILE_A],
    participants: [
      { trackId: TRACK_MATH, subject: "수학", directorProfileId: PROFILE_B },
      { trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A },
    ],
    currentRules: [rule()],
    ...overrides,
  }
}

function visitSource(overrides = {}) {
  return levelTestSource({
    kind: "visit_consultation",
    place: "2층 상담실",
    participants: [
      { trackId: TRACK_MATH, subject: "수학", directorProfileId: PROFILE_B },
      { trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A },
      { trackId: `${TRACK_ENGLISH.slice(0, -1)}3`, subject: "영어", directorProfileId: PROFILE_A },
    ],
    currentRules: [rule({ audienceKey: "track_director" })],
    ...overrides,
  })
}

function createFixtureDependencies(input = {}) {
  const state = {
    current: input.current ?? levelTestSource(),
    sourcePages: input.sourcePages ?? [],
    targetPages: input.targetPages ?? [],
    sourceCalls: [],
    targetCalls: [],
  }
  return {
    state,
    dependencies: {
      now: input.now ?? (() => new Date("2026-07-22T04:30:00.000Z")),
      async getSourceSnapshot(appointmentId) {
        if (!state.current || state.current.appointmentId !== appointmentId) return null
        return structuredClone(state.current)
      },
      async listScheduledSources(request) {
        state.sourceCalls.push(structuredClone(request))
        const index = request.cursor === null ? 0 : Number(request.cursor.replace("page:", ""))
        return structuredClone(state.sourcePages[index] ?? { items: [], nextCursor: null, done: true })
      },
      async listTargetItems(request) {
        state.targetCalls.push(structuredClone(request))
        const index = request.cursor === null ? 0 : Number(request.cursor.replace("target:", ""))
        return structuredClone(state.targetPages[index] ?? { items: [], nextCursor: null, done: true })
      },
    },
  }
}

function canonicalPayload(source) {
  const participants = [...source.participants].sort((left, right) => (
    (left.subject === right.subject ? 0 : left.subject === "영어" ? -1 : 1)
    || left.trackId.localeCompare(right.trackId)
  ))
  return {
    actor_kind: "system",
    system_source: "registration_reminder_materializer",
    task: { id: source.taskId, student_name: source.studentName },
    appointment: {
      kind: source.kind,
      scheduled_at: source.scheduledAt,
      place: source.place,
    },
    track_ids: participants.map((item) => item.trackId),
    subjects: participants.map((item) => item.subject),
  }
}

function resolveInput(source, currentRule, overrides = {}) {
  return {
    eventId: EVENT_A,
    workflowKey: "registration",
    eventKey: "registration.appointment_reminder_due",
    sourceType: "registration_appointment",
    sourceId: source.appointmentId,
    sourceRevision: String(source.notificationRevision),
    payloadSchemaVersion: 2,
    payload: canonicalPayload(source),
    rule: currentRule,
    scheduledFor: "2026-07-22T05:00:00.000Z",
    ...overrides,
  }
}

function revalidationInput(source, currentRule, target, overrides = {}) {
  return {
    eventId: EVENT_A,
    deliveryId: "81000000-0000-4000-8000-000000000071",
    eventKey: "registration.appointment_reminder_due",
    sourceType: "registration_appointment",
    sourceId: source.appointmentId,
    sourceRevision: String(source.notificationRevision),
    ruleId: currentRule.ruleId,
    ruleRevision: currentRule.ruleRevision,
    targetGeneration: source.recipientRevision,
    scheduledFor: "2026-07-22T05:00:00.000Z",
    target,
    ...overrides,
  }
}

function directorRule(overrides = {}) {
  return rule({
    audienceKey: "track_director",
    ...overrides,
  })
}

test("등록 adapter는 규칙 하나의 정확한 수신자를 정렬하고 전체 집합 hash와 bigint 세대를 보존한다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const { hashNotificationTargets } = await import(workerModuleUrl)
  const fixture = createFixtureDependencies()
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const source = fixture.state.current

  const management = await adapter.resolveTargets(resolveInput(source, rule()))
  assert.equal(management.targetGeneration, BIG_GENERATION)
  assert.deepEqual(management.targets, [
    {
      targetKind: "profile",
      targetKey: `profile:${PROFILE_A}`,
      targetProfileId: PROFILE_A,
      connectionKey: null,
      targetSnapshot: { profile_id: PROFILE_A },
    },
    {
      targetKind: "profile",
      targetKey: `profile:${PROFILE_B}`,
      targetProfileId: PROFILE_B,
      connectionKey: null,
      targetSnapshot: { profile_id: PROFILE_B },
    },
  ])
  assert.equal(management.targetSetHash, hashNotificationTargets(management.targets))
  assert.match(management.targetSetHash, /^[a-f0-9]{64}$/)
  assert.ok(Object.isFrozen(management))
  assert.ok(Object.isFrozen(management.targets))
  assert.ok(management.targets.every((target) => Object.isFrozen(target) && Object.isFrozen(target.targetSnapshot)))

  fixture.state.current = visitSource()
  const directors = await adapter.resolveTargets(resolveInput(fixture.state.current, directorRule()))
  assert.deepEqual(directors.targets.map((target) => target.targetKey), [
    `profile:${PROFILE_A}`,
    `profile:${PROFILE_B}`,
  ])

  const chatRule = rule({
    ruleId: RULE_CHAT,
    audienceKey: "management_team",
    channelKey: "google_chat",
    connectionKey: "google_chat.management",
  })
  fixture.state.current = visitSource({ currentRules: [chatRule] })
  const chat = await adapter.resolveTargets(resolveInput(fixture.state.current, chatRule))
  assert.deepEqual(chat.targets, [{
    targetKind: "connection",
    targetKey: "connection:google_chat.management",
    targetProfileId: null,
    connectionKey: "google_chat.management",
    targetSnapshot: { connection_key: "google_chat.management" },
  }])

  const claimRuleWithoutConnection = { ...chatRule, connectionKey: null }
  const claimedChat = await adapter.resolveTargets(
    resolveInput(fixture.state.current, claimRuleWithoutConnection),
  )
  assert.deepEqual(
    claimedChat.targets,
    chat.targets,
    "공통 claim이 비워 둔 관리팀 Chat 연결은 승인된 고정 연결로 정규화해야 한다",
  )

  await assert.rejects(
    adapter.resolveTargets(resolveInput(fixture.state.current, {
      ...chatRule,
      connectionKey: "google_chat.wrong",
    })),
    /payload_schema_unsupported/,
  )
})

test("등록 adapter의 A→B→A 대상 hash는 집합으로 되돌아오고 세대 문자열은 숫자로 변환되지 않는다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const fixture = createFixtureDependencies({ current: visitSource() })
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const currentRule = directorRule()

  fixture.state.current = visitSource({
    recipientRevision: "1",
    directorProfileIds: [PROFILE_A],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A }],
  })
  const firstA = await adapter.resolveTargets(resolveInput(fixture.state.current, currentRule))
  fixture.state.current = visitSource({
    recipientRevision: "2",
    directorProfileIds: [PROFILE_B],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_B }],
  })
  const middleB = await adapter.resolveTargets(resolveInput(fixture.state.current, currentRule))
  fixture.state.current = visitSource({
    recipientRevision: "9007199254740993123456791",
    directorProfileIds: [PROFILE_A],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A }],
  })
  const finalA = await adapter.resolveTargets(resolveInput(fixture.state.current, currentRule))

  assert.equal(firstA.targetSetHash, finalA.targetSetHash)
  assert.notEqual(firstA.targetSetHash, middleB.targetSetHash)
  assert.equal(finalA.targetGeneration, "9007199254740993123456791")
})

test("렌더 변수와 딥 링크는 정확한 immutable payload를 확인한 뒤 정규 예약 snapshot에서 만든다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const fixture = createFixtureDependencies()
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const source = fixture.state.current
  const targets = await adapter.resolveTargets(resolveInput(source, rule()))
  const input = {
    ...resolveInput(source, rule()),
    targetGeneration: targets.targetGeneration,
    target: targets.targets[0],
  }

  assert.deepEqual(await adapter.buildRenderContext(input), {
    student_name: "김학생",
    appointment_kind: "레벨테스트",
    scheduled_at: "2026-07-22 15:00 KST",
    place: "3층 테스트실",
    subjects: "영어 · 수학",
  })
  assert.equal(
    await adapter.buildDeepLink(input),
    `/admin/registration?taskId=${TASK_A}&appointmentId=${APPOINTMENT_A}&view=calendar`,
  )
  assert.ok(Object.values(await adapter.buildRenderContext(input)).every((value) => typeof value === "string"))

  const malformed = {
    ...input,
    payload: { ...canonicalPayload(source), href: "https://attacker.invalid/path" },
  }
  await assert.rejects(adapter.resolveTargets(malformed), /payload_schema_unsupported/)
  await assert.rejects(adapter.buildRenderContext(malformed), /payload_schema_unsupported/)
  await assert.rejects(adapter.buildDeepLink(malformed), /payload_schema_unsupported/)

  const nonCanonicalSchedule = {
    ...input,
    payload: {
      ...canonicalPayload(source),
      appointment: {
        ...canonicalPayload(source).appointment,
        scheduled_at: "2026-07-22 06:00:00Z",
      },
    },
  }
  await assert.rejects(adapter.resolveTargets(nonCanonicalSchedule), /payload_schema_unsupported/)
})

test("fanout materialize 전 현재 source·revision·rule·schedule이 하나라도 달라지면 실패 폐쇄한다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const fixture = createFixtureDependencies()
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const source = fixture.state.current
  const input = resolveInput(source, rule())

  fixture.state.current = levelTestSource({ status: "canceled" })
  await assert.rejects(adapter.resolveTargets(input), /payload_schema_unsupported/)
  fixture.state.current = levelTestSource()
  await assert.rejects(
    adapter.resolveTargets({ ...input, sourceRevision: "6" }),
    /payload_schema_unsupported/,
  )
  fixture.state.current = levelTestSource({ currentRules: [rule({ ruleRevision: "8" })] })
  await assert.rejects(adapter.resolveTargets(input), /payload_schema_unsupported/)
  fixture.state.current = levelTestSource()
  await assert.rejects(
    adapter.resolveTargets({ ...input, scheduledFor: "2026-07-22T05:01:00.000Z" }),
    /schedule_validation_failed/,
  )
})

test("due fanout은 예약 전이라면 scheduledFor 도달 뒤에도 정상 렌더하고 예약 뒤에는 닫힌다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const dueFixture = createFixtureDependencies({
    now: () => new Date("2026-07-22T05:30:00.000Z"),
  })
  const dueAdapter = createRegistrationNotificationAdapter(dueFixture.dependencies)
  const source = dueFixture.state.current
  const currentRule = rule()
  const targets = await dueAdapter.resolveTargets(resolveInput(source, currentRule))
  assert.equal(targets.targets.length, 2)
  assert.deepEqual(
    await dueAdapter.buildRenderContext({
      ...resolveInput(source, currentRule),
      targetGeneration: targets.targetGeneration,
      target: targets.targets[0],
    }),
    {
      student_name: "김학생",
      appointment_kind: "레벨테스트",
      scheduled_at: "2026-07-22 15:00 KST",
      place: "3층 테스트실",
      subjects: "영어 · 수학",
    },
  )

  const closedFixture = createFixtureDependencies({
    now: () => new Date("2026-07-22T06:00:00.000Z"),
  })
  const closedAdapter = createRegistrationNotificationAdapter(closedFixture.dependencies)
  await assert.rejects(
    closedAdapter.resolveTargets(resolveInput(closedFixture.state.current, currentRule)),
    /schedule_validation_failed/,
  )
})

test("발송 직전 검증은 stale·철회·닫힌 재시도창·잘못된 일정을 정확한 닫힌 사유로 구분한다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const fixture = createFixtureDependencies()
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const source = fixture.state.current
  const currentRule = rule()
  const target = (await adapter.resolveTargets(resolveInput(source, currentRule))).targets[0]
  const base = revalidationInput(source, currentRule, target)

  assert.deepEqual(await adapter.revalidateBeforeSend(base), { ok: true })

  fixture.state.current = null
  assert.deepEqual(await adapter.revalidateBeforeSend(base), {
    ok: false, status: "canceled", reason: "source_status_changed",
  })
  fixture.state.current = levelTestSource({ status: "completed" })
  assert.deepEqual(await adapter.revalidateBeforeSend(base), {
    ok: false, status: "canceled", reason: "source_status_changed",
  })
  fixture.state.current = levelTestSource()

  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, sourceRevision: "6" }), {
    ok: false, status: "canceled", reason: "source_revision_changed",
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, scheduledFor: "2026-07-22T05:01:00.000Z" }), {
    ok: false, status: "canceled", reason: "source_schedule_changed",
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, ruleRevision: "6" }), {
    ok: false, status: "canceled", reason: "rule_revision_changed",
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, targetGeneration: "1" }), {
    ok: false, status: "canceled", reason: "recipient_revoked",
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({
    ...base,
    target: { ...target, targetKey: `profile:${PROFILE_C}`, targetProfileId: PROFILE_C },
  }), {
    ok: false, status: "canceled", reason: "recipient_revoked",
  })

  const reachedFixture = createFixtureDependencies({
    now: () => new Date("2026-07-22T06:00:00.000Z"),
  })
  const reached = createRegistrationNotificationAdapter(reachedFixture.dependencies)
  assert.deepEqual(await reached.revalidateBeforeSend(base), {
    ok: false, status: "failed", reason: "retry_window_closed",
  })

  const managementChatRule = rule({
    ruleId: RULE_CHAT,
    audienceKey: "management_team",
    channelKey: "google_chat",
    connectionKey: "google_chat.management",
  })
  fixture.state.current = visitSource({
    recipientRevision: "2",
    currentRules: [managementChatRule],
  })
  const managementChatTarget = (
    await adapter.resolveTargets(resolveInput(fixture.state.current, managementChatRule))
  ).targets[0]
  assert.deepEqual(await adapter.revalidateBeforeSend(revalidationInput(
    fixture.state.current,
    managementChatRule,
    managementChatTarget,
    { targetGeneration: "1" },
  )), { ok: true }, "director 세대 변경은 그대로인 관리팀 Chat 수신자를 철회하지 않는다")

  fixture.state.current = levelTestSource({
    currentRules: [rule({ scheduleConfig: {
      anchor_key: "appointment_scheduled_at",
      local_time: "25:00",
      timezone: "Asia/Seoul",
    } })],
  })
  assert.deepEqual(await adapter.revalidateBeforeSend(base), {
    ok: false, status: "failed", reason: "schedule_validation_failed",
  })

  fixture.state.current = levelTestSource({
    currentRules: [rule({ scheduleConfig: {
      anchor_key: "appointment_scheduled_at",
      local_time: "15:00",
      timezone: "Asia/Seoul",
    } })],
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({
    ...base,
    scheduledFor: fixture.state.current.scheduledAt,
  }), {
    ok: false, status: "failed", reason: "schedule_validation_failed",
  })
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, sourceType: "browser_payload" }), {
    ok: false, status: "failed", reason: "payload_schema_unsupported",
  })
})

test("완료·취소 snapshot은 참여 트랙이 비어 있어도 source 상태 변경으로 안전하게 닫힌다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const scheduled = levelTestSource()
  const currentRule = rule()
  const fixture = createFixtureDependencies({
    current: levelTestSource({
      status: "completed",
      participants: [],
      directorProfileIds: [],
    }),
  })
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const target = {
    targetKind: "profile",
    targetKey: `profile:${PROFILE_A}`,
    targetProfileId: PROFILE_A,
    connectionKey: null,
    targetSnapshot: { profile_id: PROFILE_A },
  }

  assert.deepEqual(
    await adapter.revalidateBeforeSend(revalidationInput(scheduled, currentRule, target)),
    { ok: false, status: "canceled", reason: "source_status_changed" },
  )

  fixture.state.current = levelTestSource({
    status: "canceled",
    participants: [],
    directorProfileIds: [],
  })
  assert.deepEqual(
    await adapter.revalidateBeforeSend(revalidationInput(scheduled, currentRule, target)),
    { ok: false, status: "canceled", reason: "source_status_changed" },
  )

  fixture.state.current = levelTestSource({ participants: [], directorProfileIds: [] })
  assert.deepEqual(
    await adapter.revalidateBeforeSend(revalidationInput(scheduled, currentRule, target)),
    { ok: false, status: "failed", reason: "payload_schema_unsupported" },
  )
})

test("규칙 재계산은 예약시각/id 안정 순서로 page를 유지하고 미래 KST occurrence만 만든다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const previous = rule({
    ruleId: RULE_PREVIOUS,
    ruleRevision: "11",
    ruleVariantKey: "previous_day_at",
    scheduleKey: "previous_day_at",
  })
  const sameDay = rule({ ruleId: RULE_SAME_DAY, ruleRevision: "12" })
  const offset = rule({
    ruleId: RULE_OFFSET,
    ruleRevision: "13",
    ruleVariantKey: "offset_before",
    scheduleKey: "offset_before",
    scheduleConfig: {
      anchor_key: "appointment_scheduled_at",
      lead_minutes: 60,
      timezone: "Asia/Seoul",
    },
  })
  const later = levelTestSource({
    appointmentId: APPOINTMENT_A,
    taskId: TASK_A,
    scheduledAt: "2026-07-22T06:00:00.000Z",
    currentRules: [offset, previous, sameDay],
  })
  const earlier = levelTestSource({
    appointmentId: APPOINTMENT_B,
    taskId: TASK_B,
    scheduledAt: "2026-07-21T06:00:00.000Z",
    currentRules: [sameDay, previous, offset],
  })
  const fixture = createFixtureDependencies({
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    sourcePages: [
      { items: [later, earlier], nextCursor: "page:1", done: false },
      { items: [], nextCursor: null, done: true },
    ],
  })
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const reconciliationInput = {
    jobId: "81000000-0000-4000-8000-000000000081",
    claimToken: "81000000-0000-4000-8000-000000000082",
    workflowKey: "registration",
    ruleRevisionMap: {
      [RULE_PREVIOUS]: "11",
      [RULE_SAME_DAY]: "12",
      [RULE_OFFSET]: "13",
    },
    cursor: null,
    batchSize: 2,
  }
  const first = await adapter.reconcileScheduledRules(reconciliationInput)

  assert.deepEqual(first.sources.map((item) => item.sourceId), [APPOINTMENT_B, APPOINTMENT_A])
  assert.equal(first.occurrences.length, 6)
  assert.deepEqual(
    first.occurrences.filter((item) => item.sourceId === APPOINTMENT_B).map((item) => item.scheduledFor),
    [
      "2026-07-20T05:00:00.000Z",
      "2026-07-21T05:00:00.000Z",
      "2026-07-21T05:00:00.000Z",
    ],
  )
  assert.ok(first.occurrences.every((item) => (
    item.eventKey === "registration.appointment_reminder_due"
    && item.sourceType === "registration_appointment"
    && item.payloadSchemaVersion === 2
    && item.occurrenceKey.includes(`:source_revision:${item.sourceRevision}:rule:${item.materializedRuleId}:rule_revision:${item.materializedRuleRevision}`)
    && !item.occurrenceKey.includes(item.scheduledFor)
  )))
  assert.deepEqual(first.occurrences[0].payload, {
    actor_kind: "system",
    system_source: "registration_reminder_materializer",
    task: { id: TASK_B, student_name: "김학생" },
    appointment: {
      kind: "level_test",
      scheduled_at: "2026-07-21T06:00:00.000Z",
      place: "3층 테스트실",
    },
    track_ids: [TRACK_ENGLISH, TRACK_MATH],
    subjects: ["영어", "수학"],
  })
  assert.ok(first.occurrences.every((item) => item.occurredAt === item.scheduledFor))
  assert.equal(first.nextCursor, "page:1")
  assert.equal(first.done, false)

  const second = await adapter.reconcileScheduledRules({ ...reconciliationInput, cursor: first.nextCursor })
  assert.deepEqual(second, { sources: [], occurrences: [], nextCursor: null, done: true })
  assert.deepEqual(fixture.state.sourceCalls, [
    { cursor: null, batchSize: 2 },
    { cursor: "page:1", batchSize: 2 },
  ])
})

test("대상 재계산은 future event/rule page에 live 세대·hash를 사용해 unchanged와 A→B→A supersession을 표현한다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const currentRule = directorRule({ ruleRevision: "21" })
  const targetPages = [{
    items: [
      { eventId: EVENT_B, rule: currentRule, scheduledFor: "2026-07-22T05:00:00.000Z" },
      { eventId: EVENT_A, rule: currentRule, scheduledFor: "2026-07-22T05:00:00.000Z" },
    ],
    nextCursor: "target:1",
    done: false,
  }, {
    items: [], nextCursor: null, done: true,
  }]
  const fixture = createFixtureDependencies({
    current: visitSource({
      recipientRevision: "1",
      directorProfileIds: [PROFILE_A],
      participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A }],
      currentRules: [currentRule],
    }),
    targetPages,
  })
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const hashA = (await adapter.resolveTargets(resolveInput(fixture.state.current, currentRule))).targetSetHash
  fixture.state.current = visitSource({
    recipientRevision: "2",
    directorProfileIds: [PROFILE_B],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_B }],
    currentRules: [currentRule],
  })
  const setB = await adapter.resolveTargets(resolveInput(fixture.state.current, currentRule))
  const base = {
    jobId: "81000000-0000-4000-8000-000000000091",
    claimToken: "81000000-0000-4000-8000-000000000092",
    sourceEventId: "81000000-0000-4000-8000-000000000093",
    workflowKey: "registration",
    sourceType: "registration_appointment",
    sourceId: APPOINTMENT_A,
    sourceRevision: "7",
    reconciliationKind: "recipient_set_changed",
    targetGeneration: "2",
    previousTargetSetHash: hashA,
    currentTargetSetHash: setB.targetSetHash,
    cursor: null,
    batchSize: 2,
  }

  const unchanged = await adapter.reconcileTargets(base)
  assert.equal(unchanged.sourceRevision, "7")
  assert.equal(unchanged.targetGeneration, "2")
  assert.equal(unchanged.targetSetHash, setB.targetSetHash)
  assert.deepEqual(unchanged.items.map((item) => item.eventId), [EVENT_A, EVENT_B])
  assert.ok(unchanged.items.every((item) => (
    item.targetSet.targetGeneration === "2" && item.targetSet.targetSetHash === setB.targetSetHash
  )))
  assert.equal(unchanged.nextCursor, "target:1")
  assert.equal(unchanged.done, false)

  fixture.state.current = visitSource({
    recipientRevision: "3",
    directorProfileIds: [PROFILE_A],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A }],
    currentRules: [currentRule],
  })
  const superseded = await adapter.reconcileTargets(base)
  assert.equal(superseded.targetGeneration, "3")
  assert.equal(superseded.targetSetHash, hashA)
  assert.ok(superseded.items.every((item) => (
    item.targetSet.targetGeneration === "3" && item.targetSet.targetSetHash === hashA
  )))
  assert.notEqual(superseded.items[0].targetSet.targetGeneration, base.targetGeneration)
  assert.notEqual(superseded.items[0].targetSet.targetSetHash, base.currentTargetSetHash)

  const done = await adapter.reconcileTargets({ ...base, cursor: "target:1" })
  assert.deepEqual(done, {
    sourceRevision: "7",
    targetGeneration: "3",
    targetSetHash: hashA,
    items: [],
    nextCursor: null,
    done: true,
  })
  assert.deepEqual(fixture.state.targetCalls.at(-1), {
    appointmentId: APPOINTMENT_A,
    cursor: "target:1",
    batchSize: 2,
  })
})

test("대상 재계산은 예약 revision이 바뀌면 옛 job을 빈 supersession 후보로 끝내고 event page를 읽지 않는다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const currentRule = directorRule({ ruleRevision: "21" })
  const fixture = createFixtureDependencies({
    current: visitSource({ notificationRevision: 8, currentRules: [currentRule] }),
  })
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies)
  const result = await adapter.reconcileTargets({
    jobId: "81000000-0000-4000-8000-000000000091",
    claimToken: "81000000-0000-4000-8000-000000000092",
    sourceEventId: "81000000-0000-4000-8000-000000000093",
    workflowKey: "registration",
    sourceType: "registration_appointment",
    sourceId: APPOINTMENT_A,
    sourceRevision: "7",
    reconciliationKind: "recipient_set_changed",
    targetGeneration: "1",
    previousTargetSetHash: "a".repeat(64),
    currentTargetSetHash: "b".repeat(64),
    cursor: null,
    batchSize: 2,
  })
  assert.equal(result.sourceRevision, "8")
  assert.deepEqual(result.items, [])
  assert.equal(result.done, true)
  assert.deepEqual(fixture.state.targetCalls, [])
})

test("허용 audience에 실제 profile이 없으면 위조 profile 대신 synthetic no-recipient target을 만든다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const source = levelTestSource({ managementProfileIds: [] })
  const fixture = createFixtureDependencies({ current: source })
  const targetSet = await createRegistrationNotificationAdapter(fixture.dependencies)
    .resolveTargets(resolveInput(source, rule()))
  assert.deepEqual(targetSet.targets, [{
    targetKind: "audience",
    targetKey: "audience:management_team",
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: { audience_key: "management_team" },
  }])
})

test("production read 경계는 Task 11 snake_case RPC와 jsonb cursor만 사용하고 응답을 한 번만 정규화한다", async () => {
  const { createRegistrationNotificationRpcDependencies } = await import(adapterModuleUrl)
  const source = visitSource({
    recipientRevision: "31",
    directorProfileIds: [PROFILE_A],
    participants: [{ trackId: TRACK_ENGLISH, subject: "영어", directorProfileId: PROFILE_A }],
  })
  const currentRule = directorRule({ ruleRevision: "21" })
  const ruleWire = {
    rule_id: currentRule.ruleId,
    rule_revision: currentRule.ruleRevision,
    template_id: currentRule.templateId,
    audience_key: currentRule.audienceKey,
    channel_key: currentRule.channelKey,
    connection_key: currentRule.connectionKey,
    rule_variant_key: currentRule.ruleVariantKey,
    schedule_key: currentRule.scheduleKey,
    schedule_config: currentRule.scheduleConfig,
    enabled: currentRule.enabled,
  }
  const sourceWire = {
    appointment_id: source.appointmentId,
    task_id: source.taskId,
    student_name: source.studentName,
    kind: source.kind,
    scheduled_at: source.scheduledAt,
    place: source.place,
    status: source.status,
    notification_revision: source.notificationRevision,
    recipient_revision: source.recipientRevision,
    track_ids: source.participants.map((item) => item.trackId),
    subjects: source.participants.map((item) => item.subject),
    participants: source.participants.map((item) => ({
      track_id: item.trackId,
      subject: item.subject,
      director_profile_id: item.directorProfileId,
    })),
    director_profile_ids: source.directorProfileIds,
    management_profile_ids: source.managementProfileIds,
  }
  const calls = []
  const dependencies = createRegistrationNotificationRpcDependencies({
    now: () => new Date("2026-07-22T04:30:00.000Z"),
    async rpc(name, parameters) {
      calls.push({ name, parameters: structuredClone(parameters) })
      if (name === "get_registration_notification_source_snapshot_v1") {
        return { ...sourceWire, current_rules: [ruleWire] }
      }
      if (name === "list_registration_notification_sources_v1") {
        return {
          items: [sourceWire],
          rules: [ruleWire],
          next_cursor: { scheduled_at: source.scheduledAt, id: source.appointmentId },
          done: false,
        }
      }
      if (name === "list_registration_notification_target_items_v1") {
        return {
          items: [{
            event_id: EVENT_A,
            rule_id: currentRule.ruleId,
            rule_revision: currentRule.ruleRevision,
            template_id: currentRule.templateId,
            audience_key: currentRule.audienceKey,
            channel_key: currentRule.channelKey,
            connection_key: null,
            rule_variant_key: currentRule.ruleVariantKey,
            scheduled_for: "2026-07-22T05:00:00.000Z",
          }],
          next_cursor: {
            scheduled_for: "2026-07-22T05:00:00.000Z",
            event_id: EVENT_A,
            rule_id: currentRule.ruleId,
          },
          done: false,
        }
      }
      throw new Error(`unexpected RPC: ${name}`)
    },
  })

  const snapshot = await dependencies.getSourceSnapshot(APPOINTMENT_A)
  assert.equal(snapshot.recipientRevision, "31")
  assert.deepEqual(snapshot.directorProfileIds, [PROFILE_A])

  const sources = await dependencies.listScheduledSources({ cursor: null, batchSize: 1 })
  assert.equal(
    sources.nextCursor,
    `{"id":"${APPOINTMENT_A}","scheduled_at":"${source.scheduledAt}"}`,
  )
  assert.equal(sources.items[0].currentRules[0].ruleRevision, "21")
  await dependencies.listScheduledSources({ cursor: sources.nextCursor, batchSize: 1 })
  assert.deepEqual(calls.at(-1).parameters.p_cursor, {
    id: APPOINTMENT_A,
    scheduled_at: source.scheduledAt,
  })

  const targets = await dependencies.listTargetItems({
    appointmentId: APPOINTMENT_A,
    cursor: null,
    batchSize: 1,
  })
  assert.equal(targets.items[0].eventId, EVENT_A)
  assert.equal(targets.items[0].rule.ruleRevision, "21")
  assert.equal(
    targets.nextCursor,
    `{"event_id":"${EVENT_A}","rule_id":"${currentRule.ruleId}","scheduled_for":"2026-07-22T05:00:00.000Z"}`,
  )
  assert.deepEqual(calls.map((call) => call.name), [
    "get_registration_notification_source_snapshot_v1",
    "list_registration_notification_sources_v1",
    "list_registration_notification_sources_v1",
    "list_registration_notification_target_items_v1",
  ])
  assert.equal(calls.some((call) => /apply|provider|delivery/i.test(call.name)), false)

  const unsafe = createRegistrationNotificationRpcDependencies({
    async rpc() {
      return { ...sourceWire, current_rules: [ruleWire], body_template: "노출 금지" }
    },
  })
  await assert.rejects(
    unsafe.getSourceSnapshot(APPOINTMENT_A),
    (error) => error?.code === "payload_schema_unsupported",
  )

  const transient = createRegistrationNotificationRpcDependencies({
    async rpc() {
      throw Object.assign(new Error("비밀 원문"), { code: "notification_source_unavailable" })
    },
  })
  await assert.rejects(
    transient.getSourceSnapshot(APPOINTMENT_A),
    (error) => error?.code === "notification_source_unavailable",
  )
})

test("production 등록 read 경계는 일시 DB 오류를 영구 schema 오류로 바꾸지 않는다", async () => {
  const source = await (await import("node:fs/promises")).readFile(adapterModuleUrl, "utf8")
  assert.match(source, /transientSupabaseReadError\(response\.error\)/)
  assert.match(source, /sourceUnavailable\(\)/)
  assert.match(source, /code\.startsWith\("08"\)/)
  assert.match(source, /PGRST00\[0-3\]/)
})

test("기본 export는 import만으로 DB·provider를 호출하지 않고 공통 worker 필수 callback을 모두 가진다", async () => {
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error("network forbidden")
  }
  try {
    const { registrationNotificationAdapter } = await import(adapterModuleUrl)
    assert.equal(registrationNotificationAdapter.workflowKey, "registration")
    for (const callback of [
      "resolveTargets",
      "buildRenderContext",
      "buildDeepLink",
      "revalidateBeforeSend",
      "reconcileScheduledRules",
      "reconcileTargets",
    ]) {
      assert.equal(typeof registrationNotificationAdapter[callback], "function")
    }
    assert.equal(networkCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("등록 adapter는 리마인더와 분리된 immediate core·phone·visit·SOLAPI 경계를 처리한다", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  const fixture = createFixtureDependencies()
  const revalidationCalls = []
  const adapter = createRegistrationNotificationAdapter(fixture.dependencies, {
    async revalidateAuthoritativeSource(input) {
      revalidationCalls.push(structuredClone(input))
      return { ok: true }
    },
  })

  const coreRule = {
    ruleId: RULE_CHAT,
    ruleRevision: "1",
    templateId: TEMPLATE_A,
    audienceKey: "management_team",
    channelKey: "google_chat",
    connectionKey: "google_chat.management",
    ruleVariantKey: "immediate",
  }
  const coreInput = {
    eventId: EVENT_A,
    workflowKey: "registration",
    eventKey: "registration.case_created",
    sourceType: "ops_task_event",
    sourceId: EVENT_B,
    sourceRevision: null,
    payloadSchemaVersion: 1,
    payload: {
      task_id: TASK_A,
      track_id: TRACK_ENGLISH,
      student_name: "김학생",
      grade: "중1",
      inquiry_at: "2026-07-22T04:00:00.000Z",
      status: "1. 문의",
      class_name: "",
      registration_checked: "false",
      occurred_at: "2026-07-22T04:00:00.000Z",
    },
    rule: coreRule,
    scheduledFor: "2026-07-22T04:00:00.000Z",
  }
  assert.deepEqual(await adapter.resolveTargets(coreInput), {
    targetGeneration: "0",
    targetSetHash: (await adapter.resolveTargets(coreInput)).targetSetHash,
    targets: [{
      targetKind: "connection",
      targetKey: "connection:google_chat.management",
      targetProfileId: null,
      connectionKey: "google_chat.management",
      targetSnapshot: { connection_key: "google_chat.management" },
    }],
  })
  const coreTarget = (await adapter.resolveTargets(coreInput)).targets[0]
  const coreRenderInput = { ...coreInput, targetGeneration: "0", target: coreTarget }
  assert.deepEqual(await adapter.buildRenderContext(coreRenderInput), {
    student_name: "김학생",
    grade: "중1",
    inquiry_at: "2026-07-22T04:00:00.000Z",
    status: "1. 문의",
    registration_checked: "false",
  })
  assert.equal(
    await adapter.buildDeepLink(coreRenderInput),
    `/admin/registration?taskId=${TASK_A}`,
  )

  const visitRule = {
    ...coreRule,
    ruleId: RULE_SAME_DAY,
    audienceKey: "track_director",
    channelKey: "in_app",
    connectionKey: null,
  }
  const visitInput = {
    ...coreInput,
    eventKey: "registration.visit_scheduled",
    sourceType: "registration_appointment",
    sourceId: APPOINTMENT_A,
    sourceRevision: "3",
    payloadSchemaVersion: 2,
    payload: {
      task_id: TASK_A,
      appointment_id: APPOINTMENT_A,
      student_name: "김학생",
      notification_revision: "3",
      recipient_revision: BIG_GENERATION,
      director_profile_ids: [PROFILE_B, PROFILE_A],
      subjects: "영어 · 수학",
      scheduled_at: "2026-07-22T06:00:00.000Z",
      place: "2층 상담실",
      occurred_at: "2026-07-22T04:00:00.000Z",
    },
    rule: visitRule,
  }
  const visitTargets = await adapter.resolveTargets(visitInput)
  assert.equal(visitTargets.targetGeneration, BIG_GENERATION)
  assert.deepEqual(visitTargets.targets.map((target) => target.targetProfileId), [PROFILE_A, PROFILE_B])
  assert.equal(
    await adapter.buildDeepLink({ ...visitInput, targetGeneration: BIG_GENERATION, target: visitTargets.targets[0] }),
    `/admin/registration?taskId=${TASK_A}&appointmentId=${APPOINTMENT_A}&view=calendar`,
  )
  const visitChatTargets = await adapter.resolveTargets({
    ...visitInput,
    rule: {
      ...visitRule,
      audienceKey: "management_team",
      channelKey: "google_chat",
      connectionKey: "google_chat.management",
    },
  })
  assert.equal(visitChatTargets.targetGeneration, BIG_GENERATION)
  assert.equal(visitChatTargets.targets[0].targetKey, "connection:google_chat.management")

  const messageRule = {
    ...coreRule,
    ruleId: RULE_OFFSET,
    audienceKey: "applicant_guardian",
    channelKey: "customer_message",
    connectionKey: null,
  }
  const messageInput = {
    ...coreInput,
    eventKey: "registration.admission_message_requested",
    sourceType: "ops_registration_message",
    sourceId: APPOINTMENT_B,
    payloadSchemaVersion: 2,
    payload: {
      task_id: TASK_A,
      message_id: APPOINTMENT_B,
      message_request_key: "registration-request-1234",
      student_name: "김학생",
      occurred_at: "2026-07-22T04:00:00.000Z",
    },
    rule: messageRule,
  }
  const messageTargets = await adapter.resolveTargets(messageInput)
  assert.equal(messageTargets.targetGeneration, "0")
  assert.deepEqual(messageTargets.targets, [{
    targetKind: "customer_endpoint",
    targetKey: `registration-message:${APPOINTMENT_B}`,
    targetProfileId: null,
    connectionKey: null,
    targetSnapshot: {
      message_id: APPOINTMENT_B,
      request_key_hash: messageTargets.targets[0].targetSnapshot.request_key_hash,
    },
  }])

  assert.deepEqual(await adapter.revalidateBeforeSend({
    eventId: EVENT_A,
    deliveryId: "81000000-0000-4000-8000-000000000071",
    eventKey: "registration.visit_scheduled",
    sourceType: "registration_appointment",
    sourceId: APPOINTMENT_A,
    sourceRevision: "3",
    ruleId: RULE_SAME_DAY,
    ruleRevision: "1",
    targetGeneration: BIG_GENERATION,
    scheduledFor: "2026-07-22T04:00:00.000Z",
    target: visitTargets.targets[0],
  }), { ok: true })
  assert.equal(revalidationCalls[0].workflowKey, "registration")
})
