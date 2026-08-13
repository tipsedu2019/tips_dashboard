import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260813064146_registration_observation_legacy_schedule_slots.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_legacy_schedule_slots_test.sql",
);
const runnerPath = path.join(
  repositoryRoot,
  "scripts/run-registration-observation-local-db-qa.mjs",
);
const ASSERTION_PATTERN =
  /^select\s+(?:ok|is|isnt|has_[a-z_]+|function_[a-z_]+|throws_ok|lives_ok|is_empty|isnt_empty|results_eq|bag_eq|set_eq)\s*\(/gim;

test("legacy schedule migration installs one private effective-slot helper", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /create or replace function dashboard_private\.registration_observation_effective_legacy_slots_v1\(\s*p_class_id uuid\s*\)[\s\S]*?returns setof public\.class_schedule_slots[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    sql,
    /registration_customer_message_legacy_slots_v1\(\s*v_class\.schedule,\s*v_class\.teacher,\s*v_class\.room\s*\)/i,
  );
  assert.match(
    sql,
    /return query\s+select slot\.\*\s+from public\.class_schedule_slots slot[\s\S]*?if found then\s+return;/i,
  );
  assert.match(
    sql,
    /revoke all on function dashboard_private\.registration_observation_effective_legacy_slots_v1\(uuid\)\s+from public, anon, authenticated, service_role;/i,
  );
});

test("legacy schedule migration fail-closes and patches all four consumers", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const signature of [
    "list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)",
    "resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)",
    "assert_registration_observation_current_session_v1(uuid,text)",
    "get_registration_observation_notification_source_impl_v1(uuid)",
  ]) {
    assert.ok(sql.includes(`dashboard_private.${signature}`), signature);
  }
  assert.match(sql, /v_old_occurrences is distinct from v_expected_occurrences/i);
  assert.match(sql, /registration_observation_legacy_schedule_dependency_drift/i);
  assert.match(sql, /registration_observation_legacy_schedule_install_failed/i);
  assert.match(
    sql,
    /from dashboard_private\.registration_observation_effective_legacy_slots_v1\('/i,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:http|https|net\.http|pg_net|solapi|provider_attempt)\b/i,
  );
});

test("legacy schedule pgTAP plan exactly covers list save feedback notification and slot precedence", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  const plan = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(plan.length, 1);
  assert.equal(Number(plan[0][1]), [...sql.matchAll(ASSERTION_PATTERN)].length);
  for (const token of [
    "registration_observation_effective_legacy_slots_v1",
    "list_registration_observation_sessions_v1",
    "save_registration_observation_booking_v1",
    "assert_registration_observation_current_session_v1",
    "get_registration_observation_notification_source_impl_v1",
    "persisted schedule slots stay authoritative",
  ]) {
    assert.ok(sql.includes(token), token);
  }
});

test("local DB runner exposes the exact provider-zero legacy-schedule focus", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [runnerPath, "--focus", "legacy-schedule"],
    { cwd: repositoryRoot, env: process.env },
  );
  assert.equal(stderr, "");
  assert.match(stdout, /DRY RUN — zero database changes/);
  const receipt = JSON.parse(stdout.slice(stdout.indexOf("{") ));
  assert.equal(receipt.focus, "legacy-schedule");
  assert.equal(receipt.migrationCeiling, "20260813064146");
  assert.deepEqual(receipt.migrations, [
    "20260813064146_registration_observation_legacy_schedule_slots.sql",
  ]);
  assert.deepEqual(receipt.pgTapTests, [
    "supabase/tests/registration_observation_legacy_schedule_slots_test.sql",
  ]);
  assert.equal(receipt.providerCalls, 0);
});
