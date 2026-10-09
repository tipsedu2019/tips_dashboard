import assert from "node:assert/strict"
import test from "node:test"
import {
  applyRegistrationContactLifecycleTransition as transition,
  clearRegistrationTemporaryContactFields,
  createRegistrationContactLifecycle as create,
  getRegistrationContactCaseClosure as closure,
} from "../src/features/tasks/registration-contact-lifecycle.ts"
import { evaluateRegistrationContactMessageGate } from "../src/features/tasks/registration-contact-message-policy.ts"

const CASE = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const ACTOR2 = "00000000-0000-4000-8000-000000000003"
const STUDENT = "00000000-0000-4000-8000-000000000004"
const OTHER_STUDENT = "00000000-0000-4000-8000-000000000005"
const TRACK1 = "00000000-0000-4000-8000-000000000006"
const TRACK2 = "00000000-0000-4000-8000-000000000007"
const PHONE = "010-0000-0000" // synthetic only
const NEW_PHONE = "010-0000-0001"
const track = (id = TRACK1, workflowStatus = "inquiry", archivedAt = null) => ({ id, workflowStatus, archivedAt })
const business = Object.freeze({
  classes: Object.freeze(["synthetic-class"]),
  lessonHours: Object.freeze([8]),
  settlements: Object.freeze([{ amount: 1234 }]),
  displayUid: "synthetic-display-number",
  opaqueLinkLocator: "synthetic-link-locator",
})
const initial = (tracks = [track()], overrides = {}) => ({
  ...create({ caseId: CASE, tracks, studentId: STUDENT, business, freshParentContact: { source: "user_input", parentPhone: PHONE } }),
  ...overrides,
})
const request = (state, overrides = {}) => ({
  actorId: ACTOR, requestKey: "synthetic-request", fingerprint: { version: 1, digest: "a".repeat(64) },
  expectedRevision: state.revision, expectedGeneration: state.generation, ...overrides,
})
const close = (state, overrides = {}) => transition(state, { kind: "close", reason: "all_current_tracks_terminal" }, request(state, overrides))
const closed = () => close(initial([track(TRACK1, "registered")])).state

test("one completed subject cannot close a case with another current subject", () => {
  const tracks = [track(TRACK1, "registered"), track(TRACK2, "level_test_requested")]
  assert.deepEqual(closure({ tracks }), { allPhasesClosed: false, reason: "open_tracks", currentTrackIds: [TRACK1, TRACK2] })
  assert.throws(() => close(initial(tracks)), /registration_contact_case_not_closed/)
})

test("all three terminal outcomes close the complete current-subject set", () => {
  for (const outcome of ["registered", "not_registered", "inquiry_only"]) {
    const state = initial([track(TRACK1, outcome), track(TRACK2, "registered")])
    assert.equal(closure({ tracks: state.tracks }).allPhasesClosed, true)
    const result = close(state)
    assert.equal(result.state.phase, "closed")
    assert.equal(result.state.parentPhone, null)
    assert.equal(result.state.studentPhone, null)
    assert.equal(result.effects.contactErased, true)
  }
})

test("unknown or intermediate statuses never count as completed", () => {
  for (const status of ["payment_in_progress", "observation_completed", "inquiry_closed", "unrecognized"]) {
    assert.equal(closure({ tracks: [track(TRACK1, status)] }).allPhasesClosed, false)
  }
})

test("whole-case explicit cancellation closes active subjects and erases both legacy contact slots", () => {
  const state = initial([track(), track(TRACK2, "waiting_next_opening")], { studentPhone: NEW_PHONE })
  assert.equal(closure({ tracks: state.tracks, explicitWholeCancelled: true }).reason, "whole_case_cancelled")
  const result = transition(state, { kind: "close", reason: "whole_case_cancelled" }, request(state))
  assert.equal(result.state.closureReason, "whole_case_cancelled")
  assert.equal(result.state.parentPhone, null)
  assert.equal(result.state.studentPhone, null)
})

test("zero current subjects is not vacuous completion; archived subjects do not become current", () => {
  for (const tracks of [[], [track(TRACK1, "registered", "2026-10-09T00:00:00Z")]]) {
    assert.deepEqual(closure({ tracks }), { allPhasesClosed: false, reason: "no_current_tracks", currentTrackIds: [] })
  }
  assert.equal(closure({ tracks: [track(TRACK1, "inquiry", "2026-10-09T00:00:00Z"), track(TRACK2, "registered")] }).allPhasesClosed, true)
})

