import { createHmac } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  createProductionRegistrationCustomerMessageAuth,
  RegistrationCustomerMessageHttpError,
} from "./registration-customer-message-auth.ts"
import { normalizeRegistrationCaseContact } from "../registration-contact-client.ts"

type Auth = ReturnType<typeof createProductionRegistrationCustomerMessageAuth>
type Command = {
  command: string; taskId: string | null; requestKey: string
  expectedGeneration: string | null; expectedRevision: string | null
  payload: Record<string, unknown>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_COUNTER = "9223372036854775807"
const COMMON = ["studentName", "schoolGrade", "schoolName", "parentPhone", "campus", "inquiryAt", "requestNote", "priority"]
const PAYLOAD_KEYS: Record<string, readonly string[]> = {
  create: [...COMMON, "subjects"],
  update_common: [...COMMON, "expectedCommonRevision"],
  save_inquiry: [...COMMON, "expectedCommonRevision", "expectedSubjects", "subjects"],
  set_workflow_status: ["trackId", "workflowStatus", "expectedWorkflowRevision"],
  waiting_details: ["trackId", "waitingKind", "classId", "retakeDecision"],
  close: ["reason"], reopen: ["trackId", "destination", "reason"],
  archive: ["expectedSubjects", "subjects"], unarchive: ["expectedSubjects", "subjects"],
  bind_student: ["studentId"],
}
const STATUSES = new Set(["inquiry", "level_test_requested", "consultation_requested", "consultation_completed", "waiting_current_class", "waiting_new_class", "waiting_next_opening", "observation_requested", "observation_feedback_pending", "observation_completed", "enrollment_requested", "payment_in_progress", "registered", "not_registered", "inquiry_only"])
const SUBJECTS = new Set(["영어", "수학", "과학"])
function fail(status = 400, code = "registration_contact_request_invalid"): never {
  throw new RegistrationCustomerMessageHttpError(status, code)
}
function hasOwn(value: object, key: PropertyKey) { return Object.prototype.hasOwnProperty.call(value, key) }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
function uuid(value: unknown): value is string { return typeof value === "string" && value.length === 36 && UUID.test(value) }
function counter(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)
    && value.length <= 19 && (value.length < 19 || value <= MAX_COUNTER)
}
function integer(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 }
function stamp(value: unknown) { return typeof value === "string" && value.length < 64 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) }
function subjectList(value: unknown) { return Array.isArray(value) && value.length <= 3 && value.every(item => typeof item === "string" && SUBJECTS.has(item)) && new Set(value).size === value.length }

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 128_000) fail(413, "registration_contact_request_too_large")
  if (!request.body) fail()
  const reader = request.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let length = 0
  let body = ""
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 128_000) {
        void reader.cancel().catch(() => undefined)
        fail(413, "registration_contact_request_too_large")
      }
      body += decoder.decode(next.value, { stream: true })
    }
    return body + decoder.decode()
  } catch (error) {
    if (error instanceof RegistrationCustomerMessageHttpError) throw error
    fail()
  } finally { reader.releaseLock() }
}

function parseCommand(value: unknown): Command {
  if (!record(value) || Object.keys(value).some(key => !["command", "taskId", "requestKey", "expectedGeneration", "expectedRevision", "payload"].includes(key))
    || typeof value.command !== "string" || !hasOwn(PAYLOAD_KEYS, value.command)
    || !uuid(value.requestKey) || !record(value.payload)) fail()
  const create = value.command === "create"
  if (create ? value.taskId !== null || value.expectedGeneration !== null || value.expectedRevision !== null
    : !uuid(value.taskId) || !counter(value.expectedGeneration) || !counter(value.expectedRevision)) fail()
  const payload = value.payload
  if (Object.keys(payload).some(key => !PAYLOAD_KEYS[value.command as string].includes(key))) fail()
  for (const [key, item] of Object.entries(payload)) {
    if (["subjects", "expectedSubjects"].includes(key)) { if (!subjectList(item)) fail(); continue }
    if (["expectedCommonRevision", "expectedWorkflowRevision"].includes(key)) { if (!integer(item)) fail(); continue }
    if (["studentId", "trackId"].includes(key)) { if (!uuid(item)) fail(); continue }
    if (key === "classId") { if (item !== null && item !== "" && !uuid(item)) fail(); continue }
    if (["parentPhone", "waitingKind", "retakeDecision", "inquiryAt"].includes(key) && item === null) continue
    if (typeof item !== "string" || item.length > (key === "requestNote" ? 20_000 : 500) || /[\u0000\u007f]/.test(item)) fail()
    if (key === "parentPhone" && (/[^0-9+() .-]/.test(item) || item.length > 40)) fail()
    if (key === "workflowStatus" && !STATUSES.has(item)) fail()
  }
  const required = PAYLOAD_KEYS[value.command as string].filter(key => key !== "parentPhone")
  if (required.some(key => !hasOwn(payload, key))) fail()
  return value as Command
}

