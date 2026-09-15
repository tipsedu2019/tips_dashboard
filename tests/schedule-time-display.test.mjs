import test from "node:test";
import assert from "node:assert/strict";
import { formatScheduleTimeRange } from "../src/lib/schedule-time-display.ts";
import { formatClassScheduleDisplayLines } from "../src/features/management/class-schedule-slots.ts";

test("time display preserves each weekday teacher and classroom while changing separators", () => {
  const schedule = "월 19:30-21:30 (김선생, 본관 1강)\n수 19:30-21:30 (이선생, 별관 2강)";
  assert.deepEqual(formatClassScheduleDisplayLines(schedule).map(formatScheduleTimeRange), [
    "월 19:30–21:30 (김선생, 본관 1강)",
    "수 19:30–21:30 (이선생, 별관 2강)",
  ]);
  assert.equal(formatScheduleTimeRange("수업 일정 미정"), "수업 일정 미정");
  assert.equal(formatScheduleTimeRange("월 9:30 ~ 11:30"), "월 9:30–11:30");
  assert.equal(formatScheduleTimeRange("월 19:30–21:30"), "월 19:30–21:30");
});
