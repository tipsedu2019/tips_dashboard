import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import vm from "node:vm"
import { normalizeStudentManagementRecord } from "../src/features/management/records.js"
import { stripRegistrationTaskContact } from "../src/features/tasks/registration-contact-client.ts"
import { REGISTRATION_PIPELINE_STATUSES } from "../src/features/tasks/ops-task-model.js"
import { readerSourceHash, readerSqlLiteral, readFinalStudentContactReaderSources, replaceReaderSourceOnce, STUDENT_CONTACT_READER_SIGNATURES } from "./helpers/student-contact-reader-final-source.mjs"

// Source/mock evidence only. These tests never execute PostgreSQL and do not
// establish installed pg_proc, SQLSTATE, owner/ACL, RLS or runtime behavior.
const draft = readFileSync(new URL("../docs/security/sql/student-contact-reader-minimization-draft.sql", import.meta.url), "utf8")
const finalSources = readFinalStudentContactReaderSources()
function literalArray(source, start) {
  let at = start, values = []
  for (;;) {
    while (/\s/u.test(source[at] ?? "") || source[at] === ",") at++
    if (source[at] === "]") return { values, end: at + 1 }
    const literal = readerSqlLiteral(source, at)
    values.push(literal.value); at = literal.end
  }
}
const candidates = new Map()
for (const match of draft.matchAll(/\('([^']+)', '([a-f0-9]{64})', '([a-f0-9]{64})',\s*array\[/gu)) {
  const old = literalArray(draft, match.index + match[0].length)
  const next = draft.indexOf("array[", old.end)
  assert.notEqual(next, -1)
  const changed = literalArray(draft, next + "array[".length)
  assert.equal(old.values.length, changed.values.length)
  const original = finalSources.get(match[1])
  assert.ok(original)
  assert.equal(readerSourceHash(original.body), match[2])
  const body = old.values.reduce((result, anchor, i) => replaceReaderSourceOnce(result, anchor, changed.values[i], match[1]), original.body)
  assert.equal(readerSourceHash(body), match[3])
  candidates.set(match[1], { body, original: original.body, old: old.values, changed: changed.values })
}

