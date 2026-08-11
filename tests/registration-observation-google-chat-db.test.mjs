import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260809105000_registration_observation_google_chat.sql",
  import.meta.url,
)

test("observation Chat consumes the stable domain outbox without replacing core mutations", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /after insert on dashboard_private\.registration_observation_domain_events/i)
  assert.match(sql, /after insert on dashboard_private\.notification_assignment_change_facts/i)
  assert.match(sql, /create unique index registration_observation_chat_jobs_domain_identity_idx[\s\S]*observation_id,\s*notification_revision,\s*event_key[\s\S]*domain_event_id is not null/i)
  assert.match(sql, /create unique index registration_observation_chat_jobs_assignment_identity_idx[\s\S]*assignment_fact_id,\s*event_key[\s\S]*assignment_fact_id is not null/i)
  assert.match(
    sql,
    /constraint registration_observation_chat_jobs_source_kind_check[\s\S]*event_key\s*=\s*'registration\.observation_director_reassigned'[\s\S]*assignment_fact_id is not null[\s\S]*domain_event_id is null[\s\S]*event_key\s*<>\s*'registration\.observation_director_reassigned'[\s\S]*domain_event_id is not null[\s\S]*assignment_fact_id is null/i,
  )
  assert.match(sql, /registration\.observation_reminder_due/i)
  assert.match(sql, /registration\.observation_feedback_due/i)
  assert.doesNotMatch(sql, /create or replace function public\.(?:enter|save|reschedule|cancel|withdraw)_registration_observation_v1/i)
  assert.doesNotMatch(sql, /registration_customer_reminder_jobs|ops_registration_customer_messages|solapi|net\.http|cron\.schedule/i)
  assert.match(sql, /notification_audit_logs/i)
  assert.match(sql, /notification_dispatch_ownership_claims/i)
})

test("all eight observation destination rules are immediate and default OFF", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const seededEvents = [...sql.matchAll(/registration\.observation_(scheduled|rescheduled|canceled|reminder_due|feedback_due|feedback_submitted|director_reassigned)/g)]
  assert.equal(new Set(seededEvents.map((match) => match[0])).size, 7)
  assert.match(sql, /delivery_mode[\s\S]*'immediate'/i)
  assert.match(sql, /rule_variant_key[\s\S]*'immediate'/i)
  assert.match(sql, /enabled[\s\S]*false/i)
  assert.match(sql, /notification_settings_ui_registry/i)
  assert.match(sql, /notification_rule_content_contracts/i)
  assert.match(sql, /notification_rule_mention_settings/i)
  assert.doesNotMatch(sql, /google_chat\.executive/i)
})

