import assert from "node:assert/strict";
import test from "node:test";

import { buildRegistrationSubjectHistory } from "../src/features/tasks/registration-track-history.js";

function detailFixture() {
  return {
    tracks: [
      { id: "eng", subject: "영어" },
      { id: "math", subject: "수학" },
    ],
    appointments: [{ id: "shared", kind: "level_test", scheduledAt: "2026-07-14T01:00:00Z", place: "본관", status: "scheduled", createdAt: "2026-07-12T01:00:00Z", updatedAt: "2026-07-12T01:00:00Z" }],
    levelTests: [
      { id: "test-eng", trackId: "eng", appointmentId: "shared", attemptNumber: 1, status: "scheduled", startedAt: null, completedAt: null, materialLink: null },
      { id: "test-math", trackId: "math", appointmentId: "shared", attemptNumber: 1, status: "completed", startedAt: "2026-07-14T01:00:00Z", completedAt: "2026-07-14T02:00:00Z", materialLink: "https://drive.test/result" },
    ],
    consultations: [{ id: "consult-eng", trackId: "eng", appointmentId: null, mode: "phone", status: "completed", completedAt: "2026-07-15T03:00:00Z", outcome: "waiting", createdAt: "2026-07-14T03:00:00Z", updatedAt: "2026-07-15T03:00:00Z" }],
    admissionBatches: [{ id: "batch", revisionNumber: 1, status: "draft", invoiceSentAt: null, paymentConfirmedAt: null, createdAt: "2026-07-16T01:00:00Z", updatedAt: "2026-07-16T01:00:00Z" }],
    enrollments: [
      { id: "enroll-eng", trackId: "eng", admissionBatchId: "batch", classId: "class-a", textbookId: null, status: "planned", createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z" },
      { id: "enroll-math", trackId: "math", admissionBatchId: "batch", classId: "class-b", textbookId: null, status: "planned", createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z" },
    ],
    events: [
      { id: "event-v1", trackId: "eng", eventType: "waiting_transitioned", subject: "영어", source: "waiting", destination: "level_test_scheduled", reason: "재응시", metadata: { waitingKind: "current_class", retakeDecision: "required", classId: "class-old" }, actorId: "actor", actorKind: null, payloadVersion: 1, occurredAt: "2026-07-13T01:00:00Z", legacyText: null },
      { id: "event-legacy", trackId: null, eventType: "future_event", subject: null, source: null, destination: null, reason: null, metadata: {}, actorId: null, occurredAt: "2026-07-12T00:00:00Z", legacyText: "plain future history" },
    ],
  };
}

test("history keeps canonical snapshots but excludes unknown generic legacy rows", () => {
  const history = buildRegistrationSubjectHistory(detailFixture());
  assert.equal(history.some((item) => item.id === "event:event-legacy"), false);
  const canonical = history.find((item) => item.id === "event:event-v1");
  assert.deepEqual(canonical.subjects, ["영어"]);
  assert.equal(canonical.metadata.waitingKind, "current_class");
  assert.equal(canonical.actorId, "actor");
  assert.match(canonical.description, /대기 유형: 현재 수업 대기/);
  assert.match(canonical.description, /재응시 결정: 필요/);
  assert.match(canonical.description, /수업: class-old/);
  assert.doesNotMatch(canonical.description, /waitingKind:|retakeDecision:|classId:|current_class|required|waiting →|level_test_scheduled/);
  const exactTimes = history.filter((item) => item.timeKind === "exact").map((item) => item.occurredAt);
  assert.deepEqual(exactTimes, [...exactTimes].sort().reverse());
});

test("shared appointments and batches list each participating subject once", () => {
  const history = buildRegistrationSubjectHistory(detailFixture());
  const appointment = history.find((item) => item.id === "appointment:shared");
  assert.deepEqual(appointment.subjects, ["영어", "수학"]);
  assert.equal(appointment.occurredAt, null, "a migration fallback never borrows mutable appointment time as event truth");
  assert.equal(appointment.timeKind, "unavailable");
  assert.equal(appointment.origin, "migration");
  assert.equal(appointment.metadata.scheduledAt, "2026-07-14T01:00:00Z");
  assert.deepEqual(history.find((item) => item.id === "batch:batch").subjects, ["영어", "수학"]);
  assert.deepEqual(history.find((item) => item.id === "level-test:test-math").subjects, ["수학"]);
  assert.deepEqual(history.find((item) => item.id === "enrollment:enroll-eng").subjects, ["영어"]);
});

test("history keeps science in registry order and filters unsupported subjects", () => {
  const history = buildRegistrationSubjectHistory({
    tracks: [
      { id: "science", subject: "과학" },
      { id: "english", subject: "영어" },
      { id: "unsupported", subject: "unknown" },
    ],
    appointments: [{
      id: "shared-science",
      kind: "level_test",
      scheduledAt: "2026-07-14T01:00:00Z",
      place: "본관",
      status: "scheduled",
    }],
    levelTests: [
      { id: "science-test", trackId: "science", appointmentId: "shared-science", attemptNumber: 1, status: "scheduled" },
      { id: "english-test", trackId: "english", appointmentId: "shared-science", attemptNumber: 1, status: "scheduled" },
      { id: "unsupported-test", trackId: "unsupported", appointmentId: "shared-science", attemptNumber: 1, status: "scheduled" },
    ],
  });

  assert.deepEqual(
    history.find((item) => item.id === "appointment:shared-science").subjects,
    ["영어", "과학"],
  );
});

test("equal timestamps use stable ids and malformed collections degrade to an empty history", () => {
  const detail = detailFixture();
  detail.events = [
    { ...detail.events[0], id: "b", occurredAt: "2026-07-13T01:00:00Z" },
    { ...detail.events[0], id: "a", occurredAt: "2026-07-13T01:00:00Z" },
  ];
  const ids = buildRegistrationSubjectHistory(detail).filter((item) => item.kind === "event").map((item) => item.id);
  assert.deepEqual(ids, ["event:a", "event:b"]);
  assert.deepEqual(buildRegistrationSubjectHistory({}), []);
});

test("canonical entity events replace matching child snapshots and merge shared-subject audit rows", () => {
  const detail = detailFixture();
  detail.events = [
    { id: "schedule-eng", trackId: "eng", eventType: "level_test_scheduled", subject: "영어", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "shared", activityId: "test-eng" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-12T01:00:00Z", legacyText: null },
    { id: "schedule-math", trackId: "math", eventType: "level_test_scheduled", subject: "수학", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "shared", activityId: "test-math" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-12T01:00:00.001Z", legacyText: null },
    { id: "consult", trackId: "eng", eventType: "consultation_completed", subject: "영어", source: "consultation_waiting", destination: "waiting", reason: null, metadata: { consultationId: "consult-eng", outcome: "waiting" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-15T03:00:00Z", legacyText: null },
    { id: "batch-eng", trackId: "eng", eventType: "admission_batch_started", subject: "영어", source: "enrollment_decided", destination: "enrollment_processing", reason: null, metadata: { batchId: "batch" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-16T01:00:00Z", legacyText: null },
    { id: "batch-math", trackId: "math", eventType: "admission_batch_started", subject: "수학", source: "enrollment_decided", destination: "enrollment_processing", reason: null, metadata: { batchId: "batch" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-16T01:00:00.001Z", legacyText: null },
  ];

  const history = buildRegistrationSubjectHistory(detail);
  const appointmentItems = history.filter((item) => item.metadata.appointmentId === "shared" && item.kind !== "level_test");
  assert.equal(appointmentItems.length, 1);
  assert.deepEqual(appointmentItems[0].subjects, ["영어", "수학"]);
  assert.equal(history.some((item) => item.id === "level-test:test-eng"), false);
  assert.equal(history.some((item) => item.id === "level-test:test-math"), true, "a later result remains visible without its own canonical result event");
  assert.equal(history.filter((item) => item.metadata.consultationId === "consult-eng").length, 1);
  const batchItems = history.filter((item) => item.metadata.batchId === "batch" && item.kind !== "enrollment");
  assert.equal(batchItems.length, 1);
  assert.deepEqual(batchItems[0].subjects, ["영어", "수학"]);
});

test("실제 SQL 형태의 예약 교체 이벤트는 기존 예약 마일스톤 한 건에 흡수된다", () => {
  const detail = detailFixture();
  detail.appointments = [
    { ...detail.appointments[0], id: "old", status: "canceled", updatedAt: "2026-07-12T00:59:59Z" },
    { ...detail.appointments[0], id: "new", notificationRevision: 2, updatedAt: "2026-07-12T01:00:00Z" },
  ];
  detail.levelTests = [
    { ...detail.levelTests[0], id: "new-eng", appointmentId: "new" },
    { ...detail.levelTests[0], id: "new-math", trackId: "math", appointmentId: "new" },
  ];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [];
  detail.events = [
    { id: "schedule-eng", trackId: "eng", eventType: "level_test_scheduled", subject: "영어", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "old", notificationRevision: 1, activityId: "old-eng", scheduledAt: "2026-07-14T01:00:00Z", place: "본관" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-11T01:00:00Z", legacyText: null },
    { id: "schedule-math", trackId: "math", eventType: "level_test_scheduled", subject: "수학", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "old", notificationRevision: 1, activityId: "old-math", scheduledAt: "2026-07-14T01:00:00Z", place: "본관" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-11T01:00:00.001Z", legacyText: null },
    { id: "replace-eng", trackId: "eng", eventType: "appointment_replaced", subject: "영어", source: "level_test_scheduled", destination: "level_test_scheduled", reason: null, metadata: { oldAppointmentId: "old", newAppointmentId: "new", oldNotificationRevision: 2, notificationRevision: 1, kind: "level_test", oldScheduledAt: "2026-07-14T01:00:00Z", oldPlace: "본관", scheduledAt: "2026-07-15T01:00:00Z", place: "별관", activityId: "new-eng", changeKind: "appointment_replaced" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-12T01:00:00Z", legacyText: null },
    { id: "replace-math", trackId: "math", eventType: "appointment_replaced", subject: "수학", source: "level_test_scheduled", destination: "level_test_scheduled", reason: null, metadata: { oldAppointmentId: "old", newAppointmentId: "new", oldNotificationRevision: 2, notificationRevision: 1, kind: "level_test", oldScheduledAt: "2026-07-14T01:00:00Z", oldPlace: "본관", scheduledAt: "2026-07-15T01:00:00Z", place: "별관", activityId: "new-math", changeKind: "appointment_replaced" }, actorId: "actor", payloadVersion: 2, occurredAt: "2026-07-12T01:00:00.001Z", legacyText: null },
  ];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].subjects, ["영어", "수학"]);
  assert.equal(history[0].metadata.appointmentChanges.length, 1);
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.newAppointmentId, "new");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.oldPlace, "본관");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.place, "별관");
});

test("retake schedule events replace their scheduled attempt snapshot", () => {
  const detail = detailFixture();
  detail.levelTests = [{
    ...detail.levelTests[0],
    attemptNumber: 2,
  }];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [];
  detail.events = [{
    id: "retake-eng",
    trackId: "eng",
    eventType: "level_test_retake_scheduled",
    subject: "영어",
    source: "waiting",
    destination: "level_test_scheduled",
    reason: null,
    metadata: {
      appointmentId: "shared",
      activityId: "test-eng",
      notificationRevision: 2,
      changeKind: "appointment_updated",
      kind: "level_test",
      scheduledAt: "2026-07-14T01:00:00Z",
      place: "본관",
    },
    actorId: "actor",
    occurredAt: "2026-07-12T01:00:00Z",
    payloadVersion: 2,
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, "레벨테스트 재응시 예약");
  assert.match(history[0].description, /예약 시각: 2026-07-14T01:00:00Z/);
  assert.match(history[0].description, /장소: 본관/);
  assert.equal(history.some((item) => item.id === "level-test:test-eng"), false);
});

test("one appointment edit merges mixed per-subject event types and absorbs every scheduled child", () => {
  const detail = detailFixture();
  detail.levelTests = [
    { ...detail.levelTests[0], attemptNumber: 2 },
    { ...detail.levelTests[0], id: "test-math", trackId: "math" },
  ];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [];
  detail.events = [
    {
      id: "edit-eng",
      trackId: "eng",
      eventType: "level_test_retake_scheduled",
      subject: "영어",
      source: "waiting",
      destination: "level_test_scheduled",
      reason: null,
      metadata: { appointmentId: "shared", activityId: "test-eng", notificationRevision: 2, changeKind: "appointment_updated" },
      actorId: "actor",
      occurredAt: "2026-07-12T01:00:00Z",
      payloadVersion: 2,
      legacyText: null,
    },
    {
      id: "edit-math",
      trackId: "math",
      eventType: "appointment_updated",
      subject: "수학",
      source: "level_test_scheduled",
      destination: "level_test_scheduled",
      reason: null,
      metadata: { appointmentId: "shared", notificationRevision: 2, changeKind: "appointment_updated" },
      actorId: "actor",
      occurredAt: "2026-07-12T01:00:00.001Z",
      payloadVersion: 2,
      legacyText: null,
    },
  ];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, "예약 변경");
  assert.deepEqual(history[0].subjects, ["영어", "수학"]);
  assert.deepEqual(
    history[0].metadata.subjectTransitions.map((transition) => transition.eventType).sort(),
    ["appointment_updated", "level_test_retake_scheduled"],
  );
  assert.match(history[0].description, /영어: 대기 → 레벨테스트 예약/);
  assert.match(history[0].description, /수학: 레벨테스트 예약 → 레벨테스트 예약/);
});

test("batch cancellation keeps different per-subject routing snapshots as separate rows", () => {
  const detail = detailFixture();
  detail.appointments = [];
  detail.levelTests = [];
  detail.consultations = [];
  detail.events = [
    {
      id: "cancel-eng",
      trackId: "eng",
      eventType: "admission_batch_canceled",
      subject: "영어",
      source: "enrollment_processing",
      destination: "waiting",
      reason: "보류",
      metadata: { batchId: "batch", waitingKind: "current_class", classId: "class-a", restoredHistoricalEnrollment: false },
      actorId: "actor",
      occurredAt: "2026-07-16T02:00:00Z",
      payloadVersion: 2,
      legacyText: null,
    },
    {
      id: "cancel-math",
      trackId: "math",
      eventType: "admission_batch_canceled",
      subject: "수학",
      source: "enrollment_processing",
      destination: "not_registered",
      reason: "보류",
      metadata: { batchId: "batch", waitingKind: null, classId: null, restoredHistoricalEnrollment: false },
      actorId: "actor",
      occurredAt: "2026-07-16T02:00:00.001Z",
      payloadVersion: 2,
      legacyText: null,
    },
  ];

  const events = buildRegistrationSubjectHistory(detail).filter((item) => item.kind === "event");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => item.subjects), [["영어"], ["수학"]]);
  assert.match(events.find((item) => item.subjects[0] === "영어").description, /현재 수업 대기/);
  assert.match(events.find((item) => item.subjects[0] === "수학").description, /미등록 종료/);
});

test("canonical result events retain immutable attempt and consultation facts while batch internals stay hidden", () => {
  const detail = detailFixture();
  detail.appointments = [];
  detail.levelTests = [{
    ...detail.levelTests[1],
    appointmentId: null,
  }];
  detail.events = [
    {
      id: "result-math",
      trackId: "math",
      eventType: "level_test_completed",
      subject: "수학",
      source: "level_test_scheduled",
      destination: "consultation_waiting",
      reason: null,
      metadata: { attemptId: "test-math" },
      actorId: "actor",
      occurredAt: "2026-07-14T02:00:00Z",
      payloadVersion: 2,
      legacyText: null,
    },
    {
      id: "consult-eng",
      trackId: "eng",
      eventType: "consultation_completed",
      subject: "영어",
      source: "consultation_waiting",
      destination: "waiting",
      reason: null,
      metadata: { consultationId: "consult-eng" },
      actorId: "actor",
      occurredAt: "2026-07-15T03:00:00Z",
      payloadVersion: 2,
      legacyText: null,
    },
    {
      id: "invoice-eng",
      trackId: "eng",
      eventType: "admission_batch_advanced",
      subject: "영어",
      source: "draft",
      destination: "invoiced",
      reason: null,
      metadata: { batchId: "batch", revisionNumber: 1, action: "invoice_sent" },
      actorId: "actor",
      occurredAt: "2026-07-16T01:30:00Z",
      payloadVersion: 2,
      legacyText: null,
    },
  ];
  detail.admissionBatches[0].status = "invoiced";
  detail.admissionBatches[0].invoiceSentAt = "2026-07-16T01:30:00Z";

  const history = buildRegistrationSubjectHistory(detail);
  const result = history.find((item) => item.metadata.attemptId === "test-math");
  assert.equal(result.title, "레벨테스트 결과 저장");
  assert.match(result.description, /응시 회차: 1/);
  assert.match(result.description, /결과 상태: 완료/);
  assert.match(result.description, /https:\/\/drive\.test\/result/);

  const consultation = history.find((item) => item.metadata.consultationId === "consult-eng");
  assert.equal(consultation.title, "전화상담 결과 저장");
  assert.match(consultation.description, /상담 방식: 전화/);
  assert.match(consultation.description, /상담 결과: 대기/);
  assert.doesNotMatch(`${result.description} ${consultation.description}`, /completed|phone|waiting/);

  assert.equal(history.some((item) => item.id === "event:invoice-eng"), false);
  const batchFallback = history.find((item) => item.id === "batch:batch");
  assert.equal(batchFallback.title, "등록 처리 1차");
  assert.equal(batchFallback.origin, "migration");
  assert.equal(batchFallback.timeKind, "unavailable");
  assert.equal(batchFallback.occurredAt, null);
});

test("a started event never borrows a later terminal attempt result", () => {
  const detail = detailFixture();
  detail.appointments = [];
  detail.levelTests = [{
    ...detail.levelTests[1],
    appointmentId: null,
  }];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [];
  detail.events = [{
    id: "started-math",
    trackId: "math",
    eventType: "level_test_started",
    subject: "수학",
    source: "level_test_scheduled",
    destination: "level_test_scheduled",
    reason: null,
    metadata: { attemptId: "test-math" },
    actorId: "actor",
    occurredAt: "2026-07-14T01:00:00Z",
    payloadVersion: 2,
    legacyText: null,
  }];

  const started = buildRegistrationSubjectHistory(detail)[0];
  assert.equal(started.metadata.attemptNumber, 1);
  assert.equal(started.metadata.startedAt, "2026-07-14T01:00:00Z");
  assert.equal("resultStatus" in started.metadata, false);
  assert.equal("materialLink" in started.metadata, false);
  assert.equal("completedAt" in started.metadata, false);
  assert.doesNotMatch(started.description, /drive\.test/);
});

test("enrollment row events render their immutable saved-row snapshot instead of a later child state", () => {
  const detail = detailFixture();
  detail.appointments = [];
  detail.levelTests = [];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [{
    ...detail.enrollments[0],
    classId: "class-later",
    textbookId: "book-later",
    status: "enrolled",
  }];
  detail.events = [{
    id: "rows-eng",
    trackId: "eng",
    eventType: "enrollment_rows_saved",
    subject: "영어",
    source: "enrollment_decided",
    destination: "enrollment_decided",
    reason: null,
    metadata: {
      rowIds: ["enroll-eng"],
      rowCount: 1,
      rows: [{
        id: "enroll-eng",
        classId: "class-original",
        textbookId: null,
        classStartDate: "2026-07-20",
        classStartSessionKey: "2026-07-20:1",
        classStartSession: "1회차",
        status: "planned",
        sortOrder: 0,
      }],
    },
    actorId: "actor",
    occurredAt: "2026-07-16T00:00:00Z",
    payloadVersion: 2,
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.equal(history[0].metadata.rows[0].classId, "class-original");
  assert.match(history[0].description, /class-original/);
  assert.match(history[0].description, /교재 없음/);
  assert.match(history[0].description, /2026-07-20/);
  assert.doesNotMatch(history[0].description, /class-later|book-later|enrolled/);
});

test("appointment cancellation suppresses only the children canceled by that operation", () => {
  const detail = detailFixture();
  detail.appointments = [{ ...detail.appointments[0], status: "completed" }];
  detail.levelTests = [
    { ...detail.levelTests[0], status: "canceled", completedAt: "2026-07-12T02:00:00Z" },
    { ...detail.levelTests[1], status: "absent", materialLink: null },
  ];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [];
  detail.events = [{
    id: "cancel-eng",
    trackId: "eng",
    eventType: "appointment_subject_deselected",
    subject: "영어",
    source: "level_test_scheduled",
    destination: "inquiry",
    reason: "과목 제외",
    metadata: {
      appointmentId: "shared",
      notificationRevision: 2,
      changeKind: "appointment_subject_deselected",
      canceledTrackIds: ["eng"],
      activeTrackIds: ["math"],
    },
    actorId: "actor",
    occurredAt: "2026-07-12T02:00:00Z",
    payloadVersion: 2,
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.some((item) => item.id === "level-test:test-eng"), false);
  assert.equal(history.some((item) => item.id === "level-test:test-math"), true);
  assert.equal(history.find((item) => item.id === "level-test:test-math").description, "미응시");
});

test("enrollment cancellation renders the immutable original class and textbook snapshot", () => {
  const detail = detailFixture();
  detail.appointments = [];
  detail.levelTests = [];
  detail.consultations = [];
  detail.admissionBatches = [];
  detail.enrollments = [{
    ...detail.enrollments[0],
    classId: "class-current",
    textbookId: "book-current",
    status: "canceled",
  }];
  detail.events = [{
    id: "cancel-enrollment-eng",
    trackId: "eng",
    eventType: "registration_enrollment_canceled",
    subject: "영어",
    source: "registered",
    destination: "waiting",
    reason: "수강 취소",
    metadata: {
      enrollmentId: "enroll-eng",
      waitingKind: "current_term_opening",
      enrollmentSnapshot: {
        id: "enroll-eng",
        classId: "class-original",
        textbookId: "book-original",
        admissionBatchId: "batch-original",
        classStartDate: "2026-07-20",
        classStartSession: "1회차",
        status: "enrolled",
        sortOrder: 0,
      },
    },
    actorId: "actor",
    occurredAt: "2026-07-20T02:00:00Z",
    payloadVersion: 2,
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, "수강 등록 취소");
  assert.match(history[0].description, /기존 수업: class-original/);
  assert.match(history[0].description, /기존 교재: book-original/);
  assert.match(history[0].description, /등록 묶음: batch-original/);
  assert.doesNotMatch(history[0].description, /class-current|book-current/);
});

function historyTruthDetail({
  tracks = [],
  appointments = [],
  levelTests = [],
  consultations = [],
  admissionBatches = [],
  enrollments = [],
  events = [],
} = {}) {
  return {
    tracks,
    appointments,
    levelTests,
    consultations,
    admissionBatches,
    enrollments,
    events,
  };
}

function milestoneEvent({
  id,
  eventType,
  occurredAt,
  trackId = null,
  subject = null,
  source = null,
  destination = null,
  metadata = {},
  actorId = "actor-user",
  actorKind = "user",
  systemSource = null,
  payloadVersion = 2,
}) {
  return {
    id,
    trackId,
    eventType,
    subject,
    source,
    destination,
    reason: null,
    metadata,
    actorId,
    actorKind,
    systemSource,
    reasonCode: null,
    payloadVersion,
    occurredAt,
    legacyText: null,
  };
}

test("honest history keeps only closed milestones and orders exact events newest first", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    events: [
      milestoneEvent({ id: "created", eventType: "case_created", occurredAt: "2026-07-17T01:00:00Z" }),
      milestoneEvent({ id: "completed", eventType: "level_test_completed", occurredAt: "2026-07-17T03:00:00Z", subject: "영어" }),
      milestoneEvent({ id: "notification", eventType: "notification_event_recorded", occurredAt: "2026-07-17T04:00:00Z" }),
      milestoneEvent({ id: "fanout", eventType: "notification_fanout_queued", occurredAt: "2026-07-17T05:00:00Z" }),
      milestoneEvent({ id: "delivery", eventType: "notification_delivery_materialized", occurredAt: "2026-07-17T06:00:00Z" }),
      milestoneEvent({ id: "retry", eventType: "notification_retry_scheduled", occurredAt: "2026-07-17T07:00:00Z" }),
      milestoneEvent({ id: "provider", eventType: "notification_provider_failed", occurredAt: "2026-07-17T08:00:00Z" }),
      { ...milestoneEvent({ id: "generic-legacy", eventType: "generic_task_updated", occurredAt: "2026-07-17T09:00:00Z" }), legacyText: "일반 업무 변경" },
      { ...milestoneEvent({ id: "dotted-internal", eventType: "notification.delivery-recorded", occurredAt: "2026-07-17T10:00:00Z" }), legacyText: "알림 전달 내부 기록" },
      { ...milestoneEvent({ id: "hyphenated-internal", eventType: "provider-retry.failed", occurredAt: "2026-07-17T11:00:00Z" }), legacyText: "공급자 재시도 내부 기록" },
    ],
  }));

  assert.deepEqual(history.map((item) => item.id), ["event:completed", "event:created"]);
  assert.deepEqual(history.map((item) => item.stage), ["level_test", "inquiry"]);
  assert.ok(history.every((item) => item.origin === "canonical"));
  assert.ok(history.every((item) => item.timeKind === "exact"));
});

test("one shared appointment renders one milestone and absorbs fine appointment edits as detail", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [
      { id: "eng", subject: "영어", directorProfileId: "current-owner" },
      { id: "math", subject: "수학", directorProfileId: "current-owner" },
    ],
    events: [
      milestoneEvent({
        id: "scheduled-eng",
        eventType: "level_test_scheduled",
        occurredAt: "2026-07-17T01:00:00Z",
        trackId: "eng",
        subject: "영어",
        source: "inquiry",
        destination: "level_test_scheduled",
        metadata: {
          appointmentId: "shared-appointment",
          notificationRevision: 1,
          scheduledAt: "2026-07-18T01:00:00Z",
          place: "본관",
        },
      }),
      milestoneEvent({
        id: "scheduled-math",
        eventType: "level_test_scheduled",
        occurredAt: "2026-07-17T01:00:00Z",
        trackId: "math",
        subject: "수학",
        source: "inquiry",
        destination: "level_test_scheduled",
        metadata: {
          appointmentId: "shared-appointment",
          notificationRevision: 1,
          scheduledAt: "2026-07-18T01:00:00Z",
          place: "본관",
        },
      }),
      milestoneEvent({
        id: "updated",
        eventType: "appointment_updated",
        occurredAt: "2026-07-17T02:00:00Z",
        trackId: "eng",
        subject: "영어",
        source: "level_test_scheduled",
        destination: "level_test_scheduled",
        metadata: {
          appointmentId: "shared-appointment",
          notificationRevision: 2,
          changeKind: "appointment_updated",
          scheduledAt: "2026-07-18T02:00:00Z",
          place: "별관",
        },
      }),
      milestoneEvent({
        id: "updated-math",
        eventType: "appointment_updated",
        occurredAt: "2026-07-17T02:00:00.001Z",
        trackId: "math",
        subject: "수학",
        source: "level_test_scheduled",
        destination: "level_test_scheduled",
        metadata: {
          appointmentId: "shared-appointment",
          notificationRevision: 2,
          changeKind: "appointment_updated",
          scheduledAt: "2026-07-18T02:00:00Z",
          place: "별관",
        },
      }),
    ],
  }));

  assert.equal(history.length, 1);
  assert.deepEqual(history[0].subjects, ["영어", "수학"]);
  assert.equal(history[0].stage, "level_test");
  assert.equal(history.some((item) => item.title === "예약 변경"), false);
  assert.equal(history[0].metadata.appointmentChanges.length, 1, "shared per-subject writes collapse to one operation");
  assert.equal(history[0].metadata.appointmentChanges[0].eventType, "appointment_updated");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.oldScheduledAt, "2026-07-18T01:00:00Z");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.scheduledAt, "2026-07-18T02:00:00Z");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.oldPlace, "본관");
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.place, "별관");
});

