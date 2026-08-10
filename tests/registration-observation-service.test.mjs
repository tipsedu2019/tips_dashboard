import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRegistrationObservationFeedbackDetail,
  normalizeRegistrationObservationMutationResult,
  normalizeRegistrationObservationSessionOption,
} from "../src/features/tasks/registration-observation-model.ts";
import {
  activateRegistrationObservationRuntime,
  cancelRegistrationObservation,
  correctRegistrationObservationFeedback,
  decideRegistrationObservation,
  enterRegistrationObservation,
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerAttempt,
  loadRegistrationObservationManagerDetail,
  loadRegistrationObservationSchemaReadiness,
  loadRegistrationObservationSessions,
  recordRegistrationObservationAttendance,
  saveRegistrationObservationBooking,
  submitRegistrationObservationFeedback,
  withdrawRegistrationObservation,
} from "../src/features/tasks/registration-observation-service.ts";

const IDS = {
  track: "10000000-0000-4000-8000-000000000001",
  task: "10000000-0000-4000-8000-000000000002",
  observation: "10000000-0000-4000-8000-000000000003",
  appointment: "10000000-0000-4000-8000-000000000004",
  class: "10000000-0000-4000-8000-000000000005",
  lesson: "10000000-0000-4000-8000-000000000006",
  teacherCatalog: "10000000-0000-4000-8000-000000000007",
  teacherProfile: "10000000-0000-4000-8000-000000000008",
  classroom: "10000000-0000-4000-8000-000000000009",
  director: "10000000-0000-4000-8000-000000000010",
};

const exactNormalizedSession = Object.freeze({
  classId: IDS.class,
  subject: "영어",
  scheduleState: "active",
  sessionDate: "2026-08-12",
  startsAt: "2026-08-12T09:00:00.000Z",
  endsAt: "2026-08-12T10:00:00.000Z",
  teacherCatalogId: IDS.teacherCatalog,
  teacherProfileId: IDS.teacherProfile,
  teacherName: "강부희",
  classroomCatalogId: IDS.classroom,
  classroomName: "본관 301호",
  campus: "본관",
  className: "고1 영어 A",
  textbooks: [{ textbookId: null, title: "수업 자료", planLabel: "1과", memo: "" }],
  progress: "진도: 1과",
  bookingFactHash: "booking-fact-hash-1",
  sessionAuthority: "normalized",
  classLessonSessionId: IDS.lesson,
  legacySessionKey: null,
  sessionKey: "2026-08-12:lesson-1",
  sessionSourceRevision: 3,
  legacySessionSourceHash: null,
  sourceRevision: {
    authority: "normalized",
    sessionId: IDS.lesson,
    revision: 3,
  },
});

const exactLegacySession = Object.freeze({
  ...exactNormalizedSession,
  sessionAuthority: "legacy",
  classLessonSessionId: null,
  legacySessionKey: "2026-08-12:legacy-1",
  sessionKey: "2026-08-12:legacy-1",
  sessionSourceRevision: null,
  legacySessionSourceHash: "legacy-content-hash-1",
  sourceRevision: {
    authority: "legacy",
    sessionKey: "2026-08-12:legacy-1",
    contentHash: "legacy-content-hash-1",
  },
});

const exactAttempt = Object.freeze({
  ...exactNormalizedSession,
  observationId: IDS.observation,
  taskId: IDS.task,
  trackId: IDS.track,
  appointmentId: IDS.appointment,
  appointmentStatus: "scheduled",
  status: "scheduled",
  attendance: null,
  suitabilityResult: null,
  decisionKind: null,
  revision: 1,
  feedbackRevision: 0,
  appointmentNotificationRevision: 1,
  createdAt: "2026-08-10T02:00:00.000Z",
  updatedAt: "2026-08-10T02:00:00.000Z",
});

const exactOldAttemptDetail = Object.freeze({
  trackId: IDS.track,
  taskId: IDS.task,
  observation: exactAttempt,
});

const exactManagerDetail = Object.freeze({
  track: {
    trackId: IDS.track,
    taskId: IDS.task,
    subject: "영어",
    workflowStatus: "observation_requested",
    workflowRevision: 8,
    observationReturnWorkflowStatus: "consultation_completed",
    directorProfileId: IDS.director,
  },
  currentObservation: exactAttempt,
  latestEnrollmentDecisionObservationId: "10000000-0000-4000-8000-000000000099",
  latestDecisionObservation: {
    observationId: "10000000-0000-4000-8000-000000000098",
    decisionKind: "re_observation",
    observationRevision: 6,
    feedbackRevision: 2,
  },
  attempts: [exactAttempt],
  classes: [{ id: IDS.class, name: "고1 영어 A", subject: "영어" }],
});