test("duplicate subject IDs and ambiguous archive markers fail closed", () => {
  assert.throws(() => closure({ tracks: [track(), track()] }), /registration_contact_tracks_invalid/)
  assert.throws(() => closure({ tracks: [track(TRACK1, "registered", "")] }), /registration_contact_tracks_invalid/)
  assert.throws(() => closure({ tracks: [track(TRACK1, "registered", "not-a-timestamp")] }), /registration_contact_tracks_invalid/)
  assert.throws(() => closure({ tracks: [track()], explicitWholeCancelled: "true" }), /registration_contact_cancellation_invalid/)
})

test("last-current-subject exclusion requires an explicit guarded transition", () => {
  const state = initial()
  const tracks = [track(TRACK1, "inquiry", "2026-10-09T00:00:00Z")]
  assert.throws(() => transition(state, { kind: "replace_tracks", tracks }, request(state)), /registration_contact_last_track_transition_required/)
  const result = transition(state, { kind: "replace_tracks", tracks, closeWhenLastTrackExcluded: true }, request(state))
  assert.equal(result.state.closureReason, "last_current_track_excluded")
  assert.equal(result.state.parentPhone, null)
  assert.equal(result.effects.shouldSendNotice, false)
  assert.equal(result.effects.suppressLegacyStageResend, true)
  assert.equal(result.state.tracks[0].archivedAt, tracks[0].archivedAt)
})

test("an already empty case cannot masquerade as a last-subject exclusion", () => {
  const state = initial([])
  assert.throws(() => transition(state, { kind: "replace_tracks", tracks: [], closeWhenLastTrackExcluded: true }, request(state)), /registration_contact_last_track_transition_required/)
})

test("track history cannot be dropped during exclusion or reopening", () => {
  const state = initial([track(), track(TRACK2)])
  assert.throws(() => transition(state, { kind: "replace_tracks", tracks: [track()] }, request(state)), /registration_contact_track_history_required/)
  const done = closed()
  assert.throws(() => transition(done, { kind: "reopen", tracks: [track(TRACK2)] }, request(done, { requestKey: "reopen" })), /registration_contact_track_history_required/)
})

test("archiving one subject can close the remaining terminal subject without resending a notice", () => {
  const state = initial([track(), track(TRACK2, "registered")])
  const result = transition(state, { kind: "replace_tracks", tracks: [track(TRACK1, "inquiry", "2026-10-09T00:00:00Z"), track(TRACK2, "registered")] }, request(state))
  assert.equal(result.state.phase, "closed")
  assert.equal(result.effects.shouldSendNotice, false)
})

test("exact closure replay succeeds before stale guards and performs no new closure", () => {
  const state = initial([track(TRACK1, "registered")])
  const req = request(state)
  const first = close(state)
  const replay = transition(first.state, { kind: "close", reason: "all_current_tracks_terminal" }, req)
  assert.equal(replay.replayed, true)
  assert.equal(replay.state, first.state)
  assert.equal(replay.receipt, first.receipt)
  assert.equal(replay.effects.contactErased, false)
  assert.equal(replay.effects.invalidateContactDraft, false)
  assert.equal(replay.state.receipts.length, 1)
})

test("a reused request key with a different full-command fingerprint conflicts", () => {
  const first = close(initial([track(TRACK1, "registered")]))
  assert.throws(() => transition(first.state, { kind: "close", reason: "whole_case_cancelled" }, request(first.state, { fingerprint: { version: 1, digest: "b".repeat(64) } })), /registration_contact_request_key_conflict/)
})

test("request keys remain exact and actor-scoped", () => {
  const state = initial()
  const first = transition(state, { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }, request(state))
  const second = transition(first.state, { kind: "edit_contact", source: "user_input", parentPhone: PHONE }, request(first.state, { actorId: ACTOR2 }))
  const third = transition(second.state, { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }, request(second.state, { requestKey: " synthetic-request " }))
  assert.equal(second.replayed, false)
  assert.equal(third.replayed, false)
  assert.equal(third.receipt.requestKey, " synthetic-request ")
})

test("a second new closure key is rejected and stale revision never changes contact", () => {
  const done = closed()
  assert.throws(() => close(done, { requestKey: "another-close" }), /registration_contact_already_closed/)
  const state = initial()
  assert.throws(() => transition(state, { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }, request(state, { expectedRevision: "2" })), /registration_contact_revision_conflict/)
  assert.equal(state.parentPhone, PHONE)
})

