import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

test("runtime activation is a guarded, audited migration with no class cutover", async () => {
  const activationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith("_continuous_class_schedule_release2_runtime_activate.sql"));
  assert.equal(activationFiles.length, 1, "one separate runtime activation migration is required");

  const migration = await readFile(
    new URL(`../supabase/migrations/${activationFiles[0]}`, import.meta.url),
    "utf8",
  );
  const normalized = normalizeSql(migration);

  assert.match(migration, /^begin;\s*/i);
  assert.match(migration.trim(), /commit;$/i);
  assert.match(migration, /set local lock_timeout = '5s';/i);
  assert.match(migration, /set local statement_timeout = '120s';/i);
  assert.match(
    normalized,
    /select \* into v_before from dashboard_private\.continuous_class_schedule_runtime where singleton = true for update/,
  );
  assert.match(
    normalized,
    /if not found or v_before\.version <> 0 then raise exception 'continuous_class_schedule_runtime_activation_guard_failed' using errcode = '40001'/,
  );
  assert.match(
    normalized,
    /update dashboard_private\.continuous_class_schedule_runtime set version = 1, updated_at = now\(\), updated_by = null where singleton = true and version = 0 returning \* into v_after/,
  );
  assert.match(
    normalized,
    /if not found then raise exception 'continuous_class_schedule_runtime_activation_guard_failed' using errcode = '40001'/,
  );
  assert.match(normalized, /insert into public\.dashboard_audit_logs \(/);
  assert.match(normalized, /current_user/);
  assert.match(normalized, /continuous_class_schedule_release2_runtime_activate/);
  assert.match(normalized, /separate release 2 runtime activation after g6 rollback rehearsal/);
  assert.match(
    normalized,
    /jsonb_build_object\( 'singleton', v_before\.singleton, 'version', v_before\.version/,
  );
  assert.match(
    normalized,
    /jsonb_build_object\( 'singleton', v_after\.singleton, 'version', v_after\.version/,
  );

  for (const forbidden of [
    /activate_class_schedule_storage_v1/,
    /backfill_class_schedule_shadow_v1/,
    /update public\.classes/,
    /class_schedule_slots/,
    /class_lesson_sessions/,
    /google_chat|web_push|solapi/,
    /\b(?:create|alter|drop)\b/,
  ]) {
    assert.doesNotMatch(normalized, forbidden);
  }
});
