import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

test('recommended placement with a missing name focuses the real shared name input and saves nothing', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/admin/timetable', pretendToBeVisual: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ['HTMLElement', 'Element', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'DocumentFragment', 'HTMLInputElement', 'KeyboardEvent']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = window.getComputedStyle;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { TimetablePlacementEditor } = loadNotificationComponent('src/features/academic/timetable-placement-editor.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
  const item = { id: 'new-item', planId: 'plan', name: '', subject: '영어', grade: '중1', capacity: 0, tuition: 325000,
    subjectAreaKey: null, durationMinutes: 60, defaultTeacherId: 'teacher', defaultClassroomId: 'room', pendingSlots: [] };
  const snapshot = { items: [], slots: [], appliedSnapshots: [], catalogs: {
    teachers: [{ id: 'teacher', name: '합성 선생님', isVisible: true, subjects: ['영어'] }],
    classrooms: [{ id: 'room', name: '합성 강의실', isVisible: true, subjects: ['영어'] }],
  } };
  const saves = [];
  await React.act(async () => root.render(React.createElement(TimetablePlacementEditor, {
    draft: { item, slots: [], scope: 'item', target: { weekday: 1, startMinute: 540 } }, snapshot,
    onSave: async edit => saves.push(edit), onClose() {}, onDirty() {}, canEdit: true, failureKind: null,
    onRetry: async () => {}, onDiscard: async () => {}, onAcceptServer: async () => {}, serverSummary: '',
  })));
  const recommend = [...document.querySelectorAll('button')].find(button => button.textContent === '빈 시간 추천');
  assert.ok(recommend);
  await React.act(async () => { recommend.focus(); recommend.click(); });
  const suggestion = document.querySelector('[role="status"] button');
  assert.ok(suggestion, 'a real candidate must be available to exercise RHF rather than native submit validation');
  await React.act(async () => { suggestion.focus(); suggestion.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(document.activeElement, document.getElementById('preset-class-name'));
  assert.equal(document.getElementById('preset-class-name').getAttribute('aria-invalid'), 'true');
  assert.match(document.body.textContent, /수업명을 입력해 주세요/);
  assert.deepEqual(saves, []);
});
