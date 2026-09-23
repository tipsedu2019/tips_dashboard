import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement, useEffect, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url), rootPath = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function modules(supabase, overrides) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    let inputSource = readFileSync(file, 'utf8');
    if (file.endsWith('/class-schedule-workspace.tsx')) inputSource = inputSource.replace('  const classScheduleWorkspaceContent = (',
      '  require("@test/observer").observe({ generationPreview, previewLessonSessionGeneration, confirmLessonSessionGeneration, setFocusedLessonMonthKey, lessonPlanBaseline, lessonPlanDraft, lessonPlanForSave, lessonDesignSnapshot, normalizedLessonSessionDraft, normalizedLessonSessionDrafts, lessonDesignSaveError, lessonDesignSaveNotice, updateLessonPlanDraft, setLessonDesignDetail, updateNormalizedLessonSessionDraft, saveNormalizedLessonSession, handleSaveLessonPlan, requestLessonDesignClose, refreshSelectedLessonDetail, setSelectedLessonSessionId, mutationToken: lessonMutationLifecycleRef.current?.capture(selectedRow?.id) });\n  const classScheduleWorkspaceContent = (');
    const source = ts.transpileModule(inputSource, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === '@/lib/supabase') return { supabase };
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, specifier); return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return (entry) => load(path.join(rootPath, entry));
}
const id = (n) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const academicFilters = { periodId: null, search: '', status: null, subject: null, grade: null, teacher: null, classroom: null, viewMode: 'all' };
const operationsFilters = { termId: null, search: '', subject: null, grade: null, teacher: null, syncGroupId: null };
function academicRow(n) {
  return { id: id(n), title: `수업 ${n}`, fullTitle: `[가] 수업 ${n}`, subject: '수학', subjectAreaKey: '', grade: '고1', term: '',
    teacherNames: ['교사'], teacherSummary: '교사', classroomNames: [], classroomSummary: '', schedule: '',
    status: '수강', statusFilter: '수강', classGroupIds: [id(900)], classGroupNames: ['학기'], classGroupLabel: '학기',
    textbookCount: 1, textbookCatalog: [], textbookTitles: [], textbookSummary: '1권 연결', textbookOverflowCount: 0, textbookScopeLabels: [],
    totalSessions: 1, completedSessions: 2, updatedSessions: 2, delayedSessions: 0, plannedSessions: 2, progressTargetSessions: 1,
    delayedProgressSessions: 0, plannedProgressSessions: 2, progressPercent: 200, progressTargetPercent: 200,
    lastUpdatedAt: '', stateLabel: '계획 완료', latestNoteSummary: '', latestNoteSessionLabel: '', pendingSessionLabels: [], nextSession: null, sessionSummaries: [], searchText: `수업 ${n}` };
}
const operationsRow = (n) => ({ id: id(n), name: `[가] 수업 ${n}`, subject: '수학', grade: '고1', schedule: '', termId: null,
  teacherName: null, termName: null, syncGroupId: null, syncGroupName: null, status: '', updatedAt: null });