test("payload 없는 구형 주요 이벤트는 정식 이력으로 가장하지 않고 시간 미확인 이전 자료로만 보인다", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    events: [{
      id: "legacy-case-created",
      eventType: "case_created",
      occurredAt: "2026-07-17T01:00:00Z",
      payloadVersion: null,
      legacyText: "이전 등록 문의 기록",
      metadata: { waitingKind: "legacy" },
      actorId: "legacy-actor",
      actorKind: null,
    }],
  }));

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "event:legacy-case-created");
  assert.equal(history[0].origin, "migration");
  assert.equal(history[0].timeKind, "unavailable");
  assert.equal(history[0].occurredAt, null);
  assert.equal(history[0].actorKind, "migration");
  assert.equal(history[0].title, "이전 등록 문의 기록");

  const payloadless = buildRegistrationSubjectHistory(historyTruthDetail({
    events: [{
      id: "payloadless-case-created",
      eventType: "case_created",
      occurredAt: "2026-07-17T01:00:00Z",
      payloadVersion: null,
      legacyText: null,
      metadata: {},
    }],
  }));
  assert.deepEqual(payloadless, []);
});

test("앵커 없는 예약 변경은 독립 정식 행을 만들지 않고 기존 예약 이전 자료에만 붙는다", () => {
  const change = milestoneEvent({
    id: "orphan-change",
    eventType: "appointment_updated",
    occurredAt: "2026-07-17T02:00:00Z",
    subject: "영어",
    metadata: {
      appointmentId: "legacy-appointment",
      notificationRevision: 2,
      oldScheduledAt: "2026-07-18T01:00:00Z",
      scheduledAt: "2026-07-18T02:00:00Z",
      oldPlace: "본관",
      place: "별관",
    },
  });
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [{ id: "eng", subject: "영어" }],
    appointments: [{
      id: "legacy-appointment",
      kind: "level_test",
      scheduledAt: "2026-07-18T02:00:00Z",
      place: "별관",
      status: "scheduled",
    }],
    events: [change],
  }));

  assert.equal(history.length, 1);
  assert.equal(history[0].id, "appointment:legacy-appointment");
  assert.equal(history[0].origin, "migration");
  assert.equal(history[0].timeKind, "unavailable");
  assert.equal(history[0].metadata.appointmentChanges.length, 1);
  assert.equal(history[0].metadata.appointmentChanges[0].metadata.oldPlace, "본관");
  assert.equal(history.some((item) => item.origin === "canonical"), false);

  const withoutSnapshot = buildRegistrationSubjectHistory(historyTruthDetail({ events: [change] }));
  assert.deepEqual(withoutSnapshot, []);
});

