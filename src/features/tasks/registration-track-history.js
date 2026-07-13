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
    consultation_completed: "상담 결과 저장",
    director_default_resolved: "상담 책임자 자동 배정",
    director_default_cleared: "상담 책임자 자동 배정 해제",
    director_manual_override: "상담 책임자 변경",
    director_assignment_required: "상담 책임자 지정 필요",
    director_phone_queue_repaired: "전화상담 대기 복구",
    registration_common_info_updated: "공통 정보 변경",
    registration_subjects_synced: "문의 과목 변경",
    registration_subject_removed: "문의 과목 삭제",
    inquiry_routed: "문의 다음 단계 결정",
    level_test_scheduled: "레벨테스트 예약",
    level_test_retake_scheduled: "레벨테스트 재응시 예약",
    visit_scheduled: "방문상담 예약",
    appointment_updated: "예약 변경",
    appointment_replaced: "예약 교체",
    appointment_subject_deselected: "예약 과목 제외",
    appointment_canceled: "예약 취소",
    level_test_completed: "레벨테스트 결과 저장",
    level_test_absent: "레벨테스트 결시",
    level_test_canceled: "레벨테스트 취소",
    level_test_started: "레벨테스트 시작",
    level_test_track_closed: "레벨테스트 종료",
    waiting_transitioned: "대기 상태 변경",
    enrollment_decision_routed: "등록 진행 방향 결정",
    enrollment_rows_saved: "수업 등록 정보 저장",
    registration_enrollment_makeedu_updated: "메이크에듀 등록 확인",
    registration_enrollment_canceled: "수강 등록 취소",
    registration_enrollment_roster_released: "수강 명단 연결 해제",
    admission_batch_started: "등록 처리 시작",
    admission_batch_advanced: "등록 처리 진행",
    admission_batch_completed: "등록 처리 완료",
    admission_batch_canceled: "등록 처리 취소",
  };
  return labels[text(event.eventType)] || text(event.eventType).replaceAll("_", " ") || "기존 이력";
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
    parts.push([text(event.source), text(event.destination)].filter(Boolean).join(" → "));
  }
  if (text(event.reason)) parts.push(text(event.reason));
  if (subjectTransitions.length > 1) {
    for (const transition of subjectTransitions) {
      const route = [text(transition.source), text(transition.destination)].filter(Boolean).join(" → ");
      const transitionReason = text(transition.reason);
      parts.push(`${text(transition.subject) || "과목"}: ${[route, transitionReason].filter(Boolean).join(" · ")}`);
    }
  }
  for (const key of snapshotKeys) {
    const value = text(metadata[key]);
    if (value) parts.push(`${key}: ${value}`);
  }
  for (const row of list(metadata.rows).map(record)) {
    const rowParts = [
      text(row.classId) ? `classId: ${text(row.classId)}` : "",
      text(row.textbookId) ? `textbookId: ${text(row.textbookId)}` : "교재 없음",
      text(row.classStartDate) ? `수업시작일: ${text(row.classStartDate)}` : "",
      text(row.classStartSession) ? `회차: ${text(row.classStartSession)}` : "",
      text(row.status) ? `status: ${text(row.status)}` : "",
    ].filter(Boolean);
    if (rowParts.length > 0) parts.push(rowParts.join(" · "));
  }
  const enrollmentSnapshot = record(metadata.enrollmentSnapshot);
  if (Object.keys(enrollmentSnapshot).length > 0) {
    const enrollmentParts = [
      text(enrollmentSnapshot.classId) ? `기존 수업: ${text(enrollmentSnapshot.classId)}` : "",
      text(enrollmentSnapshot.textbookId) ? `기존 교재: ${text(enrollmentSnapshot.textbookId)}` : "기존 교재 없음",
      text(enrollmentSnapshot.admissionBatchId) ? `등록 묶음: ${text(enrollmentSnapshot.admissionBatchId)}` : "",
      text(enrollmentSnapshot.classStartDate) ? `수업시작일: ${text(enrollmentSnapshot.classStartDate)}` : "",
      text(enrollmentSnapshot.classStartSession) ? `회차: ${text(enrollmentSnapshot.classStartSession)}` : "",
      text(enrollmentSnapshot.status) ? `기존 상태: ${text(enrollmentSnapshot.status)}` : "",
    ].filter(Boolean);
    if (enrollmentParts.length > 0) parts.push(enrollmentParts.join(" · "));
  }
  return parts.join(" · ");
}

