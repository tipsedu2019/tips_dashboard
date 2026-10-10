import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { ACTIVE_STUDENT_STATUS } from "../src/lib/student-status.js"
import { stripRegistrationInquiryContact, stripRegistrationTaskContact } from "../src/features/tasks/registration-contact-client.ts"
import { readRegistrationContactEvents } from "../src/features/tasks/registration-contact-event-reader.ts"
import { STUDENT_MASTER_READ_COLUMNS, projectStudentMasterRecord } from "../src/features/management/student-master-privacy.js"
import { isRegistrationCompletionImmutable } from "../src/features/tasks/registration-workflow.js"
import { getTaskTypeLabel, REGISTRATION_PIPELINE_STATUSES } from "../src/features/tasks/ops-task-model.js"

const source = await readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
const syntax = ts.createSourceFile("ops-task-service.ts", source, ts.ScriptTarget.Latest, true)
const constants = new Set(["OPS_TASK_STATUS_VALUES", "OPS_TASK_PRIORITY_VALUES", "OPS_REGISTRATION_SESSION_CACHE_PREFIX", "OPS_REGISTRATION_SESSION_CACHE_TTL_MS",
  "MANAGEMENT_INPUT_FIELDS", "MANAGEMENT_LINK_FIELDS", "MANAGEMENT_CHOICE_FIELDS", "OPS_CLASS_COLUMN_CANDIDATES"])
// Execute the real production functions, with only the transport/global boundaries
// injected. Private consumers are exposed solely inside this test VM.
const declarations = syntax.statements.filter((node) => ts.isFunctionDeclaration(node)
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => constants.has(item.name.getText(syntax)))))
  .map((node) => node.getText(syntax)).join("\n")
const tested = ["resolveOpsRegistrationStudent", "findOpsStudentByName", "ensureOpsStudent", "restoreOpsRegistrationStudentSnapshot",
  "mapRegistration", "mapOpsTaskPageRow", "buildRegistrationRow", "inputFromTask", "isRegistrationWorkflowComplete",
  "assertCompletedOperationStatusTransition", "assertCompletedOperationEditable", "updateRegistrationOpsTaskStatus", "createOpsTask", "getPersistedOpsTaskWorkspaceData", "persistOpsTaskWorkspaceData", "loadOpsTaskById", "readOpsTaskWorkspaceOptionData"]
