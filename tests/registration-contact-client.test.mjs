import assert from "node:assert/strict"
import test from "node:test"
import {
  canUseRegistrationParentContact,
  getRegistrationContactScopeKey,
  normalizeRegistrationCaseContact,
  reconcileRegistrationInquiryContactDraft,
  stripRegistrationInquiryContact,
  stripRegistrationTaskContact,
} from "../src/features/tasks/registration-contact-client.ts"

const TASK = "00000000-0000-4000-8000-000000000001"
const STUDENT = "00000000-0000-4000-8000-000000000002"
const TRACK = "00000000-0000-4000-8000-000000000003"
const OTHER_TRACK = "00000000-0000-4000-8000-000000000004"
const PHONE = "010-0000-0000" // synthetic only
const OLD_PHONE = "010-0000-0001"
const MAX_COUNTER = "9223372036854775807"
const response = (overrides = {}) => ({
  version: 1, taskId: TASK, revision: "8", generation: "2", phase: "open",
  closureReason: null, closedAt: null, parentPhone: PHONE, studentId: STUDENT,
  commonRevision: 5, allPhasesClosed: false, currentTrackIds: [TRACK, OTHER_TRACK],
  ...overrides,
})
const closed = (overrides = {}) => response({
  phase: "closed", closureReason: "all_current_tracks_terminal",
  closedAt: "2026-10-09T08:00:00.000Z", parentPhone: null, allPhasesClosed: true,
  ...overrides,
})
const normalize = (input, options) => normalizeRegistrationCaseContact(input, TASK, options)
const draft = (overrides = {}) => ({
  studentName: "합성 학생", schoolName: "합성 학교", schoolGrade: "중2",
  parentPhone: OLD_PHONE, inquiryAt: "2026-10-09T17:00", requestNote: "업무 메모",
  studentId: STUDENT, currentTrackIds: [TRACK, OTHER_TRACK], selectedTrackId: TRACK,
  lessonHours: [8], settlements: [{ amount: 1234 }], ...overrides,
})

test("representative RPC JSON produces an allowlisted contact DTO without legacy typed aliases", () => {
  const input = JSON.parse(JSON.stringify(response({
    studentPhone: OLD_PHONE, student_phone: OLD_PHONE, parent_phone: OLD_PHONE,
    requestNote: "not contact metadata",
  })))
  const result = normalize(input)
  assert.deepEqual(result, response())
  assert.equal(canUseRegistrationParentContact(result), true)
  assert.equal(JSON.stringify(result).includes(OLD_PHONE), false)
  for (const key of ["studentPhone", "student_phone", "parent_phone", "requestNote"]) {
    assert.equal(Object.hasOwn(result, key), false)
  }
})

test("bigint revision and generation remain exact strings up to the provider maximum", () => {
  const result = normalize(response({ revision: MAX_COUNTER, generation: MAX_COUNTER, studentId: null }))
  assert.equal(result.revision, MAX_COUNTER)
  assert.equal(result.generation, MAX_COUNTER)
  assert.equal(result.studentId, null)
  for (const field of ["revision", "generation"]) {
    for (const value of [0, 1, null, undefined, "0", "01", "-1", "1.0", "1e3", " 1", "1\n", "١", "9223372036854775808", "10000000000000000000"]) {
      assert.throws(() => normalize(response({ [field]: value })), /registration_contact_response_invalid/, `${field}: ${String(value)}`)
    }
  }
})

test("missing or malformed metadata never grants contact reuse", () => {
  for (const input of [null, undefined, [], "contact", {}, response({ version: 2 }), response({ phase: "unknown" })]) {
    assert.throws(() => normalize(input), /registration_contact_response_invalid/)
  }
  for (const field of ["version", "taskId", "revision", "generation", "phase", "closureReason", "closedAt", "studentId", "commonRevision", "allPhasesClosed", "currentTrackIds"]) {
    const input = response()
    delete input[field]
    assert.throws(() => normalize(input), /registration_contact_response_invalid/, field)
  }
  assert.equal(canUseRegistrationParentContact(null), false)
  assert.equal(canUseRegistrationParentContact(undefined), false)
  assert.equal(getRegistrationContactScopeKey(null), "unavailable")
})