function response(domain, request, totalCount = 260, patch = {}) {
  const { p_page: page, p_page_size: pageSize } = request.args;
  const rows = Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) =>
    (domain === 'academic' ? academicRow : operationsRow)((page - 1) * pageSize + i + 1));
  return { page, pageSize, totalCount, rows, ...(domain === 'academic' ? {
    resolvedPeriodId: request.args.p_filters.periodId,
    stats: { total: totalCount, managedClassCount: totalCount, totalSessions: totalCount, completedSessions: 520, pendingSessions: 0,
      linkedTextbooks: 260, unlinkedClassCount: 0, noScheduleClassCount: 0, updateNeededClassCount: 0, completedClassCount: 260,
      viewModeCounts: { all: 270, unlinked: 10, unscheduled: 0, update: 0, done: 260 } },
    filterOptions: { periods: [{ value: id(900), label: '학기', isDefault: true }], statuses: ['수강'], subjects: ['수학'], grades: ['고1'], teachers: ['교사'], classrooms: [] },
  } : { stats: { total: totalCount, active: totalCount, draft: 0 }, filterOptions: { terms: [], subjects: ['수학'], grades: ['고1'], teachers: [], syncGroups: [{ value: id(900), label: '그룹' }] },
    syncGroupCounts: [{ groupId: id(900), memberCount: totalCount, representativeClassId: id(999) }] }), ...patch };
}
async function setup(t, domain, initial = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/admin/${domain === 'academic' ? 'curriculum' : 'class-schedule'}${initial.search || ''}` });
  if (initial.route) dom.window.history.replaceState(null, '', `/admin/${initial.route}${initial.search || ''}`);
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollTo = function ({top = 0}) { this.scrollTop = top; };
  // react-dom was loaded before JSDOM; its legacy input-event fallback needs these DOM-only shims.
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify({ 'academic:curriculum': { mode: 'manual', pageSize: initial.pageSize || 10 }, 'operations:class-schedule': { mode: 'manual', pageSize: initial.pageSize || 10 } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  let auth = { user: { id: id(800), app_metadata: { role: 'teacher' } }, role: 'admin', loading: false, session: null, ...initial.auth };
  const requests = [], supabase = { from(table) { return { update(payload) { const pending = Promise.withResolvers(), request = { name: 'update:' + table, args: payload, ...pending }; requests.push(request); const chain = { select() { return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; }, abortSignal() { return chain; }, retry() { return pending.promise; } }; return chain; } }; }, rpc(name, args) {
    const pending = Promise.withResolvers(), request = { name, args, ...pending }; requests.push(request);
    return { then: pending.promise.then.bind(pending.promise), abortSignal(signal) { request.signal = signal; return this; }, retry() { return pending.promise; } };
  } };
  let normalized = { status: 'ready', value: {source: 'legacy', sessions: []} }; // Explicit read-only synthetic backend state; no network.

  let previousSearch = '', params = new URLSearchParams();
  let observed;
  const load = modules(supabase, {
    '@test/observer': { observe(value) { observed = value; } },
    '@/providers/auth-provider': { useAuth: () => auth },
    './use-continuous-class-schedule': { useContinuousClassSchedule: () => normalized },
    '@/lib/public-classes-cache-invalidation.js': { invalidatePublicClassesCacheAfterMutation: async () => ({status: 'ready'}) },
    'next/navigation': { useRouter: () => router, usePathname: () => window.location.pathname, useSearchParams: () => {
      if (previousSearch !== window.location.search) { previousSearch = window.location.search; params = new URLSearchParams(previousSearch); } return params;
    } },
  });
  const writes = [];
  const router = { replace(url) { writes.push(url); window.history.replaceState(null, '', url); }, push(url) { window.history.pushState(null, '', url); } };
  const useHook = load(`src/features/${domain}/use-${domain}-workspace-data.ts`)[domain === 'academic' ? 'useAcademicWorkspaceData' : 'useOperationsWorkspaceData'];
  const records = load(`src/features/${domain}/records.js`);
  let props = { mode: domain === 'academic' ? 'curriculum' : 'class_schedule', ...(domain === 'academic' ? academicFilters : operationsFilters), cursor: null, ...initial.request }, state, mountKey = 0;
  const Workspace = initial.workspace ? load(`src/features/${domain}/${domain === 'academic' ? 'curriculum' : 'class-schedule'}-workspace.tsx`)[domain === 'academic' ? 'AcademicCurriculumWorkspace' : 'ClassScheduleWorkspace'] : null;
  function Probe(props) {
    const result = useHook(props); useEffect(() => { state = result; });
    const rows = result.data?.page?.rows || [];
    const model = domain === 'academic' ? records.buildCurriculumWorkspaceModel({ precomputedRows: rows, numbered: true })
      : records.buildClassScheduleRouteModel({ classes: rows.map((row) => ({ ...row, teacher: row.teacherName, term_id: row.termId })), numbered: true,
        syncGroupCounts: result.data?.syncGroupCounts, syncGroups: result.data?.filterOptions?.syncGroups?.map((group) => ({ id: group.value, name: group.label })) });
    return createElement('div', null, model.rows.map((row) => createElement('p', { key: row.id }, row.title)));
  }
  const render = async (next = {}) => { props = { ...props, ...next }; await act(async () => {
    const element = createElement(Workspace || Probe, { ...props, key: mountKey });
    root.render(initial.strict ? createElement(StrictMode, null, element) : element);
  }); };
  await render();
  return { requests, render, load, domain, writes, normalized: async (next) => { normalized = next; await render(); }, unmount: async () => act(async () => root.unmount()), get state() { return state; }, get observed() { return observed; }, get props() { return props; },
    numbered: () => requests.filter((request) => request.name.includes('numbered_page')),
    finish: (request, total = 260, patch = {}) => request.resolve({ error: null, data: response(domain, request, total, patch) }),
    auth: async (patch) => { auth = { ...auth, ...patch }; await render(); }, remount: async () => { mountKey++; await render(); },
  };
}

const detail = () => ({ classItem: { id: id(999), name: 'SAFE CURRICULUM', subject: '수학', textbookIds: [id(700)],
  schedulePlan: { className: 'SAFE CURRICULUM', subject: '수학', selectedDays: [1], startDate: '2026-08-03', endDate: '2026-08-31',
    billingPeriods: [{ id: 'period-one', month: 8, label: '8월', startDate: '2026-08-03', endDate: '2026-08-31' }],
    sessions: [{ id: 'session-one', sessionNumber: 1, date: '2026-08-03', billingLabel: '8월', textbookEntries: [{ id: 'entry-one', textbookId: id(700), plan: { start: '1', end: '2', label: '저장 범위' } }] }] } },
  textbooks: [{ id: id(700), title: '정확한 교재', subject: '수학' }], teacherCatalogs: [], classroomCatalogs: [] });
async function editor(t, route = 'class-schedule') {
  const page = await setup(t, 'operations', { workspace: true, search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-board`, route });
  await act(async () => page.requests.find(r => r.name === 'get_operations_class_lesson_design_detail_v1').resolve({error: null, data: detail()}));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  return page;
}
function editPlan(page, name) { return act(async () => page.observed.updateLessonPlanDraft(p => ({ ...p, billingPeriods: p.billingPeriods.map((period, index) => index ? period : {...period, color: name}) }))); }
async function refreshDetail(page, next = detail()) { await act(async () => page.observed.setLessonDesignDetail(next)); }
const saveRequests = page => page.requests.filter(r => r.name.startsWith('update:') || r.name.startsWith('save_'));

