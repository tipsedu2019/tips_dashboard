function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueSubjects(values) {
  const selected = new Set(values.filter((value) => value === "영어" || value === "수학"));
  return ["영어", "수학"].filter((subject) => selected.has(subject));
}

const DEFAULT_STAGE_BY_EVENT = {
  case_created: "inquiry",
  inquiry_routed: "inquiry",
  director_default_resolved: "responsibility",
  director_manual_override: "responsibility",
  level_test_scheduled: "level_test",
  level_test_started: "level_test",
  level_test_completed: "level_test",
  consultation_waiting: "consultation",
  visit_consultation_scheduled: "consultation",
  consultation_completed: "consultation",
  waiting_started: "waiting",
  enrollment_decided: "admission",
  admission_completed: "admission",
  registration_completed: "registration",
  track_closed: "closure",
  track_reopened: "reopening",
};

const AUTHORITATIVE_EVENT_ALIASES = {
  registration_case_created: "case_created",
  initial_inquiry_selected: "case_created",
  director_default_cleared: "director_default_resolved",
  director_assignment_required: "director_manual_override",
  director_phone_queue_repaired: "director_default_resolved",
  level_test_retake_scheduled: "level_test_scheduled",
  level_test_absent: "level_test_completed",
  level_test_canceled: "level_test_completed",
  level_test_track_closed: "track_closed",
  visit_scheduled: "visit_consultation_scheduled",
  waiting_transitioned: "waiting_started",
  enrollment_decision_routed: "enrollment_decided",
  admission_batch_started: "enrollment_decided",
  admission_batch_completed: "admission_completed",
  enrollment_rows_saved: "enrollment_decided",
  registration_enrollment_makeedu_updated: "registration_completed",
  registration_enrollment_canceled: "track_reopened",
  registration_enrollment_roster_released: "track_reopened",
  admission_batch_canceled: "track_reopened",
  migration_review_resolved: "track_reopened",
};

const FINE_APPOINTMENT_EVENT_TYPES = new Set([
  "appointment_updated",
  "appointment_replaced",
  "appointment_subject_deselected",
  "appointment_canceled",
]);

const ACTOR_KINDS = new Set(["user", "system", "migration"]);

const SNAPSHOT_LABELS = {
  waitingKind: "대기 유형",
  retakeDecision: "재응시 결정",
  classId: "수업",
  appointmentId: "예약",
  consultationId: "상담",
  enrollmentId: "수강 등록",
  batchId: "등록 처리",
  directorProfileId: "상담 책임자",
  kind: "예약 종류",
  scheduledAt: "예약 시각",
  place: "장소",
  oldScheduledAt: "이전 예약 시각",
  oldPlace: "이전 장소",
  attemptNumber: "응시 회차",
  resultStatus: "결과 상태",
  materialLink: "결과 자료",
  startedAt: "시작 시각",
  completedAt: "완료 시각",
  mode: "상담 방식",
  consultationStatus: "상담 상태",
  outcome: "상담 결과",
  revisionNumber: "변경 차수",
  action: "처리 내용",
  invoiceSentAt: "청구서 발송 시각",
  paymentConfirmedAt: "수납 확인 시각",
  rowIds: "등록 행",
  enrollmentIds: "수강 등록 행",
};

const PROCESS_VALUE_LABELS = {
  inquiry: "문의",
  migration_review: "이전 자료 확인",
  unassigned: "미지정",
  default: "자동 배정",
  manual: "직접 지정",
  migration: "이전 자료",
  level_test_scheduled: "레벨테스트 예약",
  level_test_in_progress: "레벨테스트 진행",
  consultation_waiting: "전화상담 대기",
  visit_consultation_scheduled: "방문상담 예약",
  waiting: "대기",
  enrollment_decided: "등록 결정",
  enrollment_processing: "입학 처리",
  registered: "등록 완료",
  not_registered: "미등록 종료",
  inquiry_closed: "문의 종료",
  current_class: "현재 수업 대기",
  current_term_opening: "현재 학기 개강 대기",
  next_term_opening: "다음 학기 개강 대기",
  required: "필요",
  not_required: "불필요",
  level_test: "레벨테스트",
  visit_consultation: "방문상담",
  phone: "전화",
  visit: "방문",
  scheduled: "예약",
  in_progress: "진행 중",
  completed: "완료",
  absent: "미응시",
  canceled: "취소",
  draft: "작성 중",
  invoiced: "청구서 발송",
  paid: "수납 완료",
  planned: "등록 예정",
  waitlisted: "대기 등록",
  enrolled: "수강 중",
  enrollment: "등록 진행",
  invoice_sent: "청구서 발송",
  payment_confirmed: "수납 확인",
  started: "시작",
  appointment_subject_deselected: "예약 과목 제외",
};