const exactMutation = Object.freeze({
  operation: "book",
  requestKey: "observation-book-request-1",
  trackId: IDS.track,
  workflowStatus: "observation_requested",
  workflowRevision: 8,
  observation: exactAttempt,
  appointment: {
    appointmentId: IDS.appointment,
    status: "scheduled",
    scheduledAt: exactAttempt.startsAt,
    place: "본관",
    notificationRevision: 1,
  },
  changed: true,
});

const exactFeedback = Object.freeze({
  observationId: IDS.observation,
  taskId: IDS.task,
  trackId: IDS.track,
  appointmentId: IDS.appointment,
  studentName: "김다미",
  studentGrade: "고1",
  subject: "영어",
  classId: IDS.class,
  className: "고1 영어 A",
  sessionAuthority: "normalized",
  sessionDate: "2026-08-12",
  sessionKey: "2026-08-12:lesson-1",
  classLessonSessionId: IDS.lesson,
  legacySessionKey: null,
  sourceRevision: {
    authority: "normalized",
    sessionId: IDS.lesson,
    revision: 3,
  },
  startsAt: "2026-08-12T09:00:00.000Z",
  endsAt: "2026-08-12T10:00:00.000Z",
  classroomName: "본관 301호",
  teacherName: "강부희",
  status: "completed",
  attendance: "attended",
  suitabilityResult: "fit",
  feedbackReason: "수업 참여와 이해도가 좋습니다.",
  proxySubmitted: true,
  feedbackSubmittedByName: "운영 담당자",
  feedbackSubmittedAt: "2026-08-12T10:05:00.000Z",
  revision: 2,
  feedbackRevision: 1,
  appointmentNotificationRevision: 1,
  trackWorkflowRevision: 9,
  decisionKind: null,
});

const exactLegacyFeedback = Object.freeze({
  ...exactFeedback,
  sessionAuthority: "legacy",
  sessionKey: "2026-08-12:legacy-1",
  classLessonSessionId: null,
  legacySessionKey: "2026-08-12:legacy-1",
  sourceRevision: {
    authority: "legacy",
    sessionKey: "2026-08-12:legacy-1",
    contentHash: "legacy-content-hash-1",
  },
});

