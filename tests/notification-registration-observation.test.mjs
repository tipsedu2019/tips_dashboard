import assert from "node:assert/strict"
import test from "node:test"

const sourceModuleUrl = new URL(
  "../src/features/notifications/server/adapters/registration-observation-notification-source.ts",
  import.meta.url,
)
const adapterModuleUrl = new URL(
  "../src/features/notifications/server/adapters/registration-notification-adapter.ts",
  import.meta.url,
)
const presentationModuleUrl = new URL(
  "../src/features/notifications/server/presentation/registration-notification-presentation.ts",
  import.meta.url,
)
const catalogModuleUrl = new URL(
  "../src/features/notifications/notification-google-chat-catalog.ts",
  import.meta.url,
)

const TASK_ID = "10000000-0000-4000-8000-000000000001"
const TRACK_ID = "10000000-0000-4000-8000-000000000002"
const OBSERVATION_ID = "10000000-0000-4000-8000-000000000003"
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000000004"
const SESSION_ID = "10000000-0000-4000-8000-000000000005"
const CLASS_ID = "10000000-0000-4000-8000-000000000006"
const TEACHER_PROFILE_ID = "10000000-0000-4000-8000-000000000007"
const TEACHER_CATALOG_ID = "10000000-0000-4000-8000-000000000008"
const CLASSROOM_CATALOG_ID = "10000000-0000-4000-8000-000000000009"
const DIRECTOR_PROFILE_ID = "10000000-0000-4000-8000-000000000010"
const PREVIOUS_DIRECTOR_ID = "10000000-0000-4000-8000-000000000011"
const ASSIGNMENT_FACT_ID = "10000000-0000-4000-8000-000000000012"
const EVENT_ID = "10000000-0000-4000-8000-000000000013"
const DELIVERY_ID = "10000000-0000-4000-8000-000000000014"
const RULE_ID = "10000000-0000-4000-8000-000000000015"
const TEMPLATE_ID = "10000000-0000-4000-8000-000000000016"
const HASH = "a".repeat(64)

const source = Object.freeze({
  observationId: OBSERVATION_ID,
  appointmentId: APPOINTMENT_ID,
  taskId: TASK_ID,
  trackId: TRACK_ID,
  notificationRevision: 1,
  observationStatus: "scheduled",
  appointmentStatus: "scheduled",
  hasFeedback: false,
  studentName: "청강 검증",
  subject: "영어",
  classId: CLASS_ID,
  className: "중2 영어 A반",
  sessionAuthority: "normalized",
  classLessonSessionId: SESSION_ID,
  legacySessionKey: null,
  scheduleState: "active",
  startsAt: "2026-08-17T09:00:00.000Z",
  endsAt: "2026-08-17T11:00:00.000Z",
  teacherCatalogId: TEACHER_CATALOG_ID,
  teacherProfileId: TEACHER_PROFILE_ID,
  teacherName: "홍길동",
  classroomCatalogId: CLASSROOM_CATALOG_ID,
  classroomName: "301호",
  campus: "본관",
  sourceRevision: Object.freeze({ authority: "normalized", sessionId: SESSION_ID, revision: 7 }),
  bookingFactHash: HASH,
  directorProfileId: DIRECTOR_PROFILE_ID,
})

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

const previousBooking = Object.freeze({
  ...booking,
  starts_at: "2026-08-16T09:00:00.000Z",
  ends_at: "2026-08-16T11:00:00.000Z",
  classroom_name: "201호",
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
  booking_fact_hash: HASH,
  occurred_at: "2026-08-17T08:00:00.000Z",
  delivery_expires_at: "2026-08-18T08:00:00.000Z",
  mention_role: "subject_teacher",
  mention_profile_ids: Object.freeze([TEACHER_PROFILE_ID]),
})

const payloads = Object.freeze({
  scheduled: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_scheduled",
    booking,
    textbook_names: Object.freeze(["능률 VOCA"]),
    progress_summary: "42~49쪽 · 단어 시험",
  }),
  rescheduled: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_rescheduled",
    previous_booking: previousBooking,
    booking,
    textbook_names: Object.freeze(["능률 VOCA"]),
    progress_summary: "42~49쪽 · 단어 시험",
  }),
  canceled: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_canceled",
    canceled_booking: booking,
  }),
  reminder: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_reminder_due",
    occurred_at: "2026-08-17T06:00:00.000Z",
    delivery_expires_at: booking.starts_at,
    booking,
    textbook_names: Object.freeze(["능률 VOCA"]),
    progress_summary: "42~49쪽 · 단어 시험",
  }),
  feedbackDue: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_feedback_due",
    occurred_at: "2026-08-17T11:30:00.000Z",
    delivery_expires_at: "2026-08-18T11:00:00.000Z",
    booking,
  }),
  feedbackSubmitted: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_feedback_submitted",
    mention_role: "track_director",
    mention_profile_ids: Object.freeze([DIRECTOR_PROFILE_ID]),
    occurred_at: "2026-08-17T11:10:00.000Z",
    delivery_expires_at: "2026-08-18T11:10:00.000Z",
    booking,
    submitted_by_name: "김선생",
    submitted_at: "2026-08-17T11:10:00.000Z",
  }),
  directorReassigned: Object.freeze({
    ...payloadBase,
    event_kind: "registration.observation_director_reassigned",
    mention_role: "track_director",
    mention_profile_ids: Object.freeze([PREVIOUS_DIRECTOR_ID, DIRECTOR_PROFILE_ID].sort()),
    assignment_fact_id: ASSIGNMENT_FACT_ID,
    booking,
    previous_director_profile_ids: Object.freeze([PREVIOUS_DIRECTOR_ID]),
    director_profile_ids: Object.freeze([DIRECTOR_PROFILE_ID]),
  }),
})

