import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL(
  "../supabase/migrations/20260813194812_dashboard_statistics_sources.sql",
  import.meta.url,
)
const manifestPath = new URL(
  "../supabase/test-baselines/dashboard-free-tier-v1.manifest.json",
  import.meta.url,
)
const pgTapPath = new URL(
  "../supabase/tests/dashboard_statistics_sources_test.sql",
  import.meta.url,
)

const normalizeSql = (value) => value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim()
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

function functionBlock(sql, functionName, nextFunctionName = "") {
  const start = sql.indexOf(`create or replace function ${functionName}`)
  assert.notEqual(start, -1, `${functionName} must exist`)
  const end = nextFunctionName
    ? sql.indexOf(`create or replace function ${nextFunctionName}`, start)
    : sql.length
  return sql.slice(start, end === -1 ? sql.length : end)
}

test("statistics source migration is the CLI-created manifest-owned artifact", async () => {
  const [migration, manifestSource] = await Promise.all([
    readFile(migrationPath),
    readFile(manifestPath, "utf8"),
  ])
  const manifest = JSON.parse(manifestSource)
  const entries = manifest.orderedNewMigrations.filter(
    (entry) => entry.fileName === "20260813194812_dashboard_statistics_sources.sql",
  )

  assert.equal(entries.length, 1)
  assert.ok(["candidate", "final"].includes(entries[0].status))
  assert.equal(entries[0].sha256, sha256(migration))
})

test("statistics source RPC validates the four discriminated tab contracts", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))
  const aggregate = functionBlock(
    sql,
    "public.get_dashboard_statistics_sources_v1",
    "public.list_dashboard_statistics_student_roster_v1",
  )

  assert.match(
    aggregate,
    /\( p_tab text, p_subject text default null, p_division text default null, p_date_from date default null, p_date_to date default null \) returns jsonb language plpgsql stable security invoker set search_path = ''/iu,
  )
  assert.match(aggregate, /p_tab not in \('overview', 'students_classes', 'schedule_conflicts', 'textbooks'\)/iu)
  assert.match(aggregate, /p_tab in \('overview', 'students_classes'\)/iu)
  assert.match(aggregate, /p_tab = 'schedule_conflicts'/iu)
  assert.match(aggregate, /array\['all', 'english', 'math', 'science'\]/iu)
  assert.match(aggregate, /array\['all', 'middle', 'high'\]/iu)
  assert.match(aggregate, /array\[90, 180, 400\]/iu)
  assert.match(aggregate, /array\[30, 90, 180, 365\]/iu)
  assert.match(aggregate, /dashboard_statistics_request_invalid/iu)
  assert.match(aggregate, /dashboard_statistics_date_range_invalid/iu)
  assert.doesNotMatch(aggregate, /list_dashboard_statistics_(?:student_roster|class_group|class_roster)_v1/iu)
})

test("statistics aggregate returns only tab data and excludes heavyweight source rows", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))
  const aggregateStart = sql.indexOf(
    "create or replace function dashboard_private.get_dashboard_statistics_students_classes_v1",
  )
  const aggregateEnd = sql.indexOf(
    "create or replace function public.list_dashboard_statistics_student_roster_v1",
  )
  assert.notEqual(aggregateStart, -1)
  assert.notEqual(aggregateEnd, -1)
  const aggregate = sql.slice(aggregateStart, aggregateEnd)

  for (const key of [
    "summary", "activeClassesCount", "registeredEnrollmentCount",
    "waitlistEnrollmentCount", "uniqueRegisteredStudentCount",
    "uniqueWaitlistStudentCount", "schoolCount", "gradeCount",
    "weeklyMinutes", "weeklyHoursLabel", "studentBreakdowns", "byGrade",
    "bySchool", "classGroups", "byTeacher", "byClassroom", "range",
    "teacherConflicts", "classroomConflicts", "examConflicts", "activeTitles",
    "activeClassesWithTextbook", "activeClassesWithoutTextbook",
    "progressSessions", "updatedProgressSessions",
    "occurrenceKind", "nextOccurrenceAt", "recurrenceDay", "problem",
    "ownerLabel", "resolution", "classIds", "classNames",
    "affectedStudentIds", "primaryAssigneeProfileId",
    "secondaryAssigneeProfileId", "assigneeTeam", "source",
    "studentIds", "examEventIds", "examDetailIds", "teacherCatalogIds",
    "classroomCatalogIds", "overlapStart", "overlapEnd", "examDate", "examRule",
  ]) {
    assert.match(aggregate, new RegExp(`'${key}'`, "iu"))
  }
  assert.doesNotMatch(aggregate, /\bselect\s+\*/iu)
  assert.doesNotMatch(aggregate, /(?:to_jsonb|row_to_json)\s*\(\s*(?:class|student|progress|message|audit)\s*\)/iu)
  assert.doesNotMatch(aggregate, /'studentRoster'|'classSummaries'|'students'|'classes'/iu)
  assert.doesNotMatch(aggregate, /\b(?:message_body|message_content|audit_payload|teacher_note|public_note|contact|parent_contact)\b/iu)
  assert.doesNotMatch(aggregate, /(?:to_jsonb|row_to_json)\s*\(\s*class\.schedule_plan\s*\)/iu)
})