const compiled = ts.transpileModule(`${declarations}\nmodule.exports={${tested.join(",")}};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function load(supabase, boundaries = {}) {
  const runtime = { exports: {} }
  vm.runInNewContext(compiled, { module: runtime, exports: runtime.exports, supabase,
    AbortSignal, Date, Map, Set, Object, Number, Error, Promise, ACTIVE_STUDENT_STATUS,
    stripRegistrationInquiryContact, stripRegistrationTaskContact,
    readRegistrationContactEvents, STUDENT_MASTER_READ_COLUMNS, projectStudentMasterRecord,
    isRegistrationCompletionImmutable, REGISTRATION_PIPELINE_STATUSES, getTaskTypeLabel, ...boundaries,
  })
  return runtime.exports
}
const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const STUDENT = id(1)
const TASK = id(2)
const CLASS = id(3)
const PHONE = "010-0000-0000" // synthetic canaries only
const PARENT = "010-0000-0001"
const input = (overrides = {}) => ({ title: "합성 등록", type: "registration", status: "requested", studentId: STUDENT,
  studentName: "수정된 표시 이름", classId: CLASS, subject: "영어",
  registration: { pipelineStatus: "0. 등록 문의", schoolName: "새 학교", schoolGrade: "중2",
    studentPhone: PHONE, parentPhone: PARENT, requestNote: "미저장 메모" }, ...overrides })
const student = (overrides = {}) => ({ id: STUDENT, name: "이전 표시 이름", school: "이전 학교", grade: "중1",
  contact: PHONE, parent_contact: PARENT, status: "재원", enroll_date: "2026-10-01",
  class_ids: [CLASS], waitlist_class_ids: [id(4)], ...overrides })
function wire(result = (query) => ({ data: query.kind === "update" ? [{ id: STUDENT }] : [student()], error: null })) {
  const queries = []
  function build(table, rpcName = null, args = null) {
    const query = { table, rpcName, args, kind: "read", operations: [], payload: null }
    queries.push(query)
    const builder = { then(resolve, reject) { return Promise.resolve(result(query)).then(resolve, reject) } }
    for (const method of ["select", "eq", "in", "order", "limit", "abortSignal", "retry", "single", "maybeSingle", "update", "upsert", "insert"]) {
      builder[method] = (...args) => {
        query.operations.push({ method, args })
        if (["update", "upsert", "insert"].includes(method)) { query.kind = method; query.payload = args[0] }
        return builder
      }
    }
    return builder
  }
  return { queries, supabase: { from(table) { return build(table) }, rpc(name, args) { return build(null, name, args) } } }
}
function noCanaries(value) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes(PHONE), false)
  assert.equal(serialized.includes(PARENT), false)
}
function assertContactFreeQuery(query) {
  const projection = query.operations.find((operation) => operation.method === "select").args[0]
  assert.equal(projection.includes("contact"), false)
  assert.equal(projection.includes("*"), false)
  assert.ok(query.operations.some((operation) => operation.method === "order" && operation.args[0] === "id"))
  assert.ok(query.operations.some((operation) => operation.method === "limit" && operation.args[0] <= 30))
  assert.ok(query.operations.some((operation) => operation.method === "abortSignal" && operation.args[0] instanceof AbortSignal))
  assert.ok(query.operations.some((operation) => operation.method === "retry" && operation.args[0] === false))
}

for (const legacySchema of [false, true]) {
  test(`real ${legacySchema ? "legacy fallback" : "current"} student options discard raw contacts and preserve business identity and roster metadata`, async () => {
    const rawStudent = student();
    if (legacySchema) {
      delete rawStudent.class_ids;
      delete rawStudent.waitlist_class_ids;
    }
    const sourceClass = { id: CLASS, name: "합성 수업", subject: "영어", grade: "중2", teacher: "합성 선생님",
      room: "합성 강의실", schedule: "월 18:00", student_ids: [STUDENT], waitlist_ids: [id(4)], textbook_ids: [id(5)] };
    const transport = wire((query) => {
      if (query.table === "students") {
        const projection = query.operations.find((operation) => operation.method === "select").args[0];
        if (legacySchema && projection.includes("class_ids")) {
          return { data: null, error: { code: "42703", message: "column class_ids does not exist" } };
        }
        // A stale/overbroad transport response still cannot rehydrate DTO phones.
        return { data: [rawStudent], error: null };
      }
      return { data: query.table === "classes" ? [sourceClass] : [], error: null };
    });
    const result = await load(transport.supabase).readOpsTaskWorkspaceOptionData({ taskType: "withdrawal" });
    assert.equal(result.schemaReady, true);
    assert.equal(result.error, null);
    noCanaries(result);
    assert.deepEqual(JSON.parse(JSON.stringify(result.students)), [{ id: STUDENT, label: rawStudent.name,
      meta: "중1 · 이전 학교 · 재원", grade: "중1", school: "이전 학교", status: "재원",
      contact: "", parentContact: "", classIds: legacySchema ? [] : [CLASS], waitlistClassIds: legacySchema ? [] : [id(4)] }]);
    assert.equal(result.classes[0].id, CLASS);
    assert.equal(result.classes[0].label, sourceClass.name);
    assert.deepEqual(Array.from(result.classes[0].studentIds), [STUDENT]);
    assert.deepEqual(Array.from(result.classes[0].waitlistIds), [id(4)]);
    assert.deepEqual(Array.from(result.classes[0].textbookIds), [id(5)]);
    const studentQueries = transport.queries.filter((query) => query.table === "students");
    assert.deepEqual(studentQueries.map((query) => query.operations.find((operation) => operation.method === "select").args[0]),
      legacySchema ? ["id,name,grade,school,status,class_ids,waitlist_class_ids", "id,name,grade,school,status"]
        : ["id,name,grade,school,status,class_ids,waitlist_class_ids"]);
    assert.ok(transport.queries.every((query) => query.kind === "read"));
    assert.equal(rawStudent.contact, PHONE);
    assert.equal(rawStudent.parent_contact, PARENT);
  });
}

test("registration UUID resolves independently of edited name, school and erased phones", async (t) => {
  const clock = new AbortController()
  t.mock.method(AbortSignal, "timeout", (ms) => { assert.equal(ms, 8000); return clock.signal })
  const transport = wire()
  const service = load(transport.supabase)
  const result = await service.resolveOpsRegistrationStudent(input({ registration: { schoolName: "another school" } }))
  assert.equal(result.id, STUDENT)
  noCanaries(result)
  assert.equal(transport.queries.length, 1)
  assertContactFreeQuery(transport.queries[0])
  assert.deepEqual(transport.queries[0].operations.filter((operation) => operation.method === "eq").map((operation) => operation.args), [["id", STUDENT]])
})

test("unresolved inquiry never searches or creates by name/phone", async () => {
  const transport = wire()
  const service = load(transport.supabase)
  const unresolved = input({ studentId: undefined })
  assert.equal(await service.resolveOpsRegistrationStudent(unresolved), null)
  assert.equal(await service.findOpsStudentByName(unresolved), null)
  assert.equal(transport.queries.length, 0)
})

test("display numbers and malformed UUIDs never reach registration transport", async () => {
  for (const studentId of ["원생번호-123", STUDENT + "\n", " " + STUDENT, "123", "{}"]) {
    const transport = wire()
    await assert.rejects(() => load(transport.supabase).resolveOpsRegistrationStudent(input({ studentId })), /UUID/)
    assert.equal(transport.queries.length, 0)
  }
})

test("a missing UUID target or mismatched producer row fails instead of using a same-name student", async () => {
  for (const data of [[], [student({ id: id(99) })]]) {
    const transport = wire(() => ({ data, error: null }))
    await assert.rejects(() => load(transport.supabase).resolveOpsRegistrationStudent(input()), /연결된 학생/)
    assert.equal(transport.queries.length, 1)
    assert.equal(transport.queries[0].kind, "read")
  }
})

test("student metadata updates and rollback snapshots never copy either contact slot", async () => {
  const transport = wire((query) => ({ data: [student({ name: query.payload?.name || "이전 이름" })], error: null }))
  const service = load(transport.supabase)
  const original = Object.freeze(student())
  const result = await service.ensureOpsStudent(input(), original)
  assert.equal(result.id, STUDENT)
  noCanaries(result)
  await service.restoreOpsRegistrationStudentSnapshot(STUDENT, original)
  for (const query of transport.queries) {
    assert.equal(query.kind, "update")
    for (const key of ["contact", "parent_contact", "studentPhone", "parentPhone"]) assert.equal(Object.hasOwn(query.payload, key), false)
    noCanaries(query.payload)
    assertContactFreeQuery(query)
  }
  assert.equal(transport.queries[0].payload.name, "수정된 표시 이름")
  assert.equal(transport.queries[1].payload.name, original.name)
  assert.equal(original.contact, PHONE)
})

test("unresolved/mismatched student is rejected before any ensure mutation", async () => {
  for (const [record, studentId] of [[null, STUDENT], [student(), undefined], [student(), id(99)]]) {
    const transport = wire()
    await assert.rejects(() => load(transport.supabase).ensureOpsStudent(input({ studentId }), record), /UUID/)
    assert.equal(transport.queries.length, 0)
  }
})

test("concurrent deletion cannot become an upsert auto-created registration student", async () => {
  const transport = wire(() => ({ data: [], error: null }))
  await assert.rejects(() => load(transport.supabase).ensureOpsStudent(input(), student()), /연결된 학생/)
  assert.equal(transport.queries.length, 1)
  assert.equal(transport.queries[0].kind, "update")
  assert.equal(transport.queries.some((query) => query.kind === "insert" || query.kind === "upsert"), false)
})

test("registration detail serialization and task snapshots omit retired contact slots", () => {
  const service = load(null)
  const mapped = service.mapRegistration({ pipeline_status: "inquiry", parent_phone: PARENT, student_phone: PHONE, request_note: "업무 메모" })
  noCanaries(mapped)
  const payload = service.buildRegistrationRow(TASK, input().registration)
  assert.equal(Object.hasOwn(payload, "student_phone"), false)
  assert.equal(Object.hasOwn(payload, "parent_phone"), false)
  noCanaries(payload)
  const task = { id: TASK, ...input(), registration: { ...input().registration, student_phone: PHONE, parent_phone: PARENT } }
  const snapshot = service.inputFromTask(task)
  noCanaries(snapshot)
  assert.equal(snapshot.registration.requestNote, "미저장 메모")
  assert.equal(snapshot.studentId, STUDENT)
  assert.equal(task.registration.parentPhone, PARENT)
})

for (const pipelineStatus of ["4-1. 현재 수업 대기", "7. 등록 완료"]) {
  test(`actual create rejects missing UUID before writes for ${pipelineStatus}`, async () => {
    const transport = wire()
    const service = load(transport.supabase, {
      // These unrelated inquiry/workflow validations are separate contracts;
      // the production UUID gate and create entrypoint execute here unchanged.
      getRegistrationCreateBlockers: () => [], getRegistrationTransitionBlockers: () => [],
      isRegistrationClassWaitlistStatus: (value) => String(value).startsWith("4-1."),
    })
    await assert.rejects(() => service.createOpsTask(input({ studentId: undefined,
      registration: { ...input().registration, pipelineStatus, classStartDate: "2026-10-09", classStartSession: "1교시",
        makeeduRegistered: true, makeeduInvoiceSent: true, paymentChecked: true },
    })), /학생/)
    assert.equal(transport.queries.length, 0)
  })
}

test("manual case status has no canonical-completion inference or roster/detail mutation", async () => {
  const transport = wire(() => ({ data: [{ id: TASK }], error: null }))
  const closes = []
  const service = load(transport.supabase, { closeRegistrationCaseContact: async input => closes.push(input), crypto: { randomUUID: () => id(80) } })
  assert.equal(service.isRegistrationWorkflowComplete(input({ status: "done" })), false)
  assert.equal(service.isRegistrationWorkflowComplete(input({ registration: { pipelineStatus: "7. 등록 완료" } })), true)
  for (const status of ["done", "canceled", "in_progress"]) {
    await service.updateRegistrationOpsTaskStatus({ id: TASK, ...input() }, status)
  }
  assert.equal(transport.queries.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(closes)), [{taskId:TASK,requestKey:id(80)}])
  assert.ok(transport.queries.every((query) => query.table === "ops_tasks" && query.kind === "update"))
  assert.deepEqual(transport.queries.map((query) => query.payload.status), ["done", "in_progress"])
})

test("old persisted tasks and independent page rows are erased on read and fresh cache write", () => {
  const storage = new Map()
  const sessionStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
  const service = load(null, { window: { sessionStorage } })
  const options = { taskType: "registration", viewerId: id(90), includeManagementOptions: false }
  const task = { id: TASK, type: "registration", registration: { parentPhone: PARENT, studentPhone: PHONE,
    student_phone: PHONE, parent_phone: PARENT, requestNote: "業務メモ" } }
  const data = { tasks: [task], page: { rows: [structuredClone(task)], hasMore: false, nextCursor: null }, schemaReady: true, error: null }
  service.persistOpsTaskWorkspaceData(options, data)
  assert.equal(storage.size, 1)
  noCanaries([...storage.values()][0])
  const key = [...storage.keys()][0]
  const expiresAt = Date.now() + 60000
  storage.set(key, JSON.stringify({ expiresAt, data }))
  const loaded = service.getPersistedOpsTaskWorkspaceData(options)
  noCanaries(loaded)
  noCanaries(storage.get(key))
  assert.equal(loaded.tasks[0].registration.requestNote, "業務メモ")
  assert.equal(loaded.page.rows[0].registration.requestNote, "業務メモ")
  assert.equal(JSON.parse(storage.get(key)).expiresAt, expiresAt)
  assert.equal(data.tasks[0].registration.parentPhone, PARENT)
})

test("contact-free detail read keeps every actor label while profile queries stay capped at thirty", async () => {
  const parent = { id: TASK, type: "registration", status: "requested", pipeline_status: "inquiry", student_id: STUDENT }
  const comments = Array.from({ length: 30 }, (_, n) => ({ id: id(100 + n), task_id: TASK, author_id: id(1000 + n), body: "업무 댓글" }))
  const attachments = Array.from({ length: 30 }, (_, n) => ({ id: id(200 + n), task_id: TASK, uploaded_by: id(2000 + n), file_name: "업무 파일" }))
  const events = Array.from({ length: 30 }, (_, n) => ({ id: id(300 + n), task_id: TASK, actor_id: id(3000 + n),
    event_type: "registration_fact_saved", field_name: "업무 상태", before_value: null, after_value: null, created_at: "2026-10-09T00:00:00Z" }))
  const transport = wire((query) => {
    if (query.table === "ops_tasks") return { data: parent, error: null }
    if (query.table === "ops_registration_details") return { data: { task_id: TASK, pipeline_status: "inquiry", parent_phone: PARENT, student_phone: PHONE }, error: null }
    if (query.table === "ops_task_comments") return { data: comments, error: null }
    if (query.table === "ops_task_attachments") return { data: attachments, error: null }
    if (query.rpcName === "read_registration_contact_events_v1") {
      assert.deepEqual(query.args, { p_task_id: TASK, p_limit: 30, p_shared_only: false })
      return { data: { events, legacyImport: null }, error: null }
    }
    if (query.table === "profiles") return { data: query.operations.find((operation) => operation.method === "in").args[1].map((profileId) => ({ id: profileId, name: `합성 담당 ${profileId}` })), error: null }
    assert.fail(`unexpected table ${query.table}`)
  })
  const result = await load(transport.supabase).loadOpsTaskById(TASK)
  noCanaries(result.registration)
  assert.equal(result.comments[29].authorLabel, `합성 담당 ${id(1029)}`)
  assert.equal(result.attachments[29].uploadedByLabel, `합성 담당 ${id(2029)}`)
  assert.equal(result.events[29].actorLabel, `합성 담당 ${id(3029)}`)
  const profiles = transport.queries.filter((query) => query.table === "profiles")
  assert.equal(profiles.length, 3)
  assert.ok(profiles.every((query) => query.operations.find((operation) => operation.method === "in").args[1].length <= 30))
  assert.ok(profiles.every((query) => query.operations.find((operation) => operation.method === "limit").args[0] === 30))
  const detail = transport.queries.find((query) => query.table === "ops_registration_details")
  const projection = detail.operations.find((operation) => operation.method === "select").args[0]
  assert.equal(projection.includes("parent_phone"), false)
  assert.equal(projection.includes("student_phone"), false)
})

 test("failed whole-case contact closure cannot fall through to a parent status or detail write", async () => {
  const transport=wire();
  const service=load(transport.supabase,{crypto:{randomUUID:()=>id(80)},closeRegistrationCaseContact:async()=>{throw Error("registration_contact_runtime_unavailable")}});
  await assert.rejects(service.updateRegistrationOpsTaskStatus({id:TASK,...input()},"canceled"),/registration_contact_runtime_unavailable/);
  assert.equal(transport.queries.length,0);
 });
 test("manual case done can reopen while explicit roster-completed legacy links retain immutable guards", () => {
  const service=load(null);
  const manual={id:TASK,...input({status:"done"})};
  assert.doesNotThrow(()=>service.assertCompletedOperationStatusTransition(manual,"requested"));
  assert.doesNotThrow(()=>service.assertCompletedOperationEditable(manual));
  const roster={...manual,registration:{pipelineStatus:"7. 등록 완료"}};
  assert.throws(()=>service.assertCompletedOperationStatusTransition(roster,"requested"),/학생·수업·교재 연결/);
  assert.throws(()=>service.assertCompletedOperationEditable(roster),/학생·수업·교재 연결/);
 });