test('schedule-only page exposes one save and return action even for a legacy progress URL', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  const workspace = document.querySelector('[role="region"][aria-label="일정 편성 작업 영역"]');
  assert.ok(workspace);
  const buttons = [...workspace.querySelectorAll('button')];
  assert.equal(buttons.filter(button => button.textContent.trim() === '일정 저장').length, 1);
  const returns = buttons.filter(button => button.textContent.includes('돌아가기'));
  assert.equal(returns.length, 1);
  assert.equal(workspace.querySelector('[data-testid="lesson-design-mode-tabs"]'), null);
  assert.equal(workspace.querySelector('[data-testid="lesson-progress-dialog"]'), null);
  assert.equal(workspace.querySelector('#lesson-textbook-finder'), null);
  assert.ok(workspace.querySelector('[data-testid="lesson-mobile-session-list"]'));
  assert.ok(workspace.querySelector('[data-testid="lesson-desktop-calendar"]'));
  assert.equal(saveRequests(page).length, 0);
  assert.equal(dirty(), false);
  await act(async () => returns[0].click());
  assert.equal(window.location.pathname, '/admin/curriculum');
  assert.equal(saveRequests(page).length, 0);
});

test('schedule-only return keeps an edited draft when the operator continues editing', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await editPlan(page, 'UNSAVED SCHEDULE');
  const returnButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('돌아가기'));
  assert.ok(returnButton);
  await act(async () => { returnButton.focus(); returnButton.click(); });
  const confirmation = document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
  assert.ok(confirmation);
  const continueButton = [...confirmation.querySelectorAll('button')].find(button => button.textContent === '계속 편집');
  assert.ok(continueButton);
  await act(async () => continueButton.click());
  assert.equal(window.location.pathname, '/admin/curriculum/lesson-design');
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'UNSAVED SCHEDULE');
  assert.equal(dirty(), true);
  assert.equal(saveRequests(page).length, 0);
});