function deferredQuery(response, calls, root) {
  const query = {
    select(...args) { calls.push([root, "select", ...args]); return query },
    eq(...args) { calls.push([root, "eq", ...args]); return query },
    in(...args) { calls.push([root, "in", ...args]); return query },
    or(...args) { calls.push([root, "or", ...args]); return query },
    order(...args) { calls.push([root, "order", ...args]); return query },
    limit(...args) { calls.push([root, "limit", ...args]); return query },
    maybeSingle(...args) { calls.push([root, "maybeSingle", ...args]); return query },
    abortSignal(signal) {
      calls.push([root, "abortSignal", signal])
      assert.equal(signal instanceof AbortSignal, true)
      return query
    },
    retry(enabled) { calls.push([root, "retry", enabled]); return query },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject) },
  }
  return query
}

function adapterDependencies(observationSourceReader, now = () => new Date("2026-08-17T07:00:00.000Z")) {
  return {
    now,
    observationSourceReader,
    async getSourceSnapshot() { return null },
    async listScheduledSources() { return { items: [], nextCursor: null, done: true } },
    async listTargetItems() { return { items: [], nextCursor: null, done: true } },
  }
}

function rule(overrides = {}) {
  return {
    ruleId: RULE_ID,
    ruleRevision: "1",
    templateId: TEMPLATE_ID,
    audienceKey: "subject_team",
    channelKey: "google_chat",
    connectionKey: null,
    ruleVariantKey: "immediate",
    ...overrides,
  }
}

function resolveInput(payload, ruleSnapshot = rule(), overrides = {}) {
  return {
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
    rule: ruleSnapshot,
    scheduledFor: payload.occurred_at,
    ...overrides,
  }
}

const currentBookingSnapshot = Object.freeze({
  classId: CLASS_ID,
  className: source.className,
  sessionAuthority: source.sessionAuthority,
  classLessonSessionId: SESSION_ID,
  legacySessionKey: null,
  scheduleState: source.scheduleState,
  startsAt: source.startsAt,
  endsAt: source.endsAt,
  teacherCatalogId: TEACHER_CATALOG_ID,
  teacherProfileId: TEACHER_PROFILE_ID,
  teacherName: source.teacherName,
  classroomCatalogId: CLASSROOM_CATALOG_ID,
  classroomName: source.classroomName,
  campus: source.campus,
})

function observationJob(payload = payloads.scheduled, overrides = {}) {
  return {
    jobId: "10000000-0000-4000-8000-000000000017",
    claimToken: "10000000-0000-4000-8000-000000000018",
    observationId: OBSERVATION_ID,
    appointmentId: APPOINTMENT_ID,
    assignmentFactId: payload.event_kind === "registration.observation_director_reassigned"
      ? ASSIGNMENT_FACT_ID
      : null,
    notificationRevision: 1,
    eventKey: payload.event_kind,
    dueAt: payload.occurred_at,
    expiresAt: payload.delivery_expires_at,
    attemptCount: 0,
    sourceRevision: source.sourceRevision,
    bookingFactHash: HASH,
    currentBookingSnapshot,
    previousBookingSnapshot: payload.event_kind === "registration.observation_rescheduled"
      ? { ...currentBookingSnapshot, startsAt: previousBooking.starts_at, endsAt: previousBooking.ends_at, classroomName: previousBooking.classroom_name }
      : null,
    preparationSnapshot: "textbook_names" in payload
      ? { textbookNames: payload.textbook_names, progressSummary: payload.progress_summary }
      : null,
    submissionSnapshot: payload.event_kind === "registration.observation_feedback_submitted"
      ? { submittedByName: payload.submitted_by_name, submittedAt: payload.submitted_at }
      : null,
    mentionRole: payload.mention_role,
    mentionProfileIds: payload.mention_profile_ids,
    ...overrides,
  }
}

test("selected session preparation uses exact plan priority and never leaks sibling progress", async () => {
  const { resolveRegistrationObservationPreparation } = await import(sourceModuleUrl)
  const result = resolveRegistrationObservationPreparation({
    source: {
      sessionAuthority: "normalized",
      classLessonSessionId: SESSION_ID,
      legacySessionKey: null,
    },
    selectedSession: {
      id: SESSION_ID,
      sessionOrder: 4,
      textbookEntries: [{ textbookId: "book-1", title: "능률 VOCA", plan: "42~49쪽", memo: "단어 시험" }],
      memo: "선택 회차 메모",
      publicNote: "",
    },
    exactProgressLogs: [{ sessionId: SESSION_ID, rangeLabel: "40~45쪽", publicNote: "복습" }],
    rejectedProgressLogs: [{ sessionId: "20000000-0000-4000-8000-000000000001", rangeLabel: "90~99쪽", publicNote: "다른 회차" }],
    classTextbooks: [{ id: "book-1", title: "능률 VOCA" }],
  })
  assert.deepEqual(result, {
    textbookNames: ["능률 VOCA"],
    progressSummary: "42~49쪽 · 단어 시험",
  })
  assert.doesNotMatch(result.progressSummary, /90~99쪽|다른 회차/)

  assert.deepEqual(resolveRegistrationObservationPreparation({
    source: { sessionAuthority: "legacy", classLessonSessionId: null, legacySessionKey: "2026-08-17|18:00" },
    selectedSession: { sessionKey: "2026-08-17|18:00", sessionOrder: 7, textbookEntries: [], memo: "", publicNote: "" },
    exactProgressLogs: [],
    rejectedProgressLogs: [],
    classTextbooks: [],
  }), { textbookNames: ["미지정"], progressSummary: "미입력" })
})

