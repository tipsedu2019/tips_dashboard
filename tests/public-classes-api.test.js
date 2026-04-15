import test from "node:test";
import assert from "node:assert/strict";

import { createPublicClassesApiResponder } from "../src/server/publicClassesApi.js";

test("public classes API responder returns 200 for live supabase payloads", async () => {
  const respond = createPublicClassesApiResponder(async () => ({
    source: "supabase",
    classes: [{ id: "live-class" }],
    textbooks: [],
    progressLogs: [],
  }));

  const result = await respond();

  assert.equal(result.status, 200);
  assert.equal(result.headers["Content-Type"], "application/json; charset=utf-8");
  assert.match(result.headers["Cache-Control"], /s-maxage=60/);
  assert.deepEqual(JSON.parse(result.body).classes, [{ id: "live-class" }]);
});

test("public classes API responder returns 503 for fallback payloads", async () => {
  const respond = createPublicClassesApiResponder(async () => ({
    source: "fallback-empty",
    reason: "missing env",
    classes: [],
    textbooks: [],
    progressLogs: [],
  }));

  const result = await respond();

  assert.equal(result.status, 503);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(result.body).reason, "missing env");
});
