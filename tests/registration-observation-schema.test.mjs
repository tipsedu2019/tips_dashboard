import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809100000_registration_observation_core_schema.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_schema_test.sql",
);

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("core migration is transactional and contains no provider or existing-row cutover", async () => {
  const sql = await migrationSql();
  assert.match(sql, /^begin;\s+set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '120s';/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(
    sql,
    /\b(?:solapi|google_chat|provider|notification_deliver(?:y|ies)|reminder_jobs|due_jobs|outbox)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /update\s+public\.(?:ops_registration_subject_tracks|ops_registration_appointments|classroom_catalogs)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /delete\s+from\s+public\.(?:ops_registration_subject_tracks|ops_registration_appointments|classroom_catalogs)\b/i,
  );
});

test("core migration owns the exact ledger, receipt, event, and runtime objects", async () => {
  const sql = await migrationSql();
  for (const relation of [
    "public.ops_registration_observations",
    "dashboard_private.registration_observation_mutation_requests",
    "dashboard_private.registration_observation_domain_events",
    "dashboard_private.registration_observation_runtime_settings",
  ]) {
    assert.match(
      sql,
      new RegExp(`create table ${relation.replaceAll(".", "\\.")}\\b`, "i"),
    );
  }
  assert.match(
    sql,
    /add column observation_attempt_count bigint not null default 0/i,
  );
  assert.match(sql, /add column campus text/i);
  assert.match(sql, /add column observation_return_workflow_status text/i);
});

test("core migration defines the exact public and private readiness signatures", async () => {
  const sql = await migrationSql();
  for (const signature of [
    "dashboard_private.registration_observation_schema_readiness_v1_impl()",
    "dashboard_private.registration_observation_runtime_version_impl()",
    "dashboard_private.activate_registration_observation_runtime_v1_impl(integer, text)",
    "public.registration_observation_schema_readiness_v1()",
    "public.registration_observation_runtime_version()",
    "public.activate_registration_observation_runtime_v1(integer, text)",
  ]) {
    const [name] = signature.split("(");
    assert.match(
      sql,
      new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\s*\\(`, "i"),
    );
  }
  assert.match(
    sql,
    /create or replace function dashboard_private\.assert_registration_observation_runtime_v1\s*\(\s*\)/i,
  );
  assert.match(sql, /security invoker/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(
    sql,
    /raise exception 'registration_observation_request_key_conflict'/i,
  );
  assert.doesNotMatch(
    sql,
    /raise exception 'registration_observation_request_conflict'/i,
  );
});

test("source revision and workflow truth tables are guarded in the database", async () => {
  const sql = await migrationSql();
  assert.match(sql, /source_revision = pg_catalog\.jsonb_build_object/i);
  assert.match(sql, /session_authority = 'normalized'/i);
  assert.match(sql, /session_authority = 'legacy'/i);
  assert.match(sql, /status = 'attended_feedback_pending'/i);
  assert.match(sql, /status = 'completed'/i);
  assert.match(sql, /status = 'no_show'/i);
  assert.match(sql, /decision_kind in \(/i);
  assert.match(sql, /jsonb_typeof\(textbook_snapshot\) = 'array'/i);
});

test("readiness enumerates exact signatures and bounded missing-object tokens", async () => {
  const sql = await migrationSql();
  for (const token of [
    "public.get_registration_observation_feedback_v1(uuid)",
    "public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)",
    "dashboard_private.registration_appointment_track_ids_v1(uuid)",
    "public.ops_registration_subject_track_summaries.observation_attempt_count",
    "public.ops_registration_enrollments.class_start_source_observation_id",
    "public.ops_registration_appointment_calendar.security_invoker",
    "classroom_catalogs.campus_backfill",
  ]) {
    assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(sql, /to_regprocedure/i);
  assert.match(sql, /pg_get_functiondef/i);
  assert.match(sql, /reloptions/i);
  assert.doesNotMatch(sql, /pg_catalog\.current_date/i);
});

test("schema pgTAP is an executable 61-assertion ACL and behavior gate", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /select plan\(61\);/i);
  assert.match(sql, /insert into auth\.users/i);
  assert.match(sql, /'admin'/i);
  assert.match(sql, /'staff'/i);
  assert.match(sql, /'teacher'/i);
  assert.match(sql, /registration_observation_schema_readiness_v1/i);
  assert.match(sql, /registration_observation_runtime_version/i);
  assert.match(sql, /activate_registration_observation_runtime_v1/i);
  assert.match(sql, /registration_observation_request_key_conflict/i);
  assert.match(sql, /has_table_privilege/i);
  assert.match(sql, /set local role authenticated/i);
  assert.match(sql, /select \* from finish\(\);\s*rollback;\s*$/i);
});

test("package exposes only the approved local observation QA entrypoint", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["verify:registration-observation:local-db"],
    "node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs",
  );
});