test("source reader exact-parses one service RPC with a 5-second abort and retry disabled", async () => {
  const { createRegistrationObservationNotificationSourceReader } = await import(sourceModuleUrl)
  const calls = []
  const client = {
    rpc(name, parameters) {
      calls.push(["rpc", name, parameters])
      return deferredQuery({ data: source, error: null }, calls, "rpc")
    },
    from() { throw new Error("readSource must not query tables") },
  }
  const reader = createRegistrationObservationNotificationSourceReader({
    async getClient() { return client },
  })
  assert.deepEqual(await reader.readSource(OBSERVATION_ID), source)
  assert.deepEqual(calls[0], ["rpc", "get_registration_observation_notification_source_v1", {
    p_observation_id: OBSERVATION_ID,
  }])
  assert.equal(calls.some((call) => call[1] === "retry" && call[2] === false), true)
  const signal = calls.find((call) => call[1] === "abortSignal")?.[2]
  assert.equal(signal instanceof AbortSignal, true)

  const malformedClient = {
    rpc() { return deferredQuery({ data: { ...source, phone: "010-0000-0000" }, error: null }, [], "rpc") },
    from() { throw new Error("unexpected") },
  }
  await assert.rejects(
    createRegistrationObservationNotificationSourceReader({ async getClient() { return malformedClient } })
      .readSource(OBSERVATION_ID),
    /notification_registration_observation_source_invalid/,
  )

  for (const [error, expected] of [
    [{ code: "57014", message: "statement timeout" }, /notification_registration_observation_source_unavailable/],
    [{ code: "55000", message: "source dirty" }, /notification_registration_observation_source_invalid/],
  ]) {
    const failedClient = {
      rpc() { return deferredQuery({ data: null, error }, [], "rpc") },
      from() { throw new Error("unexpected") },
    }
    await assert.rejects(
      createRegistrationObservationNotificationSourceReader({ async getClient() { return failedClient } })
        .readSource(OBSERVATION_ID),
      expected,
    )
  }
})