test("eight exact final ordered definitions and fifteen unique changes are modeled", () => {
  assert.deepEqual([...candidates.keys()], STUDENT_CONTACT_READER_SIGNATURES)
  assert.equal([...candidates.values()].reduce((count, row) => count + row.old.length, 0), 15)
  assert.ok(finalSources.get(STUDENT_CONTACT_READER_SIGNATURES[5]).sources.includes("20260928021444_registration_numbered_keys_narrow_summary.sql"))
  assert.match(finalSources.get(STUDENT_CONTACT_READER_SIGNATURES[4]).body, /^#variable_conflict use_column\nbegin\n  return query/u)
  assert.match(finalSources.get(STUDENT_CONTACT_READER_SIGNATURES[4]).body, /active_track\.task_id = common\.id/u)
  assert.match(finalSources.get(STUDENT_CONTACT_READER_SIGNATURES[2]).body, /textbook/u)
  assert.deepEqual(finalSources.get(STUDENT_CONTACT_READER_SIGNATURES[7]).sources, [
    "20260818083818_optimize_registration_task_stats.sql",
    "20260928010618_registration_stats_narrow_summary.sql",
  ])
})

test("source patch rejects missing/repeated anchors and already-patched replay", () => {
  for (const row of candidates.values()) {
    assert.throws(() => replaceReaderSourceOnce(row.original, row.old[0] + "drift", "", "drift"), /exact unique anchor/u)
    assert.throws(() => replaceReaderSourceOnce(row.original + row.old[0], row.old[0], "", "duplicate"), /exact unique anchor/u)
    assert.throws(() => replaceReaderSourceOnce(row.body, row.old[0], row.changed[0], "replay"), /exact unique anchor/u)
    let reverted = row.body
    for (let index = row.changed.length - 1; index >= 0; index--) {
      // Removed search anchors have empty replacements; verify full forward
      // reconstruction above rather than pretending deletion is invertible.
      if (!row.changed[index]) { reverted = null; break }
      reverted = replaceReaderSourceOnce(reverted, row.changed[index], row.old[index], "unchanged business bytes")
    }
    if (reverted !== null) assert.equal(reverted, row.original)
  }
})

test("installer source preserves existing function metadata and never changes privileges/data", () => {
  for (const field of ["proowner", "proacl", "proconfig", "prosecdef", "provolatile", "proparallel", "proisstrict", "proleakproof", "prolang", "procost", "prorows", "prosupport", "proretset", "prorettype"]) {
    assert.ok(draft.includes(`new_row.${field} is distinct from old_row.${field}`), field)
  }
  assert.match(draft, /old_row\.prosecdef is distinct from false/u)
  assert.match(draft, /old_row\.provolatile is distinct from 's'/u)
  assert.match(draft, /search_path=""/u)
  assert.match(draft, /student_contact_reader_preimage_drift' using errcode = '55000'/u)
  assert.match(draft, /student_contact_reader_projection_drift' using errcode = '55000'/u)
  assert.match(draft, /execute pg_catalog\.replace\(definition,old_row\.prosrc,candidate_body\)/u)
  assert.match(draft, /old_row\.prolang is distinct from \(select oid from pg_catalog\.pg_language where lanname='sql'\)/u)
  assert.match(draft, /old_row\.proargnames is distinct from array\['p_filters'\]::text\[\]/u)
  assert.match(draft, /old_row\.prorettype is distinct from 'pg_catalog\.jsonb'::pg_catalog\.regtype/u)
  assert.match(draft, /'TimeZone=Asia\/Seoul' = any\(old_row\.proconfig\)/u)
  assert.match(draft, /not pg_catalog\.has_function_privilege\('authenticated',target,'EXECUTE'\)/u)
  for (const role of ["anon", "public"]) assert.ok(draft.includes(`pg_catalog.has_function_privilege('${role}',target,'EXECUTE')`))
  assert.doesNotMatch(draft, /\b(?:grant|revoke|create\s+(?:or\s+replace\s+)?function|alter\s+table|delete\s+from|update\s+public\.)\b/iu)
})

// A deliberately small expression interpreter reads the actual SQL JSON
// producer arguments, including its old form. It models only named fields,
// never joins/filter/auth or SQL execution. Unknown selected expressions fail.
function splitExpressions(source) {
  let quoted = false, depth = 0, start = 0, output = []
  for (let at = 0; at < source.length; at++) {
    if (source[at] === "'") {
      if (quoted && source[at + 1] === "'") { at++; continue }
      quoted = !quoted
    } else if (!quoted) {
      if (source[at] === "(") depth++
      if (source[at] === ")") depth--
      if (source[at] === "," && depth === 0) { output.push(source.slice(start, at).trim()); start = at + 1 }
    }
  }
  output.push(source.slice(start).trim()); return output
}
function jsonObject(source, marker) {
  const markerAt = source.indexOf(marker)
  assert.notEqual(markerAt, -1, `actual producer ${marker}`)
  const start = source.lastIndexOf("pg_catalog.jsonb_build_object(", markerAt)
  assert.notEqual(start, -1)
  const argsAt = start + "pg_catalog.jsonb_build_object(".length
  let quoted = false, depth = 1, end = argsAt
  for (; end < source.length; end++) {
    if (source[end] === "'") {
      if (quoted && source[end + 1] === "'") { end++; continue }
      quoted = !quoted
    } else if (!quoted) {
      if (source[end] === "(") depth++
      if (source[end] === ")" && --depth === 0) break
    }
  }
  assert.ok(end < source.length)
  const args = splitExpressions(source.slice(argsAt, end))
  assert.equal(args.length % 2, 0)
  return new Map(Array.from({ length: args.length / 2 }, (_, i) => [readerSqlLiteral(args[i * 2]).value, args[i * 2 + 1]]))
}
function evaluate(expression, environment) {
  if (/^null$/iu.test(expression)) return null
  if (expression.startsWith("'")) return readerSqlLiteral(expression).value
  if (/^coalesce\(/iu.test(expression)) return splitExpressions(expression.slice("coalesce(".length, -1)).map((item) => evaluate(item, environment)).find((item) => item != null) ?? null
  const json = /^(\w+(?:\.\w+)?)\s*->>?\s*'([^']+)'$/u.exec(expression)
  if (json) return lookup(json[1], environment)?.[json[2]] ?? null
  if (/^\w+(?:\.\w+)?$/u.test(expression)) return lookup(expression, environment) ?? null
  throw new Error(`unmodeled selected SQL expression: ${expression}`)
}
function lookup(path, environment) { return path.split(".").reduce((value, key) => value?.[key], environment) }
function project(source, marker, keys, environment) {
  const object = jsonObject(source, marker)
  return Object.fromEntries(keys.filter((key) => object.has(key)).map((key) => [key, evaluate(object.get(key), environment)]))
}
const UUID = "99490000-0000-4000-8000-000000000001"
const SCHOOL = "합성 학교", NAME = "합성 학생", PHONE = "010-0000-9911", PARENT = "010-0000-9922"
const record = { id: UUID, name: NAME, school: SCHOOL, grade: "중2", uid: "SYN-77", status: "재원", storedStatus: "재원", contact: PHONE, parent_contact: PARENT }
function noPhones(value) { assert.equal(JSON.stringify(value).includes(PHONE), false); assert.equal(JSON.stringify(value).includes(PARENT), false) }
const masterFields = ["kind", "id", "name", "school", "grade", "uid", "contact", "parentContact", "makeeduDetailId", "status", "storedStatus"]
for (const [index, marker, environment] of [
  [0, "'kind','students','id',record.id", { record }],
  [1, "'kind','students','id',filtered.id", { filtered: { id: UUID, raw: record } }],
  [2, "'id',p_id,'name',v_raw", { p_id: UUID, v_raw: record }],
  [3, "'id',student.id,'name',student.name", { student: record }],
]) {
  test(`actual master producer ${index + 1} is contact-free before the real consumer`, () => {
    const row = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[index])
    const oldPayload = project(row.original, marker, masterFields, environment)
    assert.equal(oldPayload.contact, PHONE)
    assert.equal(oldPayload.parentContact, PARENT)
    const payload = project(row.body, marker, masterFields, environment)
    noPhones(payload)
    assert.equal(payload.contact, null); assert.equal(payload.parentContact, null)
    assert.equal(payload.makeeduDetailId, null)
    assert.equal(payload.name, NAME); assert.equal(payload.school, SCHOOL); assert.equal(payload.grade, "중2")
    assert.equal(payload.uid, "SYN-77")
    const normalized = normalizeStudentManagementRecord(payload)
    noPhones(normalized)
    assert.equal(normalized.title, NAME)
    assert.equal(normalized.id, UUID)
    assert.equal(normalized.raw.uid, "SYN-77")
  })
}

const opsSource = readFileSync(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8")
const opsSyntax = ts.createSourceFile("ops-task-service.ts", opsSource, ts.ScriptTarget.Latest, true)
const declarations = opsSyntax.statements.filter((node) => ts.isFunctionDeclaration(node)).map((node) => node.getText(opsSyntax)).join("\n")
const runtime = { exports: {} }
vm.runInNewContext(ts.transpileModule(`${declarations}\nmodule.exports={mapOpsTaskPageRow,mapOpsTaskPageStatsResult};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { module: runtime, exports: runtime.exports, stripRegistrationTaskContact, REGISTRATION_PIPELINE_STATUSES })
for (const index of [4, 6]) {
  test(`actual ${index === 4 ? "cursor" : "numbered"} registration metadata producer no longer sends phones to its real DTO consumer`, () => {
    const row = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[index])
    const environment = { detail: { parent_phone: PARENT, student_phone: PHONE, pipeline_status: "0. 등록 문의", school_name: SCHOOL, school_grade: "중2", request_note: "합성 메모" } }
    const marker = "'pipelineStatus', coalesce(detail.pipeline_status"
    const fields = ["pipelineStatus", "parentPhone", "studentPhone", "schoolName", "schoolGrade", "requestNote"]
    const oldPayload = project(row.original, marker, fields, environment)
    assert.equal(oldPayload.parentPhone, PARENT); assert.equal(oldPayload.studentPhone, PHONE)
    const registration = project(row.body, marker, fields, environment)
    noPhones(registration)
    assert.equal(registration.parentPhone, null); assert.equal(registration.studentPhone, null)
    assert.equal(registration.schoolName, SCHOOL); assert.equal(registration.schoolGrade, "중2")
    const dto = runtime.exports.mapOpsTaskPageRow({ row_data: { id: UUID, type: "registration", status: "requested", studentName: NAME, registration } })
    noPhones(dto)
    assert.equal(dto.studentName, NAME); assert.equal(dto.registration.schoolName, SCHOOL)
  })
}

test("list search/sort loses phone access while current-open scoped contact read stays outside the patch", () => {
  const numbered = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[0]).body
  assert.doesNotMatch(numbered, /record\.(?:contact|parent_contact)/u)
  assert.match(numbered, /'uid', \$e\$nullif\(pg_catalog\.btrim\(record\.uid\)/u)
  for (const index of [4, 5, 6, 7]) assert.doesNotMatch(candidates.get(STUDENT_CONTACT_READER_SIGNATURES[index]).body, /detail\.(?:parent_phone|student_phone)/u)
  assert.equal([...candidates.keys()].some((name) => name.includes("get_registration_case_contact")), false)
  const lifecycle = readFileSync(new URL("../docs/security/sql/registration-contact-lifecycle-integration-draft.sql", import.meta.url), "utf8")
  assert.match(lifecycle, /get_registration_case_contact_v1/u)
  assert.match(lifecycle, /include_parent/u)
})

function callArguments(source, marker) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `actual SQL call ${marker}`)
  assert.equal(source.indexOf(marker, start + marker.length), -1, `unique SQL call ${marker}`)
  let at = start + marker.length, depth = 1, quoted = false
  const argsAt = at
  for (; at < source.length; at++) {
    if (source[at] === "'") {
      if (quoted && source[at + 1] === "'") { at++; continue }
      quoted = !quoted
    } else if (!quoted) {
      if (source[at] === "(") depth++
      if (source[at] === ")" && --depth === 0) return splitExpressions(source.slice(argsAt, at))
    }
  }
  assert.fail(`unterminated SQL call ${marker}`)
}

// This models only the actual scalar concat/search expression, not SQL joins,
// RLS, counts, query plans or execution. The isolated pgTAP checks those apart.
function statsSearchMatches(body, environment, search) {
  assert.ok(body.includes("'[[:space:]-]+'"))
  const [separator, ...fields] = callArguments(body, "pg_catalog.concat_ws(")
  assert.equal(readerSqlLiteral(separator).value, " ")
  const normalize = (value) => value.toLowerCase().replace(/[\s-]+/gu, "")
  const text = fields.map((field) => evaluate(field, environment)).filter((value) => value != null).join(" ")
  return normalize(text).includes(normalize(search.trim()))
}

test("count-only stats removes only known contact fields and preserves narrow membership and business count bytes", () => {
  const row = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[7])
  assert.equal(row.old.length, 2)
  assert.equal(row.body, row.original
    .replace("      detail.parent_phone,\n      detail.student_phone,\n", "")
    .replace("        base.parent_phone,\n        base.student_phone,\n", ""))
  assert.doesNotMatch(row.body, /(?:detail|base)\.(?:parent_phone|student_phone)/u)
  assert.match(row.body, /where track\.archived_at is null/u)
  assert.match(row.body, /order by consultation\.created_at desc, consultation\.id desc\s+limit 1/u)
  assert.match(row.body, /pg_catalog\.jsonb_array_length\(p_filters -> 'statuses'\)/u)
  assert.match(row.body, /memberships\.director_profile_id::text = p_filters ->> 'consultationOwnerId'/u)
  const outputMarker = "  select pg_catalog.jsonb_build_object(\n    'total'"
  assert.notEqual(row.original.indexOf(outputMarker), -1)
  assert.equal(row.body.slice(row.body.indexOf(outputMarker)), row.original.slice(row.original.indexOf(outputMarker)))
})

test("actual stats search expression loses both contact aliases and keeps name school subject and visit search", () => {
  const row = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[7])
  const environment = {
    base: { student_name: NAME, title: "등록 합성", parent_phone: PARENT, student_phone: PHONE,
      school_grade: "중2", school_name: SCHOOL, request_note: "합성 메모" },
    summary: { subject: "영어", visit_place: "합성 상담 장소" }, director: { name: "합성 담당자" },
  }
  for (const phone of [PHONE, PARENT]) {
    assert.equal(statsSearchMatches(row.original, environment, phone), true)
    assert.equal(statsSearchMatches(row.body, environment, phone), false)
  }
  for (const search of [NAME, SCHOOL, "중2", "영어", "합성 상담 장소", "합성 담당자"]) {
    assert.equal(statsSearchMatches(row.original, environment, search), true)
    assert.equal(statsSearchMatches(row.body, environment, search), true)
  }
  const views = ["inquiry", "level_test", "consultation_requested", "consultation_completed", "waiting", "observation", "enrollment", "payment", "completed"]
  for (const search of [PHONE, NAME]) {
    const total = Number(statsSearchMatches(row.body, environment, search))
    const wire = { total, byStatus: total ? { requested: total } : {},
      byView: Object.fromEntries(views.map((view) => [view, view === "inquiry" ? total : 0])),
      metrics: { consultationMine: 0, consultationAll: 0 }, facets: {} }
    const normalized = runtime.exports.mapOpsTaskPageStatsResult({ data: wire })
    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), wire)
    noPhones(normalized)
  }
})

test("stats free-text phone content remains a documented separate boundary", () => {
  const row = candidates.get(STUDENT_CONTACT_READER_SIGNATURES[7])
  assert.equal(statsSearchMatches(row.body, { base: { request_note: PHONE }, summary: {}, director: {} }, PHONE), true)
  assert.match(draft, /Unstructured notes, historical payloads/u)
})

test("arbitrary notes remain a separate boundary instead of being falsely certified contact-free", () => {
  const payload = project(candidates.get(STUDENT_CONTACT_READER_SIGNATURES[4]).body,
    "'pipelineStatus', coalesce(detail.pipeline_status", ["requestNote"], { detail: { request_note: PHONE } })
  assert.equal(payload.requestNote, PHONE)
  assert.match(draft, /Unstructured notes, historical payloads/u)
})
