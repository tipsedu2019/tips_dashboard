import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionStepStateMap,
  hasSessionDetailContent,
} from "../src/lib/classPlanStepper.js";

const groupKey = (month) => `billing-${month}`;

const session = (date, sessionNumber) => ({
  date,
  sessionNumber,
});

test("marks exactly one active session globally across month groups", () => {
  const sessionGroups = [
    {
      key: groupKey("march"),
      sessions: [session("2026-03-03", 1), session("2026-03-10", 2)],
    },
    {
      key: groupKey("april"),
      sessions: [session("2026-04-07", 3), session("2026-04-14", 4)],
    },
  ];

  const { activeSessionKey, stepStates } = buildSessionStepStateMap(
    sessionGroups,
    new Date("2026-04-10T09:00:00+09:00"),
  );

  assert.equal(
    [...stepStates.values()].filter((state) => state === "active").length,
    1,
  );
  assert.equal(
    activeSessionKey,
    `${groupKey("april")}::2026-04-07::base::3`,
  );
  assert.equal(
    stepStates.get(`${groupKey("march")}::2026-03-03::base::1`),
    "done",
  );
  assert.equal(
    stepStates.get(`${groupKey("march")}::2026-03-10::base::2`),
    "done",
  );
  assert.equal(
    stepStates.get(`${groupKey("april")}::2026-04-07::base::3`),
    "active",
  );
  assert.equal(
    stepStates.get(`${groupKey("april")}::2026-04-14::base::4`),
    "pending",
  );
});

test("keeps every session pending when all scheduled dates are in the future", () => {
  const sessionGroups = [
    {
      key: groupKey("april"),
      sessions: [session("2026-04-21", 1), session("2026-04-28", 2)],
    },
  ];

  const { activeSessionKey, stepStates } = buildSessionStepStateMap(
    sessionGroups,
    new Date("2026-04-10T09:00:00+09:00"),
  );

  assert.equal(activeSessionKey, null);
  assert.deepEqual([...stepStates.values()], ["pending", "pending"]);
});

test("flags only memo or makeup-related sessions as detail rows", () => {
  assert.equal(hasSessionDetailContent({ memo: "숙제 체크" }), true);
  assert.equal(
    hasSessionDetailContent({
      state: "exception",
      makeupDate: "2026-04-18",
    }),
    true,
  );
  assert.equal(
    hasSessionDetailContent({
      state: "makeup",
      originalDate: "2026-04-11",
    }),
    true,
  );
  assert.equal(
    hasSessionDetailContent({
      state: "active",
      sessionNumber: 3,
    }),
    false,
  );
});
