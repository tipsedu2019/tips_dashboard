import test from 'node:test';
import assert from 'node:assert/strict';
import * as slots from '../src/features/management/class-schedule-slots.ts';
import { buildClassPayload } from '../src/features/management/management-service.js';

const blank = { id: null, day: '', startTime: '', endTime: '', teacher: '', teacherCatalogId: null, classroom: '', classroomCatalogId: null, sortOrder: 0 };
const placed = { ...blank, day: '화', startTime: '19:30', endTime: '21:30', teacher: 'Teacher A', teacherCatalogId: 'teacher-a' };

test('an unplaced class does not send an invalid placeholder slot to initialization', () => {
  assert.deepEqual(slots.toContinuousClassScheduleSlots([blank]), []);
  assert.deepEqual(slots.toContinuousClassScheduleSlots([{ ...blank, teacher: 'Teacher A', teacherCatalogId: 'teacher-a' }]), []);
});

test('creation and edits validate placed slot timing and teacher while allowing unassigned rooms', () => {
  assert.equal(slots.classScheduleSlotsValidationError([blank]), '');
  assert.equal(slots.classScheduleSlotsValidationError([placed]), '');
  assert.equal(slots.classScheduleSlotsValidationError([{ ...placed, endTime: '24:00' }]), '');
  assert.match(slots.classScheduleSlotsValidationError([{ ...placed, day: '' }]), /요일/);
  for (const patch of [{ startTime: '' }, { endTime: '19:00' }, { startTime: '25:00' }, { startTime: '24:00' }, { endTime: '24:01' }]) {
    assert.match(slots.classScheduleSlotsValidationError([{ ...placed, ...patch }]), /시간/);
  }
  assert.match(slots.classScheduleSlotsValidationError([{ ...placed, teacher: '', teacherCatalogId: null }]), /선생님/);
  assert.deepEqual(slots.toContinuousClassScheduleSlots([placed])[0].classroomCatalogId, null);
});

test('explicit room clear wins over the old raw alias while omitted classroom preserves it', () => {
  assert.equal(buildClassPayload({ name: 'Synthetic', subject: '영어', room: 'Room A', classroom: '' }).room, '');
  assert.equal(buildClassPayload({ name: 'Synthetic', subject: '영어', room: 'Room A' }).room, 'Room A');
});

test('creation parses every grouped weekday and rejects partially understood schedule text', () => {
  for (const schedule of ['화목 19:30-21:30', '화/목 19:30-21:30', '화, 목 19:30-21:30', '화 목 19:30-21:30']) {
    assert.equal(slots.classScheduleTextValidationError(schedule), '');
    assert.deepEqual(slots.parseClassScheduleSlots(schedule, 'Teacher A', '').map(slot => slot.day), ['화', '목']);
  }
  assert.equal(slots.classScheduleTextValidationError(''), '');
  assert.equal(slots.classScheduleTextValidationError('화 19:30-21:30\n토 16:30-18:00'), '');
  for (const schedule of ['not a schedule', 'bad prefix 화 19:30-21:30', '화 19:30-21:30; bad tail', '화 19:30-21:30\n토 16:30-']) {
    assert.match(slots.classScheduleTextValidationError(schedule), /요일과 시간/);
  }
});
