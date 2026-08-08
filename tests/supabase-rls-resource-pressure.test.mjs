import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const consolidationUrl = new URL(
  "../supabase/migrations/20260808172743_rls_policy_initplan_consolidation.sql",
  import.meta.url,
)
const registrationReadUrl = new URL(
  "../supabase/migrations/20260808172835_ops_registration_read_policy_optimization.sql",
  import.meta.url,
)

function normalized(value) {
  return value.toLowerCase().replace(/\s+/gu, " ")
}

function policyBody(sql, name) {
  const start = sql.indexOf(`create policy ${name}`)
  assert.ok(start >= 0, `${name} must exist`)
  const end = sql.indexOf(";", start)
  assert.ok(end > start, `${name} must terminate`)
  return sql.slice(start, end)
}

test("classes and textbooks keep one read policy and command-specific role writes", async () => {
  const sql = normalized(await readFile(consolidationUrl, "utf8"))

  for (const oldPolicy of [
    "classes_authenticated_select",
    "classes_dashboard_select",
    "classes_dashboard_write",
    "classes_staff_write",
    "textbooks_authenticated_select",
    "textbooks_staff_write",
    "textbooks_teacher_write",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists ${oldPolicy}`))
  }

  assert.match(policyBody(sql, "classes_authenticated_select_v2"), /for select to authenticated using \(true\)/)
  assert.match(policyBody(sql, "textbooks_authenticated_select_v2"), /for select to authenticated using \(true\)/)

  for (const table of ["classes", "textbooks"]) {
    for (const command of ["insert", "update", "delete"]) {
      const body = policyBody(sql, `${table}_dashboard_${command}_v2`)
      assert.match(body, new RegExp(`for ${command}`))
      assert.match(body, /\(select public\.current_dashboard_role\(\)\) in \('admin', 'staff', 'teacher'\)/)
    }
  }

  assert.doesNotMatch(sql, /create policy [^;]+ for all/)
})

test("profiles preserve self and staff unions in one policy per command", async () => {
  const sql = normalized(await readFile(consolidationUrl, "utf8"))

  for (const oldPolicy of [
    "profiles_staff_write",
    "profiles_delete_staff",
    "profiles_insert_staff",
    "profiles_self_insert",
    "profiles_select_self_or_staff",
    "profiles_self_identity_select",
    "profiles_self_select",
    "profiles_staff_select",
    "users can read their own profile",
    "profiles_update_self_or_staff",
    "users can update their own profile",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists "?${oldPolicy.replaceAll(" ", "\\s+")}"?`))
  }

  const select = policyBody(sql, "profiles_select_v2")
  assert.match(select, /id = \(select auth\.uid\(\)\)/)
  assert.match(select, /\(select auth\.jwt\(\)\) ->> 'email'/)
  assert.match(select, /\(select public\.current_dashboard_role\(\)\) in \('admin', 'staff'\)/)

  const insert = policyBody(sql, "profiles_insert_v2")
  assert.match(insert, /role = 'viewer'/)
  assert.match(insert, /id = \(select auth\.uid\(\)\)/)
  assert.match(insert, /\(select public\.current_dashboard_role\(\)\) in \('admin', 'staff'\)/)

  const update = policyBody(sql, "profiles_update_v2")
  assert.match(update, /using \([^;]+with check \(/)
  assert.match(update, /id = \(select auth\.uid\(\)\)/)
  assert.match(update, /\(select public\.current_dashboard_role\(\)\) in \('admin', 'staff'\)/)

  const remove = policyBody(sql, "profiles_delete_v2")
  assert.match(remove, /for delete/)
  assert.match(remove, /\(select public\.current_dashboard_role\(\)\) in \('admin', 'staff'\)/)
})

test("ops_tasks preserves business predicates while caching zero-argument auth helpers", async () => {
  const sql = normalized(await readFile(consolidationUrl, "utf8"))

  for (const command of ["select", "insert", "update", "delete"]) {
    const body = policyBody(sql, `ops_tasks_${command}_v2`)
    assert.doesNotMatch(body, /(?<!select )auth\.uid\(\)/)
    assert.doesNotMatch(body, /(?<!select )public\.current_dashboard_role\(\)/)
  }

  const select = policyBody(sql, "ops_tasks_select_v2")
  assert.match(select, /requested_by = \(select auth\.uid\(\)\)/)
  assert.match(select, /assignee_id = \(select auth\.uid\(\)\)/)
  assert.match(select, /secondary_assignee_id = \(select auth\.uid\(\)\)/)
  assert.match(select, /dashboard_private\.is_ops_word_retest_teacher\(id\)/)

  const update = policyBody(sql, "ops_tasks_update_v2")
  const remove = policyBody(sql, "ops_tasks_delete_v2")
  assert.match(update, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
  assert.match(remove, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
})

test("registration read helpers bypass nested RLS with authenticated-only execution", async () => {
  const sql = normalized(await readFile(registrationReadUrl, "utf8"))

  for (const signature of [
    "dashboard_private.can_read_ops_task_v1",
    "dashboard_private.can_read_registration_track_v1",
  ]) {
    const start = sql.indexOf(`create or replace function ${signature}`)
    assert.ok(start >= 0, `${signature} must exist`)
    const end = sql.indexOf("alter function", start)
    const body = sql.slice(start, end)
    assert.match(body, /stable security definer set search_path = ''/)
    assert.match(body, /where [^;]+\.id = p_/)
    assert.match(sql, new RegExp(`revoke all on function ${signature.replaceAll(".", "\\.")}\\(uuid\\) from public, anon, authenticated, service_role`))
    assert.match(sql, new RegExp(`grant execute on function ${signature.replaceAll(".", "\\.")}\\(uuid\\) to authenticated`))
  }

  const taskHelperStart = sql.indexOf("create or replace function dashboard_private.can_read_ops_task_v1")
  const taskHelperEnd = sql.indexOf("alter function", taskHelperStart)
  const taskHelper = sql.slice(taskHelperStart, taskHelperEnd)
  assert.match(taskHelper, /requested_by = v_actor/)
  assert.match(taskHelper, /assignee_id = v_actor/)
  assert.match(taskHelper, /secondary_assignee_id = v_actor/)
  assert.match(taskHelper, /is_ops_word_retest_teacher\(task\.id\)/)
})

test("registration child SELECT policies delegate exact task visibility without ops_tasks subqueries", async () => {
  const sql = normalized(await readFile(registrationReadUrl, "utf8"))
  const taskPolicies = [
    ["ops_task_events_select_v2", "task_id"],
    ["ops_registration_subject_tracks_select_v2", "task_id"],
    ["ops_registration_appointments_select_v2", "task_id"],
    ["ops_registration_admission_batches_select_v2", "task_id"],
    ["ops_registration_details_select_v2", "task_id"],
  ]
  const trackPolicies = [
    ["ops_registration_level_tests_select_v2", "track_id"],
    ["ops_registration_consultations_select_v2", "track_id"],
    ["ops_registration_enrollments_select_v2", "track_id"],
  ]

  for (const [name, column] of taskPolicies) {
    const body = policyBody(sql, name)
    assert.match(body, new RegExp(`can_read_ops_task_v1\\(${column}\\)`))
    assert.doesNotMatch(body, /exists|from public\.ops_tasks/)
  }
  for (const [name, column] of trackPolicies) {
    const body = policyBody(sql, name)
    assert.match(body, new RegExp(`can_read_registration_track_v1\\(${column}\\)`))
    assert.doesNotMatch(body, /exists|from public\.ops_tasks/)
  }
})