function feedbackMutationEnvelope(operation, requestKey, feedback) {
  const appointmentStatus = feedback.status === "scheduled" ? "scheduled" : "completed";
  const observation = {
    ...exactAttempt,
    appointmentStatus,
    status: feedback.status,
    attendance: feedback.attendance,
    suitabilityResult: feedback.suitabilityResult,
    decisionKind: feedback.decisionKind,
    revision: feedback.revision,
    feedbackRevision: feedback.feedbackRevision,
    appointmentNotificationRevision: feedback.appointmentNotificationRevision,
    updatedAt: feedback.feedbackSubmittedAt ?? exactAttempt.updatedAt,
  };
  return {
    operation,
    requestKey,
    trackId: feedback.trackId,
    workflowStatus: feedback.decisionKind === "not_registered"
      ? "not_registered"
      : feedback.status === "attended_feedback_pending"
        ? "observation_feedback_pending"
        : feedback.status === "scheduled"
          ? "observation_requested"
          : "observation_completed",
    workflowRevision: feedback.trackWorkflowRevision,
    observation,
    appointment: {
      ...exactMutation.appointment,
      status: appointmentStatus,
      notificationRevision: feedback.appointmentNotificationRevision,
    },
    changed: true,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function captureRpcClient({ result, handler } = {}) {
  const state = {
    calls: [],
    retryArguments: [],
    abortSignals: [],
    abortSignalTimeoutMs: null,
  };
  const client = {
    ...state,
    rpc(name, args = {}) {
      const call = { name, args };
      state.calls.push(call);
      let execution;
      const request = {
        abortSignal(signal) {
          state.abortSignals.push(signal);
          state.abortSignalTimeoutMs = signal?.timeoutMs ?? null;
          client.abortSignalTimeoutMs = state.abortSignalTimeoutMs;
          return request;
        },
        retry(enabled) {
          state.retryArguments.push(enabled);
          return request;
        },
        then(resolve, reject) {
          execution ||= Promise.resolve().then(
            () => handler ? handler(call, state.calls.length - 1) : result,
          );
          return execution.then(resolve, reject);
        },
      };
      return request;
    },
  };
  return client;
}

async function captureTimeout(work) {
  const originalAbortSignal = globalThis.AbortSignal;
  const timeoutCalls = [];
  globalThis.AbortSignal = {
    timeout(timeoutMs) {
      timeoutCalls.push(timeoutMs);
      return { timeoutMs };
    },
  };
  try {
    return { result: await work(), timeoutCalls };
  } finally {
    globalThis.AbortSignal = originalAbortSignal;
  }
}

function ok(data) {
  return { data, error: null };
}

function newBookingInput(overrides = {}) {
  return {
    trackId: IDS.track,
    observationId: null,
    classId: IDS.class,
    sessionAuthority: "normalized",
    classLessonSessionId: IDS.lesson,
    legacySessionKey: null,
    expectedWorkflowRevision: 7,
    expectedAppointmentNotificationRevision: null,
    expectedObservationRevision: null,
    requestKey: exactMutation.requestKey,
    ...overrides,
  };
}

test("single-attempt loader is bounded by exact track and observation ids", async () => {
  const client = captureRpcClient({ result: ok(exactOldAttemptDetail) });

  const { result, timeoutCalls } = await captureTimeout(
    () => loadRegistrationObservationManagerAttempt(client, {
      trackId: exactOldAttemptDetail.trackId,
      observationId: exactOldAttemptDetail.observation.observationId,
    }),
  );

  assert.deepEqual(client.calls[0], {
    name: "get_registration_observation_manager_attempt_v1",
    args: {
      p_track_id: exactOldAttemptDetail.trackId,
      p_observation_id: exactOldAttemptDetail.observation.observationId,
    },
  });
  assert.equal(client.abortSignalTimeoutMs, 12_000);
  assert.deepEqual(timeoutCalls, [12_000]);
  assert.deepEqual(client.retryArguments, [false]);
  assert.deepEqual(result, exactOldAttemptDetail);
});

test("manager detail is a fresh bounded read and preserves old attempts outside the latest decision", async () => {
  const client = captureRpcClient({ result: ok(exactManagerDetail) });

  const first = loadRegistrationObservationManagerDetail(client, {
    trackId: IDS.track,
    attemptLimit: 20,
  });
  const second = loadRegistrationObservationManagerDetail(client, {
    trackId: IDS.track,
    attemptLimit: 20,
  });

  assert.notStrictEqual(first, second);
  assert.deepEqual(await first, exactManagerDetail);
  assert.deepEqual(await second, exactManagerDetail);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[0], {
    name: "get_registration_observation_manager_detail_v1",
    args: { p_track_id: IDS.track, p_attempt_limit: 20 },
  });
  assert.deepEqual(client.retryArguments, [false, false]);
});

test("session reads dedupe only an identical bounded key", async () => {
  const pending = deferred();
  const client = captureRpcClient({ handler: () => pending.promise });

  const input = {
    trackId: IDS.track,
    classId: IDS.class,
    dateFrom: "2026-08-11",
    dateTo: "2026-08-20",
  };
  const first = loadRegistrationObservationSessions(client, input);
  const second = loadRegistrationObservationSessions(client, { ...input });

  assert.strictEqual(first, second);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0], {
    name: "list_registration_observation_sessions_v1",
    args: {
      p_track_id: IDS.track,
      p_class_id: IDS.class,
      p_date_from: "2026-08-11",
      p_date_to: "2026-08-20",
    },
  });

  pending.resolve(ok([exactNormalizedSession, exactLegacySession]));
  assert.deepEqual(await first, [exactNormalizedSession, exactLegacySession]);
  assert.deepEqual(client.retryArguments, [false]);
});

test("strict session normalizer rejects extra keys and source-branch mismatches", async () => {
  const invalidPayloads = [
    [{ ...exactNormalizedSession, unexpected: true }],
    [{ ...exactNormalizedSession, classId: "not-a-uuid" }],
    [{ ...exactNormalizedSession, sessionDate: "2026-02-30" }],
    [{ ...exactNormalizedSession, startsAt: "2026-08-12 09:00" }],
    [{ ...exactNormalizedSession, startsAt: "2026-02-31T09:00:00.000Z" }],
    [{ ...exactNormalizedSession, sourceRevision: { ...exactNormalizedSession.sourceRevision, sessionId: IDS.class } }],
    [{ ...exactLegacySession, sessionKey: "different-key" }],
    [{ ...exactLegacySession, legacySessionSourceHash: "" }],
    [{ ...exactNormalizedSession, textbooks: [{ ...exactNormalizedSession.textbooks[0], extra: "x" }] }],
  ];

  for (let index = 0; index < invalidPayloads.length; index += 1) {
    const client = captureRpcClient({ result: ok(invalidPayloads[index]) });
    await assert.rejects(
      loadRegistrationObservationSessions(client, {
        trackId: IDS.track,
        classId: IDS.class,
        dateFrom: "2026-08-12",
        dateTo: "2026-08-12",
      }),
      /registration_observation_.*_invalid/,
    );
  }
});

test("session normalizer rejects an impossible calendar timestamp", () => {
  assert.throws(
    () => normalizeRegistrationObservationSessionOption({
      ...exactNormalizedSession,
      startsAt: "2026-02-31T09:00:00.000Z",
    }),
    /registration_observation_session_option_invalid/,
  );
});

test("manager detail requires current observation to equal its attempts payload", async () => {
  const mismatched = {
    ...exactManagerDetail,
    currentObservation: { ...exactAttempt, revision: 2 },
  };
  const client = captureRpcClient({ result: ok(mismatched) });

  await assert.rejects(
    loadRegistrationObservationManagerDetail(client, { trackId: IDS.track }),
    /registration_observation_manager_detail_invalid/,
  );
});

