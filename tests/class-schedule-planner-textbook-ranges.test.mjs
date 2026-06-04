import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTextbookPlanRange,
  autoFillAllTextbookPlanRanges,
  autoFillTextbookPlanRanges,
  buildSchedulePlanForSave,
  getNextBillingPeriodMonth,
  normalizeSchedulePlan,
} from "../src/lib/class-schedule-planner.js";

function createPlan() {
  return {
    subject: "\uC218\uD559",
    className: "Math A",
    selectedDays: [5],
    billingPeriods: [
      {
        id: "2026-05",
        month: "2026-05",
        label: "May",
        startDate: "2026-05-01",
        endDate: "2026-05-15",
        color: "#216e4e",
      },
    ],
    textbooks: [
      {
        textbookId: "book-a",
        alias: "Book A",
        area: "math",
        subSubject: "common",
      },
    ],
    sessions: [],
  };
}

function createMultiTextbookPlan() {
  return {
    ...createPlan(),
    textbooks: [
      {
        textbookId: "book-a",
        alias: "Book A",
        area: "math",
        subSubject: "concept",
      },
      {
        textbookId: "book-b",
        alias: "Book B",
        area: "math",
        subSubject: "workbook",
      },
    ],
  };
}

test("textbook range edits materialize generated sessions before updating", () => {
  const updated = applyTextbookPlanRange(createPlan(), {}, {
    sessionId: "session:001:2026-05-01:2026-05:active",
    entryId: "book-a-0",
    range: {
      start: "1",
      end: "10",
      label: "Unit 1",
      memo: "core",
    },
  });

  const saved = buildSchedulePlanForSave(updated, {});
  assert.equal(saved.sessions.length, 3);
  assert.equal(saved.sessions[0].textbookEntries[0].plan.label, "Unit 1");
  assert.equal(saved.sessions[0].textbookEntries[0].plan.start, "1");
  assert.equal(saved.sessions[1].textbookEntries[0].plan.label, "");
});

test("textbook range autofill assigns presets from the selected session onward", () => {
  const updated = autoFillTextbookPlanRanges(createPlan(), {}, {
    startSessionId: "session:002:2026-05-08:2026-05:active",
    entryId: "book-a-0",
    ranges: [
      { start: "1", end: "10", label: "Unit 1" },
      { start: "11", end: "20", label: "Unit 2" },
    ],
  });

  const saved = buildSchedulePlanForSave(updated, {});
  assert.equal(saved.sessions[0].textbookEntries[0].plan.label, "");
  assert.equal(saved.sessions[1].textbookEntries[0].plan.label, "Unit 1");
  assert.equal(saved.sessions[2].textbookEntries[0].plan.label, "Unit 2");
});

test("textbook range autofill can assign every connected textbook at once", () => {
  const updated = autoFillAllTextbookPlanRanges(createMultiTextbookPlan(), {}, {
    startSessionId: "session:001:2026-05-01:2026-05:active",
    rangesByEntryId: {
      "book-a-0": [
        { start: "A1", end: "A1", label: "Main 1" },
        { start: "A2", end: "A2", label: "Main 2" },
      ],
      "book-b-1": [
        { start: "B1", end: "B1", label: "Workbook 1" },
        { start: "B2", end: "B2", label: "Workbook 2" },
      ],
    },
  });

  const saved = buildSchedulePlanForSave(updated, {});
  assert.equal(saved.sessions[0].textbookEntries[0].plan.label, "Main 1");
  assert.equal(saved.sessions[0].textbookEntries[1].plan.label, "Workbook 1");
  assert.equal(saved.sessions[1].textbookEntries[0].plan.label, "Main 2");
  assert.equal(saved.sessions[1].textbookEntries[1].plan.label, "Workbook 2");
});

