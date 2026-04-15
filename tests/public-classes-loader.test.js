import test from "node:test";
import assert from "node:assert/strict";

import { loadPublicClassesData } from "../src/public-classes/loadPublicClassesData.js";

function createJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("loadPublicClassesData prefers the live API payload when it succeeds", async () => {
  const fetchCalls = [];
  const livePayload = {
    classes: [{ id: "live-class" }],
    textbooks: [{ id: "live-book" }],
    progressLogs: [{ id: "live-log" }],
  };

  const result = await loadPublicClassesData({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      if (url === "/api/public-classes") {
        return createJsonResponse(livePayload);
      }

      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert.deepEqual(result, {
    isFallback: false,
    source: "/api/public-classes",
    ...livePayload,
  });
  assert.deepEqual(fetchCalls, ["/api/public-classes"]);
});

test("loadPublicClassesData falls back to the static payload when the API request fails", async () => {
  const fetchCalls = [];
  const fallbackPayload = {
    classes: [{ id: "static-class" }],
    textbooks: [{ id: "static-book" }],
    progressLogs: [{ id: "static-log" }],
  };

  const result = await loadPublicClassesData({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      if (url === "/api/public-classes") {
        throw new Error("network down");
      }
      if (url === "/data/public-classes.json") {
        return createJsonResponse(fallbackPayload);
      }

      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert.deepEqual(result, {
    isFallback: true,
    source: "/data/public-classes.json",
    ...fallbackPayload,
  });
  assert.deepEqual(fetchCalls, [
    "/api/public-classes",
    "/data/public-classes.json",
  ]);
});

test("loadPublicClassesData falls back when the API returns a non-success status", async () => {
  const fallbackPayload = {
    classes: [{ id: "fallback-class" }],
    textbooks: [],
    progressLogs: [],
  };

  const result = await loadPublicClassesData({
    fetchImpl: async (url) => {
      if (url === "/api/public-classes") {
        return createJsonResponse({ message: "unavailable" }, false, 503);
      }
      if (url === "/data/public-classes.json") {
        return createJsonResponse(fallbackPayload);
      }

      throw new Error(`unexpected fetch: ${url}`);
    },
  });

  assert.equal(result.isFallback, true);
  assert.equal(result.source, "/data/public-classes.json");
  assert.deepEqual(result.classes, fallbackPayload.classes);
});
