import assert from "node:assert/strict";
import test from "node:test";

let withdrawalScheduleMetrics = {};
try {
  withdrawalScheduleMetrics = await import("../src/features/tasks/withdrawal-schedule-metrics.js");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const {
  getWithdrawalBillingCycleItems,
  getWithdrawalDateSelectionItem,
  getWithdrawalSessionNumber,
  isCountedWithdrawalScheduleState,
  normalizeWithdrawalScheduleSessions,
} = withdrawalScheduleMetrics;

function withLessonHours(items, lessonHours = 2) {
  return items.map((item) => ({ ...item, lessonHours }));
}

test("production-shaped withdrawal plan ignores skipped markers without inventing session numbers", () => {
  assert.equal(
    typeof normalizeWithdrawalScheduleSessions,
    "function",
    "withdrawal schedule metrics must normalize the raw schedule plan",
  );

  const schedulePlan = {
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-08-01",
      endDate: "2026-08-29",
      color: "#4f8e87",
    }],
    sessions: [
      ["session-01", "2026-08-01", "active", 1],
      ["session-02", "2026-08-04", "active", 2],
      ["session-03", "2026-08-06", "active", 3],
      ["session-04", "2026-08-07", "makeup", 4],
      ["session-skipped", "2026-08-07", "skipped", null],
      ["session-exception", "2026-08-08", "exception", null],
      ["session-05", "2026-08-11", "active", 5],
      ["session-06", "2026-08-13", "active", 6],
      ["session-07", "2026-08-18", "active", 7],
      ["session-08", "2026-08-20", "active", 8],
      ["session-09", "2026-08-22", "active", 9],
      ["session-10", "2026-08-25", "active", 10],
      ["session-11", "2026-08-27", "active", 11],
      ["session-12", "2026-08-29", "active", 12],
    ].map(([id, date, scheduleState, sessionNumber]) => ({
      id,
      date,
      scheduleState,
      sessionNumber,
    })),
  };
  const originalPlan = structuredClone(schedulePlan);

  const items = withLessonHours(normalizeWithdrawalScheduleSessions(schedulePlan));
  const selectedItem = getWithdrawalDateSelectionItem(items, "2026-08-29");
  const completedItems = getWithdrawalBillingCycleItems(items, selectedItem);

  assert.deepEqual(schedulePlan, originalPlan, "normalization must not mutate the saved schedule plan");
  assert.equal(items.find((item) => item.sessionId === "session-skipped")?.sessionNumber, 0);
  assert.deepEqual(
    completedItems.map((item) => item.sessionNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(
    completedItems.reduce((sum, item) => sum + item.lessonHours, 0),
    24,
  );
});

test("same-date normal and makeup sessions are preserved and the date selects the final counted session", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    }],
    sessions: [
      { id: "session-01", date: "2026-08-01", state: "active", sessionNumber: 1 },
      { id: "session-02", date: "2026-08-04", state: "active", sessionNumber: 2 },
      { id: "session-03", date: "2026-08-04", state: "makeup", sessionNumber: 3 },
    ],
  }));

  assert.deepEqual(items.map((item) => item.sessionId), ["session-01", "session-02", "session-03"]);
  const selectedItem = getWithdrawalDateSelectionItem(items, "2026-08-04");
  assert.equal(selectedItem?.sessionId, "session-03");
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, selectedItem).map((item) => item.sessionNumber),
    [1, 2, 3],
  );
});

test("billing period ranges restore missing session billing IDs across calendar months", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      startDate: "2026-07-30",
      endDate: "2026-08-29",
    }],
    sessions: [
      { id: "session-01", date: "2026-07-30", state: "active", sessionNumber: 1 },
      { id: "session-02", date: "2026-08-01", state: "active", sessionNumber: 2 },
    ],
  }));

  assert.deepEqual(items.map((item) => item.billingId), ["period-august-2026", "period-august-2026"]);
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items[1]).map((item) => item.dateKey),
    ["2026-07-30", "2026-08-01"],
  );
});

