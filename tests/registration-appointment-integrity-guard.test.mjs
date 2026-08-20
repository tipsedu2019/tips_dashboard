import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)

async function latestFunctionDefinition(qualifiedName) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()

  const marker = `create or replace function ${qualifiedName}`
  let latest = null
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsDirectory), "utf8")
    const start = sql.toLowerCase().lastIndexOf(marker.toLowerCase())
    if (start < 0) continue
    const end = sql.indexOf("\n$$;", start)
    assert.notEqual(end, -1, `${file} must terminate ${qualifiedName} with $$;`)
    latest = { file, definition: sql.slice(start, end + 4) }
  }

  assert.ok(latest, `missing migration definition for ${qualifiedName}`)
  return latest
}

test("appointment integrity remains independent from the manual pipeline workflow", async () => {
  const { definition } = await latestFunctionDefinition(
    "dashboard_private.assert_registration_appointment_integrity_v1",
  )

  assert.match(definition, /v_appointment\.status[\s\S]*?attempt\.status/i)
  assert.match(definition, /v_appointment\.status[\s\S]*?consultation\.status/i)
  assert.doesNotMatch(definition, /ops_registration_subject_tracks/i)
  assert.doesNotMatch(definition, /track\.pipeline_status/i)
})

test("level-test result persistence follows the canonical registration row-lock order", async () => {
  const { definition } = await latestFunctionDefinition(
    "dashboard_private.save_registration_level_test_result_impl",
  )

  const task = definition.indexOf("-- level_test_result_task_lock")
  const detail = definition.indexOf("-- level_test_result_detail_lock")
  const tracks = definition.indexOf("-- level_test_result_track_locks")
  const appointments = definition.indexOf("-- level_test_result_appointment_locks")
  const attempts = definition.indexOf("-- level_test_result_attempt_locks")
  const receipt = definition.indexOf("-- level_test_result_receipt_lookup")

  assert.ok(
    task !== -1
      && task < detail
      && detail < tracks
      && tracks < appointments
      && appointments < attempts
      && attempts < receipt,
    "result persistence must lock task, detail, tracks, appointments, and attempts before replay/mutation",
  )
  assert.doesNotMatch(definition, /for\s+update\s+of\s+attempt\s*,\s*track/i)
})
