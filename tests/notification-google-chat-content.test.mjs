import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const providerUrl = new URL(
  "../src/features/notifications/server/providers/google-chat-provider.ts",
  import.meta.url,
)
const deepLinkUrl = new URL(
  "../src/features/notifications/server/notification-app-deep-link.ts",
  import.meta.url,
)
const registrationAdapterUrl = new URL(
  "../src/features/notifications/server/adapters/registration-notification-adapter.ts",
  import.meta.url,
)

const WEBHOOK_URL =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const legacyProjectionUrl = new URL(
  "../supabase/migrations/20260803153000_notification_legacy_content_projection.sql",
  import.meta.url,
)
const coverageManifestUrl = new URL(
  "./fixtures/notification-content-coverage-manifest.json",
  import.meta.url,
)

const OBSERVATION_ID = "11111111-1111-4111-8111-111111111111"
const TASK_ID = "22222222-2222-4222-8222-222222222222"
const TRACK_ID = "33333333-3333-4333-8333-333333333333"
const APPOINTMENT_ID = "44444444-4444-4444-8444-444444444444"
const SESSION_ID = "55555555-5555-4555-8555-555555555555"
const CLASS_ID = "66666666-6666-4666-8666-666666666666"
const TEACHER_PROFILE_ID = "77777777-7777-4777-8777-777777777777"
const DIRECTOR_PROFILE_ID = "88888888-8888-4888-8888-888888888888"
const PREVIOUS_DIRECTOR_PROFILE_ID = "99999999-9999-4999-8999-999999999999"
const ASSIGNMENT_FACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const RULE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const TEMPLATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const observationDetailUrl =
  `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`
const feedbackUrl = `/admin/registration/observations/${OBSERVATION_ID}/feedback`

function context(overrides = {}) {
  return {
    delivery_id: "10000000-0000-4000-8000-000000000001",
    claim_token: "10000000-0000-4000-8000-000000000002",
    dispatch_token: "10000000-0000-4000-8000-000000000003",
    status: "sending",
    channel_key: "google_chat",
    workflow_key: "registration",
    connection_key: "google_chat.management",
    webhook_url: WEBHOOK_URL,
    rendered_title: "📥 [등록] 김학생의 등록 문의가 들어왔어요",
    rendered_body: "[학생] 김학생 · 중1\n[과목] 수학\n[진행] 관리팀의 확인을 기다리고 있어요.",
    href: "/admin/registration?taskId=10000000-0000-4000-8000-000000000004",
    ...overrides,
  }
}

