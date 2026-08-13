import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260813014603_registration_observation_teacher_subject_aliases.sql",
);

test("observation teacher catalog matching accepts canonical team aliases without widening visibility", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /^begin;\s+set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '120s';/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /\b(?:solapi|google_chat|provider|outbox|webhook)\b/i);

  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+dashboard_private\.registration_observation_teacher_subject_matches_v1\s*\(\s*p_track_subject\s+text\s*,\s*p_teacher_subjects\s+text\[\]\s*\)/i,
  );
  for (const aliases of [
    ["영어", "영어팀"],
    ["수학", "수학팀"],
    ["과학", "과학팀"],
  ]) {
    for (const alias of aliases) {
      assert.match(sql, new RegExp(`'${alias}'`));
    }
  }
  assert.match(sql, /pg_catalog\.cardinality\(p_teacher_subjects\)\s*=\s*0/i);

  for (const [signature, expectedOccurrences] of [
    [
      "dashboard_private.assert_registration_observation_current_session_v1(uuid,text)",
      3,
    ],
    [
      "dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)",
      1,
    ],
    [
      "dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)",
      3,
    ],
  ]) {
    assert.match(sql, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(
      sql,
      new RegExp(`'expected_occurrences'\\s*,\\s*${expectedOccurrences}`),
    );
  }

  assert.match(
    sql,
    /dashboard_private\.registration_observation_teacher_subject_matches_v1\s*\(\s*v_track\.subject\s*,\s*teacher\.subjects\s*\)/i,
  );
  assert.match(sql, /pg_catalog\.pg_get_functiondef/i);
  assert.match(sql, /registration_observation_teacher_subject_dependency_drift/i);
  assert.match(
    sql,
    /revoke all on function dashboard_private\.registration_observation_teacher_subject_matches_v1\(text, text\[\]\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(sql, /grant execute[\s\S]*registration_observation_teacher_subject_matches_v1/i);
});
