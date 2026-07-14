import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`));
  assert.ok(name, `missing ${suffix} migration`);
  return readFile(new URL(name, migrationsUrl), "utf8");
}

test("textbook taxonomy migration adds, backfills, and constrains arrays", async () => {
  const sql = await readMigration("textbook_taxonomy_arrays");
  assert.match(sql, /add column if not exists school_levels text\[\]/i);
  assert.match(sql, /add column if not exists grade_levels text\[\]/i);
  assert.match(sql, /textbook_taxonomy_backfill/i);
  assert.match(sql, /array\['elementary', 'middle', 'high'\]::text\[\]/i);
  assert.match(sql, /array\['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3'\]::text\[\]/i);
  assert.match(sql, /textbooks_school_levels_required/i);
  assert.match(sql, /textbooks_grade_levels_required/i);
  assert.match(sql, /textbooks_grade_school_consistency/i);
  assert.match(sql, /textbooks_school_grade_coverage/i);
  assert.match(sql, /insert into public\.textbook_sub_subject_settings/i);
  assert.match(sql, /'english', '기타'/i);
  assert.match(sql, /'math', '기타'/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});

test("registration runtime textbook fixtures satisfy required taxonomy", async () => {
  const source = await readFile(new URL("../supabase/tests/registration_subject_tracks_runtime_test.sql", import.meta.url), "utf8");
  assert.match(source, /insert into public\.textbooks\([\s\S]*school_levels[\s\S]*grade_levels[\s\S]*sub_subject/i);
  assert.match(source, /array\['middle'\]::text\[\][\s\S]*array\['m1', 'm2', 'm3'\]::text\[\]/i);
});
