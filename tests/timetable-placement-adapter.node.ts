import assert from "node:assert/strict";
import test from "node:test";

import type { PlanSlot, ShadowSlot, TimetableView } from "../src/features/academic/timetable-plan-contract.ts";
import {
  projectTimetableSlot, resolveGridTarget, resolveMovedGridTarget,
} from "../src/features/academic/timetable-placement-adapter.ts";

const monday: PlanSlot = {
  id: "slot-monday", itemId: "item-a", planId: "plan-a", weekday: 1,
  startMinute: 1033, endMinute: 1123, teacherId: "teacher-a",
  classroomId: "room-a", sourceSlotId: null,
};
const wednesday: PlanSlot = { ...monday, id: "slot-wednesday", weekday: 3 };
const shadow: ShadowSlot = {
  id: "live:class-x:slot-x", classId: "class-x", sourceSlotId: "slot-x",
  weekday: 1, startMinute: 1080, endMinute: 1200,
  teacherId: "teacher-a", classroomId: "room-a", classRevision: 3,
};

test("four views project the same stable Monday and Wednesday slot IDs", () => {
  const views: TimetableView[] = [
    "teacher-weekly", "classroom-weekly", "daily-teacher", "daily-classroom",
  ];
  for (const view of views) {
    const projections = [monday, wednesday].map((slot) => projectTimetableSlot(slot, view));
    assert.deepEqual(projections.map((value) => value.id), ["slot-monday", "slot-wednesday"]);
    assert.deepEqual(projections.map((value) => [value.startMinute, value.endMinute]),
      [[1033, 1123], [1033, 1123]]);
  }
  assert.deepEqual(projectTimetableSlot(monday, "teacher-weekly"),
    { id: "slot-monday", panelKey: "teacher-a", columnKey: "1", startMinute: 1033, endMinute: 1123 });
  assert.deepEqual(projectTimetableSlot(monday, "classroom-weekly"),
    { id: "slot-monday", panelKey: "room-a", columnKey: "1", startMinute: 1033, endMinute: 1123 });
  assert.deepEqual(projectTimetableSlot(monday, "daily-teacher"),
    { id: "slot-monday", panelKey: "1", columnKey: "teacher-a", startMinute: 1033, endMinute: 1123 });
  assert.deepEqual(projectTimetableSlot(monday, "daily-classroom"),
    { id: "slot-monday", panelKey: "1", columnKey: "room-a", startMinute: 1033, endMinute: 1123 });
  assert.equal(projectTimetableSlot(shadow, "daily-teacher").id, shadow.id);
});

test("resolveGridTarget uses cropped absolute minutes and only the view-owned resource", () => {
  assert.deepEqual(resolveGridTarget({ view: "classroom-weekly", panelKey: "room-b",
    columnKey: "1", visibleStartMinute: 540, rowPosition: 1 / 3, slotMinutes: 30 }),
  { weekday: 1, startMinute: 550, classroomId: "room-b" });
  assert.deepEqual(resolveGridTarget({ view: "daily-teacher", panelKey: "3",
    columnKey: "teacher-b", visibleStartMinute: 540, rowPosition: 0.35, slotMinutes: 30 }),
  { weekday: 3, startMinute: 550, teacherId: "teacher-b" });
  assert.deepEqual(resolveGridTarget({ view: "teacher-weekly", panelKey: "teacher-b",
    columnKey: "0", visibleStartMinute: 0, rowPosition: 0, slotMinutes: 30 }),
  { weekday: 0, startMinute: 0, teacherId: "teacher-b" });
});

test("resolveMovedGridTarget snaps the movement delta, preserving a 17:13 origin", () => {
  assert.deepEqual(resolveMovedGridTarget(monday, { view: "classroom-weekly",
    panelKey: "room-a", columnKey: "1", visibleStartMinute: 540,
    rowPosition: 0, slotMinutes: 30 }, { view: "classroom-weekly",
    panelKey: "room-b", columnKey: "3", visibleStartMinute: 540,
    rowPosition: 0.18, slotMinutes: 30 }),
  { weekday: 3, startMinute: 1038, classroomId: "room-b" });
  assert.deepEqual(resolveMovedGridTarget(monday, { view: "teacher-weekly",
    panelKey: "teacher-a", columnKey: "1", visibleStartMinute: 540,
    rowPosition: 0.5, slotMinutes: 30 }, { view: "teacher-weekly",
    panelKey: "teacher-b", columnKey: "1", visibleStartMinute: 540,
    rowPosition: 0.32, slotMinutes: 30 }),
  { weekday: 1, startMinute: 1028, teacherId: "teacher-b" });
  assert.deepEqual(resolveMovedGridTarget(monday, { view: "teacher-weekly",
    panelKey: "teacher-a", columnKey: "1", visibleStartMinute: 540,
    rowPosition: 2, slotMinutes: 30 }, { view: "teacher-weekly",
    panelKey: "teacher-b", columnKey: "1", visibleStartMinute: 600,
    rowPosition: 0, slotMinutes: 30 }),
  { weekday: 1, startMinute: 1033, teacherId: "teacher-b" });
});

test("grid adapter rejects malformed weekday, coordinate, and time", () => {
  assert.throws(() => resolveGridTarget({ view: "daily-classroom", panelKey: "7",
    columnKey: "room-a", visibleStartMinute: 540, rowPosition: 0, slotMinutes: 30 }), RangeError);
  assert.throws(() => resolveGridTarget({ view: "teacher-weekly", panelKey: "teacher-a",
    columnKey: "1", visibleStartMinute: 540, rowPosition: Number.NaN, slotMinutes: 30 }), RangeError);
  assert.throws(() => resolveMovedGridTarget(monday, { view: "teacher-weekly",
    panelKey: "teacher-a", columnKey: "1", visibleStartMinute: 540,
    rowPosition: 0, slotMinutes: 30 }, { view: "teacher-weekly",
    panelKey: "teacher-a", columnKey: "1", visibleStartMinute: 540,
    rowPosition: Number.NaN, slotMinutes: 30 }), RangeError);
});
