import assert from "node:assert/strict";
import test from "node:test";

import type { PlanSlot } from "../src/features/academic/timetable-plan-contract.ts";
import { moveSlot } from "../src/features/academic/timetable-plan-model.ts";

const slot: PlanSlot = {
  id: "slot-a", itemId: "class-a", planId: "plan-a", weekday: 1,
  startMinute: 1033, endMinute: 1123, teacherId: "teacher-a",
  classroomId: "room-a", sourceSlotId: null,
};

test("moveSlot changes one slot without mutating the original or its duration", () => {
  const moved = moveSlot(slot, { weekday: 3, startMinute: 1038, teacherId: "teacher-b" });
  assert.deepEqual(moved, {
    ...slot, weekday: 3, startMinute: 1038, endMinute: 1128, teacherId: "teacher-b",
  });
  assert.notStrictEqual(moved, slot);
  assert.equal(slot.startMinute, 1033);
  assert.equal(slot.teacherId, "teacher-a");
});

test("moveSlot rejects noninteger, invalid weekday, and crossing-midnight targets", () => {
  for (const target of [
    { weekday: -1, startMinute: 1038 },
    { weekday: 7, startMinute: 1038 },
    { weekday: 1.5, startMinute: 1038 },
    { weekday: 1, startMinute: Number.NaN },
    { weekday: 1, startMinute: 1038.5 },
    { weekday: 1, startMinute: 1400 },
  ]) {
    assert.throws(() => moveSlot(slot, target), RangeError);
  }
  assert.deepEqual(moveSlot({ ...slot, startMinute: 1350, endMinute: 1440 },
    { weekday: 3, startMinute: 1350 }),
  { ...slot, weekday: 3, startMinute: 1350, endMinute: 1440 });
});
