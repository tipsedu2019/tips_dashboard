import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("statistics drilldowns are action-only, bounded, and append without duplicate rows", async () => {
  const sourceText = await source("src/features/dashboard/statistics-drilldown.tsx");

  assert.match(sourceText, /STATISTICS_DRILLDOWN_PAGE_SIZE = 30/);
  assert.match(sourceText, /student-roster/);
  assert.match(sourceText, /class-group/);
  assert.match(sourceText, /class-roster/);
  assert.match(sourceText, /다음 30/);
  assert.match(sourceText, /new Map/);
  assert.match(sourceText, /fetch\("\/api\/dashboard\/statistics\/drilldown"/);
  assert.match(sourceText, /Authorization: `Bearer \$\{session\.access_token\}`/);
});

test("drilldown route validates bearer JWT and invokes only security-invoker roster RPCs", async () => {
  const route = await source("src/app/api/dashboard/statistics/drilldown/route.ts");

  assert.match(route, /Bearer/);
  assert.match(route, /auth\.getUser/);
  assert.match(route, /current_dashboard_role/);
  assert.match(route, /list_dashboard_statistics_student_roster_v1/);
  assert.match(route, /list_dashboard_statistics_class_group_v1/);
  assert.match(route, /list_dashboard_statistics_class_roster_v1/);
  assert.match(route, /p_limit: 30/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
});