test("current preparation reads only the exact class/session and referenced textbook IDs", async () => {
  const { createRegistrationObservationNotificationSourceReader } = await import(sourceModuleUrl)
  const calls = []
  const responses = {
    class_lesson_sessions: {
      data: { id: SESSION_ID, class_id: CLASS_ID, session_key: "2026-08-17|18:00", revision: 7, memo: "", public_note: "" },
      error: null,
    },
    classes: {
      data: {
        id: CLASS_ID,
        schedule_storage_mode: "normalized",
        schedule_plan: {
          textbooks: [{ textbookId: "book-1", title: "능률 VOCA" }],
          sessions: [
            { sessionKey: "2026-08-17|18:00", sessionOrder: 4, textbookEntries: [{ textbookId: "book-1", plan: "42~49쪽", memo: "단어 시험" }] },
            { sessionKey: "2026-08-18|18:00", sessionOrder: 5, textbookEntries: [{ textbookId: "book-2", plan: "90~99쪽", memo: "다른 회차" }] },
          ],
        },
      },
      error: null,
    },
    progress_logs: {
      data: [
        { id: "p1", class_id: CLASS_ID, session_id: SESSION_ID, session_order: 4, range_label: "40~45쪽", public_note: "복습" },
        { id: "p2", class_id: CLASS_ID, session_id: "sibling", session_order: 5, range_label: "90~99쪽", public_note: "누출 금지" },
      ],
      error: null,
    },
  }
  const client = {
    rpc() { throw new Error("readCurrentPreparation must not call the source RPC") },
    from(table) {
      calls.push(["from", table])
      return deferredQuery(responses[table], calls, table)
    },
  }
  const reader = createRegistrationObservationNotificationSourceReader({ async getClient() { return client } })
  assert.deepEqual(await reader.readCurrentPreparation(source), {
    textbookNames: ["능률 VOCA"],
    progressSummary: "42~49쪽 · 단어 시험",
  })
  assert.equal(calls.some((call) => call[0] === "class_lesson_sessions" && call[1] === "eq" && call[2] === "id" && call[3] === SESSION_ID), true)
  assert.equal(calls.some((call) => call[0] === "class_lesson_sessions" && call[1] === "eq" && call[2] === "class_id" && call[3] === CLASS_ID), true)
  assert.equal(calls.some((call) => call[0] === "from" && call[1] === "textbooks"), false)
  assert.equal(calls.some((call) => call[0] === "progress_logs" && call[1] === "in" && call[2] === "session_id"), true)
  assert.equal(calls.some((call) => call[0] === "progress_logs" && call[1] === "eq" && call[2] === "session_order" && call[3] === 4), true)
  assert.equal(calls.some((call) => call[1] === "or"), false)

  const normalizedWithoutLegacyMirror = {
    class_lesson_sessions: {
      data: {
        id: SESSION_ID,
        class_id: CLASS_ID,
        session_key: "2026-08-17|18:00",
        revision: 7,
        memo: "정본 회차 메모",
        public_note: "",
      },
      error: null,
    },
    classes: {
      data: {
        id: CLASS_ID,
        schedule_storage_mode: "normalized",
        schedule_plan: { textbooks: [], sessions: [] },
      },
      error: null,
    },
    progress_logs: {
      data: [
        {
          id: "p-old",
          class_id: CLASS_ID,
          session_id: SESSION_ID,
          session_order: null,
          range_label: "이전 진도",
          public_note: "",
          updated_at: "2026-08-16T01:00:00.000Z",
        },
        {
          id: "p-new",
          class_id: CLASS_ID,
          session_id: SESSION_ID,
          session_order: null,
          range_label: "현재 진도",
          public_note: "",
          updated_at: "2026-08-17T01:00:00.000Z",
        },
      ],
      error: null,
    },
  }
  const normalizedReader = createRegistrationObservationNotificationSourceReader({
    async getClient() {
      return {
        rpc() { throw new Error("unexpected") },
        from(table) { return deferredQuery(normalizedWithoutLegacyMirror[table], [], table) },
      }
    },
  })
  assert.deepEqual(await normalizedReader.readCurrentPreparation(source), {
    textbookNames: ["미지정"],
    progressSummary: "현재 진도",
  })

  const legacyCalls = []
  const legacyReader = createRegistrationObservationNotificationSourceReader({
    async getClient() {
      return {
        rpc() { throw new Error("unexpected") },
        from(table) {
          if (table === "classes") {
            return deferredQuery({
              data: {
                id: CLASS_ID,
                schedule_storage_mode: "legacy",
                schedule_plan: {
                  textbooks: [{ textbookId: "book-legacy", title: "레거시 교재" }],
                  sessions: [{
                    sessionKey: "2026-08-17|18:00",
                    sessionOrder: 7,
                    textbookEntries: [{ textbookId: "book-legacy", plan: { label: "3과", memo: "어휘" } }],
                  }],
                },
              },
              error: null,
            }, legacyCalls, table)
          }
          if (table === "progress_logs") {
            return deferredQuery({ data: [], error: null }, legacyCalls, table)
          }
          throw new Error(`legacy reader queried ${table}`)
        },
      }
    },
  })
  assert.deepEqual(await legacyReader.readCurrentPreparation({
    ...source,
    sessionAuthority: "legacy",
    classLessonSessionId: null,
    legacySessionKey: "2026-08-17|18:00",
    sourceRevision: {
      authority: "legacy",
      sessionKey: "2026-08-17|18:00",
      contentHash: "b".repeat(64),
    },
  }), {
    textbookNames: ["레거시 교재"],
    progressSummary: "3과 · 어휘",
  })
  assert.equal(legacyCalls.some((call) => call[0] === "class_lesson_sessions"), false)
})

test("payload-v3 parser accepts exactly seven closed members and rejects representative mutations", async () => {
  const { parseRegistrationObservationChatPayloadV3 } = await import(sourceModuleUrl)
  for (const [name, payload] of Object.entries(payloads)) {
    assert.deepEqual(parseRegistrationObservationChatPayloadV3(payload), payload, name)
    assert.throws(
      () => parseRegistrationObservationChatPayloadV3({ ...payload, phone: "01000000000" }),
      /notification_registration_observation_payload_invalid/,
      `${name} extra key`,
    )
    const missingEventKind = { ...payload }
    delete missingEventKind.event_kind
    assert.throws(
      () => parseRegistrationObservationChatPayloadV3(missingEventKind),
      /notification_registration_observation_payload_invalid/,
      `${name} missing key`,
    )
  }

  const postgresTimestampPayload = {
    ...payloads.scheduled,
    occurred_at: "2026-08-17T17:00:00+09:00",
    delivery_expires_at: "2026-08-18T17:00:00+09:00",
  }
  assert.deepEqual(
    parseRegistrationObservationChatPayloadV3(postgresTimestampPayload),
    postgresTimestampPayload,
    "PostgreSQL timestamptz offset bytes",
  )

  const legacyPayload = {
    ...payloads.scheduled,
    source_revision: { authority: "legacy", sessionKey: "2026-08-17|18:00", contentHash: "b".repeat(64) },
    booking: {
      ...booking,
      session_authority: "legacy",
      class_lesson_session_id: null,
      legacy_session_key: "2026-08-17|18:00",
    },
  }
  assert.deepEqual(parseRegistrationObservationChatPayloadV3(legacyPayload), legacyPayload)

  for (const [name, invalid] of [
    ["extra result", { ...payloads.scheduled, result: "fit" }],
    ["extra reason", { ...payloads.scheduled, reason: "private" }],
    ["missing subject", (() => { const invalid = { ...payloads.scheduled }; delete invalid.subject; return invalid })()],
    ["malformed observation uuid", { ...payloads.scheduled, observation_id: "bad" }],
    ["malformed occurred date", { ...payloads.scheduled, occurred_at: "not-a-date" }],
    ["normalized invalid calendar date", { ...payloads.scheduled, occurred_at: "2026-02-30T08:00:00.000Z" }],
    ["malformed hash", { ...payloads.scheduled, booking_fact_hash: "ABC" }],
    ["mismatched event kind", { ...payloads.scheduled, event_kind: "registration.observation_feedback_due" }],
    ["mixed session authority", { ...payloads.scheduled, booking: { ...booking, legacy_session_key: "2026-08-17|18:00" } }],
    ["source revision booking mismatch", {
      ...payloads.scheduled,
      source_revision: { authority: "normalized", sessionId: APPOINTMENT_ID, revision: 7 },
    }],
    ["unsupported subject", { ...payloads.scheduled, subject: "미술" }],
    ["duplicate mention", { ...payloads.scheduled, mention_profile_ids: [TEACHER_PROFILE_ID, TEACHER_PROFILE_ID] }],
  ]) {
    assert.throws(
      () => parseRegistrationObservationChatPayloadV3(invalid),
      /notification_registration_observation_payload_invalid/,
      name,
    )
  }
})

