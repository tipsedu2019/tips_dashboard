import test from "node:test"
import assert from "node:assert/strict"
import {
  applyRegistrationEnrollmentClassSelection,
  canEditRegistrationAppointment,
  createRegistrationEnrollmentDraft,
  deriveRegistrationParentState,
  getEligibleSharedAppointmentTracks,
  getRegistrationAppointmentEditMode,
  getRegistrationAppointmentPayloadTrackIds,
  getLatestRegistrationLevelTestActivityIds,
  getRegistrationAdmissionBatchCancellationGroups,
  getRegistrationAdmissionBatchChecklist,
  getRegistrationAdmissionRecoveryDelayMs,
  getRegistrationAdmissionApplicationState,
  getRegistrationEnrollmentCancellationState,
  getRegistrationSelectedAdmissionEnrollmentIds,
  getRegistrationEnrollmentBlockers,
  getRegistrationLevelTestAppointmentStatus,
  getRegistrationSummaryActionPermissions,
  getRegistrationActionPermissions,
  getRegistrationTrackNextStatus,
  getRegistrationTrackTabCounts,
  getRegistrationTrackTransitionBlockers,
  getRegistrationTrackViewKey,
  mergeSavedRegistrationEnrollmentRows,
  restoreRegistrationEnrollmentDraft,
  serializeRegistrationEnrollmentRows,
} from "../src/features/tasks/registration-track-model.js"

test("new enrollment rows keep stable keys and selecting a class defaults its linked textbook", () => {
  const first = createRegistrationEnrollmentDraft({ clientKey: "draft-1" })
  const second = createRegistrationEnrollmentDraft({ clientKey: "draft-2" })
  const selected = applyRegistrationEnrollmentClassSelection(first, {
    classItem: { id: "eng-a", subject: "영어", textbookIds: ["missing", "book-a"] },
    availableTextbookIds: ["book-a"],
  })

  assert.equal(selected.clientKey, "draft-1")
  assert.equal(selected.classId, "eng-a")
  assert.equal(selected.textbookId, "book-a")
  assert.equal(selected.textbookExplicitlyCleared, false)
  assert.equal(second.classId, "")
  assert.equal(first.id, null)
  assert.deepEqual(serializeRegistrationEnrollmentRows([selected])[0], {
    classId: "eng-a",
    textbookId: "book-a",
    classStartDate: null,
    classStartSessionKey: null,
    classStartSession: null,
    sortOrder: 0,
  })
})

test("persisted null textbook restores as an explicit already-owned choice", () => {
  assert.equal(restoreRegistrationEnrollmentDraft({
    id: "saved-null",
    classId: "eng-a",
    textbookId: null,
    status: "planned",
  }).textbookExplicitlyCleared, true)
  assert.equal(restoreRegistrationEnrollmentDraft({
    id: "saved-book",
    classId: "eng-a",
    textbookId: "book-a",
    status: "planned",
  }).textbookExplicitlyCleared, false)
  assert.equal(createRegistrationEnrollmentDraft({ clientKey: "new" }).textbookExplicitlyCleared, false)
})

test("enrollment serialization preserves only real persisted UUIDs", () => {
  const id = "11111111-1111-4111-8111-111111111111"
  const persisted = createRegistrationEnrollmentDraft({
    id,
    clientKey: "persisted",
    classId: "eng-a",
  })
  const local = createRegistrationEnrollmentDraft({
    id: "not-a-uuid",
    clientKey: "local",
    classId: "eng-b",
    sortOrder: 1,
  })
  assert.equal(serializeRegistrationEnrollmentRows([persisted])[0].id, id)
  assert.equal("id" in serializeRegistrationEnrollmentRows([local])[0], false)
})

