import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("scheduled registration appointments cannot persist with stale activities or track status", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260819103434_registration_appointment_integrity_guard.sql", import.meta.url),
    "utf8",
  )

  assert.match(migration, /reconcile_registration_appointment_parent_v1/i)
  assert.match(migration, /cancel_registration_appointment_reminders_v1/i)
  assert.match(migration, /registration_invalid_source_state/i)
  assert.match(migration, /track\.id = attempt\.track_id/i)
  assert.match(migration, /track\.id = consultation\.track_id/i)
  assert.match(migration, /level_test_in_progress/i)
  assert.match(migration, /visit_consultation_scheduled/i)
  assert.match(migration, /constraint trigger[\s\S]*?deferrable initially deferred/i)
  assert.match(migration, /ops_registration_appointments/i)
  assert.match(migration, /ops_registration_level_tests/i)
  assert.match(migration, /ops_registration_consultations/i)
  assert.match(migration, /ops_registration_subject_tracks/i)
  assert.match(migration, /save_registration_consultation_result_v2/i)
})
