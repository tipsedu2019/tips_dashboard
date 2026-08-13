import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeModule = await import("../src/features/dashboard/server/statistics-route.ts");

test("aggregate statistics route rejects assistant and viewer roles before cache access", async () => {
  const source = await readFile(
    new URL("../src/features/dashboard/server/statistics-route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /\["admin", "staff", "teacher"\]\.includes\(context\.role\)/);
  assert.match(source, /dashboard_statistics_forbidden/);
});

test("aggregate statistics handler rejects assistant before it claims a cache entry", async () => {
  let claims = 0;
  let calculations = 0;
  const handler = routeModule.createDashboardStatisticsRouteHandler({
    authenticate: async () => ({ actorProfileId: "assistant-id", role: "assistant", actorClient: {} }),
    cache: {
      claim: async () => { claims += 1; return { status: "wait", generation: 1, leaseExpiresAt: "" }; },
      read: async () => ({ status: "miss" }),
      finalize: async () => ({ status: "superseded" }),
      invalidate: async () => ({ status: "stale" }),
    },
    calculate: async () => { calculations += 1; return {}; },
  });

  const response = await handler(new Request("http://localhost/api/dashboard/statistics?tab=overview"));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "dashboard_statistics_forbidden" });
  assert.equal(claims, 0);
  assert.equal(calculations, 0);
});
