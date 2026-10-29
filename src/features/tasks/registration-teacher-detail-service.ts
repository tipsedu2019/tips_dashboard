import { supabase } from "@/lib/supabase"
import {
  mapRegistrationTeacherCaseBundle,
  type OpsRegistrationObservationCaseDetail,
} from "./registration-track-service"
import {
  parseRegistrationCaseCustomerMessageHistory,
  type RegistrationCaseCustomerMessageHistoryInput,
} from "./registration-customer-message-case-history-contract"
import type { RegistrationCustomerMessageClient } from "./registration-customer-message-contract"

export type RegistrationTeacherCaseData = Readonly<{
  detail: OpsRegistrationObservationCaseDetail
  profiles: ReadonlyArray<{ id: string; name: string }>
  classes: ReadonlyArray<{ id: string; name: string }>
  textbooks: ReadonlyArray<{ id: string; title: string }>
}>

export type RegistrationTeacherObservationAttempt = Readonly<{
  observationId: string
  taskId: string
  trackId: string
  appointmentId: string
  appointmentStatus: "scheduled" | "completed" | "canceled"
  className: string
  subject: "영어" | "수학" | "과학"
  sessionDate: string
  startsAt: string
  endsAt: string
  teacherName: string
  classroomName: string
  campus: string
  textbooks: ReadonlyArray<{ title: string }>
  progress: string
  status: "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  attendance: "attended" | "no_show" | null
  suitabilityResult: "fit" | "unfit" | null
  decisionKind: "enrollment" | "waiting_current_class" | "waiting_new_class" | "waiting_next_opening" | "not_registered" | "re_observation" | null
  createdAt: string
  updatedAt: string
}>
export type RegistrationTeacherObservationDetail = Readonly<{
  track: { taskId: string; trackId: string; subject: RegistrationTeacherObservationAttempt["subject"] }
  currentObservation: RegistrationTeacherObservationAttempt | null
  attempts: readonly RegistrationTeacherObservationAttempt[]
  latestDecisionObservation: { observationId: string; decisionKind: NonNullable<RegistrationTeacherObservationAttempt["decisionKind"]> } | null
}>
export type RegistrationTeacherObservationAttemptDetail = Readonly<{
  taskId: string; trackId: string; observation: RegistrationTeacherObservationAttempt
}>
export type RegistrationTeacherFeedback = Readonly<Pick<RegistrationTeacherObservationAttempt,
  "observationId" | "taskId" | "trackId" | "status" | "className" | "teacherName" | "attendance" | "decisionKind" | "suitabilityResult"
> & {
  feedbackReason: string | null
  proxySubmitted: boolean
  feedbackSubmittedByName: string | null
  feedbackSubmittedAt: string | null
}>

type Row = Record<string, unknown>
type RpcResult = { data: unknown; error: unknown }
type RpcRequest = PromiseLike<RpcResult> & {
  abortSignal: (signal: AbortSignal) => RpcRequest
  retry: (enabled: boolean) => RpcRequest
}
export type RegistrationTeacherDetailClient = {
  rpc: (name: string, args: Record<string, unknown>) => RpcRequest
}
export type RegistrationTeacherCaseInput = Readonly<{ taskId: string }>
export type RegistrationTeacherTrackInput = RegistrationTeacherCaseInput & Readonly<{ trackId: string }>
export type RegistrationTeacherObservationInput = RegistrationTeacherTrackInput & Readonly<{ observationId: string }>
type Section = "case" | "observation_detail" | "observation_attempt" | "feedback" | "customer_history"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CASE_KEYS = ["parent", "tracks", "appointments", "levelTests", "consultations", "admissionBatches", "enrollments", "events", "activeAdmissionMessage", "reminderSummaries", "scheduledAppointmentTotal", "currentEnrollmentTotal", "profiles", "classes", "textbooks"]
const invalid = (): never => { throw new Error("registration_teacher_detail_invalid") }
function exact(input: unknown, keys: readonly string[]): Row {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid()
  const row = input as Row
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) return invalid()
  return row
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return invalid()
  return value.toLowerCase()
}
function requestInput<T extends object>(input: T, keys: readonly string[]): T & Row {
  const row = exact(input, keys)
  // Bind response validation to the issued request, even if its caller later
  // reuses or changes the input object while this request is in flight.
  return Object.fromEntries(keys.map((key) => [key, key.endsWith("Id") ? uuid(row[key]) : row[key]])) as T & Row
}
function labels(input: unknown, label: "name" | "title") {
  if (!Array.isArray(input)) return invalid()
  const seen = new Set<string>()
  return input.map((candidate) => {
    const row = exact(candidate, ["id", label])
    const id = uuid(row.id)
    if (seen.has(id) || typeof row[label] !== "string") return invalid()
    seen.add(id)
    return { id, value: row[label] as string }
  })
}