test("reopening without fresh input creates a new generation with no recovered phone", () => {
  const state = closed()
  const result = transition(state, { kind: "reopen", tracks: [track()] }, request(state, { requestKey: "reopen" }))
  assert.equal(result.state.generation, "2")
  assert.equal(result.state.revision, "3")
  assert.equal(result.state.phase, "open")
  assert.equal(result.state.parentPhone, null)
  assert.equal(result.state.studentPhone, null)
  assert.equal(result.state.studentId, STUDENT)
  assert.equal(result.state.business, business)
  assert.equal(result.effects.invalidateContactDraft, true)
  assert.equal(result.effects.shouldSendNotice, false)
})

test("reopening accepts only an explicitly fresh parent input and no child contact", () => {
  const state = closed()
  const cmd = { kind: "reopen", tracks: [track()], freshParentContact: { source: "user_input", parentPhone: NEW_PHONE } }
  const result = transition(state, cmd, request(state, { requestKey: "reopen" }))
  assert.equal(result.state.parentPhone, NEW_PHONE)
  assert.equal(result.state.studentPhone, null)
  for (const freshParentContact of [
    { source: "legacy_cache", parentPhone: PHONE },
    { source: "user_input", parentPhone: PHONE, studentPhone: NEW_PHONE },
  ]) {
    assert.throws(() => transition(state, { ...cmd, freshParentContact }, request(state, { requestKey: "reopen" })), /registration_contact_fresh_input_required/)
  }
})

test("reopen requires a current nonterminal subject and cannot reopen an open case", () => {
  const state = closed()
  for (const tracks of [[], [track(TRACK1, "registered")], [track(TRACK1, "inquiry", "2026-10-09T00:00:00Z")]]) {
    assert.throws(() => transition(state, { kind: "reopen", tracks }, request(state, { requestKey: "reopen" })), /registration_contact_open_track_required/)
  }
  const open = initial()
  assert.throws(() => transition(open, { kind: "reopen", tracks: [track()] }, request(open)), /registration_contact_already_open/)
})

test("old-generation edits fail; exact historical replay cannot rehydrate closed-generation contact", () => {
  const initialState = initial([track(TRACK1, "registered")])
  const first = close(initialState)
  const reopened = transition(first.state, { kind: "reopen", tracks: [track()] }, request(first.state, { requestKey: "reopen" })).state
  assert.throws(() => transition(reopened, { kind: "edit_contact", source: "user_input", parentPhone: PHONE }, request(reopened, { requestKey: "old-edit", expectedGeneration: "1" })), /registration_contact_generation_conflict/)
  const replay = transition(reopened, { kind: "close", reason: "all_current_tracks_terminal" }, request(initialState))
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.result.phase, "closed")
  assert.equal(replay.receipt.result.generation, "1")
  assert.equal(replay.state.phase, "open")
  assert.equal(replay.state.generation, "2")
  assert.equal(replay.state.parentPhone, null)
})

test("reopened contact edits and bindings preserve exact business arrays and immutable identity", () => {
  const state = initial([track()], { studentId: null })
  const bound = transition(state, { kind: "bind_student", studentId: STUDENT }, request(state)).state
  assert.equal(bound.studentId, STUDENT)
  assert.equal(bound.business, business)
  assert.equal(bound.business.lessonHours, business.lessonHours)
  assert.equal(bound.business.settlements, business.settlements)
  assert.throws(() => transition(bound, { kind: "bind_student", studentId: OTHER_STUDENT }, request(bound, { requestKey: "remap" })), /registration_contact_student_binding_conflict/)
  const done = transition(bound, { kind: "close", reason: "whole_case_cancelled" }, request(bound, { requestKey: "cancel" })).state
  assert.equal(done.studentId, STUDENT)
  assert.equal(done.business.classes, business.classes)
})

test("counter increment preserves precision above JavaScript safe integer", () => {
  const state = initial([track(TRACK1, "registered")], { revision: "9007199254740999", generation: "9007199254740999" })
  const done = close(state).state
  assert.equal(done.revision, "9007199254741000")
  const reopened = transition(done, { kind: "reopen", tracks: [track()] }, request(done, { requestKey: "reopen" })).state
  assert.equal(reopened.generation, "9007199254741000")
  assert.equal(reopened.revision, "9007199254741001")
})

test("numeric, zero and noncanonical counters cannot bypass a lifecycle guard", () => {
  for (const counter of [0, 1, "0", "01", "1.0", "-1", "1e3"]) {
    assert.throws(() => close(initial([track(TRACK1, "registered")], { revision: counter })), /registration_contact_revision_invalid/)
  }
})