/** Every supplied business field participates; no browser-supplied digest is accepted. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  return JSON.stringify(value)
}
export function registrationContactCommandHmac(actorId: string, command: Command, pepper: string) {
  return createHmac("sha256", pepper).update(canonical({ namespace: "tips.registration-contact.command", version: 1, actorId, ...command })).digest("hex")
}

function submitContactCommand(client: SupabaseClient, actorId: string, command: Command, pepper: string, signal: AbortSignal) {
  return client.rpc("mutate_registration_contact_v1", {
    p_actor_id: actorId, p_command: command.command, p_task_id: command.taskId,
    p_request_key: command.requestKey, p_expected_generation: command.expectedGeneration,
    p_expected_revision: command.expectedRevision, p_payload: command.payload,
    p_request_hmac: registrationContactCommandHmac(actorId, command, pepper),
  }).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(8_000)])).retry(false)
}

/** A mutation response is metadata. Temporary parent contact has a separate scoped read. */
function projectReceipt(value: unknown, command: Command): Record<string, unknown> {
  if (!record(value) || value.version !== 1 || !uuid(value.taskId) || value.requestKey !== command.requestKey
    || value.command !== command.command || typeof value.replayed !== "boolean" || !record(value.result)
    || (command.taskId !== null && value.taskId !== command.taskId)) fail(503, "registration_contact_response_invalid")
  const source = value.result
  const result: Record<string, unknown> = {}
  for (const key of ["taskId", "trackId", "studentId", "classId"]) {
    if (hasOwn(source, key)) {
      const item = source[key]
      if (item !== null && item !== "" && !uuid(item)) fail(503, "registration_contact_response_invalid")
      result[key] = item
    }
  }
  for (const key of ["commonRevision", "workflowRevision"]) if (hasOwn(source, key)) {
    if (!integer(source[key])) fail(503, "registration_contact_response_invalid")
    result[key] = source[key]
  }
  if (hasOwn(source, "workflowStatus")) {
    if (typeof source.workflowStatus !== "string" || !STATUSES.has(source.workflowStatus)) fail(503, "registration_contact_response_invalid")
    result.workflowStatus = source.workflowStatus
  }
  if (hasOwn(source, "workflowStatusEnteredAt")) {
    if (!stamp(source.workflowStatusEnteredAt)) fail(503, "registration_contact_response_invalid")
    result.workflowStatusEnteredAt = source.workflowStatusEnteredAt
  }
  for (const [key, allowed] of [["waitingKind", ["current_class", "current_term_opening", "next_term_opening", ""]], ["retakeDecision", ["required", "not_required", ""]]] as const) {
    if (hasOwn(source, key)) { if (source[key] !== null && (typeof source[key] !== "string" || !allowed.includes(source[key] as never))) fail(503, "registration_contact_response_invalid"); result[key] = source[key] }
  }
  if (hasOwn(source, "changed")) { if (typeof source.changed !== "boolean") fail(503, "registration_contact_response_invalid"); result.changed = source.changed }
  if (hasOwn(source, "subjects")) { if (!subjectList(source.subjects)) fail(503, "registration_contact_response_invalid"); result.subjects = [...source.subjects as string[]] }
  if (hasOwn(source, "sourceEventIds")) {
    if (!Array.isArray(source.sourceEventIds) || source.sourceEventIds.length > 50 || !source.sourceEventIds.every(uuid)) fail(503, "registration_contact_response_invalid")
    result.sourceEventIds = [...source.sourceEventIds]
  }
  if (source.enrollmentFinalization !== undefined) {
    if (source.enrollmentFinalization === null) result.enrollmentFinalization = null
    else {
      const item = source.enrollmentFinalization
      if (!record(item) || !uuid(item.trackId) || !uuid(item.studentId) || (item.batchId !== null && !uuid(item.batchId))
        || typeof item.changed !== "boolean" || !Array.isArray(item.enrollmentIds) || !item.enrollmentIds.every(uuid)) fail(503, "registration_contact_response_invalid")
      result.enrollmentFinalization = { trackId: item.trackId, studentId: item.studentId, batchId: item.batchId, enrollmentIds: [...item.enrollmentIds], changed: item.changed }
    }
  }
  if (source.tracks !== undefined) {
    if (!Array.isArray(source.tracks) || source.tracks.length > 50) fail(503, "registration_contact_response_invalid")
    result.tracks = source.tracks.map(item => {
      if (!record(item) || !uuid(item.id) || item.taskId !== value.taskId || typeof item.subject !== "string" || !SUBJECTS.has(item.subject)
        || typeof item.workflowStatus !== "string" || !STATUSES.has(item.workflowStatus) || !integer(item.workflowRevision)
        || (item.archivedAt !== null && !stamp(item.archivedAt))
        || typeof item.status !== "string" || !["inquiry", "migration_review", "level_test_scheduled", "level_test_in_progress", "consultation_waiting", "visit_consultation_scheduled", "waiting", "enrollment_decided", "enrollment_processing", "registered", "not_registered", "inquiry_closed"].includes(item.status)) fail(503, "registration_contact_response_invalid")
      const track: Record<string, unknown> = { id: item.id, taskId: item.taskId, subject: item.subject, workflowStatus: item.workflowStatus, workflowRevision: item.workflowRevision, status: item.status, archivedAt: item.archivedAt }
      if (hasOwn(item, "directorProfileId")) {
        if (item.directorProfileId !== null && !uuid(item.directorProfileId)) fail(503, "registration_contact_response_invalid")
        track.directorProfileId = item.directorProfileId
      }
      for (const [key, allowed] of [["directorAssignmentSource", ["", "default", "manual", "migration"]], ["waitingKind", ["", "current_class", "current_term_opening", "next_term_opening"]], ["levelTestRetakeDecision", ["", "required", "not_required"]]] as const) {
        if (hasOwn(item, key)) { if (item[key] !== null && (typeof item[key] !== "string" || !allowed.includes(item[key] as never))) fail(503, "registration_contact_response_invalid"); track[key] = item[key] }
      }
      if (hasOwn(item, "directorAssignmentRuleKey")) {
        if (item.directorAssignmentRuleKey !== null && (typeof item.directorAssignmentRuleKey !== "string" || !/^[a-zA-Z0-9_:.-]{0,200}$/.test(item.directorAssignmentRuleKey))) fail(503, "registration_contact_response_invalid")
        track.directorAssignmentRuleKey = item.directorAssignmentRuleKey
      }
      if (hasOwn(item, "migrationReviewRequired")) { if (typeof item.migrationReviewRequired !== "boolean") fail(503, "registration_contact_response_invalid"); track.migrationReviewRequired = item.migrationReviewRequired }
      for (const key of ["stageEnteredAt", "workflowStatusEnteredAt"]) if (hasOwn(item, key)) {
        if (item[key] !== null && !stamp(item[key])) fail(503, "registration_contact_response_invalid")
        track[key] = item[key]
      }
      return track
    })
  }
  if (!record(source.contactState) || source.contactState.parentPhone !== null) fail(503, "registration_contact_response_invalid")
  try { result.contactState = normalizeRegistrationCaseContact(source.contactState, value.taskId) } catch { fail(503, "registration_contact_response_invalid") }
  return { version: 1, taskId: value.taskId, requestKey: value.requestKey, command: value.command, replayed: value.replayed, result }
}

