import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const contractMigrationUrl = new URL(
  "../supabase/migrations/20260809106000_registration_observation_solapi_contract.sql",
  import.meta.url,
);
const queueMigrationUrl = new URL(
  "../supabase/migrations/20260809106100_registration_observation_solapi_queue.sql",
  import.meta.url,
);
const dispatchMigrationUrl = new URL(
  "../supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql",
  import.meta.url,
);
const evidenceMigrationUrl = new URL(
  "../supabase/migrations/20260815182919_registration_customer_solapi_activation_evidence.sql",
  import.meta.url,
);
const providerPayloadChecksumMigrationUrl = new URL(
  "../supabase/migrations/20260816002344_registration_customer_reminder_provider_payload_checksum.sql",
  import.meta.url,
);
const finalClaimGateMigrationUrl = new URL(
  "../supabase/migrations/20260825090000_registration_customer_reminder_claim_final_gate.sql",
  import.meta.url,
);
const finalClaimGatePgTapUrl = new URL(
  "../supabase/tests/registration_customer_reminder_claim_final_gate_test.sql",
  import.meta.url,
);
const sqlReviewWorkflowUrl = new URL(
  "../.github/workflows/supabase-sql-review.yml",
  import.meta.url,
);
const currentHistoryMigrationUrl = new URL(
  "../supabase/migrations/20260814102020_registration_observation_current_history.sql",
  import.meta.url,
);
const reminderRouteUrl = new URL(
  "../src/features/tasks/server/registration-customer-reminder-route.ts",
  import.meta.url,
);
const solapiAdapterUrl = new URL(
  "../src/features/tasks/server/registration-customer-message-solapi.ts",
  import.meta.url,
);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("scheduled reminder finalization persists the provider payload checksum", async () => {
  const sql = normalizeSql(await readFile(providerPayloadChecksumMigrationUrl, "utf8"));
  assert.match(sql, /finalize_registration_customer_reminder_dispatch_v1\(\s*p_message_id uuid,\s*p_dispatch_token uuid,\s*p_result text,\s*p_provider_result jsonb,\s*p_provider_payload_checksum text\s*\)/);
  assert.match(sql, /p_result = 'accepted'.*p_provider_payload_checksum !~ '\^\[a-f0-9\]\{64\}\$'/s);
  assert.match(sql, /public\.finalize_registration_customer_reminder_dispatch_v1\(\s*p_message_id,\s*p_dispatch_token,\s*p_result,\s*p_provider_result\s*\)/s);
  assert.match(sql, /provider_payload_checksum = p_provider_payload_checksum/);
  assert.match(sql, /revoke execute on function public\.finalize_registration_customer_reminder_dispatch_v1\(\s*uuid, uuid, text, jsonb\s*\).*service_role/s);
  assert.match(sql, /grant execute on function public\.finalize_registration_customer_reminder_dispatch_v1\(\s*uuid, uuid, text, jsonb, text\s*\).*service_role/s);
});

test("observation current-history RPC is service-only and binds the full frozen delivery identity", async () => {
  const sql = await readFile(currentHistoryMigrationUrl, "utf8");
  const currentHistory = functionBlock(
    sql,
    "public.list_current_registration_observation_customer_messages_v1",
  );
  const normalized = normalizeSql(currentHistory);
  assert.match(normalized, /security definer/);
  assert.match(normalized, /\(select auth\.role\(\)\) <> 'service_role'/);
  assert.match(normalized, /registration_customer_message_assert_actor_v1/);
  for (const predicate of [
    "outbox.task_id = p_task_id",
    "outbox.observation_id = p_observation_id",
    "outbox.message_kind = p_message_kind",
    "outbox.source_revision = p_source_revision",
    "outbox.source_fingerprint = p_source_fingerprint",
    "outbox.recipient_hash = p_recipient_hash",
  ]) assert.match(normalized, new RegExp(predicate.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.match(
    normalized,
    /from \( select outbox\.\* from public\.ops_registration_customer_messages outbox[\s\S]*?order by outbox\.created_at desc, outbox\.id desc limit p_limit \) message/,
  );
  assert.match(
    sql,
    /revoke all on function public\.list_current_registration_observation_customer_messages_v1\([\s\S]*?\)\s*from public, anon, authenticated, service_role;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.list_current_registration_observation_customer_messages_v1\([\s\S]*?\)\s*to service_role;/,
  );
});

test("core runner exposes the final cumulative SOLAPI focus", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/run-registration-observation-local-db-qa.mjs",
    "--focus",
    "solapi",
  ], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /20260809106200/);
  assert.match(result.stdout, /registration_observation_solapi_contract_test\.sql/);
  assert.match(result.stdout, /registration_observation_solapi_queue_test\.sql/);
  assert.match(result.stdout, /registration_observation_solapi_dispatch_test\.sql/);
  assert.match(result.stdout, /dry[- ]run/i);
});

