import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260901110200_registration_status_property_decoupling.sql",
  import.meta.url,
)

function functionBlock(source, signature) {
  const start = source.indexOf(`create or replace function ${signature}`)
  assert.notEqual(start, -1, `missing ${signature}`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${signature}`)
  return source.slice(start, end + 4)
}

test("registration writers are exactly active admin and staff accounts", async () => {
  const source = await readFile(migrationUrl, "utf8")
  const mutationAccess = functionBlock(
    source,
    "dashboard_private.assert_registration_mutation_access(",
  )
  const workflowAccess = functionBlock(
    source,
    "dashboard_private.assert_registration_workflow_status_access(",
  )
  const observationAccess = functionBlock(
    source,
    "dashboard_private.assert_registration_observation_manager_access_v1(",
  )

  for (const block of [mutationAccess, workflowAccess, observationAccess]) {
    assert.match(block, /actor\.role in \('admin', 'staff'\)/u)
    assert.match(block, /account\.deleted_at is null/u)
    assert.match(block, /account\.banned_until is null/u)
    assert.doesNotMatch(block, /director_profile_id\s*=\s*actor\.id/u)
    assert.doesNotMatch(block, /actor\.role\s*=\s*'teacher'/u)
  }

  assert.match(
    source,
    /create policy ops_tasks_update_v2[\s\S]*?type = 'registration'[\s\S]*?registration_observation_current_actor_is_active_manager_v1\(\)/u,
  )
  assert.match(
    source,
    /create policy ops_tasks_delete_v2[\s\S]*?type = 'registration'[\s\S]*?registration_observation_current_actor_is_active_manager_v1\(\)/u,
  )
})

test("manual status save changes only the status property and audit history", async () => {
  const source = await readFile(migrationUrl, "utf8")
  const statusSave = functionBlock(
    source,
    "dashboard_private.set_registration_workflow_status_v1_impl(",
  )

  assert.match(statusSave, /registration_workflow_status_changed/u)
  assert.match(statusSave, /registration_workflow_status_refresh_required[\s\S]*?errcode = '23514'/u)
  assert.match(statusSave, /ops_registration_mutations/u)
  assert.match(
    statusSave,
    /if v_receipt_found then[\s\S]*?'enrollmentFinalization',[\s\S]*?null[\s\S]*?update dashboard_private\.ops_registration_mutations/u,
  )
  assert.doesNotMatch(statusSave, /finalize_registration_track_enrollments_v1/u)
  assert.doesNotMatch(statusSave, /registration_observation_transition_requires_action/u)
  assert.doesNotMatch(statusSave, /registration_detail_required/u)
  assert.doesNotMatch(statusSave, /errcode = '40001'/u)
})

test("legacy observation workflow stages collapse back to the prior manual status", async () => {
  const source = await readFile(migrationUrl, "utf8")
  assert.match(
    source,
    /where track\.workflow_status in \(\s*'observation_requested',\s*'observation_feedback_pending',\s*'observation_completed'\s*\)/u,
  )
  assert.match(source, /observation_return_workflow_status/u)
  assert.match(source, /registration_workflow_status_decoupled/u)
})