test("공유 dashboard 링크 정책은 exact 청강 tuple과 교사 피드백 route만 허용한다", async () => {
  const {
    buildNotificationAppLink,
    validateNotificationAppDeepLink,
  } = await import(deepLinkUrl.href)

  assert.equal(
    validateNotificationAppDeepLink(observationDetailUrl, "registration"),
    observationDetailUrl,
  )
  assert.deepEqual(buildNotificationAppLink(observationDetailUrl, "registration"), {
    relativeUrl: observationDetailUrl,
    absoluteUrl: `https://tipsedu.co.kr${observationDetailUrl}`,
    buttonText: "청강 상세 보기",
  })
  assert.equal(validateNotificationAppDeepLink(feedbackUrl, "registration"), feedbackUrl)
  assert.deepEqual(buildNotificationAppLink(feedbackUrl, "registration"), {
    relativeUrl: feedbackUrl,
    absoluteUrl: `https://tipsedu.co.kr${feedbackUrl}`,
    buttonText: "피드백 입력",
  })
  const reorderedObservationDetailUrl =
    `/admin/registration?view=calendar&observationId=${OBSERVATION_ID}&appointmentId=${APPOINTMENT_ID}&trackId=${TRACK_ID}&taskId=${TASK_ID}`
  assert.equal(
    validateNotificationAppDeepLink(reorderedObservationDetailUrl, "registration"),
    reorderedObservationDetailUrl,
  )
  assert.equal(
    validateNotificationAppDeepLink(
      `/admin/registration?taskId=${TASK_ID}&appointmentId=${APPOINTMENT_ID}&view=calendar`,
      "registration",
    ),
    `/admin/registration?taskId=${TASK_ID}&appointmentId=${APPOINTMENT_ID}&view=calendar`,
  )

  for (const rejected of [
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=list`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=`,
    `${observationDetailUrl}&extra=1`,
    `/admin/registration?taskId=${TASK_ID}&taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `${observationDetailUrl}&view=calendar`,
    `/admin/registration?taskId=not-a-uuid&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=not-a-uuid&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=not-a-uuid&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=not-a-uuid&view=calendar`,
    `/admin/registration?taskId=%322222222-2222-4222-8222-222222222222&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=calendar`,
    `/admin/registration?taskId=${TASK_ID}&trackId=${TRACK_ID}&appointmentId=${APPOINTMENT_ID}&observationId=${OBSERVATION_ID}&view=%63alendar`,
    `${observationDetailUrl}#calendar`,
    `${observationDetailUrl}#`,
    `${feedbackUrl}?taskId=${TASK_ID}`,
    `${feedbackUrl}#result`,
    `${feedbackUrl}#`,
    "/admin/registration/observations/not-a-uuid/feedback",
    "/admin/registration/%2e%2e/tasks",
    "https://evil.example/admin/registration",
    "//evil.example/admin/registration",
  ]) {
    assert.throws(() => validateNotificationAppDeepLink(rejected, "registration"))
  }
})