test("builder binds claim snapshots to the canonical source and rejects one-byte booking drift", async () => {
  const { buildRegistrationObservationChatPayloadV3 } = await import(adapterModuleUrl)
  const currentBookingSnapshot = {
    classId: CLASS_ID,
    className: source.className,
    sessionAuthority: source.sessionAuthority,
    classLessonSessionId: SESSION_ID,
    legacySessionKey: null,
    scheduleState: source.scheduleState,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    teacherCatalogId: TEACHER_CATALOG_ID,
    teacherProfileId: TEACHER_PROFILE_ID,
    teacherName: source.teacherName,
    classroomCatalogId: CLASSROOM_CATALOG_ID,
    classroomName: source.classroomName,
    campus: source.campus,
  }
  const job = {
    jobId: "10000000-0000-4000-8000-000000000017",
    claimToken: "10000000-0000-4000-8000-000000000018",
    observationId: OBSERVATION_ID,
    appointmentId: APPOINTMENT_ID,
    assignmentFactId: null,
    notificationRevision: 1,
    eventKey: "registration.observation_scheduled",
    dueAt: payloadBase.occurred_at,
    expiresAt: payloadBase.delivery_expires_at,
    attemptCount: 0,
    sourceRevision: source.sourceRevision,
    bookingFactHash: HASH,
    currentBookingSnapshot,
    previousBookingSnapshot: null,
    preparationSnapshot: { textbookNames: ["능률 VOCA"], progressSummary: "42~49쪽 · 단어 시험" },
    submissionSnapshot: null,
    mentionRole: "subject_teacher",
    mentionProfileIds: [TEACHER_PROFILE_ID],
  }
  assert.deepEqual(buildRegistrationObservationChatPayloadV3({
    job,
    source,
    preparation: job.preparationSnapshot,
  }), payloads.scheduled)
  const microsecondJob = {
    ...job,
    dueAt: "2026-08-17T08:00:00.123456+00:00",
    expiresAt: "2026-08-18T08:00:00.654321+00:00",
  }
  const microsecondPayload = buildRegistrationObservationChatPayloadV3({
    job: microsecondJob,
    source,
    preparation: microsecondJob.preparationSnapshot,
  })
  assert.equal(microsecondPayload.occurred_at, microsecondJob.dueAt)
  assert.equal(microsecondPayload.delivery_expires_at, microsecondJob.expiresAt)
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: { ...job, bookingFactHash: "b".repeat(64) },
      source,
      preparation: job.preparationSnapshot,
    }),
    /notification_registration_observation_payload_invalid/,
  )
})

