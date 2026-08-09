import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809102000_registration_observation_booking.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_booking_test.sql",
);

const READ_ASSERTION_PATTERN =
  /^select\s+(?:ok|is|isnt|has_[a-z_]+|function_[a-z_]+|throws_ok|lives_ok|is_empty|isnt_empty|results_eq|bag_eq|set_eq)\s*\(/gim;

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

function functionBlock(sql, schema, functionName) {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${functionName}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = sql.match(pattern);
  assert.ok(match, `${schema}.${functionName} is defined`);
  return match[0];
}

test("booking migration owns the exact public and private lifecycle signatures", async () => {
  const sql = await migrationSql();
  const signatures = [
    ["enter_registration_observation_v1", "uuid, integer, text"],
    [
      "save_registration_observation_booking_v1",
      "uuid, uuid, uuid, text, uuid, text, integer, integer, bigint, text",
    ],
    ["cancel_registration_observation_v1", "uuid, integer, bigint, text"],
    [
      "withdraw_registration_observation_v1",
      "uuid, text, text, uuid, integer, bigint, bigint, text, text",
    ],
  ];

  for (const [name, signature] of signatures) {
    const publicBlock = functionBlock(sql, "public", name);
    const privateBlock = functionBlock(sql, "dashboard_private", `${name}_impl`);
    assert.match(publicBlock, /returns\s+jsonb/i);
    assert.match(publicBlock, /security\s+invoker/i);
    assert.match(privateBlock, /returns\s+jsonb/i);
    assert.match(privateBlock, /security\s+definer/i);
    assert.match(privateBlock, /set\s+search_path\s*=\s*''/i);
    const escapedSignature = signature.replaceAll(", ", "\\s*,\\s*");
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${name}\\(${escapedSignature}\\)\\s+from public, anon, authenticated, service_role;[\\s\\S]*?grant execute on function public\\.${name}\\(${escapedSignature}\\)\\s+to authenticated;`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on function dashboard_private\\.${name}_impl\\(${escapedSignature}\\)\\s+from public, anon, authenticated, service_role;[\\s\\S]*?grant execute on function dashboard_private\\.${name}_impl\\(${escapedSignature}\\)\\s+to authenticated;`,
        "i",
      ),
    );
  }
});