test("automatic SOLAPI assembly keeps the injected adapter boundary and frozen v2 ownership", async () => {
  const [route, adapter, ...migrations] = await Promise.all([
    readFile(reminderRouteUrl, "utf8"),
    readFile(solapiAdapterUrl, "utf8"),
    readFile(contractMigrationUrl, "utf8"),
    readFile(queueMigrationUrl, "utf8"),
    readFile(dispatchMigrationUrl, "utf8"),
  ]);
  assert.match(
    route,
    /const providerFetch = overrides\.providerFetch \?\? globalThis\.fetch\.bind\(globalThis\)/,
  );
  assert.match(
    route,
    /createRegistrationCustomerMessageSolapi\(\{[\s\S]*fetch: providerFetch,[\s\S]*\}\)/,
  );
  assert.match(
    adapter,
    /SOLAPI_SEND_MANY_URL = "https:\/\/api\.solapi\.com\/messages\/v4\/send-many\/detail"/,
  );
  assert.match(adapter, /providerFetch\(SOLAPI_SEND_MANY_URL,/);
  for (const migration of migrations) {
    assert.doesNotMatch(
      migration,
      /create or replace function public\.save_notification_control_plane_v2/i,
    );
    assert.doesNotMatch(
      migration,
      /save_notification_control_plane_v2\([^)]*override/i,
    );
  }
});

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

test("dispatch rechecks source before the provider marker", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const currentHash = sql.indexOf("booking_fact_hash is distinct from");
  const marker = sql.indexOf("provider_attempt_started_at");
  assert.ok(currentHash >= 0 && marker > currentHash);
  assert.match(sql, /status = 'source_dirty'/);
  assert.match(sql, /status = 'delivery_unknown'/);
  assert.match(sql, /materialize_registration_observation_solapi_events_v1\(100\)/);
  const readSource = functionBlock(
    sql,
    "public.read_registration_customer_reminder_source_v1",
  );
  assert.match(readSource, /where job\.job_id = p_job_id/);
  assert.match(readSource, /for update/);
  assert.match(readSource, /message_kind = 'observation_reminder'/);
  assert.match(
    readSource,
    /resolve_registration_customer_message_source_v1_impl\('observation_reminder',\s*v_job\.observation_id\)/,
  );
  assert.doesNotMatch(readSource, /where job\.appointment_id = p_job_id/);
  const publicResolve = functionBlock(
    sql,
    "public.resolve_registration_customer_message_source_v1",
  );
  const publicResolveRoleFence = publicResolve.indexOf("auth.role()");
  const publicResolveFirstRead = publicResolve.indexOf(
    "registration_customer_message_source_task_v1",
  );
  assert.ok(publicResolveRoleFence >= 0 && publicResolveFirstRead > publicResolveRoleFence);
  assert.match(publicResolve, /registration_customer_message_assert_actor_v1/);
  assert.match(publicResolve, /resolve_registration_customer_message_source_v1_impl/);
  assert.match(
    sql,
    /revoke all on function public\.resolve_registration_customer_message_source_v1\(uuid,\s*text,\s*uuid\).*public,\s*anon,\s*authenticated,\s*service_role/s,
  );
  assert.match(
    sql,
    /grant execute on function public\.resolve_registration_customer_message_source_v1\(uuid,\s*text,\s*uuid\).*to service_role/s,
  );
  const finalize = functionBlock(
    sql,
    "public.finalize_registration_customer_reminder_dispatch_v1",
  );
  assert.match(finalize, /p_message_id uuid/);
  assert.doesNotMatch(finalize, /p_job_id uuid/);
});

