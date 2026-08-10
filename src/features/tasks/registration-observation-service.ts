import {
  normalizeRegistrationObservationActivationResult,
  normalizeRegistrationObservationManagerAttemptDetail,
  normalizeRegistrationObservationManagerDetail,
  normalizeRegistrationObservationMutationResult,
  normalizeRegistrationObservationSchemaReadiness,
  normalizeRegistrationObservationSessionOptions,
  type RegistrationObservationActivationResult,
  type RegistrationObservationManagerAttemptDetail,
  type RegistrationObservationManagerDetail,
  type RegistrationObservationMutationResult,
  type RegistrationObservationSchemaReadiness,
  type RegistrationObservationSessionAuthority,
  type RegistrationObservationSessionOption,
  type RegistrationObservationTrackWorkflowStatus,
} from "./registration-observation-model.ts"
import {
  loadRegistrationSubjectTrackFixtureObservationClient,
} from "./registration-track-fixture-runtime.ts"
import {
  isRegistrationObservationFunctionMissing,
  type RegistrationObservationRpcRequest,
  type RegistrationObservationRpcResult,
} from "./registration-observation-runtime-probe.ts"

export type RegistrationObservationClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => RegistrationObservationRpcRequest
}

export type LoadRegistrationObservationManagerDetailInput = Readonly<{
  trackId: string
  attemptLimit?: number
}>

export type LoadRegistrationObservationManagerAttemptInput = Readonly<{
  trackId: string
  observationId: string
}>

export type LoadRegistrationObservationSessionsInput = Readonly<{
  trackId: string
  classId: string
  dateFrom: string
  dateTo: string
}>

export type ActivateRegistrationObservationRuntimeInput = Readonly<{
  expectedCurrentVersion: 0
  requestKey: string
}>

export type EnterRegistrationObservationInput = Readonly<{
  trackId: string
  expectedWorkflowRevision: number
  requestKey: string
}>

type RegistrationObservationBookingSessionInput =
  | Readonly<{
      sessionAuthority: "normalized"
      classLessonSessionId: string
      legacySessionKey: null
    }>
  | Readonly<{
      sessionAuthority: "legacy"
      classLessonSessionId: null
      legacySessionKey: string
    }>

type RegistrationObservationNewBookingRevisionInput = Readonly<{
  observationId: null
  expectedWorkflowRevision: number
  expectedAppointmentNotificationRevision: null
  expectedObservationRevision: null
}>

type RegistrationObservationRescheduleRevisionInput = Readonly<{
  observationId: string
  expectedWorkflowRevision: null
  expectedAppointmentNotificationRevision: number
  expectedObservationRevision: number
}>

export type SaveRegistrationObservationBookingInput = Readonly<{
  trackId: string
  classId: string
  requestKey: string
} & RegistrationObservationBookingSessionInput & (
  RegistrationObservationNewBookingRevisionInput
  | RegistrationObservationRescheduleRevisionInput
)>

export type CancelRegistrationObservationInput = Readonly<{
  observationId: string
  expectedAppointmentNotificationRevision: number
  expectedObservationRevision: number
  requestKey: string
}>

type RegistrationObservationReturnInput = Readonly<{
  exitKind: "return_to_previous"
  targetWorkflowStatus:
    | "consultation_completed"
    | "waiting_current_class"
    | "waiting_new_class"
    | "waiting_next_opening"
  decisionObservationId: null
  expectedDecisionObservationRevision: null
  expectedDecisionFeedbackRevision: null
}>

type RegistrationObservationDirectorDecisionInput = Readonly<{
  exitKind: "director_decision"
  targetWorkflowStatus:
    | "enrollment_requested"
    | "waiting_current_class"
    | "waiting_new_class"
    | "waiting_next_opening"
    | "not_registered"
  decisionObservationId: string | null
  expectedDecisionObservationRevision: number | null
  expectedDecisionFeedbackRevision: number | null
}>

export type WithdrawRegistrationObservationInput = Readonly<{
  trackId: string
  expectedWorkflowRevision: number
  reason: string
  requestKey: string
} & (RegistrationObservationReturnInput | RegistrationObservationDirectorDecisionInput)>