test('calendar: holiday cancellation and linked makeup on the same day are both named', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  const next = detail();
  next.classItem.schedulePlan = {
    selectedDays: [2, 4, 6],
    billingPeriods: [
      { id: 'september', label: '9월', month: 9, startDate: '2026-09-01', endDate: '2026-10-01' },
      { id: 'october', label: '10월', month: 10, startDate: '2026-10-03', endDate: '2026-10-31' },
    ],
    sessionStates: {
      '2026-09-26': { state: 'exception' },
      '2026-10-10': { state: 'exception', makeupDate: '2026-09-26', makeupMemo: '보강 11:00-13:00' },
    },
    sessions: [],
  };
  await refreshDetail(page, next);
  const cell = document.querySelector('[data-lesson-calendar-date="2026-09-26"]');
  assert.ok(cell);
  assert.match(cell.textContent, /휴강/);
  assert.match(cell.textContent, /보강/);
  assert.match(cell.getAttribute('aria-label'), /휴강.*보강/);
  assert.equal(page.observed.lessonDesignSnapshot.sessions.filter(s => s.dateValue === '2026-09-26').length, 2);
  assert.equal(saveRequests(page).length, 0);
  assert.equal(dirty(), false);
});
async function finishSave(page, data = null, failRead = false) {
  await act(async () => saveRequests(page).at(-1).resolve({error: null, data}));
  const read = page.requests.filter(r => r.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  await act(async () => failRead ? read.reject(new Error('synthetic read unavailable')) : read.resolve({error: null, data: detail()}));
}
async function normalizedEditor(t) {
  const page = await editor(t);
  await page.normalized({ status: 'ready', value: { source: 'normalized', data: {scheduleRevision: 1, contentHash: 'safe-hash', sessions: [
    {id: id(600), session_key: 'session-one', session_date: '2026-08-03', session_number: 1, revision: 1, schedule_state: 'active', memo: 'ORIGINAL' },
  ]} } });
  await act(async () => page.observed.setSelectedLessonSessionId(id(600)));
  assert.ok(page.observed.normalizedLessonSessionDraft, JSON.stringify(page.observed.lessonDesignSnapshot?.sessions));
  return page;
}
test('plan: same-class refreshed source preserves an authored draft', async t => {
  const page = await editor(t); await editPlan(page, 'ADDITIONAL INPUT');
  const next = detail(); next.classItem.schedulePlan.className = 'SERVER REFRESH';
  await refreshDetail(page, next);
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'ADDITIONAL INPUT');
});
test('plan: accepted save preserves input added while pending and failed re-read does not claim write failure', async t => {
  const page = await editor(t); await editPlan(page, 'SUBMITTED');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1);
  assert.equal(saveRequests(page)[0].args.schedule_plan.billingPeriods[0].color, 'SUBMITTED');
  await editPlan(page, 'ADDED WHILE SAVING');
  await finishSave(page, null, true);
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'ADDED WHILE SAVING');
  assert.match(page.observed.lessonDesignSaveNotice, /저장/);
  assert.match(page.observed.lessonDesignSaveError, /다시 불러/);
  assert.equal(saveRequests(page).length, 1);
});
test('normalized session: real save reaches the service once and preserves edits made while pending', async t => {
  const page = await normalizedEditor(t);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'SUBMITTED'}));
  await act(async () => { void page.observed.saveNormalizedLessonSession(); void page.observed.saveNormalizedLessonSession(); });
  assert.equal(saveRequests(page).length, 1, JSON.stringify({draft: page.observed.normalizedLessonSessionDraft, token: page.observed.mutationToken, error: page.observed.lessonDesignSaveError}));
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'ADDITIONAL INPUT'}));
  assert.equal(saveRequests(page)[0].args.p_expected_revision, 1);
  assert.equal(saveRequests(page)[0].args.p_session_date, '2026-08-03');
  await finishSave(page, {revision: 2});
  assert.equal(page.observed.normalizedLessonSessionDrafts[id(600)]?.memo, 'ADDITIONAL INPUT');
});