function displayValue(value) {
  const normalized = text(value);
  return PROCESS_VALUE_LABELS[normalized] || normalized;
}

function canonicalMilestoneEventType(event) {
  const eventType = text(event.eventType);
  if (DEFAULT_STAGE_BY_EVENT[eventType]) return eventType;
  return AUTHORITATIVE_EVENT_ALIASES[eventType] || null;
}

function eventStage(event) {
  const canonicalEventType = canonicalMilestoneEventType(event);
  return canonicalEventType ? DEFAULT_STAGE_BY_EVENT[canonicalEventType] : null;
}

function isNotificationInternal(event) {
  return /(^|[._-])(notification|fanout|delivery|retry|provider)(?=$|[._-])/.test(text(event.eventType).toLowerCase());
}

function isCanonicalProcessEvent(event) {
  const payloadVersion = Number(event.payloadVersion);
  return !text(event.legacyText) && (payloadVersion === 1 || payloadVersion === 2);
}

function isFineAppointmentEvent(event) {
  return FINE_APPOINTMENT_EVENT_TYPES.has(text(event.eventType));
}

function fineAppointmentId(event) {
  const metadata = record(event.metadata);
  return text(metadata.appointmentId)
    || text(metadata.newAppointmentId)
    || text(metadata.oldAppointmentId);
}

function fineAppointmentIds(event) {
  const metadata = record(event.metadata);
  return [...new Set([
    text(metadata.appointmentId),
    text(metadata.newAppointmentId),
    text(metadata.oldAppointmentId),
  ].filter(Boolean))];
}

function fineAppointmentOperationKey(event) {
  const metadata = record(event.metadata);
  return JSON.stringify([
    text(event.eventType),
    text(metadata.appointmentId),
    text(metadata.oldAppointmentId),
    text(metadata.newAppointmentId),
    text(metadata.oldNotificationRevision),
    text(metadata.notificationRevision),
    text(metadata.kind),
    text(metadata.changeKind),
    text(metadata.oldScheduledAt),
    text(metadata.scheduledAt),
    text(metadata.oldPlace),
    text(metadata.place),
    [...list(metadata.activeTrackIds).map(text).filter(Boolean)].sort(),
    [...list(metadata.canceledTrackIds).map(text).filter(Boolean)].sort(),
    text(event.reason),
  ]);
}

function normalizedActorKind(value) {
  const kind = text(value);
  return ACTOR_KINDS.has(kind) ? kind : null;
}

function eventTitle(event, metadata = record(event.metadata), eventTypes = [text(event.eventType)]) {
  if (text(event.legacyText)) return text(event.legacyText);
  const types = new Set(eventTypes.map(text));
  const changeKind = text(metadata.changeKind);
  if (changeKind === "appointment_updated" && types.size > 1) return "예약 변경";
  if (text(event.eventType) === "consultation_completed" && text(metadata.mode) === "phone") return "전화상담 결과 저장";
  if (text(event.eventType) === "consultation_completed" && text(metadata.mode) === "visit") return "방문상담 결과 저장";
  if (text(event.eventType) === "admission_batch_advanced") {
    if (text(metadata.action) === "invoice_sent") return "청구서 발송";
    if (text(metadata.action) === "payment_confirmed") return "수납 완료 확인";
  }
  const labels = {
    case_created: "등록 문의 생성",
    inquiry_routed: "문의 다음 단계 결정",
    director_default_resolved: "상담 책임자 자동 배정",
    director_manual_override: "상담 책임자 변경",
    level_test_scheduled: "레벨테스트 예약",
    level_test_started: "레벨테스트 시작",
    level_test_completed: "레벨테스트 결과 저장",
    consultation_waiting: "전화상담 대기 시작",
    visit_consultation_scheduled: "방문상담 예약",
    consultation_completed: "상담 결과 저장",
    director_default_cleared: "상담 책임자 자동 배정 해제",
    director_assignment_required: "상담 책임자 지정 필요",
    director_phone_queue_repaired: "전화상담 대기 복구",
    registration_common_info_updated: "공통 정보 변경",
    registration_subjects_synced: "문의 과목 변경",
    registration_subject_removed: "문의 과목 삭제",
    level_test_retake_scheduled: "레벨테스트 재응시 예약",
    visit_scheduled: "방문상담 예약",
    appointment_updated: "예약 변경",
    appointment_replaced: "예약 교체",
    appointment_subject_deselected: "예약 과목 제외",
    appointment_canceled: "예약 취소",
    level_test_absent: "레벨테스트 결시",
    level_test_canceled: "레벨테스트 취소",
    level_test_track_closed: "레벨테스트 종료",
    waiting_started: "대기 시작",
    waiting_transitioned: "대기 상태 변경",
    enrollment_decided: "등록 결정",
    enrollment_decision_routed: "등록 진행 방향 결정",
    enrollment_rows_saved: "수업 등록 정보 저장",
    registration_enrollment_makeedu_updated: "메이크에듀 등록 확인",
    registration_enrollment_canceled: "수강 등록 취소",
    registration_enrollment_roster_released: "수강 명단 연결 해제",
    admission_batch_started: "등록 처리 시작",
    admission_batch_advanced: "등록 처리 진행",
    admission_completed: "입학 처리 완료",
    admission_batch_completed: "등록 처리 완료",
    admission_batch_canceled: "등록 처리 취소",
    registration_completed: "등록 완료",
    track_closed: "등록 흐름 종료",
    track_reopened: "등록 흐름 다시 열기",
  };
  const eventType = text(event.eventType);
  const canonicalEventType = canonicalMilestoneEventType(event);
  return labels[eventType] || labels[canonicalEventType] || "기존 이력";
}

