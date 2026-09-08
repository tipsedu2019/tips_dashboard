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

  // Read the active SQL statements; the final writer no longer carries the
  // repair migration's comment markers.
  const locks = [...definition.matchAll(/perform\s+1\s+from\s+public\.(\w+)\b[\s\S]*?for\s+update(?:\s+of\s+attempt)?;/gi)]
  assert.deepEqual(locks.map((match) => match[1]), [
    "ops_tasks", "ops_registration_details", "ops_registration_subject_tracks",
    "ops_registration_appointments", "ops_registration_level_tests",
  ])
  const receipt = definition.indexOf("from dashboard_private.ops_registration_mutations mutation")

  assert.ok(
    receipt > locks.at(-1).index,
    "result persistence must lock task, detail, tracks, appointments, and attempts before replay/mutation",
  )
  assert.doesNotMatch(definition, /for\s+update\s+of\s+attempt\s*,\s*track/i)
})