function historyItem({ id, kind, occurredAt, subjects, title, description = "", metadata = {}, actorId = null }) {
  return {
    id,
    kind,
    occurredAt: text(occurredAt),
    subjects: uniqueSubjects(subjects),
    title: text(title) || "진행 이력",
    description: text(description),
    metadata: record(metadata),
    actorId: text(actorId) || null,
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
  const appointmentById = new Map(appointments.map((appointment) => [text(appointment.id), appointment]));
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
  for (const event of events) {
    const entity = canonicalEventEntity(event);
    if (entity) referenced[entity.kind].add(entity.id);
    const metadata = record(event.metadata);
    const eventType = text(event.eventType);
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
    if (activityId && ["visit_scheduled", "appointment_replaced"].includes(eventType)) referenced.consultationSchedule.add(activityId);
    for (const rowId of list(metadata.rowIds).map(text).filter(Boolean)) referenced.enrollment.add(rowId);
    const groupKey = entity
      ? `${entity.kind}:${entity.id}:${entity.kind === "appointment" ? "operation" : eventType}:${canonicalOperationKey(event, entity)}`
      : `event:${text(event.id)}`;
    const subject = text(event.subject) || subjectByTrackId.get(text(event.trackId));
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
      eventTypes: [eventType],
      transitions: [eventTransition(event, subject)],
      subjects: uniqueSubjects([subject]),
      outputId: entity ? `event:${groupKey}` : `event:${text(event.id)}`,
    });
  }

  const items = [
    ...[...eventGroups.values()].map((group) => {
      const metadata = enrichCanonicalMetadata(group, { levelTestById, consultationById, batchById });
      return historyItem({
        id: group.outputId,
        kind: "event",
        occurredAt: group.event.occurredAt,
        subjects: group.subjects,
        title: eventTitle(group.event, metadata, group.eventTypes),
        description: snapshotDescription({ ...group.event, metadata }),
        metadata,
        actorId: group.event.actorId,
      });
    }),
    ...appointments.filter((appointment) => !referenced.appointment.has(text(appointment.id))).map((appointment) => historyItem({
      id: `appointment:${text(appointment.id)}`,
      kind: "appointment",
      occurredAt: appointment.updatedAt || appointment.createdAt || appointment.scheduledAt,
      subjects: subjectsForAppointment(text(appointment.id)),
      title: appointment.kind === "visit_consultation" ? "방문상담 예약" : "레벨테스트 예약",
      description: [text(appointment.scheduledAt), text(appointment.place), text(appointment.status)].filter(Boolean).join(" · "),
      metadata: { appointmentId: appointment.id, scheduledAt: appointment.scheduledAt },
    })),
    ...levelTests.filter((attempt) => (
      !referenced.attempt.has(text(attempt.id))
      && !(attempt.status === "scheduled" && referenced.attemptSchedule.has(text(attempt.id)))
      && !(attempt.status === "scheduled" && referenced.appointmentSchedule.has(text(attempt.appointmentId)))
      && !(attempt.status === "canceled" && referenced.canceledChild.has(`${text(attempt.appointmentId)}:${text(attempt.trackId)}`))
    )).map((attempt) => {
      const appointment = appointmentById.get(text(attempt.appointmentId));
      return historyItem({
        id: `level-test:${text(attempt.id)}`,
        kind: "level_test",
        occurredAt: attempt.completedAt || attempt.startedAt || appointment?.scheduledAt || "",
        subjects: [subjectByTrackId.get(text(attempt.trackId))],
        title: `레벨테스트 ${Number(attempt.attemptNumber) || 1}회차`,
        description: [text(attempt.status), text(attempt.materialLink)].filter(Boolean).join(" · "),
        metadata: { attemptId: attempt.id, appointmentId: attempt.appointmentId, materialLink: attempt.materialLink },
      });
    }),
    ...consultations.filter((consultation) => (
      !referenced.consultation.has(text(consultation.id))
      && !(consultation.status === "scheduled" && referenced.consultationSchedule.has(text(consultation.id)))
      && !(consultation.status === "scheduled" && referenced.appointmentSchedule.has(text(consultation.appointmentId)))
      && !(consultation.status === "canceled" && referenced.canceledChild.has(`${text(consultation.appointmentId)}:${text(consultation.trackId)}`))
    )).map((consultation) => {
      const appointment = appointmentById.get(text(consultation.appointmentId));
      return historyItem({
        id: `consultation:${text(consultation.id)}`,
        kind: "consultation",
        occurredAt: consultation.completedAt || consultation.updatedAt || consultation.createdAt || appointment?.scheduledAt || "",
        subjects: [subjectByTrackId.get(text(consultation.trackId))],
        title: consultation.mode === "visit" ? "방문상담" : "전화상담",
        description: [text(consultation.status), text(consultation.outcome)].filter(Boolean).join(" · "),
        metadata: { consultationId: consultation.id, appointmentId: consultation.appointmentId, directorProfileId: consultation.directorProfileId },
      });
    }),
    ...enrollments.filter((enrollment) => !referenced.enrollment.has(text(enrollment.id))).map((enrollment) => {
      const batch = batchById.get(text(enrollment.admissionBatchId));
      return historyItem({
        id: `enrollment:${text(enrollment.id)}`,
        kind: "enrollment",
        occurredAt: enrollment.updatedAt || enrollment.createdAt || batch?.createdAt || enrollment.classStartDate || "",
        subjects: [subjectByTrackId.get(text(enrollment.trackId))],
        title: "수강 등록",
        description: [text(enrollment.classId), text(enrollment.status)].filter(Boolean).join(" · "),
        metadata: { enrollmentId: enrollment.id, batchId: enrollment.admissionBatchId, textbookId: enrollment.textbookId },
      });
    }),
    ...batches.filter((batch) => !referenced.batch.has(text(batch.id))).map((batch) => historyItem({
      id: `batch:${text(batch.id)}`,
      kind: "batch",
      occurredAt: batch.updatedAt || batch.paymentConfirmedAt || batch.invoiceSentAt || batch.createdAt,
      subjects: subjectsForBatch(text(batch.id)),
      title: `등록 처리 ${Number(batch.revisionNumber) || 1}차`,
      description: text(batch.status),
      metadata: { batchId: batch.id },
    })),
  ];

  return items.sort((left, right) => (
    right.occurredAt.localeCompare(left.occurredAt)
    || left.id.localeCompare(right.id)
  ));
}
