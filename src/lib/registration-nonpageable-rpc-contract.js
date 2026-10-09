const MUTATE = "mutate_registration_contact_v1"
const FENCE = "read_registration_contact_message_fence_v1"
const BUNDLE = "resolve_registration_customer_message_bundle_source_v1"
const PREVIEW = "read_registration_contact_bundle_preview_v1"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const MAX_COUNTER = "9223372036854775807"
const SUBJECTS = ["영어", "수학", "과학"]
const STATUSES = ["inquiry", "level_test_requested", "consultation_requested", "consultation_completed", "waiting_current_class", "waiting_new_class", "waiting_next_opening", "observation_requested", "observation_feedback_pending", "observation_completed", "enrollment_requested", "payment_in_progress", "registered", "not_registered", "inquiry_only"]
const WRITABLE_STATUSES = STATUSES.filter(status => !["observation_feedback_pending", "observation_completed"].includes(status))
const PIPELINES = ["inquiry", "migration_review", "level_test_scheduled", "level_test_in_progress", "consultation_waiting", "visit_consultation_scheduled", "waiting", "enrollment_decided", "enrollment_processing", "registered", "not_registered", "inquiry_closed"]
const REASONS = ["all_current_tracks_terminal", "whole_case_cancelled", "last_current_track_excluded"]
const WAITING = ["", "current_class", "current_term_opening", "next_term_opening"]
const RETAKE = ["", "required", "not_required"]
const COMMON = ["studentName", "schoolGrade", "schoolName", "parentPhone", "campus", "inquiryAt", "requestNote", "priority"]
const PAYLOADS = Object.freeze({
  create: [...COMMON, "subjects"], update_common: [...COMMON, "expectedCommonRevision"],
  save_inquiry: [...COMMON, "expectedCommonRevision", "expectedSubjects", "subjects"],
  set_workflow_status: ["trackId", "workflowStatus", "expectedWorkflowRevision"],
  waiting_details: ["trackId", "waitingKind", "classId", "retakeDecision"],
  reopen: ["trackId", "destination", "reason"], close: ["reason"],
  archive: ["expectedSubjects", "subjects"], unarchive: ["expectedSubjects", "subjects"],
  bind_student: ["studentId"],
})
const BUNDLE_KINDS = ["level_test_booking_bundle", "visit_consultation_booking_bundle", "observation_booking_bundle", "level_test_reminder_bundle", "visit_consultation_reminder_bundle", "observation_reminder_bundle"]
const MESSAGE_KINDS = ["level_test_booking", "visit_consultation_booking", "appointment_reminder", "waiting_notice", "admission_application", "observation_booking", "observation_reminder", ...BUNDLE_KINDS]
const MUTATE_ARGUMENTS = ["p_actor_id", "p_command", "p_task_id", "p_request_key", "p_expected_generation", "p_expected_revision", "p_payload", "p_request_hmac"]
const CONTACT_KEYS = ["version", "taskId", "revision", "generation", "phase", "closureReason", "closedAt", "parentPhone", "studentId", "commonRevision", "allPhasesClosed", "currentTrackIds"]
const RESULT_KEYS = ["taskId", "trackId", "studentId", "classId", "commonRevision", "workflowRevision", "workflowStatus", "workflowStatusEnteredAt", "waitingKind", "retakeDecision", "changed", "subjects", "sourceEventIds", "enrollmentFinalization", "tracks", "contactState"]
const RESULT_REQUIRED = Object.freeze({
  create: ["taskId", "commonRevision", "subjects", "tracks"], update_common: ["taskId", "commonRevision"],
  save_inquiry: ["taskId", "commonRevision", "subjects", "tracks"],
  set_workflow_status: ["trackId", "workflowStatus", "workflowRevision", "workflowStatusEnteredAt", "enrollmentFinalization"],
  reopen: ["trackId", "workflowStatus", "workflowRevision", "workflowStatusEnteredAt", "enrollmentFinalization"],
  waiting_details: ["trackId", "waitingKind", "classId", "retakeDecision"], close: ["taskId", "changed"],
  archive: ["taskId", "subjects", "tracks"], unarchive: ["taskId", "subjects", "tracks"],
  bind_student: ["taskId", "studentId", "changed"],
})
const TRACK_KEYS = ["id", "taskId", "subject", "workflowStatus", "workflowRevision", "status", "archivedAt", "directorProfileId", "directorAssignmentSource", "directorAssignmentRuleKey", "waitingKind", "levelTestRetakeDecision", "migrationReviewRequired", "stageEnteredAt", "workflowStatusEnteredAt"]