test("receipt is result-only metadata without raw phone, note or business contents", () => {
  const state = initial([track()], { business: { ...business, requestNote: "synthetic-private-note" } })
  const result = transition(state, { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }, request(state))
  const receipt = JSON.stringify(result.receipt)
  for (const secret of [PHONE, NEW_PHONE, "synthetic-private-note", "synthetic-class", "synthetic-link-locator"]) assert.equal(receipt.includes(secret), false)
  assert.deepEqual(Object.keys(result.receipt).sort(), ["actorId", "fingerprint", "requestKey", "result"])
  assert.equal(result.receipt.result.parentContactPresent, true)
})

test("raw JSON and malformed fingerprint envelopes cannot be stored as a receipt", () => {
  const state = initial()
  for (const fingerprint of [
    PHONE, { version: 1, digest: PHONE }, { version: 2, digest: "a".repeat(64) },
    { version: 1, digest: "a".repeat(64), parentPhone: PHONE },
  ]) assert.throws(() => transition(state, { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }, request(state, { fingerprint })), /registration_contact_fingerprint_invalid/)
})

test("closed state forbids contact edits and raw contact rehydration", () => {
  const done = closed()
  assert.throws(() => transition(done, { kind: "edit_contact", source: "user_input", parentPhone: PHONE }, request(done, { requestKey: "edit" })), /registration_contact_closed_edit_denied/)
  assert.throws(() => transition({ ...done, parentPhone: PHONE }, { kind: "bind_student", studentId: STUDENT }, request(done, { requestKey: "bind" })), /registration_contact_closed_state_invalid/)
})

test("typed field clearing does not erase notes, IDs, settlement records or absent fields", () => {
  const record = Object.freeze({ parentPhone: PHONE, studentPhone: NEW_PHONE, parent_phone: PHONE, student_phone: NEW_PHONE,
    student_id: STUDENT, uid: business.displayUid, studNo: business.opaqueLinkLocator,
    requestNote: "business-note", classes: business.classes, lessonHours: business.lessonHours, settlements: business.settlements })
  const cleared = clearRegistrationTemporaryContactFields(record)
  for (const key of ["parentPhone", "studentPhone", "parent_phone", "student_phone"]) assert.equal(cleared[key], null)
  for (const key of ["student_id", "uid", "studNo", "requestNote", "classes", "lessonHours", "settlements"]) assert.equal(cleared[key], record[key])
  assert.equal(record.parentPhone, PHONE)
  assert.deepEqual(clearRegistrationTemporaryContactFields({ student_id: STUDENT }), { student_id: STUDENT })
})

test("transitions do not mutate frozen source state or archived business history", () => {
  const state = initial([Object.freeze(track(TRACK1, "registered"))])
  Object.freeze(state.tracks)
  Object.freeze(state.receipts)
  Object.freeze(state)
  const result = close(state)
  assert.notEqual(result.state, state)
  assert.equal(state.parentPhone, PHONE)
  assert.equal(state.revision, "1")
  assert.equal(state.receipts.length, 0)
  assert.equal(result.state.business, state.business)
})

test("a corrupted stored receipt cannot return a raw contact during replay", () => {
  const first = close(initial([track(TRACK1, "registered")]))
  for (const corrupted of [
    { ...first.receipt, parentPhone: PHONE },
    { ...first.receipt, result: { ...first.receipt.result, parentPhone: PHONE } },
    { ...first.receipt, result: { ...first.receipt.result, parentContactPresent: true } },
  ]) {
    assert.throws(() => transition({ ...first.state, receipts: [corrupted] }, { kind: "close", reason: "all_current_tracks_terminal" }, request(first.state)), /registration_contact_receipt_invalid/)
  }
})

test("duplicate actor-request receipts fail closed rather than picking an arbitrary replay", () => {
  const first = close(initial([track(TRACK1, "registered")]))
  assert.throws(() => transition({ ...first.state, receipts: [first.receipt, first.receipt] }, { kind: "close", reason: "all_current_tracks_terminal" }, request(first.state)), /registration_contact_receipt_duplicate/)
})

