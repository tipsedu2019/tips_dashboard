import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPanels, validatePlacementEdit } from '../src/features/academic/timetable-plan-interaction.ts';

const item = { id: 'draft', planId: 'plan', name: '새 편성', subject: '영어', state: 'draft', revision: 1 };
const slot = { id: 'draft-slot', itemId: item.id, planId: 'plan', weekday: 1, startMinute: 1033, endMinute: 1093, teacherId: 'teacher', classroomId: 'room', sourceSlotId: null };
const applied = { ...item, id: 'applied', name: '이미 올린 편성', state: 'applied' };
const appliedSlot = { ...slot, id: 'applied-slot', itemId: applied.id, weekday: 3, sourceSlotId: 'original-slot' };
const operating = { ...slot, id: 'operating-slot', classId: 'operating', itemId: undefined };
const snapshot = {
  plan: { id: 'plan', state: 'draft', targetStartDate: '2026-10-01', targetEndDate: '2026-12-31' },
  items: [item, applied], slots: [slot], appliedSnapshots: [{ itemId: applied.id, slots: [appliedSlot] }],
  shadowClasses: [{ id: 'operating', name: '현재 수강', subject: '영어' }], shadowSlots: [operating],
  asOfDate: '2026-10-20', complete: false, datedComplete: false,
  unresolvedOccupancies: [{ id: 'unresolved', classId: 'operating', scope: 'resource', resourceId: 'teacher', weekday: 1, startMinute: 1033, endMinute: 1093 }],
  datedUnresolvedOccupancies: [], datedSessions: [{ ...operating, id: 'dated', date: '2026-10-26', state: 'active' }],
  catalogs: { teachers: [{ id: 'teacher', name: '합성 선생님', subjects: ['영어팀'], isVisible: true }], classrooms: [{ id: 'room', name: '합성 강의실', subjects: [], isVisible: true }] },
  capacity: { itemCount: 2, slotCount: 2, maxItems: 500, maxSlots: 2000, exceeded: false },
};

for (const view of ['teacher-weekly', 'classroom-weekly', 'daily-teacher', 'daily-classroom']) {
  test(`${view}: displays only preset-owned draft and applied placements`, () => {
    const before = structuredClone(snapshot);
    const blocks = buildPlanPanels(snapshot, view).flatMap(p => p.blocks);
    assert.deepEqual(blocks.map(b => b.id).sort(), ['applied-slot', 'draft-slot']);
    assert.equal(blocks.find(b => b.id === 'applied-slot').readOnly, true);
    assert.deepEqual(blocks.find(b => b.id === 'applied-slot').slot, appliedSlot);
    assert.equal(blocks.find(b => b.id === 'draft-slot').readOnly, false);
    assert.deepEqual(snapshot, before, 'source IDs and applied history are immutable');
    assert.equal(buildPlanPanels({ ...snapshot, items: [], slots: [], appliedSnapshots: [] }, view).flatMap(p => p.blocks).length, 0);
  });
}

test('operating weekly, dated and unresolved occupancy cannot reject preset placement', () => {
  const empty = { ...snapshot, slots: [] };
  assert.doesNotThrow(() => validatePlacementEdit(empty, { operation: 'save', item, slots: [slot] }));
});

test('preset applied placement still blocks a new draft using its teacher or room', () => {
  assert.throws(() => validatePlacementEdit(snapshot, { operation: 'save', item, slots: [{ ...slot, weekday: 3 }] }), /이미 올린 편성.*겹칩니다/);
});

test('same preset draft collisions remain blocked and adjacent times remain valid', () => {
  const other = { ...item, id: 'other', name: '같은 프리셋 수업' };
  const otherSlot = { ...slot, id: 'other-slot', itemId: other.id, weekday: 2 };
  const s = { ...snapshot, items: [...snapshot.items, other], slots: [slot, otherSlot] };
  assert.throws(() => validatePlacementEdit(s, { operation: 'save', item, slots: [{ ...slot, weekday: 2 }] }), /같은 프리셋 수업.*겹칩니다/);
  assert.doesNotThrow(() => validatePlacementEdit(s, { operation: 'save', item, slots: [{ ...slot, weekday: 2, startMinute: 1093, endMinute: 1153 }] }));
});