test("saved enrollment rows merge authoritative IDs without changing local keys", () => {
  const local = [
    createRegistrationEnrollmentDraft({ clientKey: "local-1", classId: "eng-a", sortOrder: 0 }),
    createRegistrationEnrollmentDraft({ clientKey: "local-2", classId: "eng-b", sortOrder: 1 }),
  ]
  const saved = mergeSavedRegistrationEnrollmentRows(local, [
    { id: "db-2", classId: "eng-b", textbookId: null, sortOrder: 1, status: "planned" },
    { id: "db-1", classId: "eng-a", textbookId: "book-a", sortOrder: 0, status: "planned" },
  ])
  assert.deepEqual(saved.map((row) => [row.id, row.clientKey]), [
    ["db-1", "local-1"],
    ["db-2", "local-2"],
  ])
  assert.equal(saved[0].textbookId, "book-a")
})

test("enrollment blockers are row-specific and reject duplicate or cross-subject classes", () => {
  const rows = [
    createRegistrationEnrollmentDraft({ clientKey: "1", classId: "eng-a" }),
    createRegistrationEnrollmentDraft({ clientKey: "2", classId: "eng-a", sortOrder: 1 }),
    createRegistrationEnrollmentDraft({ clientKey: "3", classId: "math-a", sortOrder: 2 }),
    createRegistrationEnrollmentDraft({ clientKey: "4", classId: "", sortOrder: 3 }),
  ]
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows,
    classes: [
      { id: "eng-a", subject: "영어" },
      { id: "math-a", subject: "수학" },
    ],
  }), [
    { rowId: "2", field: "classId", message: "중복 수업" },
    { rowId: "3", field: "classId", message: "과목이 일치하지 않는 수업" },
    { rowId: "4", field: "classId", message: "수업을 선택해 주세요." },
  ])
})

test("released enrollment history does not block re-enrollment in the same class", () => {
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [
      createRegistrationEnrollmentDraft({
        id: "history",
        clientKey: "history",
        classId: "eng-a",
        status: "enrolled",
        rosterActive: false,
      }),
      createRegistrationEnrollmentDraft({ clientKey: "new", classId: "eng-a", sortOrder: 1 }),
    ],
    classes: [{ id: "eng-a", subject: "영어" }],
  }), [])
})

test("a roster-active enrolled class blocks a new draft for the same class", () => {
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [
      createRegistrationEnrollmentDraft({
        id: "active",
        clientKey: "active",
        classId: "eng-a",
        status: "enrolled",
        rosterActive: true,
      }),
      createRegistrationEnrollmentDraft({ clientKey: "new", classId: "eng-a", sortOrder: 1 }),
    ],
    classes: [{ id: "eng-a", subject: "영어" }],
  }), [
    { rowId: "new", field: "classId", message: "중복 수업" },
  ])
})

test("admission processing validates selected schedule and optional textbook per row", () => {
  const row = createRegistrationEnrollmentDraft({
    clientKey: "draft",
    classId: "eng-a",
    textbookId: "unknown-book",
    classStartDate: "2026-07-20",
    classStartSessionKey: "2026-07-20:9",
    classStartSession: "9회차",
  })
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [row],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a"],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: true,
  }), [
    { rowId: "draft", field: "textbookId", message: "선택할 수 없는 교재" },
    { rowId: "draft", field: "classStartSessionKey", message: "선택할 수 없는 수업 일정" },
  ])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [{ ...row, textbookId: "", classStartSessionKey: "2026-07-20:1", classStartSession: "1회차" }],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a"],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: true,
  }), [])
})

