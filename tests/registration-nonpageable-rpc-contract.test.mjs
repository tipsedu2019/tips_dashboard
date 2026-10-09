import assert from "node:assert/strict"
import test from "node:test"
import { assertRegistrationNonpageableRpcArguments as argumentsContract, assertRegistrationNonpageableRpcResult as resultContract } from "../src/lib/registration-nonpageable-rpc-contract.js"
import { normalizeRegistrationCaseContact } from "../src/features/tasks/registration-contact-client.ts"
import { parseRegistrationCustomerMessageBundleSource, parseRegistrationCustomerMessageBundlePreviewSource } from "../src/features/tasks/server/registration-customer-message-bundle-source.ts"
import { parseRegistrationCustomerMessageContactFence } from "../src/features/tasks/server/registration-customer-message-contact-fence.ts"

const MUTATE = "mutate_registration_contact_v1"
const FENCE = "read_registration_contact_message_fence_v1"
const BUNDLE = "resolve_registration_customer_message_bundle_source_v1"
const PREVIEW = "read_registration_contact_bundle_preview_v1"
const ACTOR = id(1), TASK = id(2), TRACK = id(3), KEY = id(4), STUDENT = id(5), SOURCE = id(6)
const HASH = "a".repeat(64)
const STAMP = "2026-10-09T09:00:00.000Z"
const COMMON = { studentName: "합성 학생", schoolGrade: "중1", schoolName: "합성 학교", parentPhone: null, campus: "본관", inquiryAt: null, requestNote: "합성 메모", priority: "normal" }
const payloads = {
  create: { ...COMMON, subjects: ["영어", "수학"] },
  update_common: { ...COMMON, expectedCommonRevision: 3 },
  save_inquiry: { ...COMMON, expectedCommonRevision: 3, expectedSubjects: ["영어"], subjects: ["영어", "수학"] },
  set_workflow_status: { trackId: TRACK, workflowStatus: "registered", expectedWorkflowRevision: 3 },
  waiting_details: { trackId: TRACK, waitingKind: null, classId: null, retakeDecision: null },
  reopen: { trackId: TRACK, destination: "inquiry", reason: "합성 재개" },
  close: { reason: "whole_case_cancelled" }, archive: { expectedSubjects: ["영어"], subjects: [] },
  unarchive: { expectedSubjects: [], subjects: ["영어"] }, bind_student: { studentId: STUDENT },
}
function id(number) { return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}` }
function clone(value) { return structuredClone(value) }
function mutation(command = "set_workflow_status") {
  const create = command === "create"
  return { p_actor_id: ACTOR, p_command: command, p_task_id: create ? null : TASK, p_request_key: KEY,
    p_expected_generation: create ? null : "2", p_expected_revision: create ? null : "8", p_payload: clone(payloads[command]), p_request_hmac: HASH }
}
function contact(overrides = {}) { return { version: 1, taskId: TASK, revision: "9", generation: "2", phase: "open", closureReason: null, closedAt: null, parentPhone: null, studentId: null, commonRevision: 3, allPhasesClosed: false, currentTrackIds: [TRACK], ...overrides } }
function track(overrides = {}) { return { id: TRACK, taskId: TASK, subject: "영어", workflowStatus: "inquiry", workflowRevision: 3, status: "inquiry", archivedAt: null,
  directorProfileId: null, directorAssignmentSource: null, directorAssignmentRuleKey: null, waitingKind: null, levelTestRetakeDecision: null, migrationReviewRequired: false, stageEnteredAt: STAMP, ...overrides } }
function receipt(args = mutation(), result = {}) {
  const common = { taskId: TASK, commonRevision: 3 }
  const subjects = { subjects: ["영어"], tracks: [track()] }
  const workflow = { trackId: TRACK, workflowStatus: args.p_command === "reopen" ? "inquiry" : args.p_payload.workflowStatus, workflowRevision: 4, workflowStatusEnteredAt: STAMP, enrollmentFinalization: null }
  const defaults = { create: { ...common, ...subjects }, update_common: common, save_inquiry: { ...common, ...subjects }, set_workflow_status: workflow, reopen: workflow,
    waiting_details: { trackId: TRACK, waitingKind: null, classId: null, retakeDecision: null }, close: { taskId: TASK, changed: true }, archive: { taskId: TASK, ...subjects }, unarchive: { taskId: TASK, ...subjects }, bind_student: { taskId: TASK, studentId: STUDENT, changed: true } }
  return { version: 1, taskId: TASK, requestKey: KEY, command: args.p_command, replayed: false, result: { ...defaults[args.p_command], contactState: contact(args.p_command === "bind_student" ? { studentId: STUDENT } : {}), ...result } }
}
function fenceArgs(kind = "level_test_booking", source = SOURCE) { return { p_actor_profile_id: ACTOR, p_message_kind: kind, p_source_id: source } }
function fence(args = fenceArgs()) { return { version: 1, taskId: TASK, sourceId: args.p_source_id, messageKind: args.p_message_kind, contactPhase: "open", contactGeneration: "2", allPhasesClosed: false, sourcePhaseOpen: true, canonicalAppointmentKind: "level_test" } }
function bundleArgs(kind = "level_test_booking_bundle") { return { p_message_kind: kind, p_task_id: TASK, p_service_date: kind.endsWith("_reminder_bundle") ? "2026-10-10" : null } }
function bundle(args = bundleArgs()) {
  const kind = args.p_message_kind.startsWith("level_test_") ? "level_test" : args.p_message_kind.startsWith("visit_consultation_") ? "visit_consultation" : "observation"
  return { messageKind: args.p_message_kind, sourceId: TASK, bundleId: id(10), bundleRevision: 1, taskId: TASK, reservationKind: kind, deliveryKind: args.p_service_date ? "reminder" : "booking",
    serviceDate: args.p_service_date, recipientRevision: 1, sourceFingerprint: HASH, studentName: "합성 학생", parentPhoneDigits: "01000000000",
    items: [{ sourceKind: kind, sourceId: SOURCE, sourceRevision: kind === "observation" ? { appointmentNotificationRevision: 1, observationRevision: 2, bookingFactHash: HASH } : { appointmentNotificationRevision: 1 },
      trackId: TRACK, activityId: kind === "observation" ? null : id(7), subject: "영어", scheduledAt: STAMP, serviceDate: args.p_service_date ?? "2026-10-09", place: "본관", className: kind === "observation" ? "합성 수업" : null, teacherName: kind === "observation" ? "합성 강사" : null, sourceFactHash: HASH }] }
}
function rejects(callback) { assert.throws(callback, error => error instanceof Error && error.message === "registration_rpc_contract_invalid" && error.cause === undefined) }

test("all ten exact mutation request signatures preserve the original object without adding p_limit", () => {
  for (const name of Object.keys(payloads)) { const args = mutation(name); assert.equal(argumentsContract(MUTATE, args), args); assert.equal(Object.keys(args).length, 8); assert.equal("p_limit" in args, false) }
})
test("common-only edits may omit parentPhone; long multiline notes remain legitimate input", () => {
  const args = mutation("update_common"); delete args.p_payload.parentPhone; args.p_payload.requestNote = "가\n".repeat(10000)
  assert.equal(argumentsContract(MUTATE, args), args)
})
test("counter strings and positive int32 revision boundaries are canonical", () => {
  const args = mutation(); args.p_expected_generation = "9223372036854775807"; args.p_payload.expectedWorkflowRevision = 2147483647
  assert.equal(argumentsContract(MUTATE, args), args)
  for (const value of ["0", "01", "+1", "1.0", "9223372036854775808", 2, "1".repeat(20)]) { const bad = clone(args); bad.p_expected_generation = value; rejects(() => argumentsContract(MUTATE, bad)) }
  for (const value of [0, -1, 1.1, 2147483648, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) { const bad = clone(args); bad.p_payload.expectedWorkflowRevision = value; rejects(() => argumentsContract(MUTATE, bad)) }
})
test("request identity, creation scope, HMAC and exact argument fields fail closed", () => {
  for (const edit of [value => { value.p_actor_id = "actor" }, value => { value.p_task_id = null }, value => { value.p_request_key = "contact:key" }, value => { value.p_request_hmac = HASH.toUpperCase() }, value => { value.p_request_hmac = "a".repeat(65) }, value => { value.p_limit = 1 }, value => { delete value.p_payload }, value => { value.p_command = "__proto__" }]) { const args = mutation(); edit(args); rejects(() => argumentsContract(MUTATE, args)) }
  const create = mutation("create"); create.p_expected_revision = "1"; rejects(() => argumentsContract(MUTATE, create))
})
test("payload whitelist, required fields, enums, phone bound and unique subjects are enforced", () => {
  for (const edit of [value => { value.studentPhone = "01000000000" }, value => { delete value.studentName }, value => { value.subjects = ["영어", "영어"] }, value => { value.subjects = ["국어"] }, value => { value.parentPhone = "0".repeat(41) }, value => { value.parentPhone = "private@example.invalid" }, value => { value.requestNote = "가".repeat(20001) }, value => { value.schoolName = "가".repeat(501) }, value => { value.studentName = "bad\u0000text" }, value => { value.priority = "unknown" }, value => { value.inquiryAt = "2026-10-09" }]) { const args = mutation("create"); edit(args.p_payload); rejects(() => argumentsContract(MUTATE, args)) }
  for (const [name, field] of [["waiting_details", "waitingKind"], ["waiting_details", "retakeDecision"], ["reopen", "destination"], ["close", "reason"], ["set_workflow_status", "workflowStatus"]]) { const args = mutation(name); args.p_payload[field] = "unknown"; rejects(() => argumentsContract(MUTATE, args)) }
})
test("historical observation metadata remains readable but the final manual setter cannot write it", () => {
  for (const workflowStatus of ["observation_feedback_pending", "observation_completed"]) {
    const args = mutation("set_workflow_status")
    args.p_payload.workflowStatus = workflowStatus
    rejects(() => argumentsContract(MUTATE, args))
    const create = mutation("create")
    const data = receipt(create, { tracks: [track({ workflowStatus })] })
    assert.equal(resultContract(MUTATE, data, create), data)
  }
})
test("nullable producer ownership metadata survives the validator and real contact consumer", () => {
  const args = mutation(); const data = receipt(args, { taskId: TASK, trackId: TRACK, studentId: null, classId: null, tracks: [track()], enrollmentFinalization: null })
  assert.equal(resultContract(MUTATE, data, args), data)
  assert.deepEqual(normalizeRegistrationCaseContact(data.result.contactState, TASK), data.result.contactState)
  assert.equal(data.result.tracks[0].directorProfileId, null)
})
test("every final command output requires its business receipt fields before acknowledging success", () => {
  const required = { create: ["taskId", "commonRevision", "subjects", "tracks"], update_common: ["taskId", "commonRevision"], save_inquiry: ["taskId", "commonRevision", "subjects", "tracks"],
    set_workflow_status: ["trackId", "workflowStatus", "workflowRevision", "workflowStatusEnteredAt", "enrollmentFinalization"], reopen: ["trackId", "workflowStatus", "workflowRevision", "workflowStatusEnteredAt", "enrollmentFinalization"],
    waiting_details: ["trackId", "waitingKind", "classId", "retakeDecision"], close: ["taskId", "changed"], archive: ["taskId", "subjects", "tracks"], unarchive: ["taskId", "subjects", "tracks"], bind_student: ["taskId", "studentId", "changed"] }
  for (const [name, fields] of Object.entries(required)) {
    const args = mutation(name), data = receipt(args); assert.equal(resultContract(MUTATE, data, args), data)
    for (const field of [...fields, "contactState"]) { const bad = clone(data); delete bad.result[field]; rejects(() => resultContract(MUTATE, bad, args)) }
  }
})
test("track commands cannot acknowledge a different track or workflow target in the same case", () => {
  for (const name of ["waiting_details", "set_workflow_status", "reopen"]) { const args = mutation(name), data = receipt(args); data.result.trackId = id(20); rejects(() => resultContract(MUTATE, data, args)) }
  for (const name of ["set_workflow_status", "reopen"]) { const args = mutation(name), data = receipt(args); data.result.workflowStatus = "payment_in_progress"; rejects(() => resultContract(MUTATE, data, args)) }
})
test("legacy terminal and canceled closed metadata may legitimately have no timestamp", () => {
  for (const closureReason of ["all_current_tracks_terminal", "whole_case_cancelled"]) { const args = mutation(); const data = receipt(args, { contactState: contact({ phase: "closed", closureReason, closedAt: null, allPhasesClosed: true }) }); assert.equal(resultContract(MUTATE, data, args), data); normalizeRegistrationCaseContact(data.result.contactState, TASK) }
  const args = mutation(); const data = receipt(args, { contactState: contact({ phase: "closed", closureReason: "last_current_track_excluded" }) }); rejects(() => resultContract(MUTATE, data, args))
})
test("binding acknowledges only the requested student UUID and a newer revision in the same generation", () => {
  const args = mutation("bind_student"); const data = receipt(args, { taskId: TASK, studentId: STUDENT, changed: false, contactState: contact({ studentId: STUDENT }) })
  assert.equal(resultContract(MUTATE, data, args), data)
  for (const edit of [value => { value.result.studentId = id(20) }, value => { value.result.contactState.studentId = null }, value => { value.result.contactState.generation = "3" }, value => { value.result.contactState.revision = "8" }, value => { value.result.taskId = id(20) }, value => { delete value.result.changed }, value => { value.result.tracks = [] }]) { const bad = clone(data); edit(bad); rejects(() => resultContract(MUTATE, bad, args)) }
})
test("mutation response rejects unexpected fields, raw phones and mismatched envelope scope", () => {
  const args = mutation(); const data = receipt(args)
  for (const edit of [value => { value.rawSnapshot = "private" }, value => { value.result.parentPhone = "01000000000" }, value => { value.result.contactState.parentPhone = "01000000000" }, value => { value.result.contactState.studentName = "private" }, value => { value.taskId = id(20) }, value => { value.requestKey = id(20) }, value => { value.command = "close" }, value => { value.version = 2 }, value => { value.result.contactState.taskId = id(20) }, value => { value.result.contactState.allPhasesClosed = true }]) { const bad = clone(data); edit(bad); rejects(() => resultContract(MUTATE, bad, args)) }
})
test("metadata arrays accept 50 unique identifiers and reject excess, duplicates and unknown nested fields", () => {
  const args = mutation(); const data = receipt(args, { sourceEventIds: Array.from({ length: 50 }, (_, index) => id(100 + index)), enrollmentFinalization: { trackId: TRACK, studentId: STUDENT, batchId: null, changed: true, enrollmentIds: Array.from({ length: 50 }, (_, index) => id(200 + index)) } })
  assert.equal(resultContract(MUTATE, data, args), data)
  for (const path of ["sourceEventIds", "enrollmentIds"]) { for (const excess of [false, true]) { const bad = clone(data); const list = path === "sourceEventIds" ? bad.result.sourceEventIds : bad.result.enrollmentFinalization.enrollmentIds; list.push(excess ? id(500) : list[0]); rejects(() => resultContract(MUTATE, bad, args)) } }
  const bad = clone(data); bad.result.enrollmentFinalization.phone = "01000000000"; rejects(() => resultContract(MUTATE, bad, args))
})
test("track identity, task scope, subject uniqueness and nullable metadata bounds are enforced", () => {
  const args = mutation(); const data = receipt(args, { tracks: [track(), track({ id: id(8), subject: "수학" }), track({ id: id(9), subject: "과학" })], subjects: ["영어", "수학", "과학"] })
  assert.equal(resultContract(MUTATE, data, args), data)
  for (const edit of [value => { value.tracks[1].id = TRACK }, value => { value.tracks[1].subject = "영어" }, value => { value.tracks[0].taskId = id(20) }, value => { value.tracks[0].directorAssignmentRuleKey = "a".repeat(201) }, value => { value.tracks[0].directorAssignmentSource = "unreviewed" }, value => { value.tracks[0].parentPhone = null }, value => { value.contactState.currentTrackIds = [TRACK, TRACK] }, value => { value.contactState.currentTrackIds = [TRACK, id(8), id(9), id(11)] }]) { const bad = clone(data); edit(bad.result); rejects(() => resultContract(MUTATE, bad, args)) }
})
test("fence has exactly nine metadata fields, matches requested source/kind, and feeds its actual consumer", () => {
  for (const kind of ["level_test_booking", "visit_consultation_booking", "appointment_reminder", "waiting_notice", "admission_application", "observation_booking", "observation_reminder"]) { const args = fenceArgs(kind); const data = fence(args); assert.equal(argumentsContract(FENCE, args), args); assert.equal(resultContract(FENCE, data, args), data); parseRegistrationCustomerMessageContactFence(data, { taskId: TASK, sourceId: SOURCE, messageKind: kind }) }
  const args = fenceArgs("observation_booking_bundle", TASK); const data = { ...fence(args), canonicalAppointmentKind: "observation_class" }; assert.equal(resultContract(FENCE, data, args), data)
  for (const edit of [value => { value.parentPhone = null }, value => { value.sourceId = id(20) }, value => { value.messageKind = "waiting_notice" }, value => { value.taskId = id(20) }, value => { value.contactGeneration = "01" }, value => { value.canonicalAppointmentKind = "unknown" }]) { const bad = clone(data); edit(bad); rejects(() => resultContract(FENCE, bad, args)) }
})
test("closed or ineligible fences and a null canonical kind remain valid metadata without granting contact use", () => {
  const args = fenceArgs("waiting_notice"); const data = { ...fence(args), contactPhase: "closed", allPhasesClosed: true, sourcePhaseOpen: false, canonicalAppointmentKind: null }
  assert.equal(resultContract(FENCE, data, args), data)
  parseRegistrationCustomerMessageContactFence(data, { taskId: TASK, sourceId: SOURCE, messageKind: "waiting_notice" })
})
test("bundle request contracts enforce the reviewed six kinds and valid explicit reminder date", () => {
  for (const kind of ["level_test", "visit_consultation", "observation"]) for (const delivery of ["booking", "reminder"]) { const args = bundleArgs(`${kind}_${delivery}_bundle`); assert.equal(argumentsContract(BUNDLE, args), args) }
  for (const value of [null, "2026-02-30", "2026-1-01", STAMP]) { const args = bundleArgs("level_test_reminder_bundle"); args.p_service_date = value; rejects(() => argumentsContract(BUNDLE, args)) }
  const args = bundleArgs(); args.p_service_date = "2026-10-09"; rejects(() => argumentsContract(BUNDLE, args))
})
test("representative nonempty bundle producer outputs feed the real parser including observation revisions", () => {
  for (const kind of ["level_test", "visit_consultation", "observation"]) for (const delivery of ["booking", "reminder"]) { const args = bundleArgs(`${kind}_${delivery}_bundle`); const data = bundle(args); assert.equal(resultContract(BUNDLE, data, args), data); const parsed = parseRegistrationCustomerMessageBundleSource(data); assert.equal(parsed.taskId, TASK); assert.equal(parsed.items.length, 1) }
})
test("metadata-only preview has exactly twelve fields and feeds the actual preview consumer", () => {
  for (const kind of ["level_test", "visit_consultation", "observation"]) for (const delivery of ["booking", "reminder"]) {
    const args = bundleArgs(`${kind}_${delivery}_bundle`), data = bundle(args); delete data.parentPhoneDigits
    assert.equal(argumentsContract(PREVIEW, args), args); assert.equal(resultContract(PREVIEW, data, args), data)
    assert.equal(Object.keys(data).length, 12); assert.equal("parentPhoneDigits" in parseRegistrationCustomerMessageBundlePreviewSource(data), false)
    for (const raw of [null, "01000000000"]) { const bad = { ...data, parentPhoneDigits: raw }; rejects(() => resultContract(PREVIEW, bad, args)); assert.throws(() => parseRegistrationCustomerMessageBundlePreviewSource(bad)) }
  }
})
test("preview rejects wrong target, unknown names and oversized scalar fields without copying contact", () => {
  const args = bundleArgs(), data = bundle(args); delete data.parentPhoneDigits
  for (const edit of [value => { value.taskId = id(20) }, value => { value.studentName = "가".repeat(501) }, value => { value.items[0].className = "가".repeat(501) }, value => { value.items[0].sourceRevision.private = "private" }]) { const bad = clone(data); edit(bad); rejects(() => resultContract(PREVIEW, bad, args)) }
  rejects(() => resultContract("read_registration_contact_bundle_preview_v2", data, args))
})
test("preview requires producer-specific activity and class facts while retaining legacy nullable metadata", () => {
  for (const kind of ["level_test", "visit_consultation"]) {
    const args = bundleArgs(`${kind}_booking_bundle`), legacy = bundle(args); legacy.items[0].activityId = null
    assert.equal(resultContract(BUNDLE, legacy, args), legacy)
    const preview = clone(legacy); delete preview.parentPhoneDigits; rejects(() => resultContract(PREVIEW, preview, args))
    preview.items[0].activityId = id(7); preview.items[0].className = "합성 수업"; preview.items[0].teacherName = "합성 강사"; rejects(() => resultContract(PREVIEW, preview, args))
  }
  const args = bundleArgs("observation_booking_bundle"), legacy = bundle(args); legacy.items[0].className = null; legacy.items[0].teacherName = null
  assert.equal(resultContract(BUNDLE, legacy, args), legacy)
  const preview = clone(legacy); delete preview.parentPhoneDigits; rejects(() => resultContract(PREVIEW, preview, args))
  preview.items[0].className = "합성 수업"; preview.items[0].teacherName = "합성 강사"; preview.items[0].activityId = id(7); rejects(() => resultContract(PREVIEW, preview, args))
})
test("bundle bigint revisions preserve the existing safe-integer contract beyond int32", () => {
  const args = bundleArgs("observation_booking_bundle"), data = bundle(args)
  data.bundleRevision = 2147483648; data.recipientRevision = Number.MAX_SAFE_INTEGER; data.items[0].sourceRevision.observationRevision = 2147483648
  assert.equal(resultContract(BUNDLE, data, args), data); parseRegistrationCustomerMessageBundleSource(data)
  delete data.parentPhoneDigits; assert.equal(resultContract(PREVIEW, data, args), data); parseRegistrationCustomerMessageBundlePreviewSource(data)
  for (const field of ["bundleRevision", "recipientRevision"]) { const bad = clone(data); bad[field] = Number.MAX_SAFE_INTEGER + 1; rejects(() => resultContract(PREVIEW, bad, args)) }
  const bad = clone(data); bad.items[0].sourceRevision.observationRevision = Number.MAX_SAFE_INTEGER + 1; rejects(() => resultContract(PREVIEW, bad, args))
})
test("a shared appointment source UUID is legitimate across distinct subject and track items", () => {
  const args = bundleArgs(); const data = bundle(args); data.items.push({ ...clone(data.items[0]), trackId: id(8), activityId: id(9), subject: "수학" })
  assert.equal(resultContract(BUNDLE, data, args), data); assert.equal(parseRegistrationCustomerMessageBundleSource(data).items.length, 2)
})
test("bundle source revision has reviewed exact numeric and hash fields", () => {
  const args = bundleArgs(); const data = bundle(args)
  for (const value of [{ appointmentNotificationRevision: 0 }, { appointmentNotificationRevision: "1" }, { appointmentNotificationRevision: 1, arbitrary: "private" }, {}, { appointmentNotificationRevision: 1, observationRevision: 2 }]) { const bad = clone(data); bad.items[0].sourceRevision = value; rejects(() => resultContract(BUNDLE, bad, args)) }
  const observationArgs = bundleArgs("observation_booking_bundle"); const observation = bundle(observationArgs); observation.items[0].sourceRevision.bookingFactHash = "not-a-hash"; rejects(() => resultContract(BUNDLE, observation, observationArgs))
})
test("bundle target, cardinality, duplicates, scalar text and reminder scope fail closed", () => {
  const args = bundleArgs("level_test_reminder_bundle"); const data = bundle(args)
  for (const edit of [value => { value.sourceId = id(20) }, value => { value.taskId = id(20) }, value => { value.messageKind = "observation_reminder_bundle" }, value => { value.items = [] }, value => { value.items.push(clone(value.items[0])) }, value => { value.items[0].serviceDate = "2026-10-11" }, value => { value.items[0].teacherName = "합성 강사" }, value => { value.items[0].studentPhone = "01000000000" }, value => { value.studentName = "가".repeat(501) }, value => { value.sourceFingerprint = "a".repeat(65) }, value => { value.parentPhoneDigits = "unreviewed" }, value => { value.items[0].scheduledAt = "2026-10-09" }, value => { value.items[0].scheduledAt = "2026-02-30T09:00:00.000Z" }]) { const bad = clone(data); edit(bad); rejects(() => resultContract(BUNDLE, bad, args)) }
})
test("unknown RPC names cannot dispatch a generic validator", () => {
  for (const name of ["other_rpc", "toString", "__proto__", null, undefined]) { rejects(() => argumentsContract(name, mutation())); rejects(() => resultContract(name, receipt(), mutation())) }
})
test("accessors never run, and symbols, altered prototypes, hidden keys and array roots are rejected", () => {
  let reads = 0; const getter = mutation(); Object.defineProperty(getter, "p_actor_id", { enumerable: true, get() { reads++; return ACTOR } }); rejects(() => argumentsContract(MUTATE, getter)); assert.equal(reads, 0)
  const cases = [value => { value[Symbol("private")] = "private" }, value => { Object.setPrototypeOf(value, { inherited: true }) }, value => { Object.defineProperty(value, "private", { value: "hidden", enumerable: false }) }, value => { Object.defineProperty(value.p_payload, "__proto__", { value: {}, enumerable: true }) }, value => { value.p_payload.toJSON = () => "private" }]
  for (const edit of cases) { const args = mutation(); edit(args); rejects(() => argumentsContract(MUTATE, args)) }
  rejects(() => argumentsContract(MUTATE, [mutation()])); rejects(() => resultContract(MUTATE, [receipt()], mutation()))
})
test("cycles, deep trees, sparse or modified arrays and unsafe JSON values are rejected", () => {
  for (const edit of [value => { value.p_payload.cycle = value }, value => { let branch = value.p_payload; for (let i = 0; i < 9; i++) { branch.next = {}; branch = branch.next } }, value => { value.p_payload.trackId = 1n }, value => { value.p_payload.trackId = undefined }, value => { value.p_payload.trackId = () => TRACK }]) { const args = mutation(); edit(args); rejects(() => argumentsContract(MUTATE, args)) }
  for (const change of [list => { delete list[0] }, list => { list.extra = "private" }, list => { Object.setPrototypeOf(list, {}) }]) { const args = mutation("create"); change(args.p_payload.subjects); rejects(() => argumentsContract(MUTATE, args)) }
})
test("UTF8 oversized JSON is rejected even when its character count stays below the byte cap", () => {
  const args = mutation("create"); args.p_payload.requestNote = "가".repeat(20000); args.p_payload.padding = Array.from({ length: 50 }, () => "가".repeat(500))
  const encoded = JSON.stringify(args); assert.ok(encoded.length < 128000); assert.ok(new TextEncoder().encode(encoded).byteLength > 128000)
  rejects(() => argumentsContract(MUTATE, args))
  delete args.p_payload.padding; assert.equal(argumentsContract(MUTATE, args), args)
})