const REQUEST_TIMEOUT_MS = 12_000
const DEFAULT_ATTEMPT_LIMIT = 20
const MAX_ATTEMPT_LIMIT = 50
const SCHEMA_READINESS_RPC = "registration_observation_schema_readiness_v1"
const WORKFLOW_STATUSES: readonly RegistrationObservationTrackWorkflowStatus[] = [
  "inquiry",
  "level_test_requested",
  "consultation_requested",
  "consultation_completed",
  "waiting_current_class",
  "waiting_new_class",
  "waiting_next_opening",
  "observation_requested",
  "observation_feedback_pending",
  "observation_completed",
  "enrollment_requested",
  "payment_in_progress",
  "registered",
  "not_registered",
  "inquiry_only",
]

const sessionInFlight = new Map<string, Promise<readonly RegistrationObservationSessionOption[]>>()
const clientIds = new WeakMap<object, number>()
let nextClientId = 1
let cacheGeneration = 0

function inputInvalid(scope: string): never {
  throw new Error(`registration_observation_${scope}_input_invalid`)
}

function exactInput(
  input: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
  scope: string,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) inputInvalid(scope)
  const row = input as Record<string, unknown>
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  if (
    Object.keys(row).some((key) => !allowed.has(key))
    || requiredKeys.some((key) => !(key in row))
  ) inputInvalid(scope)
  return row
}

function uuid(input: unknown, scope: string) {
  if (
    typeof input !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
  ) inputInvalid(scope)
  return input
}

function nonblank(input: unknown, scope: string) {
  if (typeof input !== "string" || input.trim().length === 0) inputInvalid(scope)
  return input
}

function positiveRevision(input: unknown, scope: string) {
  if (!Number.isFinite(input) || !Number.isInteger(input) || Number(input) < 1) inputInvalid(scope)
  return Number(input)
}

function nonnegativeRevision(input: unknown, scope: string) {
  if (!Number.isFinite(input) || !Number.isInteger(input) || Number(input) < 0) inputInvalid(scope)
  return Number(input)
}

function dateValue(input: unknown, scope: string) {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) inputInvalid(scope)
  const [year, month, day] = input.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) inputInvalid(scope)
  return input
}

function activeClient(client: RegistrationObservationClient) {
  return loadRegistrationSubjectTrackFixtureObservationClient() || client
}

function clientId(client: RegistrationObservationClient) {
  const existing = clientIds.get(client)
  if (existing) return existing
  const next = nextClientId
  nextClientId += 1
  clientIds.set(client, next)
  return next
}

function executeRequest(request: RegistrationObservationRpcRequest) {
  return request
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS))
    .retry(false)
}

