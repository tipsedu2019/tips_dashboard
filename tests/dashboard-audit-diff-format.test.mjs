import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260814115116_dashboard_audit_diff_format.sql", import.meta.url);
const manifestUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url);

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

test("audit patch helpers are private immutable invoker functions and manifest binds the candidate bytes", async () => {
  const [source, manifestSource] = await Promise.all([readFile(migrationUrl, "utf8"), readFile(manifestUrl, "utf8")]);
  const sql = normalized(source); const manifest = JSON.parse(manifestSource);
  for (const helper of ["dashboard_audit_forward_patch_v2", "dashboard_audit_reverse_patch_v2"]) {
    assert.match(sql, new RegExp(`create or replace function dashboard_private\\.${helper}\\(record_value jsonb, patch jsonb\\)[\\s\\S]*immutable[\\s\\S]*security invoker[\\s\\S]*set search_path = ''`));
    assert.match(sql, new RegExp(`revoke all on function dashboard_private\\.${helper}\\(jsonb, jsonb\\) from public, anon, authenticated, service_role`));
  }
  assert.match(sql, /create role dashboard_audit_writer_v2 nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/u);
  assert.match(sql, /revoke all on function dashboard_private\.log_dashboard_audit_event_v2\(\) from public, anon, authenticated, service_role/u);
  const row = manifest.orderedNewMigrations.find(({ fileName }) => fileName === "20260814115116_dashboard_audit_diff_format.sql");
  assert.deepEqual(row, { fileName: "20260814115116_dashboard_audit_diff_format.sql", status: "candidate", sha256: createHash("sha256").update(source).digest("hex") });
});