test("every observation provider-capable DB stage owns a runtime fence", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  for (const name of [
    "public.claim_registration_customer_reminder_job_v1",
    "public.get_registration_customer_solapi_readiness_v1",
  ]) {
    const block = functionBlock(sql, name);
    assert.match(block, /registration_observation_runtime_version\(\)/);
    assert.match(block, /observation_(?:booking|reminder)/);
  }
  for (const name of [
    "public.read_registration_customer_reminder_source_v1",
    "public.begin_registration_customer_reminder_dispatch_v1",
    "public.claim_registration_customer_message_v1",
    "public.mark_registration_customer_message_attempt_started_v1",
  ]) {
    const block = functionBlock(sql, name);
    assert.match(block, /assert_registration_observation_runtime_v1\(\)/);
    assert.match(block, /observation_(?:booking|reminder)/);
  }
  const marker = functionBlock(
    sql,
    "public.mark_registration_customer_message_attempt_started_v1",
  );
  assert.match(
    marker,
    /assert_registration_observation_runtime_v1\(\)[\s\S]*set\s+provider_attempt_count/i,
  );
  assert.match(sql, /registration_observation_runtime_inactive/);
});

test("dispatch centralizes observation identity across the manual source pipeline", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const storedSource = functionBlock(
    sql,
    "dashboard_private.registration_customer_message_stored_source_id_v1",
  );
  assert.match(
    storedSource,
    /coalesce\(p_observation_id, p_appointment_id, p_track_id, p_task_id\)/,
  );

  for (const name of [
    "dashboard_private.registration_customer_message_source_task_v1",
    "dashboard_private.resolve_registration_customer_message_source_v1_impl",
    "dashboard_private.registration_customer_message_assert_current_v1",
    "dashboard_private.registration_customer_message_result_v1",
  ]) {
    const block = functionBlock(sql, name);
    assert.match(block, /security definer/);
    assert.match(block, /set search_path = ''/);
    assert.match(block, /auth\.role\(\)/);
    assert.match(block, /observation_(?:booking|reminder)/);
    const signature = name.replace("dashboard_private.", "dashboard_private\\.");
    assert.match(
      sql,
      new RegExp(`revoke all on function ${signature}\\(`),
    );
  }
  assert.doesNotMatch(
    sql,
    /grant execute on function dashboard_private\.registration_customer_message_(?:source_task_v1|assert_current_v1|result_v1)/,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function dashboard_private\.resolve_registration_customer_message_source_v1_impl/,
  );

  for (const name of [
    "public.create_registration_customer_message_preview_v1",
    "public.claim_registration_customer_message_v1",
    "public.release_registration_customer_message_pre_send_claim_v1",
    "public.release_registration_customer_message_pre_send_claim_admin_v1",
    "public.mark_registration_customer_message_attempt_started_v1",
    "public.finalize_registration_customer_message_v1",
    "public.read_registration_customer_message_preview_target_v1",
    "public.list_registration_customer_messages_v1",
    "public.record_registration_customer_message_provider_check_v1",
    "public.reconcile_registration_customer_message_v1",
  ]) {
    const block = functionBlock(sql, name);
    const roleFence = block.indexOf("auth.role()");
    assert.ok(roleFence >= 0, `${name} lacks an explicit role fence`);
    assert.match(block, /observation_(?:booking|reminder)|observation_id/);
  }

  const preview = functionBlock(
    sql,
    "public.create_registration_customer_message_preview_v1",
  );
  assert.match(preview, /track_id, appointment_id, observation_id/);
  const claim = functionBlock(sql, "public.claim_registration_customer_message_v1");
  assert.match(claim, /registration_customer_message_stored_source_id_v1/);
  assert.match(claim, /registration_customer_message_delivery_origin_invalid/);
  assert.match(
    claim,
    /message\.observation_id = v_preview\.observation_id and message\.message_kind = v_preview\.message_kind and message\.source_revision = v_preview\.source_revision/,
  );
  const history = functionBlock(sql, "public.list_registration_customer_messages_v1");
  assert.match(history, /'sourceId', message\.observation_id/);
  assert.match(history, /'observationId', message\.observation_id/);
});