async function rpcResult(
  client: RegistrationObservationClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<RegistrationObservationRpcResult> {
  return executeRequest(activeClient(client).rpc(name, args))
}

function mutationIdentity(
  result: RegistrationObservationMutationResult,
  expected: {
    operation: RegistrationObservationMutationResult["operation"]
    requestKey: string
    trackId?: string
    observationId?: string
  },
) {
  if (
    result.operation !== expected.operation
    || result.requestKey !== expected.requestKey
    || (expected.trackId !== undefined && result.trackId !== expected.trackId)
    || (
      expected.observationId !== undefined
      && result.observation?.observationId !== expected.observationId
    )
  ) throw new Error("registration_observation_mutation_result_invalid")
  return result
}

async function mutationRpc(
  client: RegistrationObservationClient,
  name: string,
  args: Record<string, unknown>,
  expected: Parameters<typeof mutationIdentity>[1],
) {
  const { data, error } = await rpcResult(client, name, args)
  if (error) throw error
  const normalized = mutationIdentity(
    normalizeRegistrationObservationMutationResult(data),
    expected,
  )
  cacheGeneration += 1
  return normalized
}

export async function loadRegistrationObservationSchemaReadiness(
  client: RegistrationObservationClient,
): Promise<RegistrationObservationSchemaReadiness> {
  const { data, error } = await rpcResult(client, SCHEMA_READINESS_RPC)
  if (error) {
    if (isRegistrationObservationFunctionMissing(error, SCHEMA_READINESS_RPC)) {
      return {
        schemaReady: false,
        missingObjects: [SCHEMA_READINESS_RPC],
        runtimeVersion: 0,
      }
    }
    throw error
  }
  return normalizeRegistrationObservationSchemaReadiness(data)
}

export async function loadRegistrationObservationManagerDetail(
  client: RegistrationObservationClient,
  input: LoadRegistrationObservationManagerDetailInput,
): Promise<RegistrationObservationManagerDetail> {
  const row = exactInput(input, ["trackId"], ["attemptLimit"], "manager_detail")
  const trackId = uuid(row.trackId, "manager_detail")
  const attemptLimit = row.attemptLimit === undefined
    ? DEFAULT_ATTEMPT_LIMIT
    : positiveRevision(row.attemptLimit, "manager_detail")
  if (attemptLimit > MAX_ATTEMPT_LIMIT) inputInvalid("manager_detail")
  const { data, error } = await rpcResult(
    client,
    "get_registration_observation_manager_detail_v1",
    { p_track_id: trackId, p_attempt_limit: attemptLimit },
  )
  if (error) throw error
  const result = normalizeRegistrationObservationManagerDetail(data)
  if (result.track.trackId !== trackId) {
    throw new Error("registration_observation_manager_detail_invalid")
  }
  return result
}

export async function loadRegistrationObservationManagerAttempt(
  client: RegistrationObservationClient,
  input: LoadRegistrationObservationManagerAttemptInput,
): Promise<RegistrationObservationManagerAttemptDetail> {
  const row = exactInput(input, ["trackId", "observationId"], [], "manager_attempt")
  const trackId = uuid(row.trackId, "manager_attempt")
  const observationId = uuid(row.observationId, "manager_attempt")
  const { data, error } = await rpcResult(
    client,
    "get_registration_observation_manager_attempt_v1",
    { p_track_id: trackId, p_observation_id: observationId },
  )
  if (error) throw error
  const result = normalizeRegistrationObservationManagerAttemptDetail(data)
  if (
    result.trackId !== trackId
    || result.observation.observationId !== observationId
  ) throw new Error("registration_observation_manager_attempt_invalid")
  return result
}

export function loadRegistrationObservationSessions(
  client: RegistrationObservationClient,
  input: LoadRegistrationObservationSessionsInput,
): Promise<readonly RegistrationObservationSessionOption[]> {
  let row: Record<string, unknown>
  let trackId: string
  let classId: string
  let dateFrom: string
  let dateTo: string
  try {
    row = exactInput(input, ["trackId", "classId", "dateFrom", "dateTo"], [], "sessions")
    trackId = uuid(row.trackId, "sessions")
    classId = uuid(row.classId, "sessions")
    dateFrom = dateValue(row.dateFrom, "sessions")
    dateTo = dateValue(row.dateTo, "sessions")
    if (dateFrom > dateTo) inputInvalid("sessions")
  } catch (error) {
    return Promise.reject(error)
  }
  const resolvedClient = activeClient(client)
  const key = [clientId(resolvedClient), cacheGeneration, trackId, classId, dateFrom, dateTo].join(":")
  const pending = sessionInFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    const { data, error } = await executeRequest(resolvedClient.rpc(
      "list_registration_observation_sessions_v1",
      {
        p_track_id: trackId,
        p_class_id: classId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      },
    ))
    if (error) throw error
    const sessions = normalizeRegistrationObservationSessionOptions(data)
    if (sessions.some((session) => (
      session.classId !== classId
      || session.sessionDate < dateFrom
      || session.sessionDate > dateTo
    ))) throw new Error("registration_observation_session_options_invalid")
    return sessions
  })().finally(() => {
    if (sessionInFlight.get(key) === request) sessionInFlight.delete(key)
  })
  sessionInFlight.set(key, request)
  return request
}

export async function activateRegistrationObservationRuntime(
  client: RegistrationObservationClient,
  input: ActivateRegistrationObservationRuntimeInput,
): Promise<RegistrationObservationActivationResult> {
  const row = exactInput(input, ["expectedCurrentVersion", "requestKey"], [], "activation")
  if (row.expectedCurrentVersion !== 0) inputInvalid("activation")
  const requestKey = nonblank(row.requestKey, "activation")
  const { data, error } = await rpcResult(
    client,
    "activate_registration_observation_runtime_v1",
    { p_expected_current_version: 0, p_request_key: requestKey },
  )
  if (error) throw error
  const result = normalizeRegistrationObservationActivationResult(data)
  if (result.requestKey !== requestKey) {
    throw new Error("registration_observation_activation_result_invalid")
  }
  cacheGeneration += 1
  return result
}