test("draft enrollment permits no schedule but rejects partial or stale provided schedules", () => {
  const base = createRegistrationEnrollmentDraft({ clientKey: "draft", classId: "eng-a" })
  const input = {
    subject: "영어",
    classes: [{ id: "eng-a", subject: "영어" }],
    validScheduleSessionKeysByClassId: { "eng-a": ["2026-07-20:1"] },
    requireSchedule: false,
  }
  assert.deepEqual(getRegistrationEnrollmentBlockers({ ...input, rows: [base] }), [])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    ...input,
    rows: [{ ...base, classStartDate: "2026-07-20" }],
  }), [{ rowId: "draft", field: "classStartSessionKey", message: "수업 시작 일정 입력을 완성해 주세요." }])
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    ...input,
    rows: [{ ...base, classStartDate: "2026-07-20", classStartSessionKey: "2026-07-20:9", classStartSession: "9회차" }],
  }), [{ rowId: "draft", field: "classStartSessionKey", message: "선택할 수 없는 수업 일정" }])
})

test("a globally valid textbook is still blocked when it is not linked to the selected class", () => {
  const row = createRegistrationEnrollmentDraft({
    clientKey: "draft",
    classId: "eng-a",
    textbookId: "book-other",
  })
  assert.deepEqual(getRegistrationEnrollmentBlockers({
    subject: "영어",
    rows: [row],
    classes: [{ id: "eng-a", subject: "영어" }],
    availableTextbookIds: ["book-a", "book-other"],
    validTextbookIdsByClassId: { "eng-a": ["book-a"] },
  }), [
    { rowId: "draft", field: "textbookId", message: "선택한 수업에 연결되지 않은 교재" },
  ])
})

test("each admission revision derives its own ordered checklist", () => {
  assert.deepEqual(getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ makeeduRegistered: true }, { makeeduRegistered: false }],
    batch: { status: "draft", invoiceSentAt: "", paymentConfirmedAt: "" },
  }), {
    admissionNotice: true,
    makeedu: false,
    invoice: false,
    payment: false,
    complete: false,
  })
  assert.deepEqual(getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent: true,
    enrollments: [{ makeeduRegistered: true }],
    batch: { status: "paid", invoiceSentAt: "2026-07-20", paymentConfirmedAt: "2026-07-21" },
  }), {
    admissionNotice: true,
    makeedu: true,
    invoice: true,
    payment: true,
    complete: false,
  })
})

test("planned enrollment cancellation never asks for a track destination", () => {
  const planned = { id: "planned", trackId: "eng", status: "planned", rosterActive: false }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: planned,
    enrollments: [planned],
  }), {
    requiresDestination: false,
    hasSurvivingEnrolledRows: false,
    destination: "",
  })
})

test("planned siblings do not keep the last roster-active enrollment registered", () => {
  const active = { id: "active", trackId: "eng", status: "enrolled", rosterActive: true }
  const planned = { id: "planned", trackId: "eng", status: "planned", rosterActive: false }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: active,
    enrollments: [active, planned],
  }), {
    requiresDestination: true,
    hasSurvivingEnrolledRows: false,
    destination: null,
  })
})

test("another roster-active enrolled row avoids destination routing", () => {
  const active = { id: "active", trackId: "eng", status: "enrolled", rosterActive: true }
  const surviving = { id: "surviving", trackId: "eng", status: "enrolled", rosterActive: true }
  assert.deepEqual(getRegistrationEnrollmentCancellationState({
    enrollment: active,
    enrollments: [active, surviving],
  }), {
    requiresDestination: false,
    hasSurvivingEnrolledRows: true,
    destination: "",
  })
})

test("released enrolled history makes a new batch an add-class revision", () => {
  assert.deepEqual(getRegistrationAdmissionBatchCancellationGroups({
    batchId: "batch-new",
    currentBatchEnrollments: [
      { id: "new-eng", trackId: "eng", admissionBatchId: "batch-new", status: "planned" },
      { id: "new-math", trackId: "math", admissionBatchId: "batch-new", status: "planned" },
    ],
    enrollments: [
      { id: "old-eng", trackId: "eng", admissionBatchId: "batch-old", status: "enrolled", rosterActive: false },
      { id: "new-eng", trackId: "eng", admissionBatchId: "batch-new", status: "planned" },
      { id: "new-math", trackId: "math", admissionBatchId: "batch-new", status: "planned" },
    ],
  }), {
    addClassTrackIds: ["eng"],
    firstAdmissionTrackIds: ["math"],
  })
})

