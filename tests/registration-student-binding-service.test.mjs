import assert from "node:assert/strict"
import test from "node:test"
import { createRegistrationStudentCandidateService } from "../src/features/tasks/registration-student-binding-service.ts"

const id = (n) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const PHONE = "010-0000-0094" // Synthetic transport canary, never real data.
const row = (n, patch = {}) => ({ kind: "students", id: id(n), name: "합성 동일 이름", school: "합성 학교", grade: "중2",
  uid: `DISPLAY-${n}`, makeeduDetailId: "UNNEEDED_EXTERNAL_ID", status: "퇴원", storedStatus: "퇴원",
  registeredCount: 0, waitlistCount: 0, sortKey: "합성 동일 이름", updatedAt: "2026-10-09T09:00:00Z",
  contact: PHONE, parentContact: PHONE, studentPhone: PHONE, ...patch })
const dto = (n) => ({ id: id(n), name: "합성 동일 이름", school: "합성 학교", grade: "중2", uid: `DISPLAY-${n}` })
function wire(response) {
  const calls = []
  const supabase = { rpc(name, args) {
    const call = { name, args, signal: null, retry: null }
    calls.push(call)
    return { abortSignal(signal) { call.signal = signal; return this }, retry(value) {
      call.retry = value
      return typeof response === "function" ? response(call) : Promise.resolve(response)
    } }
  } }
  return { calls, service: createRegistrationStudentCandidateService({ supabase }) }
}

test("real numbered student reader searches all statuses in one supported page and returns only explicit UUID candidates", async () => {
  const source = [row(21), row(22)]
  const transport = wire({ data: { rows: source, page: 2, pageSize: 20, totalCount: 22 }, error: null })
  const caller = new AbortController()
  const result = await transport.service.searchRegistrationStudentCandidates({ search: "합성", page: 2, signal: caller.signal })
  assert.deepEqual(result, { rows: [dto(21), dto(22)], page: 2, pageSize: 20, totalCount: 22 })
  assert.equal(transport.calls.length, 1)
  assert.deepEqual(transport.calls[0].args, { p_kind: "students", p_page: 2, p_page_size: 20,
    p_filters: { kind: "students", search: "합성", status: null, schoolCategory: null, school: null, grade: null },
    p_sort: [{ id: "title", desc: false }] })
  assert.equal(transport.calls[0].name, "list_management_numbered_page_v1")
  assert.equal(transport.calls[0].retry, false)
  assert.ok(transport.calls[0].signal instanceof AbortSignal)
  assert.equal(result.rows[0].name, result.rows[1].name)
  assert.notEqual(result.rows[0].id, result.rows[1].id)
  assert.equal(JSON.stringify(result).includes(PHONE), false)
  assert.equal(JSON.stringify(result).includes("UNNEEDED_EXTERNAL_ID"), false)
  assert.equal(source[0].contact, PHONE)
  caller.abort()
  assert.equal(transport.calls[0].signal.aborted, true)
})

test("older SQL missing display UID stays compatible without inferring it from UUID or MakeEdu ID", async () => {
  const source = row(1)
  delete source.uid
  delete source.makeeduDetailId
  const transport = wire({ data: { rows: [source], page: 1, pageSize: 20, totalCount: 1 }, error: null })
  const result = await transport.service.searchRegistrationStudentCandidates({ search: "" })
  assert.deepEqual(result.rows, [{ ...dto(1), uid: null }])
  assert.equal(result.pageSize, 20)
  assert.equal(JSON.stringify(result).includes(PHONE), false)
})

test("malformed search or page fails before transport without loading legacy options", async () => {
  const transport = wire(() => assert.fail("unexpected read"))
  for (const search of [null, 1, "x".repeat(201), "合成\n", "\u0000"]) {
    await assert.rejects(transport.service.searchRegistrationStudentCandidates({ search }), /registration_student_lookup_request_invalid/)
  }
  for (const page of [0, -1, 1.5, "1", 2147483648]) {
    await assert.rejects(transport.service.searchRegistrationStudentCandidates({ search: "", page }), /registration_student_lookup_request_invalid/)
  }
  assert.equal(transport.calls.length, 0)
})

test("non-UUID and case-equivalent duplicate identities are rejected independently of display names", async () => {
  for (const rows of [[row(1, { id: "DISPLAY-1" })],
    [row(1, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), row(2, { id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" })]]) {
    const transport = wire({ data: { rows, page: 1, pageSize: 20, totalCount: rows.length }, error: null })
    await assert.rejects(transport.service.searchRegistrationStudentCandidates({ search: "" }), /registration_student_lookup_response_invalid/)
    assert.equal(transport.calls.length, 1)
  }
})

test("malformed provider DTO and unsafe provider failures become bounded safe errors without another read", async () => {
  for (const response of [{ data: { rows: [row(1, { uid: { phone: PHONE } })], page: 1, pageSize: 20, totalCount: 1 }, error: null },
    { data: null, error: { code: "PRIVATE", message: PHONE } }]) {
    const transport = wire(response)
    await assert.rejects(transport.service.searchRegistrationStudentCandidates({ search: "" }), (error) =>
      /^registration_student_lookup_(response_invalid|unavailable)$/.test(error.message) && !error.message.includes(PHONE))
    assert.equal(transport.calls.length, 1)
  }
})

test("caller cancellation prevents a read and does not expose arbitrary abort reasons", async () => {
  const caller = new AbortController()
  caller.abort(PHONE)
  const transport = wire(() => assert.fail("unexpected read"))
  await assert.rejects(transport.service.searchRegistrationStudentCandidates({ search: "", signal: caller.signal }),
    { name: "AbortError", message: "registration_student_lookup_aborted" })
  assert.equal(transport.calls.length, 0)
})

test("the reused reader deadline settles a stalled provider and aborts its one request", async (t) => {
  const deadline = new AbortController()
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8000); return deadline.signal })
  const transport = wire(() => new Promise(() => {}))
  const pending = transport.service.searchRegistrationStudentCandidates({ search: "" })
  deadline.abort(new DOMException("synthetic timeout", "TimeoutError"))
  await assert.rejects(pending, /registration_student_lookup_timeout/)
  assert.equal(transport.calls.length, 1)
  assert.equal(transport.calls[0].signal.aborted, true)
})

test("disconnected source cannot fall back to a wildcard or whole-option query", async () => {
  const service = createRegistrationStudentCandidateService({ supabase: null })
  await assert.rejects(service.searchRegistrationStudentCandidates({ search: "" }), /registration_student_lookup_unavailable/)
})
