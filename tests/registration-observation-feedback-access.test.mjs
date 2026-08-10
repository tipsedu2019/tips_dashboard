import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809102500_registration_observation_feedback_access.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_feedback_access_test.sql",
);

const READ_ASSERTION_PATTERN =
  /^select\s+(?:function_returns|is|ok|throws_ok)\s*\(/gim;

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

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("feedback read exposes one observation and no contact fields", async () => {
  const sql = normalizeSql(await migrationSql());
  assert.match(
    sql,
    /create function public\.get_registration_observation_feedback_v1\(p_observation_id uuid\)/i,
  );
  assert.match(
    sql,
    /studentName[\s\S]*?studentGrade[\s\S]*?subject[\s\S]*?className[\s\S]*?sessionAuthority[\s\S]*?sessionDate[\s\S]*?sourceRevision/,
  );
  assert.doesNotMatch(
    sql,
    /parent_phone|student_phone|school_name|inquiry_note|request_note/i,
  );
  assert.match(sql, /registration_observation_not_found/i);
  assert.match(
    sql,
    /revoke all on function public\.get_registration_observation_feedback_v1\(uuid\)/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_registration_observation_feedback_v1\(uuid\) to authenticated/i,
  );
});

test("feedback projection keeps the exact bounded DTO and both session-source branches", async () => {
  const sql = await migrationSql();
  const implementation = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_feedback_impl_v1",
  );
  const keys = [
    "observationId", "taskId", "trackId", "appointmentId", "studentName",
    "studentGrade", "subject", "classId", "className", "sessionAuthority",
    "sessionDate", "sessionKey", "classLessonSessionId", "legacySessionKey",
    "sourceRevision", "startsAt", "endsAt", "classroomName", "teacherName",
    "status", "attendance", "suitabilityResult", "feedbackReason",
    "proxySubmitted", "feedbackSubmittedByName", "feedbackSubmittedAt",
    "revision", "feedbackRevision", "appointmentNotificationRevision",
    "trackWorkflowRevision", "decisionKind",
  ];
  for (const key of keys) assert.match(implementation, new RegExp(`'${key}'`));
  assert.match(
    implementation,
    /case\s+when\s+observation\.session_authority\s*=\s*'normalized'[\s\S]*lesson\.session_key[\s\S]*else\s+observation\.legacy_session_key/i,
  );
  assert.match(
    implementation,
    /observation\.feedback_submitted_by\s*<>\s*observation\.teacher_profile_id/i,
  );
  assert.match(implementation, /feedback_submitter\.name/i);
  assert.doesNotMatch(
    implementation,
    /jsonb_agg|array_agg|limit\s+(?:[2-9]|[1-9][0-9]+)|ops_registration_subject_track_summaries/i,
  );
});

test("feedback access rechecks an active actor before exact row authorization", async () => {
  const sql = await migrationSql();
  const access = functionDefinition(
    sql,
    "dashboard_private.assert_registration_observation_feedback_access_v1",
  );
  const implementation = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_feedback_impl_v1",
  );

  assert.match(access, /p_observation_id\s+uuid[\s\S]*p_access_kind\s+text/i);
  assert.match(access, /\(select auth\.uid\(\)\)/i);
  assert.match(access, /account\.deleted_at\s+is\s+null/i);
  assert.match(access, /account\.banned_until[\s\S]*pg_catalog\.now\(\)/i);
  assert.match(access, /actor\.role\s+in\s*\(\s*'admin'\s*,\s*'staff'\s*\)/i);
  assert.match(access, /actor\.id\s*=\s*observation\.teacher_profile_id/i);
  assert.match(access, /actor\.id\s*=\s*track\.director_profile_id/i);
  assert.match(access, /raise exception 'registration_observation_not_found'[\s\S]*errcode\s*=\s*'P0002'/i);

  const activeCheck = implementation.indexOf("v_actor is null");
  const helperCall = implementation.indexOf(
    "dashboard_private.assert_registration_observation_feedback_access_v1",
  );
  assert.ok(activeCheck >= 0, "private read rejects a null actor");
  assert.ok(helperCall > activeCheck, "private read validates active actor before row access");
  assert.match(implementation, /public\.profiles\s+actor/i);
  assert.match(implementation, /auth\.users\s+account/i);
});

test("feedback read keeps a postgres-owned invoker to definer chain with exact ACLs", async () => {
  const sql = await migrationSql();
  const access = functionDefinition(
    sql,
    "dashboard_private.assert_registration_observation_feedback_access_v1",
  );
  const implementation = functionDefinition(
    sql,
    "dashboard_private.get_registration_observation_feedback_impl_v1",
  );
  const wrapper = functionDefinition(
    sql,
    "public.get_registration_observation_feedback_v1",
  );

  assert.match(access, /returns\s+jsonb/i);
  assert.match(access, /stable/i);
  assert.match(access, /security\s+definer/i);
  assert.match(access, /set\s+search_path\s*=\s*''/i);
  assert.match(implementation, /returns\s+jsonb/i);
  assert.match(implementation, /stable/i);
  assert.match(implementation, /security\s+definer/i);
  assert.match(implementation, /set\s+search_path\s*=\s*''/i);
  assert.match(wrapper, /returns\s+jsonb/i);
  assert.match(wrapper, /language\s+sql/i);
  assert.match(wrapper, /stable/i);
  assert.match(wrapper, /security\s+invoker/i);
  assert.match(wrapper, /set\s+search_path\s*=\s*''/i);
  assert.match(
    wrapper,
    /dashboard_private\.get_registration_observation_feedback_impl_v1\s*\(\s*p_observation_id\s*\)/i,
  );

  for (const signature of [
    "dashboard_private.assert_registration_observation_feedback_access_v1(uuid, text)",
    "dashboard_private.get_registration_observation_feedback_impl_v1(uuid)",
    "public.get_registration_observation_feedback_v1(uuid)",
  ]) {
    const escaped = escapeRegExp(signature).replace(/\\, /g, "\\s*,\\s*");
    assert.match(
      sql,
      new RegExp(`alter\\s+function\\s+${escaped}\\s+owner\\s+to\\s+postgres`, "i"),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+${escaped}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    sql,
    /grant execute on function dashboard_private\.assert_registration_observation_feedback_access_v1\(uuid\s*,\s*text\)/i,
  );
  for (const signature of [
    "dashboard_private.get_registration_observation_feedback_impl_v1(uuid)",
    "public.get_registration_observation_feedback_v1(uuid)",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${escapeRegExp(signature)}\\s+to\\s+authenticated`,
        "i",
      ),
    );
  }
});

test("feedback access pgTAP has one exact plan for actor privacy and projection behavior", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  const plans = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(plans.length, 1);
  assert.equal(
    Number(plans[0][1]),
    [...sql.matchAll(READ_ASSERTION_PATTERN)].length,
  );
  for (const token of [
    "assigned teacher", "active admin", "active staff", "track director",
    "unrelated teacher", "P0002", "normalized", "legacy", "proxySubmitted",
    "feedbackSubmittedByName", "feedbackSubmittedAt",
  ]) {
    assert.match(sql, new RegExp(token, "i"));
  }
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
  assert.doesNotMatch(sql, /select\s+\*\s+from\s+finish\s*\(/i);
});