test("Google Chat 최종 payload는 URL 없는 카드 본문과 대시보드 버튼을 담는다", async () => {
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
  const built = buildGoogleChatCardPayload(context())
  const expectedUrl =
    "https://tipsedu.co.kr/admin/registration?taskId=10000000-0000-4000-8000-000000000004"
  const expectedPayload = {
    cardsV2: [{
      cardId: "tips-dashboard-notification",
      card: {
        header: { title: "📥 [등록] 김학생의 등록 문의가 들어왔어요" },
        sections: [{
          widgets: [
            { textParagraph: { text: "[학생] 김학생 · 중1<br>[과목] 수학<br>[진행] 관리팀의 확인을 기다리고 있어요." } },
            {
              buttonList: {
                buttons: [{
                  text: "대시보드에서 보기",
                  onClick: { openLink: { url: expectedUrl } },
                }],
              },
            },
          ],
        }],
      },
    }],
  }

  assert.deepEqual(built, {
    ok: true,
    payload: expectedPayload,
    absoluteUrl: expectedUrl,
    byteLength: Buffer.byteLength(JSON.stringify(expectedPayload), "utf8"),
  })
  assert.equal(JSON.stringify(built.payload).split(expectedUrl).length - 1, 1)
  assert.doesNotMatch(expectedPayload.cardsV2[0].card.header.title, /https?:\/\//u)
  assert.doesNotMatch(expectedPayload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text, /https?:\/\//u)

  const calls = []
  const provider = createGoogleChatProvider({
    async fetch(input, init) {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({ name: "spaces/fixture/messages/content-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    },
  })
  const sent = await provider.send(context())

  assert.equal(sent.status, "sent")
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].init.body), expectedPayload)
})

test("Google Chat 카드 본문은 markup-like text를 escape 대상이 아니라 unsafe input으로 거절한다", async () => {
  const { buildGoogleChatCardPayload } = await import(providerUrl.href)
  const built = buildGoogleChatCardPayload(context({
    rendered_body: `A < B & "C" 'D'\n둘째 줄`,
  }))

  assert.deepEqual(built, { ok: false, errorCode: "render_validation_failed" })
})

test("Google Chat card button text는 검증된 observation route에서만 구체화된다", async () => {
  const { buildGoogleChatCardPayload } = await import(providerUrl.href)

  const detailCard = buildGoogleChatCardPayload(context({ href: observationDetailUrl }))
  const feedbackCard = buildGoogleChatCardPayload(context({ href: feedbackUrl }))
  const taskCard = buildGoogleChatCardPayload(context({
    workflow_key: "tasks",
    href: `/admin/tasks?taskId=${TASK_ID}`,
  }))

  assert.equal(detailCard.ok, true)
  assert.equal(
    detailCard.payload.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text,
    "청강 상세 보기",
  )
  assert.equal(feedbackCard.ok, true)
  assert.equal(
    feedbackCard.payload.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text,
    "피드백 입력",
  )
  assert.equal(taskCard.ok, true)
  assert.equal(
    taskCard.payload.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text,
    "대시보드에서 보기",
  )
  assert.deepEqual(buildGoogleChatCardPayload(context({
    workflow_key: "tasks",
    href: observationDetailUrl,
  })), { ok: false, errorCode: "render_validation_failed" })
})

test("Google Chat provider는 workflow key 없는 legacy-like context를 전송 전에 닫는다", async () => {
  const { createGoogleChatProvider } = await import(providerUrl.href)
  let fetchCount = 0
  const provider = createGoogleChatProvider({
    async fetch() {
      fetchCount += 1
      return new Response(null, { status: 200 })
    },
  })

  const result = await provider.send(context({ workflow_key: undefined }))

  assert.equal(result.status, "failed")
  assert.equal(result.statusReason, "render_validation_failed")
  assert.equal(fetchCount, 0)
})

test("registration adapter는 일곱 observation event에 canonical appointment tuple 또는 feedback route만 만든다", async () => {
  const { createRegistrationNotificationAdapter } = await import(registrationAdapterUrl.href)
  const booking = Object.freeze({
    class_id: CLASS_ID,
    class_name: "중2 영어 A반",
    session_authority: "normalized",
    class_lesson_session_id: SESSION_ID,
    legacy_session_key: null,
    schedule_state: "active",
    starts_at: "2026-08-17T09:00:00.000Z",
    ends_at: "2026-08-17T11:00:00.000Z",
    teacher_name: "홍길동",
    classroom_name: "301호",
    campus: "본관",
  })
  const payloadBase = Object.freeze({
    task_id: TASK_ID,
    track_id: TRACK_ID,
    observation_id: OBSERVATION_ID,
    appointment_id: APPOINTMENT_ID,
    appointment_notification_revision: 1,
    student_name: "청강 검증",
    subject: "영어",
    source_revision: Object.freeze({ authority: "normalized", sessionId: SESSION_ID, revision: 7 }),
    booking_fact_hash: "a".repeat(64),
    occurred_at: "2026-08-17T08:00:00.000Z",
    delivery_expires_at: "2026-08-18T08:00:00.000Z",
    mention_role: "subject_teacher",
    mention_profile_ids: Object.freeze([TEACHER_PROFILE_ID]),
  })
  const payloads = Object.freeze([
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_scheduled", booking, textbook_names: ["능률 VOCA"], progress_summary: "42~49쪽 · 단어 시험" }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_rescheduled", previous_booking: { ...booking, starts_at: "2026-08-16T09:00:00.000Z", ends_at: "2026-08-16T11:00:00.000Z" }, booking, textbook_names: ["능률 VOCA"], progress_summary: "42~49쪽 · 단어 시험" }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_canceled", canceled_booking: booking }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_reminder_due", occurred_at: "2026-08-17T06:00:00.000Z", delivery_expires_at: booking.starts_at, booking, textbook_names: ["능률 VOCA"], progress_summary: "42~49쪽 · 단어 시험" }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_feedback_due", occurred_at: "2026-08-17T11:30:00.000Z", delivery_expires_at: "2026-08-18T11:00:00.000Z", booking }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_feedback_submitted", mention_role: "track_director", mention_profile_ids: [DIRECTOR_PROFILE_ID], occurred_at: "2026-08-17T11:10:00.000Z", delivery_expires_at: "2026-08-18T11:10:00.000Z", booking, submitted_by_name: "김선생", submitted_at: "2026-08-17T11:10:00.000Z" }),
    Object.freeze({ ...payloadBase, event_kind: "registration.observation_director_reassigned", mention_role: "track_director", mention_profile_ids: [PREVIOUS_DIRECTOR_PROFILE_ID, DIRECTOR_PROFILE_ID].sort(), assignment_fact_id: ASSIGNMENT_FACT_ID, booking, previous_director_profile_ids: [PREVIOUS_DIRECTOR_PROFILE_ID], director_profile_ids: [DIRECTOR_PROFILE_ID] }),
  ])
  const adapter = createRegistrationNotificationAdapter({
    now: () => new Date("2026-08-17T07:00:00.000Z"),
    async getSourceSnapshot() { return null },
    async listScheduledSources() { return { items: [], nextCursor: null, done: true } },
    async listTargetItems() { return { items: [], nextCursor: null, done: true } },
  })

  for (const payload of payloads) {
    const management = [
      "registration.observation_feedback_submitted",
      "registration.observation_director_reassigned",
    ].includes(payload.event_kind)
    const connectionKey = management ? "google_chat.management" : "google_chat.english"
    const rule = {
      ruleId: RULE_ID,
      ruleRevision: "1",
      templateId: TEMPLATE_ID,
      audienceKey: management ? "management_team" : "subject_team",
      channelKey: "google_chat",
      connectionKey: null,
      ruleVariantKey: "immediate",
    }
    const href = await adapter.buildDeepLink({
      eventId: EVENT_ID,
      workflowKey: "registration",
      eventKey: payload.event_kind,
      sourceType: payload.event_kind === "registration.observation_director_reassigned"
        ? "registration_observation_assignment_change"
        : "registration_observation",
      sourceId: payload.event_kind === "registration.observation_director_reassigned"
        ? ASSIGNMENT_FACT_ID
        : OBSERVATION_ID,
      sourceRevision: payload.event_kind === "registration.observation_director_reassigned" ? null : "1",
      payloadSchemaVersion: 3,
      payload,
      rule,
      targetGeneration: "1",
      target: {
        targetKind: "connection",
        targetKey: `connection:${connectionKey}`,
        targetProfileId: null,
        connectionKey,
        targetSnapshot: { connection_key: connectionKey },
      },
      scheduledFor: payload.occurred_at,
    })
    assert.equal(
      href,
      payload.event_kind === "registration.observation_feedback_due"
        ? feedbackUrl
        : observationDetailUrl,
      `${payload.event_kind} must never degrade to a partial registration link`,
    )
  }
})

