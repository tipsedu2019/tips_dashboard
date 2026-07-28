import assert from "node:assert/strict";
import test from "node:test";

import {
  loadContinuousScheduleShadowEvidence,
} from "../src/features/academic/continuous-class-schedule-service.ts";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";

function legacyInput() {
  return {
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [{
      day: "화",
      startTime: "14:00",
      endTime: "15:30",
      teacher: "",
      classroom: "",
    }],
    schedulePlan: {
      sessions: [{
        id: "session-1",
        date: "2026-04-03",
        state: "active",
      }],
    },
  };
}

function createReader(overrides = {}) {
  return {
    async readClassMode() {
      return { schedule_storage_mode: "shadow" };
    },
    async readSlots() {
      return [{
        class_id: CLASS_ID,
        weekday: 2,
        start_time: "14:00:00",
        end_time: "15:30:00",
      }];
    },
    async readSessions() {
      return [{
        class_id: CLASS_ID,
        session_key: "session-1",
        session_date: "2026-04-03",
        schedule_state: "active",
      }];
    },
    ...overrides,
  };
}

test("legacy runtime performs zero shadow reads", async () => {
  const calls = [];
  const reader = createReader({
    async readClassMode() {
      calls.push("class");
      return { schedule_storage_mode: "shadow" };
    },
  });

  const evidence = await loadContinuousScheduleShadowEvidence({
    reader,
    runtimeState: { mode: "legacy", version: 0 },
    legacyInput: legacyInput(),
  });

  assert.deepEqual(evidence, {
    authoritativeSource: "legacy",
    runtimeMode: "legacy",
    storageMode: "legacy",
    shadow: null,
    evidenceIssueCodes: [],
  });
  assert.deepEqual(calls, []);
});

test("shadow runtime stops after a legacy storage-mode read", async () => {
  const calls = [];
  const reader = createReader({
    async readClassMode(classId) {
      calls.push(`class:${classId}`);
      return { id: classId, schedule_storage_mode: "legacy" };
    },
    async readSlots() {
      calls.push("slots");
      return [];
    },
    async readSessions() {
      calls.push("sessions");
      return [];
    },
  });

  const evidence = await loadContinuousScheduleShadowEvidence({
    reader,
    runtimeState: { mode: "shadow", version: 0 },
    legacyInput: legacyInput(),
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.equal(evidence.storageMode, "legacy");
  assert.equal(evidence.shadow, null);
  assert.deepEqual(calls, [`class:${CLASS_ID}`]);
});

test("shadow mode compares exact-class rows but keeps legacy authoritative", async () => {
  const calls = [];
  const reader = {
    async readClassMode(classId) {
      calls.push(`class:${classId}`);
      return { id: classId, schedule_storage_mode: "shadow" };
    },
    async readSlots(classId) {
      calls.push(`slots:${classId}`);
      return [{
        class_id: classId,
        weekday: 2,
        start_time: "14:00:00",
        end_time: "15:30:00",
      }];
    },
    async readSessions(classId) {
      calls.push(`sessions:${classId}`);
      return [{
        class_id: classId,
        session_key: "session-1",
        session_date: "2026-04-03",
        schedule_state: "active",
      }];
    },
  };

  const evidence = await loadContinuousScheduleShadowEvidence({
    reader,
    runtimeState: { mode: "shadow", version: 0 },
    legacyInput: legacyInput(),
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.equal(evidence.shadow?.comparison.matches, true);
  assert.deepEqual(calls, [
    `class:${CLASS_ID}`,
    `slots:${CLASS_ID}`,
    `sessions:${CLASS_ID}`,
  ]);
});

test("normalized storage below global readiness stays legacy-authoritative", async () => {
  const evidence = await loadContinuousScheduleShadowEvidence({
    reader: createReader({
      async readClassMode() {
        return { schedule_storage_mode: "normalized" };
      },
    }),
    runtimeState: { mode: "shadow", version: 0 },
    legacyInput: legacyInput(),
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.equal(evidence.storageMode, "normalized");
  assert.deepEqual(evidence.evidenceIssueCodes, ["mode_not_ready"]);
});

test("ready normalized storage still has no release-1 cutover", async () => {
  const evidence = await loadContinuousScheduleShadowEvidence({
    reader: createReader({
      async readClassMode() {
        return { schedule_storage_mode: "normalized" };
      },
    }),
    runtimeState: { mode: "ready", version: 1 },
    legacyInput: legacyInput(),
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.deepEqual(evidence.evidenceIssueCodes, ["normalized_cutover_not_enabled"]);
});

test("shadow read errors become evidence instead of replacing the legacy plan", async () => {
  const evidence = await loadContinuousScheduleShadowEvidence({
    reader: createReader({
      async readSlots() {
        throw new Error("read failed");
      },
    }),
    runtimeState: { mode: "shadow", version: 0 },
    legacyInput: legacyInput(),
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.equal(evidence.shadow, null);
  assert.deepEqual(evidence.evidenceIssueCodes, ["shadow_read_failed"]);
});

test("a blank class ID rejects before the reader is called", async () => {
  const reader = createReader({
    async readClassMode() {
      throw new Error("reader must not be called");
    },
  });

  await assert.rejects(
    loadContinuousScheduleShadowEvidence({
      reader,
      runtimeState: { mode: "shadow", version: 0 },
      legacyInput: { ...legacyInput(), classId: " " },
    }),
    /class id is required/i,
  );
});