test("builder enforces event lifecycle and preparation-read boundaries before materialization", async () => {
  const { buildRegistrationObservationChatPayloadV3 } = await import(adapterModuleUrl)
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.scheduled),
      source,
      preparation: null,
    }),
    /notification_registration_observation_payload_invalid/,
    "scheduled requires its immutable preparation snapshot",
  )
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.canceled),
      source,
      preparation: null,
    }),
    /notification_registration_observation_payload_invalid/,
    "canceled cannot be built from a scheduled source",
  )
  assert.deepEqual(buildRegistrationObservationChatPayloadV3({
    job: observationJob(payloads.canceled),
    source: { ...source, observationStatus: "canceled", appointmentStatus: "canceled" },
    preparation: null,
  }), payloads.canceled)
  assert.deepEqual(buildRegistrationObservationChatPayloadV3({
    job: observationJob(payloads.feedbackDue),
    source,
    preparation: null,
  }), payloads.feedbackDue)
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.feedbackDue),
      source: { ...source, hasFeedback: true },
      preparation: null,
    }),
    /notification_registration_observation_payload_invalid/,
    "feedback due closes as soon as feedback exists",
  )
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.feedbackDue),
      source,
      preparation: { textbookNames: ["읽으면 안 됨"], progressSummary: "읽으면 안 됨" },
    }),
    /notification_registration_observation_payload_invalid/,
    "feedback due never consumes preparation",
  )
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.reminder, { expiresAt: payloadBase.delivery_expires_at }),
      source,
      preparation: { textbookNames: payloads.reminder.textbook_names, progressSummary: payloads.reminder.progress_summary },
    }),
    /notification_registration_observation_payload_invalid/,
    "reminder cannot outlive class start",
  )
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.scheduled, { mentionProfileIds: [DIRECTOR_PROFILE_ID] }),
      source,
      preparation: {
        textbookNames: payloads.scheduled.textbook_names,
        progressSummary: payloads.scheduled.progress_summary,
      },
    }),
    /notification_registration_observation_payload_invalid/,
    "subject-room payload cannot mention a director instead of the current teacher",
  )
  assert.deepEqual(buildRegistrationObservationChatPayloadV3({
    job: observationJob(payloads.directorReassigned),
    source,
    preparation: null,
  }), payloads.directorReassigned)

  const completedSource = {
    ...source,
    observationStatus: "completed",
    appointmentStatus: "completed",
    hasFeedback: true,
  }
  assert.deepEqual(buildRegistrationObservationChatPayloadV3({
    job: observationJob(payloads.feedbackSubmitted),
    source: completedSource,
    preparation: null,
  }), payloads.feedbackSubmitted)
  assert.throws(
    () => buildRegistrationObservationChatPayloadV3({
      job: observationJob(payloads.feedbackSubmitted, { mentionProfileIds: [TEACHER_PROFILE_ID] }),
      source: completedSource,
      preparation: null,
    }),
    /notification_registration_observation_payload_invalid/,
    "management payload cannot mention a teacher instead of the current director",
  )

  const legacySource = {
    ...source,
    sessionAuthority: "legacy",
    classLessonSessionId: null,
    legacySessionKey: "2026-08-17|18:00",
    sourceRevision: {
      authority: "legacy",
      sessionKey: "2026-08-17|18:00",
      contentHash: "b".repeat(64),
    },
  }
  const legacyBuilt = buildRegistrationObservationChatPayloadV3({
    job: observationJob(payloads.scheduled, {
      sourceRevision: legacySource.sourceRevision,
      currentBookingSnapshot: {
        ...currentBookingSnapshot,
        sessionAuthority: "legacy",
        classLessonSessionId: null,
        legacySessionKey: "2026-08-17|18:00",
      },
    }),
    source: legacySource,
    preparation: {
      textbookNames: payloads.scheduled.textbook_names,
      progressSummary: payloads.scheduled.progress_summary,
    },
  })
  assert.equal(legacyBuilt.source_revision.authority, "legacy")
  assert.equal(legacyBuilt.booking.session_authority, "legacy")
})

test("subject rooms and management/inbox destinations are exact and browser destination hints are ignored", async () => {
  const [{ createRegistrationNotificationAdapter }, { renderObservationDestinationTeam }] = await Promise.all([
    import(adapterModuleUrl),
    import(catalogModuleUrl),
  ])
  const observationSourceReader = {
    async readSource() { return source },
    async readCurrentPreparation() { return { textbookNames: ["현재 교재"], progressSummary: "현재 진도" } },
  }
  const adapter = createRegistrationNotificationAdapter(adapterDependencies(observationSourceReader))
  for (const [subject, connectionKey, destinationTeam] of [
    ["영어", "google_chat.english", "english"],
    ["수학", "google_chat.math", "math"],
    ["과학", "google_chat.science", "science"],
  ]) {
    const payload = { ...payloads.scheduled, subject, destination: "google_chat.management" }
    delete payload.destination
    const targets = await adapter.resolveTargets(resolveInput(payload, rule()))
    assert.deepEqual(targets.targets, [{
      targetKind: "connection",
      targetKey: `connection:${connectionKey}`,
      targetProfileId: null,
      connectionKey,
      targetSnapshot: { connection_key: connectionKey },
    }])
    assert.equal(renderObservationDestinationTeam(connectionKey), destinationTeam)
  }

  const managementRule = rule({ audienceKey: "management_team", connectionKey: null })
  const management = await adapter.resolveTargets(resolveInput(payloads.feedbackSubmitted, managementRule))
  assert.equal(management.targets[0].targetKey, "connection:google_chat.management")
  const inboxRule = rule({ audienceKey: "track_director", channelKey: "in_app", connectionKey: null })
  const inbox = await adapter.resolveTargets(resolveInput(payloads.feedbackSubmitted, inboxRule))
  assert.deepEqual(inbox.targets.map((target) => target.targetKey), [`profile:${DIRECTOR_PROFILE_ID}`])

  await assert.rejects(
    adapter.resolveTargets(resolveInput(payloads.scheduled, rule({ connectionKey: "google_chat.management" }))),
    /payload_schema_unsupported/,
  )
  await assert.rejects(
    adapter.resolveTargets(resolveInput(payloads.scheduled, rule(), {
      scheduledFor: "2026-08-17T08:00:01.000Z",
    })),
    /payload_schema_unsupported/,
  )
  await assert.rejects(
    adapter.resolveTargets(resolveInput(payloads.directorReassigned, rule({ audienceKey: "track_director", channelKey: "in_app", connectionKey: null }))),
    /payload_schema_unsupported/,
  )
})

