export type RegistrationCaseContactState = Readonly<{
  version: 1
  taskId: string
  revision: string
  generation: string
  phase: "open" | "closed"
  closureReason: "all_current_tracks_terminal" | "whole_case_cancelled" | "last_current_track_excluded" | null
  closedAt: string | null
  parentPhone: string | null
  studentId: string | null
  commonRevision: number
  allPhasesClosed: boolean
  currentTrackIds: readonly string[]
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNTER = /^[1-9][0-9]{0,18}$/
const MAX_COUNTER = "9223372036854775807"
const REASONS = new Set(["all_current_tracks_terminal", "whole_case_cancelled", "last_current_track_excluded"])

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value)
}
function isCounter(value: unknown): value is string {
  return typeof value === "string" && value.length <= 19 && !/[^0-9]/.test(value)
    && COUNTER.test(value) && (value.length < 19 || value <= MAX_COUNTER)
}

/** A missing or malformed privacy contract never authorizes contact display or reuse. */
export function normalizeRegistrationCaseContact(
  input: unknown,
  taskId: string,
  options: { allowMissingParentPhone?: boolean } = {},
): RegistrationCaseContactState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("registration_contact_response_invalid")
  const row = input as Record<string, unknown>
  const phone = row.parentPhone === undefined && options.allowMissingParentPhone ? null : row.parentPhone
  if (row.version !== 1 || row.taskId !== taskId || !isUuid(taskId)
    || !isCounter(row.revision) || !isCounter(row.generation)
    || (row.phase !== "open" && row.phase !== "closed")
    || typeof row.allPhasesClosed !== "boolean"
    || typeof row.commonRevision !== "number" || !Number.isSafeInteger(row.commonRevision) || row.commonRevision < 1
    || (row.studentId !== null && !isUuid(row.studentId))
    || (phone !== null && (typeof phone !== "string" || /[\u0000-\u001f\u007f]/.test(phone)))
    || !Array.isArray(row.currentTrackIds) || !row.currentTrackIds.every(isUuid)
    || new Set(row.currentTrackIds.map((id) => id.toLowerCase())).size !== row.currentTrackIds.length
    || (row.closureReason !== null && (typeof row.closureReason !== "string" || !REASONS.has(row.closureReason)))
    || (row.closedAt !== null && (typeof row.closedAt !== "string" || !Number.isFinite(Date.parse(row.closedAt))))) {
    throw new Error("registration_contact_response_invalid")
  }
  if ((row.phase === "closed" || row.allPhasesClosed) && phone !== null) throw new Error("registration_contact_closed_response_invalid")
  if (row.phase === "closed" && (row.closureReason === null || (row.closedAt === null && row.closureReason === "last_current_track_excluded"))) throw new Error("registration_contact_response_invalid")
  if (row.phase === "open" && (row.closureReason !== null || row.closedAt !== null)) throw new Error("registration_contact_response_invalid")
  return {
    version: 1, taskId, revision: row.revision, generation: row.generation, phase: row.phase,
    closureReason: row.closureReason as RegistrationCaseContactState["closureReason"],
    closedAt: row.closedAt as string | null, parentPhone: phone as string | null,
    studentId: row.studentId as string | null, commonRevision: row.commonRevision,
    allPhasesClosed: row.allPhasesClosed, currentTrackIds: [...row.currentTrackIds] as string[],
  }
}

export function canUseRegistrationParentContact(state: RegistrationCaseContactState | null | undefined) {
  return Boolean(state && state.phase === "open" && !state.allPhasesClosed && state.currentTrackIds.length > 0)
}

export function getRegistrationContactScopeKey(state: RegistrationCaseContactState | null | undefined) {
  return state ? `${state.taskId}:${state.generation}:${state.phase}:${state.allPhasesClosed}` : "unavailable"
}

/** Removes retired typed slots, without changing UUIDs, notes or business arrays. */
export function stripRegistrationInquiryContact<T extends object>(draft: T, clearParent = false): T {
  const result = { ...draft } as Record<string, unknown>
  for (const key of ["studentPhone", "student_phone", "parent_phone"]) delete result[key]
  if (clearParent && Object.prototype.hasOwnProperty.call(result, "parentPhone")) result.parentPhone = ""
  return result as T
}

export function reconcileRegistrationInquiryContactDraft<T extends { parentPhone: string }>(
  current: T,
  canonical: T,
  previousContactKey: string,
  nextContactKey: string,
  showParentContact: boolean,
): T {
  const result = stripRegistrationInquiryContact(current, !showParentContact)
  return previousContactKey === nextContactKey ? result
    : { ...result, parentPhone: showParentContact ? canonical.parentPhone : "" }
}

/** Persisted/list caches are business projections, never a source for contact rehydration. */
export function stripRegistrationTaskContact<T extends { registration?: object }>(task: T): T {
  if (!task.registration) return task
  const registration = { ...task.registration } as Record<string, unknown>
  for (const key of ["studentPhone", "student_phone", "parentPhone", "parent_phone"]) delete registration[key]
  return { ...task, registration }
}