test("manager detail normalizes the latest decision independently of bounded attempts", async () => {
  const client = captureRpcClient({ result: ok(exactManagerDetail) });
  const detail = await loadRegistrationObservationManagerDetail(client, {
    trackId: IDS.track,
    attemptLimit: 1,
  });

  assert.deepEqual(detail.latestDecisionObservation, {
    observationId: "10000000-0000-4000-8000-000000000098",
    decisionKind: "re_observation",
    observationRevision: 6,
    feedbackRevision: 2,
  });
  assert.equal(
    detail.attempts.some((attempt) => (
      attempt.observationId === detail.latestDecisionObservation.observationId
    )),
    false,
  );

  for (const payload of [
    { ...exactManagerDetail, latestDecisionObservation: undefined },
    {
      ...exactManagerDetail,
      latestDecisionObservation: {
        ...exactManagerDetail.latestDecisionObservation,
        unexpected: true,
      },
    },
  ]) {
    await assert.rejects(
      loadRegistrationObservationManagerDetail(
        captureRpcClient({ result: ok(payload) }),
        { trackId: IDS.track },
      ),
      /registration_observation_manager_detail_invalid/,
    );
  }
});

test("single-attempt detail rejects extra keys and cross-track identity", async () => {
  for (const payload of [
    { ...exactOldAttemptDetail, extra: true },
    { ...exactOldAttemptDetail, observation: { ...exactAttempt, trackId: IDS.class } },
    { ...exactOldAttemptDetail, observation: { ...exactAttempt, taskId: IDS.class } },
  ]) {
    const client = captureRpcClient({ result: ok(payload) });
    await assert.rejects(
      loadRegistrationObservationManagerAttempt(client, {
        trackId: IDS.track,
        observationId: IDS.observation,
      }),
      /registration_observation_manager_attempt_invalid/,
    );
  }
});

test("schema readiness is admin-only service data with an exact cache-miss fallback", async () => {
  const ready = {
    schemaReady: true,
    missingObjects: [],
    runtimeVersion: 0,
  };
  const readyClient = captureRpcClient({ result: ok(ready) });

  assert.deepEqual(await loadRegistrationObservationSchemaReadiness(readyClient), ready);
  assert.deepEqual(readyClient.calls, [{
    name: "registration_observation_schema_readiness_v1",
    args: {},
  }]);
  assert.deepEqual(readyClient.retryArguments, [false]);

  const missingClient = captureRpcClient({ result: {
    data: null,
    error: {
      code: "PGRST202",
      message: "Could not find the function public.registration_observation_schema_readiness_v1 in the schema cache",
    },
  } });
  assert.deepEqual(await loadRegistrationObservationSchemaReadiness(missingClient), {
    schemaReady: false,
    missingObjects: ["registration_observation_schema_readiness_v1"],
    runtimeVersion: 0,
  });

  const unrelated = { code: "PGRST202", message: "Could not find another function" };
  await assert.rejects(
    loadRegistrationObservationSchemaReadiness(captureRpcClient({ result: { data: null, error: unrelated } })),
    (error) => error === unrelated,
  );
});

test("schema readiness rejects malformed exact-key and runtime payloads", async () => {
  for (const payload of [
    { schemaReady: true, missingObjects: [], runtimeVersion: 0, extra: true },
    { schemaReady: "true", missingObjects: [], runtimeVersion: 0 },
    { schemaReady: false, missingObjects: [""], runtimeVersion: 0 },
    { schemaReady: true, missingObjects: [], runtimeVersion: 2 },
  ]) {
    await assert.rejects(
      loadRegistrationObservationSchemaReadiness(captureRpcClient({ result: ok(payload) })),
      /registration_observation_schema_readiness_invalid/,
    );
  }
});

test("activation maps the exact expected version and request key without retry", async () => {
  const response = {
    operation: "activate",
    requestKey: "activate-request-1",
    previousVersion: 0,
    runtimeVersion: 1,
    readiness: { schemaReady: true, missingObjects: [], runtimeVersion: 0 },
  };
  const client = captureRpcClient({ result: ok(response) });

  assert.deepEqual(await activateRegistrationObservationRuntime(client, {
    expectedCurrentVersion: 0,
    requestKey: response.requestKey,
  }), response);
  assert.deepEqual(client.calls[0], {
    name: "activate_registration_observation_runtime_v1",
    args: {
      p_expected_current_version: 0,
      p_request_key: response.requestKey,
    },
  });
  assert.deepEqual(client.retryArguments, [false]);
});

