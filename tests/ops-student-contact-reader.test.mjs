import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { STUDENT_MASTER_READ_COLUMNS, projectStudentMasterRecord } from "../src/features/management/student-master-privacy.js"

const source = readFileSync(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
const syntax = ts.createSourceFile("ops-task-service.ts", source, ts.ScriptTarget.Latest, true)
const declarations = syntax.statements.filter((node) => ts.isFunctionDeclaration(node)).map((node) => node.getText(syntax)).join("\n")
const compiled = ts.transpileModule(`${declarations}\nmodule.exports={selectOpsStudentMasterById,selectOpsRowById,findOpsStudentByName,resolveOpsStudent};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function load(supabase) {
  const runtime = { exports: {} }
  vm.runInNewContext(compiled, { module: runtime, exports: runtime.exports, supabase, AbortSignal, STUDENT_MASTER_READ_COLUMNS, projectStudentMasterRecord })
  return runtime.exports
}
const id = (n) => `99490000-0000-4000-8000-${String(n).padStart(12, "0")}`
const STUDENT = id(1), CLASS = id(2), PHONE = "010-0000-9933", PARENT = "010-0000-9944"
const student = (overrides = {}) => ({ id: STUDENT, name: "합성 학생", school: "합성 학교", grade: "중2", uid: "SYN77",
  status: "재원", enroll_date: "2026-10-01", class_ids: [CLASS], waitlist_class_ids: [id(3)], contact: PHONE, parent_contact: PARENT, ...overrides })
function wire(result = () => ({ data: [student()], error: null })) {
  const queries = []
  return { queries, client: { from(table) {
    const query = { table, operations: [] }; queries.push(query)
    const builder = { then(resolve, reject) { return Promise.resolve(result(query)).then(resolve, reject) } }
    for (const method of ["select", "eq", "order", "limit", "abortSignal", "retry"]) builder[method] = (...args) => { query.operations.push([method, ...args]); return builder }
    return builder
  } } }
}
function plain(value) { return JSON.parse(JSON.stringify(value)) }
function noPhones(value) { assert.equal(JSON.stringify(value).includes(PHONE), false); assert.equal(JSON.stringify(value).includes(PARENT), false) }
function assertRead(query, limit) {
  assert.deepEqual(query.operations.filter(([method]) => !["eq", "abortSignal"].includes(method)), [["select", STUDENT_MASTER_READ_COLUMNS], ["order", "id"], ["limit", limit], ["retry", false]])
  assert.equal(query.operations.find(([method]) => method === "abortSignal")[1] instanceof AbortSignal, true)
}
test("actual generic student preflight uses exact contact-free shared projection and bounded no-retry query", async (t) => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8000); return controller.signal })
  const transport = wire(), result = await load(transport.client).selectOpsRowById("students", STUDENT)
  assertRead(transport.queries[0], 1)
  assert.deepEqual(transport.queries[0].operations.filter(([method]) => method === "eq"), [["eq", "id", STUDENT]])
  noPhones(result)
  assert.deepEqual(plain(result.class_ids), [CLASS]); assert.deepEqual(plain(result.waitlist_class_ids), [id(3)])
  assert.equal(result.uid, "SYN77"); assert.equal(result.school, "합성 학교")
})
test("uppercase selected UUID resolves only the identical persisted UUID", async () => {
  const transport = wire()
  assert.equal((await load(transport.client).selectOpsRowById("students", STUDENT.toUpperCase())).id, STUDENT)
})
test("invalid/empty student identity does not trigger a query", async () => {
  for (const selected of ["", "SYN77", STUDENT + "\n", " " + STUDENT]) {
    const transport = wire()
    assert.equal(await load(transport.client).selectOpsRowById("students", selected), null)
    assert.equal(transport.queries.length, 0)
  }
})
test("wrong identity, multirow or malformed producer fails closed without fallback", async () => {
  for (const data of [[student({ id: id(99) })], [student(), student()], {}, null]) {
    const transport = wire(() => ({ data, error: null }))
    await assert.rejects(load(transport.client).selectOpsRowById("students", STUDENT), /ops_student_read_response_invalid/)
    assert.equal(transport.queries.length, 1)
  }
})
test("missing relation/column returns unavailable without reverting to raw/full-row projection", async () => {
  for (const code of ["42P01", "42703"]) {
    const transport = wire(() => ({ data: null, error: { code, message: "synthetic unavailable" } }))
    assert.equal(await load(transport.client).selectOpsRowById("students", STUDENT), null)
    assert.equal(transport.queries.length, 1); assertRead(transport.queries[0], 1)
  }
})
test("provider error propagates exactly with no automatic retry", async () => {
  const error = new Error("synthetic transport timeout"), transport = wire(() => ({ data: null, error }))
  await assert.rejects(load(transport.client).selectOpsRowById("students", STUDENT), (failure) => failure === error)
  assert.equal(transport.queries.length, 1)
})
test("nonstudent exact detail is bounded, identity checked and retains needed roster/business facts", async (t) => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8000); return controller.signal })
  const record = { id: CLASS, student_ids: [STUDENT], waitlist_ids: [id(3)], settlement_state: "retained" }
  const transport = wire(() => ({ data: [record], error: null }))
  assert.deepEqual(plain(await load(transport.client).selectOpsRowById("classes", CLASS)), record)
  assert.deepEqual(transport.queries[0].operations, [["select", "id,name,subject,grade,teacher,room,schedule,schedule_plan,status,student_ids,waitlist_ids,textbook_ids"], ["eq", "id", CLASS], ["order", "id"], ["limit", 1], ["abortSignal", controller.signal], ["retry", false]])
  for (const [table, projection] of [["textbooks", "id,title,name"], ["teacher_catalogs", "id,name,profile_id"]]) {
    const related = wire(() => ({ data: [{ id: CLASS, title: "합성 교재", name: "합성 표시", profile_id: STUDENT }], error: null }))
    const row = await load(related.client).selectOpsRowById(table, CLASS)
    assert.equal(row.profile_id, STUDENT); assert.equal(row.name, "합성 표시")
    assert.equal(related.queries[0].operations[0][1], projection)
    assert.ok(related.queries[0].operations.some(([method, value]) => method === "retry" && value === false))
  }
  const wrong = wire(() => ({ data: [{ id: STUDENT }], error: null }))
  await assert.rejects(load(wrong.client).selectOpsRowById("classes", CLASS), /ops_exact_read_response_invalid/)
  const unknown = wire()
  await assert.rejects(load(unknown.client).selectOpsRowById("unknown", CLASS), /ops_exact_read_table_invalid/)
  assert.equal(unknown.queries.length, 0)
})
test("nonregistration name/school fallback preserves choice while never querying or returning master phones", async () => {
  const transport = wire(() => ({ data: [student({ id: id(9), school: "다른 학교" }), student()], error: null }))
  const result = await load(transport.client).findOpsStudentByName({ type: "word_retest", studentName: "합성 학생", registration: { schoolName: "합성 학교", studentPhone: PHONE } })
  assert.equal(result.id, STUDENT); noPhones(result); assertRead(transport.queries[0], 20)
  assert.deepEqual(transport.queries[0].operations.filter(([method]) => method === "eq"), [["eq", "name", "합성 학생"]])
  const fallback = await load(transport.client).findOpsStudentByName({ type: "withdrawal", studentName: "합성 학생", registration: { schoolName: "없는 학교" } })
  assert.equal(fallback.id, id(9)); noPhones(fallback)
})
test("registration path still resolves explicit UUID before any name fallback", async () => {
  const transport = wire()
  const result = await load(transport.client).findOpsStudentByName({ type: "registration", studentId: STUDENT, studentName: "edited display", registration: { schoolName: "edited school", parentPhone: PARENT } })
  assert.equal(result.id, STUDENT); noPhones(result)
  assert.deepEqual(transport.queries[0].operations.filter(([method]) => method === "eq"), [["eq", "id", STUDENT]])
  const unresolved = wire()
  assert.equal(await load(unresolved.client).findOpsStudentByName({ type: "registration", studentName: "합성 학생" }), null)
  assert.equal(unresolved.queries.length, 0)
})
