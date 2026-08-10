import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_feedback_submit_test.sql",
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
    /insert into public\.ops_registration_enrollments|payment/,
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