test("task binding, student UUID and complete current-track set are validated", () => {
  for (const input of [
    response({ taskId: STUDENT }), response({ studentId: "synthetic-display-uid" }),
    response({ currentTrackIds: null }), response({ currentTrackIds: [TRACK, TRACK] }),
    response({ currentTrackIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"] }),
    response({ currentTrackIds: [TRACK, ""] }), response({ currentTrackIds: [TRACK + "\n"] }),
  ]) assert.throws(() => normalize(input), /registration_contact_response_invalid/)
  for (const taskId of ["synthetic-display-uid", TASK + "\n", null]) {
    assert.throws(() => normalizeRegistrationCaseContact(response({ taskId }), taskId), /registration_contact_response_invalid/)
  }
})

test("common revision and completion flag cannot be coerced from RPC strings", () => {
  for (const commonRevision of ["5", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalize(response({ commonRevision })), /registration_contact_response_invalid/)
  }
  for (const allPhasesClosed of ["false", "true", 0, 1, null]) {
    assert.throws(() => normalize(response({ allPhasesClosed })), /registration_contact_response_invalid/)
  }
})

test("closure reasons are primitive approved values, not coercible JSON arrays or objects", () => {
  for (const closureReason of [
    ["all_current_tracks_terminal"], { toString: () => "all_current_tracks_terminal" },
    "unknown", "all_current_tracks_terminal ", 1,
  ]) assert.throws(() => normalize(closed({ closureReason })), /registration_contact_response_invalid/)
  for (const closureReason of ["all_current_tracks_terminal", "whole_case_cancelled", "last_current_track_excluded"]) {
    assert.equal(normalize(closed({ closureReason })).closureReason, closureReason)
  }
})

test("closed or all-terminal metadata rejects raw parent contact instead of merely hiding it", () => {
  for (const parentPhone of [PHONE, ""]) {
    assert.throws(() => normalize(closed({ parentPhone })), /registration_contact_closed_response_invalid/)
    assert.throws(() => normalize(response({ allPhasesClosed: true, parentPhone })), /registration_contact_closed_response_invalid/)
  }
  assert.equal(canUseRegistrationParentContact(normalize(closed())), false)
  assert.equal(canUseRegistrationParentContact(normalize(response({ allPhasesClosed: true, parentPhone: null }))), false)
})

test("phase and closure metadata must agree", () => {
  for (const input of [
    closed({ closureReason: null }), closed({ closureReason: "last_current_track_excluded", closedAt: null }), closed({ closedAt: "invalid date" }),
    closed({ closedAt: 123 }), response({ closureReason: "whole_case_cancelled" }),
    response({ closedAt: "2026-10-09T08:00:00Z" }),
  ]) assert.throws(() => normalize(input), /registration_contact_response_invalid/)
})

test("metadata-only mutation receipts may omit parentPhone only through the explicit option", () => {
  const input = closed()
  delete input.parentPhone
  assert.throws(() => normalize(input), /registration_contact_response_invalid/)
  assert.equal(normalize(input, { allowMissingParentPhone: true }).parentPhone, null)
  const open = response()
  delete open.parentPhone
  assert.equal(normalize(open, { allowMissingParentPhone: true }).parentPhone, null)
  assert.throws(() => normalize(response({ parentPhone: 123 }), { allowMissingParentPhone: true }), /registration_contact_response_invalid/)
  const missingGeneration = { ...open }
  delete missingGeneration.generation
  assert.throws(() => normalize(missingGeneration, { allowMissingParentPhone: true }), /registration_contact_response_invalid/)
})

test("parent contact cannot contain control characters or non-string values", () => {
  for (const parentPhone of [PHONE + "\n", PHONE + "\0", PHONE + "\u007f", [], {}, 123]) {
    assert.throws(() => normalize(response({ parentPhone })), /registration_contact_response_invalid/)
  }
  assert.equal(normalize(response({ parentPhone: null })).parentPhone, null)
})

test("contact availability uses the full current case, and zero active subjects grants no contact", () => {
  const active = normalize(response())
  assert.equal(canUseRegistrationParentContact(active), true)
  assert.equal(canUseRegistrationParentContact({ ...active, selectedTrackId: TRACK, selectedTrackIsTerminal: true }), true)
  assert.equal(canUseRegistrationParentContact(normalize(response({ currentTrackIds: [] }))), false)
})

test("normalization copies the current-track list and leaves frozen producer data unchanged", () => {
  const tracks = Object.freeze([TRACK, OTHER_TRACK])
  const input = Object.freeze(response({ currentTrackIds: tracks }))
  const result = normalize(input)
  assert.notEqual(result.currentTrackIds, tracks)
  result.currentTrackIds.pop()
  assert.deepEqual(tracks, [TRACK, OTHER_TRACK])
  assert.equal(input.parentPhone, PHONE)
})

test("contact scope changes on case, generation or closure, while revision and selected tab do not reset drafts", () => {
  const state = normalize(response())
  const key = getRegistrationContactScopeKey(state)
  for (const change of [{ generation: "3" }, { taskId: STUDENT }, { phase: "closed" }, { allPhasesClosed: true }]) {
    assert.notEqual(getRegistrationContactScopeKey({ ...state, ...change }), key)
  }
  assert.equal(getRegistrationContactScopeKey({ ...state, revision: "9", commonRevision: 6, selectedTrackId: OTHER_TRACK }), key)
})

test("inquiry draft stripping retires student aliases without touching UUIDs, notes or business arrays", () => {
  const input = Object.freeze(draft({ studentPhone: PHONE, student_phone: PHONE, parent_phone: PHONE }))
  const result = stripRegistrationInquiryContact(input)
  for (const key of ["studentPhone", "student_phone", "parent_phone"]) assert.equal(Object.hasOwn(result, key), false)
  assert.equal(result.parentPhone, OLD_PHONE)
  for (const key of ["studentId", "currentTrackIds", "requestNote", "lessonHours", "settlements"]) assert.equal(result[key], input[key])
  assert.equal(input.studentPhone, PHONE)
  assert.equal(stripRegistrationInquiryContact(input, true).parentPhone, "")
  assert.deepEqual(stripRegistrationInquiryContact({ studentId: STUDENT }, true), { studentId: STUDENT })
})

test("business task caches carry no typed contact and cannot become a contact rehydration source", () => {
  const registration = Object.freeze({ parentPhone: PHONE, studentPhone: OLD_PHONE,
    parent_phone: PHONE, student_phone: OLD_PHONE, studentId: STUDENT, requestNote: "業務メモ", tracks: [TRACK] })
  const input = Object.freeze({ id: TASK, registration, status: "todo" })
  const result = stripRegistrationTaskContact(input)
  for (const key of ["parentPhone", "studentPhone", "parent_phone", "student_phone"]) assert.equal(Object.hasOwn(result.registration, key), false)
  assert.equal(result.registration.studentId, STUDENT)
  assert.equal(result.registration.tracks, registration.tracks)
  assert.equal(result.registration.requestNote, registration.requestNote)
  assert.equal(JSON.stringify(result).includes(PHONE), false)
  assert.equal(JSON.stringify(result).includes(OLD_PHONE), false)
  assert.equal(registration.parentPhone, PHONE)
  const taskWithoutRegistration = { id: TASK }
  assert.equal(stripRegistrationTaskContact(taskWithoutRegistration), taskWithoutRegistration)
})

test("an unchanged contact scope preserves fresh unsaved input and other draft fields", () => {
  const current = Object.freeze(draft({ studentPhone: PHONE, student_phone: PHONE, parent_phone: PHONE }))
  const key = getRegistrationContactScopeKey(normalize(response()))
  const result = reconcileRegistrationInquiryContactDraft(current, draft({ parentPhone: PHONE }), key, key, true)
  assert.equal(result.parentPhone, OLD_PHONE)
  assert.equal(result.requestNote, current.requestNote)
  assert.equal(result.settlements, current.settlements)
  assert.equal(Object.hasOwn(result, "studentPhone"), false)
})

test("case closure erases typed drafts even when the supplied scope key has not changed", () => {
  const current = draft({ studentPhone: PHONE, student_phone: PHONE, parent_phone: PHONE })
  for (const nextKey of ["open-key", "closed-key"]) {
    const result = reconcileRegistrationInquiryContactDraft(current, draft({ parentPhone: PHONE }), "open-key", nextKey, false)
    assert.equal(result.parentPhone, "")
    assert.equal(JSON.stringify(result).includes(PHONE), false)
    assert.equal(JSON.stringify(result).includes(OLD_PHONE), false)
    assert.equal(result.requestNote, current.requestNote)
    assert.equal(result.lessonHours, current.lessonHours)
  }
})

test("reopening creates a new scope and never restores the old typed phone from a prior generation", () => {
  const open = normalize(response())
  const next = normalize(response({ generation: "3", revision: "10", parentPhone: null }))
  const current = draft({ student_phone: PHONE, parent_phone: PHONE })
  const result = reconcileRegistrationInquiryContactDraft(current, draft({ parentPhone: "" }),
    getRegistrationContactScopeKey(open), getRegistrationContactScopeKey(next), canUseRegistrationParentContact(next))
  assert.equal(result.parentPhone, "")
  assert.equal(result.studentId, STUDENT)
  assert.equal(result.requestNote, current.requestNote)
  assert.equal(result.currentTrackIds, current.currentTrackIds)
  assert.equal(JSON.stringify(result).includes(OLD_PHONE), false)
})

test("a changed generation adopts only the new authoritative contact while preserving unrelated edits", () => {
  const current = draft({ requestNote: "unsaved note", schoolName: "unsaved school" })
  const result = reconcileRegistrationInquiryContactDraft(current, draft({ parentPhone: PHONE, requestNote: "server note" }),
    "old-generation", "new-generation", true)
  assert.equal(result.parentPhone, PHONE)
  assert.equal(result.requestNote, "unsaved note")
  assert.equal(result.schoolName, "unsaved school")
  assert.equal(current.parentPhone, OLD_PHONE)
})

test("unavailable metadata and zero active subjects clear only contact, independent of selected tab", () => {
  const current = draft()
  for (const state of [null, normalize(response({ currentTrackIds: [] }))]) {
    const result = reconcileRegistrationInquiryContactDraft(current, draft({ parentPhone: PHONE }), "previous",
      getRegistrationContactScopeKey(state), canUseRegistrationParentContact(state))
    assert.equal(result.parentPhone, "")
    assert.equal(result.selectedTrackId, TRACK)
    assert.equal(result.studentName, current.studentName)
  }
})

 test("legacy inferred all-terminal closure omits unknown historical time without authorizing contact", () => {
  const state = normalize(closed({ closedAt: null }));
  assert.equal(state.closedAt, null);
  assert.equal(canUseRegistrationParentContact(state), false);
 });