test("악성·모호한 링크는 transport 전에 render_validation_failed로 닫힌다", async () => {
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
  const calls = []
  const provider = createGoogleChatProvider({
    async fetch() {
      calls.push("called")
      return new Response("{}", { status: 200 })
    },
  })
  const invalidHrefs = [
    "//evil.example/admin/tasks",
    "https://evil.example/admin/tasks",
    "javascript:alert(1)",
    "/admin/tasks/%2e%2e/withdrawal?taskId=one",
    "/admin/tasks/../withdrawal?taskId=one",
    "/admin/tasks\\withdrawal?taskId=one",
    "/admin/tasks#private",
    "/admin/tasks?taskId=one&taskId=two",
    "/admin/tasks?unknown=one",
    "/admin/withdrawal?flow=operations&taskId=one&next=%2Fadmin%2Ftasks",
    "/login?taskId=one",
  ]

  for (const href of invalidHrefs) {
    assert.deepEqual(buildGoogleChatCardPayload(context({ href })), {
      ok: false,
      errorCode: "render_validation_failed",
    })
    const result = await provider.send(context({ href }))
    assert.equal(result.status, "failed")
    assert.equal(result.statusReason, "render_validation_failed")
    assert.equal(result.errorCode, "render_validation_failed")
  }
  assert.equal(calls.length, 0)
})

