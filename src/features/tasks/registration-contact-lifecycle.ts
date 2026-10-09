/** Pure contact lifecycle policy. Persistence, authorization and HMAC generation belong to the controller. */
export type RegistrationContactGeneration = string

export type RegistrationContactTrack = Readonly<{
  id: string
  workflowStatus: string
  archivedAt?: string | null
}>

export type RegistrationContactClosureReason =
  | "all_current_tracks_terminal"
  | "whole_case_cancelled"
  | "last_current_track_excluded"

export type RegistrationContactCaseClosure = Readonly<{
  allPhasesClosed: boolean
  reason: "all_current_tracks_terminal" | "whole_case_cancelled" | "open_tracks" | "no_current_tracks"
  currentTrackIds: readonly string[]
}>

const TERMINAL_STATUSES = new Set(["registered", "not_registered", "inquiry_only"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DECIMAL = /^[1-9][0-9]{0,18}$/
const MAX_COUNTER = "9223372036854775807"
const CLOSURE_REASONS = new Set(["all_current_tracks_terminal", "whole_case_cancelled", "last_current_track_excluded"])

function fail(code: string): never { throw new Error(code) }
function assertUuid(value: string) {
  if (typeof value !== "string" || !UUID.test(value)) fail("registration_contact_identity_invalid")
}
function assertCounter(value: string) {
  if (typeof value !== "string" || !DECIMAL.test(value)
    || (value.length === 19 && value > MAX_COUNTER)) fail("registration_contact_revision_invalid")
}
function increment(value: string, field: "revision" | "generation"): string {
  if (value === MAX_COUNTER) fail(`registration_contact_${field}_overflow`)
  const digits = value.split("")
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") {
      digits[index] = String(Number(digits[index]) + 1)
      return digits.join("")
    }
    digits[index] = "0"
  }
  return `1${digits.join("")}`
}
function assertTracks(tracks: readonly RegistrationContactTrack[]) {
  if (!Array.isArray(tracks)) fail("registration_contact_tracks_invalid")
  const ids = new Set<string>()
  for (const track of tracks) {
    if (!track || typeof track.workflowStatus !== "string" || !track.workflowStatus) fail("registration_contact_tracks_invalid")
    assertUuid(track.id)
    if (ids.has(track.id)) fail("registration_contact_tracks_invalid")
    if (track.archivedAt !== null && track.archivedAt !== undefined
      && (typeof track.archivedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(track.archivedAt)
        || !Number.isFinite(Date.parse(track.archivedAt)))) fail("registration_contact_tracks_invalid")
    ids.add(track.id)
  }
}

/** Uses every current subject, never the selected tab or one completed subject. Empty is not vacuous completion. */
export function getRegistrationContactCaseClosure(input: Readonly<{
  tracks: readonly RegistrationContactTrack[]
  explicitWholeCancelled?: boolean
}>): RegistrationContactCaseClosure {
  assertTracks(input.tracks)
  if (input.explicitWholeCancelled !== undefined && typeof input.explicitWholeCancelled !== "boolean") {
    fail("registration_contact_cancellation_invalid")
  }
  const current = input.tracks.filter((track) => track.archivedAt === undefined || track.archivedAt === null)
  const currentTrackIds = current.map((track) => track.id)
  if (input.explicitWholeCancelled === true) return { allPhasesClosed: true, reason: "whole_case_cancelled", currentTrackIds }
  if (current.length === 0) return { allPhasesClosed: false, reason: "no_current_tracks", currentTrackIds }
  const allPhasesClosed = current.every((track) => TERMINAL_STATUSES.has(track.workflowStatus))
  return { allPhasesClosed, reason: allPhasesClosed ? "all_current_tracks_terminal" : "open_tracks", currentTrackIds }
}

export type RegistrationContactFingerprint = Readonly<{ version: 1; digest: string }>
export type RegistrationContactReceipt = Readonly<{
  actorId: string
  requestKey: string
  fingerprint: RegistrationContactFingerprint
  result: Readonly<{
    revision: string
    generation: RegistrationContactGeneration
    phase: "open" | "closed"
    closureReason: RegistrationContactClosureReason | null
    parentContactPresent: boolean
    studentId: string | null
  }>
}>