export async function enterRegistrationObservation(
  client: RegistrationObservationClient,
  input: EnterRegistrationObservationInput,
) {
  const row = exactInput(input, ["trackId", "expectedWorkflowRevision", "requestKey"], [], "enter")
  const trackId = uuid(row.trackId, "enter")
  const expectedWorkflowRevision = positiveRevision(row.expectedWorkflowRevision, "enter")
  const requestKey = nonblank(row.requestKey, "enter")
  return mutationRpc(client, "enter_registration_observation_v1", {
    p_track_id: trackId,
    p_expected_workflow_revision: expectedWorkflowRevision,
    p_request_key: requestKey,
  }, { operation: "enter", requestKey, trackId })
}

export async function saveRegistrationObservationBooking(
  client: RegistrationObservationClient,
  input: SaveRegistrationObservationBookingInput,
) {
  const row = exactInput(input, [
    "trackId",
    "observationId",
    "classId",
    "sessionAuthority",
    "classLessonSessionId",
    "legacySessionKey",
    "expectedWorkflowRevision",
    "expectedAppointmentNotificationRevision",
    "expectedObservationRevision",
    "requestKey",
  ], [], "booking")
  const trackId = uuid(row.trackId, "booking")
  const classId = uuid(row.classId, "booking")
  const requestKey = nonblank(row.requestKey, "booking")
  const sessionAuthority = row.sessionAuthority as RegistrationObservationSessionAuthority
  let classLessonSessionId: string | null
  let legacySessionKey: string | null
  if (sessionAuthority === "normalized") {
    classLessonSessionId = uuid(row.classLessonSessionId, "booking")
    if (row.legacySessionKey !== null) inputInvalid("booking")
    legacySessionKey = null
  } else if (sessionAuthority === "legacy") {
    if (row.classLessonSessionId !== null) inputInvalid("booking")
    classLessonSessionId = null
    legacySessionKey = nonblank(row.legacySessionKey, "booking")
  } else {
    inputInvalid("booking")
  }

  let observationId: string | null
  let expectedWorkflowRevision: number | null
  let expectedAppointmentNotificationRevision: number | null
  let expectedObservationRevision: number | null
  let operation: "book" | "reschedule"
  if (row.observationId === null) {
    observationId = null
    expectedWorkflowRevision = positiveRevision(row.expectedWorkflowRevision, "booking")
    if (
      row.expectedAppointmentNotificationRevision !== null
      || row.expectedObservationRevision !== null
    ) inputInvalid("booking")
    expectedAppointmentNotificationRevision = null
    expectedObservationRevision = null
    operation = "book"
  } else {
    observationId = uuid(row.observationId, "booking")
    if (row.expectedWorkflowRevision !== null) inputInvalid("booking")
    expectedWorkflowRevision = null
    expectedAppointmentNotificationRevision = positiveRevision(
      row.expectedAppointmentNotificationRevision,
      "booking",
    )
    expectedObservationRevision = positiveRevision(row.expectedObservationRevision, "booking")
    operation = "reschedule"
  }

  return mutationRpc(client, "save_registration_observation_booking_v1", {
    p_track_id: trackId,
    p_observation_id: observationId,
    p_class_id: classId,
    p_session_authority: sessionAuthority,
    p_class_lesson_session_id: classLessonSessionId,
    p_legacy_session_key: legacySessionKey,
    p_expected_workflow_revision: expectedWorkflowRevision,
    p_expected_appointment_notification_revision: expectedAppointmentNotificationRevision,
    p_expected_observation_revision: expectedObservationRevision,
    p_request_key: requestKey,
  }, {
    operation,
    requestKey,
    trackId,
    ...(observationId ? { observationId } : {}),
  })
}

