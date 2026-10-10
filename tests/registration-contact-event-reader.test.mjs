import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import vm from "node:vm"
import { readRegistrationContactEvents } from "../src/features/tasks/registration-contact-event-reader.ts"

const id = (n) => `99490000-0000-4000-8000-${String(n).padStart(12, "0")}`
const TASK = id(1), ACTOR = id(2), PHONE = "010-0000-9955"
const event = (overrides = {}) => ({ id: id(10), task_id: TASK, actor_id: ACTOR, event_type: "registration_common_info_updated",
  field_name: "registration_common", before_value: null, after_value: JSON.stringify({ version: 1, studentName: "합성 학생", schoolName: "합성 학교", requestNote: "합성 메모", commonRevision: 9 }),
  created_at: "2026-10-09T01:02:03.123456+00:00", ...overrides })
function wire(result = () => ({ data: [event()], error: null }), rawEnvelope = false) {
  const calls = []
  return { calls, client: { rpc(name, args) {
    const call = { name, args, operations: [] }; calls.push(call)
    // Synthetic SQL result shape only; never strip raw fields in this adapter.
    const builder = { then(resolve, reject) {
      const output = result(call)
      return Promise.resolve(!rawEnvelope && Array.isArray(output.data) ? { ...output, data: { events: output.data, legacyImport: null } } : output).then(resolve, reject)
    } }
    for (const method of ["abortSignal", "retry"]) builder[method] = (...args) => { call.operations.push([method, ...args]); return builder }
    return builder
  }, from() { throw new Error("raw-table fallback forbidden") } } }
}
test("real event transport sends bounded exact RPC args and returns sanitized history without changing facts", async (t) => {
  const controller = new AbortController()
  t.mock.method(AbortSignal, "timeout", ms => { assert.equal(ms, 8000); return controller.signal })
  for (const sharedOnly of [true, false]) {
    const transport = wire(), result = await readRegistrationContactEvents(transport.client, TASK, sharedOnly)
    assert.deepEqual(transport.calls[0].args, { p_task_id: TASK, p_limit: 30, p_shared_only: sharedOnly })
    assert.equal(transport.calls[0].name, "read_registration_contact_events_v1")
    assert.deepEqual(transport.calls[0].operations.map(([method]) => method), ["abortSignal", "retry"])
    assert.equal(transport.calls[0].operations[0][1], controller.signal)
    assert.equal(transport.calls[0].operations[1][1], false)
    assert.deepEqual(result, [event()]); assert.equal(result[0].actor_id, ACTOR)
  }
})
test("invalid identity/shared flag never reaches transport", async () => {
  for (const [taskId, flag] of [[TASK + "\n", true], ["uid-display", false], [TASK, null]]) {
    const transport = wire()
    await assert.rejects(readRegistrationContactEvents(transport.client, taskId, flag), /input_invalid/)
    assert.equal(transport.calls.length, 0)
  }
})
test("provider failure propagates with no automatic retry or direct-event fallback", async () => {
  for (const error of [{ code: "42501" }, { code: "PGRST202" }, { code: "55000" }, new Error("synthetic timeout")]) {
    const transport = wire(() => ({ data: null, error }))
    await assert.rejects(readRegistrationContactEvents(transport.client, TASK, true), failure => failure === error)
    assert.equal(transport.calls.length, 1)
  }
})
test("abort before or during read prevents publishing data even if the mock transport ignores abort", async () => {
  const prior = new AbortController(); prior.abort()
  const noRead = wire()
  await assert.rejects(readRegistrationContactEvents(noRead.client, TASK, true, prior.signal), failure => failure.name === "AbortError")
  assert.equal(noRead.calls.length, 0)
  const during = new AbortController(), transport = wire(() => { during.abort(); return { data: [event()], error: null } })
  await assert.rejects(readRegistrationContactEvents(transport.client, TASK, true, during.signal), failure => failure.name === "AbortError")
})
test("nullable actor and text values remain valid; known raw contact field values must already be null", async () => {
  const row = event({ actor_id: null, field_name: "parent_phone", before_value: null, after_value: null })
  assert.deepEqual(await readRegistrationContactEvents(wire(() => ({ data: [row], error: null })).client, TASK, false), [row])
  await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [event({ field_name: "parent_phone", after_value: PHONE })], error: null })).client, TASK, false), /response_invalid/)
})
test("real response gate rejects raw contact aliases at nested object/array paths rather than stripping after HTTP", async () => {
  const aliases = ["contact", "parent_contact", "parentContact", "phone", "student_contact", "studentContact", "student_phone", "studentPhone", "parent_phone", "parentPhone", "guardian_contact", "guardianContact", "guardian_phone", "guardianPhone"]
  for (const alias of aliases) {
    const row = event({ after_value: JSON.stringify({ metadata: [{ [alias]: PHONE }], commonRevision: 9 }) })
    await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [row], error: null })).client, TASK, false), /response_invalid/)
    assert.equal(row.after_value.includes(PHONE), true, "gate does not silently alter producer data")
  }
})
test("unstructured notes, plain history and phone-consultation timestamp keys are preserved", async () => {
  for (const value of [PHONE, "plain history", JSON.stringify({ requestNote: PHONE, phoneConsultationAt: "2026-10-09T01:00:00Z", phoneReadySource: "inquiry", source: "phone_consultation" })]) {
    const row = event({ after_value: value })
    assert.equal((await readRegistrationContactEvents(wire(() => ({ data: [row], error: null })).client, TASK, false))[0].after_value, value)
  }
})
test("missing/extra keys, wrong task, invalid IDs, bad dates, duplicate IDs and excessive rows fail closed", async () => {
  const missing = event(); delete missing.actor_id
  for (const data of [null, {}, [missing], [event({ raw_phone: PHONE })], [event({ task_id: id(99) })], [event({ id: "event-display" })],
    [event({ actor_id: "actor-display" })], [event({ created_at: "2026-02-31T00:00:00Z" })], [event(), event()], Array.from({ length: 31 }, (_, n) => event({ id: id(100 + n) }))]) {
    await assert.rejects(readRegistrationContactEvents(wire(() => ({ data, error: null })).client, TASK, true), /response_invalid/)
  }
})
test("created-at ordering preserves microseconds and equivalent timezone offsets", async () => {
  const data = [event({ id: id(20), created_at: "2026-10-09T10:02:03.123456+09:00" }), event({ id: id(10), created_at: "2026-10-09T01:02:03.123455Z" })]
  assert.deepEqual(await readRegistrationContactEvents(wire(() => ({ data, error: null })).client, TASK, true), data)
  await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [...data].reverse(), error: null })).client, TASK, true), /response_invalid/)
  const same = [event({ id: id(10) }), event({ id: id(20) })]
  assert.deepEqual(await readRegistrationContactEvents(wire(() => ({ data: same, error: null })).client, TASK, true), same)
  await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [...same].reverse(), error: null })).client, TASK, true), /response_invalid/)
})
test("technical byte/depth caps fail closed with no truncation", async () => {
  let deep = "leaf"; for (let n = 0; n < 65; n++) deep = { child: deep }
  for (const value of ["x".repeat(128000), JSON.stringify(deep)]) {
    await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [event({ after_value: value })], error: null })).client, TASK, true), /response_invalid/)
  }
})
test("malformed history remains unstructured text while exact contact field names require null values", async () => {
  const malformed = '{malformed "version": 2 "event_type": "registration_observation_nested"'
  assert.equal((await readRegistrationContactEvents(wire(() => ({ data: [event({ after_value: malformed })], error: null })).client, TASK, true))[0].after_value, malformed)
  await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: [event({ field_name: "parentPhone", after_value: malformed })], error: null })).client, TASK, true), /response_invalid/)
})
function legacySnapshot(events) {
  const source = readFileSync(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  const syntax = ts.createSourceFile("registration-track-service.ts", source, ts.ScriptTarget.Latest, true)
  const names = new Set(["value", "text", "parseJsonRecord", "numberValue", "bool", "buildRegistrationMigrationLegacySnapshot"])
  const actual = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
    .map(node => node.getText(syntax)).join("\n")
  const runtime = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`${actual}\nmodule.exports={buildRegistrationMigrationLegacySnapshot};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: runtime, exports: runtime.exports })
  return runtime.exports.buildRegistrationMigrationLegacySnapshot({ id: TASK }, {}, events)
}
test("bounded latest30 plus an older legacy anchor retains the actual migration-review snapshot", async () => {
  const events = Array.from({ length: 30 }, (_, n) => event({ id: id(100 + n), created_at: "2026-10-09T01:00:00Z" }))
  const legacyImport = event({ id: id(90), event_type: "legacy_registration_imported", created_at: "2026-10-01T00:00:00Z",
    before_value: JSON.stringify({ studentId: id(80), classId: id(81), pipelineStatus: "legacy" }),
    after_value: JSON.stringify({ version: 1, timestamps: { phoneConsultationAt: "2026-09-01T00:00:00Z" }, legacyBooleans: { paymentChecked: true } }) })
  const result = await readRegistrationContactEvents(wire(() => ({ data: { events, legacyImport }, error: null }), true).client, TASK, true)
  assert.equal(result.length, 31)
  assert.equal(result.at(-1).id, legacyImport.id)
  const snapshot = legacySnapshot(result)
  assert.equal(snapshot.snapshotMissing, false)
  assert.equal(snapshot.studentId, id(80)); assert.equal(snapshot.classId, id(81)); assert.equal(snapshot.paymentChecked, true)
  assert.equal(snapshot.phoneConsultationAt, "2026-09-01T00:00:00Z")
})
test("legacy anchor already inside the timeline is deduplicated with an identical sanitized row", async () => {
  const legacyImport = event({ event_type: "legacy_registration_imported", after_value: JSON.stringify({ version: 1 }) })
  const result = await readRegistrationContactEvents(wire(() => ({ data: { events: [legacyImport], legacyImport }, error: null }), true).client, TASK, true)
  assert.equal(result.length, 1); assert.equal(legacySnapshot(result).snapshotMissing, false)
  await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: { events: [legacyImport], legacyImport: { ...legacyImport, before_value: "conflicting identity" } }, error: null }), true).client, TASK, true), /response_invalid/)
})
test("newer malformed and non-v1 imports do not hide an older valid v1 migration snapshot", async () => {
  const malformed = event({ id: id(60), event_type: "legacy_registration_imported", created_at: "2026-10-09T03:00:00Z", after_value: '{"version":' })
  const nonV1 = event({ id: id(61), event_type: "legacy_registration_imported", created_at: "2026-10-09T02:00:00Z", after_value: JSON.stringify({ version: 2 }) })
  const valid = event({ id: id(62), event_type: "legacy_registration_imported", created_at: "2026-10-01T01:00:00Z",
    before_value: JSON.stringify({ studentId: id(80), classId: id(81) }), after_value: JSON.stringify({ version: "1", legacyBooleans: { paymentChecked: true } }) })
  // Reference selection uses the actual existing mapper, not a regex JSON mock.
  // This models the SQL fixture's selected envelope; no PostgreSQL execution.
  const history = [malformed, nonV1, valid]
  const legacyImport = history.find(row => !legacySnapshot([row]).snapshotMissing) ?? null
  assert.equal(legacyImport.id, valid.id)
  const result = await readRegistrationContactEvents(wire(() => ({ data: { events: [malformed, nonV1], legacyImport }, error: null }), true).client, TASK, true)
  const snapshot = legacySnapshot(result)
  assert.equal(snapshot.snapshotMissing, false); assert.equal(snapshot.studentId, id(80)); assert.equal(snapshot.paymentChecked, true)
  for (const badAnchor of [malformed, nonV1]) {
    await assert.rejects(readRegistrationContactEvents(wire(() => ({ data: { events: [], legacyImport: badAnchor }, error: null }), true).client, TASK, true), /response_invalid/)
  }
})
test("legacy anchor response predicate preserves the actual mapper's JSON Number(version) semantics", async () => {
  const versions = [1, "1", true, [1], [["1"]], " 1e0 ", "0x01", "0o01", "0b01", "\uFEFF1\u00a0", "1.00000000000000001", 2, "2", false, null, [], [1, 1], {}, "NaN", "Infinity", "+0x1"]
  for (const version of versions) {
    const row = event({ event_type: "legacy_registration_imported", after_value: JSON.stringify({ version }) })
    const valid = !legacySnapshot([row]).snapshotMissing
    const read = () => readRegistrationContactEvents(wire(() => ({ data: { events: [], legacyImport: row }, error: null }), true).client, TASK, true)
    if (valid) assert.equal((await read())[0].id, row.id)
    else await assert.rejects(read(), /response_invalid/)
  }
})
test("missing legacy snapshot remains missing; wrong type/task/raw contact or envelope keys fail closed", async () => {
  const result = await readRegistrationContactEvents(wire(() => ({ data: { events: [event()], legacyImport: null }, error: null }), true).client, TASK, true)
  assert.equal(legacySnapshot(result).snapshotMissing, true)
  for (const data of [[], { events: [] }, { events: [], legacyImport: null, rawPhone: PHONE },
    { events: [], legacyImport: event() }, { events: [], legacyImport: event({ event_type: "legacy_registration_imported", task_id: id(99) }) },
    { events: [], legacyImport: event({ event_type: "legacy_registration_imported", before_value: JSON.stringify({ studentPhone: PHONE }) }) }]) {
    await assert.rejects(readRegistrationContactEvents(wire(() => ({ data, error: null }), true).client, TASK, true), /response_invalid/)
  }
})
const sql = readFileSync(new URL("../docs/security/sql/registration-contact-event-reader-draft.sql", import.meta.url), "utf8")
test("source-bound SQL predicate model agrees with the actual mapper on representative JSON coercion cases", () => {
  const body = sql.split("as $legacy_predicate$")[1].split("end $legacy_predicate$;")[0]
  const decimal = new RegExp(body.match(/version_text !~ '([^']+)'/u)[1])
  const radix = [...body.matchAll(/version_text ~ '([^']+)'/gu)].map(match => new RegExp(match[1]))
  const whitespace = [...body.match(/U&'([^']+)'/u)[1].matchAll(/\\([0-9A-Fa-f]{4})/gu)]
    .map(match => String.fromCodePoint(parseInt(match[1], 16))).join("")
  const model = raw => {
    let payload; try { payload = JSON.parse(raw) } catch { return false }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
    let version = payload.version, fromArray = false
    while (Array.isArray(version)) { if (version.length !== 1) return false; [version] = version; fromArray = true }
    if (typeof version === "boolean") return !fromArray && version
    if (typeof version !== "number" && typeof version !== "string") return false
    let text = String(version)
    while (text.length && whitespace.includes(text[0])) text = text.slice(1)
    while (text.length && whitespace.includes(text.at(-1))) text = text.slice(0, -1)
    return radix.some(pattern => pattern.test(text)) || (decimal.test(text) && Number(text) === 1)
  }
  for (const version of [1, "1", "1.0", "1e0", "\uFEFF1\u00a0", true, [1], [["1"]], [true], "0x01", "0o01", "0b01",
    "1.00000000000000001", 2, null, false, [], [1, 1], {}, "NaN", "Infinity", "+0x1", "1x", "1\u200B"]) {
    const raw = JSON.stringify({ version }), row = event({ event_type: "legacy_registration_imported", after_value: raw })
    assert.equal(model(raw), !legacySnapshot([row]).snapshotMissing, JSON.stringify(version))
  }
  assert.equal(model('{"version":'), false)
  assert.equal(model('[{"version":1}]'), false)
  // The model checks source literals against the real JS predicate. It does
  // not establish PostgreSQL parser/float8/exception/ACL behavior at runtime.
})
test("SQL source establishes bounded authenticated INVOKER task/event RLS and shared-visible filter without table changes", () => {
  assert.match(sql, /security invoker\nset search_path = ''/u)
  assert.match(sql, /auth\.uid\(\)/u)
  assert.match(sql, /task\.id=p_task_id and task\.type='registration'/u)
  assert.match(sql, /event\.task_id=p_task_id/u)
  assert.match(sql, /not p_shared_only or public\.registration_task_event_shared_visible\(event\)/u)
  assert.match(sql, /order by event\.created_at desc,event\.id asc\n      limit p_limit/u)
  assert.match(sql, /event\.event_type='legacy_registration_imported'/u)
  assert.match(sql, /and dashboard_private\.registration_contact_legacy_import_valid_v1\(event\.after_value\)\n      order by event\.created_at desc,event\.id asc\n      limit 1/u)
  assert.match(sql, /limit 1\n    \) legacy/u)
  assert.match(sql, /order by selected\.legacy_read asc,selected\.created_at desc,selected\.id asc/u)
  assert.match(sql, /pg_catalog\.jsonb_build_object\('events',events_json,'legacyImport',legacy_json\)/u)
  assert.match(sql, /p_limit > 30/u)
  assert.match(sql, /page_bytes > 128000/u); assert.match(sql, /output_bytes > 128000/u)
  assert.match(sql, /pg_catalog\.cardinality\(removal_path\)>64/u)
  assert.match(sql, /target\.proowner<>'postgres'::pg_catalog\.regrole/u)
  assert.match(sql, /pg_catalog\.aclexplode/u)
  assert.doesNotMatch(sql, /\b(?:security definer|create policy|alter table|update public\.|delete from public\.)/iu)
  assert.match(sql, /from public,anon,authenticated,service_role;\ngrant execute[^\n]+to authenticated;/u)
  assert.match(sql, /create function dashboard_private\.registration_contact_legacy_import_valid_v1\(p_after_value text\)\nreturns boolean\nlanguage plpgsql\nimmutable\nsecurity invoker\nset search_path = ''/u)
  assert.match(sql, /payload := p_after_value::json/u)
  assert.match(sql, /json_typeof\(payload\) is distinct from 'object'/u)
  assert.match(sql, /json_array_length\(version_value\)<>1/u)
  assert.match(sql, /version_text::double precision = 1::double precision/u)
})
test("SQL sanitization source removes known keys recursively and scalar-contact fields while retaining legacy text", () => {
  assert.match(sql, /event_row\.field_name=any\(contact_keys\)/u)
  assert.match(sql, /with recursive nodes\(path,value\)/u)
  assert.match(sql, /jsonb_array_elements/u)
  assert.match(sql, /where entry\.key=any\(contact_keys\)/u)
  assert.match(sql, /payload := payload #- removal_path/u)
  assert.match(sql, /sanitized_values := pg_catalog\.array_append\(sanitized_values,raw_value\)/u)
  assert.match(sql, /parsed_payload := raw_value::json;\n      exception when invalid_text_representation/u)
  assert.match(sql, /payload := parsed_payload::jsonb;\n      exception when data_exception/u)
  assert.match(sql, /registration_contact_event_reader_json_unrepresentable' using errcode='55000'/u)
  assert.doesNotMatch(sql, /regexp_replace/u)
  const commonProducer = readFileSync(new URL("../supabase/migrations/20260901110500_registration_flat_common_input_decoupling.sql", import.meta.url), "utf8")
  const history = commonProducer.slice(commonProducer.indexOf("insert into public.ops_task_events("), commonProducer.indexOf("v_response :=", commonProducer.indexOf("insert into public.ops_task_events(")))
  assert.equal((history.match(/'parentPhone'/gu) ?? []).length, 2)
  assert.equal((history.match(/'studentPhone'/gu) ?? []).length, 2)
  assert.match(history, /'registration_common_info_updated'/u)
})
test("both real registration consumers use RPC; nonregistration ops events keep their table path", () => {
  const ops = readFileSync(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
  const track = readFileSync(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(ops, /taskType === "registration"\s*\? readRegistrationContactEvents\(supabase, taskId, false\)/u)
  assert.match(ops, /: supabase\.from\("ops_task_events"\)/u)
  assert.match(track, /readRegistrationContactEvents\(client, safeTaskId, true, signal\)/u)
  assert.doesNotMatch(track, /client\.from\("ops_task_events"\)|EVENT_COLUMNS/u)
})
