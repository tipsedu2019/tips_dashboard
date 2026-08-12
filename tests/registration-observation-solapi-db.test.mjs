import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractMigrationUrl = new URL(
  "../supabase/migrations/20260809106000_registration_observation_solapi_contract.sql",
  import.meta.url,
);
const queueMigrationUrl = new URL(
  "../supabase/migrations/20260809106100_registration_observation_solapi_queue.sql",
  import.meta.url,
);

function normalizeSql(source) {
  return source.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function functionBlock(source, qualifiedName) {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
      "i",
    ),
  );
  assert.ok(match, `missing function block: ${qualifiedName}`);
  return match[0];
}

function uniqueIndexBlock(source, indexName) {
  const escapedName = indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+unique\\s+index\\s+${escapedName}\\s+on[\\s\\S]*?;`,
      "i",
    ),
  );
  assert.ok(match, `missing unique index block: ${indexName}`);
  return match[0];
}

test("observation customer kinds are closed and revision scoped", async () => {
  const source = await readFile(contractMigrationUrl, "utf8");
  const sql = normalizeSql(source);

  assert.match(sql, /'observation_booking'.*'observation_reminder'/s);
  assert.match(sql, /add column observation_id uuid/);
  assert.match(sql, /unique.*observation_id.*message_kind.*source_revision/s);
  const observationLock = uniqueIndexBlock(
    source,
    "ops_reg_customer_msg_observation_revision_once_idx",
  );
  assert.match(
    observationLock,
    /where\s+message_kind\s+in\s*\(\s*'observation_booking'\s*,\s*'observation_reminder'\s*\)\s*;/i,
  );
  assert.doesNotMatch(observationLock, /\bor\b/i);
  assert.match(sql, /automatic_delivery_cutoff_at timestamptz/);
  assert.match(
    sql,
    /\('observation_booking', 'off'\).*\('observation_reminder', 'off'\)/s,
  );

  const cutoff = functionBlock(
    source,
    "dashboard_private.set_registration_customer_solapi_cutoff_v1",
  );
  assert.match(cutoff, /security invoker/);
  assert.doesNotMatch(cutoff, /security definer/);
  assert.doesNotMatch(sql, /update .* mode = 'live'|provider_attempt_count = 1/);
});

test("SOLAPI contract fails closed on the exact observation event producer", async () => {
  const sql = normalizeSql(await readFile(contractMigrationUrl, "utf8"));

  assert.match(sql, /dashboard_private\.registration_observation_domain_events/);
  assert.match(sql, /registration_observation_solapi_dependency_missing/);
  assert.match(
    sql,
    /create temporary table registration_observation_solapi_expected_event_kind_gate/,
  );
  assert.match(
    sql,
    /v_event_kind_constraint.*is distinct from.*v_expected_event_kind_constraint/s,
  );
  for (const eventKind of [
    "observation_scheduled",
    "observation_rescheduled",
    "observation_canceled",
    "observation_attendance_recorded",
    "observation_no_show",
    "observation_feedback_submitted",
  ]) {
    assert.match(sql, new RegExp(`'${eventKind}'`));
  }
});

test("queue migration preserves old jobs before adding observation jobs", async () => {
  const sql = normalizeSql(await readFile(queueMigrationUrl, "utf8"));
  const add = sql.indexOf("add column job_id uuid");
  const backfill = sql.indexOf("set job_id = appointment_id");
  const dropInbound = sql.indexOf(
    "drop constraint ops_registration_customer_messages_scheduled_job_id_fkey",
  );
  const dropPk = sql.indexOf(
    "drop constraint registration_customer_reminder_jobs_pkey",
  );
  const addPk = sql.indexOf("primary key (job_id)");
  assert.ok(add < backfill && backfill < dropInbound && dropInbound < dropPk && dropPk < addPk);
  assert.match(sql, /materialize_registration_observation_solapi_events_v1\(p_limit integer\)/);
  assert.match(sql, /create or replace function dashboard_private\.sync_registration_customer_reminder_jobs_v1\(\)/);
  assert.match(sql, /create or replace function public\.claim_registration_customer_reminder_job_v1\(\)/);
  assert.match(sql, /create or replace function public\.read_registration_customer_reminder_source_v1\(p_job_id uuid,\s*p_claim_token uuid\)/);
  assert.match(sql, /create or replace function public\.release_registration_customer_reminder_job_v1\(p_job_id uuid,\s*p_claim_token uuid,\s*p_error_code text\)/);
  assert.match(sql, /create or replace function public\.begin_registration_customer_reminder_dispatch_v1\(p_job_id uuid,\s*p_claim_token uuid,\s*p_contract jsonb,\s*p_readiness_contract jsonb\)/);
  assert.match(sql, /create or replace function public\.finalize_registration_customer_reminder_dispatch_v1\(p_message_id uuid,\s*p_dispatch_token uuid,\s*p_result text,\s*p_provider_result jsonb\)/);
  assert.match(sql, /on conflict \(appointment_id,\s*source_revision,\s*message_kind\)\s*where message_kind\s*=\s*'appointment_reminder'/);
  assert.match(sql, /primary key \(job_id\)/);
  assert.match(sql, /scheduled_source_identity uuid generated always as/);
  assert.match(sql, /foreign key \(scheduled_job_id,\s*appointment_id,\s*message_kind,\s*source_revision,\s*scheduled_source_identity\)/);
  assert.match(sql, /references dashboard_private\.registration_customer_reminder_jobs\(job_id,\s*appointment_id,\s*message_kind,\s*source_revision,\s*source_identity\)/);
  assert.match(sql, /status = 'pending'.*octet_length\(last_error_code\) <= 120/s);
  const claimStart = sql.indexOf("create or replace function public.claim_registration_customer_reminder_job_v1()");
  const claimEnd = sql.indexOf("alter function public.claim_registration_customer_reminder_job_v1()", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  assert.doesNotMatch(sql.slice(claimStart, claimEnd), /where job\.appointment_id = p_job_id/);
});
