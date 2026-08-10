import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql",
);
const decisionsMigrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_feedback_submit_test.sql",
);
const decisionsPgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_feedback_decisions_test.sql",
);

const ASSERTION_PATTERN =
  /^select\s+(?:function_returns|is|ok|throws_ok|lives_ok|cmp_ok)\s*\(/gim;

function normalizeSql(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionDefinition(sql, qualifiedName) {
  const match = sql.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(qualifiedName)}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing function definition: ${qualifiedName}`);
  return match[0];
}

test("attendance and feedback require every approved revision", async () => {
  // Production break caught: either RPC drops an optimistic revision or writes
  // enrollment/payment facts while recording attendance or first feedback.
  const sql = normalizeSql(await readFile(migrationPath, "utf8"));
  for (const token of [
    "p_expected_observation_revision bigint",
    "p_expected_feedback_revision bigint",
    "p_expected_appointment_notification_revision integer",
  ]) assert.match(sql, new RegExp(token));
  assert.match(sql, /observation_attendance_recorded/);
  assert.match(sql, /observation_no_show|observation_feedback_submitted/);
  assert.doesNotMatch(
    sql,
    /(?:insert into|update|delete from) public\.(?:ops_registration_enrollments|ops_registration_admission_batches)|payment/,
  );
});

test("feedback mutations keep actor request locks before track observation appointment locks", async () => {
  // Production break caught: a privileged mutation bypasses auth/replay or
  // acquires lifecycle row locks in the deadlock-prone order.
  const sql = await readFile(migrationPath, "utf8");
  for (const name of [
    "dashboard_private.record_registration_observation_attendance_v1_impl",
    "dashboard_private.submit_registration_observation_feedback_v1_impl",
  ]) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /security\s+definer/i);
    assert.match(definition, /set\s+search_path\s*=\s*''/i);
    assert.match(definition, /registration_observation_active_actor_v1\s*\(/i);
    const advisoryLock = definition.indexOf("pg_advisory_xact_lock");
    const replayLookup = definition.indexOf(
      "registration_observation_mutation_requests",
    );
    const trackLock = definition.indexOf(
      "from public.ops_registration_subject_tracks",
    );
    const observationLock = definition.indexOf(
      "from public.ops_registration_observations",
      trackLock,
    );
    const appointmentLock = definition.indexOf(
      "from public.ops_registration_appointments",
      observationLock,
    );
    assert.ok(advisoryLock >= 0 && advisoryLock < replayLookup);
    assert.ok(replayLookup < trackLock);
    assert.ok(trackLock < observationLock);
    assert.ok(observationLock < appointmentLock);
    assert.match(definition, /registration_observation_request_key_conflict/i);
  }

  for (const name of [
    "public.record_registration_observation_attendance_v1",
    "public.submit_registration_observation_feedback_v1",
  ]) {
    const definition = functionDefinition(sql, name);
    assert.match(definition, /security\s+invoker/i);
    assert.match(definition, /set\s+search_path\s*=\s*''/i);
  }
  assert.doesNotMatch(
    sql,
    /grant\s+(?:insert|update|delete|all)\s+on\s+(?:table\s+)?(?:public\.ops_registration_observations|public\.ops_registration_appointments|public\.ops_registration_subject_tracks)/i,
  );
});

test("feedback time boundaries lock and compare the current normalized or legacy source", async () => {
  // Production break caught: attendance/no-show/feedback trusts the booking
  // snapshot after the source lesson moved, was canceled, or changed authority.
  const sql = await readFile(migrationPath, "utf8");
  const sourceDefinition = functionDefinition(
    sql,
    "dashboard_private.assert_registration_observation_current_session_v1",
  );
  assert.match(sourceDefinition, /security\s+definer/i);
  assert.match(sourceDefinition, /set\s+search_path\s*=\s*''/i);
  assert.match(
    sourceDefinition,
    /registration_observation_active_actor_v1\s*\(/i,
  );
  for (const token of [
    "public.classes",
    "public.class_lesson_sessions",
    "public.class_schedule_slots",
    "registration_observation_legacy_session_content_hash_v1",
    "session_source_revision",
    "legacy_session_source_hash",
    "source_revision",
    "for share",
  ]) assert.match(sourceDefinition, new RegExp(token, "i"));
  assert.match(
    sourceDefinition,
    /registration_observation_session_source_dirty/i,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+execute\s+on\s+function\s+dashboard_private\.assert_registration_observation_current_session_v1/i,
  );

  for (const name of [
    "dashboard_private.record_registration_observation_attendance_v1_impl",
    "dashboard_private.submit_registration_observation_feedback_v1_impl",
  ]) {
    const definition = functionDefinition(sql, name);
    const sourceCheck = definition.indexOf(
      "assert_registration_observation_current_session_v1",
    );
    const boundaryError = definition.indexOf(
      "registration_observation_time_boundary_rejected",
    );
    assert.ok(sourceCheck >= 0 && sourceCheck < boundaryError);
    assert.doesNotMatch(
      definition,
      /pg_catalog\.now\(\)\s*<\s*v_observation\.(?:starts_at|ends_at)/i,
    );
  }
});

test("feedback submit pgTAP owns lifecycle boundaries replay revisions proxy and race assertions", async () => {
  // Production break caught: real Postgres behavior loses a boundary, revision,
  // proxy attribution, atomic event, replay, or same-row race guarantee.
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  const plans = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(plans.length, 1);
  assert.equal(
    Number(plans[0][1]),
    [...sql.matchAll(ASSERTION_PATTERN)].length,
  );
  for (const token of [
    "before start",
    "before end",
    "stale observation",
    "stale feedback",
    "stale appointment",
    "assigned teacher",
    "unrelated teacher",
    "duplicate request replay",
    "request key conflict",
    "proxy",
    "observation_attendance_recorded",
    "observation_feedback_submitted",
    "observation_no_show",
    "dblink_send_query",
    "one concurrent submit succeeds",
  ]) assert.match(sql, new RegExp(token, "i"));
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
});

test("correction keeps decision access and feedback revision isolated", async () => {
  // Production break caught: correction becomes a second first-submit path,
  // lets a teacher edit after decision, or mutates lifecycle/notification facts.
  const sql = await readFile(decisionsMigrationPath, "utf8");
  const definition = functionDefinition(
    sql,
    "dashboard_private.correct_registration_observation_feedback_v1_impl",
  );
  for (const token of [
    "p_expected_observation_revision",
    "p_expected_feedback_revision",
    "p_expected_decision_kind",
    "p_correction_reason",
    "registration_observation_active_actor_v1",
    "registration_observation_mutation_requests",
    "correct_feedback",
    "feedback_revision = observation\\.feedback_revision \\+ 1",
    "registration_observation_feedback_corrected",
  ]) assert.match(definition, new RegExp(token, "i"));
  assert.match(definition, /security\s+definer/i);
  assert.match(definition, /set\s+search_path\s*=\s*''/i);
  assert.match(
    definition,
    /decision_kind\s+is\s+not\s+null[\s\S]*v_actor_role\s+not\s+in\s*\(\s*'admin'\s*,\s*'staff'\s*\)/i,
  );
  assert.doesNotMatch(
    definition,
    /(?:set|,)\s*(?:notification_revision|workflow_revision)\s*=|(?:set|,)\s*revision\s*=\s*observation\.revision\s*\+/i,
  );

  const wrapper = functionDefinition(
    sql,
    "public.correct_registration_observation_feedback_v1",
  );
  assert.match(wrapper, /security\s+invoker/i);
  assert.match(wrapper, /set\s+search_path\s*=\s*''/i);
});

test("director decision checks domain feedback and track revisions", async () => {
  // Production break caught: a teacher result auto-decides enrollment, a
  // decision ignores one concurrency domain, or it writes finance facts.
  const sql = await readFile(decisionsMigrationPath, "utf8");
  const definition = functionDefinition(
    sql,
    "dashboard_private.decide_registration_observation_v1_impl",
  );
  for (const token of [
    "p_expected_observation_revision",
    "p_expected_feedback_revision",
    "p_expected_track_workflow_revision",
    "registration_observation_active_actor_v1",
    "registration_observation_mutation_requests",
    "registration_observation_domain_events",
    "waiting_detail_class_id",
    "observation_return_workflow_status = null",
    "registration_observation_decided",
  ]) assert.match(definition, new RegExp(token, "i"));
  for (const mapping of [
    "enrollment_requested",
    "waiting_current_class",
    "waiting_new_class",
    "waiting_next_opening",
    "not_registered",
    "observation_requested",
  ]) assert.match(definition, new RegExp(mapping, "i"));
  assert.match(definition, /security\s+definer/i);
  assert.match(definition, /set\s+search_path\s*=\s*''/i);
  assert.doesNotMatch(
    definition,
    /(?:insert\s+into|update|delete\s+from)\s+public\.(?:ops_registration_enrollments|ops_registration_admission_batches|ops_registration_customer_messages)|payment/i,
  );

  const advisoryLock = definition.indexOf("pg_advisory_xact_lock");
  const replayLookup = definition.indexOf(
    "registration_observation_mutation_requests",
  );
  const trackLock = definition.indexOf(
    "from public.ops_registration_subject_tracks",
    replayLookup + 1,
  );
  const observationLock = definition.indexOf(
    "from public.ops_registration_observations",
    trackLock + 1,
  );
  const appointmentLock = definition.indexOf(
    "from public.ops_registration_appointments",
    observationLock + 1,
  );
  const eventLock = definition.indexOf(
    "from dashboard_private.registration_observation_domain_events",
    appointmentLock + 1,
  );
  const receiptWrite = definition.lastIndexOf(
    "insert into dashboard_private.registration_observation_mutation_requests",
  );
  assert.ok(advisoryLock >= 0 && advisoryLock < replayLookup);
  assert.ok(replayLookup < trackLock);
  assert.ok(trackLock < observationLock);
  assert.ok(observationLock < appointmentLock);
  assert.ok(appointmentLock < eventLock);
  assert.ok(eventLock < receiptWrite);

  const wrapper = functionDefinition(
    sql,
    "public.decide_registration_observation_v1",
  );
  assert.match(wrapper, /security\s+invoker/i);
  assert.match(wrapper, /set\s+search_path\s*=\s*''/i);
});

test("correction and director pgTAP own replay roles revisions mapping race and finance assertions", async () => {
  // Production break caught: the SQL contract exists but real Postgres loses
  // correction/decision authorization, replay, mapping, race, or finance zero.
  const sql = await readFile(decisionsPgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  const plans = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(plans.length, 1);
  assert.equal(
    Number(plans[0][1]),
    [...sql.matchAll(ASSERTION_PATTERN)].length,
  );
  for (const token of [
    "teacher correction before decision",
    "teacher correction after decision",
    "admin same-result reason correction",
    "stale feedback revision",
    "duplicate correction replay",
    "duplicate decision replay",
    "request key conflict",
    "waiting class subject mismatch",
    "re-observation active attempt",
    "notification revision unchanged",
    "financial state before",
    "dblink_send_query",
    "both decision workers overlap",
    "one concurrent decision succeeds",
    "registration_observation_provider_outbox_delta=0",
  ]) assert.match(sql, new RegExp(token, "i"));
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
});
