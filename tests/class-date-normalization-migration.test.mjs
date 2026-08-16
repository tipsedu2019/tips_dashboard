import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260816133708_normalize_class_dates.sql", import.meta.url);
const manifestUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url);

test("class date migration only normalizes the four approved legacy values", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const mappings = [
    ["2024년 01월 31일", "2024-01-31"],
    ["20260101", "2026-01-01"],
    ["20260102", "2026-01-02"],
    ["20260301", "2026-03-01"],
  ];

  for (const [legacy, canonical] of mappings) {
    assert.match(sql, new RegExp(`when '${legacy}' then '${canonical}'`));
  }
  assert.match(sql, /where start_date in \('2024년 01월 31일', '20260101', '20260102', '20260301'\)/);
  assert.doesNotMatch(sql, /update public\.classes\s+set start_date[^;]+where start_date ~ /s);
});

test("class date migration aborts partial production datasets and verifies every remaining date", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /v_target_count > 0/);
  assert.match(sql, /v_localized_count <> 2/);
  assert.match(sql, /v_compact_20260101_count <> 47/);
  assert.match(sql, /v_compact_20260102_count <> 1/);
  assert.match(sql, /v_compact_20260301_count <> 2/);
  assert.match(sql, /v_target_count <> 52/);
  assert.match(sql, /v_updated_count <> v_target_count/);
  assert.match(sql, /not dashboard_private\.is_canonical_class_date_v1\(class\.start_date\)/);
  assert.match(sql, /not dashboard_private\.is_canonical_class_date_v1\(class\.end_date\)/);
  assert.match(sql, /constraint classes_start_date_canonical_check/);
  assert.match(sql, /constraint classes_end_date_canonical_check/);
  assert.ok(
    sql.indexOf("set constraints class_active_group_membership_required_on_classes immediate")
      < sql.indexOf("alter table public.classes"),
    "deferred class trigger events are drained before ALTER TABLE",
  );
});

test("final isolated migration manifest pins the exact migration bytes", async () => {
  const [migration, manifestSource] = await Promise.all([
    readFile(migrationUrl),
    readFile(manifestUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const entry = manifest.orderedNewMigrations.find(
    ({ fileName }) => fileName === "20260816133708_normalize_class_dates.sql",
  );

  assert.deepEqual(entry, {
    fileName: "20260816133708_normalize_class_dates.sql",
    status: "final",
    sha256: createHash("sha256").update(migration).digest("hex"),
  });
});
