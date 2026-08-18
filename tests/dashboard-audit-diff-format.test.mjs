import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260814115116_dashboard_audit_diff_format.sql", import.meta.url);
const activeCaptureUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1.active.json", import.meta.url);
const capturesUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1-captures/", import.meta.url);

async function activeMigrationLedger() {
  const pointer = JSON.parse(await readFile(activeCaptureUrl, "utf8"));
  const catalog = JSON.parse(await readFile(new URL(`${pointer.captureId}/catalog.json`, capturesUrl), "utf8"));
  assert.equal(catalog.captureStatus, "reviewed");
  return catalog.migrationLedger;
}

function normalized(value) { return value.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase(); }

test("audit diff migration is additive, bounded, and replaces all audit triggers with v2", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const sql = normalized(source);
  assert.match(source, /^begin;\s*/iu);
  assert.match(source.trim(), /commit;$/iu);
  assert.match(sql, /set local lock_timeout = '2s'/u);
  assert.match(sql, /set local statement_timeout = '30s'/u);
  for (const column of ["record_format text not null default 'full_v1'", "change_patch jsonb", "before_hash text", "after_hash text", "event_sequence bigint", "audit_chain_id uuid", "chain_ordinal bigint", "chain_start_kind text", "predecessor_event_id uuid", "predecessor_after_hash text"]) assert.match(sql, new RegExp(column));
  assert.match(sql, /create index if not exists dashboard_audit_logs_v2_entity_sequence_idx[\s\S]*include \(id, action, audit_chain_id, chain_ordinal, after_hash\)[\s\S]*where record_format in \('full_v2', 'diff_v2'\)/u);
  assert.match(sql, /where entity_table = tg_table_name and entity_id is not distinct from audit_entity_id[\s\S]*record_format in \('full_v2', 'diff_v2'\)[\s\S]*order by event_sequence desc limit 1/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /audit_chain_continuity_invalid/u);
  assert.match(sql, /change_patch = '\{\}'::jsonb and before_hash = after_hash/u);
  assert.doesNotMatch(sql, /alter table public\.dashboard_audit_logs[\s\S]{0,160}\bupdate\b/u);
  assert.doesNotMatch(sql, /google_chat|web_push|solapi/u);
  for (const table of ["teacher_catalogs", "profiles", "students", "classes", "textbooks", "class_schedule_slots", "class_lesson_sessions"]) assert.match(sql, new RegExp(`dashboard_audit_${table}`));
});

test("audit patch helpers are private immutable invoker functions and the reviewed ledger records the migration", async () => {
  const [source, migrationLedger] = await Promise.all([readFile(migrationUrl, "utf8"), activeMigrationLedger()]);
  const sql = normalized(source);
  for (const helper of ["dashboard_audit_forward_patch_v2", "dashboard_audit_reverse_patch_v2"]) {
    assert.match(sql, new RegExp(`create or replace function dashboard_private\\.${helper}\\(record_value jsonb, patch jsonb\\)[\\s\\S]*immutable[\\s\\S]*security invoker[\\s\\S]*set search_path = ''`));
    assert.match(sql, new RegExp(`revoke all on function dashboard_private\\.${helper}\\(jsonb, jsonb\\) from public, anon, authenticated, service_role`));
  }
  assert.match(sql, /create role dashboard_audit_writer_v2 nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/u);
  assert.match(sql, /grant dashboard_audit_writer_v2 to postgres;[\s\S]*alter function dashboard_private\.log_dashboard_audit_event_v2\(\) owner to dashboard_audit_writer_v2/u);
  assert.match(sql, /grant create on schema dashboard_private to dashboard_audit_writer_v2[\s\S]*alter sequence dashboard_private\.dashboard_audit_event_sequence_v2 owner to dashboard_audit_writer_v2[\s\S]*revoke create on schema dashboard_private from dashboard_audit_writer_v2/u);
  assert.doesNotMatch(sql, /auth\.(?:uid|jwt)\(\)/u);
  assert.match(sql, /current_setting\('request\.jwt\.claims', true\)/u);
  assert.doesNotMatch(sql, /grant dashboard_audit_writer_v2 to (?:anon|authenticated|service_role)/u);
  assert.match(sql, /create policy dashboard_audit_logs_writer_select on public\.dashboard_audit_logs for select to dashboard_audit_writer_v2 using \(true\)/u);
  assert.match(sql, /revoke all on function dashboard_private\.log_dashboard_audit_event_v2\(\) from public, anon, authenticated, service_role/u);
  assert.deepEqual(
    migrationLedger.filter(({ version }) => version === "20260814115116"),
    [{
      version: "20260814115116",
      name: "dashboard_audit_diff_format",
      statementsSha256: "ebb95d08b263416643fc3b207b2ec4728fd8ab94501700e6845a6b3528c70b04",
    }],
  );
});
