import type { DropTarget, PlanSlot } from "./timetable-plan-contract.ts";

export function assertWeekday(weekday: number): void {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError("weekday must be an integer from 0 to 6");
  }
}

export function assertInterval(startMinute: number, endMinute: number): void {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)
    || startMinute < 0 || startMinute >= endMinute || endMinute > 1440) {
    throw new RangeError("time must be an integer interval within one day");
  }
}

export function moveSlot(slot: PlanSlot, target: DropTarget): PlanSlot {
  assertWeekday(slot.weekday);
  assertInterval(slot.startMinute, slot.endMinute);
  assertWeekday(target.weekday);
  const endMinute = target.startMinute + slot.endMinute - slot.startMinute;
  assertInterval(target.startMinute, endMinute);
  if (target.teacherId !== undefined && !target.teacherId) {
    throw new RangeError("teacherId must not be empty");
  }
  if (target.classroomId !== undefined && !target.classroomId) {
    throw new RangeError("classroomId must not be empty");
  }
  return {
    ...slot,
    ...target,
    endMinute,
  };
}