test("여러 예약 변경은 각 변경 차수와 맞는 마일스톤에 따로 흡수된다", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [{ id: "eng", subject: "영어" }],
    events: [
      milestoneEvent({
        id: "scheduled-revision-1",
        eventType: "level_test_scheduled",
        occurredAt: "2026-07-17T01:00:00Z",
        trackId: "eng",
        subject: "영어",
        metadata: { appointmentId: "shared", notificationRevision: 1 },
      }),
      milestoneEvent({
        id: "updated-revision-1",
        eventType: "appointment_updated",
        occurredAt: "2026-07-17T02:00:00Z",
        trackId: "eng",
        subject: "영어",
        metadata: { appointmentId: "shared", notificationRevision: 1, scheduledAt: "2026-07-20T01:00:00Z" },
      }),
      milestoneEvent({
        id: "scheduled-revision-2",
        eventType: "level_test_scheduled",
        occurredAt: "2026-07-17T03:00:00Z",
        trackId: "eng",
        subject: "영어",
        metadata: { appointmentId: "shared", notificationRevision: 2 },
      }),
      milestoneEvent({
        id: "updated-revision-2",
        eventType: "appointment_updated",
        occurredAt: "2026-07-17T04:00:00Z",
        trackId: "eng",
        subject: "영어",
        metadata: { appointmentId: "shared", notificationRevision: 2, scheduledAt: "2026-07-21T01:00:00Z" },
      }),
    ],
  }));

  assert.equal(history.length, 2);
  const revision1 = history.find((item) => item.metadata.notificationRevision === 1);
  const revision2 = history.find((item) => item.metadata.notificationRevision === 2);
  assert.equal(revision1.metadata.appointmentChanges.length, 1);
  assert.equal(revision1.metadata.appointmentChanges[0].metadata.scheduledAt, "2026-07-20T01:00:00Z");
  assert.equal(revision2.metadata.appointmentChanges.length, 1);
  assert.equal(revision2.metadata.appointmentChanges[0].metadata.scheduledAt, "2026-07-21T01:00:00Z");
});

