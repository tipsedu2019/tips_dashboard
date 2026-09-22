import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveScheduleLearningContent, scheduleOnlyDraft } from '../src/features/operations/schedule-only-plan.ts';
import { buildSchedulePlanForSave } from '../src/lib/class-schedule-planner.js';

test('schedule changes retain stored learning history without creating content on new sessions', () => {
  const stored = { textbooks: [{ textbookId: 'book-1', alias: '보존 교재' }], sessions: [{ id: 'row-1', sessionKey: 'stable-1', date: '2026-09-21', scheduleState: 'active', textbookEntries: [{ textbookId: 'book-1', planStart: '10' }], rangeLabel: '10~20', progressStatus: 'done', teacherNote: '보존 메모' }] };
  const original = structuredClone(stored);
  const draft = scheduleOnlyDraft(stored);
  assert.deepEqual(draft.textbooks, []);
  assert.equal(draft.sessions[0].teacherNote, undefined);
  draft.sessions[0].date = '2026-09-23';
  draft.sessions[0].scheduleState = 'makeup';
  draft.sessions.push({ id: 'new', date: '2026-09-25', progressStatus: 'pending', textbookEntries: [] });
  const saved = preserveScheduleLearningContent(draft, stored);
  assert.equal(saved.sessions[0].date, '2026-09-23');
  assert.equal(saved.sessions[0].scheduleState, 'makeup');
  for (const key of ['textbookEntries', 'rangeLabel', 'progressStatus', 'teacherNote']) assert.deepEqual(saved.sessions[0][key], original.sessions[0][key]);
  assert.deepEqual(saved.textbooks, original.textbooks);
  assert.equal(saved.sessions[1].progressStatus, undefined);
  assert.deepEqual(stored, original);
});

test('legacy regeneration keeps stable keys so history survives schedule saves', () => {
  const stored = { selectedDays: [1], billingPeriods: [{ id: 'p1', month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', totalSessions: 4 }], textbooks: [{ textbookId: 'b1' }] };
  const generated = buildSchedulePlanForSave(stored, { subject: '영어' });
  generated.sessions[0].teacherNote = '원래 기록';
  generated.sessions[0].textbookEntries = [{ textbookId: 'b1', planStart: '7' }];
  const regenerated = buildSchedulePlanForSave(scheduleOnlyDraft(generated), { subject: '영어', textbookIds: [], textbooks: [] });
  const saved = preserveScheduleLearningContent(regenerated, generated);
  assert.equal(saved.sessions[0].teacherNote, '원래 기록');
  assert.deepEqual(saved.sessions[0].textbookEntries, [{ textbookId: 'b1', planStart: '7' }]);
});