test("stale admission selections never enable a new unselected add-class row", () => {
  assert.deepEqual(getRegistrationSelectedAdmissionEnrollmentIds({
    selectedEnrollmentIds: new Set(["old-row"]),
    enrollments: [
      { id: "new-row", status: "planned", admissionBatchId: null },
      { id: "old-row", status: "enrolled", admissionBatchId: "completed-batch" },
    ],
  }), [])
  assert.deepEqual(getRegistrationSelectedAdmissionEnrollmentIds({
    selectedEnrollmentIds: new Set(["old-row", "new-row"]),
    enrollments: [{ id: "new-row", status: "planned", admissionBatchId: null }],
  }), ["new-row"])
})

test("admission recovery delay reaches zero after exactly fifteen fake minutes", () => {
  const updatedAt = "2026-07-13T00:00:00.000Z"
  const start = Date.parse(updatedAt)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start), 15 * 60 * 1000)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start + 15 * 60 * 1000 - 1), 1)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs(updatedAt, start + 15 * 60 * 1000), 0)
  assert.equal(getRegistrationAdmissionRecoveryDelayMs("", start), null)
})

test("admission application state follows eligible child tracks and active message truth", () => {
  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [
      { id: "english", status: "enrollment_decided" },
      { id: "math", status: "level_test_scheduled" },
    ],
    enrollments: [],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "",
    admissionApplicationMessageClaimActive: false,
  }), {
    eligible: true,
    delivered: false,
    syncNeeded: false,
    blocked: false,
    canSend: true,
  })

  assert.deepEqual(getRegistrationAdmissionApplicationState({
    tracks: [{ id: "english", status: "registered" }],
    enrollments: [{ trackId: "english", status: "planned", admissionBatchId: null }],
    admissionNoticeSent: false,
    admissionApplicationMessageStatus: "accepted",
    admissionApplicationMessageClaimActive: true,
  }), {
    eligible: true,
    delivered: true,
    syncNeeded: true,
    blocked: false,
    canSend: false,
  })

  for (const status of ["pending", "unknown", "failed_hold"]) {
    const blocked = getRegistrationAdmissionApplicationState({
      tracks: [{ id: "english", status: "enrollment_decided" }],
      enrollments: [],
      admissionNoticeSent: false,
      admissionApplicationMessageStatus: status,
      admissionApplicationMessageClaimActive: true,
    })
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.canSend, false)
  }
})

test("admission application excludes released history and batched or canceled add-class rows", () => {
  const tracks = [{ id: "english", status: "registered" }]
  for (const enrollment of [
    { trackId: "english", status: "enrolled", rosterActive: false, admissionBatchId: null },
    { trackId: "english", status: "canceled", admissionBatchId: null },
    { trackId: "english", status: "planned", admissionBatchId: "batch-1" },
    { trackId: "math", status: "planned", admissionBatchId: null },
  ]) {
    assert.equal(getRegistrationAdmissionApplicationState({
      tracks,
      enrollments: [enrollment],
      admissionNoticeSent: false,
      admissionApplicationMessageStatus: "",
      admissionApplicationMessageClaimActive: false,
    }).eligible, false)
  }
})

test("shared level test includes both eligible subjects but keeps results independent", () => {
  assert.deepEqual(getEligibleSharedAppointmentTracks("level_test", [
    { id: "eng", subject: "영어", status: "inquiry" },
    { id: "math", subject: "수학", status: "inquiry" },
    { id: "waiting", subject: "수학", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "closed", subject: "영어", status: "registered" },
  ]).map((track) => track.id), ["eng", "math", "waiting"])
})

