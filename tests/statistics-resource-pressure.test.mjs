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

test("statistics pgTAP uses executable fixtures and cursor, RLS, parity, and payload assertions", async () => {
  const tap = normalizeSql(await readFile(pgTapPath, "utf8"))

  assert.match(tap, /insert into public\.students/iu)
  assert.match(tap, /generate_series\(1,\s*31\)/iu)
  assert.match(tap, /create policy dashboard_statistics_fixture_/iu)
  assert.match(tap, /set local role authenticated/iu)
  assert.match(tap, /jsonb_array_length\([^;]*->\s*'rows'[^;]*\),\s*30,\s*'31 rows read and 30 returned'/iu)
  assert.match(tap, /->>\s*'hasMore'[^;]*true/iu)
  assert.match(tap, /nextCursor/iu)
  assert.match(tap, /pg_get_functiondef/iu)
  assert.match(tap, /same-day-subject/iu)
  assert.match(tap, /day-before-other-subject/iu)
  assert.match(tap, /affectedStudentIds/iu)
  assert.match(tap, /octet_length\([^;]*::text[^;]*204800/iu)
  assert.doesNotMatch(tap, /ok\(\s*true\s*,\s*'(?:RLS-hidden statistics rows|31 rows read and 30 returned|400-day academy-wide conflict parity)'/iu)
})

test("statistics source preserves exam-rule parity and merges students by stable conflict key", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))
  const aggregate = functionBlock(
    sql,
    "public.get_dashboard_statistics_sources_v1",
    "public.list_dashboard_statistics_student_roster_v1",
  )

  assert.match(aggregate, /'same-day-subject'/iu)
  assert.match(aggregate, /'day-before-other-subject'/iu)
  assert.match(aggregate, /modern_exam_sources\s+as\s+materialized/iu)
  assert.match(aggregate, /fallback_exam_sources\s+as\s+materialized/iu)
  assert.match(aggregate, /(?:from|join) public\.academic_event_exam_details detail/iu)
  assert.match(aggregate, /from public\.academic_events event/iu)
  assert.match(aggregate, /from public\.academic_exam_days exam_day/iu)
  assert.match(aggregate, /session\.session_date\s*=\s*source\.exam_date\s*-\s*1/iu)
  assert.match(aggregate, /not exists \([^;]*modern_exam_sources[^;]*exam_date/iu)
  assert.match(aggregate, /not exists \([^;]*student_exam_sources same_subject_source/iu)
  assert.match(aggregate, /group by[^;]*conflict_key/iu)
  assert.match(aggregate, /dashboard_statistics_unique_text_jsonb_v1/iu)
})

test("statistics source normalizes legacy textbook statuses and expands multi-day schedules", async () => {
  const sql = normalizeSql(await readFile(migrationPath, "utf8"))

  assert.match(sql, /dashboard_statistics_textbook_active_v1/iu)
  assert.match(sql, /when '사용중' then true/iu)
  assert.match(sql, /when '미사용' then false/iu)
  assert.match(sql, /dashboard_statistics_schedule_day_count_v1/iu)
  assert.match(sql, /dashboard_statistics_schedule_day_count_v1\(slot_match\[1\]\)/iu)
})

test("statistics enrollment counts deduplicate the class fixture across aggregate and drilldowns", async () => {
  const [migration, pgTap] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(pgTapPath, "utf8"),
  ])
  const sql = normalizeSql(migration)
  const tap = normalizeSql(pgTap)

  assert.match(sql, /dashboard_statistics_distinct_jsonb_count_v1/iu)
  assert.doesNotMatch(sql, /jsonb_array_length\(class\.(?:student_ids|waitlist_ids)\)/iu)
  assert.match(sql, /select distinct[^;]*student_id/iu)
  assert.match(tap, /registered duplicate id is present in class 301 source/iu)
  assert.match(tap, /registered aggregate count deduplicates class 301 source/iu)
  assert.match(tap, /class group count matches deduplicated class 301 source/iu)
  assert.match(tap, /class roster drilldown deduplicates class 301 source/iu)
})

test("statistics class grade grouping and drilldown share direct-or-name-plus-student inference", async () => {
  const [migration, pgTap] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(pgTapPath, "utf8"),
  ])
  const sql = normalizeSql(migration)
  const tap = normalizeSql(pgTap)
  const helper = functionBlock(
    sql,
    "dashboard_private.dashboard_statistics_inferred_grade_labels_v1",
    "dashboard_private.get_dashboard_statistics_students_classes_v1",
  )

  assert.match(sql, /dashboard_statistics_inferred_grade_labels_v1/iu)
  assert.match(helper, /if pg_catalog\.cardinality\(direct_labels\) > 0 then return direct_labels/iu)
  assert.match(helper, /name_labels\s*\|\|\s*student_labels/iu)

  const classGroup = functionBlock(
    sql,
    "public.list_dashboard_statistics_class_group_v1",
    "public.list_dashboard_statistics_class_roster_v1",
  )
  assert.match(classGroup, /p_key\s*=\s*any\s*\(class\.grade_labels\)/iu)
  assert.match(tap, /name and enrolled grades are combined when direct grade is absent/iu)
  assert.match(tap, /inferred grade aggregate and drilldown stay in parity/iu)
})