test("first attempt refreshes reminder preparation while retry preserves the frozen payload", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  let preparationReads = 0
  let currentSource = source
  const observationSourceReader = {
    async readSource() { return currentSource },
    async readCurrentPreparation() {
      preparationReads += 1
      return { textbookNames: ["현재 교재"], progressSummary: "현재 진도" }
    },
  }
  const adapter = createRegistrationNotificationAdapter(adapterDependencies(observationSourceReader))
  const target = (await adapter.resolveTargets(resolveInput(payloads.reminder))).targets[0]
  const base = {
    eventId: EVENT_ID,
    deliveryId: DELIVERY_ID,
    eventKey: payloads.reminder.event_kind,
    sourceType: "registration_observation",
    sourceId: OBSERVATION_ID,
    sourceRevision: "1",
    ruleId: RULE_ID,
    ruleRevision: "1",
    targetGeneration: "1",
    scheduledFor: "2026-08-17T06:00:00.000Z",
    target,
    eventSnapshot: { payloadSchemaVersion: 3, payload: payloads.reminder },
  }
  const first = await adapter.revalidateBeforeSend({ ...base, attemptCount: 0 })
  assert.equal(first.ok, true)
  assert.deepEqual(first.refreshedPayload.textbook_names, ["현재 교재"])
  assert.equal(first.refreshedPayload.progress_summary, "현재 진도")
  assert.match(first.payloadFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(preparationReads, 1)

  currentSource = {
    ...source,
    sourceRevision: { authority: "normalized", sessionId: SESSION_ID, revision: 8 },
  }
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...base, attemptCount: 1 }), { ok: true })
  assert.equal(preparationReads, 1)
})

test("revalidation separates tagged content drift, lifecycle closure, schedule drift, and paired director targets", async () => {
  const { createRegistrationNotificationAdapter } = await import(adapterModuleUrl)
  let currentSource = source
  let unexpectedPreparationReads = 0
  const reader = {
    async readSource() { return currentSource },
    async readCurrentPreparation() {
      unexpectedPreparationReads += 1
      throw new Error("scheduled and feedback events must not read preparation")
    },
  }
  const adapter = createRegistrationNotificationAdapter(adapterDependencies(reader))
  const scheduledTarget = (await adapter.resolveTargets(resolveInput(payloads.scheduled))).targets[0]
  const scheduledInput = {
    eventId: EVENT_ID,
    deliveryId: DELIVERY_ID,
    eventKey: payloads.scheduled.event_kind,
    sourceType: "registration_observation",
    sourceId: OBSERVATION_ID,
    sourceRevision: "1",
    ruleId: RULE_ID,
    ruleRevision: "1",
    targetGeneration: "1",
    scheduledFor: payloads.scheduled.occurred_at,
    attemptCount: 0,
    target: scheduledTarget,
    eventSnapshot: { payloadSchemaVersion: 3, payload: payloads.scheduled },
  }
  currentSource = {
    ...source,
    sourceRevision: { authority: "normalized", sessionId: SESSION_ID, revision: 8 },
  }
  const refreshed = await adapter.revalidateBeforeSend(scheduledInput)
  assert.equal(refreshed.ok, true)
  assert.deepEqual(refreshed.refreshedPayload.source_revision, currentSource.sourceRevision)
  assert.deepEqual(refreshed.refreshedPayload.textbook_names, payloads.scheduled.textbook_names)
  assert.equal(unexpectedPreparationReads, 0)

  currentSource = { ...source, bookingFactHash: "b".repeat(64) }
  assert.deepEqual(await adapter.revalidateBeforeSend(scheduledInput), {
    ok: false,
    status: "canceled",
    reason: "source_schedule_changed",
  })
  currentSource = { ...source, observationStatus: "canceled", appointmentStatus: "canceled" }
  assert.deepEqual(await adapter.revalidateBeforeSend(scheduledInput), {
    ok: false,
    status: "canceled",
    reason: "source_status_changed",
  })
  currentSource = { ...source, notificationRevision: 2 }
  assert.deepEqual(await adapter.revalidateBeforeSend(scheduledInput), {
    ok: false,
    status: "canceled",
    reason: "source_revision_changed",
  })

  currentSource = {
    ...source,
    observationStatus: "completed",
    appointmentStatus: "completed",
    hasFeedback: true,
    directorProfileId: null,
  }
  const managementRule = rule({ audienceKey: "management_team", connectionKey: null })
  const managementTarget = (await adapter.resolveTargets(
    resolveInput(payloads.feedbackSubmitted, managementRule),
  )).targets[0]
  const feedbackInput = {
    ...scheduledInput,
    eventKey: payloads.feedbackSubmitted.event_kind,
    scheduledFor: payloads.feedbackSubmitted.occurred_at,
    target: managementTarget,
    eventSnapshot: { payloadSchemaVersion: 3, payload: payloads.feedbackSubmitted },
  }
  const managementResult = await adapter.revalidateBeforeSend(feedbackInput)
  assert.equal(managementResult.ok, true)
  assert.deepEqual(managementResult.refreshedPayload.mention_profile_ids, [])
  const inboxRule = rule({ audienceKey: "track_director", channelKey: "in_app", connectionKey: null })
  const inboxTarget = (await adapter.resolveTargets(
    resolveInput(payloads.feedbackSubmitted, inboxRule),
  )).targets[0]
  assert.deepEqual(await adapter.revalidateBeforeSend({ ...feedbackInput, target: inboxTarget }), {
    ok: false,
    status: "canceled",
    reason: "recipient_revoked",
  })
  assert.equal(unexpectedPreparationReads, 0)
})