test("statistics source owns the deterministic Korean numeric collation and fails closed on drift", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))

  assert.match(
    sql,
    /create collation if not exists dashboard_private\.ko_numeric \( provider = icu, locale = 'ko-u-kn-true', deterministic = true \)/iu,
  )
  assert.match(sql, /collprovider/iu)
  assert.match(sql, /collisdeterministic/iu)
  assert.match(sql, /ko-u-kn-true/iu)
  assert.match(sql, /dashboard_ko_numeric_collation_invalid/iu)
})

test("statistics drilldowns are bounded keyset pages with one shared normalized-name expression", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))
  const studentRoster = functionBlock(
    sql,
    "public.list_dashboard_statistics_student_roster_v1",
    "public.list_dashboard_statistics_class_group_v1",
  )
  const classGroup = functionBlock(
    sql,
    "public.list_dashboard_statistics_class_group_v1",
    "public.list_dashboard_statistics_class_roster_v1",
  )
  const classRoster = functionBlock(
    sql,
    "public.list_dashboard_statistics_class_roster_v1",
  )

  for (const block of [studentRoster, classGroup, classRoster]) {
    assert.match(block, /stable security invoker set search_path = ''/iu)
    assert.match(block, /p_limit <> 30/iu)
    assert.match(block, /limit 31/iu)
    assert.match(block, /dashboard_private\.dashboard_statistics_normalized_name_v1/iu)
    assert.match(block, /'nextCursor'/iu)
    assert.match(block, /'hasMore'/iu)
  }
  assert.match(studentRoster, /array\['grade', 'school', 'grade_school', 'school_grade'\]/iu)
  assert.match(classGroup, /array\['grade', 'teacher', 'classroom'\]/iu)
  assert.doesNotMatch(classGroup, /'studentRoster'|'rows'\s*,\s*class[^)]*student/iu)
  assert.match(
    sql,
    /pg_catalog\.regexp_replace\(pg_catalog\.btrim\(p_value\), '\\s\+', ' ', 'g'\)/iu,
  )
  assert.match(sql, /collate dashboard_private\.ko_numeric/iu)
})

test("statistics RPC ACL, RLS fixtures, parity oracle, and payload budget are explicit", async () => {
  const [migration, pgTap] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(pgTapPath, "utf8"),
  ])
  const sql = normalizeSql(migration)
  const tap = normalizeSql(pgTap)
  const functionSignatures = [
    "public.get_dashboard_statistics_sources_v1(text, text, text, date, date)",
    "public.list_dashboard_statistics_student_roster_v1(text, text, text, text, text, text, uuid, integer)",
    "public.list_dashboard_statistics_class_group_v1(text, text, text, text, text, uuid, integer)",
    "public.list_dashboard_statistics_class_roster_v1(uuid, text, uuid, integer)",
  ]

  for (const signature of functionSignatures) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    assert.match(sql, new RegExp(`revoke all on function ${escaped} from public, anon`, "iu"))
    assert.match(sql, new RegExp(`grant execute on function ${escaped} to authenticated`, "iu"))
  }
  assert.doesNotMatch(sql, /security definer/iu)
  assert.match(tap, /begin;/iu)
  assert.match(tap, /rollback;/iu)
  for (const contract of [
    "400-day academy-wide conflict parity",
    "aggregate does not execute drilldown RPCs",
    "RLS-hidden statistics rows",
    "31 rows read and 30 returned",
    "normalized-name cursor parity",
    "payload stays under 200 KiB",
  ]) {
    assert.match(tap, new RegExp(contract, "iu"))
  }
  assert.match(tap, /204800/iu)
})