test("max revision rejects close, reopen, bind and contact writes before altering state or business", () => {
  const max = "9223372036854775807"
  const commands = [
    [initial([track(TRACK1, "registered")]), { kind: "close", reason: "all_current_tracks_terminal" }],
    [closed(), { kind: "reopen", tracks: [track()], freshParentContact: { source: "user_input", parentPhone: NEW_PHONE } }],
    [initial([track()], { studentId: null }), { kind: "bind_student", studentId: STUDENT }],
    [initial(), { kind: "edit_contact", source: "user_input", parentPhone: NEW_PHONE }],
    [initial(), { kind: "replace_tracks", tracks: [track(TRACK1, "registered")] }],
  ]
  for (const [original, command] of commands) {
    const state = Object.freeze({ ...original, revision: max })
    const before = JSON.stringify(state)
    assert.throws(() => transition(state, command, request(state, { requestKey: "max-revision" })), {
      message: "registration_contact_revision_overflow",
    })
    assert.equal(JSON.stringify(state), before)
    assert.equal(state.business, business)
    assert.equal(state.business.lessonHours, business.lessonHours)
    assert.equal(state.business.settlements, business.settlements)
    assert.equal(state.parentPhone, original.parentPhone)
    assert.equal(state.studentId, original.studentId)
  }
})

test("max generation rejects reopening before fresh contact is read or historical state changes", () => {
  const state = Object.freeze({ ...closed(), generation: "9223372036854775807" })
  const before = JSON.stringify(state)
  let inputReads = 0
  const freshParentContact = Object.defineProperty({ source: "user_input" }, "parentPhone", {
    enumerable: true, get() { inputReads += 1; return NEW_PHONE },
  })
  assert.throws(() => transition(state, { kind: "reopen", tracks: [track()], freshParentContact },
    request(state, { requestKey: "max-generation" })), { message: "registration_contact_generation_overflow" })
  assert.equal(inputReads, 0)
  assert.equal(JSON.stringify(state), before)
  assert.equal(state.phase, "closed")
  assert.equal(state.parentPhone, null)
  assert.equal(state.studentId, STUDENT)
  assert.equal(state.business, business)
})

test("max generation remains valid for changes that do not advance generation", () => {
  const max = "9223372036854775807"
  const state = initial([track(TRACK1, "registered")], { generation: max, studentId: null })
  const bound = transition(state, { kind: "bind_student", studentId: STUDENT }, request(state)).state
  assert.equal(bound.generation, max)
  const done = close(bound, { requestKey: "close-max-generation" }).state
  assert.equal(done.generation, max)
  assert.equal(done.phase, "closed")
  assert.equal(done.studentId, STUDENT)
})

test("a write reaching max succeeds once; exact replay at max needs no further increment", () => {
  const state = initial([track(TRACK1, "registered")], { revision: "9223372036854775806" })
  const req = request(state)
  const first = close(state)
  assert.equal(first.state.revision, "9223372036854775807")
  const replay = transition(first.state, { kind: "close", reason: "all_current_tracks_terminal" }, req)
  assert.equal(replay.replayed, true)
  assert.equal(replay.state, first.state)
  const reopenable = { ...first.state, revision: "8", generation: "9223372036854775806" }
  const reopened = transition(reopenable, { kind: "reopen", tracks: [track()] }, request(reopenable, { requestKey: "last-generation" })).state
  assert.equal(reopened.generation, "9223372036854775807")
})

function policyCounterInput(generation) {
  return {
    action: "preview", messageKind: "level_test_booking", canonicalAppointmentKind: "level_test",
    contactPhase: "open", allPhasesClosed: false, sourcePhaseOpen: true,
    expectedContactGeneration: generation, currentContactGeneration: generation,
    dispatchState: null, request: null, replayReceipt: null,
  }
}

test("lifecycle state/request/receipt and message policy consistently reject greater-than-bigint inputs", () => {
  for (const tooLarge of ["9223372036854775808", "9999999999999999999", "10000000000000000000"]) {
    const state = initial([track(TRACK1, "registered")])
    const command = { kind: "close", reason: "all_current_tracks_terminal" }
    for (const field of ["revision", "generation"]) {
      assert.throws(() => transition({ ...state, [field]: tooLarge }, command, request(state)), /registration_contact_revision_invalid/)
    }
    for (const field of ["expectedRevision", "expectedGeneration"]) {
      assert.throws(() => transition(state, command, request(state, { [field]: tooLarge })), /registration_contact_revision_invalid/)
    }
    const done = close(state)
    for (const field of ["revision", "generation"]) {
      const receipt = { ...done.receipt, result: { ...done.receipt.result, [field]: tooLarge } }
      assert.throws(() => transition({ ...done.state, receipts: [receipt] }, command, request(state)), /registration_contact_revision_invalid/)
    }
    assert.equal(evaluateRegistrationContactMessageGate(policyCounterInput(tooLarge)).reasonCode, "input_invalid")
  }
  assert.equal(evaluateRegistrationContactMessageGate(policyCounterInput("9223372036854775807")).decision, "allow")
})