test("mutation maps each conditional revision without retry", async () => {
  const client = captureRpcClient({ result: ok(exactMutation) });

  const { result, timeoutCalls } = await captureTimeout(
    () => saveRegistrationObservationBooking(client, newBookingInput()),
  );

  assert.equal(client.calls[0].args.p_expected_workflow_revision, 7);
  assert.equal(client.calls[0].args.p_expected_appointment_notification_revision, null);
  assert.equal(client.calls[0].args.p_expected_observation_revision, null);
  assert.equal(client.abortSignalTimeoutMs, 12_000);
  assert.deepEqual(timeoutCalls, [12_000]);
  assert.deepEqual(client.retryArguments, [false]);
  assert.deepEqual(result, exactMutation);
});

test("reschedule, cancel, enter, and withdrawal preserve exact RPC revision slots", async () => {
  const responses = {
    save_registration_observation_booking_v1: { ...exactMutation, operation: "reschedule" },
    cancel_registration_observation_v1: {
      ...exactMutation,
      operation: "cancel",
      requestKey: "cancel-request-1",
    },
    enter_registration_observation_v1: {
      ...exactMutation,
      operation: "enter",
      requestKey: "enter-request-1",
      observation: null,
      appointment: null,
    },
    withdraw_registration_observation_v1: {
      ...exactMutation,
      operation: "withdraw",
      requestKey: "withdraw-request-1",
    },
  };
  const client = captureRpcClient({ handler: ({ name }) => ok(responses[name]) });

  await saveRegistrationObservationBooking(client, newBookingInput({
    observationId: IDS.observation,
    expectedWorkflowRevision: null,
    expectedAppointmentNotificationRevision: 4,
    expectedObservationRevision: 6,
  }));
  await cancelRegistrationObservation(client, {
    observationId: IDS.observation,
    expectedAppointmentNotificationRevision: 4,
    expectedObservationRevision: 6,
    requestKey: "cancel-request-1",
  });
  await enterRegistrationObservation(client, {
    trackId: IDS.track,
    expectedWorkflowRevision: 7,
    requestKey: "enter-request-1",
  });
  await withdrawRegistrationObservation(client, {
    trackId: IDS.track,
    exitKind: "director_decision",
    targetWorkflowStatus: "enrollment_requested",
    decisionObservationId: IDS.observation,
    expectedWorkflowRevision: 8,
    expectedDecisionObservationRevision: 6,
    expectedDecisionFeedbackRevision: 2,
    reason: "원장 결정",
    requestKey: "withdraw-request-1",
  });

  assert.deepEqual(client.calls.map((call) => call.name), [
    "save_registration_observation_booking_v1",
    "cancel_registration_observation_v1",
    "enter_registration_observation_v1",
    "withdraw_registration_observation_v1",
  ]);
  assert.deepEqual(client.calls[0].args, {
    p_track_id: IDS.track,
    p_observation_id: IDS.observation,
    p_class_id: IDS.class,
    p_session_authority: "normalized",
    p_class_lesson_session_id: IDS.lesson,
    p_legacy_session_key: null,
    p_expected_workflow_revision: null,
    p_expected_appointment_notification_revision: 4,
    p_expected_observation_revision: 6,
    p_request_key: exactMutation.requestKey,
  });
  assert.deepEqual(client.calls[1].args, {
    p_observation_id: IDS.observation,
    p_expected_appointment_notification_revision: 4,
    p_expected_observation_revision: 6,
    p_request_key: "cancel-request-1",
  });
  assert.deepEqual(client.calls[2].args, {
    p_track_id: IDS.track,
    p_expected_workflow_revision: 7,
    p_request_key: "enter-request-1",
  });
  assert.deepEqual(client.calls[3].args, {
    p_track_id: IDS.track,
    p_exit_kind: "director_decision",
    p_target_workflow_status: "enrollment_requested",
    p_decision_observation_id: IDS.observation,
    p_expected_workflow_revision: 8,
    p_expected_decision_observation_revision: 6,
    p_expected_decision_feedback_revision: 2,
    p_reason: "원장 결정",
    p_request_key: "withdraw-request-1",
  });
  assert.deepEqual(client.retryArguments, [false, false, false, false]);
});

test("booking source and revision unions fail closed before an RPC", async () => {
  const client = captureRpcClient({ result: ok(exactMutation) });
  const invalidInputs = [
    newBookingInput({ classLessonSessionId: null }),
    newBookingInput({ legacySessionKey: "legacy-key" }),
    newBookingInput({ expectedAppointmentNotificationRevision: 1 }),
    newBookingInput({ observationId: IDS.observation }),
    newBookingInput({
      sessionAuthority: "legacy",
      classLessonSessionId: null,
      legacySessionKey: "",
    }),
  ];

  for (const input of invalidInputs) {
    await assert.rejects(
      saveRegistrationObservationBooking(client, input),
      /registration_observation_booking_input_invalid/,
    );
  }
  assert.equal(client.calls.length, 0);
});