test("textbook connection ranges limit generated session entries", () => {
  const rangedPlan = {
    ...createPlan(),
    textbooks: [
      {
        textbookId: "book-a",
        alias: "Book A",
        area: "math",
        subSubject: "common",
        startSessionId: "session:002:2026-05-08:2026-05:active",
        endSessionId: "session:003:2026-05-15:2026-05:active",
      },
    ],
  };

  const saved = buildSchedulePlanForSave(rangedPlan, {});

  assert.equal(saved.textbooks[0].startSessionId, "session:002:2026-05-08:2026-05:active");
  assert.equal(saved.textbooks[0].endSessionId, "session:003:2026-05-15:2026-05:active");
  assert.equal(saved.sessions.length, 3);
  assert.equal(saved.sessions[0].textbookEntries.length, 0);
  assert.equal(saved.sessions[1].textbookEntries[0].textbookId, "book-a");
  assert.equal(saved.sessions[2].textbookEntries[0].textbookId, "book-a");
});

test("textbook catalog keeps newly connected books alongside default class books", () => {
  const normalized = normalizeSchedulePlan(
    {
      ...createPlan(),
      textbooks: [
        {
          textbookId: "book-a",
          alias: "Default Book",
        },
        {
          textbookId: "book-b",
          alias: "New Book",
          area: "workbook",
          startSessionId: "session:002:2026-05-08:2026-05:active",
        },
      ],
    },
    {
      textbookIds: ["book-a"],
      textbooks: [
        { id: "book-a", title: "Default Book", category: "math" },
        { id: "book-b", title: "New Book", category: "workbook" },
      ],
    },
  );

  assert.deepEqual(
    normalized.textbooks.map((book) => book.textbookId),
    ["book-a", "book-b"],
  );
  assert.equal(normalized.textbooks[1].alias, "New Book");
  assert.equal(normalized.textbooks[1].startSessionId, "session:002:2026-05-08:2026-05:active");
});

test("textbook range presets stay attached to the textbook catalog", () => {
  const saved = buildSchedulePlanForSave(
    {
      ...createPlan(),
      textbooks: [
        {
          textbookId: "book-a",
          alias: "Book A",
          rangePresets: [
            { key: "u1", label: "Unit 1", start: "1", end: "10", memo: "core" },
            { key: "u1-copy", label: "Unit 1", start: "1", end: "10" },
            { key: "u2", label: "Unit 2", start: "11", end: "20" },
          ],
        },
      ],
    },
    {},
  );

  assert.deepEqual(
    saved.textbooks[0].rangePresets.map((preset) => preset.label),
    ["Unit 1", "Unit 2"],
  );
  assert.equal(saved.textbooks[0].rangePresets[0].memo, "core");
});

test("duplicate legacy billing period ids are made unique before session ids are generated", () => {
  const saved = buildSchedulePlanForSave(
    {
      subject: "math",
      className: "Duplicate period ids",
      selectedDays: [2],
      billingPeriods: [
        {
          id: "period-01-undated-open-1",
          month: "5",
          startDate: "2026-05-05",
          endDate: "2026-05-26",
        },
        {
          id: "period-01-undated-open-1",
          month: "5",
          startDate: "2026-05-05",
          endDate: "2026-05-26",
        },
      ],
      textbooks: [],
      sessions: [],
    },
    {},
  );

  assert.equal(new Set(saved.billingPeriods.map((period) => period.id)).size, saved.billingPeriods.length);
  assert.equal(new Set(saved.sessions.map((session) => session.id)).size, saved.sessions.length);
});

test("billing period months follow manual sequence instead of end date month", () => {
  const saved = buildSchedulePlanForSave(
    {
      subject: "english",
      className: "Cross month periods",
      selectedDays: [0, 3],
      billingPeriods: [
        {
          id: "period-may",
          month: 5,
          startDate: "2026-05-06",
          endDate: "2026-05-31",
        },
        {
          id: "period-june",
          month: getNextBillingPeriodMonth({ month: 5, endDate: "2026-05-31" }),
          startDate: "2026-05-27",
          endDate: "2026-07-01",
        },
      ],
      textbooks: [],
      sessions: [],
    },
    {},
  );

  assert.deepEqual(saved.billingPeriods.map((period) => period.month), [5, 6]);
  assert.deepEqual(saved.billingPeriods.map((period) => period.label), ["5월", "6월"]);
});
