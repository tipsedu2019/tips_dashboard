import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260819101957_backfill_legacy_active_class_periods.sql",
  import.meta.url,
);

test("legacy active classes are normalized and connected to the dynamic default period", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /where class_row\.status in \('개강', '수업 진행 중'\)/);
  assert.match(sql, /set status = '수강'/);
  assert.match(sql, /from public\.class_schedule_sync_groups as group_row/);
  assert.match(sql, /group_row\.is_default desc/);
  assert.match(sql, /insert into public\.class_schedule_sync_group_members/);
  assert.match(sql, /where class_row\.status = '수강'[\s\S]*?not exists \([\s\S]*?member\.class_id = class_row\.id/s);
  assert.match(sql, /on conflict \(group_id, class_id\) do nothing/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("backfill fails atomically if an active class would remain without a period", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /class_period_backfill_default_group_missing/);
  assert.match(sql, /class_period_backfill_incomplete/);
  assert.match(sql, /set constraints class_active_group_membership_required_on_classes immediate/);
  assert.match(sql, /set constraints class_active_group_membership_required_on_members immediate/);
  assert.match(sql, /begin;[\s\S]*commit;/);
});