test("mutation normalizer rejects appointment time that contradicts the observation", () => {
  assert.throws(
    () => normalizeRegistrationObservationMutationResult({
      ...exactMutation,
      appointment: {
        ...exactMutation.appointment,
        scheduledAt: "2026-08-12T09:30:00.000Z",
      },
    }),
    /registration_observation_mutation_result_invalid/,
  );
});

test("mutation normalizer rejects appointment place that contradicts the observation", () => {
  assert.throws(
    () => normalizeRegistrationObservationMutationResult({
      ...exactMutation,
      appointment: { ...exactMutation.appointment, place: "별관" },
    }),
    /registration_observation_mutation_result_invalid/,
  );
});

test("malformed mutation snapshots do not advance the session generation", async () => {
  const sessionPending = deferred();
  let sessionCalls = 0;
  let mutationCalls = 0;
  const malformedMutations = [
    { ...exactMutation, extra: true },
    {
      ...exactMutation,
      appointment: {
        ...exactMutation.appointment,
        scheduledAt: "2026-08-12T09:30:00.000Z",
      },
    },
    {
      ...exactMutation,
      appointment: { ...exactMutation.appointment, place: "별관" },
    },
  ];
  const client = captureRpcClient({ handler: ({ name }) => {
    if (name === "list_registration_observation_sessions_v1") {
      sessionCalls += 1;
      return sessionPending.promise;
    }
    mutationCalls += 1;
    return ok(malformedMutations[mutationCalls - 1] ?? exactMutation);
  } });
  const input = {
    trackId: IDS.track,
    classId: IDS.class,
    dateFrom: "2026-08-11",
    dateTo: "2026-08-20",
  };
  const first = loadRegistrationObservationSessions(client, input);

  for (let index = 0; index < malformedMutations.length; index += 1) {
    await assert.rejects(
      saveRegistrationObservationBooking(client, newBookingInput()),
      /registration_observation_mutation_result_invalid/,
    );
    assert.strictEqual(loadRegistrationObservationSessions(client, input), first);
    assert.equal(sessionCalls, 1);
    assert.equal(mutationCalls, index + 1);
  }

  await saveRegistrationObservationBooking(client, newBookingInput());
  const afterSuccess = loadRegistrationObservationSessions(client, input);
  assert.notStrictEqual(afterSuccess, first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionCalls, 2);

  sessionPending.resolve(ok([exactNormalizedSession]));
  assert.deepEqual(await first, [exactNormalizedSession]);
  assert.deepEqual(await afterSuccess, [exactNormalizedSession]);
});

test("RPC errors propagate unchanged and never become successful payloads", async () => {
  const databaseError = { code: "40001", message: "registration_observation_refresh_required" };
  const client = captureRpcClient({ result: { data: null, error: databaseError } });

  await assert.rejects(
    enterRegistrationObservation(client, {
      trackId: IDS.track,
      expectedWorkflowRevision: 7,
      requestKey: "enter-request-error",
    }),
    (error) => error === databaseError,
  );
});

test("feedback detail normalizer rejects exact-key, lifecycle, source, revision, and proxy tuple mutations", () => {
  assert.deepEqual(normalizeRegistrationObservationFeedbackDetail(exactFeedback), exactFeedback);
  assert.deepEqual(normalizeRegistrationObservationFeedbackDetail(exactLegacyFeedback), exactLegacyFeedback);

  const invalidPayloads = [
    { ...exactFeedback, unexpected: true },
    Object.fromEntries(Object.entries(exactFeedback).filter(([key]) => key !== "sessionKey")),
    { ...exactFeedback, status: "feedback_saved" },
    { ...exactFeedback, revision: 0 },
    { ...exactFeedback, feedbackRevision: -1 },
    { ...exactFeedback, trackWorkflowRevision: 1.5 },
    { ...exactFeedback, classLessonSessionId: IDS.class },
    { ...exactLegacyFeedback, sessionKey: "different-legacy-key" },
    { ...exactFeedback, feedbackSubmittedAt: "2026-08-12 10:05" },
    { ...exactFeedback, feedbackSubmittedByName: null },
    { ...exactFeedback, proxySubmitted: false, feedbackSubmittedAt: null },
    {
      ...exactFeedback,
      status: "scheduled",
      attendance: "attended",
      suitabilityResult: null,
      feedbackReason: null,
      proxySubmitted: false,
      feedbackSubmittedByName: null,
      feedbackSubmittedAt: null,
    },
    {
      ...exactFeedback,
      status: "no_show",
      attendance: "no_show",
      suitabilityResult: "fit",
      feedbackReason: null,
    },
    {
      ...exactFeedback,
      status: "scheduled",
      attendance: null,
      suitabilityResult: null,
      feedbackReason: null,
      proxySubmitted: false,
      feedbackSubmittedByName: null,
      feedbackSubmittedAt: null,
      decisionKind: "not_registered",
    },
  ];

  for (const payload of invalidPayloads) {
    assert.throws(
      () => normalizeRegistrationObservationFeedbackDetail(payload),
      /registration_observation_feedback_detail_invalid/,
    );
  }
});

