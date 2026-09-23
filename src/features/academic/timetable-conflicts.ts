import type { DropTarget, PlanSlot, ShadowSlot, TimetableConflict, TimetableOperatingReference } from "./timetable-plan-contract.ts";
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

export function findConflicts(slots: readonly PlanSlot[], shadows: readonly ShadowSlot[], changedIds?: ReadonlySet<string>): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  // Preserve canonical pair order while avoiding unrelated unchanged pairs.
  const changedIndexes = changedIds ? slots.flatMap((slot, index) => changedIds.has(slot.id) ? [index] : []) : [];
  const indexes = slots.map((_, index) => index);
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    assertWeekday(slot.weekday);
    assertInterval(slot.startMinute, slot.endMinute);
    const relevant = !changedIds || changedIds.has(slot.id);
    for (const j of relevant ? indexes : changedIndexes) {
      if (j <= i) continue;
      const other = slots[j];
      if (slot.planId === other.planId) {
        conflicts.push(...conflictKinds(slot, other, slot.itemId === other.itemId));
      }
    }
    for (const shadow of shadows) {
      if (!relevant && !changedIds?.has(shadow.id)) continue;
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
  operatingReference?: TimetableOperatingReference;
  period?: { startDate: string; endDate: string } | null;
}): DropTarget[] {
  const { slots, shadows, itemId, planId, teacherId, classroomId,
    durationMinutes, weekdays, fromMinute, toMinute } = input;
  if (!teacherId || !classroomId || !Number.isInteger(durationMinutes) || durationMinutes <= 0
    || !Number.isInteger(fromMinute) || !Number.isInteger(toMinute)
    || fromMinute < 0 || fromMinute >= toMinute || toMinute > 1440) {
    throw new RangeError("invalid placement search window or resource");
  }
  if (input.operatingReference && !operatingReferenceComplete(input.operatingReference, input.period)) return [];
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
        || shadows.some((shadow) => conflictKinds(candidate, shadow, false).length > 0)
        || (input.operatingReference ? findOperatingConflicts([candidate], input.operatingReference, input.period).length > 0 : false);
      if (!occupied) {
        suggestions.push({ weekday, startMinute, teacherId, classroomId });
        if (suggestions.length === 5) return suggestions;
      }
    }
  }
  return suggestions;
}

/** Same class/source/date is authoritative even when the session is skipped/tbd.
 * A source-less session is additive; names/time similarity never deduplicate it. */
export function effectiveOperatingSlots(reference: TimetableOperatingReference, date: string): ShadowSlot[] {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sessions = reference.datedSessions.filter((session) => session.date === date);
  const defaults = reference.shadowSlots.filter((slot) => date >= reference.asOfDate && slot.weekday === day
    && !sessions.some((session) => session.sourceSlotId !== null
      && session.classId === slot.classId && session.sourceSlotId === slot.sourceSlotId));
  return [...defaults, ...sessions.flatMap((session) => {
    if (session.state === "skipped" || session.state === "tbd" || session.startMinute === null
      || session.endMinute === null || session.teacherId === null || session.classroomId === null) return [];
    return [{ id: session.id, classId: session.classId, sourceSlotId: session.sourceSlotId,
      weekday: day, startMinute: session.startMinute, endMinute: session.endMinute,
      teacherId: session.teacherId, classroomId: session.classroomId, classRevision: session.revision }];
  })];
}

export function findOperatingConflicts(slots: readonly PlanSlot[], reference: TimetableOperatingReference,
  period?: { startDate: string; endDate: string } | null): TimetableConflict[] {
  const conflicts = findConflicts(slots, reference.shadowSlots);
  if (!period) return conflicts;
  for (const session of reference.datedSessions) {
    if (session.date < period.startDate || session.date > period.endDate
      || session.state === "skipped" || session.state === "tbd") continue;
    // Suppress only a genuinely identical source reservation; source-less
    // legacy sessions are never merged by names or similar coordinates.
    if (reference.shadowSlots.some((shadow) => session.sourceSlotId !== null
      && shadow.classId === session.classId && shadow.sourceSlotId === session.sourceSlotId
      && shadow.weekday === new Date(`${session.date}T00:00:00Z`).getUTCDay()
      && shadow.startMinute === session.startMinute && shadow.endMinute === session.endMinute
      && shadow.teacherId === session.teacherId && shadow.classroomId === session.classroomId)) continue;
    const actual = effectiveOperatingSlots({ ...reference, shadowSlots: [], datedSessions: [session] }, session.date);
    for (const slot of slots) for (const shadow of actual) {
      conflicts.push(...conflictKinds(slot, shadow, false).map((conflict) => ({ ...conflict, date: session.date })));
    }
  }
  return conflicts;
}

export function operatingReferenceComplete(reference: TimetableOperatingReference,
  period?: { startDate: string; endDate: string } | null): boolean {
  return reference.complete && (!period || !reference.datedUnresolvedOccupancies.some((blocker) =>
    blocker.date === null || (blocker.date >= period.startDate && blocker.date <= period.endDate)));
}