function snapshotDescription(event) {
  const metadata = record(event.metadata);
  const subjectTransitions = list(metadata.subjectTransitions).map(record);
  const snapshotKeys = [
    "waitingKind",
    "retakeDecision",
    "classId",
    "appointmentId",
    "consultationId",
    "enrollmentId",
    "batchId",
    "directorProfileId",
    "kind",
    "scheduledAt",
    "place",
    "oldScheduledAt",
    "oldPlace",
    "attemptNumber",
    "resultStatus",
    "materialLink",
    "startedAt",
    "completedAt",
    "mode",
    "consultationStatus",
    "outcome",
    "revisionNumber",
    "action",
    "invoiceSentAt",
    "paymentConfirmedAt",
    "rowIds",
    "enrollmentIds",
  ];
  const parts = [];
  if (subjectTransitions.length <= 1 && (text(event.source) || text(event.destination))) {
    parts.push([displayValue(event.source), displayValue(event.destination)].filter(Boolean).join(" → "));
  }
  if (text(event.reason)) parts.push(displayValue(event.reason));
  if (subjectTransitions.length > 1) {
    for (const transition of subjectTransitions) {
      const route = [displayValue(transition.source), displayValue(transition.destination)].filter(Boolean).join(" → ");
      const transitionReason = displayValue(transition.reason);
      parts.push(`${text(transition.subject) || "과목"}: ${[route, transitionReason].filter(Boolean).join(" · ")}`);
    }
  }
  for (const key of snapshotKeys) {
    const value = displayValue(metadata[key]);
    if (value) parts.push(`${SNAPSHOT_LABELS[key]}: ${value}`);
  }
  for (const row of list(metadata.rows).map(record)) {
    const rowParts = [
      text(row.classId) ? `수업: ${text(row.classId)}` : "",
      text(row.textbookId) ? `교재: ${text(row.textbookId)}` : "교재 없음",
      text(row.classStartDate) ? `수업 시작일: ${text(row.classStartDate)}` : "",
      text(row.classStartSession) ? `회차: ${text(row.classStartSession)}` : "",
      text(row.status) ? `상태: ${displayValue(row.status)}` : "",
    ].filter(Boolean);
    if (rowParts.length > 0) parts.push(rowParts.join(" · "));
  }
  const enrollmentSnapshot = record(metadata.enrollmentSnapshot);
  if (Object.keys(enrollmentSnapshot).length > 0) {
    const enrollmentParts = [
      text(enrollmentSnapshot.classId) ? `기존 수업: ${text(enrollmentSnapshot.classId)}` : "",
      text(enrollmentSnapshot.textbookId) ? `기존 교재: ${text(enrollmentSnapshot.textbookId)}` : "기존 교재 없음",
      text(enrollmentSnapshot.admissionBatchId) ? `등록 묶음: ${text(enrollmentSnapshot.admissionBatchId)}` : "",
      text(enrollmentSnapshot.classStartDate) ? `수업 시작일: ${text(enrollmentSnapshot.classStartDate)}` : "",
      text(enrollmentSnapshot.classStartSession) ? `회차: ${text(enrollmentSnapshot.classStartSession)}` : "",
      text(enrollmentSnapshot.status) ? `기존 상태: ${displayValue(enrollmentSnapshot.status)}` : "",
    ].filter(Boolean);
    if (enrollmentParts.length > 0) parts.push(enrollmentParts.join(" · "));
  }
  return parts.join(" · ");
}