test("observation Chat leaves protected generic functions byte-identical", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.doesNotMatch(sql, /\bclaim_notification_deliveries_v1\b/i)
  assert.doesNotMatch(sql, /\bprepare_notification_immediate_delivery_v1\b/i)
  assert.doesNotMatch(sql, /\brevalidate_immediate_notification_delivery_v1\b/i)
  assert.match(sql, /read_registration_observation_notification_delivery_frozen_state_v1/i)
  assert.match(sql, /prepare_registration_observation_notification_delivery_v1/i)
  assert.match(sql, /commit_notification_in_app_delivery_v1/i)
  assert.match(sql, /begin_notification_delivery_send_v1/i)

  const result = spawnSync(
    process.execPath,
    ["scripts/verify-supabase-migration-layout.mjs"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  )
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test("forward migration preserves the reason registry and narrows the new expiry reason to canceled", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).replace(/\s+/g, " ")
  const count = (pattern) => [...sql.matchAll(pattern)].length
  const statement = (constraintName) => {
    const marker = `add constraint ${constraintName}`
    const start = sql.toLowerCase().indexOf(marker)
    assert.notEqual(start, -1, `${constraintName} add missing`)
    const end = sql.indexOf(";", start)
    assert.notEqual(end, -1, `${constraintName} terminator missing`)
    return sql.slice(start, end + 1)
  }
  const literals = (source) => [...source.matchAll(/'([^']+)'/g)].map((match) => match[1])

  assert.equal(count(/drop constraint notification_deliveries_status_reason_check/gi), 1)
  assert.equal(count(/add constraint notification_deliveries_status_reason_check/gi), 1)
  assert.equal(count(/drop constraint notification_deliveries_status_reason_mapping_check/gi), 1)
  assert.equal(count(/add constraint notification_deliveries_status_reason_mapping_check/gi), 1)

  const registryLiterals = literals(statement("notification_deliveries_status_reason_check"))
  assert.equal(registryLiterals.length, 29)
  assert.equal(registryLiterals.filter((reason) => reason === "notification_window_closed").length, 1)
  assert.deepEqual(
    new Set(registryLiterals),
    new Set([
      "provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure",
      "connection_restored_manual_retry", "manual_retry_approved", "provider_timeout_after_dispatch",
      "connection_reset_after_dispatch", "worker_lost_after_send_start", "provider_ambiguous_response",
      "connection_missing", "render_validation_failed", "schedule_validation_failed",
      "payload_schema_unsupported", "max_attempts_exhausted", "retry_window_closed", "shadow_mode",
      "no_recipient", "workflow_scope_mismatch", "not_applicable", "legacy_skipped", "legacy_deduped",
      "rule_disabled", "source_status_changed", "source_schedule_changed", "source_revision_changed",
      "rule_revision_changed", "recipient_revoked", "cutover_rollback", "notification_window_closed",
    ]),
  )

  const mapping = statement("notification_deliveries_status_reason_mapping_check")
  const live = mapping.match(/status in \(([^)]*)\) and status_reason is null/i)
  assert.ok(live)
  assert.deepEqual(new Set(literals(live[1])), new Set(["pending", "claimed", "sending", "sent"]))
  const expectedFamilies = new Map([
    ["retry_wait", ["provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure", "connection_restored_manual_retry", "manual_retry_approved"]],
    ["delivery_unknown", ["provider_timeout_after_dispatch", "connection_reset_after_dispatch", "worker_lost_after_send_start", "provider_ambiguous_response"]],
    ["failed", ["connection_missing", "provider_definite_rejection", "render_validation_failed", "schedule_validation_failed", "payload_schema_unsupported", "max_attempts_exhausted", "retry_window_closed"]],
    ["skipped", ["shadow_mode", "no_recipient", "workflow_scope_mismatch", "not_applicable", "legacy_skipped", "legacy_deduped"]],
  ])
  for (const [status, expected] of expectedFamilies) {
    const family = mapping.match(new RegExp(`status = '${status}' and status_reason in \\(([^)]*)\\)`, "i"))
    assert.ok(family, `${status} mapping missing`)
    assert.equal(literals(family[1]).length, expected.length)
    assert.deepEqual(new Set(literals(family[1])), new Set(expected))
  }
  assert.match(mapping, /status = 'disabled' and status_reason = 'rule_disabled'/i)
  const canceled = mapping.match(/status = 'canceled' and status_reason in \(([^)]*)\)/i)
  assert.ok(canceled)
  const canceledLiterals = literals(canceled[1])
  assert.equal(canceledLiterals.length, 7)
  assert.deepEqual(new Set(canceledLiterals), new Set([
    "source_status_changed", "source_schedule_changed", "source_revision_changed",
    "rule_revision_changed", "recipient_revoked", "cutover_rollback", "notification_window_closed",
  ]))
  assert.equal(literals(mapping).filter((reason) => reason === "notification_window_closed").length, 1)
  assert.equal([...mapping.matchAll(/status = '/gi)].length, 6)
})

test("service worker uses RPCs and legacy QA performs no shared delivery or ownership DML", async () => {
  const repoUrl = new URL("..", import.meta.url)
  const sql = await readFile(migrationUrl, "utf8")
  const worker = await readFile(new URL("src/features/notifications/server/notification-worker.ts", repoUrl), "utf8")
  const legacyQa = await readFile(new URL("scripts/verify-word-retest-expected-at-concurrency.mjs", repoUrl), "utf8")
  const collectCode = async (directoryUrl) => {
    const files = []
    for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl)
      if (entry.isDirectory()) files.push(...await collectCode(child))
      else if (/\.(?:cjs|js|mjs|ts|tsx)$/.test(entry.name)) files.push(child)
    }
    return files
  }

  assert.doesNotMatch(worker, /\.schema\(["']dashboard_private["']\)\s*\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\)/)
  assert.doesNotMatch(legacyQa, /\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\)[\s\S]{0,160}\.(?:insert|update|delete)\s*\(/)
  assert.match(worker, /claim_notification_deliveries_v1/)
  assert.match(sql, /prepare_registration_observation_notification_delivery_v1/)

  for (const fileUrl of [
    ...await collectCode(new URL("src/", repoUrl)),
    ...await collectCode(new URL("scripts/", repoUrl)),
  ]) {
    const source = (await readFile(fileUrl, "utf8")).replace(/\s+/g, " ")
    assert.doesNotMatch(
      source,
      /\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\).{0,240}\.(?:insert|update|delete)\s*\(/,
      `shared table DML must go through RPC: ${fileURLToPath(fileUrl)}`,
    )
  }
})

test("observation final prepare keeps management delivery independent while resolving safe mentions", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const segment = (startMarker, endMarker) => {
    const start = sql.indexOf(startMarker)
    const end = sql.indexOf(endMarker)
    assert.notEqual(start, -1, `${startMarker} missing`)
    assert.ok(end > start, `${endMarker} missing or out of order`)
    return sql.slice(start, end)
  }
  const google = segment(
    "registration_observation_final_prepare_google_chat_target_begin",
    "registration_observation_final_prepare_google_chat_target_end",
  )
  const inApp = segment(
    "registration_observation_final_prepare_in_app_target_begin",
    "registration_observation_final_prepare_in_app_target_end",
  )

  assert.match(google, /begin_notification_delivery_send_v1/i)
  assert.match(google, /prepare_google_chat_delivery_mention_snapshot_v1/i)
  assert.match(sql, /registration_observation_chat_render_safe_v1/i)
  assert.match(
    sql,
    /registration_observation_delivery_render_unsafe[\s\S]*registration_observation_final_prepare_google_chat_target_begin/i,
  )
  assert.match(google, /google_chat\.management/i)
  assert.match(google, /connection:google_chat\.management/i)
  assert.match(google, /connection_key\s+is distinct from\s+'google_chat\.management'/i)
  assert.match(google, /target_key\s+is distinct from\s+'connection:google_chat\.management'/i)
  assert.match(
    google,
    /v_source\s*->>\s*'subject'[\s\S]*'영어'[\s\S]*'google_chat\.english'[\s\S]*'수학'[\s\S]*'google_chat\.math'[\s\S]*'과학'[\s\S]*'google_chat\.science'/i,
  )
  assert.doesNotMatch(google, /public\.google_chat_webhook_settings|notification_profile_is_active_v1|is_active_subject_director|recipient_revoked/i)
  assert.match(inApp, /public\.profiles[\s\S]*auth\.users/i)
  assert.match(inApp, /is_active_subject_director[\s\S]*notification_profile_is_active_v1/i)
  assert.match(inApp, /recipient_revoked/i)
  assert.doesNotMatch(inApp, /google_chat_webhook_settings|google_chat\.management|prepare_google_chat_delivery_mention_snapshot_v1/i)
})

test("job materialization validates the exact payload union and holds rule snapshots", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const compact = sql.replace(/\s+/g, " ")

  assert.match(sql, /registration_observation_chat_payload_valid_v3\s*\(\s*p_payload jsonb\s*\)/i)
  assert.match(
    compact,
    /registration_observation_chat_rule_snapshot_v1[\s\S]*?for share/i,
  )
  assert.match(
    compact,
    /registration:observation:[^;]*:director_assignment:[^;]*assignment_fact_id/i,
  )
  assert.match(
    compact,
    /registration_observation_chat_payload_valid_v3\(\s*p_payload\s*\)[\s\S]*?p_payload\s*->>\s*'observation_id'[\s\S]*?p_payload\s*->>\s*'appointment_id'[\s\S]*?p_payload\s*->\s*'source_revision'[\s\S]*?p_payload\s*->\s*'mention_profile_ids'/i,
  )
  assert.match(
    compact,
    /observation_rescheduled[\s\S]*notification_assignment_change_facts fact[\s\S]*fact\.source_id\s*=\s*new\.observation_id::text[\s\S]*fact\.source_revision\s*=\s*new\.notification_revision[\s\S]*fact\.role_key\s*=\s*'subject_teacher'/i,
  )
  assert.match(
    compact,
    /v_teacher_fact\.previous_profile_ids[\s\S]*v_previous_booking\s*->>\s*'teacherProfileId'[\s\S]*v_teacher_fact\.current_profile_ids[\s\S]*v_current_booking\s*->>\s*'teacherProfileId'/i,
  )
  assert.match(
    compact,
    /'registration\.observation_scheduled'[\s\S]*new\.occurred_at,\s*new\.occurred_at\s*\+\s*interval\s*'24 hours'/i,
  )
  assert.match(
    compact,
    /'registration\.observation_rescheduled'[\s\S]*new\.occurred_at,\s*new\.occurred_at\s*\+\s*interval\s*'24 hours'/i,
  )
})