function dirty() { const event = new window.Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented; }
async function confirm(text) {
  const dialog = document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'); assert.ok(dialog);
  const button = [...dialog.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button);
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
}
for (const route of ['class-schedule', 'curriculum', 'curriculum/lesson-design']) test(`${route}: clean read, revert, protected close and confirmed destination`, async t => {
  const page = await editor(t, route); assert.equal(dirty(), false);
  const original = page.observed.lessonPlanDraft.billingPeriods[0].color;
  await editPlan(page, 'CHANGED'); assert.equal(dirty(), true);
  await editPlan(page, original); assert.equal(dirty(), false);
  await editPlan(page, 'KEEP');
  await act(async () => page.observed.requestLessonDesignClose());
  assert.ok(document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'));
  await confirm('계속 편집'); assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'KEEP');
  await act(async () => page.observed.requestLessonDesignClose());
  await confirm('변경사항 버리기');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(window.location.pathname, '/admin/curriculum');
  assert.equal(new URLSearchParams(window.location.search).has('classId'), false);
});
test('plan: submission then revert to old value remains dirty after accepted save; duplicate writes are blocked', async t => {
  const page = await editor(t), original = page.observed.lessonPlanDraft.billingPeriods[0].color;
  await editPlan(page, 'SUBMITTED');
  await act(async () => { void page.observed.handleSaveLessonPlan(); void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1);
  await editPlan(page, original); assert.equal(dirty(), false);
  await finishSave(page);
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, original);
  assert.equal(dirty(), true, 'the accepted value changed even though the user reverted before the response');
});
test('normalized session: unchanged/reverted draft is clean and accepted revision is reused', async t => {
  const page = await normalizedEditor(t); assert.equal(dirty(), false);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'EDITED'})); assert.equal(dirty(), true);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'ORIGINAL'})); assert.equal(dirty(), false);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'SUBMITTED'}));
  await act(async () => { void page.observed.saveNormalizedLessonSession(); });
  await finishSave(page, {revision: 2}, true);
  assert.equal(dirty(), false, 'accepted write is clean even when its read fails');
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: 'NEXT'}));
  await act(async () => { void page.observed.saveNormalizedLessonSession(); });
  assert.equal(saveRequests(page).at(-1).args.p_expected_revision, 2);
});
test('normalized read: a loading read must never fall through to a legacy classes update', async t => {
  const page = await normalizedEditor(t); await editPlan(page, 'CONTENT');
  await page.normalized({status: 'loading'});
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 0);
  assert.equal(dirty(), true);
});
test('plan: failed write retains its draft and a retry submits the current values', async t => {
  const page = await editor(t); await editPlan(page, 'RETRY DRAFT');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  await act(async () => saveRequests(page)[0].resolve({error: new Error('internal synthetic save error'), data: null}));
  assert.equal(dirty(), true); assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'RETRY DRAFT');
  assert.match(page.observed.lessonDesignSaveError, /다시 저장/);
  assert.equal(page.observed.lessonDesignSaveError.includes('internal'), false);
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 2);
  assert.equal(saveRequests(page).at(-1).args.schedule_plan.billingPeriods[0].color, 'RETRY DRAFT');
});
test('actor: a late accepted save cannot replace the new actor draft or leave dirty protection enabled', async t => {
  const page = await editor(t); await editPlan(page, 'OLD ACTOR');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  const oldSave = saveRequests(page)[0];
  await page.auth({user: null, role: null});
  await act(async () => oldSave.resolve({error: null, data: null}));
  assert.equal(dirty(), false); assert.equal(page.observed.lessonPlanDraft, null);
  assert.equal(page.observed.lessonDesignSaveNotice, '');
});
test('normalized session: accepted trimmed input becomes clean and later authoritative data replaces clean overrides', async t => {
  const page = await normalizedEditor(t);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: '  submitted  '}));
  await act(async () => { void page.observed.saveNormalizedLessonSession(); });
  await finishSave(page, {revision: 2}, true);
  assert.equal(dirty(), false, 'server-normalized submitted input is accepted when there is no newer edit');
  assert.equal(page.observed.normalizedLessonSessionDraft.memo, 'submitted');
  await page.normalized({status: 'ready', value: {source: 'normalized', data: {scheduleRevision: 1, contentHash: 'fresh', sessions: [
    {id: id(600), session_key: 'session-one', session_date: '2026-08-03', session_number: 1, revision: 3, schedule_state: 'active', memo: 'FRESH READ'},
  ]}}});
  assert.equal(page.observed.normalizedLessonSessionDraft.memo, 'FRESH READ');
  assert.equal(dirty(), false);
});
test('normalized schedule: calendar opens authoritative session editing without creating a legacy draft', async t => {
  const page = await normalizedEditor(t);
  window.history.replaceState(null, '', `?lessonDesign=1&classId=${id(999)}&section=lesson-design-periods&sessionId=${id(600)}`);await page.render();
  const add = [...document.querySelectorAll('button')].find(b => b.textContent === '월 추가');
  assert.ok(!add || add.disabled, 'normalized schedule must not offer a legacy-only month write');
  const cell = document.querySelector('[data-lesson-calendar-date="2026-08-03"]');assert.ok(cell);
  await act(async () => cell.click());
  assert.equal(dirty(), false, 'selecting a normalized calendar day does not toggle legacy sessionStates');
  assert.ok(document.querySelector('[data-testid="normalized-lesson-session-details"]'), 'calendar click opens the real session editor directly');
  assert.equal(document.querySelector('[data-lesson-calendar-date="2026-08-04"]').tagName, 'DIV', 'an uncreated day has no pretend creation action');
  assert.equal(cell.draggable, false);
  assert.deepEqual(page.observed.lessonDesignSnapshot.sessions.map(s=>s.id), [id(600)], 'only authoritative sessions are presented');
  assert.ok(document.querySelector('input[aria-label="일정 조회·생성 월"]'));
});

