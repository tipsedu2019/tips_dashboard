// Synthetic registration data only. Fresh objects on every factory call.
export const id = n => `21900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ids = { task: id(1), track: id(2), appointment: id(3), level: id(4), consultation: id(5), enrollment: id(6), batch: id(7), class: id(8), textbook: id(9), profile: id(10), message: id(11) };
export const time = '2026-10-29T01:00:00.000Z';
export const clone = value => JSON.parse(JSON.stringify(value));
export function bundle() {
  return {
    parent: { id: ids.task, type: 'registration', title: '합성 등록', student_name: '합성 학생', updated_at: time,
      ops_registration_details: { pipeline_status: '1. 레벨테스트 예약', inquiry_at: time, school_grade: '중2', school_name: '합성 학교', parent_phone: '01000000001', student_phone: '01000000002', request_note: '합성 요청 사항', common_revision: 3, admission_checklist: { applicationSent: false, invoiceSent: true, paymentConfirmed: false, makeeduRegistered: false, registrationCompleted: false } },
    },
    tracks: [{ id: ids.track, task_id: ids.task, subject: '수학', pipeline_status: 'consultation_waiting', workflow_status: 'consultation_requested', workflow_revision: 2, director_profile_id: null, director: null,
      observation_attempt_count: 0, observation_current_id: null, observation_current_status: null, observation_current_appointment_id: null, observation_nearest_scheduled_at: null, observation_nearest_place: null, observation_notification_revision: null, observation_revision: null, observation_feedback_revision: null,
    }],
    appointments: [{ id: ids.appointment, task_id: ids.task, kind: 'level_test', scheduled_at: time, place: '합성 시험실', status: 'scheduled', notification_revision: 1, created_at: time, updated_at: time }],
    levelTests: [{ id: ids.level, track_id: ids.track, appointment_id: ids.appointment, attempt_number: 1, status: 'completed', started_at: time, completed_at: time, material_link: 'https://example.invalid/result' }],
    consultations: [{ id: ids.consultation, track_id: ids.track, appointment_id: null, mode: 'phone', status: 'completed', director_profile_id: ids.profile, ready_at: time, ready_source: 'inquiry', completed_at: time, outcome: 'waiting', note: '합성 상담 내용', created_at: time, updated_at: time }],
    admissionBatches: [{ id: ids.batch, task_id: ids.task, revision_number: 1, status: 'draft', invoice_sent_at: null, payment_confirmed_at: null, created_at: time, updated_at: time }],
    enrollments: [{ id: ids.enrollment, track_id: ids.track, student_id: null, admission_batch_id: ids.batch, class_id: ids.class, textbook_id: ids.textbook, textbook_ids: [ids.textbook], class_start_date: '2026-11-02', class_start_session: '1회차', status: 'planned', makeedu_registered: false, roster_active: false, sort_order: 0, created_at: time, updated_at: time }],
    events: [{ id: id(14), task_id: ids.task, actor_id: null, event_type: 'inquiry_routed', field_name: null, before_value: null, after_value: '합성 이력', created_at: time }],
    eventWindow: { recentLimit: 30, totalCount: 1, returnedCount: 1, anchorCount: 0, hasEarlierEvents: false },
    activeAdmissionMessage: { id: ids.message, status: 'accepted', claim_active: true, template_key: 'admission_application', updated_at: time },
    reminderSummaries: [{ appointment_id: ids.appointment, scheduled_for: time, sent_at: null, state: 'scheduled', updated_at: time }],
    scheduledAppointmentTotal: 31, currentEnrollmentTotal: 31,
    profiles: [{ id: ids.profile, name: '합성 담당자' }], classes: [{ id: ids.class, name: '합성 수학반' }], textbooks: [{ id: ids.textbook, title: '합성 교재' }],
  };
}
export function envelope(section, data, taskId = ids.task) { return { contractVersion: 1, taskId, section, data }; }
export const history = () => ({ ok: true, page: 1, pageSize: 10, totalCount: 1, history: [{ messageId: ids.message, messageKind: 'admission_application', currentStatus: 'accepted', confirmedByName: '합성 담당자', confirmedAt: time, updatedAt: time, recipientLast4: '0000', canCheck: false, canCheckDelivery: false }] });
export function attempt() { return { observationId: id(30), taskId: ids.task, trackId: ids.track, appointmentId: id(31), appointmentStatus: 'scheduled', className: '합성 청강반', subject: '수학', sessionDate: '2026-10-29', startsAt: '2026-10-29T09:00:00.000Z', endsAt: '2026-10-29T10:00:00.000Z', teacherName: '합성 교사', classroomName: '합성 교실', campus: '합성 본관', textbooks: [{ title: '합성 수업 자료' }], progress: '합성 진도', status: 'scheduled', attendance: null, suitabilityResult: null, decisionKind: null, createdAt: time, updatedAt: time }; }
export function observationDetail() { return { track: { taskId: ids.task, trackId: ids.track, subject: '수학' }, currentObservation: attempt(), attempts: [attempt()], latestDecisionObservation: null }; }
export function feedback() { return { observationId: id(30), taskId: ids.task, trackId: ids.track, status: 'completed', className: '합성 청강반', teacherName: '합성 교사', attendance: 'attended', decisionKind: 'enrollment', suitabilityResult: 'fit', feedbackReason: '합성 검토 내용', proxySubmitted: true, feedbackSubmittedByName: '합성 대리 작성자', feedbackSubmittedAt: time }; }
export const trackInput = () => ({ taskId: ids.task, trackId: ids.track });
export const observationInput = () => ({ ...trackInput(), observationId: id(30) });