test("claim and materialize both close jobs whose current lifecycle is no longer eligible", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const compact = sql.replace(/\s+/g, " ")

  assert.match(
    sql,
    /registration_observation_chat_source_eligible_v1\s*\(\s*p_event_key text,\s*p_source jsonb,\s*p_decision_is_null boolean\s*\)/i,
  )
  assert.ok(
    [...compact.matchAll(/registration_observation_chat_source_eligible_v1\s*\(/gi)].length >= 3,
    "eligibility must be defined and rechecked by claim plus materialize",
  )
  assert.match(compact, /source_status_changed/i)
})

test("worker bounds and final prepare dependency receipts are fail closed", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const claim = sql.slice(
    sql.indexOf("create or replace function public.claim_registration_observation_chat_jobs_v1"),
    sql.indexOf("create or replace function public.finish_registration_observation_chat_job_v1"),
  )
  const reap = sql.slice(
    sql.indexOf("create or replace function public.reap_registration_observation_chat_job_leases_v1"),
    sql.indexOf("create or replace function public.get_registration_observation_google_chat_readiness_v1"),
  )
  const prepare = sql.slice(
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
    sql.indexOf("update dashboard_private.notification_worker_heartbeats"),
  )

  assert.match(claim, /p_batch_size\s+is null[\s\S]*p_lease_seconds\s+is null/i)
  assert.match(reap, /p_batch_size\s+is null/i)
  for (const source of [claim, reap]) {
    assert.match(source, /p_worker_id\s*!~\s*'\^\[A-Za-z0-9\]/i)
  }
  assert.match(
    prepare,
    /jsonb_object_keys\(v_begin\)[\s\S]*registration_observation_delivery_begin_receipt_invalid/i,
  )
  assert.match(
    prepare,
    /jsonb_object_keys\(v_commit\)[\s\S]*registration_observation_in_app_receipt_invalid/i,
  )
  assert.match(prepare, /v_begin\s*->>\s*'delivery_id'[\s\S]*v_delivery\.id::text/i)
  assert.match(prepare, /v_begin\s*->>\s*'claim_token'[\s\S]*p_claim_token::text/i)
  assert.match(prepare, /v_begin\s*->>\s*'dispatch_token'[\s\S]*\^\[0-9a-fA-F\]/i)
  assert.match(prepare, /v_commit\s*->>\s*'delivery_id'[\s\S]*v_delivery\.id::text/i)
})

