import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { act, createElement } = require('react');
const state = loadNotificationComponent('src/features/tasks/registration-track-fixtures.ts').createRegistrationSubjectTrackFixtureState();
const service = loadNotificationComponent('src/features/tasks/registration-track-service.ts');
const writes = [];
const { RegistrationApplication } = loadNotificationComponent(
  'src/features/tasks/registration-track-editor.tsx',
  new Map([['./registration-track-service', {
    ...service,
    saveRegistrationConsultationDetails: async (input) => { writes.push(input); },
  }]]),
);
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts += 1; throw new Error('Network prohibited by audit reproducer'); };

async function mount(detail) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/registration' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement', 'getComputedStyle']) {
    globalThis[key] = dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (fn) => window.setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const ids = detail.tracks.map((track) => track.id);
  let dirty = false;
  let guardCalls = 0;
  let pendingNavigation;
  const warnings = [];
  const props = {
    task: detail.task, detail, focusTrackId: ids[0],
    viewerId: state.viewers.staff.viewerId, viewerRole: 'staff',
    onFocusTrack(id) {
      props.focusTrackId = id;
      root.render(createElement(RegistrationApplication, props));
    },
    onRequestLocalNavigation(intent) { guardCalls += 1; pendingNavigation = intent; },
    onDirtyChange(value) { dirty = value; },
    onReload: async () => {},
    onWarning(message) { warnings.push(message); },
    subjectCapabilities: state.subjectCapabilities,
    ...state.optionData,
    classOptions: state.optionData.classes,
    teacherOptions: state.optionData.teachers,
    textbookOptions: state.optionData.textbooks,
    closeAction: null,
  };
  const flush = async (fn) => act(async () => {
    fn?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await flush(() => root.render(createElement(RegistrationApplication, props)));
  return {
    ids, props, flush,
    confirmNavigation: () => flush(() => pendingNavigation?.()),
    dirty: () => dirty,
    guardCalls: () => guardCalls,
    selectTrack: (id) => flush(() => document.getElementById(`registration-subject-tab-${id}`).click()),
    close: async () => { await flush(() => root.unmount()); dom.window.close(); },
  };
}

for (const [fixture, label] of [
  ['fixture-task-dual-test', '레벨테스트 예약'],
  ['fixture-task-split-consultation', '방문상담 예약'],
]) {
test(`${label} draft blocks subject navigation until explicit discard`, async () => {
  const ui = await mount(structuredClone(state.caseDetails[fixture]));
  try {
    const section = () => document.querySelector(`[aria-label="${label}"]`);
    const target = [...section().querySelectorAll('[data-appointment-field="place"] button')]
      .find(button => button.getAttribute('aria-pressed') !== 'true');
    await ui.flush(() => target.click());
    assert.equal(ui.dirty(), true);
    await ui.selectTrack(ui.ids[1]);
    assert.equal(ui.props.focusTrackId, ui.ids[0]);
    assert.equal(target.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.dirty(), true);
    assert.equal(ui.guardCalls(), 1);
    await ui.confirmNavigation();
    assert.equal(ui.props.focusTrackId, ui.ids[1]);
    await ui.selectTrack(ui.ids[0]);
    assert.equal(ui.props.focusTrackId, ui.ids[0]);
  } finally { await ui.close(); }
});
}

test('dirty appointment cannot be discarded when no navigation guard is installed', async () => {
  const ui = await mount(structuredClone(state.caseDetails['fixture-task-dual-test']));
  try {
    delete ui.props.onRequestLocalNavigation;
    await ui.flush(() => ui.props.onFocusTrack(ui.ids[0]));
    const target = [...document.querySelectorAll('[data-appointment-field="place"] button')]
      .find(button => button.getAttribute('aria-pressed') !== 'true');
    await ui.flush(() => target.click());
    await ui.selectTrack(ui.ids[1]);
    assert.equal(ui.props.focusTrackId, ui.ids[0]);
    assert.equal(ui.dirty(), true);
  } finally { await ui.close(); }
});

test('visit to phone confirmation is scoped to its subject and appointment revision', async () => {
  const detail = structuredClone(state.caseDetails['fixture-task-split-consultation']);
  const ui = await mount(detail);
  try {
    const button = (name) => [...document.getElementById('registration-application-consultation').querySelectorAll('button')]
      .find(button => button.textContent === name);
    await ui.flush(() => button('전화상담').click());
    await ui.flush(() => document.querySelector('[aria-label="영어 상담 정보 저장"]').click());
    assert.ok(document.querySelector('[role="alertdialog"]'));
    const next = structuredClone(detail);
    next.appointments[0].notificationRevision += 1;
    ui.props.detail = next;
    await ui.flush(() => ui.props.onFocusTrack(ui.ids[0]));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await ui.flush(() => document.querySelector('[aria-label="영어 상담 정보 저장"]').click());
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await ui.selectTrack(ui.ids[1]);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await ui.selectTrack(ui.ids[0]);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await ui.close(); }
});

function phoneDetail() {
  const detail = structuredClone(state.caseDetails['fixture-task-dual-test']);
  detail.tracks.forEach(track => { track.workflowStatus = 'consultation_requested'; track.status = 'consultation_waiting'; });
  detail.levelTests = [];
  detail.appointments = [];
  detail.consultations = detail.tracks.map((track, index) => ({
    id: `phone-${index}`, trackId: track.id, mode: 'phone', status: 'scheduled',
    note: '', appointmentId: null, updatedAt: '2026-09-20T10:00:00Z',
  }));
  return detail;
}
const cancelButton = () => [...document.getElementById('registration-application-consultation').querySelectorAll('button')]
  .find(button => button.textContent === '상담 취소');
const confirmButton = () => [...document.querySelectorAll('[role="alertdialog"] button')]
  .find(button => button.textContent === '상담 취소');

test('subject change dismisses cancellation; only a fresh confirmation can cancel the new subject', async () => {
  writes.length = 0;
  const detail = phoneDetail();
  const ui = await mount(detail);
  try {
    await ui.flush(() => cancelButton().click());
    assert.ok(confirmButton());
    await ui.selectTrack(ui.ids[1]);
    assert.equal(confirmButton(), undefined);
    assert.equal(writes.length, 0);
    await ui.selectTrack(ui.ids[0]);
    assert.equal(confirmButton(), undefined, 'a stale confirmation must not reappear on return');
    await ui.flush(() => cancelButton().click());
    await ui.flush(() => confirmButton().click());
    assert.equal(writes.length, 1);
    assert.equal(writes[0].consultationId, detail.consultations[0].id);
    assert.equal(writes[0].status, 'canceled');
    assert.equal(networkAttempts, 0);
  } finally { await ui.close(); }
});

test('replacement of the confirmed consultation invalidates the pending action', async () => {
  writes.length = 0;
  const detail = phoneDetail();
  const ui = await mount(detail);
  try {
    await ui.flush(() => cancelButton().click());
    assert.ok(confirmButton());
    const next = structuredClone(detail);
    next.consultations[0].id = 'replacement-phone';
    ui.props.detail = next;
    await ui.flush(() => ui.props.onFocusTrack(ui.ids[0]));
    assert.equal(confirmButton(), undefined);
    assert.equal(writes.length, 0);
  } finally { await ui.close(); }
});
