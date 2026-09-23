import type { DropTarget, PlanSlot, ShadowSlot, TimetableConflict } from "./timetable-plan-contract.ts";
import { assertInterval, assertWeekday } from "./timetable-plan-model.ts";

type OccupiedSlot = Pick<PlanSlot, "id" | "weekday" | "startMinute" | "endMinute" | "teacherId" | "classroomId">;

function overlaps(left: OccupiedSlot, right: OccupiedSlot): boolean {
  return left.weekday === right.weekday
    && left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

function conflictKinds(left: PlanSlot, right: OccupiedSlot, sameItem: boolean): TimetableConflict[] {
  if (!overlaps(left, right)) return [];
  const kinds: TimetableConflict[] = [];
  if (left.teacherId === right.teacherId) {
    kinds.push({ kind: "teacher", slotId: left.id, otherSlotId: right.id });
  }
  if (left.classroomId === right.classroomId) {
    kinds.push({ kind: "classroom", slotId: left.id, otherSlotId: right.id });
  }
  if (sameItem) {
    kinds.push({ kind: "same_class", slotId: left.id, otherSlotId: right.id });
  }
  return kinds;
}

export function findConflicts(slots: readonly PlanSlot[], shadows: readonly ShadowSlot[]): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    assertWeekday(slot.weekday);
    assertInterval(slot.startMinute, slot.endMinute);
    for (let j = i + 1; j < slots.length; j += 1) {
      const other = slots[j];
      if (slot.planId === other.planId) {
        conflicts.push(...conflictKinds(slot, other, slot.itemId === other.itemId));
      }
    }
    for (const shadow of shadows) {
      conflicts.push(...conflictKinds(slot, shadow, false));
    }
  }
  return conflicts;
}

export function suggestPlacements(input: {
  slots: readonly PlanSlot[];
  shadows: readonly ShadowSlot[];
  itemId: string;
  planId: string;
  teacherId: string;
  classroomId: string;
  durationMinutes: number;
  weekdays: number[];
  fromMinute: number;
  toMinute: number;
}): DropTarget[] {
  const { slots, shadows, itemId, planId, teacherId, classroomId,
    durationMinutes, weekdays, fromMinute, toMinute } = input;
  if (!teacherId || !classroomId || !Number.isInteger(durationMinutes) || durationMinutes <= 0
    || !Number.isInteger(fromMinute) || !Number.isInteger(toMinute)
    || fromMinute < 0 || fromMinute >= toMinute || toMinute > 1440) {
    throw new RangeError("invalid placement search window or resource");
  }
  const planSlots = slots.filter((slot) => slot.planId === planId);
  const suggestions: DropTarget[] = [];
  for (const weekday of new Set(weekdays)) {
    assertWeekday(weekday);
    for (let startMinute = Math.ceil(fromMinute / 5) * 5;
      startMinute + durationMinutes <= toMinute; startMinute += 5) {
      const candidate: PlanSlot = {
        id: "candidate", itemId, planId, weekday, startMinute,
        endMinute: startMinute + durationMinutes, teacherId, classroomId,
        sourceSlotId: null,
      };
      const occupied = planSlots.some((slot) => conflictKinds(candidate, slot,
        slot.itemId === itemId).length > 0)
        || shadows.some((shadow) => conflictKinds(candidate, shadow, false).length > 0);
      if (!occupied) {
        suggestions.push({ weekday, startMinute, teacherId, classroomId });
        if (suggestions.length === 5) return suggestions;
      }
    }
  }
  return suggestions;
}