export type RegistrationContactLifecycleState<Business = unknown> = Readonly<{
  caseId: string
  revision: string
  generation: RegistrationContactGeneration
  phase: "open" | "closed"
  tracks: readonly RegistrationContactTrack[]
  /** Legacy compatibility only. New collection is limited to a parent recipient. */
  studentPhone: string | null
  parentPhone: string | null
  studentId: string | null
  business: Business
  closureReason: RegistrationContactClosureReason | null
  receipts: readonly RegistrationContactReceipt[]
}>

export type RegistrationContactLifecycleCommand =
  | Readonly<{ kind: "close"; reason: "all_current_tracks_terminal" | "whole_case_cancelled" }>
  | Readonly<{ kind: "replace_tracks"; tracks: readonly RegistrationContactTrack[]; closeWhenLastTrackExcluded?: boolean }>
  | Readonly<{ kind: "reopen"; tracks: readonly RegistrationContactTrack[]; freshParentContact?: Readonly<{ source: "user_input"; parentPhone: string | null }> }>
  | Readonly<{ kind: "edit_contact"; source: "user_input"; parentPhone: string | null }>
  | Readonly<{ kind: "bind_student"; studentId: string }>

export type RegistrationContactLifecycleRequest = Readonly<{
  actorId: string
  requestKey: string
  /** Trusted controller supplies a keyed, canonical full-command digest; never a raw request JSON. */
  fingerprint: RegistrationContactFingerprint
  expectedRevision: string
  expectedGeneration: RegistrationContactGeneration
}>

export type RegistrationContactLifecycleEffects = Readonly<{
  contactErased: boolean
  invalidateContactDraft: boolean
  /** Archival, closure and reopening are not provider delivery requests. */
  shouldSendNotice: false
  suppressLegacyStageResend: true
}>

function parentContact(input: Readonly<{ source: "user_input"; parentPhone: string | null }>) {
  if (!input || input.source !== "user_input") fail("registration_contact_fresh_input_required")
  if (Object.keys(input).some((key) => key !== "source" && key !== "parentPhone")) fail("registration_contact_fresh_input_required")
  if (input.parentPhone === null) return null
  if (typeof input.parentPhone !== "string" || /[\r\n\u0000]/.test(input.parentPhone)) fail("registration_contact_input_invalid")
  return input.parentPhone.trim() || null
}

function assertRequest(request: RegistrationContactLifecycleRequest) {
  assertUuid(request.actorId)
  assertCounter(request.expectedRevision)
  assertCounter(request.expectedGeneration)
  if (typeof request.requestKey !== "string" || !request.requestKey.trim() || request.requestKey.length > 200
    || /[\u0000-\u001f\u007f]/.test(request.requestKey)) fail("registration_contact_request_key_invalid")
  if (!request.fingerprint || request.fingerprint.version !== 1 || typeof request.fingerprint.digest !== "string"
    || !/^[0-9a-f]{64}$/.test(request.fingerprint.digest)
    || Object.keys(request.fingerprint).some((key) => key !== "version" && key !== "digest")) {
    fail("registration_contact_fingerprint_invalid")
  }
}

