import test from "node:test";
import assert from "node:assert/strict";

import { E2EMockDataService } from "../src/testing/e2e/mockDataService.js";

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test("E2EMockDataService restores preferences and progress logs from storage", async () => {
  const storage = createMemoryStorage();
  const firstService = new E2EMockDataService({ storage });

  await firstService.setAppPreference("workspace:class-schedule:view", {
    view: "table",
    filters: { teacher: "Lee Teacher" },
  });

  await firstService.upsertSessionProgressLog({
    classId: "class-3",
    textbookId: "textbook-1",
    sessionId: "session-2",
    sessionOrder: 2,
    progressKey: "class-3:session-2:textbook-1",
    status: "done",
    rangeLabel: "Lesson 2",
    publicNote: "Restored after reload",
  });

  const reloadedService = new E2EMockDataService({ storage });
  const restoredPreference = await reloadedService.getAppPreference("workspace:class-schedule:view");

  assert.equal(restoredPreference?.value?.view, "table");
  assert.equal(restoredPreference?.value?.filters?.teacher, "Lee Teacher");

  const restoredLog = reloadedService.state.progressLogs.find(
    (item) => item.progressKey === "class-3:session-2:textbook-1",
  );

  assert.equal(restoredLog?.publicNote, "Restored after reload");
  assert.equal(restoredLog?.rangeLabel, "Lesson 2");
});