test("event actor truth stays separate from current ownership for user system migration and v1 rows", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [{ id: "eng", subject: "영어", directorProfileId: "current-owner" }],
    events: [
      milestoneEvent({
        id: "legacy-user",
        eventType: "inquiry_routed",
        occurredAt: "2026-07-17T01:00:00Z",
        trackId: "eng",
        subject: "영어",
        actorId: "legacy-actor-id",
        actorKind: null,
        payloadVersion: 1,
      }),
      milestoneEvent({
        id: "system",
        eventType: "director_default_resolved",
        occurredAt: "2026-07-17T02:00:00Z",
        trackId: "eng",
        subject: "영어",
        actorId: null,
        actorKind: "system",
        systemSource: "registration_director_defaults",
      }),
      milestoneEvent({
        id: "migration",
        eventType: "track_reopened",
        occurredAt: "2026-07-17T03:00:00Z",
        trackId: "eng",
        subject: "영어",
        actorId: null,
        actorKind: "migration",
      }),
    ],
  }));

  const legacyUser = history.find((item) => item.id === "event:legacy-user");
  const system = history.find((item) => item.id === "event:system");
  const migration = history.find((item) => item.id === "event:migration");
  assert.equal(legacyUser.actorKind, null, "v1 rows must not infer a user actor kind from actor id or current owner");
  assert.equal(legacyUser.actorId, "legacy-actor-id");
  assert.notEqual(legacyUser.actorId, "current-owner");
  assert.equal(system.actorKind, "system");
  assert.equal(system.actorId, null);
  assert.equal(system.systemSource, "registration_director_defaults");
  assert.equal(migration.actorKind, "migration");
  assert.equal(migration.actorId, null);
});

