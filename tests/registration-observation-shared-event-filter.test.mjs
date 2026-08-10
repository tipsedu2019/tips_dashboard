import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809102200_registration_observation_shared_event_filter.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_shared_event_filter_test.sql",
);
const functionSignature =
  "public.registration_task_event_shared_visible(public.ops_task_events)";

const READ_ASSERTION_PATTERN =
  /^select\s+(?:function_privs_are|function_returns|has_function|hasnt_column|is|is_empty|ok|results_eq)\s*\(/gim;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("shared history visibility is one unnamed row-composite invoker computed field", async () => {
  const sql = await migrationSql();
  const escapedSignature = escapeRegExp(functionSignature);
  const definition = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escapedSignature}\\s+returns\\s+boolean[\\s\\S]*?\\$\\$;`,
      "i",
    ),
  )?.[0];

  assert.ok(definition, `missing computed field: ${functionSignature}`);
  assert.match(definition, /\bstable\b/i);
  assert.match(definition, /security\s+invoker/i);
  assert.doesNotMatch(definition, /security\s+definer/i);
  assert.match(definition, /set\s+search_path\s*=\s*''/i);
  assert.equal(
    [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.registration_task_event_shared_visible\s*\(/gi)].length,
    1,
  );
});

test("shared visibility ACL serves authenticated and service role without replacing task-event RLS", async () => {
  const sql = await migrationSql();
  const escapedSignature = escapeRegExp(functionSignature);

  assert.match(
    sql,
    new RegExp(`alter\\s+function\\s+${escapedSignature}\\s+owner\\s+to\\s+postgres`, "i"),
  );
  assert.match(
    sql,
    new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${escapedSignature}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
      "i",
    ),
  );
  const grantTargets = [...sql.matchAll(new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+${escapedSignature}\\s+to\\s+([^;]+);`,
    "gi",
  ))].flatMap((match) => match[1].split(",").map((role) => role.trim().toLowerCase()));
  assert.deepEqual([...new Set(grantTargets)].sort(), ["authenticated", "service_role"]);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?view\b/i);
  assert.doesNotMatch(sql, /(?:create|alter|drop)\s+policy\b/i);
  assert.doesNotMatch(
    sql,
    /alter\s+table\s+public\.ops_task_events[\s\S]*?(?:disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security)/i,
  );
});

test("workspace pgTAP uses one literal plan matching every executable assertion", async () => {
  const sql = await readFile(pgTapPath, "utf8");
  const planMatches = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(planMatches.length, 1);
  assert.equal(
    Number(planMatches[0][1]),
    [...sql.matchAll(READ_ASSERTION_PATTERN)].length,
  );
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
});