test("every operation fingerprints all semantic inputs with SHA-256", async () => {
  const sql = await migrationSql();
  const fingerprintHelper = functionBlock(
    sql,
    "dashboard_private",
    "registration_observation_request_fingerprint_v1",
  );
  assert.match(
    fingerprintHelper,
    /dashboard_private\.continuous_class_schedule_hash_v1\s*\(/i,
  );
  const cases = [
    ["enter_registration_observation_v1_impl", "enter", [
      "p_track_id", "p_expected_workflow_revision",
    ]],
    ["save_registration_observation_booking_v1_impl", "book", [
      "p_track_id", "p_observation_id", "p_class_id", "p_session_authority",
      "p_class_lesson_session_id", "p_legacy_session_key",
      "p_expected_workflow_revision",
      "p_expected_appointment_notification_revision",
      "p_expected_observation_revision",
    ]],
    ["save_registration_observation_booking_v1_impl", "reschedule", [
      "p_track_id", "p_observation_id", "p_class_id", "p_session_authority",
      "p_class_lesson_session_id", "p_legacy_session_key",
      "p_expected_workflow_revision",
      "p_expected_appointment_notification_revision",
      "p_expected_observation_revision",
    ]],
    ["cancel_registration_observation_v1_impl", "cancel", [
      "p_observation_id", "p_expected_appointment_notification_revision",
      "p_expected_observation_revision",
    ]],
    ["withdraw_registration_observation_v1_impl", "withdraw", [
      "p_track_id", "p_exit_kind", "p_target_workflow_status",
      "p_decision_observation_id", "p_expected_workflow_revision",
      "p_expected_decision_observation_revision",
      "p_expected_decision_feedback_revision", "p_reason",
    ]],
  ];

  for (const [name, operation, semanticInputs] of cases) {
    const block = functionBlock(sql, "dashboard_private", name);
    assert.match(
      block,
      /dashboard_private\.registration_observation_request_fingerprint_v1\s*\(/i,
    );
    assert.match(block, new RegExp(`'operation'\\s*,\\s*'${operation}'`, "i"));
    for (const input of semanticInputs) assert.match(block, new RegExp(`\\b${input}\\b`));
  }
});

test("receipt replay precedes runtime and domain locks while writes keep canonical order", async () => {
  const sql = await migrationSql();
  for (const name of [
    "enter_registration_observation_v1_impl",
    "save_registration_observation_booking_v1_impl",
    "cancel_registration_observation_v1_impl",
    "withdraw_registration_observation_v1_impl",
  ]) {
    const block = functionBlock(sql, "dashboard_private", name).toLowerCase();
    const advisory = block.indexOf("pg_advisory_xact_lock");
    const receiptRead = block.indexOf("registration_observation_mutation_requests", advisory);
    const runtime = block.indexOf("assert_registration_observation_runtime_v1", receiptRead);
    const trackLock = block.indexOf("ops_registration_subject_tracks", runtime);
    assert.ok(advisory >= 0 && advisory < receiptRead, `${name}: advisory before receipt`);
    assert.ok(receiptRead < runtime, `${name}: replay before runtime guard`);
    assert.ok(runtime < trackLock, `${name}: runtime before track lock`);
  }

  for (const name of [
    "save_registration_observation_booking_v1_impl",
    "cancel_registration_observation_v1_impl",
  ]) {
    const block = functionBlock(sql, "dashboard_private", name).toLowerCase();
    const trackLock = block.indexOf("ops_registration_subject_tracks");
    const observationLock = block.indexOf("ops_registration_observations", trackLock);
    const appointmentLock = block.indexOf("ops_registration_appointments", observationLock);
    const eventWrite = block.lastIndexOf("insert into dashboard_private.registration_observation_domain_events");
    const auditWrite = block.lastIndexOf("write_registration_track_event_v2");
    const receiptWrite = block.lastIndexOf("insert into dashboard_private.registration_observation_mutation_requests");
    assert.ok(trackLock < observationLock, `${name}: track before observation`);
    assert.ok(observationLock < appointmentLock, `${name}: observation before appointment`);
    assert.ok(appointmentLock < eventWrite, `${name}: appointment before event`);
    assert.ok(eventWrite < auditWrite, `${name}: event before audit`);
    assert.ok(auditWrite < receiptWrite, `${name}: audit before receipt`);
  }
});

test("core booking emits only the closed lifecycle events and no provider or due rows", async () => {
  const sql = await migrationSql();
  for (const eventKind of [
    "observation_scheduled",
    "observation_rescheduled",
    "observation_canceled",
  ]) {
    assert.match(sql, new RegExp(`'${eventKind}'`, "i"));
  }
  assert.doesNotMatch(
    sql,
    /\b(?:reminder_due|feedback_due|solapi|google_chat|provider|notification_deliver(?:y|ies)|due_jobs|outbox)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+(?:insert|update|delete|all)[\s\S]{0,80}ops_registration_observations/i,
  );
});

test("generic workflow replacement preserves its contract and guards observation transitions", async () => {
  const sql = await migrationSql();
  const privateBlock = functionBlock(
    sql,
    "dashboard_private",
    "set_registration_workflow_status_v1_impl",
  );
  const publicBlock = functionBlock(sql, "public", "set_registration_workflow_status_v1");
  assert.match(privateBlock, /returns\s+jsonb/i);
  assert.match(privateBlock, /security\s+definer/i);
  assert.match(publicBlock, /returns\s+jsonb/i);
  assert.match(publicBlock, /security\s+invoker/i);
  assert.match(privateBlock, /registration_observation_transition_requires_action/i);
  assert.match(privateBlock, /decision_kind\s+is\s+null/i);
  assert.match(privateBlock, /scheduled[\s\S]*attended_feedback_pending[\s\S]*completed[\s\S]*no_show/i);
  assert.match(privateBlock, /consultation_completed/i);
  assert.match(privateBlock, /enrollment_requested/i);
  assert.match(
    sql,
    /revoke all on function public\.set_registration_workflow_status_v1\(uuid, text, integer, text\)[\s\S]*?grant execute on function public\.set_registration_workflow_status_v1\(uuid, text, integer, text\)\s+to authenticated;/i,
  );
});

test("booking pgTAP is planned exactly and covers lifecycle plus dblink concurrency", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  const planMatches = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(planMatches.length, 1);
  assert.equal(
    Number(planMatches[0][1]),
    [...sql.matchAll(READ_ASSERTION_PATTERN)].length,
  );
  for (const token of [
    "registration_observation_revision_combination_invalid",
    "registration_observation_request_key_conflict",
    "registration_observation_transition_requires_action",
    "observation_scheduled",
    "observation_rescheduled",
    "observation_canceled",
    "return_to_previous",
    "director_decision",
    "re_observation",
    "40001",
    "dblink_connect",
    "dblink_send_query",
    "dblink_get_result",
    "lock_timeout",
    "statement_timeout",
  ]) {
    assert.match(sql, new RegExp(token, "i"));
  }
  assert.match(
    sql,
    /dblink_connect\([^\n]+hostaddr=[^\n]+host\([^\n]+inet_server_addr\(\)\)[^\n]+port=5432 dbname=[^\n]+user=postgres password=postgres/i,
  );
  assert.ok(
    sql.indexOf("select dblink_connect")
      < sql.indexOf("create trigger registration_observation_fail_event"),
  );
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
  assert.doesNotMatch(sql, /select\s+\*\s+from\s+finish\s*\(/i);
});
