import {
  normalizeRegistrationObservationActivationResult,
  normalizeRegistrationObservationFeedbackDetail,
  normalizeRegistrationObservationManagerAttemptDetail,
  normalizeRegistrationObservationManagerDetail,
  normalizeRegistrationObservationMutationResult,
  normalizeRegistrationObservationSchemaReadiness,
  normalizeRegistrationObservationSessionOptions,
  type RegistrationObservationActivationResult,
  type RegistrationObservationDecisionKind,
  type RegistrationObservationFeedbackDetail,
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
  auth?: {
    getSession: () => PromiseLike<{
      data: {
        session: {
          access_token?: unknown
          user?: { id?: unknown }
        } | null
      }
      error: unknown
    }>
    onAuthStateChange?: (
      callback: (event: string, session: unknown) => void,
    ) => unknown
  }
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

export type LoadRegistrationObservationFeedbackOptions = Readonly<{
  timeoutMs?: number
  force?: boolean
}>

export type RecordRegistrationObservationAttendanceInput = Readonly<{
  observationId: string
  expectedObservationRevision: number
  expectedAppointmentNotificationRevision: number
  requestKey: string
}>

export type SubmitRegistrationObservationFeedbackInput = Readonly<{
  observationId: string
  attendance: "attended" | "no_show"
  suitabilityResult: "fit" | "unfit" | null
  feedbackReason: string | null
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedAppointmentNotificationRevision: number
  requestKey: string
}>

export type CorrectRegistrationObservationFeedbackInput = Readonly<{
  observationId: string
  suitabilityResult: "fit" | "unfit"
  feedbackReason: string
  correctionReason: string
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedDecisionKind: RegistrationObservationDecisionKind | null | ""
  requestKey: string
}>

export type DecideRegistrationObservationInput = Readonly<{
  observationId: string
  decisionKind: RegistrationObservationDecisionKind
  waitingClassId: string | null
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedTrackWorkflowRevision: number
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
type FeedbackCacheEntry = Readonly<{
  generation: number
  promise: Promise<RegistrationObservationFeedbackDetail>
}>
type FeedbackMutationOperation =
  | "record_attendance"
  | "submit_feedback"
  | "correct_feedback"
  | "decide"
type FeedbackDetailValidator = (
  detail: RegistrationObservationFeedbackDetail,
) => void
type FeedbackSessionScope = Readonly<{
  identity: string
  epoch: number
}>
type FeedbackAuthState = {
  epoch: number
}
const feedbackCache = new Map<string, FeedbackCacheEntry>()
const feedbackLastValidCache = new Map<string, FeedbackCacheEntry>()
const feedbackCacheKeysByClient = new WeakMap<object, Set<string>>()
const feedbackAuthStates = new WeakMap<object, FeedbackAuthState>()
const clientIds = new WeakMap<object, number>()
let nextClientId = 1
let cacheGeneration = 0
let feedbackCacheGeneration = 0

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

function nullableEnumValue<const T extends readonly string[]>(
  input: unknown,
  values: T,
  scope: string,
): T[number] | null {
  if (input === null) return null
  if (typeof input !== "string" || !values.includes(input as T[number])) inputInvalid(scope)
  return input as T[number]
}

function enumValue<const T extends readonly string[]>(
  input: unknown,
  values: T,
  scope: string,
): T[number] {
  const value = nullableEnumValue(input, values, scope)
  if (value === null) inputInvalid(scope)
  return value
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

function executeRequest(
  request: RegistrationObservationRpcRequest,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  return request
    .abortSignal(AbortSignal.timeout(timeoutMs))
    .retry(false)
}

function deleteFeedbackCacheKey(client: RegistrationObservationClient, key: string) {
  feedbackCache.delete(key)
  feedbackLastValidCache.delete(key)
  feedbackCacheKeysByClient.get(client)?.delete(key)
}

function clearFeedbackCacheForClient(client: RegistrationObservationClient) {
  const keys = feedbackCacheKeysByClient.get(client)
  if (!keys) return
  for (const key of keys) {
    feedbackCache.delete(key)
    feedbackLastValidCache.delete(key)
  }
  keys.clear()
}

function setFeedbackCacheEntry(
  client: RegistrationObservationClient,
  key: string,
  entry: FeedbackCacheEntry,
) {
  feedbackCache.set(key, entry)
  const keys = feedbackCacheKeysByClient.get(client) || new Set<string>()
  keys.add(key)
  feedbackCacheKeysByClient.set(client, keys)
}

function feedbackAuthState(client: RegistrationObservationClient) {
  const existing = feedbackAuthStates.get(client)
  if (existing) return existing
  const state: FeedbackAuthState = { epoch: 0 }
  feedbackAuthStates.set(client, state)
  client.auth?.onAuthStateChange?.((event) => {
    if (event === "INITIAL_SESSION") return
    state.epoch += 1
    clearFeedbackCacheForClient(client)
  })
  return state
}

async function opaqueFeedbackSessionIdentity(userId: string, accessToken: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error("registration_observation_feedback_session_invalid")
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${userId}\u0000${accessToken}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("")
}

function feedbackSessionScope(
  client: RegistrationObservationClient,
): FeedbackSessionScope | Promise<FeedbackSessionScope> {
  if (!client.auth) return { identity: "fixture-or-test-client", epoch: 0 }
  const state = feedbackAuthState(client)
  const epoch = state.epoch
  return Promise.resolve(client.auth.getSession()).then(async ({ data, error }) => {
    if (state.epoch !== epoch) {
      throw new Error("registration_observation_feedback_session_changed")
    }
    if (error) throw error
    if (data.session === null) return { identity: "signed-out", epoch }
    const userId = data.session?.user?.id
    const accessToken = data.session?.access_token
    if (
      typeof userId !== "string"
      || userId.trim().length === 0
      || typeof accessToken !== "string"
      || accessToken.length === 0
    ) throw new Error("registration_observation_feedback_session_invalid")
    const identity = await opaqueFeedbackSessionIdentity(userId, accessToken)
    if (state.epoch !== epoch) {
      throw new Error("registration_observation_feedback_session_changed")
    }
    return { identity, epoch }
  })
}

function feedbackCacheKey(
  client: RegistrationObservationClient,
  sessionScope: FeedbackSessionScope,
  observationId: string,
) {
  return JSON.stringify([
    clientId(client),
    sessionScope.identity,
    sessionScope.epoch,
    observationId,
  ])
}

function feedbackMutationDetailInvalid(): never {
  throw new Error("registration_observation_feedback_mutation_detail_invalid")
}

function feedbackMutationSnapshotIsCanonical(
  operation: FeedbackMutationOperation,
  mutation: RegistrationObservationMutationResult,
) {
  const observation = mutation.observation
  const appointment = mutation.appointment
  if (!observation || !appointment || appointment.status !== "completed") {
    feedbackMutationDetailInvalid()
  }

  const completedFeedback = observation.status === "completed"
    && observation.attendance === "attended"
    && observation.suitabilityResult !== null
    && observation.feedbackRevision >= 1
  const noShow = observation.status === "no_show"
    && observation.attendance === "no_show"
    && observation.suitabilityResult === null
    && observation.feedbackRevision === 0
  const decisionWorkflowStatus = observation.decisionKind === "enrollment"
    ? "enrollment_requested"
    : observation.decisionKind === "waiting_current_class"
      ? "waiting_current_class"
      : observation.decisionKind === "waiting_new_class"
        ? "waiting_new_class"
        : observation.decisionKind === "waiting_next_opening"
          ? "waiting_next_opening"
          : observation.decisionKind === "not_registered"
            ? "not_registered"
            : observation.decisionKind === "re_observation"
              ? "observation_requested"
              : null

  const canonical = operation === "record_attendance"
    ? observation.status === "attended_feedback_pending"
      && observation.attendance === "attended"
      && observation.suitabilityResult === null
      && observation.feedbackRevision === 0
      && observation.decisionKind === null
      && mutation.workflowStatus === "observation_feedback_pending"
    : operation === "submit_feedback"
      ? (completedFeedback || noShow)
        && observation.decisionKind === null
        && mutation.workflowStatus === "observation_completed"
      : operation === "correct_feedback"
        ? completedFeedback
          && (
            observation.decisionKind !== null
            || mutation.workflowStatus === "observation_completed"
          )
        : (completedFeedback || noShow)
          && observation.decisionKind !== null
          && mutation.workflowStatus === decisionWorkflowStatus
  if (!canonical) feedbackMutationDetailInvalid()
}

function assertFeedbackMutationDetailCorrelation(
  operation: FeedbackMutationOperation,
  mutation: RegistrationObservationMutationResult,
  detail: RegistrationObservationFeedbackDetail,
) {
  const observation = mutation.observation
  const appointment = mutation.appointment
  if (!observation || !appointment) feedbackMutationDetailInvalid()

  const lifecycleCorrelated = operation === "record_attendance"
    ? detail.status === "attended_feedback_pending" || detail.status === "completed"
    : operation === "submit_feedback"
      ? detail.status === observation.status
      : operation === "correct_feedback"
        ? detail.status === "completed"
        : detail.status === observation.status
          && detail.decisionKind === observation.decisionKind
  const decidedFactsCorrelated = observation.decisionKind === null || (
    detail.decisionKind === observation.decisionKind
    && detail.suitabilityResult === observation.suitabilityResult
  )
  if (
    detail.observationId !== observation.observationId
    || detail.taskId !== observation.taskId
    || detail.trackId !== mutation.trackId
    || detail.appointmentId !== appointment.appointmentId
    || detail.revision < observation.revision
    || detail.feedbackRevision < observation.feedbackRevision
    || detail.appointmentNotificationRevision < appointment.notificationRevision
    || detail.trackWorkflowRevision < mutation.workflowRevision
    || !lifecycleCorrelated
    || !decidedFactsCorrelated
  ) feedbackMutationDetailInvalid()
}

function loadRegistrationObservationFeedbackForSession(
  resolvedClient: RegistrationObservationClient,
  sessionScope: FeedbackSessionScope,
  observationId: string,
  timeoutMs: number,
  force: boolean,
  validateDetail?: FeedbackDetailValidator,
) {
  const key = feedbackCacheKey(resolvedClient, sessionScope, observationId)
  const cached = feedbackCache.get(key)
  if (!force && cached) return cached.promise

  const generation = ++feedbackCacheGeneration
  const promise: Promise<RegistrationObservationFeedbackDetail> = (async () => {
    const { data, error } = await executeRequest(
      resolvedClient.rpc(
        "get_registration_observation_feedback_v1",
        { p_observation_id: observationId },
      ),
      timeoutMs,
    )
    const currentSessionScope = await feedbackSessionScope(resolvedClient)
    if (
      currentSessionScope.identity !== sessionScope.identity
      || currentSessionScope.epoch !== sessionScope.epoch
    ) throw new Error("registration_observation_feedback_session_changed")
    if (error) throw error
    const detail = normalizeRegistrationObservationFeedbackDetail(data)
    if (detail.observationId !== observationId) {
      throw new Error("registration_observation_feedback_detail_invalid")
    }
    validateDetail?.(detail)
    return detail
  })().then((detail) => {
    if (feedbackCache.get(key)?.generation === generation) {
      feedbackLastValidCache.set(key, { generation, promise })
    }
    return detail
  }).catch((error: unknown) => {
    if (
      error instanceof Error
      && error.message === "registration_observation_feedback_session_changed"
      && feedbackCache.get(key)?.generation === generation
    ) deleteFeedbackCacheKey(resolvedClient, key)
    const invalidDetail = error instanceof Error && (
      error.message === "registration_observation_feedback_detail_invalid"
      || error.message === "registration_observation_feedback_mutation_detail_invalid"
    )
    if (invalidDetail && feedbackCache.get(key)?.generation === generation) {
      const lastValid = feedbackLastValidCache.get(key)
      if (lastValid) setFeedbackCacheEntry(resolvedClient, key, lastValid)
      else deleteFeedbackCacheKey(resolvedClient, key)
    }
    throw error
  })
  setFeedbackCacheEntry(resolvedClient, key, { generation, promise })
  return promise
}

function loadRegistrationObservationFeedbackValidated(
  client: RegistrationObservationClient,
  observationIdInput: string,
  optionsInput: LoadRegistrationObservationFeedbackOptions = {},
  validateDetail?: FeedbackDetailValidator,
): Promise<RegistrationObservationFeedbackDetail> {
  let observationId: string
  let timeoutMs: number
  let force: boolean
  try {
    observationId = uuid(observationIdInput, "feedback")
    const options = exactInput(optionsInput, [], ["timeoutMs", "force"], "feedback")
    timeoutMs = options.timeoutMs === undefined
      ? REQUEST_TIMEOUT_MS
      : positiveRevision(options.timeoutMs, "feedback")
    if (options.force !== undefined && typeof options.force !== "boolean") inputInvalid("feedback")
    force = options.force === true
  } catch (error) {
    return Promise.reject(error)
  }

  const resolvedClient = activeClient(client)
  const sessionScope = feedbackSessionScope(resolvedClient)
  if (!(sessionScope instanceof Promise)) {
    return loadRegistrationObservationFeedbackForSession(
      resolvedClient,
      sessionScope,
      observationId,
      timeoutMs,
      force,
      validateDetail,
    )
  }
  return sessionScope.then((scope) => loadRegistrationObservationFeedbackForSession(
    resolvedClient,
    scope,
    observationId,
    timeoutMs,
    force,
    validateDetail,
  ))
}

export function loadRegistrationObservationFeedback(
  client: RegistrationObservationClient,
  observationIdInput: string,
  optionsInput: LoadRegistrationObservationFeedbackOptions = {},
): Promise<RegistrationObservationFeedbackDetail> {
  return loadRegistrationObservationFeedbackValidated(
    client,
    observationIdInput,
    optionsInput,
  )
}

async function feedbackMutationRpc(
  client: RegistrationObservationClient,
  name: string,
  args: Record<string, unknown>,
  expected: Readonly<{
    operation: FeedbackMutationOperation
    requestKey: string
    observationId: string
  }>,
) {
  const resolvedClient = activeClient(client)
  const { data, error } = await executeRequest(resolvedClient.rpc(name, args))
  if (error) throw error
  const mutation = mutationIdentity(
    normalizeRegistrationObservationMutationResult(data),
    expected,
  )
  feedbackMutationSnapshotIsCanonical(expected.operation, mutation)
  cacheGeneration += 1
  return loadRegistrationObservationFeedbackValidated(
    resolvedClient,
    expected.observationId,
    { force: true },
    (detail) => assertFeedbackMutationDetailCorrelation(
      expected.operation,
      mutation,
      detail,
    ),
  )
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

export async function recordRegistrationObservationAttendance(
  client: RegistrationObservationClient,
  input: RecordRegistrationObservationAttendanceInput,
) {
  const row = exactInput(input, [
    "observationId",
    "expectedObservationRevision",
    "expectedAppointmentNotificationRevision",
    "requestKey",
  ], [], "attendance")
  const observationId = uuid(row.observationId, "attendance")
  const expectedObservationRevision = positiveRevision(
    row.expectedObservationRevision,
    "attendance",
  )
  const expectedAppointmentNotificationRevision = positiveRevision(
    row.expectedAppointmentNotificationRevision,
    "attendance",
  )
  const requestKey = nonblank(row.requestKey, "attendance")
  return feedbackMutationRpc(client, "record_registration_observation_attendance_v1", {
    p_observation_id: observationId,
    p_expected_observation_revision: expectedObservationRevision,
    p_expected_appointment_notification_revision: expectedAppointmentNotificationRevision,
    p_request_key: requestKey,
  }, { operation: "record_attendance", requestKey, observationId })
}

export async function submitRegistrationObservationFeedback(
  client: RegistrationObservationClient,
  input: SubmitRegistrationObservationFeedbackInput,
) {
  const row = exactInput(input, [
    "observationId",
    "attendance",
    "suitabilityResult",
    "feedbackReason",
    "expectedObservationRevision",
    "expectedFeedbackRevision",
    "expectedAppointmentNotificationRevision",
    "requestKey",
  ], [], "feedback_submission")
  const observationId = uuid(row.observationId, "feedback_submission")
  const attendance = enumValue(
    row.attendance,
    ["attended", "no_show"] as const,
    "feedback_submission",
  )
  const suitabilityResult = nullableEnumValue(
    row.suitabilityResult,
    ["fit", "unfit"] as const,
    "feedback_submission",
  )
  const feedbackReason = row.feedbackReason === null
    ? null
    : nonblank(row.feedbackReason, "feedback_submission")
  if (
    (attendance === "attended" && (suitabilityResult === null || feedbackReason === null))
    || (attendance === "no_show" && (suitabilityResult !== null || feedbackReason !== null))
  ) inputInvalid("feedback_submission")
  const expectedObservationRevision = positiveRevision(
    row.expectedObservationRevision,
    "feedback_submission",
  )
  const expectedFeedbackRevision = nonnegativeRevision(
    row.expectedFeedbackRevision,
    "feedback_submission",
  )
  const expectedAppointmentNotificationRevision = positiveRevision(
    row.expectedAppointmentNotificationRevision,
    "feedback_submission",
  )
  const requestKey = nonblank(row.requestKey, "feedback_submission")
  return feedbackMutationRpc(client, "submit_registration_observation_feedback_v1", {
    p_observation_id: observationId,
    p_attendance: attendance,
    p_suitability_result: suitabilityResult,
    p_feedback_reason: feedbackReason,
    p_expected_observation_revision: expectedObservationRevision,
    p_expected_feedback_revision: expectedFeedbackRevision,
    p_expected_appointment_notification_revision: expectedAppointmentNotificationRevision,
    p_request_key: requestKey,
  }, { operation: "submit_feedback", requestKey, observationId })
}

export async function correctRegistrationObservationFeedback(
  client: RegistrationObservationClient,
  input: CorrectRegistrationObservationFeedbackInput,
) {
  const row = exactInput(input, [
    "observationId",
    "suitabilityResult",
    "feedbackReason",
    "correctionReason",
    "expectedObservationRevision",
    "expectedFeedbackRevision",
    "expectedDecisionKind",
    "requestKey",
  ], [], "feedback_correction")
  const observationId = uuid(row.observationId, "feedback_correction")
  const suitabilityResult = enumValue(
    row.suitabilityResult,
    ["fit", "unfit"] as const,
    "feedback_correction",
  )
  const feedbackReason = nonblank(row.feedbackReason, "feedback_correction")
  const correctionReason = nonblank(row.correctionReason, "feedback_correction")
  const expectedObservationRevision = positiveRevision(
    row.expectedObservationRevision,
    "feedback_correction",
  )
  const expectedFeedbackRevision = nonnegativeRevision(
    row.expectedFeedbackRevision,
    "feedback_correction",
  )
  const expectedDecisionKind = row.expectedDecisionKind === ""
    ? null
    : nullableEnumValue(
        row.expectedDecisionKind,
        [
          "enrollment",
          "waiting_current_class",
          "waiting_new_class",
          "waiting_next_opening",
          "not_registered",
          "re_observation",
        ] as const,
        "feedback_correction",
      )
  const requestKey = nonblank(row.requestKey, "feedback_correction")
  return feedbackMutationRpc(client, "correct_registration_observation_feedback_v1", {
    p_observation_id: observationId,
    p_suitability_result: suitabilityResult,
    p_feedback_reason: feedbackReason,
    p_correction_reason: correctionReason,
    p_expected_observation_revision: expectedObservationRevision,
    p_expected_feedback_revision: expectedFeedbackRevision,
    p_expected_decision_kind: expectedDecisionKind,
    p_request_key: requestKey,
  }, { operation: "correct_feedback", requestKey, observationId })
}

export async function decideRegistrationObservation(
  client: RegistrationObservationClient,
  input: DecideRegistrationObservationInput,
) {
  const row = exactInput(input, [
    "observationId",
    "decisionKind",
    "waitingClassId",
    "expectedObservationRevision",
    "expectedFeedbackRevision",
    "expectedTrackWorkflowRevision",
    "requestKey",
  ], [], "decision")
  const observationId = uuid(row.observationId, "decision")
  const decisionKind = enumValue(
    row.decisionKind,
    [
      "enrollment",
      "waiting_current_class",
      "waiting_new_class",
      "waiting_next_opening",
      "not_registered",
      "re_observation",
    ] as const,
    "decision",
  )
  const waitingClassId = row.waitingClassId === null
    ? null
    : uuid(row.waitingClassId, "decision")
  if (
    (decisionKind === "waiting_current_class" && waitingClassId === null)
    || (decisionKind !== "waiting_current_class" && waitingClassId !== null)
  ) inputInvalid("decision")
  const expectedObservationRevision = positiveRevision(
    row.expectedObservationRevision,
    "decision",
  )
  const expectedFeedbackRevision = nonnegativeRevision(
    row.expectedFeedbackRevision,
    "decision",
  )
  const expectedTrackWorkflowRevision = positiveRevision(
    row.expectedTrackWorkflowRevision,
    "decision",
  )
  const requestKey = nonblank(row.requestKey, "decision")
  return feedbackMutationRpc(client, "decide_registration_observation_v1", {
    p_observation_id: observationId,
    p_decision_kind: decisionKind,
    p_waiting_class_id: waitingClassId,
    p_expected_observation_revision: expectedObservationRevision,
    p_expected_feedback_revision: expectedFeedbackRevision,
    p_expected_track_workflow_revision: expectedTrackWorkflowRevision,
    p_request_key: requestKey,
  }, { operation: "decide", requestKey, observationId })
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
