import type { PlanSnapshot, PlanSlot } from './timetable-plan-contract.ts';

/** Draft and published placements owned by this preset, never operating rows. */
export function presetSlots(snapshot: Pick<PlanSnapshot, 'items' | 'slots' | 'appliedSnapshots'>): PlanSlot[] {
  const appliedIds = new Set(snapshot.items.filter(item => item.state === 'applied').map(item => item.id));
  return [...snapshot.slots, ...(snapshot.appliedSnapshots ?? []).flatMap(entry =>
    appliedIds.has(entry.itemId) ? entry.slots : [])];
}

/** Transport/catalog failures are tracked separately by referenceStatus. */
export function presetWithinCapacity(snapshot: Pick<PlanSnapshot, 'capacity'>): boolean {
  return !snapshot.capacity?.exceeded;
}