function invalid() { throw new Error("registration_rpc_contract_invalid") }
function requireValue(condition) { if (!condition) invalid() }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function keys(value, allowed, required = allowed) {
  requireValue(record(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => own(value, key)))
}
function uuid(value) { return typeof value === "string" && value.length === 36 && UUID.test(value) }
function sameUuid(left, right) { return uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase() }
function counter(value) { return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && (value.length < 19 || value <= MAX_COUNTER) }
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 }
function integer(value) { return positiveInteger(value) && value <= 2147483647 }
function text(value, nonempty = false) { return typeof value === "string" && value.length <= 500 && (!nonempty || value.trim().length > 0) && !/[\u0000\u007f]/.test(value) }
function timestamp(value) { return typeof value === "string" && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) }
function date(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
function nullable(value, predicate) { return value === null || predicate(value) }
function uniqueList(value, cap, predicate, identity = item => item) {
  requireValue(Array.isArray(value) && value.length <= cap && value.every(predicate) && new Set(value.map(identity)).size === value.length)
}
function uuidList(value, cap) { uniqueList(value, cap, uuid, item => item.toLowerCase()) }
function subjects(value) { uniqueList(value, 3, item => SUBJECTS.includes(item)) }

/** Technical transport budgets, not a claim about business cardinality or SQL execution cost. */
function safeJson(value, mutationInput = false) {
  const ancestors = new Set()
  let nodes = 0
  function visit(item, depth, path) {
    requireValue(depth <= 8 && ++nodes <= 128000)
    if (item === null || typeof item === "boolean") return
    if (typeof item === "number") { requireValue(Number.isSafeInteger(item)); return }
    if (typeof item === "string") {
      const maximum = mutationInput && path === "p_payload.requestNote" ? 20000 : mutationInput && path === "p_payload.parentPhone" ? 40 : 500
      requireValue(item.length <= maximum && !/[\u0000\u007f]/.test(item)); return
    }
    requireValue(typeof item === "object" && !ancestors.has(item))
    requireValue(Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype : record(item))
    ancestors.add(item)
    const properties = Reflect.ownKeys(item)
    for (const key of properties) {
      if (Array.isArray(item) && key === "length") continue
      requireValue(typeof key === "string" && !["__proto__", "prototype", "constructor"].includes(key))
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      requireValue(descriptor?.enumerable === true && own(descriptor, "value"))
      if (Array.isArray(item)) requireValue(/^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length)
      visit(descriptor.value, depth + 1, path ? `${path}.${key}` : key)
    }
    if (Array.isArray(item)) requireValue(properties.length === item.length + 1)
    ancestors.delete(item)
  }
  requireValue(record(value))
  visit(value, 1, "")
  requireValue(new TextEncoder().encode(JSON.stringify(value)).byteLength <= 128000)
}

function mutationArguments(args) {
  keys(args, MUTATE_ARGUMENTS)
  requireValue(uuid(args.p_actor_id) && uuid(args.p_request_key) && HASH.test(args.p_request_hmac) && typeof args.p_request_hmac === "string")
  requireValue(typeof args.p_command === "string" && own(PAYLOADS, args.p_command))
  const create = args.p_command === "create"
  requireValue(create ? args.p_task_id === null && args.p_expected_generation === null && args.p_expected_revision === null : uuid(args.p_task_id) && counter(args.p_expected_generation) && counter(args.p_expected_revision))
  const fields = PAYLOADS[args.p_command]
  const payload = args.p_payload
  keys(payload, fields, fields.filter(key => key !== "parentPhone"))
  for (const [key, value] of Object.entries(payload)) {
    if (["subjects", "expectedSubjects"].includes(key)) { subjects(value); continue }
    if (["expectedCommonRevision", "expectedWorkflowRevision"].includes(key)) { requireValue(integer(value)); continue }
    if (["trackId", "studentId"].includes(key)) { requireValue(uuid(value)); continue }
    if (key === "classId") { requireValue(value === null || value === "" || uuid(value)); continue }
    if (["parentPhone", "waitingKind", "retakeDecision", "inquiryAt"].includes(key) && value === null) continue
    requireValue(typeof value === "string")
    if (key === "parentPhone") requireValue(value.length <= 40 && !/[^0-9+() .-]/.test(value))
    if (key === "workflowStatus") requireValue(WRITABLE_STATUSES.includes(value))
    if (key === "waitingKind") requireValue(WAITING.includes(value))
    if (key === "retakeDecision") requireValue(RETAKE.includes(value))
    if (key === "destination") requireValue(["inquiry", "consultation_waiting"].includes(value))
    if (key === "reason") requireValue(args.p_command === "close" ? REASONS.includes(value) : value.trim().length > 0)
    if (key === "priority") requireValue(["", "low", "normal", "high", "urgent"].includes(value))
    if (key === "inquiryAt" && value !== "") requireValue(timestamp(value))
  }
}
function fenceArguments(args) {
  keys(args, ["p_actor_profile_id", "p_message_kind", "p_source_id"])
  requireValue(uuid(args.p_actor_profile_id) && uuid(args.p_source_id) && MESSAGE_KINDS.includes(args.p_message_kind))
}
function bundleArguments(args) {
  keys(args, ["p_message_kind", "p_task_id", "p_service_date"])
  requireValue(BUNDLE_KINDS.includes(args.p_message_kind) && uuid(args.p_task_id) && nullable(args.p_service_date, date))
  requireValue(args.p_message_kind.endsWith("_reminder_bundle") ? date(args.p_service_date) : args.p_service_date === null)
}
function contact(value, taskId) {
  keys(value, CONTACT_KEYS)
  requireValue(value.version === 1 && sameUuid(value.taskId, taskId) && counter(value.revision) && counter(value.generation) && ["open", "closed"].includes(value.phase))
  requireValue(nullable(value.closureReason, item => REASONS.includes(item)) && nullable(value.closedAt, timestamp) && value.parentPhone === null && nullable(value.studentId, uuid) && integer(value.commonRevision) && typeof value.allPhasesClosed === "boolean")
  uuidList(value.currentTrackIds, 3)
  requireValue(value.phase === "open" ? value.closureReason === null && value.closedAt === null && !value.allPhasesClosed : value.closureReason !== null && (value.closedAt !== null || value.closureReason !== "last_current_track_excluded"))
}
function track(value, taskId) {
  keys(value, TRACK_KEYS, ["id", "taskId", "subject", "workflowStatus", "workflowRevision", "status", "archivedAt"])
  requireValue(uuid(value.id) && sameUuid(value.taskId, taskId) && SUBJECTS.includes(value.subject) && STATUSES.includes(value.workflowStatus) && integer(value.workflowRevision) && PIPELINES.includes(value.status) && nullable(value.archivedAt, timestamp))
  if (own(value, "directorProfileId")) requireValue(nullable(value.directorProfileId, uuid))
  for (const [key, allowed] of [["directorAssignmentSource", ["", "default", "manual", "migration"]], ["waitingKind", WAITING], ["levelTestRetakeDecision", RETAKE]]) {
    if (own(value, key)) requireValue(nullable(value[key], item => allowed.includes(item)))
  }
  if (own(value, "directorAssignmentRuleKey")) requireValue(nullable(value.directorAssignmentRuleKey, item => typeof item === "string" && /^[a-zA-Z0-9_:.-]{0,200}$/.test(item)))
  if (own(value, "migrationReviewRequired")) requireValue(typeof value.migrationReviewRequired === "boolean")
  for (const key of ["stageEnteredAt", "workflowStatusEnteredAt"]) if (own(value, key)) requireValue(nullable(value[key], timestamp))
}
function mutationResult(data, args) {
  keys(data, ["version", "taskId", "requestKey", "command", "replayed", "result"])
  requireValue(data.version === 1 && uuid(data.taskId) && sameUuid(data.requestKey, args.p_request_key) && data.command === args.p_command && typeof data.replayed === "boolean" && (args.p_task_id === null || sameUuid(data.taskId, args.p_task_id)))
  const result = data.result
  keys(result, RESULT_KEYS, ["contactState", ...RESULT_REQUIRED[args.p_command]])
  contact(result.contactState, data.taskId)
  for (const key of ["taskId", "trackId", "studentId", "classId"]) if (own(result, key)) requireValue(nullable(result[key], uuid))
  if (own(result, "taskId")) requireValue(sameUuid(result.taskId, data.taskId))
  if (own(args.p_payload, "trackId")) requireValue(sameUuid(result.trackId, args.p_payload.trackId))
  if (args.p_command === "set_workflow_status") requireValue(result.workflowStatus === args.p_payload.workflowStatus)
  if (args.p_command === "reopen") requireValue(result.workflowStatus === (args.p_payload.destination === "inquiry" ? "inquiry" : "consultation_requested"))
  for (const key of ["commonRevision", "workflowRevision"]) if (own(result, key)) requireValue(integer(result[key]))
  if (own(result, "workflowStatus")) requireValue(STATUSES.includes(result.workflowStatus))
  if (own(result, "workflowStatusEnteredAt")) requireValue(timestamp(result.workflowStatusEnteredAt))
  for (const [key, allowed] of [["waitingKind", WAITING], ["retakeDecision", RETAKE]]) if (own(result, key)) requireValue(nullable(result[key], item => allowed.includes(item)))
  if (own(result, "changed")) requireValue(typeof result.changed === "boolean")
  if (own(result, "subjects")) subjects(result.subjects)
  if (own(result, "sourceEventIds")) uuidList(result.sourceEventIds, 50)
  if (own(result, "enrollmentFinalization") && result.enrollmentFinalization !== null) {
    const item = result.enrollmentFinalization
    keys(item, ["trackId", "studentId", "batchId", "enrollmentIds", "changed"])
    requireValue(uuid(item.trackId) && uuid(item.studentId) && nullable(item.batchId, uuid) && typeof item.changed === "boolean")
    uuidList(item.enrollmentIds, 50)
  }
  if (own(result, "tracks")) {
    requireValue(Array.isArray(result.tracks) && result.tracks.length <= 50)
    result.tracks.forEach(item => track(item, data.taskId))
    uniqueList(result.tracks, 50, () => true, item => item.id.toLowerCase())
    uniqueList(result.tracks, 50, () => true, item => item.subject)
  }
  if (args.p_command === "bind_student") {
    keys(result, ["taskId", "studentId", "changed", "contactState"])
    requireValue(sameUuid(result.studentId, args.p_payload.studentId) && sameUuid(result.contactState.studentId, result.studentId) && result.contactState.generation === args.p_expected_generation && BigInt(result.contactState.revision) > BigInt(args.p_expected_revision))
  }
}
function fenceResult(data, args) {
  keys(data, ["version", "taskId", "sourceId", "messageKind", "contactPhase", "contactGeneration", "allPhasesClosed", "sourcePhaseOpen", "canonicalAppointmentKind"])
  requireValue(data.version === 1 && uuid(data.taskId) && sameUuid(data.sourceId, args.p_source_id) && data.messageKind === args.p_message_kind && ["open", "closed"].includes(data.contactPhase) && counter(data.contactGeneration) && typeof data.allPhasesClosed === "boolean" && typeof data.sourcePhaseOpen === "boolean" && nullable(data.canonicalAppointmentKind, item => ["level_test", "visit_consultation", "observation_class"].includes(item)))
  if (BUNDLE_KINDS.includes(data.messageKind)) requireValue(sameUuid(data.taskId, args.p_source_id))
}
function bundleResult(data, args, preview = false) {
  // The legacy server-private response includes a recipient; preview excludes
  // that field. The separate contact fence remains the authority for its use.
  keys(data, ["messageKind", "sourceId", "bundleId", "bundleRevision", "taskId", "reservationKind", "deliveryKind", "serviceDate", "recipientRevision", "sourceFingerprint", "studentName", ...(preview ? [] : ["parentPhoneDigits"]), "items"])
  const reservation = args.p_message_kind.startsWith("level_test_") ? "level_test" : args.p_message_kind.startsWith("visit_consultation_") ? "visit_consultation" : "observation"
  const delivery = args.p_message_kind.endsWith("_reminder_bundle") ? "reminder" : "booking"
  requireValue(data.messageKind === args.p_message_kind && sameUuid(data.taskId, args.p_task_id) && sameUuid(data.sourceId, args.p_task_id) && uuid(data.bundleId) && positiveInteger(data.bundleRevision) && positiveInteger(data.recipientRevision) && data.reservationKind === reservation && data.deliveryKind === delivery && data.serviceDate === args.p_service_date && HASH.test(data.sourceFingerprint) && text(data.studentName, true))
  if (!preview) requireValue(typeof data.parentPhoneDigits === "string" && /^01(?:0|1|[6-9])[0-9]{7,8}$/.test(data.parentPhoneDigits))
  requireValue(Array.isArray(data.items) && data.items.length >= 1 && data.items.length <= 3)
  for (const item of data.items) {
    keys(item, ["sourceKind", "sourceId", "sourceRevision", "trackId", "activityId", "subject", "scheduledAt", "serviceDate", "place", "className", "teacherName", "sourceFactHash"])
    requireValue(item.sourceKind === reservation && uuid(item.sourceId) && uuid(item.trackId) && nullable(item.activityId, uuid) && SUBJECTS.includes(item.subject) && timestamp(item.scheduledAt) && date(item.serviceDate) && (delivery !== "reminder" || item.serviceDate === args.p_service_date) && ["본관", "별관"].includes(item.place) && nullable(item.className, value => text(value, true)) && nullable(item.teacherName, value => text(value, true)) && (item.className === null) === (item.teacherName === null) && HASH.test(item.sourceFactHash))
    if (preview) requireValue(reservation === "observation"
      ? item.activityId === null && text(item.className, true) && text(item.teacherName, true)
      : uuid(item.activityId) && item.className === null && item.teacherName === null)
    const revision = item.sourceRevision
    keys(revision, reservation === "observation" ? ["appointmentNotificationRevision", "observationRevision", "bookingFactHash"] : ["appointmentNotificationRevision"])
    requireValue(integer(revision.appointmentNotificationRevision))
    if (reservation === "observation") requireValue(positiveInteger(revision.observationRevision) && HASH.test(revision.bookingFactHash))
  }
  uniqueList(data.items, 3, () => true, item => item.subject)
  uniqueList(data.items, 3, () => true, item => item.trackId.toLowerCase())
  uniqueList(data.items, 3, () => true, item => `${item.sourceKind}:${item.sourceId.toLowerCase()}:${item.trackId.toLowerCase()}`)
}

/** Validate a reviewed, non-pageable RPC request before starting its transport. */
export function assertRegistrationNonpageableRpcArguments(rpcName, args) {
  try {
    requireValue([MUTATE, FENCE, BUNDLE, PREVIEW].includes(rpcName))
    safeJson(args, rpcName === MUTATE)
    if (rpcName === MUTATE) mutationArguments(args)
    else if (rpcName === FENCE) fenceArguments(args)
    else bundleArguments(args)
    return args
  } catch { invalid() }
}

/** Validate producer output against the same request scope; never project or copy it. */
export function assertRegistrationNonpageableRpcResult(rpcName, data, args) {
  try {
    assertRegistrationNonpageableRpcArguments(rpcName, args)
    safeJson(data)
    if (rpcName === MUTATE) mutationResult(data, args)
    else if (rpcName === FENCE) fenceResult(data, args)
    else bundleResult(data, args, rpcName === PREVIEW)
    return data
  } catch { invalid() }
}