function historyItem({
  id,
  kind,
  stage,
  occurredAt,
  subjects,
  title,
  description = "",
  metadata = {},
  actorId = null,
  actorKind = null,
  systemSource = null,
  timeKind = "exact",
  origin = "canonical",
}) {
  const exactOccurredAt = text(occurredAt);
  const normalizedTimeKind = timeKind === "exact" && exactOccurredAt ? "exact" : "unavailable";
  return {
    id,
    kind,
    stage,
    occurredAt: normalizedTimeKind === "exact" ? exactOccurredAt : null,
    subjects: uniqueSubjects(subjects),
    title: text(title) || "진행 이력",
    description: text(description),
    metadata: record(metadata),
    actorId: text(actorId) || null,
    actorKind: normalizedActorKind(actorKind),
    systemSource: text(systemSource) || null,
    timeKind: normalizedTimeKind,
    origin: origin === "migration" ? "migration" : "canonical",
  };
}

function canonicalEventEntity(event) {
  if (text(event.legacyText)) return null;
  const metadata = record(event.metadata);
  const eventType = text(event.eventType);
  const appointmentId = text(metadata.appointmentId)
    || (eventType === "appointment_replaced" ? text(metadata.newAppointmentId) : "");
  const attemptId = text(metadata.attemptId);
  const consultationId = text(metadata.consultationId);
  const enrollmentId = text(metadata.enrollmentId);
  const batchId = text(metadata.batchId);
  if (attemptId && eventType.startsWith("level_test_")) return { kind: "attempt", id: attemptId };
  if (consultationId && eventType.startsWith("consultation_")) return { kind: "consultation", id: consultationId };
  if (enrollmentId && eventType.includes("enrollment")) return { kind: "enrollment", id: enrollmentId };
  if (batchId && (eventType.includes("batch") || eventType.includes("admission"))) return { kind: "batch", id: batchId };
  if (appointmentId && (
    eventType.includes("scheduled")
    || eventType.startsWith("appointment_")
    || eventType === "visit_scheduled"
  )) return { kind: "appointment", id: appointmentId };
  return null;
}

function canonicalOperationKey(event, entity) {
  const metadata = record(event.metadata);
  if (!entity) return "";
  if (entity.kind === "appointment") {
    return JSON.stringify([
      text(metadata.notificationRevision),
      text(metadata.oldNotificationRevision),
      text(metadata.oldAppointmentId),
      text(metadata.newAppointmentId),
      text(metadata.changeKind),
    ]);
  }
  if (entity.kind === "batch") {
    return JSON.stringify([
      text(metadata.revisionNumber),
      text(metadata.action),
      text(event.source),
      text(event.destination),
      text(event.reason),
      text(metadata.waitingKind),
      text(metadata.classId),
      String(metadata.restoredHistoricalEnrollment ?? ""),
    ]);
  }
  if (entity.kind === "enrollment") {
    return JSON.stringify([text(metadata.makeeduRegistered), text(metadata.status)]);
  }
  return "";
}

function eventTransition(event, subject) {
  const metadata = record(event.metadata);
  return {
    subject: text(subject),
    eventType: text(event.eventType),
    source: text(event.source) || null,
    destination: text(event.destination) || null,
    reason: text(event.reason) || null,
    activityId: text(metadata.activityId) || null,
    attemptNumber: Number(metadata.attemptNumber) || null,
  };
}

function appointmentChangeSnapshot(event) {
  return {
    eventType: text(event.eventType),
    occurredAt: text(event.occurredAt) || null,
    reason: text(event.reason) || null,
    reasonLabel: displayValue(event.reason) || null,
    actorKind: normalizedActorKind(event.actorKind),
    actorId: text(event.actorId) || null,
    systemSource: text(event.systemSource) || null,
    metadata: record(event.metadata),
  };
}

