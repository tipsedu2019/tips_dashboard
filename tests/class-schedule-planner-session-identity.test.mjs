import test from "node:test";
import assert from "node:assert/strict";

import { buildSchedulePlanForSave } from "../src/lib/class-schedule-planner.js";

const occupancy = {
  startTime: "17:00",
  endTime: "19:00",
  teacherCatalogId: "91000000-0000-4000-8000-000000000101",
  classroomCatalogId: "91000000-0000-4000-8000-000000000201",
};
const futureDates = [
  "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15",
  "2026-10-20", "2026-10-22", "2026-10-27", "2026-10-29",
];

for (const { name, endDate, dates } of [
  { name: "inserting an earlier date", endDate: "2026-10-29", dates: futureDates },
  { name: "adding both ends around seven future dates", endDate: "2026-10-27", dates: futureDates.slice(0, 7) },
]) test(`${name} retains every existing future session identity and content`, () => {
  const saved = buildSchedulePlanForSave({
    selectedDays: [2, 4],
    billingPeriods: [{ id: "october", month: 10, startDate: "2026-10-02", endDate }],
    sessionSchedules: Object.fromEntries(dates.map(date => [date, occupancy])),
    textbooks: [{ textbookId: "synthetic-book", alias: "Synthetic book" }],
  });
  saved.sessions = saved.sessions.map((row, index) => ({
    ...row,
    id: `existing-${index + 1}`,
    sessionKey: `existing-key-${index + 1}`,
    publicNote: `Public note for ${row.date}`,
    teacherNote: `Teacher note for ${row.date}`,
    progressStatus: "done",
    textbookEntries: row.textbookEntries.map(entry => ({
      ...entry,
      plan: { ...entry.plan, label: `Plan for ${row.date}` },
      actual: { ...entry.actual, status: "done", label: `Actual for ${row.date}` },
    })),
  }));
  const before = structuredClone(saved);
  const next = buildSchedulePlanForSave({
    ...saved,
    billingPeriods: saved.billingPeriods.map(period => ({ ...period, startDate: "2026-10-01", endDate: "2026-10-29" })),
    sessionSchedules: { ...saved.sessionSchedules, "2026-10-01": occupancy, "2026-10-29": occupancy },
  });

  assert.equal(next.sessions.length, 9);
  for (const added of next.sessions.filter(row => !dates.includes(row.date))) {
    assert.ok(!saved.sessions.some(row => row.id === added.id), "the added date must receive a new identity");
    assert.equal(added.publicNote, "");
    assert.equal(added.teacherNote, "");
    assert.equal(added.textbookEntries[0].plan.label, "");
    assert.equal(added.textbookEntries[0].actual.status, "pending");
    for (const field of Object.keys(occupancy)) assert.equal(added[field], occupancy[field]);
  }
  for (const old of saved.sessions) {
    const current = next.sessions.find(row => row.date === old.date);
    assert.equal(current.id, old.id, old.date);
    assert.equal(current.sessionKey, old.sessionKey, old.date);
    assert.equal(current.sessionNumber, old.sessionNumber + 1, old.date);
    assert.deepEqual(current.textbookEntries, old.textbookEntries, old.date);
    assert.equal(current.publicNote, old.publicNote, old.date);
    assert.equal(current.teacherNote, old.teacherNote, old.date);
    assert.equal(current.progressStatus, old.progressStatus, old.date);
    for (const field of Object.keys(occupancy)) assert.equal(current[field], old[field], `${old.date}: ${field}`);
  }
  assert.deepEqual(saved, before, "regeneration must not mutate the stored plan");
});

test("sequence fallback retains identity when the original date is removed by rescheduling", () => {
  const saved = buildSchedulePlanForSave({
    selectedDays: [2],
    billingPeriods: [{ id: "october", month: 10, startDate: "2026-10-06", endDate: "2026-10-06" }],
  });
  saved.sessions[0].id = "existing-rescheduled-session";
  saved.sessions[0].sessionKey = "existing-rescheduled-key";
  saved.sessions[0].teacherNote = "Keep this lesson's draft";
  const next = buildSchedulePlanForSave({
    ...saved,
    billingPeriods: saved.billingPeriods.map(period => ({ ...period, startDate: "2026-10-13", endDate: "2026-10-13" })),
  });

  assert.equal(next.sessions.length, 1);
  assert.equal(next.sessions[0].date, "2026-10-13");
  assert.equal(next.sessions[0].id, saved.sessions[0].id);
  assert.equal(next.sessions[0].sessionKey, saved.sessions[0].sessionKey);
  assert.equal(next.sessions[0].teacherNote, saved.sessions[0].teacherNote);
});