test("운영 이력의 이전 자료 확인, 등록 진행, 대기 등록 상태를 한글로 표시한다", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    events: [
      milestoneEvent({
        id: "migration-review",
        eventType: "inquiry_routed",
        occurredAt: "2026-07-17T01:00:00Z",
        source: "inquiry",
        destination: "migration_review",
      }),
      milestoneEvent({
        id: "consultation-enrollment",
        eventType: "consultation_completed",
        occurredAt: "2026-07-17T02:00:00Z",
        source: "visit_consultation_scheduled",
        destination: "enrollment_decided",
        metadata: { outcome: "enrollment" },
      }),
      milestoneEvent({
        id: "waitlisted-enrollment",
        eventType: "enrollment_rows_saved",
        occurredAt: "2026-07-17T03:00:00Z",
        source: "enrollment_decided",
        destination: "enrollment_decided",
        metadata: {
          rows: [{ classId: "class-waiting", status: "waitlisted" }],
        },
      }),
    ],
  }));

  const descriptions = history.map((item) => item.description).join("\n");
  assert.match(descriptions, /이전 자료 확인/);
  assert.match(descriptions, /상담 결과: 등록 진행/);
  assert.match(descriptions, /상태: 대기 등록/);
  assert.doesNotMatch(descriptions, /migration_review|waitlisted|\benrollment\b/);
});