function assertState<Business>(state: RegistrationContactLifecycleState<Business>) {
  assertUuid(state.caseId)
  assertCounter(state.revision)
  assertCounter(state.generation)
  assertTracks(state.tracks)
  if (state.studentId !== null) assertUuid(state.studentId)
  if (state.phase !== "open" && state.phase !== "closed") fail("registration_contact_state_invalid")
  if (state.closureReason !== null && !CLOSURE_REASONS.has(state.closureReason)) fail("registration_contact_state_invalid")
  if ((state.parentPhone !== null && typeof state.parentPhone !== "string")
    || (state.studentPhone !== null && typeof state.studentPhone !== "string")) fail("registration_contact_state_invalid")
  if (state.phase === "closed" && (state.parentPhone !== null || state.studentPhone !== null || state.closureReason === null)) {
    fail("registration_contact_closed_state_invalid")
  }
  if (state.phase === "open" && state.closureReason !== null) fail("registration_contact_state_invalid")
  if (!Array.isArray(state.receipts)) fail("registration_contact_state_invalid")
  const receiptKeys = new Map<string, Set<string>>()
  for (const receipt of state.receipts) {
    if (!receipt || Object.keys(receipt).some((key) => !["actorId", "requestKey", "fingerprint", "result"].includes(key))) {
      fail("registration_contact_receipt_invalid")
    }
    const result = receipt.result
    if (!result || Object.keys(result).some((key) => !["revision", "generation", "phase", "closureReason", "parentContactPresent", "studentId"].includes(key))
      || typeof result.parentContactPresent !== "boolean" || !["open", "closed"].includes(result.phase)
      || (result.phase === "open" && result.closureReason !== null)
      || (result.phase === "closed" && (result.closureReason === null || !CLOSURE_REASONS.has(result.closureReason) || result.parentContactPresent))) {
      fail("registration_contact_receipt_invalid")
    }
    assertRequest({ ...receipt, expectedRevision: result.revision, expectedGeneration: result.generation })
    if (result.studentId !== null) assertUuid(result.studentId)
    const actorKeys = receiptKeys.get(receipt.actorId) ?? new Set<string>()
    if (actorKeys.has(receipt.requestKey)) fail("registration_contact_receipt_duplicate")
    actorKeys.add(receipt.requestKey)
    receiptKeys.set(receipt.actorId, actorKeys)
  }
}

/** Creates an open generation only; loading a persisted state requires the controller's separate contract validation. */
export function createRegistrationContactLifecycle<Business>(input: Readonly<{
  caseId: string
  tracks: readonly RegistrationContactTrack[]
  studentId?: string | null
  business: Business
  freshParentContact?: Readonly<{ source: "user_input"; parentPhone: string | null }>
}>): RegistrationContactLifecycleState<Business> {
  assertTracks(input.tracks)
  const state: RegistrationContactLifecycleState<Business> = {
    caseId: input.caseId,
    revision: "1",
    generation: "1",
    phase: "open",
    tracks: input.tracks.map((track) => ({ ...track })),
    parentPhone: input.freshParentContact ? parentContact(input.freshParentContact) : null,
    studentPhone: null,
    studentId: input.studentId ?? null,
    business: input.business,
    closureReason: null,
    receipts: [],
  }
  assertState(state)
  return state
}

