import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

function functionBlock(source, functionName) {
  const start = source.toLowerCase().indexOf(
    `create or replace function ${functionName.toLowerCase()}(`,
  );
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${functionName}`);
  return source.slice(start, end + 4);
}

test("generation treats an existing backfilled session date as occupied", async () => {
  const files = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith("_continuous_class_schedule_generation_dedupe.sql"));

  assert.equal(files.length, 1, "one generated session dedupe migration is required");

  const migration = await readFile(new URL(`../supabase/migrations/${files[0]}`, import.meta.url), "utf8");
  const candidates = functionBlock(
    migration,
    "dashboard_private.continuous_class_schedule_generation_candidates_v1",
  );

  assert.match(candidates, /x\.class_id\s*=\s*p_class_id/);
  assert.match(candidates, /x\.session_date\s*=\s*d\.day/);
  assert.match(candidates, /x\.origin\s*=\s*'legacy'/);
  assert.match(candidates, /session_key\s*=\s*'default:'\s*\|\|\s*s\.id::text/);
});