export function parseRegistrationTeacherCaseData(input: unknown, taskId: string): RegistrationTeacherCaseData {
  const row = exact(input, CASE_KEYS)
  const detail = mapRegistrationTeacherCaseBundle(row)
  if (detail.task.id !== taskId) return invalid()
  return {
    detail,
    profiles: labels(row.profiles, "name").map(({ id, value }) => ({ id, name: value })),
    classes: labels(row.classes, "name").map(({ id, value }) => ({ id, name: value })),
    textbooks: labels(row.textbooks, "title").map(({ id, value }) => ({ id, title: value })),
  }
}

const ATTEMPT_KEYS = ["observationId", "taskId", "trackId", "appointmentId", "appointmentStatus", "className", "subject", "sessionDate", "startsAt", "endsAt", "teacherName", "classroomName", "campus", "textbooks", "progress", "status", "attendance", "suitabilityResult", "decisionKind", "createdAt", "updatedAt"]
const STATUS_VALUES = ["scheduled", "attended_feedback_pending", "completed", "no_show", "canceled"] as const
const DECISION_VALUES = ["enrollment", "waiting_current_class", "waiting_new_class", "waiting_next_opening", "not_registered", "re_observation"] as const
const SUBJECT_VALUES = ["영어", "수학", "과학"] as const
function string(value: unknown): string { return typeof value === "string" ? value : invalid() }
function nullableString(value: unknown): string | null { return value === null ? null : string(value) }
function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  return typeof value === "string" && values.includes(value) ? value : invalid()
}
function nullableEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return value === null ? null : enumValue(value, values)
}
function date(value: unknown): string {
  const day = string(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return invalid()
  const parsed = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : invalid()
}
function timestamp(value: unknown): string {
  const result = string(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)
    || !Number.isFinite(Date.parse(result))) return invalid()
  date(result.slice(0, 10))
  return result
}
function identifiers(row: Row, input: RegistrationTeacherTrackInput) {
  if (row.taskId !== input.taskId || row.trackId !== input.trackId) return invalid()
}
function parseAttempt(input: unknown, owner: RegistrationTeacherTrackInput): RegistrationTeacherObservationAttempt {
  const row = exact(input, ATTEMPT_KEYS)
  identifiers(row, owner)
  const startsAt = timestamp(row.startsAt), endsAt = timestamp(row.endsAt)
  if (Date.parse(startsAt) >= Date.parse(endsAt) || !Array.isArray(row.textbooks)) return invalid()
  return {
    observationId: uuid(row.observationId), taskId: uuid(row.taskId), trackId: uuid(row.trackId), appointmentId: uuid(row.appointmentId),
    appointmentStatus: enumValue(row.appointmentStatus, ["scheduled", "completed", "canceled"] as const),
    className: string(row.className), subject: enumValue(row.subject, SUBJECT_VALUES), sessionDate: date(row.sessionDate), startsAt, endsAt,
    teacherName: string(row.teacherName), classroomName: string(row.classroomName), campus: string(row.campus),
    textbooks: row.textbooks.map((item) => ({ title: string(exact(item, ["title"]).title) })), progress: string(row.progress),
    status: enumValue(row.status, STATUS_VALUES), attendance: nullableEnum(row.attendance, ["attended", "no_show"] as const),
    suitabilityResult: nullableEnum(row.suitabilityResult, ["fit", "unfit"] as const), decisionKind: nullableEnum(row.decisionKind, DECISION_VALUES),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  }
}
function parseObservationDetail(input: unknown, owner: RegistrationTeacherTrackInput): RegistrationTeacherObservationDetail {
  const row = exact(input, ["track", "currentObservation", "attempts", "latestDecisionObservation"])
  const track = exact(row.track, ["taskId", "trackId", "subject"])
  identifiers(track, owner)
  const subject = enumValue(track.subject, SUBJECT_VALUES)
  if (!Array.isArray(row.attempts) || row.attempts.length > 20) return invalid()
  const attempts = row.attempts.map((item) => parseAttempt(item, owner))
  const ids = new Set<string>()
  for (const attempt of attempts) {
    if (ids.has(attempt.observationId) || attempt.subject !== subject) return invalid()
    ids.add(attempt.observationId)
  }
  const currentObservation = row.currentObservation === null ? null : parseAttempt(row.currentObservation, owner)
  if (currentObservation) {
    if (currentObservation.subject !== subject) return invalid()
    const matching = attempts.find((attempt) => attempt.observationId === currentObservation.observationId)
    // The server fetches current separately from the newest-20 history window.
    // Preserve that window, but reject conflicting copies of a shared row.
    if (matching && JSON.stringify(matching) !== JSON.stringify(currentObservation)) return invalid()
  }
  const decision = row.latestDecisionObservation === null ? null : exact(row.latestDecisionObservation, ["observationId", "decisionKind"])
  return {
    track: { taskId: uuid(track.taskId), trackId: uuid(track.trackId), subject }, currentObservation, attempts,
    latestDecisionObservation: decision === null ? null : { observationId: uuid(decision.observationId), decisionKind: enumValue(decision.decisionKind, DECISION_VALUES) },
  }
}
function parseFeedback(input: unknown, owner: RegistrationTeacherObservationInput): RegistrationTeacherFeedback {
  const row = exact(input, ["observationId", "taskId", "trackId", "status", "className", "teacherName", "attendance", "decisionKind", "suitabilityResult", "feedbackReason", "proxySubmitted", "feedbackSubmittedByName", "feedbackSubmittedAt"])
  identifiers(row, owner)
  if (row.observationId !== owner.observationId || typeof row.proxySubmitted !== "boolean") return invalid()
  const name = nullableString(row.feedbackSubmittedByName)
  const submittedAt = row.feedbackSubmittedAt === null ? null : timestamp(row.feedbackSubmittedAt)
  if ((name === null) !== (submittedAt === null) || (name !== null && !name.trim())
    || (row.proxySubmitted && name === null)) return invalid()
  return {
    observationId: uuid(row.observationId), taskId: uuid(row.taskId), trackId: uuid(row.trackId), status: enumValue(row.status, STATUS_VALUES),
    className: string(row.className), teacherName: string(row.teacherName), attendance: nullableEnum(row.attendance, ["attended", "no_show"] as const),
    decisionKind: nullableEnum(row.decisionKind, DECISION_VALUES), suitabilityResult: nullableEnum(row.suitabilityResult, ["fit", "unfit"] as const),
    feedbackReason: nullableString(row.feedbackReason), proxySubmitted: row.proxySubmitted, feedbackSubmittedByName: name, feedbackSubmittedAt: submittedAt,
  }
}

