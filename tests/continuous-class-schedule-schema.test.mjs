import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationUrl = new URL(
  "../supabase/migrations/20260728152442_continuous_class_schedule_foundation.sql",
  import.meta.url,
);
const pgTapUrl = new URL(
  "../supabase/tests/continuous_class_schedule_foundation_test.sql",
  import.meta.url,
);

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

test("foundation migration is additive, inactive, and read-only for application roles", async () => {
  const migration = await readFile(fileURLToPath(migrationUrl), "utf8");
  const pgTap = await readFile(fileURLToPath(pgTapUrl), "utf8");
  const normalized = normalizeSql(migration);
  const normalizedPgTap = normalizeSql(pgTap);

  assert.match(migration, /^begin;\s*/i);
  assert.match(migration.trim(), /commit;$/i);
  assert.match(migration, /set local lock_timeout = '5s';/i);
  assert.match(migration, /set local statement_timeout = '120s';/i);

  for (const column of [
    "schedule_revision bigint not null default 0",
    "schedule_storage_mode text not null default 'legacy'",
    "closed_at timestamptz",
    "closed_by uuid",
  ]) {
    assert.match(
      normalized,
      new RegExp(`add column if not exists ${column}`),
    );
  }

  for (const table of [
    "public.class_schedule_slots",
    "public.class_lesson_sessions",
    "dashboard_private.class_schedule_mutation_receipts",
  ]) {
    assert.match(
      normalized,
      new RegExp(`create table if not exists ${table}`),
    );
  }

  assert.match(
    normalized,
    /check \(schedule_storage_mode in \('legacy', 'shadow', 'normalized'\)\)/,
  );
  assert.match(
    normalized,
    /check \(schedule_state in \('active', 'exception', 'makeup', 'tbd', 'skipped'\)\)/,
  );
  assert.match(normalized, /unique \(class_id, session_key\)/);
  assert.match(normalized, /where source_schedule_slot_id is not null/);
  assert.match(normalized, /returns integer[\s\S]*select 0/);
  assert.doesNotMatch(normalized, /update public\.classes set schedule_storage_mode/);
  assert.doesNotMatch(normalized, /update public\.classes set schedule_plan/);
  assert.doesNotMatch(normalized, /insert into public\.class_schedule_slots/);
  assert.doesNotMatch(normalized, /insert into public\.class_lesson_sessions/);
  assert.doesNotMatch(normalized, /schedule_overrides/);
  assert.doesNotMatch(normalized, /google_chat|web_push|solapi/i);
  assert.doesNotMatch(normalized, /drop (?:table|column)/);

  for (const table of [
    "public.class_schedule_slots",
    "public.class_lesson_sessions",
  ]) {
    assert.match(normalized, new RegExp(`alter table ${table} enable row level security`));
  }
  assert.match(
    normalized,
    /grant select on public\.class_schedule_slots, public\.class_lesson_sessions to authenticated/,
  );
  assert.match(
    normalized,
    /revoke all on table dashboard_private\.class_schedule_mutation_receipts from public, anon, authenticated/,
  );
  assert.doesNotMatch(
    normalized,
    /create policy [^;]*(?:for insert|for update|for delete|for all)/,
  );
  assert.match(
    normalized,
    /dashboard_audit_class_schedule_slots[\s\S]*execute function public\.log_dashboard_audit_event\(\)/,
  );
  assert.match(
    normalized,
    /dashboard_audit_class_lesson_sessions[\s\S]*execute function public\.log_dashboard_audit_event\(\)/,
  );

  for (const expected of [
    "class_schedule_slots",
    "class_lesson_sessions",
    "class_schedule_mutation_receipts",
    "schedule_revision",
    "schedule_storage_mode",
    "classes_schedule_storage_mode_check",
    "class_lesson_sessions_state_check",
    "class_lesson_sessions_default_source_key",
    "row level security",
    "continuous_class_schedule_runtime_version",
    "foundation runtime remains inactive",
    "select plan\\(33\\)",
  ]) {
    assert.match(normalizedPgTap, new RegExp(expected));
  }
});
