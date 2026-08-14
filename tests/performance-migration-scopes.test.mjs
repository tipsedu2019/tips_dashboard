import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectPerformanceMigrationScope } from "../scripts/verify-performance-migration-scopes.mjs";
const manifest = JSON.parse(await readFile(new URL("../docs/operations/free-tier-performance-migration-scopes.json", import.meta.url), "utf8"));
test("performance scopes require literal evidence-backed tables and cap DDL", () => {
  assert.deepEqual(inspectPerformanceMigrationScope({ file: "supabase/migrations/20260814115116_dashboard_audit_diff_format.sql", source: "create index x on public.dashboard_audit_logs(id); create policy p on public.dashboard_audit_logs for select using (true);", manifest }), []);
  const bad = inspectPerformanceMigrationScope({ file: "supabase/migrations/20990101010101_unapproved.sql", source: "create index x on public.profiles(id);", manifest });
  assert.equal(bad[0].reason, "performance_index_manifest_required");
});