test("manual post-marker stages use durable observation identity instead of live eligibility", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const storedIdentity = functionBlock(
    sql,
    "dashboard_private.registration_customer_message_assert_stored_observation_v1",
  );
  assert.match(storedIdentity, /security definer/);
  assert.match(storedIdentity, /set search_path = ''/);
  assert.match(storedIdentity, /auth\.role\(\)/);
  assert.match(storedIdentity, /message\.preview_id = p_message\.preview_id/);
  assert.match(storedIdentity, /preview\.source_fingerprint = p_message\.source_fingerprint/);
  assert.match(storedIdentity, /event\.notification_revision = p_message\.source_revision/);
  assert.match(storedIdentity, /observation\.task_id = p_message\.task_id/);
  assert.doesNotMatch(storedIdentity, /observation\.status|appointment\.status/);

  for (const name of [
    "dashboard_private.registration_customer_message_result_v1",
    "public.release_registration_customer_message_pre_send_claim_v1",
    "public.release_registration_customer_message_pre_send_claim_admin_v1",
    "public.finalize_registration_customer_message_v1",
    "public.record_registration_customer_message_provider_check_v1",
    "public.reconcile_registration_customer_message_v1",
  ]) {
    const block = functionBlock(sql, name);
    assert.match(
      block,
      /registration_customer_message_assert_stored_observation_v1/,
      `${name} must validate the durable stored observation identity`,
    );
    assert.doesNotMatch(
      block,
      /resolve_registration_customer_message_source_v1_impl/,
      `${name} must not re-run live eligibility after claim or provider marker`,
    );
  }

  const marker = functionBlock(
    sql,
    "public.mark_registration_customer_message_attempt_started_v1",
  );
  assert.match(marker, /registration_customer_message_assert_current_v1/);
});

test("automatic dispatch is job locked, bounded, and keeps the legacy raw result", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const claim = functionBlock(sql, "public.claim_registration_customer_reminder_job_v1");
  assert.match(claim, /materialize_registration_observation_solapi_events_v1\(100\)/);
  assert.match(claim, /order by job\.due_at, job\.job_id for update of job skip locked limit 100/);
  assert.match(
    claim,
    /case job\.message_kind when 'appointment_reminder' then true when 'observation_reminder' then public\.registration_observation_runtime_version\(\) = 1 else false end/,
    "only observation rows may read runtime while filtering before the bounded page",
  );
  assert.doesNotMatch(claim, /v_runtime_version\s*:=/);
  assert.match(claim, /claim_lease_expired/);
  assert.match(claim, /scheduled_marker_recovery/);
  const legacyResult = claim.match(
    /if v_job\.message_kind = 'appointment_reminder' then return pg_catalog\.jsonb_build_object\([\s\S]*?\); end if;/,
  );
  assert.ok(legacyResult, "missing isolated legacy claim result");
  assert.match(legacyResult[0], /'jobId'/);
  assert.match(legacyResult[0], /'appointmentId'/);
  assert.match(legacyResult[0], /'claimToken'/);
  assert.match(legacyResult[0], /'sourceRevision'/);
  assert.match(legacyResult[0], /'scheduledFor'/);
  assert.match(legacyResult[0], /'requestKey'/);
  assert.doesNotMatch(legacyResult[0], /'messageKind'|'observationId'/);
  const legacyGate = claim.slice(
    claim.indexOf("if v_job.message_kind = 'appointment_reminder' then"),
    claim.indexOf(
      "update dashboard_private.registration_customer_reminder_jobs",
      claim.indexOf("if v_job.message_kind = 'appointment_reminder' then"),
    ),
  );
  assert.match(legacyGate, /v_activation\.mode is distinct from 'live'/);
  assert.match(legacyGate, /v_receipt\.message_kind is null/);
  assert.match(legacyGate, /live_test_confirmed_at is null/);
  assert.match(legacyGate, /status = 'accepted'/);
  assert.match(legacyGate, /live_test_message_id/);

  const read = functionBlock(sql, "public.read_registration_customer_reminder_source_v1");
  assert.ok(read.indexOf("auth.role()") < read.indexOf("from dashboard_private.registration_customer_reminder_jobs"));
  assert.match(read, /job\.job_id = p_job_id/);
  assert.match(read, /job\.claim_token = p_claim_token/);
  assert.match(read, /for update/);
  assert.match(
    read,
    /message_kind = 'observation_reminder'[\s\S]*assert_registration_observation_runtime_v1\(\)[\s\S]*resolve_registration_customer_message_source_v1_impl\('observation_reminder', v_job\.observation_id\)/,
  );
  assert.match(
    read,
    /message_kind = 'appointment_reminder'[\s\S]*resolve_registration_customer_message_source_v1_impl\('appointment_reminder', v_job\.appointment_id\)/,
  );
});