function enrichCanonicalMetadata(group, { levelTestById, consultationById, batchById }) {
  const metadata = { ...record(group.event.metadata) };
  if (group.entity?.kind === "appointment" && group.transitions.length > 0) {
    metadata.subjectTransitions = group.transitions;
  }
  if (group.entity?.kind === "attempt") {
    const attempt = levelTestById.get(group.entity.id);
    if (attempt) {
      const eventType = text(group.event.eventType);
      const terminalResult = ["level_test_completed", "level_test_absent", "level_test_canceled"].includes(eventType);
      metadata.attemptNumber = Number(metadata.attemptNumber) || Number(attempt.attemptNumber) || 1;
      metadata.startedAt = text(metadata.startedAt) || text(attempt.startedAt) || null;
      metadata.appointmentId = text(metadata.appointmentId) || text(attempt.appointmentId) || null;
      if (terminalResult) {
        metadata.resultStatus = text(metadata.resultStatus) || text(attempt.status);
        metadata.materialLink = text(metadata.materialLink) || text(attempt.materialLink) || null;
        metadata.completedAt = text(metadata.completedAt) || text(attempt.completedAt) || null;
      }
    }
  }
  if (group.entity?.kind === "consultation") {
    const consultation = consultationById.get(group.entity.id);
    if (consultation) {
      metadata.mode = text(metadata.mode) || text(consultation.mode);
      metadata.consultationStatus = text(metadata.consultationStatus) || text(consultation.status);
      metadata.outcome = text(metadata.outcome) || text(consultation.outcome) || null;
      metadata.completedAt = text(metadata.completedAt) || text(consultation.completedAt) || null;
      metadata.directorProfileId = text(metadata.directorProfileId) || text(consultation.directorProfileId) || null;
      metadata.appointmentId = text(metadata.appointmentId) || text(consultation.appointmentId) || null;
    }
  }
  if (group.entity?.kind === "batch") {
    const batch = batchById.get(group.entity.id);
    if (batch) {
      metadata.revisionNumber = Number(metadata.revisionNumber) || Number(batch.revisionNumber) || 1;
      const eventType = text(group.event.eventType);
      if (!text(metadata.action)) {
        if (eventType === "admission_batch_started") metadata.action = "started";
        if (eventType === "admission_batch_completed") metadata.action = "completed";
        if (eventType === "admission_batch_canceled") metadata.action = "canceled";
      }
      if (metadata.action === "invoice_sent") metadata.invoiceSentAt = text(batch.invoiceSentAt) || null;
      if (metadata.action === "payment_confirmed") metadata.paymentConfirmedAt = text(batch.paymentConfirmedAt) || null;
      if (metadata.action === "completed") {
        metadata.invoiceSentAt = text(batch.invoiceSentAt) || null;
        metadata.paymentConfirmedAt = text(batch.paymentConfirmedAt) || null;
      }
    }
  }
  return metadata;
}

