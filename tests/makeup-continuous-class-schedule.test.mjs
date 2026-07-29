import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260729013858_continuous_class_schedule_release2_consumers.sql",
  import.meta.url,
)

test("normalized makeup effects retain the original session identity and reject a stale reversal", async () => {
  const migration = await readFile(migrationUrl, "utf8")

  assert.match(migration, /original_lesson_session_id uuid[\s\S]*references public\.class_lesson_sessions\(id\)/)
  assert.match(migration, /makeup_effect_revision bigint/)
  assert.match(migration, /apply_normalized_makeup_effect_v1/)
  assert.match(migration, /revert_normalized_makeup_effect_v1/)
  assert.match(migration, /makeup_lesson_session_stale/)
  assert.match(migration, /schedule_storage_mode = 'normalized'/)
  assert.match(migration, /notification_apply_makeup_calendar_effects_legacy_v1/)
})