export async function cancelRegistrationObservation(
  client: RegistrationObservationClient,
  input: CancelRegistrationObservationInput,
) {
  const row = exactInput(input, [
    "observationId",
    "expectedAppointmentNotificationRevision",
    "expectedObservationRevision",
    "requestKey",
  ], [], "cancel")
  const observationId = uuid(row.observationId, "cancel")
  const expectedAppointmentNotificationRevision = positiveRevision(
    row.expectedAppointmentNotificationRevision,
    "cancel",
  )
  const expectedObservationRevision = positiveRevision(row.expectedObservationRevision, "cancel")
  const requestKey = nonblank(row.requestKey, "cancel")
  return mutationRpc(client, "cancel_registration_observation_v1", {
    p_observation_id: observationId,
    p_expected_appointment_notification_revision: expectedAppointmentNotificationRevision,
    p_expected_observation_revision: expectedObservationRevision,
    p_request_key: requestKey,
  }, { operation: "cancel", requestKey, observationId })
}

export async function withdrawRegistrationObservation(
  client: RegistrationObservationClient,
  input: WithdrawRegistrationObservationInput,
) {
  const row = exactInput(input, [
    "trackId",
    "exitKind",
    "targetWorkflowStatus",
    "decisionObservationId",
    "expectedWorkflowRevision",
    "expectedDecisionObservationRevision",
    "expectedDecisionFeedbackRevision",
    "reason",
    "requestKey",
  ], [], "withdraw")
  const trackId = uuid(row.trackId, "withdraw")
  const expectedWorkflowRevision = positiveRevision(row.expectedWorkflowRevision, "withdraw")
  const requestKey = nonblank(row.requestKey, "withdraw")
  if (typeof row.reason !== "string") inputInvalid("withdraw")
  const reason = row.reason
  if (!WORKFLOW_STATUSES.includes(row.targetWorkflowStatus as RegistrationObservationTrackWorkflowStatus)) {
    inputInvalid("withdraw")
  }
  const targetWorkflowStatus = row.targetWorkflowStatus as RegistrationObservationTrackWorkflowStatus
  let decisionObservationId: string | null
  let expectedDecisionObservationRevision: number | null
  let expectedDecisionFeedbackRevision: number | null
  if (row.exitKind === "return_to_previous") {
    if (
      ![
        "consultation_completed",
        "waiting_current_class",
        "waiting_new_class",
        "waiting_next_opening",
      ].includes(targetWorkflowStatus)
      || row.decisionObservationId !== null
      || row.expectedDecisionObservationRevision !== null
      || row.expectedDecisionFeedbackRevision !== null
    ) inputInvalid("withdraw")
    decisionObservationId = null
    expectedDecisionObservationRevision = null
    expectedDecisionFeedbackRevision = null
  } else if (row.exitKind === "director_decision") {
    if (![
      "enrollment_requested",
      "waiting_current_class",
      "waiting_new_class",
      "waiting_next_opening",
      "not_registered",
    ].includes(targetWorkflowStatus)) inputInvalid("withdraw")
    const allNull = row.decisionObservationId === null
      && row.expectedDecisionObservationRevision === null
      && row.expectedDecisionFeedbackRevision === null
    const allPresent = row.decisionObservationId !== null
      && row.expectedDecisionObservationRevision !== null
      && row.expectedDecisionFeedbackRevision !== null
    if (!allNull && !allPresent) inputInvalid("withdraw")
    decisionObservationId = allPresent ? uuid(row.decisionObservationId, "withdraw") : null
    expectedDecisionObservationRevision = allPresent
      ? positiveRevision(row.expectedDecisionObservationRevision, "withdraw")
      : null
    expectedDecisionFeedbackRevision = allPresent
      ? nonnegativeRevision(row.expectedDecisionFeedbackRevision, "withdraw")
      : null
  } else {
    inputInvalid("withdraw")
  }
  return mutationRpc(client, "withdraw_registration_observation_v1", {
    p_track_id: trackId,
    p_exit_kind: row.exitKind,
    p_target_workflow_status: targetWorkflowStatus,
    p_decision_observation_id: decisionObservationId,
    p_expected_workflow_revision: expectedWorkflowRevision,
    p_expected_decision_observation_revision: expectedDecisionObservationRevision,
    p_expected_decision_feedback_revision: expectedDecisionFeedbackRevision,
    p_reason: reason,
    p_request_key: requestKey,
  }, { operation: "withdraw", requestKey, trackId })
}