test("feedback read caches one in-flight and settled generation until an explicit force refresh", async () => {
  const firstResponse = deferred();
  let rpcCalls = 0;
  const refreshed = { ...exactFeedback, feedbackRevision: 2 };
  const client = captureRpcClient({ handler: () => {
    rpcCalls += 1;
    return rpcCalls === 1 ? firstResponse.promise : ok(refreshed);
  } });

  const { result: pending, timeoutCalls } = await captureTimeout(async () => {
    const first = loadRegistrationObservationFeedback(client, IDS.observation);
    const duplicate = loadRegistrationObservationFeedback(client, IDS.observation);
    assert.strictEqual(duplicate, first);
    assert.equal(client.calls.length, 1);
    firstResponse.resolve(ok(exactFeedback));
    assert.deepEqual(await first, exactFeedback);
    const settled = loadRegistrationObservationFeedback(client, IDS.observation);
    assert.strictEqual(settled, first);
    assert.deepEqual(await settled, exactFeedback);
    return loadRegistrationObservationFeedback(client, IDS.observation, { force: true });
  });

  assert.deepEqual(await pending, refreshed);
  assert.equal(rpcCalls, 2);
  assert.deepEqual(client.calls, [
    {
      name: "get_registration_observation_feedback_v1",
      args: { p_observation_id: IDS.observation },
    },
    {
      name: "get_registration_observation_feedback_v1",
      args: { p_observation_id: IDS.observation },
    },
  ]);
  assert.deepEqual(timeoutCalls, [12_000, 12_000]);
  assert.deepEqual(client.retryArguments, [false, false]);
});

