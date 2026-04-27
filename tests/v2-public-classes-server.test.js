import test from "node:test";
import assert from "node:assert/strict";

import {
  loadPublicClassesPagePayload,
} from "../v2/src/lib/public-classes-server.js";

test("v2 public classes loader keeps live supabase payloads", async () => {
  let snapshotReads = 0;

  const payload = await loadPublicClassesPagePayload(
    async () => ({
      source: "supabase",
      classes: [{ id: "live-class" }],
      textbooks: [],
      progressLogs: [],
    }),
    async () => {
      snapshotReads += 1;
      return {
        source: "snapshot",
        classes: [{ id: "snapshot-class" }],
        textbooks: [],
        progressLogs: [],
      };
    },
  );

  assert.equal(snapshotReads, 0);
  assert.equal(payload.source, "supabase");
  assert.deepEqual(payload.classes, [{ id: "live-class" }]);
});

test("v2 public classes loader falls back to snapshot when live payload is unavailable", async () => {
  const payload = await loadPublicClassesPagePayload(
    async () => ({
      source: "fallback-empty",
      classes: [],
      textbooks: [],
      progressLogs: [],
    }),
    async () => ({
      source: "snapshot",
      classes: [{ id: "snapshot-class" }],
      textbooks: [{ id: "book-1" }],
      progressLogs: [],
    }),
  );

  assert.equal(payload.source, "snapshot");
  assert.deepEqual(payload.classes, [{ id: "snapshot-class" }]);
  assert.deepEqual(payload.textbooks, [{ id: "book-1" }]);
});