/** Returns new state without altering business records. An exact replay returns the original metadata and never rewinds current state. */
export function applyRegistrationContactLifecycleTransition<Business>(
  state: RegistrationContactLifecycleState<Business>,
  command: RegistrationContactLifecycleCommand,
  request: RegistrationContactLifecycleRequest,
): Readonly<{
  state: RegistrationContactLifecycleState<Business>
  receipt: RegistrationContactReceipt
  replayed: boolean
  effects: RegistrationContactLifecycleEffects
}> {
  assertState(state)
  assertRequest(request)
  const previousReceipt = state.receipts.find((receipt) => receipt.actorId === request.actorId && receipt.requestKey === request.requestKey)
  const noEffects: RegistrationContactLifecycleEffects = {
    contactErased: false, invalidateContactDraft: false, shouldSendNotice: false, suppressLegacyStageResend: true,
  }
  if (previousReceipt) {
    if (previousReceipt.fingerprint.version !== request.fingerprint.version || previousReceipt.fingerprint.digest !== request.fingerprint.digest) {
      fail("registration_contact_request_key_conflict")
    }
    return { state, receipt: previousReceipt, replayed: true, effects: noEffects }
  }
  if (state.generation !== request.expectedGeneration) fail("registration_contact_generation_conflict")
  if (state.revision !== request.expectedRevision) fail("registration_contact_revision_conflict")

  // Reject a write before deriving contact/track changes; exact replays above remain read-only at the limit.
  const nextRevision = increment(state.revision, "revision")
  const nextGeneration = command.kind === "reopen" ? increment(state.generation, "generation") : state.generation

  let next = { ...state }
  let invalidateContactDraft = false
  const close = (reason: RegistrationContactClosureReason) => {
    if (state.phase !== "open") fail("registration_contact_already_closed")
    next = { ...next, phase: "closed", closureReason: reason, parentPhone: null, studentPhone: null }
    invalidateContactDraft = true
  }
  switch (command.kind) {
    case "close": {
      const closure = getRegistrationContactCaseClosure({ tracks: state.tracks, explicitWholeCancelled: command.reason === "whole_case_cancelled" })
      if (!closure.allPhasesClosed || closure.reason !== command.reason) fail("registration_contact_case_not_closed")
      close(command.reason)
      break
    }
    case "replace_tracks": {
      if (state.phase !== "open") fail("registration_contact_reopen_required")
      assertTracks(command.tracks)
      const ids = new Set(command.tracks.map((track) => track.id))
      if (state.tracks.some((track) => !ids.has(track.id))) fail("registration_contact_track_history_required")
      next = { ...next, tracks: command.tracks.map((track) => ({ ...track })) }
      const closure = getRegistrationContactCaseClosure({ tracks: command.tracks })
      if (closure.allPhasesClosed) close("all_current_tracks_terminal")
      else if (closure.reason === "no_current_tracks" && command.closeWhenLastTrackExcluded === true) {
        if (getRegistrationContactCaseClosure({ tracks: state.tracks }).currentTrackIds.length === 0) {
          fail("registration_contact_last_track_transition_required")
        }
        close("last_current_track_excluded")
      }
      else if (closure.reason === "no_current_tracks") fail("registration_contact_last_track_transition_required")
      break
    }
    case "reopen": {
      if (state.phase !== "closed") fail("registration_contact_already_open")
      assertTracks(command.tracks)
      const closure = getRegistrationContactCaseClosure({ tracks: command.tracks })
      if (closure.allPhasesClosed || closure.currentTrackIds.length === 0) fail("registration_contact_open_track_required")
      const ids = new Set(command.tracks.map((track) => track.id))
      if (state.tracks.some((track) => !ids.has(track.id))) fail("registration_contact_track_history_required")
      next = {
        ...next, generation: nextGeneration, phase: "open", closureReason: null,
        tracks: command.tracks.map((track) => ({ ...track })),
        parentPhone: command.freshParentContact ? parentContact(command.freshParentContact) : null,
        studentPhone: null,
      }
      invalidateContactDraft = true
      break
    }
    case "edit_contact":
      if (state.phase !== "open") fail("registration_contact_closed_edit_denied")
      next = { ...next, parentPhone: parentContact({ source: command.source, parentPhone: command.parentPhone }), studentPhone: null }
      break
    case "bind_student":
      assertUuid(command.studentId)
      if (state.studentId !== null && state.studentId !== command.studentId) fail("registration_contact_student_binding_conflict")
      next = { ...next, studentId: command.studentId }
      break
    default:
      fail("registration_contact_command_invalid")
  }
  next = { ...next, revision: nextRevision }
  const receipt: RegistrationContactReceipt = {
    actorId: request.actorId,
    requestKey: request.requestKey,
    fingerprint: { version: request.fingerprint.version, digest: request.fingerprint.digest },
    result: {
      revision: next.revision, generation: next.generation, phase: next.phase,
      closureReason: next.closureReason, parentContactPresent: next.parentPhone !== null, studentId: next.studentId,
    },
  }
  next = { ...next, receipts: [...state.receipts, receipt] }
  assertState(next)
  return {
    state: next, receipt, replayed: false,
    effects: { ...noEffects, contactErased: (state.parentPhone !== null || state.studentPhone !== null)
      && next.parentPhone === null && next.studentPhone === null, invalidateContactDraft },
  }
}

/** Only typed registration contact slots are changed; identity, notes and business arrays keep their exact references. */
export type ClearedRegistrationTemporaryContactFields<T extends object> = {
  [Key in keyof T]: Key extends "parentPhone" | "studentPhone" | "parent_phone" | "student_phone" ? null : T[Key]
}

export function clearRegistrationTemporaryContactFields<T extends object>(record: T): ClearedRegistrationTemporaryContactFields<T> {
  const next = { ...record }
  for (const key of ["parentPhone", "studentPhone", "parent_phone", "student_phone"] as const) {
    if (Object.prototype.hasOwnProperty.call(record, key)) Object.assign(next, { [key]: null })
  }
  return next as ClearedRegistrationTemporaryContactFields<T>
}