test("상담 책임자 배정 경로와 예약 과목 제외 사유를 실제 SQL 값 대신 한글로 표시한다", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [{ id: "eng", subject: "영어" }],
    events: [
      milestoneEvent({
        id: "director-default",
        eventType: "director_default_resolved",
        occurredAt: "2026-07-17T01:00:00Z",
        trackId: "eng",
        subject: "영어",
        source: "unassigned",
        destination: "default",
      }),
      milestoneEvent({
        id: "scheduled",
        eventType: "level_test_scheduled",
        occurredAt: "2026-07-17T02:00:00Z",
        trackId: "eng",
        subject: "영어",
        source: "inquiry",
        destination: "level_test_scheduled",
        metadata: {
          appointmentId: "appointment-one",
          scheduledAt: "2026-07-18T01:00:00Z",
          place: "본관",
          notificationRevision: 1,
        },
      }),
      milestoneEvent({
        id: "deselected",
        eventType: "appointment_subject_deselected",
        occurredAt: "2026-07-17T03:00:00Z",
        trackId: "eng",
        subject: "영어",
        source: "level_test_scheduled",
        destination: "inquiry",
        metadata: {
          appointmentId: "appointment-one",
          scheduledAt: "2026-07-18T01:00:00Z",
          place: "본관",
          notificationRevision: 1,
          changeKind: "appointment_subject_deselected",
        },
      }),
    ].map((event) => event.id === "deselected"
      ? { ...event, reason: "appointment_subject_deselected" }
      : event),
  }));

  const director = history.find((item) => item.id === "event:director-default");
  const appointment = history.find((item) => Array.isArray(item.metadata.appointmentChanges));
  assert.match(director.description, /미지정 → 자동 배정/);
  assert.doesNotMatch(director.description, /unassigned|default/);
  assert.equal(appointment.metadata.appointmentChanges[0].reasonLabel, "예약 과목 제외");
  assert.doesNotMatch(JSON.stringify(appointment.metadata.appointmentChanges[0].reasonLabel), /appointment_subject_deselected/);
});

test("migration fallback is explicitly unavailable and never borrows mutable snapshot timestamps or owner", () => {
  const history = buildRegistrationSubjectHistory(historyTruthDetail({
    tracks: [{ id: "eng", subject: "영어", directorProfileId: "current-owner" }],
    appointments: [{
      id: "legacy-appointment",
      kind: "level_test",
      scheduledAt: "2026-08-01T01:00:00Z",
      place: "본관",
      status: "scheduled",
      createdAt: "2026-07-01T01:00:00Z",
      updatedAt: "2026-07-31T23:59:59Z",
    }],
    events: [milestoneEvent({
      id: "created",
      eventType: "case_created",
      occurredAt: "2026-07-17T01:00:00Z",
    })],
  }));

  const fallback = history.find((item) => item.id === "appointment:legacy-appointment");
  assert.equal(history[0].id, "event:created", "unknown-time migration rows sort after exact events");
  assert.equal(fallback.origin, "migration");
  assert.equal(fallback.timeKind, "unavailable");
  assert.equal(fallback.occurredAt, null);
  assert.equal(fallback.actorKind, "migration");
  assert.equal(fallback.actorId, null);
  assert.doesNotMatch(JSON.stringify(fallback), /current-owner|2026-07-31T23:59:59Z/);
});