test("delivery boundaries retain the observation behind director-assignment events", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const segment = (startMarker, endMarker) => {
    const start = sql.indexOf(startMarker)
    const end = sql.indexOf(endMarker, start + startMarker.length)
    assert.notEqual(start, -1, `${startMarker} missing`)
    assert.ok(end > start, `${endMarker} missing or out of order`)
    return sql.slice(start, end)
  }
  const read = segment(
    "create or replace function public.read_registration_observation_notification_delivery_frozen_state_v1",
    "create or replace function public.refresh_registration_observation_notification_delivery_v1",
  )
  const refresh = segment(
    "create or replace function public.refresh_registration_observation_notification_delivery_v1",
    "create or replace function public.prepare_registration_observation_notification_delivery_v1",
  )
  const prepare = segment(
    "create or replace function public.prepare_registration_observation_notification_delivery_v1",
    "update dashboard_private.notification_worker_heartbeats",
  )
  const sourceValidator = segment(
    "create or replace function dashboard_private.registration_observation_chat_event_source_valid_v1",
    "create or replace function dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1",
  )

  for (const boundary of [read, refresh, prepare]) {
    assert.match(boundary, /registration_observation_chat_event_source_valid_v1/i)
  }
  assert.match(sourceValidator, /registration_observation_assignment_change/)
  assert.match(sourceValidator, /payload\s*->>\s*'observation_id'/i)
  assert.match(sourceValidator, /registration_observation_chat_payload_valid_v3/i)
  assert.match(refresh, /v_event\.payload\s*->>\s*'observation_id'/i)
  assert.match(prepare, /v_event\.payload\s*->>\s*'observation_id'/i)
  assert.doesNotMatch(refresh, /v_event\.source_id\s*::\s*uuid/i)
  assert.doesNotMatch(prepare, /v_event\.source_id\s*::\s*uuid/i)
})

