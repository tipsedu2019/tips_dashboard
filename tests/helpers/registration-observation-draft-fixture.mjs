export function createObservationDraftFixtureState(state, mode) {
  if (mode !== "booking" && mode !== "decision") return state;
  const observation = state.observation;
  observation.runtimeVersion = 1;
  observation.schemaReadiness.runtimeVersion = 1;
  const manager = Object.values(observation.managerDetails)[0];
  const { trackId, taskId } = manager.track;
  const caseDetail = structuredClone(Object.values(state.caseDetails)[0]);
  const workflowStatus = mode === "booking" ? "observation_requested" : "observation_feedback_pending";
  const track = { ...caseDetail.tracks[0], id: trackId, taskId, subject: "영어", status: "observation", workflowStatus, workflowRevision: 7, observationSummaryVisible: true, observationCurrentId: null, observationCurrentAppointmentId: null, observationCurrentStatus: null, observationAttemptCount: 0, directorProfileId: "fixture-profile-english-director", directorName: "강부희" };
  manager.track.workflowStatus = workflowStatus;
  for (const sessions of Object.values(observation.sessions)) for (const session of sessions) {
    Object.assign(session, { sessionDate: "2026-09-20", startsAt: "2026-09-20T01:00:00.000Z", endsAt: "2026-09-20T02:00:00.000Z" });
  }
  if (mode === "decision") {
    const session = Object.values(observation.sessions)[0][0];
    const attempt = { ...session, observationId: "20000000-0000-4000-8000-000000000009", taskId, trackId, appointmentId: "20000000-0000-4000-8000-000000000010", appointmentStatus: "scheduled", status: "completed", attendance: "attended", suitabilityResult: "fit", decisionKind: null, revision: 2, feedbackRevision: 1, appointmentNotificationRevision: 1, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" };
    manager.currentObservation = attempt;
    manager.attempts = [attempt];
    Object.assign(track, { observationCurrentId: attempt.observationId, observationCurrentAppointmentId: attempt.appointmentId, observationCurrentStatus: attempt.status, observationAttemptCount: 1, observationRevision: 2, observationFeedbackRevision: 1, observationNotificationRevision: 1 });
    const feedback = { ...attempt, studentName: "청강 초안 검증", studentGrade: "고1", trackWorkflowRevision: 7, feedbackReason: "합성 수업 결과", proxySubmitted: false, feedbackSubmittedByName: "합성 담당", feedbackSubmittedAt: "2026-09-10T00:00:00Z" };
    observation.feedbackDetails[attempt.observationId] = Object.fromEntries("observationId taskId trackId appointmentId studentName studentGrade subject classId className sessionAuthority sessionDate sessionKey classLessonSessionId legacySessionKey sourceRevision startsAt endsAt classroomName teacherName status attendance suitabilityResult feedbackReason proxySubmitted feedbackSubmittedByName feedbackSubmittedAt revision feedbackRevision appointmentNotificationRevision trackWorkflowRevision decisionKind".split(" ").map(key => [key, feedback[key]]));
  }
  const sibling = { ...caseDetail.tracks[1], id: "20000000-0000-4000-8000-000000000011", taskId, subject: "수학", status: "inquiry", workflowStatus: "inquiry" };
  caseDetail.task = { ...caseDetail.task, id: taskId, title: "청강 초안 검증", studentName: "청강 초안 검증", registrationTracks: [track, sibling] };
  caseDetail.tracks = [track, sibling];
  for (const key of ["appointments", "levelTests", "consultations", "enrollments", "admissionBatches"]) caseDetail[key] = [];
  state.caseDetails[taskId] = caseDetail;
  state.workspaceData.tasks = [caseDetail.task, ...state.workspaceData.tasks];
  return state;
}
