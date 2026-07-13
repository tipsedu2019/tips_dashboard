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
      { id: "event-v1", trackId: "eng", eventType: "waiting_transitioned", subject: "영어", source: "waiting", destination: "level_test_scheduled", reason: "재응시", metadata: { waitingKind: "current_class", retakeDecision: "required", classId: "class-old" }, actorId: "actor", occurredAt: "2026-07-13T01:00:00Z", legacyText: null },
      { id: "event-legacy", trackId: null, eventType: "future_event", subject: null, source: null, destination: null, reason: null, metadata: {}, actorId: null, occurredAt: "2026-07-12T00:00:00Z", legacyText: "plain future history" },
    ],
  };
}

test("history keeps canonical snapshots and unknown legacy rows safe in one stable chronology", () => {
  const history = buildRegistrationSubjectHistory(detailFixture());
  assert.equal(history.at(-1).title, "plain future history");
  const canonical = history.find((item) => item.id === "event:event-v1");
  assert.deepEqual(canonical.subjects, ["영어"]);
  assert.equal(canonical.metadata.waitingKind, "current_class");
  assert.equal(canonical.actorId, "actor");
  assert.match(canonical.description, /current_class/);
  assert.match(canonical.description, /required/);
  assert.deepEqual([...history].map((item) => item.occurredAt), [...history].map((item) => item.occurredAt).sort().reverse());
});

test("shared appointments and batches list each participating subject once", () => {
  const history = buildRegistrationSubjectHistory(detailFixture());
  const appointment = history.find((item) => item.id === "appointment:shared");
  assert.deepEqual(appointment.subjects, ["영어", "수학"]);
  assert.equal(appointment.occurredAt, "2026-07-12T01:00:00Z", "appointment audit order follows the update time, not the future reservation");
  assert.equal(appointment.metadata.scheduledAt, "2026-07-14T01:00:00Z");
  assert.deepEqual(history.find((item) => item.id === "batch:batch").subjects, ["영어", "수학"]);
  assert.deepEqual(history.find((item) => item.id === "level-test:test-math").subjects, ["수학"]);
  assert.deepEqual(history.find((item) => item.id === "enrollment:enroll-eng").subjects, ["영어"]);
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
    { id: "schedule-eng", trackId: "eng", eventType: "level_test_scheduled", subject: "영어", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "shared", activityId: "test-eng" }, actorId: "actor", occurredAt: "2026-07-12T01:00:00Z", legacyText: null },
    { id: "schedule-math", trackId: "math", eventType: "level_test_scheduled", subject: "수학", source: "inquiry", destination: "level_test_scheduled", reason: null, metadata: { appointmentId: "shared", activityId: "test-math" }, actorId: "actor", occurredAt: "2026-07-12T01:00:00.001Z", legacyText: null },
    { id: "consult", trackId: "eng", eventType: "consultation_completed", subject: "영어", source: "consultation_waiting", destination: "waiting", reason: null, metadata: { consultationId: "consult-eng", outcome: "waiting" }, actorId: "actor", occurredAt: "2026-07-15T03:00:00Z", legacyText: null },
    { id: "batch-eng", trackId: "eng", eventType: "admission_batch_started", subject: "영어", source: "enrollment_decided", destination: "enrollment_processing", reason: null, metadata: { batchId: "batch" }, actorId: "actor", occurredAt: "2026-07-16T01:00:00Z", legacyText: null },
    { id: "batch-math", trackId: "math", eventType: "admission_batch_started", subject: "수학", source: "enrollment_decided", destination: "enrollment_processing", reason: null, metadata: { batchId: "batch" }, actorId: "actor", occurredAt: "2026-07-16T01:00:00.001Z", legacyText: null },
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

test("replacement events use old and new appointment ids as one operation despite microsecond track writes", () => {
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
    { id: "replace-eng", trackId: "eng", eventType: "appointment_replaced", subject: "영어", source: "level_test_scheduled", destination: "level_test_scheduled", reason: null, metadata: { oldAppointmentId: "old", newAppointmentId: "new", oldNotificationRevision: 1, notificationRevision: 2, activityId: "new-eng", changeKind: "appointment_replaced" }, actorId: "actor", occurredAt: "2026-07-12T01:00:00Z", legacyText: null },
    { id: "replace-math", trackId: "math", eventType: "appointment_replaced", subject: "수학", source: "level_test_scheduled", destination: "level_test_scheduled", reason: null, metadata: { oldAppointmentId: "old", newAppointmentId: "new", oldNotificationRevision: 1, notificationRevision: 2, activityId: "new-math", changeKind: "appointment_replaced" }, actorId: "actor", occurredAt: "2026-07-12T01:00:00.001Z", legacyText: null },
  ];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].subjects, ["영어", "수학"]);
  assert.equal(history[0].metadata.newAppointmentId, "new");
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
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, "레벨테스트 재응시 예약");
  assert.match(history[0].description, /scheduledAt: 2026-07-14T01:00:00Z/);
  assert.match(history[0].description, /place: 본관/);
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
  assert.match(history[0].description, /영어: waiting → level_test_scheduled/);
  assert.match(history[0].description, /수학: level_test_scheduled → level_test_scheduled/);
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
      legacyText: null,
    },
  ];

  const events = buildRegistrationSubjectHistory(detail).filter((item) => item.kind === "event");
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((item) => item.subjects), [["영어"], ["수학"]]);
  assert.match(events.find((item) => item.subjects[0] === "영어").description, /current_class/);
  assert.match(events.find((item) => item.subjects[0] === "수학").description, /not_registered/);
});

test("canonical result events retain immutable attempt consultation and batch facts", () => {
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
      legacyText: null,
    },
  ];
  detail.admissionBatches[0].status = "invoiced";
  detail.admissionBatches[0].invoiceSentAt = "2026-07-16T01:30:00Z";

  const history = buildRegistrationSubjectHistory(detail);
  const result = history.find((item) => item.metadata.attemptId === "test-math");
  assert.equal(result.title, "레벨테스트 결과 저장");
  assert.match(result.description, /attemptNumber: 1/);
  assert.match(result.description, /resultStatus: completed/);
  assert.match(result.description, /https:\/\/drive\.test\/result/);

  const consultation = history.find((item) => item.metadata.consultationId === "consult-eng");
  assert.equal(consultation.title, "전화상담 결과 저장");
  assert.match(consultation.description, /mode: phone/);
  assert.match(consultation.description, /outcome: waiting/);

  const invoice = history.find((item) => item.metadata.batchId === "batch");
  assert.equal(invoice.title, "청구서 발송");
  assert.match(invoice.description, /revisionNumber: 1/);
  assert.match(invoice.description, /action: invoice_sent/);
  assert.match(invoice.description, /invoiceSentAt: 2026-07-16T01:30:00Z/);
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
    legacyText: null,
  }];

  const history = buildRegistrationSubjectHistory(detail);
  assert.equal(history.some((item) => item.id === "level-test:test-eng"), false);
  assert.equal(history.some((item) => item.id === "level-test:test-math"), true);
  assert.equal(history.find((item) => item.id === "level-test:test-math").description, "absent");
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