test("migration gates the exact prior reason semantics before replacing constraints", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const gate = sql.slice(
    sql.indexOf("do $dependency_gate$"),
    sql.indexOf("alter table dashboard_private.notification_deliveries\n  drop constraint notification_deliveries_status_reason_check"),
  )

  assert.match(gate, /select settings\.activation_version[\s\S]*into strict v_runtime[\s\S]*for share/i)
  assert.match(gate, /when no_data_found or too_many_rows/i)
  assert.match(gate, /v_runtime is distinct from 0/i)
  assert.match(gate, /registration_observation_expected_reason_registry_gate/i)
  assert.match(gate, /registration_observation_expected_reason_mapping_gate/i)
  assert.match(
    gate,
    /pg_get_constraintdef[\s\S]*v_expected_reason_registry[\s\S]*pg_get_constraintdef[\s\S]*v_expected_reason_mapping/i,
  )
  assert.match(
    gate,
    /regexp_replace\(\s*v_reason_registry[\s\S]*is distinct from[\s\S]*regexp_replace\(\s*v_expected_reason_registry/i,
  )
  assert.match(
    gate,
    /regexp_replace\(\s*v_reason_mapping[\s\S]*is distinct from[\s\S]*regexp_replace\(\s*v_expected_reason_mapping/i,
  )
  assert.match(gate, /regexp_matches[\s\S]*v_reason_registry[\s\S]*regexp_matches[\s\S]*v_reason_mapping/i)
  assert.match(gate, /registration_observation_reason_registry_gate/i)
  assert.match(gate, /registration_observation_reason_mapping_gate/i)
  assert.match(gate, /foreach v_status[\s\S]*foreach v_reason[\s\S]*v_allowed is distinct from v_expected_allowed/i)
  assert.match(gate, /registration_observation_unexpected_status/i)
  assert.match(gate, /registration_observation_unexpected_reason/i)
})

test("source reader projects bounded class fields and reads schedule plan only for legacy", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const source = sql.slice(
    sql.indexOf("create or replace function dashboard_private.get_registration_observation_notification_source_impl_v1"),
    sql.indexOf("create or replace function public.get_registration_observation_notification_source_v1"),
  )

  assert.doesNotMatch(source, /select\s+class\.\*/i)
  assert.doesNotMatch(source, /v_class\s+public\.classes%rowtype/i)
  assert.match(
    source,
    /select class\.id, class\.name, class\.schedule_storage_mode\s+into v_class_id, v_class_name, v_class_schedule_storage_mode/i,
  )
  const authorityBranches = source.slice(
    source.indexOf("if v_observation.session_authority = 'normalized'"),
    source.indexOf("else\n    raise exception 'registration_observation_notification_source_dirty'"),
  )
  assert.match(
    authorityBranches,
    /if v_observation\.session_authority = 'normalized' then[\s\S]*continuous_class_schedule_runtime_version\(\) <> 1[\s\S]*v_class_schedule_storage_mode is distinct from 'normalized'/i,
  )
  assert.match(
    source,
    /elsif v_observation\.session_authority = 'legacy' then[\s\S]*select class\.schedule_plan[\s\S]*registration_observation_legacy_session_content_hash_v1/i,
  )
  const normalized = source.slice(
    source.indexOf("if v_observation.session_authority = 'normalized'"),
    source.indexOf("elsif v_observation.session_authority = 'legacy'"),
  )
  assert.doesNotMatch(normalized, /schedule_plan/i)
  const beforeAuthority = source.slice(0, source.indexOf("if v_observation.session_authority = 'normalized'"))
  assert.doesNotMatch(beforeAuthority, /class\.schedule_plan/i)
})

test("refresh pins immutable payload facts while allowing tagged revision refresh for every event", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const refresh = sql.slice(
    sql.indexOf("create or replace function public.refresh_registration_observation_notification_delivery_v1"),
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
  )
  const prepare = sql.slice(
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
    sql.indexOf("update dashboard_private.notification_worker_heartbeats"),
  )
  const matcher = sql.slice(
    sql.indexOf("create or replace function dashboard_private.registration_observation_chat_refresh_payload_matches_v1"),
    sql.indexOf("create or replace function dashboard_private.registration_observation_chat_event_source_valid_v1"),
  )

  assert.match(matcher, /registration\.observation_reminder_due/i)
  assert.match(matcher, /p_candidate\s*-\s*array[\s\S]*'source_revision'[\s\S]*'textbook_names'[\s\S]*'progress_summary'/i)
  assert.match(
    matcher,
    /else[\s\S]*p_candidate\s*-\s*'source_revision'[\s\S]*p_event_payload\s*-\s*'source_revision'[\s\S]*p_current_source_revision/i,
  )
  assert.match(refresh, /registration_observation_chat_refresh_payload_matches_v1/i)
  assert.match(prepare, /registration_observation_chat_refresh_payload_matches_v1/i)
  assert.match(refresh, /observation\.textbook_snapshot[\s\S]*observation\.progress_snapshot/i)
  assert.match(prepare, /observation\.textbook_snapshot[\s\S]*observation\.progress_snapshot/i)
})

test("finish codes and final prepare target lock branches are fail closed", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const finish = sql.slice(
    sql.indexOf("create or replace function public.finish_registration_observation_chat_job_v1"),
    sql.indexOf("create or replace function public.reap_registration_observation_chat_job_leases_v1"),
  )
  const prepare = sql.slice(
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
    sql.indexOf("update dashboard_private.notification_worker_heartbeats"),
  )

  for (const code of [
    "payload_schema_unsupported",
    "worker_lost_after_claim",
    "notification_window_closed",
    "source_schedule_changed",
    "rule_disabled_at_source",
    "rule_revision_changed",
  ]) {
    assert.match(finish, new RegExp(code))
  }
  assert.match(prepare, /v_candidate_event_id[\s\S]*v_candidate_rule_id[\s\S]*v_candidate_rule_revision/i)
  assert.match(prepare, /registration_observation_notification_target_lock_mismatch/i)
  assert.match(prepare, /public\.academic_subject_settings[\s\S]*where setting\.subject = '과학'[\s\S]*for share/i)
  assert.match(prepare, /v_ownership_found\s*:=\s*found/i)
  assert.match(prepare, /if not v_ownership_found[\s\S]*registration_observation_delivery_prepare_stale/i)
  assert.match(
    prepare,
    /select pg_catalog\.count\(\*\)[\s\S]*into v_registered_attempts[\s\S]*entity_kind\s*=\s*'notification_external_attempt'[\s\S]*v_delivery\.attempt_count\s*=\s*0[\s\S]*v_registered_attempts\s*<>\s*0[\s\S]*v_delivery\.attempt_count\s*>\s*0[\s\S]*v_registered_attempts\s*=\s*0[\s\S]*registration_observation_delivery_frozen_state_invalid/i,
  )
})