test("UTF-8 32,000바이트 경계를 넘거나 본문에 URL이 중복되면 transport를 호출하지 않는다", async () => {
  const { buildGoogleChatCardPayload, createGoogleChatProvider } = await import(providerUrl.href)
  let calls = 0
  const provider = createGoogleChatProvider({
    async fetch() {
      calls += 1
      return new Response("{}", { status: 200 })
    },
  })
  const inputs = [
    context({ rendered_body: "한".repeat(11_000) }),
    context({ rendered_body: "중복 링크 https://tipsedu.co.kr/admin/tasks" }),
  ]

  for (const input of inputs) {
    assert.deepEqual(buildGoogleChatCardPayload(input), {
      ok: false,
      errorCode: "render_validation_failed",
    })
    const result = await provider.send(input)
    assert.equal(result.status, "failed")
    assert.equal(result.errorCode, "render_validation_failed")
  }
  assert.equal(calls, 0)
})

test("UTF-8 최종 payload는 정확히 32,000바이트까지 허용한다", async () => {
  const { buildGoogleChatCardPayload } = await import(providerUrl.href)
  const base = buildGoogleChatCardPayload(context({
    rendered_title: "경계",
    rendered_body: "a",
    workflow_key: "tasks",
    href: "/admin/tasks",
  }))
  assert.equal(base.ok, true)
  const renderedBody = "a".repeat(32_000 - base.byteLength + 1)

  const result = buildGoogleChatCardPayload(context({
    rendered_title: "경계",
    rendered_body: renderedBody,
    workflow_key: "tasks",
    href: "/admin/tasks",
  }))

  assert.equal(result.ok, true)
  assert.equal(result.byteLength, 32_000)
})

test("legacy content projection은 매니페스트의 legacy 59개 identity만 rich context renderer로 허용한다", async () => {
  const [source, coverage] = await Promise.all([
    readFile(legacyProjectionUrl, "utf8"),
    readFile(coverageManifestUrl, "utf8").then(JSON.parse),
  ])
  const embedded = source.match(
    /notification_legacy_content_identity_fixture_begin\s*\$legacy_identities\$([\s\S]*?)\$legacy_identities\$::jsonb\s*-- notification_legacy_content_identity_fixture_end/u,
  )
  assert.ok(embedded)
  const actual = JSON.parse(embedded[1]).sort()
  const expected = coverage.ruleGroups
    .filter((group) => group.scopeState === "in_scope" && group.dispatchOwner === "legacy")
    .flatMap((group) => group.eventKeys.flatMap((eventKey) => (
      group.cells.flatMap((cell) => cell.ruleVariantKeys.map((ruleVariantKey) => [
        group.workflowKey,
        eventKey,
        cell.audienceKey,
        cell.channelKey,
        ruleVariantKey,
      ].join("|")))
    )))
    .sort()

  assert.equal(actual.length, 59)
  assert.deepEqual(actual, expected)
  assert.equal(actual.some((identity) => identity.startsWith("approvals|")), false)
  assert.match(source, /notification_rule_content_contracts/)
  assert.match(source, /availableVariables/)
  assert.match(source, /fieldPresence/)
  assert.match(source, /optionalLineTokens/)
  assert.match(source, /notification_legacy_content_required_field_missing/)
  assert.match(source, /notification_legacy_content_null_field_invalid/)
  assert.match(source, /notification_legacy_content_unsafe_value/)
  assert.match(source, /render_validation_failed/)
  assert.doesNotMatch(source, /create\s+or\s+replace\s+function\s+public\./iu)
  assert.doesNotMatch(source, /\b(?:insert|update|delete)\s+(?:into\s+)?dashboard_private\.(?:notification_rules|notification_templates|notification_runtime_flags|notification_dispatch_ownership_claims)\b/iu)
  assert.doesNotMatch(source, /materialize|finalize|activation|rollback|webhook|fetch|send/iu)
})