test("observation presentation exposes only the approved Korean context and rejects cross-room delivery", async () => {
  const { buildRegistrationNotificationPresentation } = await import(presentationModuleUrl)
  const input = {
    workflowKey: "registration",
    eventKey: payloads.scheduled.event_kind,
    ruleVariantKey: "immediate",
    payloadSchemaVersion: 3,
    payload: payloads.scheduled,
    audienceKey: "subject_team",
    channelKey: "google_chat",
    contractIdentity: {
      workflowKey: "registration",
      eventKey: payloads.scheduled.event_kind,
      audienceKey: "subject_team",
      channelKey: "google_chat",
      ruleVariantKey: "immediate",
    },
    requestedContextKeys: [
      "student_name", "subjects", "class_name", "scheduled_at", "teacher_name",
      "classroom", "textbooks", "progress",
    ],
    connectionKey: "google_chat.english",
    destinationTeam: "english",
    scheduledFor: payloads.scheduled.occurred_at,
  }
  const context = buildRegistrationNotificationPresentation(input)
  assert.deepEqual(context, {
    student_name: "청강 검증 학생",
    subjects: "영어",
    class_name: "중2 영어 A반",
    scheduled_at: "8월 17일(월) 18:00~20:00",
    teacher_name: "홍길동",
    classroom: "본관 301호",
    textbooks: "능률 VOCA",
    progress: "42~49쪽 · 단어 시험",
  })
  const rendered = `학생: ${context.student_name}\n과목/수업: [${context.subjects}] ${context.class_name}\n일시: ${context.scheduled_at}\n담당 선생님: ${context.teacher_name}\n강의실: ${context.classroom}\n교재: ${context.textbooks}\n진도: ${context.progress}\n교재 복사 등 청강 준비가 필요합니다.`
  for (const forbidden of [
    "010-", "전화", "fit", "unfit", "적합", "부적합", "feedback_reason",
    OBSERVATION_ID, "https://", "/admin/",
  ]) assert.doesNotMatch(rendered, new RegExp(forbidden, "iu"))

  assert.deepEqual(buildRegistrationNotificationPresentation({
    ...input,
    eventKey: payloads.rescheduled.event_kind,
    payload: payloads.rescheduled,
    contractIdentity: { ...input.contractIdentity, eventKey: payloads.rescheduled.event_kind },
    requestedContextKeys: ["before_schedule", "scheduled_at", "textbooks", "progress"],
  }), {
    before_schedule: "8월 16일(일) 18:00~20:00",
    scheduled_at: "8월 17일(월) 18:00~20:00",
    textbooks: "능률 VOCA",
    progress: "42~49쪽 · 단어 시험",
  })
  assert.deepEqual(buildRegistrationNotificationPresentation({
    ...input,
    eventKey: payloads.canceled.event_kind,
    payload: payloads.canceled,
    contractIdentity: { ...input.contractIdentity, eventKey: payloads.canceled.event_kind },
    requestedContextKeys: ["student_name", "subjects", "class_name", "scheduled_at"],
  }), {
    student_name: "청강 검증 학생",
    subjects: "영어",
    class_name: "중2 영어 A반",
    scheduled_at: "8월 17일(월) 18:00~20:00",
  })
  assert.deepEqual(buildRegistrationNotificationPresentation({
    ...input,
    eventKey: payloads.feedbackDue.event_kind,
    payload: payloads.feedbackDue,
    contractIdentity: { ...input.contractIdentity, eventKey: payloads.feedbackDue.event_kind },
    requestedContextKeys: ["teacher_name", "classroom"],
  }), { teacher_name: "홍길동", classroom: "본관 301호" })
  const managementInput = {
    ...input,
    eventKey: payloads.feedbackSubmitted.event_kind,
    payload: payloads.feedbackSubmitted,
    audienceKey: "management_team",
    connectionKey: "google_chat.management",
    destinationTeam: "management",
    contractIdentity: {
      ...input.contractIdentity,
      eventKey: payloads.feedbackSubmitted.event_kind,
      audienceKey: "management_team",
    },
    requestedContextKeys: ["student_name", "subjects", "class_name", "submitted_by_name", "submitted_at"],
  }
  assert.deepEqual(buildRegistrationNotificationPresentation(managementInput), {
    student_name: "청강 검증 학생",
    subjects: "영어",
    class_name: "중2 영어 A반",
    submitted_by_name: "김선생",
    submitted_at: "8월 17일(월) 20:10",
  })
  assert.deepEqual(buildRegistrationNotificationPresentation({
    ...managementInput,
    eventKey: payloads.directorReassigned.event_kind,
    payload: payloads.directorReassigned,
    contractIdentity: {
      ...managementInput.contractIdentity,
      eventKey: payloads.directorReassigned.event_kind,
    },
    requestedContextKeys: ["student_name", "subjects", "class_name"],
  }), {
    student_name: "청강 검증 학생",
    subjects: "영어",
    class_name: "중2 영어 A반",
  })

  assert.throws(
    () => buildRegistrationNotificationPresentation({
      ...input,
      connectionKey: "google_chat.management",
      destinationTeam: "management",
    }),
    /notification_registration_destination_unsupported/,
  )
  assert.throws(
    () => buildRegistrationNotificationPresentation({
      ...input,
      payload: { ...payloads.scheduled, student_name: "청\u202e강" },
    }),
    /notification_presentation_required_field_invalid/,
  )
})
