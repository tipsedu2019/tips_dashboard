import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCalendarDateToggle,
  buildSchedulePlanForSave,
} from "../src/lib/class-schedule-planner.js";

function stateAt(plan, date) {
  return plan.sessionStates?.[date]?.state;
}

test("a base timetable date cycles normal, cancelled, makeup, tbd, skipped, then normal", () => {
  const date = "2026-05-01";
  const meta = {
    hasSession: true,
    hasBaseSession: true,
    isMakeup: false,
  };
  let plan = { sessionStates: {} };

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "exception");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "makeup");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "tbd");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "skipped");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), undefined);
});

test("an empty non-timetable date visibly advances to cancelled on its first click", () => {
  const date = "2026-05-02";
  const meta = {
    hasSession: false,
    hasBaseSession: false,
    isMakeup: false,
  };
  let plan = { sessionStates: {} };

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "exception");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "makeup");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "tbd");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "skipped");

  plan = applyCalendarDateToggle(plan, date, meta);
  assert.equal(stateAt(plan, date), "force_active");

  assert.equal(plan.sessionStates[date].state, "force_active");
});

test("skipping and restoring a base date preserves its session identity and progress draft", () => {
  const date = "2026-05-01";
  const meta = {
    hasSession: true,
    hasBaseSession: true,
    isMakeup: false,
  };
  const initial = buildSchedulePlanForSave(
    {
      selectedDays: [5],
      billingPeriods: [
        {
          id: "period-may",
          label: "5월",
          startDate: date,
          endDate: date,
        },
      ],
      textbooks: [],
      sessions: [],
    },
    {},
  );
  const initialSession = {
    ...initial.sessions[0],
    publicNote: "보존할 진도 초안",
  };
  let skippedPlan = {
    ...initial,
    sessions: [initialSession],
  };

  for (let click = 0; click < 4; click += 1) {
    skippedPlan = applyCalendarDateToggle(skippedPlan, date, meta);
  }

  const skipped = buildSchedulePlanForSave(skippedPlan, {});
  assert.equal(skipped.sessions[0].id, initialSession.id);
  assert.equal(skipped.sessions[0].scheduleState, "skipped");
  assert.equal(skipped.sessions[0].sessionNumber, null);
  assert.equal(skipped.sessions[0].publicNote, "보존할 진도 초안");

  const restoredDraft = applyCalendarDateToggle(skipped, date, meta);
  const restored = buildSchedulePlanForSave(restoredDraft, {});
  assert.equal(restored.sessions[0].id, initialSession.id);
  assert.equal(restored.sessions[0].scheduleState, "active");
  assert.equal(restored.sessions[0].sessionNumber, 1);
  assert.equal(restored.sessions[0].publicNote, "보존할 진도 초안");
});
