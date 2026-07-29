import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260729013858_continuous_class_schedule_release2_consumers.sql", import.meta.url),
  "utf8",
);

test("registration consumer migration links normalized enrollments to immutable lesson sessions", () => {
  assert.match(migration, /class_start_lesson_session_id uuid/);
  assert.match(migration, /references public\.class_lesson_sessions\(id\)/);
  assert.match(migration, /validate_registration_class_session/);
  assert.match(migration, /save_registration_enrollment_rows/);
  assert.match(migration, /save_registration_enrollment_rows\(uuid, jsonb, text\)/);
});
