import assert from "node:assert/strict";
import test from "node:test";

import * as publicClassesCacheInvalidation from "../src/server/public-classes-cache-invalidation.js";
import { requestPublicClassesCacheInvalidation } from "../src/lib/public-classes-cache-invalidation.js";

const {
  PUBLIC_CLASSES_SUMMARY_CACHE_TAG,
  createPublicClassesCacheInvalidationResponder,
} = publicClassesCacheInvalidation;

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

test("public classes cache invalidation accepts only authorized reason-only requests and revalidates each target once", async () => {
  const calls = [];
  const respond = createPublicClassesCacheInvalidationResponder({
    authenticate: async () => ({ role: "staff" }),
    revalidateTag(tag, profile) {
      calls.push(["tag", tag, profile]);
    },
    revalidatePath(path) {
      calls.push(["path", path]);
    },
  });

  const response = await respond({ reason: "schedule", requestId: REQUEST_ID });
  assert.deepEqual(response, { status: 200, body: { ok: true, requestId: REQUEST_ID } });
  assert.deepEqual(calls, [
    ["tag", PUBLIC_CLASSES_SUMMARY_CACHE_TAG, "max"],
    ["tag", "public-classes-full-v1", "max"],
    ["path", "/api/public-classes"],
  ]);
});

test("public classes cache invalidation rejects unauthenticated, unauthorized, malformed, and PII-shaped payloads", async () => {
  let calls = 0;
  const respond = createPublicClassesCacheInvalidationResponder({
    authenticate: async () => ({ role: "teacher" }),
    revalidateTag() { calls += 1; },
    revalidatePath() { calls += 1; },
  });

  for (const request of [
    { reason: "unknown", requestId: REQUEST_ID },
    { reason: "class", requestId: "not-a-uuid" },
    { reason: "class", requestId: REQUEST_ID, record: { name: "학생" } },
  ]) {
    const response = await respond(request);
    assert.equal(response.status, 400);
  }
  assert.equal((await respond({ reason: "class", requestId: REQUEST_ID })).status, 403);
  assert.equal(calls, 0);
});

test("a cache refresh delivery failure is nonfatal and remains visible as pending", async () => {
  const result = await requestPublicClassesCacheInvalidation({
    reason: "textbook",
    requestId: REQUEST_ID,
    fetcher: async () => { throw new Error("network unavailable"); },
  });
  assert.deepEqual(result, { status: "pending", reason: "textbook", requestId: REQUEST_ID });
});

test("a hung cache refresh is aborted and returns a pending receipt", { timeout: 100 }, async () => {
  let signal;
  const result = await requestPublicClassesCacheInvalidation({
    reason: "class",
    requestId: REQUEST_ID,
    timeoutMs: 5,
    fetcher: async (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });

  assert.deepEqual(result, { status: "pending", reason: "class", requestId: REQUEST_ID });
  assert.equal(signal?.aborted, true);
});

test("a hung cache refresh body shares the fetch deadline and returns pending", { timeout: 100 }, async () => {
  let signal;
  const result = await requestPublicClassesCacheInvalidation({
    reason: "class",
    requestId: REQUEST_ID,
    timeoutMs: 5,
    fetcher: async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise(() => {}) };
    },
  });

  assert.deepEqual(result, { status: "pending", reason: "class", requestId: REQUEST_ID });
  assert.equal(signal?.aborted, true);
});