test("final prepare binds every source and dispatch row to the approved lock order", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const prepare = sql.slice(
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
    sql.indexOf("update dashboard_private.notification_worker_heartbeats"),
  )
  const locate = (pattern, label, source = prepare) => {
    const match = pattern.exec(source)
    assert.ok(match, `${label} lock missing`)
    return match.index
  }
  const ordered = [
    [/(?:perform|select)[\s\S]*?from public\.ops_registration_subject_tracks track[\s\S]*?for share;/i, "track"],
    [/select observation\.\*[\s\S]*?into v_locked_observation[\s\S]*?from public\.ops_registration_observations observation[\s\S]*?for share;/i, "observation"],
    [/perform appointment\.id[\s\S]*?from public\.ops_registration_appointments appointment[\s\S]*?for share;/i, "appointment"],
    [/perform class\.id[\s\S]*?from public\.classes class[\s\S]*?for share;/i, "class"],
    [/perform lesson\.id[\s\S]*?from public\.class_lesson_sessions lesson[\s\S]*?for share;/i, "normalized lesson"],
    [/perform teacher\.id[\s\S]*?from public\.teacher_catalogs teacher[\s\S]*?where teacher\.id[\s\S]*?for share;/i, "teacher catalog"],
    [/perform classroom\.id[\s\S]*?from public\.classroom_catalogs classroom[\s\S]*?for share;/i, "classroom catalog"],
    [/select delivery\.\* into v_delivery\s+from dashboard_private\.notification_deliveries delivery\s+where delivery\.id = p_delivery_id\s+for update;/i, "delivery"],
    [/select event_row\.\* into v_event\s+from dashboard_private\.notification_events event_row\s+where event_row\.id = v_delivery\.event_id\s+for share;/i, "event"],
    [/select rule\.\* into v_rule\s+from dashboard_private\.notification_rules rule\s+where rule\.id = v_delivery\.rule_id\s+for share;/i, "rule"],
    [/select ownership\.\* into v_ownership[\s\S]*?from dashboard_private\.notification_dispatch_ownership_claims ownership[\s\S]*?for update;/i, "ownership"],
  ].map(([pattern, label]) => [locate(pattern, label), label])
  assert.deepEqual(
    ordered.map(([, label]) => label),
    [...ordered].sort((a, b) => a[0] - b[0]).map(([, label]) => label),
  )

  const inAppStart = prepare.indexOf("if v_candidate_channel = 'in_app'")
  const dispatchStart = ordered.find(([, label]) => label === "delivery")[0]
  assert.ok(inAppStart > 0 && dispatchStart > inAppStart)
  const inAppDependencies = prepare.slice(inAppStart, dispatchStart)
  for (const [pattern, label] of [
    [/from public\.teacher_catalogs teacher[\s\S]*?profile_id = v_director[\s\S]*?for share/i, "director catalog"],
    [/from public\.academic_subject_settings setting[\s\S]*?for share/i, "science setting"],
    [/from public\.profiles profile[\s\S]*?join auth\.users account[\s\S]*?for share of profile, account/i, "director account"],
  ]) locate(pattern, label, inAppDependencies)

  const sourceRebuild = prepare.lastIndexOf(
    "v_source := dashboard_private.get_registration_observation_notification_source_impl_v1",
    dispatchStart,
  )
  assert.ok(sourceRebuild > ordered.find(([, label]) => label === "classroom catalog")[0])
  assert.ok(sourceRebuild < inAppStart)
  assert.doesNotMatch(
    prepare.slice(0, ordered.find(([, label]) => label === "track")[0]),
    /notification_deliveries[\s\S]*for update|notification_dispatch_ownership_claims[\s\S]*for update/i,
  )
})

