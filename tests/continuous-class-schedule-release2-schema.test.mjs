import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationUrl = new URL(
  "../supabase/migrations/20260728230427_continuous_class_schedule_release2_contracts.sql",
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
const mutationMigrationUrl = new URL(
  "../supabase/migrations/20260728233510_continuous_class_schedule_release2_mutations.sql",
  import.meta.url,
);
const contractUrl = new URL(
  "../src/features/academic/continuous-class-schedule-contract.ts",
  import.meta.url,
);

const MUTATION_RPC_NAMES = [
  "get_class_schedule_defaults_v1",
  "get_class_schedule_v1",
  "initialize_new_class_schedule_v1",
  "save_class_schedule_defaults_v1",
  "preview_class_lesson_session_generation_v1",
  "generate_class_lesson_sessions_v1",
  "save_class_lesson_session_v1",
  "save_class_lesson_content_v1",
  "backfill_class_schedule_shadow_v1",
  "verify_class_schedule_shadow_v1",
  "activate_class_schedule_storage_v1",
  "deactivate_class_schedule_storage_v1",
];

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function functionBlock(source, functionName) {
  const normalizedName = `create or replace function ${functionName.toLowerCase()}(`;
  const lower = source.toLowerCase();
  const start = lower.indexOf(normalizedName);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = lower.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${functionName}`);
  return lower.slice(start, end + 4);
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
  assert.match(normalized, /create (?:or replace )?function public\.continuous_class_schedule_runtime_version\(\)[\s\S]*select version[\s\S]*dashboard_private\.continuous_class_schedule_runtime/);
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
  assert.match(normalizedPgTap, /select plan\(32\)/);
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

test("mutation migration implements every typed Release 2 RPC with a closed privilege boundary", async () => {
  const [migration, contract] = await Promise.all([
    readFile(fileURLToPath(mutationMigrationUrl), "utf8"),
    readFile(fileURLToPath(contractUrl), "utf8"),
  ]);
  const normalized = normalizeSql(migration);

  assert.match(migration, /^begin;\s*/i);
  assert.match(migration.trim(), /commit;$/i);
  assert.match(migration, /set local lock_timeout = '5s';/i);
  assert.match(migration, /set local statement_timeout = '120s';/i);

  for (const rpcName of MUTATION_RPC_NAMES) {
    assert.match(contract, new RegExp(`"${rpcName}"`));
    assert.match(
      normalized,
      new RegExp(`create or replace function public\\.${rpcName}\\(`),
    );
    assert.match(
      normalized,
      new RegExp(`revoke all on function public\\.${rpcName}\\(`),
    );
    assert.match(
      normalized,
      new RegExp(`grant execute on function public\\.${rpcName}\\([\\s\\S]*?to authenticated`),
    );
  }

  for (const helper of [
    "require_continuous_class_schedule_mutation_v1",
    "with_continuous_class_schedule_audit_context_v1",
    "continuous_class_schedule_request_replay_v1",
    "project_continuous_class_schedule_plan_v1",
  ]) {
    assert.match(normalized, new RegExp(`create or replace function dashboard_private\\.${helper}\\(`));
  }

  assert.match(normalized, /pg_advisory_xact_lock/);
  assert.match(normalized, /idempotency_key_reused/);
  assert.match(normalized, /class_schedule_stale/);
  assert.match(normalized, /continuous_class_schedule_runtime_not_ready/);
  assert.match(normalized, /set_config\('app\.class_schedule_mutation', 'release2-rpc', true\)/);
  assert.match(normalized, /on delete set null/);
  assert.doesNotMatch(normalized, /update public\.class_lesson_sessions[\s\S]{0,250}save_class_schedule_defaults_v1/);
  assert.doesNotMatch(normalized, /google_chat|web_push|solapi/i);
  assert.doesNotMatch(normalized, /drop (?:table|column)/);
});

test("backfill correction persists exact shadow rows and verifies stored evidence without activating runtime", async () => {
  const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const correctionFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith("_continuous_class_schedule_backfill_correction.sql"));
  assert.equal(correctionFiles.length, 1, "one generated backfill correction migration is required");

  const migration = await readFile(new URL(
    `../supabase/migrations/${correctionFiles[0]}`,
    import.meta.url,
  ), "utf8");
  const normalized = normalizeSql(migration);
  const backfill = functionBlock(migration, "public.backfill_class_schedule_shadow_v1");
  const verify = functionBlock(migration, "public.verify_class_schedule_shadow_v1");
  const activate = functionBlock(migration, "public.activate_class_schedule_storage_v1");

  assert.match(migration, /^begin;\s*/i);
  assert.match(migration.trim(), /commit;$/i);
  assert.match(migration, /set local lock_timeout = '5s';/i);
  assert.match(migration, /set local statement_timeout = '120s';/i);
  assert.match(backfill, /insert into public\.class_schedule_slots/);
  assert.match(backfill, /insert into public\.class_lesson_sessions/);
  assert.match(backfill, /delete from public\.class_schedule_slots/);
  assert.match(backfill, /delete from public\.class_lesson_sessions/);
  assert.match(backfill, /schedule_storage_mode = 'shadow'/);
  assert.match(backfill, /continuous_class_schedule_backfill_source_hash_v1\(\s*v_class\s*\)/);
  assert.match(backfill, /source_schedule_plan_hash,\s*source_backfill_hash,/);
  assert.match(verify, /slot_payload_mismatch/);
  assert.match(verify, /session_payload_mismatch/);
  assert.match(verify, /projection_mismatch/);
  assert.match(verify, /continuous_class_schedule_backfill_source_hash_v1\(\s*v_class\s*\)/);
  assert.match(verify, /cutover\.source_backfill_hash = p_expected_source_hash/);
  assert.match(normalized, /add column if not exists source_backfill_hash text/);
  assert.doesNotMatch(verify, /v_projection_hash\s*:=\s*v_source_hash/);
  assert.match(activate, /public\.verify_class_schedule_shadow_v1/);
  assert.match(activate, /v_verification\s*->>\s*'matches'/);
  assert.match(activate, /cutover\.source_backfill_hash = p_expected_source_hash/);
  assert.match(activate, /where id = v_cutover_id/);
  assert.doesNotMatch(
    normalized,
    /update dashboard_private\.continuous_class_schedule_runtime[\s\S]*version\s*=\s*1/,
  );
  assert.doesNotMatch(normalized, /update public\.classes set schedule_plan/);
});