export function createRegistrationContactCommandRoute(options: { auth: Auth; pepper: () => string | undefined; timeoutMs?: number }) {
  return async function POST(request: Request) {
    try {
      const context = await options.auth.authenticate(request)
      if (!uuid(context.actorProfileId) || !["admin", "staff"].includes(context.role)) fail(403, "registration_contact_forbidden")
      const body = await readBody(request)
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch { fail() }
      const command = parseCommand(parsed)
      if (command.taskId && !await options.auth.authorizeTask(context, command.taskId)) fail(403, "registration_contact_forbidden")
      const pepper = options.pepper()
      if (typeof pepper !== "string" || !pepper.trim()) fail(503, "registration_contact_runtime_unavailable")
      const abort = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const pending = submitContactCommand(context.serviceClient, context.actorProfileId, command, pepper, abort.signal)
        const response = await Promise.race([pending, new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(new RegistrationCustomerMessageHttpError(503, "registration_contact_mutation_timeout")) }, options.timeoutMs ?? 8_000)
        })])
        if (response.error) {
          const code = response.error.code
          fail(code === "42501" ? 403 : code === "22023" ? 400 : code === "23514" ? 409 : code === "P0002" ? 404 : 503,
            code === "23514" ? "registration_contact_conflict" : "registration_contact_mutation_failed")
        }
        return Response.json(projectReceipt(response.data, command), { headers: { "Cache-Control": "no-store" } })
      } finally { if (timer !== undefined) clearTimeout(timer) }
    } catch (error) {
      const known = error instanceof RegistrationCustomerMessageHttpError
      return Response.json({ error: known ? error.code : "registration_contact_runtime_unavailable" }, {
        status: known ? error.status : 503, headers: { "Cache-Control": "no-store" },
      })
    }
  }
}

export function createProductionRegistrationContactCommandRoute() {
  // Lazy: missing runtime configuration becomes an HTTP failure, never a raw exception.
  let auth: Auth | undefined
  return (request: Request) => createRegistrationContactCommandRoute({
    auth: {
      authenticate(req) { auth ??= createProductionRegistrationCustomerMessageAuth(); return auth.authenticate(req) },
      authorizeTask(context, taskId) { auth ??= createProductionRegistrationCustomerMessageAuth(); return auth.authorizeTask(context, taskId) },
    },
    pepper: () => process.env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER,
  })(request)
}
