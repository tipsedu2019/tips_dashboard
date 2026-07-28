import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationUrl = new URL(
  "../supabase/migrations/20260729100000_continuous_class_schedule_release2_contracts.sql",
  import.meta.url,
);
const pgTapUrl = new URL(
  "../supabase/tests/continuous_class_schedule_release2_test.sql",
  import.meta.url,
);
const fixtureUrl = new URL(
  "./fixtures/continuous-class-schedule-release2-contract.json",
  import.meta.url,
);

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

test("release 2 contracts preserve inactive runtime and close direct audit writes", async () => {
  const [migration, pgTap, fixtureSource] = await Promise.all([
    readFile(fileURLToPath(migrationUrl), "utf8"),
    readFile(fileURLToPath(pgTapUrl), "utf8"),
    readFile(fileURLToPath(fixtureUrl), "utf8"),
  ]);
  const fixture = JSON.parse(fixtureSource);
  const normalized = normalizeSql(migration);
  const normalizedPgTap = normalizeSql(pgTap);

  assert.match(migration, /^begin;\s*/i);
  assert.match(migration.trim(), /commit;$/i);
  assert.match(migration, /set local lock_timeout = '5s';/i);
  assert.match(migration, /set local statement_timeout = '120s';/i);

  assert.match(
    normalized,
    /add column if not exists class_id uuid references public\.classes\(id\) on delete set null/,
  );
  for (const column of ["request_key uuid", "request_operation text", "change_reason text"]) {
    assert.match(normalized, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(normalized, /create index if not exists dashboard_audit_logs_class_id_created_at_idx/);
  assert.match(normalized, /drop policy if exists dashboard_audit_logs_authenticated_insert on public\.dashboard_audit_logs/);
  assert.match(normalized, /revoke insert on table public\.dashboard_audit_logs from authenticated/);

  assert.match(normalized, /create table if not exists dashboard_private\.continuous_class_schedule_runtime/);
  assert.match(normalized, /insert into dashboard_private\.continuous_class_schedule_runtime \(singleton, version\) values \(true, 0\)/);
  assert.match(normalized, /check \(version in \(0, 1\)\)/);
  assert.match(normalized, /create table if not exists dashboard_private\.class_schedule_cutovers/);
  assert.match(normalized, /revoke all on table dashboard_private\.class_schedule_cutovers from public, anon, authenticated/);
  assert.match(normalized, /create function public\.continuous_class_schedule_runtime_version\(\)[\s\S]*select version[\s\S]*dashboard_private\.continuous_class_schedule_runtime/);
  assert.match(normalized, /returns trigger[\s\S]*continuous_class_schedule_direct_write_guard/);
  assert.match(normalized, /create trigger continuous_class_schedule_slots_direct_write_guard/);
  assert.match(normalized, /create trigger continuous_class_lesson_sessions_direct_write_guard/);
  assert.match(normalized, /current_setting\('app\.class_schedule_mutation', true\)/);

  assert.doesNotMatch(normalized, /update public\.classes set schedule_storage_mode/);
  assert.doesNotMatch(normalized, /update public\.classes set schedule_plan/);
  assert.doesNotMatch(normalized, /insert into public\.class_schedule_slots/);
  assert.doesNotMatch(normalized, /insert into public\.class_lesson_sessions/);
  assert.doesNotMatch(normalized, /schedule_overrides/);
  assert.doesNotMatch(normalized, /google_chat|web_push|solapi/i);
  assert.doesNotMatch(normalized, /drop (?:table|column)/);

  assert.equal(fixture.expected.runtimeVersion, 0);
  assert.equal(fixture.expected.operation, "save_class_schedule_defaults_v1");
  assert.equal(fixture.expected.existingSessionSnapshotMustRemainUntouched, true);
  assert.deepEqual(fixture.expected.auditColumns, [
    "class_id",
    "request_key",
    "request_operation",
    "change_reason",
  ]);
  assert.equal(fixture.defaultSlots.length, 1);
  assert.match(normalizedPgTap, /select plan\(19\)/);
  for (const expected of [
    "dashboard_audit_logs_authenticated_insert",
    "continuous_class_schedule_runtime",
    "class_schedule_cutovers",
    "continuous_class_schedule_direct_write_guard",
    "direct writes to normalized class schedule tables are rejected",
    "runtime remains inactive until the separate activation migration",
  ]) {
    assert.match(normalizedPgTap, new RegExp(expected));
  }
});