export function buildRegistrationSubjectHistory(detail = {}) {
  const tracks = list(detail.tracks);
  const appointments = list(detail.appointments);
  const levelTests = list(detail.levelTests);
  const consultations = list(detail.consultations);
  const enrollments = list(detail.enrollments);
  const batches = list(detail.admissionBatches);
  const events = list(detail.events);
  if ([tracks, appointments, levelTests, consultations, enrollments, batches, events].every((items) => items.length === 0)) return [];

  const subjectByTrackId = new Map(tracks.map((track) => [text(track.id), text(track.subject)]));
  const levelTestById = new Map(levelTests.map((attempt) => [text(attempt.id), attempt]));
  const consultationById = new Map(consultations.map((consultation) => [text(consultation.id), consultation]));
  const batchById = new Map(batches.map((batch) => [text(batch.id), batch]));
  const subjectsForAppointment = (appointmentId) => uniqueSubjects([
    ...levelTests.filter((item) => text(item.appointmentId) === appointmentId).map((item) => subjectByTrackId.get(text(item.trackId))),
    ...consultations.filter((item) => text(item.appointmentId) === appointmentId).map((item) => subjectByTrackId.get(text(item.trackId))),
  ]);
  const subjectsForBatch = (batchId) => uniqueSubjects(
    enrollments
      .filter((item) => text(item.admissionBatchId) === batchId)
      .map((item) => subjectByTrackId.get(text(item.trackId))),
  );
  const referenced = {
    appointment: new Set(),
    appointmentSchedule: new Set(),
    attempt: new Set(),
    attemptSchedule: new Set(),
    consultation: new Set(),
    consultationSchedule: new Set(),
    canceledChild: new Set(),
    enrollment: new Set(),
    batch: new Set(),
  };
  const eventGroups = new Map();
  const fineEventsByAppointmentId = new Map();
  const orphanFineEventsByAppointmentId = new Map();
  const migrationEvents = [];

  for (const event of events) {
    if (isNotificationInternal(event)) continue;
    const stage = eventStage(event);
    const fineAppointment = isFineAppointmentEvent(event);
    if (!stage && !fineAppointment) continue;

    if (!isCanonicalProcessEvent(event)) {
      if (stage && text(event.legacyText)) migrationEvents.push({ event, stage });
      continue;
    }

    const metadata = record(event.metadata);
    const eventType = text(event.eventType);
    const subject = text(event.subject) || subjectByTrackId.get(text(event.trackId));
    if (fineAppointment) {
      const appointmentId = fineAppointmentId(event);
      if (!appointmentId) continue;
      const canceledAppointmentId = eventType === "appointment_replaced"
        ? text(metadata.oldAppointmentId)
        : text(metadata.appointmentId);
      if (canceledAppointmentId && ["appointment_subject_deselected", "appointment_canceled", "appointment_replaced"].includes(eventType)) {
        for (const trackId of list(metadata.canceledTrackIds).map(text).filter(Boolean)) {
          referenced.canceledChild.add(`${canceledAppointmentId}:${trackId}`);
        }
      }
      const current = fineEventsByAppointmentId.get(appointmentId) || [];
      current.push({ event, subject });
      fineEventsByAppointmentId.set(appointmentId, current);
      continue;
    }

    const entity = canonicalEventEntity(event);
    if (entity && referenced[entity.kind]) referenced[entity.kind].add(entity.id);
    const appointmentIds = [
      text(metadata.appointmentId),
      text(metadata.oldAppointmentId),
      text(metadata.newAppointmentId),
    ].filter(Boolean);
    if (eventType === "appointment_replaced") {
      for (const appointmentId of appointmentIds) referenced.appointment.add(appointmentId);
    }
    const canceledAppointmentId = eventType === "appointment_replaced"
      ? text(metadata.oldAppointmentId)
      : text(metadata.appointmentId);
    if (canceledAppointmentId && ["appointment_subject_deselected", "appointment_canceled", "appointment_replaced"].includes(eventType)) {
      for (const trackId of list(metadata.canceledTrackIds).map(text).filter(Boolean)) {
        referenced.canceledChild.add(`${canceledAppointmentId}:${trackId}`);
      }
    }
    if (
      entity?.kind === "appointment"
      && (
        eventType.includes("scheduled")
        || eventType.startsWith("appointment_")
        || eventType === "visit_scheduled"
      )
    ) {
      for (const appointmentId of appointmentIds) referenced.appointmentSchedule.add(appointmentId);
    }
    const activityId = text(metadata.activityId);
    if (activityId && ["level_test_scheduled", "level_test_retake_scheduled", "appointment_replaced"].includes(eventType)) referenced.attemptSchedule.add(activityId);
    if (activityId && ["visit_scheduled", "visit_consultation_scheduled", "appointment_replaced"].includes(eventType)) referenced.consultationSchedule.add(activityId);
    for (const rowId of list(metadata.rowIds).map(text).filter(Boolean)) referenced.enrollment.add(rowId);

    const groupKey = entity
      ? `${entity.kind}:${entity.id}:${entity.kind === "appointment" ? "operation" : eventType}:${canonicalOperationKey(event, entity)}`
      : `event:${text(event.id)}`;
    const current = eventGroups.get(groupKey);
    if (current) {
      current.subjects = uniqueSubjects([...current.subjects, subject]);
      current.eventTypes = [...new Set([...current.eventTypes, eventType])];
      current.transitions.push(eventTransition(event, subject));
      if (text(event.occurredAt) < text(current.event.occurredAt)) current.event = event;
      continue;
    }
    eventGroups.set(groupKey, {
      event,
      entity,
      stage,
      eventTypes: [eventType],
      transitions: [eventTransition(event, subject)],
      subjects: uniqueSubjects([subject]),
      fineEvents: [],
      outputId: entity ? `event:${groupKey}` : `event:${text(event.id)}`,
    });
  }

  for (const [appointmentId, fineEntries] of fineEventsByAppointmentId) {
    const operations = new Map();
    for (const entry of fineEntries) {
      const operationKey = fineAppointmentOperationKey(entry.event);
      const current = operations.get(operationKey);
      if (current) {
        current.entries.push(entry);
        current.subjects = uniqueSubjects([...current.subjects, entry.subject]);
        if (text(entry.event.occurredAt) < text(current.event.occurredAt)) current.event = entry.event;
      } else {
        operations.set(operationKey, {
          event: entry.event,
          entries: [entry],
          subjects: uniqueSubjects([entry.subject]),
        });
      }
    }

    const appointmentState = new Map();
    const orderedOperations = [...operations.values()].sort((left, right) => (
      text(left.event.occurredAt).localeCompare(text(right.event.occurredAt))
    ));
    for (const operation of orderedOperations) {
      const metadata = record(operation.event.metadata);
      const candidateIds = fineAppointmentIds(operation.event);
      const anchors = [...eventGroups.values()].filter((group) => (
        group.entity?.kind === "appointment" && candidateIds.includes(group.entity.id)
      ));
      const latestAnchors = [...anchors].sort((left, right) => (
        text(right.event.occurredAt).localeCompare(text(left.event.occurredAt))
      ));
      const fineRevision = Number(metadata.notificationRevision) || null;
      const oldRevision = Number(metadata.oldNotificationRevision) || null;
      const oldAppointmentId = text(metadata.oldAppointmentId);
      const anchor = (
        text(operation.event.eventType) === "appointment_replaced"
          ? latestAnchors.find((group) => (
              group.entity.id === oldAppointmentId
              && (!oldRevision || Number(record(group.event.metadata).notificationRevision) <= oldRevision)
            ))
          : null
      ) || anchors.find((group) => (
        fineRevision
        && Number(record(group.event.metadata).notificationRevision) === fineRevision
      )) || latestAnchors.find((group) => (
        text(group.event.occurredAt) <= text(operation.event.occurredAt)
      )) || latestAnchors[0];

      const stateId = text(metadata.appointmentId) || text(metadata.newAppointmentId) || appointmentId;
      let previousState = appointmentState.get(stateId) || null;
      if (!previousState) {
        const priorAnchors = latestAnchors.filter((group) => {
          const anchorRevision = Number(record(group.event.metadata).notificationRevision) || null;
          if (fineRevision && anchorRevision && anchorRevision < fineRevision) return true;
          return text(group.event.occurredAt) < text(operation.event.occurredAt)
            && (!fineRevision || anchorRevision !== fineRevision);
        });
        const priorMetadata = record(priorAnchors[0]?.event?.metadata);
        previousState = {
          scheduledAt: text(metadata.oldScheduledAt) || text(priorMetadata.scheduledAt),
          place: text(metadata.oldPlace) || text(priorMetadata.place),
        };
      }
      const normalizedMetadata = {
        ...metadata,
        ...(text(metadata.oldScheduledAt) || !text(previousState?.scheduledAt)
          ? {}
          : { oldScheduledAt: text(previousState.scheduledAt) }),
        ...(text(metadata.oldPlace) || !text(previousState?.place)
          ? {}
          : { oldPlace: text(previousState.place) }),
      };
      const normalizedEvent = { ...operation.event, metadata: normalizedMetadata };

      if (anchor) {
        anchor.fineEvents.push(normalizedEvent);
        anchor.subjects = uniqueSubjects([...anchor.subjects, ...operation.subjects]);
        anchor.eventTypes = [...new Set([...anchor.eventTypes, text(operation.event.eventType)])];
        for (const entry of operation.entries) {
          anchor.transitions.push(eventTransition(entry.event, entry.subject));
        }
        if (text(operation.event.eventType) === "appointment_replaced") {
          for (const replacedId of candidateIds) {
            referenced.appointment.add(replacedId);
            referenced.appointmentSchedule.add(replacedId);
          }
        }
      } else {
        const targetId = [
          text(metadata.appointmentId),
          text(metadata.newAppointmentId),
          text(metadata.oldAppointmentId),
        ].find((id) => id && appointments.some((appointment) => text(appointment.id) === id));
        if (targetId) {
          const current = orphanFineEventsByAppointmentId.get(targetId) || [];
          current.push(normalizedEvent);
          orphanFineEventsByAppointmentId.set(targetId, current);
          if (text(operation.event.eventType) === "appointment_replaced") {
            for (const relatedId of candidateIds) {
              if (relatedId !== targetId) referenced.appointment.add(relatedId);
              referenced.appointmentSchedule.add(relatedId);
            }
          }
        }
      }

      const nextStateId = text(metadata.newAppointmentId) || text(metadata.appointmentId) || appointmentId;
      appointmentState.set(nextStateId, {
        scheduledAt: text(metadata.scheduledAt) || text(previousState?.scheduledAt),
        place: text(metadata.place) || text(previousState?.place),
      });
    }
  }

  const items = [
    ...[...eventGroups.values()].map((group) => {
      const metadata = enrichCanonicalMetadata(group, { levelTestById, consultationById, batchById });
      if (group.fineEvents.length > 0) {
        metadata.appointmentChanges = group.fineEvents.map(appointmentChangeSnapshot);
      }
      return historyItem({
        id: group.outputId,
        kind: "event",
        stage: group.stage,
        occurredAt: group.event.occurredAt,
        subjects: group.subjects,
        title: eventTitle(group.event, metadata, group.eventTypes),
        description: snapshotDescription({ ...group.event, metadata }),
        metadata,
        actorId: group.event.actorId,
        actorKind: group.event.actorKind,
        systemSource: group.event.systemSource,
      });
    }),
    ...migrationEvents.map(({ event, stage }) => historyItem({
      id: `event:${text(event.id)}`,
      kind: "event",
      stage,
      occurredAt: null,
      subjects: [text(event.subject) || subjectByTrackId.get(text(event.trackId))],
      title: eventTitle(event),
      description: snapshotDescription(event),
      metadata: record(event.metadata),
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
    ...appointments.filter((appointment) => !referenced.appointment.has(text(appointment.id))).map((appointment) => historyItem({
      id: `appointment:${text(appointment.id)}`,
      kind: "appointment",
      stage: appointment.kind === "visit_consultation" ? "consultation" : "level_test",
      occurredAt: null,
      subjects: subjectsForAppointment(text(appointment.id)),
      title: appointment.kind === "visit_consultation" ? "방문상담 예약" : "레벨테스트 예약",
      description: [text(appointment.scheduledAt), text(appointment.place), displayValue(appointment.status)].filter(Boolean).join(" · "),
      metadata: {
        appointmentId: appointment.id,
        scheduledAt: appointment.scheduledAt,
        place: appointment.place,
        status: appointment.status,
        ...(orphanFineEventsByAppointmentId.has(text(appointment.id))
          ? { appointmentChanges: orphanFineEventsByAppointmentId.get(text(appointment.id)).map(appointmentChangeSnapshot) }
          : {}),
      },
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
    ...levelTests.filter((attempt) => (
      !referenced.attempt.has(text(attempt.id))
      && !(attempt.status === "scheduled" && referenced.attemptSchedule.has(text(attempt.id)))
      && !(attempt.status === "scheduled" && referenced.appointmentSchedule.has(text(attempt.appointmentId)))
      && !(attempt.status === "canceled" && referenced.canceledChild.has(`${text(attempt.appointmentId)}:${text(attempt.trackId)}`))
    )).map((attempt) => historyItem({
      id: `level-test:${text(attempt.id)}`,
      kind: "level_test",
      stage: "level_test",
      occurredAt: null,
      subjects: [subjectByTrackId.get(text(attempt.trackId))],
      title: `레벨테스트 ${Number(attempt.attemptNumber) || 1}회차`,
      description: [displayValue(attempt.status), text(attempt.materialLink)].filter(Boolean).join(" · "),
      metadata: { attemptId: attempt.id, appointmentId: attempt.appointmentId, materialLink: attempt.materialLink },
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
    ...consultations.filter((consultation) => (
      !referenced.consultation.has(text(consultation.id))
      && !(consultation.status === "scheduled" && referenced.consultationSchedule.has(text(consultation.id)))
      && !(consultation.status === "scheduled" && referenced.appointmentSchedule.has(text(consultation.appointmentId)))
      && !(consultation.status === "canceled" && referenced.canceledChild.has(`${text(consultation.appointmentId)}:${text(consultation.trackId)}`))
    )).map((consultation) => historyItem({
      id: `consultation:${text(consultation.id)}`,
      kind: "consultation",
      stage: "consultation",
      occurredAt: null,
      subjects: [subjectByTrackId.get(text(consultation.trackId))],
      title: consultation.mode === "visit" ? "방문상담" : "전화상담",
      description: [displayValue(consultation.status), displayValue(consultation.outcome)].filter(Boolean).join(" · "),
      metadata: { consultationId: consultation.id, appointmentId: consultation.appointmentId, directorProfileId: consultation.directorProfileId },
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
    ...enrollments.filter((enrollment) => !referenced.enrollment.has(text(enrollment.id))).map((enrollment) => historyItem({
      id: `enrollment:${text(enrollment.id)}`,
      kind: "enrollment",
      stage: "admission",
      occurredAt: null,
      subjects: [subjectByTrackId.get(text(enrollment.trackId))],
      title: "수강 등록",
      description: [text(enrollment.classId), displayValue(enrollment.status)].filter(Boolean).join(" · "),
      metadata: { enrollmentId: enrollment.id, batchId: enrollment.admissionBatchId, textbookId: enrollment.textbookId },
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
    ...batches.filter((batch) => !referenced.batch.has(text(batch.id))).map((batch) => historyItem({
      id: `batch:${text(batch.id)}`,
      kind: "batch",
      stage: "admission",
      occurredAt: null,
      subjects: subjectsForBatch(text(batch.id)),
      title: `등록 처리 ${Number(batch.revisionNumber) || 1}차`,
      description: displayValue(batch.status),
      metadata: { batchId: batch.id },
      actorKind: "migration",
      timeKind: "unavailable",
      origin: "migration",
    })),
  ];

  return items.sort((left, right) => {
    if (left.timeKind !== right.timeKind) return left.timeKind === "exact" ? -1 : 1;
    if (left.occurredAt && right.occurredAt) {
      const timeOrder = right.occurredAt.localeCompare(left.occurredAt);
      if (timeOrder !== 0) return timeOrder;
    }
    return left.id.localeCompare(right.id);
  });
}