// No data cache: each opening/refresh reaches the server's current role check.
// The workspace owns viewer/role epochs; this boundary also discards aborted
// results even when a transport has already completed or cannot cancel.
export function createRegistrationTeacherDetailService(client: RegistrationTeacherDetailClient) {
  async function read(section: Section, input: Row, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(8_000)
    const abort = signal ? AbortSignal.any([signal, deadline]) : deadline
    const taskId = uuid(input.taskId)
    const request = client.rpc("get_registration_teacher_detail_v1", {
      p_task_id: taskId,
      p_section: section,
      p_track_id: input.trackId === undefined ? null : uuid(input.trackId),
      p_observation_id: input.observationId === undefined ? null : uuid(input.observationId),
      p_page: input.page ?? 1,
      p_page_size: input.pageSize ?? 10,
    }).abortSignal(abort).retry(false)
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abort.reason)
      abort.addEventListener("abort", onAbort, { once: true })
      if (abort.aborted) onAbort()
    })
    try {
      const { data, error } = await Promise.race([Promise.resolve(request), aborted])
      abort.throwIfAborted()
      if (error) throw error
      const envelope = exact(data, ["contractVersion", "taskId", "section", "data"])
      if (envelope.contractVersion !== 1 || envelope.taskId !== taskId || envelope.section !== section) return invalid()
      return envelope.data
    } finally {
      if (onAbort) abort.removeEventListener("abort", onAbort)
    }
  }
  async function loadCase(input: RegistrationTeacherCaseInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId"])
    return parseRegistrationTeacherCaseData(await read("case", row, signal), uuid(row.taskId))
  }
  async function loadObservationDetail(input: RegistrationTeacherTrackInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "trackId"])
    return parseObservationDetail(await read("observation_detail", row, signal), row)
  }
  async function loadObservationAttempt(input: RegistrationTeacherObservationInput, signal?: AbortSignal): Promise<RegistrationTeacherObservationAttemptDetail> {
    const row = requestInput(input, ["taskId", "trackId", "observationId"])
    const data = exact(await read("observation_attempt", row, signal), ["taskId", "trackId", "observation"])
    identifiers(data, row)
    const observation = parseAttempt(data.observation, row)
    if (observation.observationId !== row.observationId) return invalid()
    return { taskId: uuid(data.taskId), trackId: uuid(data.trackId), observation }
  }
  async function loadFeedback(input: RegistrationTeacherObservationInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "trackId", "observationId"])
    return parseFeedback(await read("feedback", row, signal), row)
  }
  async function listCaseHistory(input: RegistrationCaseCustomerMessageHistoryInput, signal?: AbortSignal) {
    const row = requestInput(input, ["taskId", "page", "pageSize"])
    if (!Number.isSafeInteger(row.page) || Number(row.page) < 1 || Number(row.page) > 100000
      || ![10, 15, 20].includes(Number(row.pageSize)) || typeof row.pageSize !== "number") return invalid()
    const result = parseRegistrationCaseCustomerMessageHistory(await read("customer_history", row, signal), row)
    if (result.history.some((item) => item.canCheck !== false || item.canCheckDelivery !== false)) return invalid()
    return result
  }
  function customerHistoryClient(taskIdInput: string): RegistrationCustomerMessageClient {
    const taskId = uuid(taskIdInput)
    const unavailable = async (): Promise<never> => { throw new Error("registration_teacher_detail_read_only") }
    return Object.freeze({
      preview: unavailable,
      send: unavailable,
      list: unavailable,
      check: unavailable,
      checkDelivery: unavailable,
      reconcile: unavailable,
      releasePreSend: unavailable,
      listCaseHistory: (input: RegistrationCaseCustomerMessageHistoryInput, signal?: AbortSignal) => {
        if (input.taskId !== taskId) return Promise.reject(new Error("registration_teacher_detail_invalid"))
        return listCaseHistory(input, signal)
      },
    })
  }
  return { loadCase, loadObservationDetail, loadObservationAttempt, loadFeedback, listCaseHistory, customerHistoryClient }
}

export const registrationTeacherDetailService = createRegistrationTeacherDetailService(supabase as unknown as RegistrationTeacherDetailClient)