test("normalized legacy billing metadata keeps an out-of-range makeup in its original cycle", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    billingPeriods: [{
      id: "period-august-2026",
      label: "8월",
      color: "#3182f6",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    }],
    sessions: [
      {
        id: "normalized-01",
        session_date: "2026-08-01",
        schedule_state: "active",
        legacy_billing_id: "period-august-2026",
        legacy_billing_label: "8월",
        legacy_billing_color: "#3182f6",
      },
      {
        id: "normalized-02",
        session_date: "2026-08-08",
        schedule_state: "active",
        legacyBillingId: "period-august-2026",
        legacyBillingLabel: "8월",
        legacyBillingColor: "#3182f6",
      },
      {
        id: "normalized-makeup",
        session_date: "2026-09-05",
        schedule_state: "makeup",
        legacyBillingId: "period-august-2026",
        legacyBillingLabel: "8월",
        legacyBillingColor: "#3182f6",
      },
    ],
  }));

  assert.deepEqual(items.map((item) => item.billingId), [
    "period-august-2026",
    "period-august-2026",
    "period-august-2026",
  ]);
  assert.equal(items.at(-1)?.billingLabel, "8월");
  assert.equal(items.at(-1)?.billingColor, "#3182f6");
  assert.deepEqual(items.map((item) => item.sessionNumber), [0, 0, 0]);
  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items.at(-1)).map((item) => item.sessionId),
    ["normalized-01", "normalized-02", "normalized-makeup"],
  );
});

test("legacy billing labels use only the contiguous cycle around the selected item", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "august-2025-01", date: "2025-08-02", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "august-2025-12", date: "2025-08-30", state: "active", sessionNumber: 12, billingLabel: "8월" },
      { id: "august-2026-01", date: "2026-08-01", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "august-2026-12", date: "2026-08-29", state: "active", sessionNumber: 12, billingLabel: "8월" },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items.at(-1)).map((item) => item.sessionId),
    ["august-2026-01", "august-2026-12"],
  );
});

test("legacy labels and session-order fallback preserve a cycle that crosses a calendar month", () => {
  const labeledItems = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "labeled-01", date: "2026-07-30", state: "active", sessionNumber: 1, billingLabel: "8월" },
      { id: "labeled-02", date: "2026-08-01", state: "normal", sessionNumber: 2, billingLabel: "8월" },
    ],
  }));
  const metadataFreeItems = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "fallback-01", date: "2026-07-30", state: "active", sessionNumber: 1 },
      { id: "fallback-02", date: "2026-08-01", state: "active", sessionNumber: 2 },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(labeledItems, labeledItems[1]).map((item) => item.sessionId),
    ["labeled-01", "labeled-02"],
  );
  assert.deepEqual(
    getWithdrawalBillingCycleItems(metadataFreeItems, metadataFreeItems[1]).map((item) => item.sessionId),
    ["fallback-01", "fallback-02"],
  );
});

test("metadata-free missing-number fallback stays within the selected calendar month", () => {
  const items = withLessonHours(normalizeWithdrawalScheduleSessions({
    sessions: [
      { id: "july-unknown", date: "2026-07-30", state: "active", sessionNumber: null },
      { id: "august-unknown", date: "2026-08-01", state: "active", sessionNumber: null },
    ],
  }));

  assert.deepEqual(
    getWithdrawalBillingCycleItems(items, items[1]).map((item) => item.sessionId),
    ["august-unknown"],
  );
});

test("withdrawal state policy counts only active, normal, and makeup sessions", () => {
  assert.equal(typeof isCountedWithdrawalScheduleState, "function");
  for (const state of [undefined, "", "active", "normal", "makeup", " ACTIVE "]) {
    assert.equal(isCountedWithdrawalScheduleState(state), true, `${String(state)} should count`);
  }
  for (const state of ["skipped", "exception", "tbd", "canceled", "cancelled", "completed"]) {
    assert.equal(isCountedWithdrawalScheduleState(state), false, `${state} should not count`);
  }
});

test("withdrawal session numbers never fall back to schedule array positions", () => {
  assert.equal(
    typeof getWithdrawalSessionNumber,
    "function",
    "withdrawal schedule metrics must expose session-number normalization",
  );

  assert.equal(getWithdrawalSessionNumber({ sessionNumber: 12 }), 12);
  assert.equal(getWithdrawalSessionNumber({ session_number: "4" }), 4);
  assert.equal(getWithdrawalSessionNumber({ sessionNumber: null }), 0);
  assert.equal(getWithdrawalSessionNumber({}), 0);
});