test('normalized generation: a late preview from another month cannot authorize current-month creation', async t => {
 const page = await normalizedEditor(t);
 await act(async()=>{void page.observed.previewLessonSessionGeneration();});
 const preview=page.requests.filter(r=>r.name==='preview_class_lesson_session_generation_v1').at(-1);assert.ok(preview);
 await act(async()=>page.observed.setFocusedLessonMonthKey('2026-10'));
 await act(async()=>preview.resolve({error:null,data:{creatableCount:1,existingCount:0,resourceConflictCount:0}}));
 assert.equal(page.observed.generationPreview,null);
});
test('normalized generation: preview and creation each reject same-turn duplicate clicks', async t => {
 const page = await normalizedEditor(t);
 await act(async()=>{void page.observed.previewLessonSessionGeneration();void page.observed.previewLessonSessionGeneration();});
 const previews=page.requests.filter(r=>r.name==='preview_class_lesson_session_generation_v1');assert.equal(previews.length,1);
 await act(async()=>previews[0].resolve({error:null,data:{creatableCount:1,existingCount:0,resourceConflictCount:0}}));
 await act(async()=>{void page.observed.confirmLessonSessionGeneration();void page.observed.confirmLessonSessionGeneration();});
 assert.equal(page.requests.filter(r=>r.name==='generate_class_lesson_sessions_v1').length,1);
});

test('normalized generation previews dates without mutating saved sessions and disables an all-existing confirmation', async t => {
 const page = await normalizedEditor(t);
 const original = page.observed.lessonDesignSnapshot.sessions.map(session => session.id);
 await act(async()=>{void page.observed.previewLessonSessionGeneration();});
 const preview = page.requests.filter(request => request.name === 'preview_class_lesson_session_generation_v1').at(-1);
 const month = preview.args.p_date_from.slice(0,7);
 await act(async()=>preview.resolve({error:null,data:{creatableCount:0,existingCount:1,candidates:[{sessionKey:'existing-key',sessionDate:`${month}-03`,status:'existing'}]}}));
 const list = document.querySelector('[aria-label="일정 생성 미리보기"]');
 assert.ok(list?.textContent.includes(`${month}-03`));
 assert.ok(list.textContent.includes('기존'));
 const button = [...document.querySelectorAll('button')].find(node => node.textContent === '추가할 일정 없음');
 assert.equal(button?.disabled,true);
 assert.deepEqual(page.observed.lessonDesignSnapshot.sessions.map(session => session.id),original);
 assert.equal(page.requests.some(request => request.name === 'generate_class_lesson_sessions_v1'), false);
});
