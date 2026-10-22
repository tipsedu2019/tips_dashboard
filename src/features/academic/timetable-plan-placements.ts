import type { PlanSnapshot, PlanSlot } from './timetable-plan-contract.ts';
import { timetableTeachers } from './timetable-subjects.ts';

/** Preset occupancy is its own editable draft and immutable applied placement history.
 * Operating classes may have moved or disappeared after publication; they are not
 * a replacement for these stored slot IDs, times or resources. */
export function planPlacements(snapshot: Pick<PlanSnapshot, 'slots' | 'appliedSnapshots'>): PlanSlot[] {
  return [...snapshot.slots, ...snapshot.appliedSnapshots.flatMap(entry => entry.slots)];
}

/** Display stored placements even when their teacher is no longer eligible for
 * a new placement. Subject filtering follows the saved item, not today's team. */
export function planDisplayTeachers(snapshot: PlanSnapshot, subject = '') {
  const eligible = new Set(timetableTeachers(snapshot.catalogs.teachers, subject).map(row => row.id));
  const itemIds = new Set(snapshot.items.filter(item => !subject || item.subject === subject).map(item => item.id));
  const referenced = new Set(planPlacements(snapshot).filter(slot => itemIds.has(slot.itemId)).map(slot => slot.teacherId));
  return snapshot.catalogs.teachers.filter(row => eligible.has(row.id) || referenced.has(row.id));
}

/** Transport/authorization failures are tracked separately by referenceStatus.
 * Operating completeness is not a preset constraint, including with old RPCs. */
export function planCapacityAvailable(snapshot: PlanSnapshot): boolean {
  return !snapshot.capacity.exceeded;
}