test("feedback settled cache is actor-session scoped so an account switch must recheck the read RPC", async () => {
  let actorId = "10000000-0000-4000-8000-000000000020";
  const denied = { code: "P0002", message: "registration_observation_not_found" };
  const client = captureRpcClient({ handler: () => (
    actorId.endsWith("20") ? ok(exactFeedback) : { data: null, error: denied }
  ) });
  client.auth = {
    async getSession() {
      return {
        data: {
          session: {
            access_token: `session-${actorId}`,
            user: { id: actorId },
          },
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await loadRegistrationObservationFeedback(client, IDS.observation),
    exactFeedback,
  );
  actorId = "10000000-0000-4000-8000-000000000021";
  await assert.rejects(
    loadRegistrationObservationFeedback(client, IDS.observation),
    (error) => error === denied,
  );
  assert.equal(client.calls.length, 2);
});

test("force refresh invalidates a settled feedback failure without sharing the rejected generation", async () => {
  const databaseError = { code: "57014", message: "statement timeout" };
  let rpcCalls = 0;
  const client = captureRpcClient({ handler: () => {
    rpcCalls += 1;
    return rpcCalls === 1 ? { data: null, error: databaseError } : ok(exactFeedback);
  } });

  const failed = loadRegistrationObservationFeedback(client, IDS.observation);
  await assert.rejects(failed, (error) => error === databaseError);
  const sameFailure = loadRegistrationObservationFeedback(client, IDS.observation);
  assert.strictEqual(sameFailure, failed);
  await assert.rejects(sameFailure, (error) => error === databaseError);
  assert.deepEqual(
    await loadRegistrationObservationFeedback(client, IDS.observation, { force: true }),
    exactFeedback,
  );
  assert.equal(rpcCalls, 2);
});

test("feedback mutation clients map every conditional revision and disable automatic retry", async () => {
  const attendanceDetail = {
    ...exactFeedback,
    status: "attended_feedback_pending",
    attendance: "attended",
    suitabilityResult: null,
    feedbackReason: null,
    proxySubmitted: false,
    feedbackSubmittedByName: null,
    feedbackSubmittedAt: null,
    feedbackRevision: 0,
  };
  const correctedDetail = { ...exactFeedback, feedbackRevision: 2 };
  const decidedDetail = {
    ...correctedDetail,
    decisionKind: "not_registered",
    revision: 3,
    trackWorkflowRevision: 10,
  };
  const feedbackReads = [attendanceDetail, exactFeedback, correctedDetail, decidedDetail];
  let feedbackReadIndex = 0;
  const mutationResponses = {
    record_registration_observation_attendance_v1: feedbackMutationEnvelope(
      "record_attendance",
      "attendance-request-1",
      attendanceDetail,
    ),
    submit_registration_observation_feedback_v1: feedbackMutationEnvelope(
      "submit_feedback",
      "feedback-request-1",
      exactFeedback,
    ),
    correct_registration_observation_feedback_v1: feedbackMutationEnvelope(
      "correct_feedback",
      "correction-request-1",
      correctedDetail,
    ),
    decide_registration_observation_v1: feedbackMutationEnvelope(
      "decide",
      "decision-request-1",
      decidedDetail,
    ),
  };
  const client = captureRpcClient({ handler: ({ name }) => {
    if (name === "get_registration_observation_feedback_v1") {
      return ok(feedbackReads[feedbackReadIndex++]);
    }
    return ok(mutationResponses[name]);
  } });

  assert.deepEqual(await recordRegistrationObservationAttendance(client, {
    observationId: IDS.observation,
    expectedObservationRevision: 1,
    expectedAppointmentNotificationRevision: 1,
    requestKey: "attendance-request-1",
  }), attendanceDetail);
  assert.deepEqual(await submitRegistrationObservationFeedback(client, {
    observationId: IDS.observation,
    attendance: "attended",
    suitabilityResult: "fit",
    feedbackReason: "수업 참여와 이해도가 좋습니다.",
    expectedObservationRevision: 2,
    expectedFeedbackRevision: 0,
    expectedAppointmentNotificationRevision: 1,
    requestKey: "feedback-request-1",
  }), exactFeedback);
  assert.deepEqual(await correctRegistrationObservationFeedback(client, {
    observationId: IDS.observation,
    suitabilityResult: "fit",
    feedbackReason: "수업 참여와 이해도가 매우 좋습니다.",
    correctionReason: "표현 보완",
    expectedObservationRevision: 2,
    expectedFeedbackRevision: 1,
    expectedDecisionKind: "",
    requestKey: "correction-request-1",
  }), correctedDetail);
  assert.deepEqual(await decideRegistrationObservation(client, {
    observationId: IDS.observation,
    decisionKind: "not_registered",
    waitingClassId: null,
    expectedObservationRevision: 2,
    expectedFeedbackRevision: 2,
    expectedTrackWorkflowRevision: 9,
    requestKey: "decision-request-1",
  }), decidedDetail);

  assert.deepEqual(client.calls.filter(
    ({ name }) => name !== "get_registration_observation_feedback_v1",
  ), [
    {
      name: "record_registration_observation_attendance_v1",
      args: {
        p_observation_id: IDS.observation,
        p_expected_observation_revision: 1,
        p_expected_appointment_notification_revision: 1,
        p_request_key: "attendance-request-1",
      },
    },
    {
      name: "submit_registration_observation_feedback_v1",
      args: {
        p_observation_id: IDS.observation,
        p_attendance: "attended",
        p_suitability_result: "fit",
        p_feedback_reason: "수업 참여와 이해도가 좋습니다.",
        p_expected_observation_revision: 2,
        p_expected_feedback_revision: 0,
        p_expected_appointment_notification_revision: 1,
        p_request_key: "feedback-request-1",
      },
    },
    {
      name: "correct_registration_observation_feedback_v1",
      args: {
        p_observation_id: IDS.observation,
        p_suitability_result: "fit",
        p_feedback_reason: "수업 참여와 이해도가 매우 좋습니다.",
        p_correction_reason: "표현 보완",
        p_expected_observation_revision: 2,
        p_expected_feedback_revision: 1,
        p_expected_decision_kind: null,
        p_request_key: "correction-request-1",
      },
    },
    {
      name: "decide_registration_observation_v1",
      args: {
        p_observation_id: IDS.observation,
        p_decision_kind: "not_registered",
        p_waiting_class_id: null,
        p_expected_observation_revision: 2,
        p_expected_feedback_revision: 2,
        p_expected_track_workflow_revision: 9,
        p_request_key: "decision-request-1",
      },
    },
  ]);
  assert.equal(
    client.calls.filter(({ name }) => name === "get_registration_observation_feedback_v1").length,
    4,
  );
  assert.deepEqual(client.retryArguments, Array(8).fill(false));
});

test("malformed feedback mutation responses do not replace a settled detail generation", async () => {
  let readResponse = exactFeedback;
  const client = captureRpcClient({ handler: ({ name }) => {
    if (name === "correct_registration_observation_feedback_v1") {
      return ok(feedbackMutationEnvelope(
        "correct_feedback",
        "malformed-correction-request",
        { ...exactFeedback, feedbackRevision: 2 },
      ));
    }
    return ok(readResponse);
  } });
  const settled = loadRegistrationObservationFeedback(client, IDS.observation);
  assert.deepEqual(await settled, exactFeedback);

  readResponse = { ...exactFeedback, feedbackRevision: -1 };
  await assert.rejects(
    correctRegistrationObservationFeedback(client, {
      observationId: IDS.observation,
      suitabilityResult: "fit",
      feedbackReason: "수업 참여와 이해도가 좋습니다.",
      correctionReason: "표현 보완",
      expectedObservationRevision: 2,
      expectedFeedbackRevision: 1,
      expectedDecisionKind: null,
      requestKey: "malformed-correction-request",
    }),
    /registration_observation_feedback_detail_invalid/,
  );
  assert.strictEqual(loadRegistrationObservationFeedback(client, IDS.observation), settled);
});
