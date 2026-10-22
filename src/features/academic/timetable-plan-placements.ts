import type { PlanSnapshot, PlanSlot } from './timetable-plan-contract.ts';

/** Preset occupancy is its own editable draft and immutable applied placement history.
 * Operating classes may have moved or disappeared after publication; they are not
 * a replacement for these stored slot IDs, times or resources. */
export function planPlacements(snapshot: Pick<PlanSnapshot, 'slots' | 'appliedSnapshots'>): PlanSlot[] {
  return [...snapshot.slots, ...snapshot.appliedSnapshots.flatMap(entry => entry.slots)];
}

/** Transport/authorization failures are tracked separately by referenceStatus.
 * Operating completeness is not a preset constraint, including with old RPCs. */
export function planCapacityAvailable(snapshot: PlanSnapshot): boolean {
  return !snapshot.capacity.exceeded;
}