test("appointment eligibility excludes an active activity elsewhere but keeps the current scheduled selection", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "waiting", levelTestRetakeDecision: "required" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "other", status: "scheduled" },
    { trackId: "math", appointmentId: "current", status: "scheduled" },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, "current").map((track) => track.id),
    ["math"],
  )
})

test("a shared test reschedules only the absent subject after its sibling completed", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "consultation_waiting" },
    { id: "math", subject: "수학", status: "level_test_scheduled" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "old", status: "completed", attemptNumber: 1 },
    { trackId: "math", appointmentId: "old", status: "absent", attemptNumber: 1 },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("level_test", tracks, activities, null).map((track) => track.id),
    ["math"],
  )
})

test("visit appointment eligibility includes only free consultation-waiting subjects", () => {
  const tracks = [
    { id: "eng", subject: "영어", status: "consultation_waiting" },
    { id: "math", subject: "수학", status: "consultation_waiting" },
    { id: "done", subject: "영어", status: "registered" },
  ]
  const activities = [
    { trackId: "eng", appointmentId: "other", status: "scheduled" },
    { trackId: "math", appointmentId: "phone", mode: "phone", status: "waiting" },
  ]
  assert.deepEqual(
    getEligibleSharedAppointmentTracks("visit_consultation", tracks, activities, null).map((track) => track.id),
    ["math"],
  )
})

test("started shared appointment requires replacement rather than in-place edit", () => {
  assert.equal(getRegistrationAppointmentEditMode([{ status: "scheduled" }, { status: "scheduled" }]), "edit")
  assert.equal(getRegistrationAppointmentEditMode([{ status: "completed" }, { status: "scheduled" }]), "replace_remaining")
})

test("a mounted appointment transition submits only still-scheduled children on the current appointment", () => {
  assert.deepEqual(getRegistrationAppointmentPayloadTrackIds(
    "replace_remaining",
    ["eng", "math"],
    [
      { id: "eng-1", trackId: "eng", appointmentId: "current", status: "in_progress" },
      { id: "math-1", trackId: "math", appointmentId: "current", status: "scheduled" },
      { id: "other-1", trackId: "other", appointmentId: "other", status: "scheduled" },
    ],
    "current",
  ), ["math"])
})

test("historical absent or canceled attempts cannot expose actions after a newer attempt exists", () => {
  assert.deepEqual(getLatestRegistrationLevelTestActivityIds([
    { id: "math-old", trackId: "math", attemptNumber: 1, status: "absent" },
    { id: "math-new", trackId: "math", attemptNumber: 2, status: "completed" },
    { id: "eng-new", trackId: "eng", attemptNumber: 1, status: "canceled" },
  ]), ["math-new", "eng-new"])
})

test("track statuses map one-to-one to the six registration tabs", () => {
  assert.equal(getRegistrationTrackViewKey("inquiry"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("migration_review"), "inquiry")
  assert.equal(getRegistrationTrackViewKey("level_test_scheduled"), "level_test")
  assert.equal(getRegistrationTrackViewKey("consultation_waiting"), "consulting")
  assert.equal(getRegistrationTrackViewKey("waiting"), "waiting")
  assert.equal(getRegistrationTrackViewKey("enrollment_processing"), "enrollment")
  assert.equal(getRegistrationTrackViewKey("registered"), "closed")
})

test("tab counts count subject tracks rather than parent cases", () => {
  assert.deepEqual(getRegistrationTrackTabCounts([
    { id: "english", taskId: "case-1", status: "consultation_waiting" },
    { id: "math", taskId: "case-1", status: "level_test_scheduled" },
  ]), { inquiry: 0, level_test: 1, consulting: 1, waiting: 0, enrollment: 0, closed: 0 })
})

test("phone consultation completion requires an outcome and advances atomically", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "",
  }), ["상담 결과"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "consultation_waiting",
    action: "complete_phone_consultation",
    outcome: "enrollment",
  }), "enrollment_decided")
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "visit_consultation_scheduled",
    action: "complete_visit_consultation",
    outcome: "",
  }), ["상담 결과"])
})