test("evidence migration removes disposable test rows from every live worker gate", async () => {
  const sql = normalizeSql(await readFile(evidenceMigrationUrl, "utf8"));
  assert.match(sql, /public\.claim_registration_customer_reminder_job_v1\(\)/);
  assert.match(sql, /public\.begin_registration_customer_reminder_dispatch_v1\(uuid,uuid,jsonb,jsonb\)/);
  assert.match(sql, /dashboard_private\.begin_registration_customer_reminder_dispatch_legacy_v1\(uuid,uuid,jsonb,jsonb\)/);
  assert.match(sql, /registration_customer_solapi_live_evidence_valid_v1/g);
  assert.match(sql, /registration_customer_solapi_claim_evidence_patch_failed/);
  assert.match(sql, /registration_customer_solapi_begin_evidence_patch_failed/);
  assert.match(sql, /registration_customer_solapi_legacy_begin_evidence_patch_failed/);
  const prior = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const priorClaim = functionBlock(prior, "public.claim_registration_customer_reminder_job_v1");
  assert.match(priorClaim, /automatic_delivery_cutoff_at/);
  assert.match(priorClaim, /verification_task_id/);
  assert.match(priorClaim, /verification_recipient_hash/);
});

test("final reminder claim and backlog retain the post-evidence delivery gates", async () => {
  const sql = normalizeSql(await readFile(finalClaimGateMigrationUrl, "utf8"));
  const claim = functionBlock(sql, "public.claim_registration_customer_reminder_job_v1");
  const backlog = functionBlock(sql, "public.has_registration_customer_reminder_backlog_v1");

  assert.match(claim, /for v_job in[\s\S]*?for update of job skip locked limit 100/);
  const candidatePage = claim.slice(
    claim.indexOf("for v_job in"),
    claim.indexOf("loop", claim.indexOf("for v_job in")),
  );
  assert.match(candidatePage, /join dashboard_private\.registration_customer_solapi_activation activation[\s\S]*?activation\.message_kind = job\.message_kind/);
  assert.match(candidatePage, /join dashboard_private\.registration_customer_solapi_template_receipts receipt[\s\S]*?receipt\.provider_status = 'sendable'[\s\S]*?receipt\.catalog_checksum = receipt\.provider_checksum/);
  assert.match(candidatePage, /activation\.mode = 'live'[\s\S]*?registration_customer_solapi_live_evidence_valid_v1/);
  assert.match(candidatePage, /activation\.mode in \('verification', 'live'\)/);
  assert.doesNotMatch(claim, /where activation\.message_kind = v_job\.message_kind for share/);
  assert.doesNotMatch(claim, /where receipt\.message_kind = v_job\.message_kind[\s\S]*?for share/);
  assert.match(claim, /v_activation\.mode is distinct from 'live'/);
  assert.match(claim, /registration_customer_solapi_live_evidence_valid_v1\(\s*'appointment_reminder'/);
  assert.match(claim, /v_activation\.mode not in \('verification', 'live'\)/);
  assert.match(claim, /verification_scope_changed/);
  assert.match(claim, /pre_cutoff_backlog/);
  assert.match(claim, /registration_customer_solapi_live_evidence_valid_v1\(\s*'observation_reminder'/);
  assert.match(claim, /resolve_registration_customer_message_source_v1_impl/);
  assert.match(claim, /last_error_code = 'source_ineligible'/);
  assert.match(claim, /booking_fact_changed/);
  assert.match(
    claim,
    /when sqlstate 'P0001' then[\s\S]*?if sqlerrm <> 'registration_customer_reminder_booking_fact_changed' then[\s\S]*?raise;/,
  );
  assert.doesNotMatch(claim, /when others then/);
  assert.doesNotMatch(claim, /errcode\s*=\s*'40001'/);

  assert.match(backlog, /registration_customer_solapi_template_receipts/);
  assert.match(backlog, /provider_status = 'sendable'/);
  assert.match(backlog, /catalog_checksum = receipt\.provider_checksum/);
  assert.match(backlog, /registration_customer_solapi_live_evidence_valid_v1/);
  assert.match(backlog, /verification_scope_changed|verification_started_at/);
  assert.match(backlog, /automatic_delivery_cutoff_at/);
  assert.doesNotMatch(backlog, /errcode\s*=\s*'40001'/);

  assert.match(sql, /v_old_state text := '40' \|\| '001'/);
  assert.match(sql, /v_new_state text := 'P0001'/);
  for (const signature of [
    "dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)",
    "public.read_registration_customer_reminder_source_v1(uuid,uuid)",
    "public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)",
  ]) {
    assert.match(sql, new RegExp(signature.replace(/[().]/g, "\\$&")));
  }
  assert.match(sql, /registration_customer_reminder_sqlstate_patch_failed/);
});

test("final reminder claim pgTAP pins the active SQLSTATE, ACL, and provider-zero gates", async () => {
  const sql = await readFile(finalClaimGatePgTapUrl, "utf8");
  assert.match(sql, /select plan\(21\);/);
  assert.equal(
    [...sql.matchAll(/^select (?:has_function|function_privs_are|ok|is|throws_ok)\(/gmu)].length,
    21,
  );
  assert.match(sql, /resolve_registration_customer_message_source_v1_impl\(text,uuid\)/);
  assert.match(sql, /read_registration_customer_reminder_source_v1\(uuid,uuid\)/);
  assert.match(sql, /begin_registration_customer_reminder_dispatch_v1\(uuid,uuid,jsonb,jsonb\)/);
  assert.match(sql, /registration_customer_reminder_booking_fact_changed/);
  assert.match(sql, /request\.jwt\.claim\.role/);
  assert.match(sql, /final gate checks add no provider marker while disabled/);
});

test("final reminder claim gate is bounded and mandatory in isolated schema CI", async () => {
  const [migration, workflow] = await Promise.all([
    readFile(finalClaimGateMigrationUrl, "utf8"),
    readFile(sqlReviewWorkflowUrl, "utf8"),
  ]);
  assert.match(
    migration,
    /^begin;\n\nset local lock_timeout = '5s';\nset local statement_timeout = '120s';/,
  );
  assert.match(
    workflow,
    /TASK_SUPABASE_CLI="\$\{RUNNER_TEMP\}\/supabase-cli\/supabase" node scripts\/run-isolated-supabase-db-tests\.mjs[\s\S]*?--postdeploy-contract[\s\S]*?--test supabase\/tests\/registration_customer_reminder_claim_final_gate_test\.sql/,
  );
});

test("begin and finalize own marker, refresh, uncertainty, and composite identity", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const begin = functionBlock(
    sql,
    "public.begin_registration_customer_reminder_dispatch_v1",
  );
  assert.match(begin, /where job\.job_id = p_job_id/);
  assert.match(begin, /source_refresh_count = 1/);
  assert.match(begin, /'currentStatus', 'refresh_required'/);
  assert.match(begin, /'currentStatus', 'settings_refresh_required'/);
  assert.match(begin, /'currentStatus', 'runtime_inactive'/);
  assert.match(begin, /last_error_code = 'source_revision_unstable'/);
  assert.equal(
    (
      begin.match(
        /last_error_code = 'duplicate_locked'[\s\S]*?'currentStatus', 'duplicate_locked'/g,
      ) ?? []
    ).length,
    2,
    "both duplicate paths must return the stable duplicate_locked status",
  );
  assert.match(
    begin,
    /for share[\s\S]*assert_registration_observation_runtime_v1\(\)[\s\S]*provider_attempt_started_at, provider_attempt_count/,
  );
  const finalRuntimeLock = begin.lastIndexOf(
    "from dashboard_private.registration_observation_runtime_settings",
  );
  const duplicateLock = begin.lastIndexOf(
    "from public.ops_registration_customer_messages message",
    finalRuntimeLock,
  );
  const finalRuntimeAssert = begin.lastIndexOf(
    "assert_registration_observation_runtime_v1()",
  );
  const markerInsert = begin.indexOf(
    "insert into public.ops_registration_customer_messages",
    finalRuntimeAssert,
  );
  assert.ok(
    duplicateLock < finalRuntimeLock && finalRuntimeLock < finalRuntimeAssert && finalRuntimeAssert < markerInsert,
    "the runtime row lock/assert must be the final authorization after duplicate locking and before marker mutation",
  );
  assert.match(begin, /last_error_code = 'verification_scope_changed'/);
  assert.match(begin, /'currentStatus', 'canceled'/);
  assert.match(
    begin,
    /job\.source_identity = v_message\.scheduled_source_identity/,
  );

  const finalize = functionBlock(
    sql,
    "public.finalize_registration_customer_reminder_dispatch_v1",
  );
  assert.match(finalize, /p_message_id uuid/);
  assert.match(finalize, /where message\.id = p_message_id for update/);
  assert.match(finalize, /when p_result = 'unknown' then 'delivery_unknown'/);
  assert.match(finalize, /where job\.job_id = v_message\.scheduled_job_id/);
  assert.match(finalize, /job\.source_identity = v_message\.scheduled_source_identity/);
});

test("settings and readiness keep automatic kinds independent and redact provider inputs", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"));
  const settings = functionBlock(
    sql,
    "public.set_registration_customer_reminder_settings_v1",
  );
  assert.match(
    settings,
    /activation\.message_kind = 'appointment_reminder' and activation\.mode = 'live'/,
  );
  assert.match(
    settings,
    /activation\.message_kind = 'observation_reminder' and activation\.mode in \('verification', 'live'\)/,
  );
  assert.match(settings, /job\.message_kind = 'observation_reminder'/);
  assert.match(settings, /job\.status = 'pending'/);
  assert.match(settings, /job\.claim_token is null/);
  assert.doesNotMatch(settings, /save_notification_control_plane_v2/);

  const readiness = functionBlock(
    sql,
    "public.inspect_registration_observation_solapi_readiness_v1",
  );
  assert.match(readiness, /registration_observation_runtime_version\(\) = 1/);
  assert.match(
    readiness,
    /v_last_succeeded_at >= pg_catalog\.clock_timestamp\(\) - interval '5 minutes'/,
  );
  for (const key of [
    "installed",
    "active",
    "contractReady",
    "vaultReady",
    "heartbeatCurrent",
    "lastSucceededAt",
  ]) {
    assert.match(readiness, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(
    readiness,
    /verification_recipient_hash|verification_task_id|template_id|parent_phone|vault_decrypted_secrets/,
  );
});
