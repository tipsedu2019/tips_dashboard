import assert from "node:assert/strict";
import test from "node:test";

import type { PlanSlot, ShadowSlot } from "../src/features/academic/timetable-plan-contract.ts";
import { findConflicts, suggestPlacements } from "../src/features/academic/timetable-conflicts.ts";

const slot: PlanSlot = {
  id: "slot-a", itemId: "class-a", planId: "plan-a", weekday: 1,
  startMinute: 1033, endMinute: 1123,
  teacherId: "teacher-a", classroomId: "room-a", sourceSlotId: null,
};
const shadow: ShadowSlot = {
  id: "live:class-x:slot-x", classId: "class-x", sourceSlotId: "slot-x",
  weekday: 1, startMinute: 1020, endMinute: 1140,
  teacherId: "teacher-a", classroomId: "room-x", classRevision: 3,
};

test("touching intervals are free but one minute of overlap conflicts", () => {
  assert.equal(findConflicts([slot, { ...slot, id: "slot-b", itemId: "class-b",
    startMinute: 1123, endMinute: 1213 }], []).length, 0);
  assert.deepEqual(findConflicts([slot, { ...slot, id: "slot-b", itemId: "class-b",
    startMinute: 1122, endMinute: 1212 }], []).map((value) => value.kind),
  ["teacher", "classroom"]);
});

test("same item overlaps even with different resources and includes both resource reasons when shared", () => {
  assert.deepEqual(findConflicts([slot, { ...slot, id: "slot-b",
    teacherId: "teacher-b", classroomId: "room-b" }], []).map((value) => value.kind),
  ["same_class"]);
  assert.deepEqual(findConflicts([slot, { ...slot, id: "slot-b" }], []).map((value) => value.kind),
  ["teacher", "classroom", "same_class"]);
});

test("each plan is independent, while every plan checks the same active shadow", () => {
  const differentPlan = { ...slot, id: "slot-b", itemId: "class-b", planId: "plan-b" };
  assert.deepEqual(findConflicts([slot, differentPlan], []), []);
  const collisions = findConflicts([slot, differentPlan], [shadow]);
  assert.deepEqual(collisions.map((value) => [value.slotId, value.otherSlotId, value.kind]), [
    ["slot-a", shadow.id, "teacher"], ["slot-b", shadow.id, "teacher"],
  ]);
});

test("a source class is not exempt from its own live shadow", () => {
  const sourceShadow = { ...shadow, classId: "class-a", sourceSlotId: "source-slot" };
  assert.deepEqual(findConflicts([{ ...slot, sourceSlotId: "source-slot" }], [sourceShadow])
    .map((value) => value.kind), ["teacher"]);
});

test("suggestions preserve resource IDs, selected weekday order and five minute sequence", () => {
  const slots = [{ ...slot, weekday: 3, startMinute: 550, endMinute: 600 }];
  const before = structuredClone(slots);
  const suggestions = suggestPlacements({ slots, shadows: [], itemId: "new-class",
    planId: "plan-a", teacherId: "teacher-a", classroomId: "room-a",
    durationMinutes: 30, weekdays: [3, 1], fromMinute: 540, toMinute: 635 });
  assert.deepEqual(suggestions, [
    { weekday: 3, startMinute: 600, teacherId: "teacher-a", classroomId: "room-a" },
    { weekday: 3, startMinute: 605, teacherId: "teacher-a", classroomId: "room-a" },
    { weekday: 1, startMinute: 540, teacherId: "teacher-a", classroomId: "room-a" },
    { weekday: 1, startMinute: 545, teacherId: "teacher-a", classroomId: "room-a" },
    { weekday: 1, startMinute: 550, teacherId: "teacher-a", classroomId: "room-a" },
  ]);
  assert.deepEqual(slots, before);
});

test("suggestions avoid shadows even for matching source class and return empty when none fit", () => {
  const results = suggestPlacements({ slots: [], shadows: [shadow], itemId: "class-x",
    planId: "plan-a", teacherId: "teacher-a", classroomId: "room-x",
    durationMinutes: 30, weekdays: [1], fromMinute: 1020, toMinute: 1100 });
  assert.deepEqual(results, []);
});

test("an unrelated preexisting conflict does not hide a safe new suggestion", () => {
  const existing = [slot, { ...slot, id: "slot-b", itemId: "class-b" }];
  const results = suggestPlacements({ slots: existing, shadows: [], itemId: "class-c",
    planId: "plan-a", teacherId: "teacher-a", classroomId: "room-a",
    durationMinutes: 30, weekdays: [2], fromMinute: 540, toMinute: 570 });
  assert.equal(results[0]?.startMinute, 540);
});