test("level-test completion advances only a completed subject", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "completed",
  }), "consultation_waiting")
  assert.equal(getRegistrationTrackNextStatus({
    status: "level_test_in_progress",
    action: "record_level_test_result",
    resultStatus: "absent",
  }), "level_test_scheduled")
})

test("waiting to enrollment requires an explicit retake decision", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "waiting",
    action: "move_to_enrollment",
    retakeDecision: null,
  }), ["레벨테스트 재응시 여부"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "waiting",
    action: "schedule_level_test",
    retakeDecision: "required",
  }), "level_test_scheduled")
})

test("level-test appointment completes only after every attempt is terminal", () => {
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "scheduled", materialLink: "" },
  ]), "scheduled")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "completed", materialLink: "https://drive.test/english" },
    { status: "absent", materialLink: "" },
  ]), "completed")
  assert.equal(getRegistrationLevelTestAppointmentStatus([
    { status: "canceled", materialLink: "" },
    { status: "canceled", materialLink: "" },
  ]), "canceled")
  assert.equal(canEditRegistrationAppointment([{ status: "completed" }, { status: "scheduled" }]), false)
})

test("parent stays open for tracks or admission batches still in progress", () => {
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "waiting" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "in_progress", outcome: "" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "registered" }, { status: "not_registered" }],
    batches: [{ status: "completed" }],
  }), { taskStatus: "done", outcome: "partial_registration" })
  assert.deepEqual(deriveRegistrationParentState({
    tracks: [{ status: "inquiry" }],
    batches: [{ status: "draft" }],
  }), { taskStatus: "in_progress", outcome: "" })
})

test("illegal cross-stage actions are blocked instead of silently jumping stages", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "inquiry",
    action: "complete_enrollment",
  }), ["현재 단계에서 할 수 없는 작업"])
  assert.equal(getRegistrationTrackNextStatus({
    status: "inquiry",
    action: "complete_enrollment",
  }), "inquiry")
})

test("UI action permissions mirror the database mutation matrix", () => {
  const track = { id: "eng", directorProfileId: "director-1", status: "consultation_waiting" }
  const activeConsultation = { trackId: "eng", directorProfileId: "director-1", mode: "phone", status: "waiting" }
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: true,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "admin", viewerId: "director-2", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "staff", viewerId: "staff-1", track, activeConsultation }), {
    canManage: true,
    canCompleteConsultation: false,
    readOnly: false,
  })
  assert.deepEqual(getRegistrationActionPermissions({ viewerRole: "assistant", viewerId: "assistant-1", track, activeConsultation }), {
    canManage: false,
    canCompleteConsultation: false,
    readOnly: true,
  })
  assert.equal(getRegistrationActionPermissions({ viewerRole: "teacher", viewerId: "director-1", track, activeConsultation }).canCompleteConsultation, false)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-1", track }).canOpenConsultationCompletion, true)
  assert.equal(getRegistrationSummaryActionPermissions({ viewerRole: "admin", viewerId: "director-2", track }).canOpenConsultationCompletion, false)
})

test("a second admission batch cannot start while another batch is open", () => {
  assert.deepEqual(getRegistrationTrackTransitionBlockers({
    status: "enrollment_decided",
    action: "start_enrollment_processing",
    enrollmentCount: 1,
    everyScheduleValid: true,
    admissionNoticeSent: true,
    hasOtherOpenBatch: true,
  }), ["진행 중인 입학 처리"])
})

test("canceling an add-class batch restores a track that still has enrolled classes", () => {
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: true,
  }), "registered")
  assert.equal(getRegistrationTrackNextStatus({
    status: "enrollment_processing",
    action: "cancel_admission_batch",
    hasSurvivingEnrolledRows: false,
    destination: "waiting",
  }), "waiting")
})