test("seed, heartbeat, and delivery binding migrations fail closed", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const seed = sql.slice(
    sql.indexOf("do $seed_collision_gate$"),
    sql.indexOf("do $seed_assertions$"),
  )
  const heartbeat = sql.slice(
    sql.indexOf("alter table dashboard_private.notification_worker_heartbeats\n  drop constraint"),
    sql.indexOf("create or replace function public.record_notification_worker_heartbeat_v1"),
  )
  const contract = sql.slice(
    sql.indexOf("create or replace function dashboard_private.registration_observation_chat_delivery_contract_valid_v1"),
    sql.indexOf("create or replace function dashboard_private.registration_observation_chat_booking_snapshot_v1"),
  )
  const refresh = sql.slice(
    sql.indexOf("create or replace function public.refresh_registration_observation_notification_delivery_v1"),
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
  )
  const prepare = sql.slice(
    sql.indexOf("create or replace function public.prepare_registration_observation_notification_delivery_v1"),
    sql.indexOf("update dashboard_private.notification_worker_heartbeats"),
  )

  assert.match(seed, /registration_observation_google_chat_seed_collision/i)
  assert.doesNotMatch(seed, /on conflict/i)
  assert.ok(heartbeat.indexOf("drop constraint") < heartbeat.indexOf("set counts"))
  assert.match(contract, /jsonb_array_elements\(p_rule_snapshot\)[\s\S]*snapshot\.item is not distinct from pg_catalog\.jsonb_build_object/i)
  assert.match(contract, /p_rule_event_key = p_event_key[\s\S]*p_rule_channel_key = p_delivery_channel_key[\s\S]*p_rule_template_id = p_delivery_template_id/i)
  assert.match(refresh, /registration_observation_chat_delivery_contract_valid_v1/i)
  assert.match(prepare, /registration_observation_chat_delivery_contract_valid_v1/i)
})
