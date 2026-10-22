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
import { buildLegacyMakeupApprovalPlan } from '../src/features/makeup-requests/makeup-approval-plan.js';
import { buildSchedulePlanForSave } from '../src/lib/class-schedule-planner.js';

const require = createRequire(import.meta.url), rootPath = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function modules(supabase, overrides, sourceOverrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    let inputSource = sourceOverrides[path.relative(rootPath, file)] ?? readFileSync(file, 'utf8');
    if (file.endsWith('/class-schedule-workspace.tsx')) inputSource = inputSource.replace('  const classScheduleWorkspaceContent = (',
      '  require("@test/observer").observe({ generationPreview, previewLessonSessionGeneration, confirmLessonSessionGeneration, focusedLessonMonthKey, selectedLessonMonthKeys, selectedLessonSessionId, setFocusedLessonMonthKey, lessonPlanBaseline, lessonPlanDraft, lessonPlanForSave, lessonDesignSnapshot, normalizedLessonSessionDraft, normalizedLessonSessionDrafts, lessonDesignSaveError, lessonDesignSaveNotice, updateLessonPlanDraft, setLessonDesignDetail, updateNormalizedLessonSessionDraft, saveNormalizedLessonSession, handleSaveLessonPlan, requestLessonDesignClose, refreshSelectedLessonDetail, setSelectedLessonSessionId, mutationToken: lessonMutationLifecycleRef.current?.capture(selectedRow?.id) });\n  const classScheduleWorkspaceContent = (');
    if (file.endsWith('/class-schedule-workspace.tsx')) inputSource += '\nexport { buildLessonDesignSnapshot as __testBuildLessonDesignSnapshot };\n';
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
    return { then: pending.promise.then.bind(pending.promise), abortSignal(signal) { request.signal = signal; return this; }, retry(enabled) { request.retryEnabled = enabled; return pending.promise; } };
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
  }, initial.sourceOverrides || globalThis.__classScheduleTestSourceOverrides || {});
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

const detail = () => {
  // A saved legacy period is materialized in full, with canonical billing/occupancy
  // fields. A sparse single-row mock would fabricate unsaved historical lessons.
  const schedulePlan = buildSchedulePlanForSave({ className: 'SAFE CURRICULUM', subject: '수학', selectedDays: [1],
    billingPeriods: [{ id: 'period-one', month: 8, label: '8월', startDate: '2026-08-03', endDate: '2026-08-31' }],
    sessions: [] });
  Object.assign(schedulePlan.sessions[0], { id: 'session-one', sessionKey: 'session-one',
    textbookEntries: [{ id: 'entry-one', textbookId: id(700), plan: { start: '1', end: '2', label: '저장 범위' } }] });
  return { classItem: { id: id(999), name: 'SAFE CURRICULUM', subject: '수학', textbookIds: [id(700)],
    schedule: '월화일 17:00-19:00', teacher: '합성 담당', room: '합성 강의실', schedulePlan },
    textbooks: [{ id: id(700), title: '정확한 교재', subject: '수학' }],
    teacherCatalogs: [{id:id(101),name:'합성 담당',subjects:['수학'],isVisible:true}],
    classroomCatalogs: [{id:id(201),name:'합성 강의실',subjects:['수학'],isVisible:true}] };
};
async function editor(t, route = 'class-schedule') {
  const page = await setup(t, 'operations', { workspace: true, search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-board`, route });
  await act(async () => page.requests.find(r => r.name === 'get_operations_class_lesson_design_detail_v1').resolve({error: null, data: detail()}));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  return page;
}
function editPlan(page, name) { return act(async () => page.observed.updateLessonPlanDraft(p => ({ ...p, billingPeriods: p.billingPeriods.map((period, index) => index ? period : {...period, color: name}) }))); }

test('legacy month count includes makeup and excludes cancelled lessons, and save preserves entered resources', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await act(async () => page.observed.updateLessonPlanDraft(p => ({ ...p, selectedDays:[2,0], sessions:[],
    billingPeriods:[{id:'oct',month:10,label:'10월',startDate:'2026-09-29',endDate:'2026-10-27'}],
    sessionStates:{'2026-10-13':{state:'exception'},'2026-10-18':{state:'exception'},'2026-10-09':{state:'makeup'}},
  })));
  const period = document.querySelector('[id^="lesson-design-period-detail-"]');
  assert.equal(period.querySelector('[data-slot="badge"]').textContent, '8회');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length,1, 'missing inherited details do not block an authored date');
  assert.equal(saveRequests(page)[0].args.p_patch.schedule_plan.sessions.find(row => row.date === '2026-10-09').startTime, undefined);
  await act(async () => saveRequests(page)[0].resolve({ data: null, error: { code: 'synthetic_transport', message: 'synthetic unanswered save' } }));
  await act(async () => page.observed.updateLessonPlanDraft(p => ({...p,sessionSchedules:{'2026-10-09':{startTime:'19:20',endTime:'21:20',teacherCatalogId:id(101),classroomCatalogId:id(201)}}})));
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length,2);
  const makeup = saveRequests(page)[1].args.p_patch.schedule_plan.sessions.find(s => s.date==='2026-10-09');
  assert.equal(makeup.startTime,'19:20'); assert.equal(makeup.classroomCatalogId,id(201));
});
async function refreshDetail(page, next = detail()) { await act(async () => page.observed.setLessonDesignDetail(next)); }
const saveRequests = page => page.requests.filter(r => r.name.startsWith('update:') || r.name.startsWith('save_') || r.name === 'update_class_operational_v1');

function septemberOctoberDetail() {
  const payload = detail();
  Object.assign(payload.classItem, { subject: '영어', schedule: '화목 17:00-19:00' });
  payload.teacherCatalogs = [
    {id:id(101),name:'합성 담당',subjects:['영어'],isVisible:true},
    {id:id(102),name:'다른 합성 담당',subjects:['영어'],isVisible:true},
  ];
  payload.classroomCatalogs = [
    {id:id(201),name:'합성 강의실',subjects:['영어'],isVisible:true},
    {id:id(202),name:'다른 합성 강의실',subjects:['영어'],isVisible:true},
  ];
  payload.classItem.schedulePlan = buildSchedulePlanForSave({ className: 'SAFE CURRICULUM', subject: '영어', selectedDays:[2,4],
    billingPeriods:[
      {id:'september',month:9,label:'9월',startDate:'2026-09-01',endDate:'2026-09-29'},
      {id:'october',month:10,label:'10월',startDate:'2026-10-02',endDate:'2026-10-27'},
    ],
    sessionStates:{'2026-09-24':{state:'exception'}},
    sessionSchedules:{'2026-10-08':{startTime:'16:00',endTime:'18:00',teacherCatalogId:id(102),classroomCatalogId:id(202)}},
    sessions:[],
  });
  for (const row of payload.classItem.schedulePlan.sessions) {
    row.teacherNote = `합성 저장 메모 ${row.date}`;
    row.textbookEntries = [{id:`entry-${row.date}`,textbookId:id(700),plan:{start:row.date,end:row.date,label:`합성 범위 ${row.date}`}}];
  }
  return payload;
}

async function changeInput(label, value) {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, `rendered input ${label}`);
  assert.equal(input.disabled, false);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);
    input.dispatchEvent(new window.Event('input',{bubbles:true}));
    input.dispatchEvent(new window.Event('change',{bubbles:true}));
    // React's input plugin was initialized before JSDOM. Exercise its native
    // keyboard fallback too, rather than invoking the component callback.
    input.dispatchEvent(new window.KeyboardEvent('keyup',{key:'1',bubbles:true}));
  });
  assert.equal(input.value,value);
}

async function changeTextarea(textarea, value) {
  assert.ok(textarea, 'rendered memo textarea');
  assert.equal(textarea.disabled, false);
  await act(async () => {
    textarea.focus();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    textarea.dispatchEvent(new window.KeyboardEvent('keyup', { key: '1', bubbles: true }));
  });
  assert.equal(textarea.value, value);
}

function missingOctoberDetail() {
  const payload = detail();
  Object.assign(payload.classItem, { subject: '영어', schedule: '화목 19:30-21:30' });
  payload.classItem.schedulePlan = buildSchedulePlanForSave({ selectedDays: [2, 4],
    billingPeriods: [
      [4, '2026-04-02', '2026-04-30'], [6, '2026-05-05', '2026-06-02'],
      [6, '2026-06-04', '2026-06-30'], [7, '2026-07-02', '2026-07-30'],
      [8, '2026-08-04', '2026-08-27'], [9, '2026-09-01', '2026-09-29'],
      [11, '2026-11-03', '2026-11-26'], [12, '2026-12-01', '2026-12-24'],
    ].map(([month, startDate, endDate], index) => ({ id: `synthetic-period-${index}`, month, startDate, endDate })),
    sessionStates: { '2026-04-04': { state: 'force_active' }, '2026-04-11': { state: 'force_active' } },
  });
  for (const row of payload.classItem.schedulePlan.sessions) {
    row.teacherNote = `합성 보존 기록 ${row.date}`;
    row.textbookEntries = [{ textbookId: id(700), plan: { label: '합성 학습 기록' } }];
    row.progressStatus = 'done';
  }
  assert.equal(payload.classItem.schedulePlan.sessions.length, 70);
  return payload;
}

test('explicit past month adds October nine with matching billing labels and preserves all seventy saved rows', async t => {
  const payload = missingOctoberDetail(), saved = structuredClone(payload.classItem.schedulePlan);
  const page = await setup(t, 'operations', { workspace: true, route: 'curriculum/lesson-design',
    search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-periods` });
  await act(async () => page.requests.find(r => r.name === 'get_operations_class_lesson_design_detail_v1').resolve({ error: null, data: payload }));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  await changeInput('추가할 연월', '2026-10');
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '월 추가').click());
  const october = document.getElementById('lesson-design-period-detail-2026-10');
  assert.ok(october);
  assert.match(october.textContent, /10월/);
  assert.equal(october.querySelector('[data-slot="badge"]').textContent, '9회');
  assert.equal(saveRequests(page).length, 0, 'adding a month only edits the draft');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1);
  const request = saveRequests(page)[0], plan = request.args.p_patch.schedule_plan;
  assert.deepEqual(request.args.p_expected_schedule_plan, saved);
  assert.equal(plan.sessions.length, 79);
  for (const original of saved.sessions) assert.deepEqual(plan.sessions.find(row => row.id === original.id), original);
  const added = plan.sessions.filter(row => row.date.startsWith('2026-10'));
  assert.deepEqual(added.map(row => row.date), [1,6,8,13,15,20,22,27,29].map(day => `2026-10-${String(day).padStart(2,'0')}`));
  assert.ok(added.every(row => row.billingLabel === '10월'));
  assert.ok(added.every(row => row.startTime === '19:30' && row.endTime === '21:30'));
  assert.deepEqual(plan.billingPeriods.filter(period => saved.billingPeriods.some(old => old.id === period.id)), saved.billingPeriods);
  const addedPeriod = plan.billingPeriods.find(period => period.id === added[0].billingId);
  assert.deepEqual([addedPeriod.month, addedPeriod.label, addedPeriod.startDate, addedPeriod.endDate], [10, '10월', '2026-10-01', '2026-10-29']);
  assert.equal(plan.sessions.filter(row => row.date.startsWith('2026-11')).length, 8);
  assert.equal(plan.sessions.filter(row => row.date.startsWith('2026-12')).length, 8);
});

test('v1 authored month save keeps raw seventy-row order, whitespace and history through an uncertain response and explicit retry', async t => {
  const payload = missingOctoberDetail();
  payload.classItem.schedulePlan.sessions.reverse();
  payload.classItem.schedulePlan.sessions[0].memo = '  synthetic\n memo  ';
  payload.classItem.schedulePlan.sessions[0].opaqueAudit = { historical: true };
  const saved = structuredClone(payload.classItem.schedulePlan);
  const page = await recoveryEditor(t, payload);
  await page.normalized({ status: 'ready', value: { source: 'legacy', sessions: [],
    effectiveScheduleContext: { version: 1, basicSlots: [], catalogs: { teachers: [], rooms: [] } } } });
  assert.deepEqual(page.observed.lessonPlanForSave.sessions, saved.sessions, 'opening the v1 reader does not materialize weekly predictions');
  await changeInput('추가할 연월', '2026-10');
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '월 추가').click());
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const first = saveRequests(page)[0], sent = first.args.p_patch.schedule_plan;
  assert.deepEqual(sent.sessions.slice(0, 70), saved.sessions);
  assert.deepEqual(sent.history, saved.history);
  assert.deepEqual(sent.sessions.slice(70).map(row => row.date), [1,6,8,13,15,20,22,27,29].map(day => `2026-10-${String(day).padStart(2, '0')}`));
  assert.ok(sent.sessions.slice(70).every(row => !Object.hasOwn(row, 'teacherCatalogId') && !Object.hasOwn(row, 'startTime')));
  assert.equal(sent.billingPeriods.at(-1).month, 10);
  assert.equal(sent.sessions.filter(row => row.date.startsWith('2026-11')).length, 8);
  assert.equal(sent.sessions.filter(row => row.date.startsWith('2026-12')).length, 8);
  await act(async () => first.reject(new Error('synthetic response lost')));
  assert.equal(dirty(), true);
  assert.deepEqual(page.observed.lessonPlanForSave, sent);
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 2);
  assert.deepEqual(saveRequests(page)[1].args, first.args, 'uncertain retry retains the identical body, CAS baseline and request key');
});

test('same-date distinct IDs edit only the selected explicit row and preserve sparse same-period peers', async t => {
  const payload = septemberOctoberDetail();
  const source = payload.classItem.schedulePlan.sessions.find(row => row.date === '2026-10-08');
  const peer = { ...source, id: 'synthetic-peer', sessionKey: 'synthetic-peer', memo: ' peer whitespace  ', startTime: '20:00', endTime: '21:00' };
  source.memo = '  selected\n memo  ';
  payload.classItem.schedulePlan.sessions = [peer, source];
  payload.classItem.schedulePlan.sessionSchedules = {};
  const saved = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  await page.normalized({ status: 'ready', value: { source: 'legacy', sessions: [], effectiveScheduleContext: {
    version: 1, basicSlots: [], catalogs: { teachers: payload.teacherCatalogs, rooms: payload.classroomCatalogs },
  } } });
  await act(async () => page.observed.setSelectedLessonSessionId(source.id));
  const details = document.querySelector('button[aria-label="10월 상세 보기"]');
  if (details) await act(async () => details.click());
  const row = [...document.querySelectorAll('[data-lesson-period-session-id]')].find(item => item.dataset.lessonPeriodSessionId === source.id);
  await act(async () => row.querySelector('button').click());
  assert.equal(document.querySelector(`textarea[aria-label="${page.observed.lessonDesignSnapshot.sessions.find(item => item.id === source.id).label} 메모"]`).value, source.memo);
  await changeInput('2026-10-08 시작', '15:30');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const sent = saveRequests(page)[0].args.p_patch.schedule_plan;
  assert.deepEqual(sent.sessions, [saved.sessions[0], { ...saved.sessions[1], startTime: '15:30' }]);
  assert.deepEqual(sent.billingPeriods, saved.billingPeriods);
  assert.deepEqual(sent.history, saved.history);
  assert.equal(page.observed.lessonDesignSnapshot.sessions.length, 2, 'display never predicts missing weekly rows');
});

test('rolling legacy month generation preserves opaque historical elements at their original array positions', async t => {
  const payload = missingOctoberDetail();
  payload.classItem.schedulePlan.sessions.splice(1, 0, null, 'opaque historical element');
  const saved = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  assert.deepEqual(page.observed.lessonPlanForSave.sessions, saved.sessions);
  await changeInput('추가할 연월', '2026-10');
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '월 추가').click());
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const sent = saveRequests(page)[0].args.p_patch.schedule_plan;
  assert.deepEqual(sent.sessions.slice(0, saved.sessions.length), saved.sessions);
  assert.equal(sent.sessions.length, saved.sessions.length + 9);
  assert.deepEqual(sent.history, saved.history);
});

test('month picker distinguishes years, blocks duplicate months and retains the chosen month after rejected date edits', async t => {
  const payload = missingOctoberDetail();
  const page = await setup(t, 'operations', { workspace: true, route: 'curriculum/lesson-design',
    search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-periods` });
  await act(async () => page.requests.find(r => r.name === 'get_operations_class_lesson_design_detail_v1').resolve({ error: null, data: payload }));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  const addButton = () => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '월 추가');
  assert.equal(document.querySelector('input[aria-label="추가할 연월"]').value, '2027-01');
  await changeInput('추가할 연월', '2026-11');
  assert.equal(addButton().disabled, true);
  assert.match(document.getElementById('lesson-month-add-error').textContent, /이미 있습니다/);
  assert.equal(page.observed.lessonPlanForSave.sessions.length, 70);
  for (const month of ['2025-10', '2026-10', '2027-01']) {
    await changeInput('추가할 연월', month);
    assert.equal(addButton().disabled, false);
    await act(async () => addButton().click());
    assert.equal(addButton().disabled, true, 'the same month cannot be added twice');
    const card = document.getElementById(`lesson-design-period-detail-${month}`);
    assert.ok(card);
    assert.equal(card.querySelector('input[type="date"]').value.slice(0, 7), month);
  }
  assert.equal(document.querySelectorAll('input[aria-label="10월 시작일"]').length, 2, 'same month in distinct years is supported');
  const start = document.getElementById('lesson-design-period-detail-2026-10').querySelector('input[aria-label="10월 시작일"]');
  const originalDate = start.value;
  await act(async () => {
    start.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(start, '2027-10-01');
    start.dispatchEvent(new window.Event('input', { bubbles: true }));
    start.dispatchEvent(new window.Event('change', { bubbles: true }));
    start.dispatchEvent(new window.KeyboardEvent('keyup', { key: '1', bubbles: true }));
  });
  assert.equal(start.value, originalDate);
  assert.match(page.observed.lessonDesignSaveError, /선택한 2026년 10월/);
  assert.equal(saveRequests(page).length, 0);

  const addedId = page.observed.lessonPlanForSave.billingPeriods.find(period => period.startDate === '2026-10-01').id;
  await act(async () => page.observed.updateLessonPlanDraft(plan => ({ ...plan,
    billingPeriods: plan.billingPeriods.map(period => period.id === addedId ? { ...period, month: 1, label: '1월' } : period),
  })));
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length, 0, 'the submit boundary also rejects a mismatched draft');
  assert.match(page.observed.lessonDesignSaveError, /일치해야/);
});

test('legacy October date edits snapshot only two new lessons, preserve stored history and retain a conflicted save for explicit retry', async t => {
  const payload = septemberOctoberDetail(), savedPlan = structuredClone(payload.classItem.schedulePlan);
  const octoberDates = ['2026-10-06','2026-10-08','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27'];
  assert.deepEqual(savedPlan.sessions.filter(row=>row.billingId==='october').map(row=>row.date),octoberDates);
  assert.equal(savedPlan.sessions.filter(row=>row.billingId==='september' && row.scheduleState==='active').length,8);
  const page = await setup(t,'operations',{workspace:true,search:`?lessonDesign=1&classId=${id(999)}&section=lesson-design-board`,route:'curriculum/lesson-design'});
  await act(async () => page.requests.find(r=>r.name==='get_operations_class_lesson_design_detail_v1').resolve({error:null,data:payload}));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  assert.equal(dirty(),false);
  assert.equal(saveRequests(page).length,0);

  await changeInput('10월 시작일','2026-10-01');
  await changeInput('10월 종료일','2026-10-29');
  const draftRows = page.observed.lessonPlanForSave.sessions;
  for (const date of ['2026-10-01','2026-10-29']) {
    const row = draftRows.find(row=>row.date===date);
    assert.ok(row,`new ${date} lesson`);
    assert.deepEqual([row.startTime,row.endTime,row.teacherCatalogId,row.classroomCatalogId],['17:00','19:00',id(101),id(201)],`new ${date} gets a creation-time snapshot`);
    assert.equal(row.scheduleState,'active');
    assert.equal(row.isForced,false);
    assert.equal(row.originalDate,'');
  }

  const openDetails = document.querySelector('button[aria-label="10월 상세 보기"]');
  assert.ok(openDetails);
  await act(async () => openDetails.click());
  const newRow = draftRows.find(row=>row.date==='2026-10-01');
  const rowElement = [...document.querySelectorAll('[data-lesson-period-session-id]')].find(element=>element.dataset.lessonPeriodSessionId===newRow.id);
  assert.ok(rowElement);
  await act(async () => rowElement.querySelector('button').click());
  for (const label of ['시작','종료','선생님','강의실']) {
    const control = document.querySelector(`[aria-label="2026-10-01 ${label}"]`);
    assert.ok(control,`ordinary lesson exposes ${label}`);
    assert.equal(control.disabled,false);
  }
  await changeInput('2026-10-01 종료','19:30');
  assert.equal(page.observed.lessonPlanForSave.sessions.find(row=>row.date==='2026-10-01').endTime,'19:30');
  await changeInput('2026-10-01 종료','19:00');
  await changeInput('2026-10-01 시작','16:30');
  assert.equal(page.observed.lessonPlanForSave.sessions.find(row=>row.date==='2026-10-01').startTime,'16:30');
  await changeInput('2026-10-01 시작','17:00');
  const teacher = document.querySelector('select[aria-label="2026-10-01 선생님"]');
  await act(async () => { teacher.value=id(102); teacher.dispatchEvent(new window.Event('change',{bubbles:true})); });
  assert.equal(page.observed.lessonPlanForSave.sessions.find(row=>row.date==='2026-10-01').teacherCatalogId,id(102));
  await act(async () => { teacher.value=id(101); teacher.dispatchEvent(new window.Event('change',{bubbles:true})); });
  const classroom = document.querySelector('select[aria-label="2026-10-01 강의실"]');
  await act(async () => { classroom.value=id(202); classroom.dispatchEvent(new window.Event('change',{bubbles:true})); });
  assert.equal(page.observed.lessonPlanForSave.sessions.find(row=>row.date==='2026-10-01').classroomCatalogId,id(202));
  await act(async () => { classroom.value=id(201); classroom.dispatchEvent(new window.Event('change',{bubbles:true})); });

  const save = () => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='일정 저장');
  assert.ok(save());
  await act(async () => save().click());
  assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
  const first = saveRequests(page)[0], sent = first.args.p_patch.schedule_plan;
  assert.equal(first.retryEnabled,false,'the real service explicitly disables SDK mutation retries');
  assert.deepEqual(first.args.p_expected_schedule_plan,savedPlan);
  assert.deepEqual(sent.sessions.filter(row=>row.billingId==='september'),savedPlan.sessions.filter(row=>row.billingId==='september'));
  assert.equal(sent.sessions.find(row=>row.date==='2026-09-24').scheduleState,'exception');
  assert.equal(sent.sessions.find(row=>row.date==='2026-09-29').scheduleState,'active');
  assert.deepEqual(sent.sessions.filter(row=>row.billingId==='october').map(row=>row.date),[...octoberDates,'2026-10-01','2026-10-29']);
  assert.deepEqual(sent.billingPeriods.map(period=>period.id),['september','october']);
  for (const stored of savedPlan.sessions.filter(row=>row.billingId==='october')) {
    const retained = sent.sessions.find(row=>row.date===stored.date);
    assert.deepEqual(retained,stored,`stored ${stored.date} retains identity, occupancy and learning content`);
  }
  for (const date of ['2026-10-01','2026-10-29']) {
    const row = sent.sessions.find(row=>row.date===date);
    assert.deepEqual([row.startTime,row.endTime,row.teacherCatalogId,row.classroomCatalogId],['17:00','19:00',id(101),id(201)]);
    assert.equal(row.scheduleState,'active'); assert.equal(row.isForced,false);
    assert.equal(row.teacherNote,undefined); assert.equal(row.textbookEntries,undefined);
  }
  assert.deepEqual(payload.classItem.schedulePlan,savedPlan,'read payload stays immutable');
  await act(async () => first.resolve({data:null,error:{code:'23P01',message:'timetable_resource_conflict'}}));
  assert.equal(page.observed.lessonDesignSaveError,'일정 확인을 통과하지 못해 저장하지 못했습니다. 입력은 유지되었습니다. 일정 정보를 확인해 주세요.');
  assert.equal(dirty(),true);
  assert.equal(saveRequests(page).length,1,'a conflict must not trigger an automatic write');
  assert.equal(page.observed.lessonPlanForSave.sessions.filter(row=>row.billingId==='october').length,9);
  await act(async () => save().click());
  assert.equal(saveRequests(page).length,2,'only the explicit retry issues another write');
  assert.deepEqual(saveRequests(page)[1].args,first.args,'identical retry retains payload, expected plan and request key');
});

function legacyRecoveryDetail({ firstState = 'skipped', blankDates = [] } = {}) {
  const payload = septemberOctoberDetail();
  payload.classItem.schedule = '화 17:00-19:00\n목 17:00-19:00';
  payload.classItem.schedulePlan = buildSchedulePlanForSave({
    className: 'SAFE CURRICULUM', subject: '영어', selectedDays: [2, 4],
    billingPeriods: [
      { id: 'september', month: 9, label: '9월', startDate: '2026-09-01', endDate: '2026-09-29' },
      { id: 'october', month: 10, label: '10월', startDate: '2026-10-01', endDate: '2026-10-29' },
    ],
    sessionStates: { '2026-09-24': { state: 'exception' }, '2026-10-01': { state: firstState } },
    sessionSchedules: Object.fromEntries(blankDates.map(date => [date, {
      startTime: '', endTime: '', teacherCatalogId: '', classroomCatalogId: '',
    }])),
    sessions: [],
  });
  for (const row of payload.classItem.schedulePlan.sessions) {
    row.teacherNote = `합성 보존 메모 ${row.date}`;
    row.textbookEntries = [{ id: `saved-${row.date}`, textbookId: id(700), plan: {
      start: row.date, end: row.date, label: `합성 보존 범위 ${row.date}`,
    } }];
  }
  return payload;
}

async function recoveryEditor(t, payload, initial = {}) {
  const page = await setup(t, 'operations', { workspace: true,
    search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-board`, route: 'curriculum/lesson-design', ...initial });
  await act(async () => page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1)
    .resolve({ error: null, data: payload }));
  if (page.numbered()[0]) await act(async () => page.finish(page.numbered()[0]));
  return page;
}

function restoredOctoberReadDetail() {
  const payload = legacyRecoveryDetail();
  const plan = buildSchedulePlanForSave({ ...payload.classItem.schedulePlan,
    sessionStates: { '2026-09-24': { state: 'exception' },
      '2026-10-01': { state: 'skipped' }, '2026-10-06': { state: 'exception' } },
  });
  // The correction producer restores state while retaining the materialized
  // identity and old ordinals. Reproduce its fresh read, rather than editing a
  // boundary and letting the planner create a new October 1 session.
  const restored = plan.sessions.find(row => row.date === '2026-10-01');
  restored.id = 'session:2026-10-01:october:skipped';
  restored.sessionKey = restored.id;
  Object.assign(restored, { state: 'active', scheduleState: 'active', sessionNumber: null, isForced: false });
  plan.sessionStates['2026-10-01'] = { state: 'active' };
  plan.history = [{ id: 'saved-history', savedAt: '2026-10-02T00:00:00Z', summary: '합성 저장 이력' }];
  for (const row of plan.sessions) {
    Object.assign(row, { startTime: '17:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201),
      publicNote: `합성 공지 ${row.date}`, teacherNote: `합성 보존 메모 ${row.date}`,
      textbookEntries: [{ id: `saved-${row.date}`, textbookId: id(700), plan: {
        start: row.date, end: row.date, label: `합성 보존 범위 ${row.date}`,
      } }],
    });
  }
  payload.classItem.schedulePlan = plan;
  return payload;
}

test('fresh persisted restored October lesson displays materialized ordinals without changing save or history identities', async t => {
  const payload = restoredOctoberReadDetail(), savedPlan = structuredClone(payload.classItem.schedulePlan);
  const rawOrdinals = [null, null, 1, 2, 3, 4, 5, 6, 7];
  const displayOrdinals = [1, null, 2, 3, 4, 5, 6, 7, 8];
  const octoberRows = savedPlan.sessions.filter(row => row.billingId === 'october');
  assert.equal(savedPlan.billingPeriods.find(period => period.id === 'october').startDate, '2026-10-01');
  assert.deepEqual(octoberRows.map(row => row.sessionNumber), rawOrdinals);
  const page = await recoveryEditor(t, payload, { route: 'curriculum',
    search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-periods&returnTo=%2Fadmin%2Fcurriculum`,
  });
  const initialSavePlan = structuredClone(page.observed.lessonPlanForSave);
  const readOnlyState = ({ expectedSaves = 0, savePlan = initialSavePlan } = {}) => {
    assert.equal(dirty(), false, 'a fresh read or detail selection does not author a schedule edit');
    assert.equal(saveRequests(page).length, expectedSaves, 'display recovery never submits another save');
    assert.deepEqual(page.observed.lessonPlanForSave.sessions, savedPlan.sessions, 'raw save rows retain every stored identity, ordinal and content field');
    assert.deepEqual(page.observed.lessonPlanForSave, savePlan, 'read-only display and selection leave the entire candidate save payload unchanged');
    assert.deepEqual(payload.classItem.schedulePlan, savedPlan, 'RPC detail remains immutable');
    assert.deepEqual(page.observed.lessonPlanDraft.history, savedPlan.history, 'accepted saved history is unchanged');
    assert.ok([...document.querySelectorAll('button')].find(button => button.textContent.trim() === '일정 저장'));
  };
  readOnlyState();
  for (const [index, stored] of octoberRows.entries()) {
    const view = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === stored.id);
    assert.ok(view, `materialized ${stored.date} retains its canonical ID`);
    assert.equal(view.sessionNumber, Number(stored.sessionNumber || 0), 'history matching keeps the canonical stored ordinal');
    assert.equal(view.label, index === 1 ? '휴강' : `${displayOrdinals[index]}회차`);
    assert.equal(view.displaySessionNumber, displayOrdinals[index]);
    assert.equal(view.scheduleStateLabel, index === 1 ? '휴강' : '정상');
    assert.equal(view.teacherNote, stored.teacherNote);
    const cell = document.querySelector(`[data-lesson-calendar-month="2026-10"] [data-lesson-calendar-date="${stored.date}"]`);
    assert.ok(cell);
    assert.equal(cell.dataset.lessonCalendarSessionId, stored.id);
    assert.equal(cell.dataset.lessonCalendarState, stored.scheduleState);
    assert.match(cell.textContent, new RegExp(`${view.label}.*${view.scheduleStateLabel}`));
    assert.equal(cell.textContent.includes(stored.id), false, 'the calendar does not expose a raw identity as a lesson label');
    const mobile = [...document.querySelectorAll('[data-lesson-calendar-month="2026-10"] [data-testid="lesson-mobile-session-list"] button')]
      .find(button => button.textContent.includes(view.dateLabel));
    assert.ok(mobile, `mobile ${stored.date} entry`);
    assert.match(mobile.textContent, new RegExp(`${view.label}.*${view.scheduleStateLabel}`));
  }
  const selected = await selectLegacyRecoveryRow(page, '2026-10-01');
  assert.match(selected.querySelector('button').textContent, /1회차.*정상/);
  assert.equal(selected.dataset.lessonPeriodSessionId, octoberRows[0].id);
  for (const [index, stored] of octoberRows.entries()) {
    const element = [...document.querySelectorAll('[data-lesson-period-session-id]')]
      .find(row => row.dataset.lessonPeriodSessionId === stored.id);
    assert.ok(element, `month details retains ${stored.date}`);
    const label = index === 1 ? '휴강' : `${displayOrdinals[index]}회차`;
    const state = index === 1 ? '휴강' : '정상';
    assert.match(element.querySelector('button').textContent, new RegExp(`${label}.*${state}`));
  }
  selected.querySelector('button').focus();
  assert.equal(document.activeElement, selected.querySelector('button'), 'standard focus reaches the retained-identity detail header');
  readOnlyState();
  // The real history producer can use an old ordinal when a legacy log has no
  // session ID. Keep that match on October 8 (stored 1), not October 1 (display 1).
  const records = page.load('src/features/operations/records.js');
  const model = records.buildClassScheduleRouteModel({ classes: [payload.classItem], progressLogs: [
    { id: id(801), class_id: id(999), session_order: 1, teacher_note: '합성 raw 1회차 기록', content: '합성 10월 8일 기록', updated_at: '2026-10-08T10:00:00Z' },
    { id: id(802), class_id: id(999), session_order: 2, teacher_note: '합성 raw 2회차 기록', content: '합성 10월 13일 기록', updated_at: '2026-10-13T10:00:00Z' },
  ] });
  const buildSnapshot = page.load('src/features/operations/class-schedule-workspace.tsx').__testBuildLessonDesignSnapshot;
  const historySnapshot = buildSnapshot(model.rows[0], payload.textbooks, page.observed.lessonPlanForSave);
  assert.equal(historySnapshot.sessions.find(row => row.id === octoberRows[0].id).content, '수업 기록 없음');
  assert.equal(historySnapshot.sessions.find(row => row.dateValue === '2026-10-08').content, '합성 10월 8일 기록');
  assert.equal(historySnapshot.sessions.find(row => row.dateValue === '2026-10-13').content, '합성 10월 13일 기록');
  assert.deepEqual(page.observed.lessonDesignSnapshot.sessions.filter(row => row.monthKey === '2026-09').map(row => row.id),
    savedPlan.sessions.filter(row => row.billingId === 'september').map(row => row.id), 'September materialized history keeps all identities');
  readOnlyState();

  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const save = saveRequests(page)[0], submitted = save.args.p_patch.schedule_plan;
  assert.deepEqual(submitted, initialSavePlan, 'explicit mock save receives the pre-existing canonical payload, not display projections');
  assert.deepEqual(save.args.p_expected_schedule_plan, savedPlan);
  assert.deepEqual(submitted.sessions.filter(row => row.billingId === 'october').map(row => row.sessionNumber), rawOrdinals);
  assert.deepEqual(submitted.sessions.filter(row => row.billingId === 'september'), savedPlan.sessions.filter(row => row.billingId === 'september'));
  assert.deepEqual(submitted.history.slice(0, savedPlan.history.length), savedPlan.history, 'normal save appends history without rewriting existing entries');
  assert.equal(submitted.sessions.some(row => Object.hasOwn(row, 'displaySessionNumber') || Object.hasOwn(row, 'label')), false);
  await act(async () => save.resolve({ error: null, data: null }));
  const reread = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  assert.notEqual(reread, page.requests.find(request => request.name === 'get_operations_class_lesson_design_detail_v1'));
  const freshPayload = structuredClone(payload);
  await act(async () => reread.resolve({ error: null, data: freshPayload }));
  assert.match(page.observed.lessonDesignSaveNotice, /저장했습니다/);
  assert.equal(page.observed.lessonDesignSnapshot.sessions.find(row => row.id === octoberRows[0].id).label, '1회차');
  assert.equal(page.observed.lessonDesignSnapshot.sessions.find(row => row.id === octoberRows[0].id).sessionNumber, 0);
  await page.remount();
  const reload = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  assert.notEqual(reload, reread, 'a new mount performs a fresh detail read');
  await act(async () => reload.resolve({ error: null, data: structuredClone(freshPayload) }));
  const reloadedSavePlan = structuredClone(page.observed.lessonPlanForSave);
  readOnlyState({ expectedSaves: 1, savePlan: reloadedSavePlan });
  await selectLegacyRecoveryRow(page, '2026-10-01');
  const toggle = () => document.querySelector('button[aria-label^="10월 상세 "]');
  await act(async () => toggle().click());
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  await act(async () => toggle().click());
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  for (const [index, stored] of octoberRows.entries()) {
    const view = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === stored.id);
    assert.equal(view.label, index === 1 ? '휴강' : `${displayOrdinals[index]}회차`, `reloaded ${stored.date} display`);
    assert.equal(view.sessionNumber, Number(stored.sessionNumber || 0));
    const element = [...document.querySelectorAll('[data-lesson-period-session-id]')].find(row => row.dataset.lessonPeriodSessionId === stored.id);
    assert.ok(element);
    assert.match(element.querySelector('button').textContent, new RegExp(view.label));
  }
  readOnlyState({ expectedSaves: 1, savePlan: reloadedSavePlan });
  assert.deepEqual(freshPayload.classItem.schedulePlan, savedPlan);
});

async function selectLegacyRecoveryRow(page, date) {
  const month = Number(date.slice(5, 7));
  const details = document.querySelector(`button[aria-label^="${month}월 상세 "]`);
  assert.ok(details, `${month}월 details toggle`);
  if (details.getAttribute('aria-expanded') !== 'true') await act(async () => details.click());
  const row = page.observed.lessonPlanForSave.sessions.find(item => item.date === date);
  assert.ok(row, `stored ${date} row`);
  const element = [...document.querySelectorAll('[data-lesson-period-session-id]')]
    .find(item => item.dataset.lessonPeriodSessionId === row.id);
  assert.ok(element, `visible selectable ${date} row`);
  await act(async () => element.querySelector('button').click());
  assert.equal(document.querySelector('[data-lesson-selected-editor="true"]')?.dataset.lessonPeriodSessionId, row.id);
  return document.querySelector('[data-lesson-selected-editor="true"]');
}

function assertLegacyRecoveryFields(date, values) {
  for (const [index, label] of ['시작', '종료', '선생님', '강의실'].entries()) {
    const control = document.querySelector(`[aria-label="${date} ${label}"]`);
    assert.ok(control, `rendered ${date} ${label}`);
    assert.equal(control.disabled, false);
    assert.equal(control.value, values[index]);
  }
}

for (const action of ['unlink', 'tbd', 'active', 'calendar', 'skipped']) {
  test(`PR161: linked makeup ${action} retains the explicitly selected source state`, async t => {
    const payload = legacyRecoveryDetail({ firstState: 'active' });
    const plan = payload.classItem.schedulePlan;
    const source = plan.sessions.find(row => row.date === '2026-10-01');
    Object.assign(source, { state: 'exception', scheduleState: 'exception', makeupDate: '2026-10-02' });
    plan.sessionStates['2026-10-01'] = { state: 'exception', makeupDate: '2026-10-02', memo: 'keep source memo' };
    plan.sessions.push({ id: 'manual-makeup', sessionKey: 'manual-makeup', billingId: source.billingId,
      billingLabel: source.billingLabel, date: '2026-10-02', originalDate: source.date,
      state: 'makeup', scheduleState: 'makeup', sessionNumber: null });
    const saved = structuredClone(plan), page = await recoveryEditor(t, payload);
    const panel = await selectLegacyRecoveryRow(page, source.date);
    if (action === 'calendar') {
      await act(async () => document.querySelector('[data-lesson-calendar-month="2026-10"] [data-lesson-calendar-date="2026-10-01"]').click());
    } else if (action === 'skipped') {
      const button = document.querySelector('button[aria-label$=" 일정 해제"]');
      assert.ok(button, 'explicit selected lesson release'); await act(async () => button.click());
    } else {
      const label = { unlink: '보강 해제', tbd: '미정', active: '정상' }[action];
      const button = [...panel.querySelectorAll('button')].find(item => item.textContent.trim() === label);
      assert.ok(button, label); await act(async () => button.click());
    }
    const expectedState = action === 'unlink' ? 'exception' : ['tbd', 'skipped'].includes(action) ? action : 'active';
    const changed = page.observed.lessonPlanForSave;
    assert.equal(changed.sessions.find(row => row.id === source.id).scheduleState, expectedState);
    assert.equal(changed.sessions.some(row => row.id === 'manual-makeup'), false, 'linked child is removed');
    assert.equal(changed.sessionStates[source.date].makeupDate, '');
    await clickLessonSave();
    assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
    const sent = saveRequests(page)[0].args.p_patch.schedule_plan;
    assert.deepEqual(sent.sessions.find(row => row.id === source.id), { ...source, state: expectedState, scheduleState: expectedState, makeupDate: '' });
    assert.deepEqual(sent.sessions.filter(row => row.id !== source.id), saved.sessions.filter(row => ![source.id, 'manual-makeup'].includes(row.id)));
    assert.deepEqual(sent.billingPeriods, saved.billingPeriods);
  });
}

test('PR161: newly prepended lesson keeps display ordinals out of stored identity and preserves the saved original', async t => {
  const payload = legacyRecoveryDetail({ firstState: 'active' });
  const saved = payload.classItem.schedulePlan;
  const source = saved.sessions.find(row => row.date === '2026-10-06');
  saved.sessions = [source]; saved.billingPeriods = [saved.billingPeriods.find(period => period.id === source.billingId)];
  saved.billingPeriods[0].startDate = '2026-10-06';
  const page = await recoveryEditor(t, payload);
  await act(async () => page.observed.updateLessonPlanDraft(current => ({ ...current,
    billingPeriods: current.billingPeriods.map(period => ({ ...period, startDate: '2026-10-01' })) })));
  const added = page.observed.lessonPlanForSave.sessions.find(row => row.date === '2026-10-01');
  assert.equal(added.sessionNumber, null);
  assert.deepEqual(page.observed.lessonPlanForSave.sessions[0], source);
  const shown = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === added.id);
  assert.doesNotMatch(shown.label, new RegExp(added.id));
  assert.equal(shown.label, '1회차', 'existing presentation ordinals remain display-only');
  assert.equal(shown.displaySessionNumber, 1);
  assert.equal(shown.sessionNumber, 0, 'view model uses its existing no-stored-number sentinel');
  await selectLegacyRecoveryRow(page, added.date); await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const save = saveRequests(page)[0], sent = structuredClone(save.args.p_patch.schedule_plan);
  assert.equal(sent.sessions.find(row => row.id === added.id).sessionNumber, null);
  assert.equal(sent.sessions.some(row => Object.hasOwn(row, 'displaySessionNumber')), false);
  await act(async () => save.resolve({ error: null, data: null }));
  const read = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  const freshPayload = structuredClone(payload); freshPayload.classItem.schedulePlan = sent;
  await act(async () => read.resolve({ error: null, data: freshPayload }));
  assert.match(page.observed.lessonDesignSaveNotice, /저장했습니다/);
  assert.deepEqual(page.observed.lessonPlanForSave.sessions, sent.sessions);
  assert.deepEqual(page.observed.lessonPlanForSave.sessions.find(row => row.id === source.id), source);
  const rereadView = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === added.id);
  assert.equal(rereadView.displaySessionNumber, 1);
  assert.equal(rereadView.sessionNumber, 0);
});

async function clickLessonSave() {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === '일정 저장');
  assert.ok(button, 'explicit schedule save');
  await act(async () => button.click());
}

test('legacy recovery restores a visible skipped row and cancels another row without rewriting stored history', async t => {
  const payload = legacyRecoveryDetail(), savedPlan = structuredClone(payload.classItem.schedulePlan);
  const savedFirst = savedPlan.sessions.find(row => row.date === '2026-10-01');
  const page = await recoveryEditor(t, payload);
  assert.equal(dirty(), false);
  assert.equal(saveRequests(page).length, 0, 'opening the editor never saves or fills historical dates');
  assert.equal(page.observed.lessonPlanForSave.sessions.find(row => row.date === '2026-10-01').startTime, undefined);
  assert.equal(savedPlan.sessions.filter(row => row.billingId === 'october' && row.scheduleState === 'active').length, 8);

  let selected = await selectLegacyRecoveryRow(page, '2026-10-01');
  assert.match(selected.querySelector('[data-slot="badge"]').textContent, /해제/);
  const normal = [...selected.querySelectorAll('button')].find(button => button.textContent.trim() === '정상');
  assert.ok(normal, 'the stored skipped date has an explicit normal-state action');
  await act(async () => normal.click());
  const restored = page.observed.lessonPlanForSave.sessions.find(row => row.date === '2026-10-01');
  assert.equal(restored.id, savedFirst.id);
  assert.equal(restored.scheduleState, 'active');
  assert.equal(restored.isForced, false);
  assert.equal(restored.originalDate, '');
  const restoredView = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === restored.id);
  assert.equal(restoredView.label, '1회차');
  assert.equal(restoredView.scheduleStateLabel, '정상');
  const restoredCell = document.querySelector('[data-lesson-calendar-month="2026-10"] [data-lesson-calendar-date="2026-10-01"]');
  assert.equal(restoredCell.dataset.lessonCalendarState, 'active');
  assert.match(restoredCell.textContent, /1회차.*정상/);
  assertLegacyRecoveryFields('2026-10-01', ['', '', '', '']);
  assert.equal(saveRequests(page).length, 0, 'restoration only changes the authored state and never fills missing history');

  selected = await selectLegacyRecoveryRow(page, '2026-10-06');
  const cancel = [...selected.querySelectorAll('button')].find(button => button.textContent.trim() === '휴강');
  assert.ok(cancel);
  await act(async () => cancel.click());
  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const request = saveRequests(page)[0], sent = request.args.p_patch.schedule_plan;
  assert.equal(request.retryEnabled, false);
  assert.deepEqual(request.args.p_expected_schedule_plan, savedPlan);
  assert.deepEqual(sent.billingPeriods, savedPlan.billingPeriods);
  assert.deepEqual(sent.sessions.map(row => row.date), savedPlan.sessions.map(row => row.date));
  assert.deepEqual(sent.sessions.filter(row => row.billingId === 'september'), savedPlan.sessions.filter(row => row.billingId === 'september'));
  assert.equal(sent.sessions.find(row => row.date === '2026-09-24').scheduleState, 'exception');
  assert.equal(sent.sessions.find(row => row.date === '2026-09-29').scheduleState, 'active');
  for (const stored of savedPlan.sessions.filter(row => row.billingId === 'october')) {
    const actual = sent.sessions.find(row => row.date === stored.date);
    const expected = { ...stored };
    if (stored.date === '2026-10-01') Object.assign(expected, {
      state: 'active', scheduleState: 'active',
    });
    if (stored.date === '2026-10-06') Object.assign(expected, { state: 'exception', scheduleState: 'exception' });
    assert.deepEqual(actual, expected, `${stored.date} retains identity, resources and learning content except the two authored changes`);
  }
  assert.deepEqual(sent.sessions.filter(row => row.billingId === 'october' && row.scheduleState === 'active').map(row => row.sessionNumber), [null, 2, 3, 4, 5, 6, 7, 8], 'stored ordinals are not renumbered by an unrelated state edit');
  assert.deepEqual(payload.classItem.schedulePlan, savedPlan, 'the read payload remains immutable');
});

test('legacy selected defaults repairs only the selected stored blank lesson through its explicit button', async t => {
  const payload = legacyRecoveryDetail({ blankDates: ['2026-10-22', '2026-10-29'] });
  const savedPlan = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  assert.equal(dirty(), false);
  assert.equal(saveRequests(page).length, 0);
  await selectLegacyRecoveryRow(page, '2026-10-29');
  assertLegacyRecoveryFields('2026-10-29', ['', '', '', '']);
  const apply = document.querySelector('button[aria-label="2026-10-29 기본 정보 적용"]');
  assert.ok(apply, 'the blank stored row exposes explicit recovery');
  await act(async () => apply.click());
  assertLegacyRecoveryFields('2026-10-29', ['17:00', '19:00', id(101), id(201)]);
  assert.equal(saveRequests(page).length, 0, 'applying defaults requires a separate save');
  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const request = saveRequests(page)[0], sent = request.args.p_patch.schedule_plan;
  assert.deepEqual(request.args.p_expected_schedule_plan, savedPlan);
  assert.deepEqual(sent.billingPeriods, savedPlan.billingPeriods);
  assert.deepEqual(sent.sessions, savedPlan.sessions.map(stored => stored.date === '2026-10-29' ? { ...stored,
      startTime: '17:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201),
    } : stored), 'only the selected stored row changes, with no extra or duplicate sessions');
  assert.deepEqual(payload.classItem.schedulePlan, savedPlan);
});

test('legacy selected defaults preserves a typed time while filling missing fields and hides recovery once complete', async t => {
  const payload = legacyRecoveryDetail({ blankDates: ['2026-10-22', '2026-10-29'] });
  const savedPlan = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  await selectLegacyRecoveryRow(page, '2026-10-29');
  assertLegacyRecoveryFields('2026-10-29', ['', '', '', '']);
  await changeInput('2026-10-29 시작', '18:00');
  assertLegacyRecoveryFields('2026-10-29', ['18:00', '', '', '']);
  const apply = document.querySelector('button[aria-label="2026-10-29 기본 정보 적용"]');
  assert.ok(apply, 'partial input still allows explicit completion');
  await act(async () => apply.click());
  assertLegacyRecoveryFields('2026-10-29', ['18:00', '19:00', id(101), id(201)]);
  assert.equal(document.querySelector('button[aria-label="2026-10-29 기본 정보 적용"]'), null,
    'complete manually edited details cannot be reapplied with a defaults button');
  assert.equal(saveRequests(page).length, 0, 'completion does not submit a mutation');
  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const request = saveRequests(page)[0], sent = request.args.p_patch.schedule_plan;
  assert.deepEqual(request.args.p_expected_schedule_plan, savedPlan);
  assert.deepEqual(sent.billingPeriods, savedPlan.billingPeriods);
  assert.deepEqual(sent.sessions, savedPlan.sessions.map(stored => stored.date === '2026-10-29' ? { ...stored,
    startTime: '18:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201),
  } : stored), 'the typed time is saved only on the selected date; every other stored row remains unchanged');
  assert.deepEqual(payload.classItem.schedulePlan, savedPlan);
});

test('authored partial past details remain partial and can be saved without occupancy preflight', async t => {
  const payload = legacyRecoveryDetail({ firstState: 'active' });
  const savedPlan = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  await selectLegacyRecoveryRow(page, '2026-10-01');
  await changeInput('2026-10-01 시작', '17:00');
  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, 'past/incomplete occupancy does not prevent storing the authored row');
  const plan = saveRequests(page)[0].args.p_patch.schedule_plan;
  const target = savedPlan.sessions.find(row => row.date === '2026-10-01');
  assert.deepEqual(plan.sessions.find(row => row.id === target.id), { ...target, startTime: '17:00' });
  assert.deepEqual(plan.sessions.filter(row => row.id !== target.id), savedPlan.sessions.filter(row => row.id !== target.id));
  assert.deepEqual(payload.classItem.schedulePlan, savedPlan);
});

test('lesson-detail team catalog populates the makeup selector and selection preserves entered times on save', async t => {
  const page = await setup(t, 'operations', { workspace: true, search: `?lessonDesign=1&classId=${id(999)}`, route:'curriculum/lesson-design' });
  const payload = detail();
  Object.assign(payload.classItem,{subject:'영어',teacher:'합성 담당',room:'합성 강의실'});
  payload.teacherCatalogs = [{id:id(101),name:'합성 담당',subjects:['영어팀'],isVisible:true}];
  payload.classroomCatalogs = [{id:id(201),name:'합성 강의실',subjects:['영어'],isVisible:true}];
  await act(async () => page.requests.find(r => r.name==='get_operations_class_lesson_design_detail_v1').resolve({error:null,data:payload}));
  await act(async () => page.observed.updateLessonPlanDraft(p => ({...p,selectedDays:[2,0],sessions:[],
    billingPeriods:[{id:'oct',month:10,label:'10월',startDate:'2026-09-29',endDate:'2026-10-27'}],
    sessionStates:{'2026-10-13':{state:'exception'},'2026-10-18':{state:'exception'},'2026-10-09':{state:'makeup'}},
    sessionSchedules:{'2026-10-09':{startTime:'19:20',endTime:'20:20'}},
  })));
  await act(async () => document.querySelector('button[aria-label="2026-10-09 보강"]').click());
  const teacher = document.querySelector('select[aria-label="2026-10-09 선생님"]');
  assert.ok(teacher);
  assert.deepEqual(Array.from(teacher.options).map(o=>[o.value,o.textContent]),[['','선택'],[id(101),'합성 담당']]);
  await act(async () => { teacher.value=id(101); teacher.dispatchEvent(new window.Event('change',{bubbles:true})); });
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.equal(saveRequests(page).length,1);
  const makeup=saveRequests(page)[0].args.p_patch.schedule_plan.sessions.find(s=>s.date==='2026-10-09');
  assert.equal(makeup.teacherCatalogId,id(101)); assert.equal(makeup.classroomCatalogId,undefined, 'an unselected classroom is not inferred into the write');
  assert.equal(makeup.startTime,'19:20'); assert.equal(makeup.endTime,'20:20');
});

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
  next.classItem.schedulePlan = buildSchedulePlanForSave({
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
  });
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
async function normalizedEditor(t, sessionPatch = {}) {
  const page = await editor(t);
  await page.normalized({ status: 'ready', value: { source: 'normalized', data: {scheduleRevision: 1, contentHash: 'safe-hash', sessions: [
    {id: id(600), session_key: 'session-one', session_date: '2026-08-03', session_number: 1, revision: 1, schedule_state: 'active', memo: 'ORIGINAL', ...sessionPatch },
  ]} } });
  await act(async () => page.observed.setSelectedLessonSessionId(id(600)));
  assert.ok(page.observed.normalizedLessonSessionDraft, JSON.stringify(page.observed.lessonDesignSnapshot?.sessions));
  return page;
}
test('normalized exception overrides still count as occupied lessons', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await page.normalized({status:'ready',value:{source:'normalized',data:{scheduleRevision:1,contentHash:'override',sessions:[
    {id:id(600),session_key:'session-one',session_date:'2026-08-03',session_number:1,revision:1,schedule_state:'exception'},
  ]}}});
  const period = document.querySelector('[id^="lesson-design-period-detail-"]');
  assert.equal(period.querySelector('[data-slot="badge"]').textContent, '1회');
});
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
  assert.equal(saveRequests(page)[0].args.p_patch.schedule_plan.billingPeriods[0].color, 'SUBMITTED');
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

test('normalized session: rendered memo edit preserves spaces and newlines and leaves both other notes unchanged', async t => {
  const notes = { memo: '  stored\n memo  ', public_note: '\n  public note\n', teacher_note: '  teacher note\n  ' };
  const page = await normalizedEditor(t, notes);
  await act(async () => document.querySelector('[data-lesson-calendar-date="2026-08-03"]').click());
  const textarea = document.querySelector('textarea[aria-label="1회차 메모"]');
  assert.equal(textarea?.value, notes.memo, 'the controlled input presents the exact saved note');
  const view = page.observed.lessonDesignSnapshot.sessions.find(row => row.id === id(600));
  assert.equal(view.memo, notes.memo);
  assert.equal(view.publicNote, notes.public_note);
  assert.equal(view.teacherNote, notes.teacher_note);
  const authored = '  submitted\n\n  next line  \n';
  await changeTextarea(textarea, authored);
  assert.equal(page.observed.normalizedLessonSessionDraft.memo, authored, 'the real textarea event updates the raw draft');
  const panel = textarea.closest('[data-lesson-period-session-id]');
  const save = [...panel.querySelectorAll('button')].find(button => button.textContent === '일정 저장');
  assert.ok(save);
  await act(async () => save.click());
  assert.equal(saveRequests(page).length, 1);
  const args = saveRequests(page)[0].args;
  assert.equal(args.p_memo, authored);
  assert.equal(args.p_public_note, notes.public_note, 'an untouched public note is sent byte-for-byte');
  assert.equal(args.p_teacher_note, notes.teacher_note, 'an untouched teacher note is sent byte-for-byte');
  assert.equal(args.p_expected_revision, 1);
  assert.equal(args.p_session_date, '2026-08-03');
  await finishSave(page, { revision: 2 }, true);
  assert.equal(page.observed.normalizedLessonSessionDraft.memo, authored);
  assert.equal(dirty(), false, 'accepted raw text becomes the clean baseline');
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
test('plan: a response after eight seconds can finish without aborting an already committed save', async t => {
  const page = await editor(t); await editPlan(page, 'SLOW COMMIT');
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    const controller = new AbortController(); deadlines.push({ms,controller}); return controller.signal;
  });
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  const request = saveRequests(page)[0];
  // Advance a deterministic virtual clock past the former browser deadline.
  for (const {ms,controller} of deadlines) if (ms <= 9000) controller.abort(new DOMException('signal timed out','TimeoutError'));
  assert.equal(request.signal.aborted, false, 'a 9-second successful response must remain receivable');
  assert.equal(deadlines[0].ms, 20_000);
  await finishSave(page);
  assert.match(page.observed.lessonDesignSaveNotice, /저장/);
  assert.equal(page.observed.lessonDesignSaveError, '');
});
test('plan: unknown timeout outcome preserves the draft and reuses the identical idempotent request', async t => {
  const page = await editor(t); await editPlan(page, 'RETAINED');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  const first = saveRequests(page)[0];
  await act(async () => first.resolve({data:null,error:{code:'',message:'TimeoutError: signal timed out'}}));
  assert.match(page.observed.lessonDesignSaveError, /저장 결과를 확인하지 못했습니다/);
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'RETAINED');
  assert.equal(saveRequests(page).length, 1, 'no automatic mutation retry');
  await act(async () => { void page.observed.handleSaveLessonPlan(); });
  assert.deepEqual(saveRequests(page)[1].args, first.args);
  await finishSave(page);
  assert.equal(page.observed.lessonDesignSaveError, '');
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
  assert.equal(saveRequests(page).at(-1).args.p_patch.schedule_plan.billingPeriods[0].color, 'RETRY DRAFT');
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
test('normalized session: accepted raw input becomes clean and later authoritative data replaces clean overrides', async t => {
  const page = await normalizedEditor(t);
  await act(async () => page.observed.updateNormalizedLessonSessionDraft({memo: '  submitted  '}));
  await act(async () => { void page.observed.saveNormalizedLessonSession(); });
  await finishSave(page, {revision: 2}, true);
  assert.equal(dirty(), false, 'exact submitted input is accepted when there is no newer edit');
  assert.equal(page.observed.normalizedLessonSessionDraft.memo, '  submitted  ');
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

function freezePastCorrectionClock(t) {
  const OriginalDate = globalThis.Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-10T12:00:00Z'])); }
    static now() { return OriginalDate.parse('2026-10-10T12:00:00Z'); }
  };
  t.after(() => { globalThis.Date = OriginalDate; });
}

function pastCorrectionDetail() {
  const payload = legacyRecoveryDetail();
  payload.classItem.status = '수강';
  const plan = payload.classItem.schedulePlan;
  plan.rawPlanMarker = { preserved: ['synthetic', 'original'] };
  plan.billingPeriods[0].rawPeriodMarker = 'preserve this raw period';
  const first = plan.sessions.find(row => row.date === '2026-10-01');
  Object.assign(first, { startTime: '17:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201), rawLessonMarker: 'preserve target wire fields' });
  plan.sessionSchedules['2026-10-01'] = { startTime: '17:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201) };
  const sixth = plan.sessions.find(row => row.date === '2026-10-06');
  Object.assign(sixth, { state: 'exception', scheduleState: 'exception', startTime: '17:00', endTime: '19:00', teacherCatalogId: id(101), classroomCatalogId: id(201) });
  plan.sessionStates['2026-10-06'] = { state: 'exception', memo: '' };
  plan.sessions.find(row => row.date === '2026-09-29').unknownOccupancy = { syntheticHistoricalFlag: true };
  return payload;
}

const pastPreviews = page => page.requests.filter(request => request.name === 'preview_past_lesson_state_correction_v1');
const pastCommits = page => page.requests.filter(request => request.name === 'save_past_lesson_state_correction_v1');
const correctionDialog = date => [...document.querySelectorAll('[role="dialog"]')]
  .find(node => node.querySelector(`[aria-label="${date} 정정 사유"]`));
function correctionButton(date, label) {
  const button = [...(correctionDialog(date)?.querySelectorAll('button') || [])].find(node => node.textContent.trim() === label);
  assert.ok(button, `rendered ${label}`);
  return button;
}
async function changeCorrectionField(date, label, value) {
  const control = correctionDialog(date)?.querySelector(`[aria-label="${date} ${label}"]`);
  assert.ok(control, `rendered correction ${label}`);
  await act(async () => {
    control.focus();
    const prototype = control.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : control.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
    control.dispatchEvent(new window.KeyboardEvent('keyup', { key: '1', bubbles: true }));
  });
  assert.equal(control.value, value);
}
async function openPastCorrection(page, date = '2026-10-01') {
  await selectLegacyRecoveryRow(page, date);
  const trigger = document.querySelector(`[aria-label="${date} 과거 상태 정정"]`);
  assert.ok(trigger, `eligible raw ${date} has an independent correction action`);
  assert.equal(trigger.disabled, false);
  await act(async () => trigger.click());
  assert.ok(correctionDialog(date), 'the real correction dialog opened');
  return correctionDialog(date);
}
function pastSummary(request, unknownCount = 0, committed = false) {
  return {
    kind: 'past_lesson_state_correction', classId: request.args.p_class_id,
    lessonId: request.args.p_lesson_id, date: request.args.p_session_date,
    expectedState: request.args.p_expected_state, state: request.args.p_schedule_state,
    planHash: 'a'.repeat(64), reviewRequired: !committed && unknownCount > 0,
    unknownOccupancyReviewHash: 'b'.repeat(64), unknownOccupancyCount: unknownCount,
    warnings: unknownCount ? [{ code: 'unknown_occupancy', count: unknownCount }] : [],
    ...(committed ? { requestKey: request.args.p_request_key, outcome: 'applied', notifications: { state: 'not_requested' } } : {}),
  };
}
async function previewPastCorrection(page, date = '2026-10-01', unknownCount = 0) {
  await changeCorrectionField(date, '정정 사유', '  합성 기록의 상태 정정  ');
  await act(async () => correctionButton(date, '정정 내용 확인').click());
  const preview = pastPreviews(page).at(-1);
  assert.ok(preview, 'explicit preview issued one read-only RPC');
  await act(async () => preview.resolve({ error: null, data: pastSummary(preview, unknownCount) }));
  return preview;
}

test('past correction: exact raw plan, required reason and explicit unknown acknowledgement gate one independent commit', async t => {
  freezePastCorrectionClock(t);
  const payload = pastCorrectionDetail(), raw = structuredClone(payload.classItem.schedulePlan);
  const page = await recoveryEditor(t, payload), date = '2026-10-01';
  const original = raw.sessions.find(row => row.date === date);
  await openPastCorrection(page, date);
  const emptyReasonPreview = correctionButton(date, '정정 내용 확인');
  assert.equal(emptyReasonPreview.disabled, true);
  await act(async () => emptyReasonPreview.click());
  assert.equal(pastPreviews(page).length, 0);
  const preview = await previewPastCorrection(page, date, 3);
  assert.deepEqual(preview.args, {
    p_class_id: id(999), p_expected_schedule_plan: raw, p_lesson_id: original.id,
    p_session_date: date, p_expected_state: 'skipped', p_schedule_state: 'active',
    p_reason: '합성 기록의 상태 정정', p_unknown_occupancy_review_hash: null,
    p_acknowledge_unknown_occupancy: false,
  });
  assert.equal(pastCommits(page).length, 0, 'preview and warnings never write');
  assert.equal(correctionButton(date, '상태 정정 저장').disabled, true);
  assert.equal(correctionDialog(date).querySelector('[role="alert"]').textContent,
    '시간·강사·강의실 정보가 부족한 일정 3건이 있습니다.');
  const warning = correctionDialog(date).querySelector('[role="checkbox"]');
  assert.ok(warning, 'unknown occupancy requires a real explicit checkbox');
  assert.match(correctionDialog(date).textContent, /확인이 필요한 일정 경고를 확인했습니다/);
  await act(async () => warning.click());
  assert.equal(correctionButton(date, '상태 정정 저장').disabled, false);
  const saveButton = correctionButton(date, '상태 정정 저장');
  await act(async () => { saveButton.click(); saveButton.click(); });
  assert.equal(pastCommits(page).length, 1);
  const commit = pastCommits(page)[0];
  assert.deepEqual(commit.args.p_expected_schedule_plan, raw, 'no planner projection is used as the expected version');
  assert.equal(commit.args.p_unknown_occupancy_review_hash, 'b'.repeat(64));
  assert.equal(commit.args.p_acknowledge_unknown_occupancy, true);
  assert.match(commit.args.p_request_key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(commit.retryEnabled, false);
  assert.equal(saveRequests(page).filter(request => request.name !== 'save_past_lesson_state_correction_v1').length, 0);
  assert.deepEqual(payload.classItem.schedulePlan, raw, 'all unrelated raw rows, fields and learning data stay immutable');
  await act(async () => commit.resolve({ error: null, data: pastSummary(commit, 3, true) }));
  const refreshed = structuredClone(payload);
  const accepted = refreshed.classItem.schedulePlan.sessions.find(row => row.id === original.id);
  Object.assign(accepted, { state: 'active', scheduleState: 'active' });
  delete refreshed.classItem.schedulePlan.sessionStates[date];
  const read = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  assert.notEqual(read, page.requests.find(request => request.name === 'get_operations_class_lesson_design_detail_v1'), 'accepted commit performs an exact detail reread');
  await act(async () => read.resolve({ error: null, data: refreshed }));
  assert.equal(correctionDialog(date), undefined);
  assert.equal(pastCommits(page).length, 1);
  assert.equal(dirty(), false);
});

test('past correction: known collision blocks commit and keeps the entered reason', async t => {
  freezePastCorrectionClock(t);
  const payload = pastCorrectionDetail(), raw = structuredClone(payload.classItem.schedulePlan);
  const page = await recoveryEditor(t, payload), date = '2026-10-01';
  await openPastCorrection(page, date);
  await changeCorrectionField(date, '정정 사유', '합성 충돌 확인');
  await act(async () => correctionButton(date, '정정 내용 확인').click());
  await act(async () => pastPreviews(page)[0].resolve({ data: null, error: { code: '23P01', message: 'synthetic private collision detail' } }));
  assert.match(correctionDialog(date).textContent, /겹치는 일정이 확인되어 정정할 수 없습니다/);
  assert.equal(document.activeElement, correctionDialog(date).querySelector('[role="alert"]'), 'the visible local error receives standard keyboard focus');
  assert.equal(correctionDialog(date).textContent.includes('synthetic private'), false);
  assert.equal(correctionDialog(date).querySelector(`[aria-label="${date} 정정 사유"]`).value, '합성 충돌 확인');
  const commit = [...correctionDialog(date).querySelectorAll('button')].find(button => button.textContent.trim() === '상태 정정 저장');
  assert.ok(!commit || commit.disabled, 'a rejected preview cannot authorize commit');
  assert.equal(pastCommits(page).length, 0);
  assert.deepEqual(payload.classItem.schedulePlan, raw);
});

test('past correction: uncertain save retains the draft and only explicit retry reuses the reviewed version and key', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail()), date = '2026-10-01';
  await openPastCorrection(page, date);
  await previewPastCorrection(page, date);
  await act(async () => correctionButton(date, '상태 정정 저장').click());
  const first = pastCommits(page)[0];
  assert.equal(first.args.p_acknowledge_unknown_occupancy, true, 'explicit commit acknowledges the reviewed snapshot even when it has zero warnings');
  await act(async () => first.resolve({ data: null, error: { code: '', message: 'TimeoutError: synthetic result unavailable' } }));
  assert.match(correctionDialog(date).textContent, /정정 결과를 확인하지 못했습니다/);
  assert.equal(correctionDialog(date).querySelector(`[aria-label="${date} 정정 사유"]`).value.trim(), '합성 기록의 상태 정정');
  assert.equal(dirty(), true, 'the correction input participates in the existing draft-navigation guard');
  assert.equal(pastCommits(page).length, 1, 'there is no automatic retry after an unknown outcome');
  await act(async () => correctionButton(date, '상태 정정 저장').click());
  assert.equal(pastCommits(page).length, 2);
  assert.deepEqual(pastCommits(page)[1].args, first.args, 'explicit identical retry preserves raw version, review hash, reason and idempotency key');
  assert.equal(saveRequests(page).filter(request => request.name !== 'save_past_lesson_state_correction_v1').length, 0);
});

test('past correction: changed reason invalidates pending preview and stale warning cannot authorize commit', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail()), date = '2026-10-01';
  await openPastCorrection(page, date);
  await changeCorrectionField(date, '정정 사유', '첫 합성 사유');
  await act(async () => correctionButton(date, '정정 내용 확인').click());
  const oldPreview = pastPreviews(page)[0];
  assert.equal(correctionDialog(date).querySelector(`[aria-label="${date} 정정 사유"]`).disabled, false);
  await changeCorrectionField(date, '정정 사유', '변경한 합성 사유');
  await act(async () => oldPreview.resolve({ data: pastSummary(oldPreview, 2), error: null }));
  assert.equal(correctionDialog(date).querySelector(`[aria-label="${date} 정정 사유"]`).value, '변경한 합성 사유');
  const commit = [...correctionDialog(date).querySelectorAll('button')].find(button => button.textContent.trim() === '상태 정정 저장');
  assert.ok(!commit || commit.disabled, 'the former reason review is stale');
  assert.equal(pastCommits(page).length, 0);
  await act(async () => correctionButton(date, '정정 내용 확인').click());
  assert.equal(pastPreviews(page).length, 2);
  assert.equal(pastPreviews(page)[1].args.p_reason, '변경한 합성 사유');
});

test('past correction: StrictMode lifecycle replay still allows an explicit current-session preview', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail(), { strict: true }), date = '2026-10-01';
  await openPastCorrection(page, date);
  await previewPastCorrection(page, date);
  assert.equal(pastPreviews(page).length, 1);
  assert.equal(correctionButton(date, '상태 정정 저장').disabled, false);
  assert.equal(pastCommits(page).length, 0);
});

test('past correction: exact selected-row state-only draft is eligible but unrelated authored input stays outside this path', async t => {
  freezePastCorrectionClock(t);
  const payload = pastCorrectionDetail(), page = await recoveryEditor(t, payload), date = '2026-10-06';
  const selected = await selectLegacyRecoveryRow(page, date);
  const normal = [...selected.querySelectorAll('button')].find(button => button.textContent.trim() === '정상');
  assert.ok(normal);
  await act(async () => normal.click());
  assert.equal(dirty(), true);
  assert.equal(saveRequests(page).length, 0);
  await openPastCorrection(page, date);
  await previewPastCorrection(page, date);
  assert.equal(pastPreviews(page)[0].args.p_expected_state, 'exception');
  assert.equal(pastPreviews(page)[0].args.p_schedule_state, 'active');
  assert.deepEqual(pastPreviews(page)[0].args.p_expected_schedule_plan, payload.classItem.schedulePlan);
});

test('past correction: unrelated dirty plan cannot enter the narrow correction route', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail()), date = '2026-10-01';
  await editPlan(page, 'UNRELATED AUTHORED PERIOD');
  await selectLegacyRecoveryRow(page, date);
  const trigger = document.querySelector(`[aria-label="${date} 과거 상태 정정"]`);
  assert.ok(!trigger || trigger.disabled);
  assert.equal(pastPreviews(page).length, 0);
  assert.equal(pastCommits(page).length, 0);
  assert.equal(page.observed.lessonPlanDraft.billingPeriods[0].color, 'UNRELATED AUTHORED PERIOD');
  assert.equal(dirty(), true);
});

test('past correction: refreshed raw version invalidates review instead of submitting an old expected plan', async t => {
  freezePastCorrectionClock(t);
  const payload = pastCorrectionDetail(), page = await recoveryEditor(t, payload), date = '2026-10-01';
  await openPastCorrection(page, date);
  await previewPastCorrection(page, date);
  const updated = structuredClone(payload);
  updated.classItem.schedulePlan.sessions.find(row => row.date === '2026-09-29').unknownOccupancy.syntheticHistoricalFlag = false;
  await refreshDetail(page, updated);
  const dialog = correctionDialog(date);
  const commit = [...(dialog?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === '상태 정정 저장');
  assert.ok(!commit || commit.disabled, 'a changed authoritative raw plan revokes the accepted review');
  assert.equal(pastCommits(page).length, 0);
  assert.deepEqual(payload.classItem.schedulePlan.rawPlanMarker, { preserved: ['synthetic', 'original'] });
});

test('past correction: late preview from another class cannot populate or authorize the current editor', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail()), date = '2026-10-01';
  await openPastCorrection(page, date);
  await changeCorrectionField(date, '정정 사유', '이전 수업의 합성 사유');
  await act(async () => correctionButton(date, '정정 내용 확인').click());
  const old = pastPreviews(page)[0];
  window.history.replaceState(null, '', `?lessonDesign=1&classId=${id(998)}&section=lesson-design-periods`);
  await page.render();
  const next = pastCorrectionDetail(); next.classItem.id = id(998);
  const nextRead = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  assert.equal(nextRead.args.p_class_id, id(998));
  await act(async () => nextRead.resolve({ data: next, error: null }));
  await act(async () => old.resolve({ data: pastSummary(old, 3), error: null }));
  assert.equal(correctionDialog(date), undefined);
  assert.equal(pastCommits(page).length, 0);
  assert.equal(dirty(), false);
});

test('past correction: late accepted save after actor revocation cannot refresh or announce success for the new actor', async t => {
  freezePastCorrectionClock(t);
  const page = await recoveryEditor(t, pastCorrectionDetail()), date = '2026-10-01';
  await openPastCorrection(page, date);
  await previewPastCorrection(page, date);
  await act(async () => correctionButton(date, '상태 정정 저장').click());
  const old = pastCommits(page)[0];
  const readsBefore = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').length;
  await page.auth({ user: null, role: null });
  await act(async () => old.resolve({ data: pastSummary(old, 0, true), error: null }));
  assert.equal(correctionDialog(date), undefined);
  assert.equal(dirty(), false);
  assert.equal(page.observed.lessonDesignSaveNotice, '');
  assert.equal(page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').length, readsBefore);
});

test('past correction: teacher actor cannot expose the administrator correction action or issue its RPCs', async t => {
  freezePastCorrectionClock(t);
  const payload = pastCorrectionDetail(), page = await recoveryEditor(t, payload), date = '2026-10-01';
  await page.auth({ role: 'teacher' });
  const read = page.requests.filter(request => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  await act(async () => read.resolve({ data: payload, error: null }));
  await selectLegacyRecoveryRow(page, date);
  assert.equal(document.querySelector(`[aria-label="${date} 과거 상태 정정"]`), null);
  assert.equal(pastPreviews(page).length, 0);
  assert.equal(pastCommits(page).length, 0);
});

const saveDiagnostic = () => ({ version: 1,
  confirmed: [{ className: '합성 충돌 수업', date: '2026-10-01', startMinute: 1020, endMinute: 1140,
    overlapStartMinute: 1080, overlapEndMinute: 1140, teacherName: '합성 선생님' }],
  unresolved: [{ className: '합성 과거 수업', date: '2026-09-24', missingFields: ['teacher', 'classroom'] }],
  confirmedCount: 1, unresolvedCount: 1, truncated: false });
const diagnosticError = payload => ({ code: '23P01', message: 'timetable_resource_conflict', details: JSON.stringify(payload) });
const scheduleSaveButton = () => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '일정 저장');

test('actual schedule Save shows confirmed and unresolved details beside its action, preserves scope and draft, and retries only explicitly', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await editPlan(page, '합성 수정');
  const before = structuredClone({ draft: page.observed.lessonPlanDraft, baseline: page.observed.lessonPlanBaseline,
    month: page.observed.focusedLessonMonthKey, months: page.observed.selectedLessonMonthKeys, session: page.observed.selectedLessonSessionId });
  const button = scheduleSaveButton(); button.focus();
  await act(async () => button.click());
  assert.equal(saveRequests(page).length, 1);
  assert.equal(button.disabled, true);
  // Chromium drops a newly disabled button to body; emulate that browser result.
  button.blur();
  await act(async () => saveRequests(page)[0].resolve({ data: null, error: diagnosticError(saveDiagnostic()) }));
  const panel = document.querySelector('[data-testid="lesson-design-save-error"]');
  assert.ok(panel);
  assert.equal(panel.closest('[data-testid="lesson-design-page-scroll"]') !== null, true);
  assert.equal(panel.parentElement.querySelector('[data-testid="lesson-design-bottom-action-bar"]')?.contains(button), true);
  assert.equal(button.getAttribute('aria-describedby'), panel.id);
  assert.equal(document.activeElement, button);
  assert.match(panel.querySelector('[aria-label="확인된 일정 충돌"]').textContent, /합성 충돌 수업.*2026-10-01.*17:00–19:00.*겹친 시간 18:00–19:00.*같은 선생님 합성 선생님/s);
  const unknown = panel.querySelector('[aria-label="정보 확인 필요"]').textContent;
  assert.match(unknown, /합성 과거 수업.*2026-09-24.*선생님·강의실 정보 확인 필요/s);
  assert.doesNotMatch(unknown, /겹친 시간|같은 선생님|같은 강의실/);
  assert.deepEqual({ draft: page.observed.lessonPlanDraft, baseline: page.observed.lessonPlanBaseline,
    month: page.observed.focusedLessonMonthKey, months: page.observed.selectedLessonMonthKeys, session: page.observed.selectedLessonSessionId }, before);
  assert.equal(dirty(), true);
  assert.equal(saveRequests(page).length, 1);
  await act(async () => button.click());
  assert.equal(saveRequests(page).length, 2);
  assert.deepEqual(saveRequests(page)[1].args, saveRequests(page)[0].args);
  await act(async () => saveRequests(page)[1].resolve({ data: null, error: diagnosticError(saveDiagnostic()) }));
  await editPlan(page, '합성 다음 수정');
  assert.equal(document.querySelector('[data-testid="lesson-design-save-error"]'), null, 'edited input clears outdated feedback');
  assert.equal(dirty(), true);
});

test('unknown schedule information and a technical timeout cannot be presented as confirmed collisions', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await editPlan(page, '합성 수정');
  const payload = saveDiagnostic(); payload.confirmed = []; payload.confirmedCount = 0;
  await clickLessonSave();
  await act(async () => saveRequests(page)[0].resolve({ data: null, error: diagnosticError(payload) }));
  const panel = document.querySelector('[data-testid="lesson-design-save-error"]');
  assert.equal(panel.querySelector('[aria-label="확인된 일정 충돌"]'), null);
  assert.match(page.observed.lessonDesignSaveError, /충돌 여부를 확인하지 못했습니다/);
  assert.ok(panel.querySelector('[aria-label="정보 확인 필요"]'));
  const draft = structuredClone(page.observed.lessonPlanDraft);
  await clickLessonSave();
  const input = document.querySelector('input'); input.focus();
  await act(async () => saveRequests(page)[1].resolve({ data: null, error: {
    code: '57014', message: 'canceling statement due to statement timeout', details: JSON.stringify(saveDiagnostic()),
  } }));
  assert.equal(document.activeElement, input, 'failure must not steal operator-moved focus');
  const timeout = document.querySelector('[data-testid="lesson-design-save-error"]');
  assert.match(timeout.textContent, /시간이 오래 걸려 저장이 중단/);
  assert.equal(timeout.querySelector('[aria-label="확인된 일정 충돌"]'), null);
  assert.equal(timeout.querySelector('[aria-label="정보 확인 필요"]'), null);
  assert.doesNotMatch(timeout.textContent, /합성 충돌 수업|canceling statement/);
  assert.deepEqual(page.observed.lessonPlanDraft, draft);
  assert.equal(dirty(), true);
  assert.equal(saveRequests(page).length, 2);
});

test('a late conflict reply after actor revocation cannot disclose old authorized schedule details', async t => {
  const page = await editor(t, 'curriculum/lesson-design');
  await editPlan(page, '합성 수정');
  await clickLessonSave();
  const old = saveRequests(page)[0];
  await page.auth({ user: null, role: null });
  await act(async () => old.resolve({ data: null, error: diagnosticError(saveDiagnostic()) }));
  assert.equal(page.observed.lessonPlanDraft, null);
  assert.equal(page.observed.lessonDesignSaveError, '');
  assert.equal(document.querySelector('[data-testid="lesson-design-save-error"]'), null);
  assert.doesNotMatch(document.body.textContent, /합성 충돌 수업|합성 과거 수업/);
  assert.equal(saveRequests(page).length, 1);
});

const sqlProducerFailures = JSON.parse(readFileSync(path.join(rootPath,
  'docs/qa/cycle-13-save-conflict-details/sql-producer-fixtures.json'), 'utf8'));
for (const kind of ['teacher', 'both', 'same-class', 'unknown-past']) {
  test(`actual SQL ${kind} DETAIL reaches the real schedule Save consumer`, async t => {
    const page = await editor(t, 'curriculum/lesson-design');
    await editPlan(page, '합성 계약 검증');
    const before = structuredClone(page.observed.lessonPlanDraft);
    const failure = sqlProducerFailures[kind], producer = JSON.parse(failure.details);
    assert.equal(failure.code, '23P01');
    assert.equal(failure.message, 'timetable_resource_conflict');
    await clickLessonSave();
    await act(async () => saveRequests(page)[0].resolve({ data: null, error: failure }));
    const panel = document.querySelector('[data-testid="lesson-design-save-error"]');
    assert.ok(panel);
    const confirmed = panel.querySelector('[aria-label="확인된 일정 충돌"]');
    const unknown = panel.querySelector('[aria-label="정보 확인 필요"]');
    if (kind === 'unknown-past') {
      assert.equal(confirmed, null);
      assert.ok(unknown);
      assert.match(unknown.textContent, new RegExp(producer.unresolved[0].className));
      assert.ok(unknown.textContent.includes(producer.unresolved[0].date));
      assert.match(unknown.textContent, /시간·선생님·강의실 정보 확인 필요/);
      assert.doesNotMatch(unknown.textContent, /겹친 시간|같은 선생님|같은 강의실/);
      assert.match(page.observed.lessonDesignSaveError, /충돌 여부를 확인하지 못했습니다/);
    } else {
      assert.ok(confirmed);
      assert.equal(unknown, null);
      const row = producer.confirmed[0];
      assert.ok(confirmed.textContent.includes(row.className));
      assert.ok(confirmed.textContent.includes(row.date));
      assert.match(confirmed.textContent, /09:00–10:00.*겹친 시간 09:30–10:00/s);
      if (row.teacherName) assert.ok(confirmed.textContent.includes(`같은 선생님 ${row.teacherName}`));
      else assert.doesNotMatch(confirmed.textContent, /같은 선생님/);
      if (row.classroomName) assert.ok(confirmed.textContent.includes(`같은 강의실 ${row.classroomName}`));
      else assert.doesNotMatch(confirmed.textContent, /같은 강의실/);
      if (row.sameClass) assert.match(confirmed.textContent, /같은 수업/);
    }
    assert.deepEqual(page.observed.lessonPlanDraft, before);
    assert.equal(dirty(), true);
    assert.equal(saveRequests(page).length, 1);
    assert.doesNotMatch(panel.textContent, /23P01|timetable_resource_conflict|dashboard_private|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
}

test('approved legacy request rows stay selectable but cannot be edited by date or calendar', async t => {
  const payload = legacyRecoveryDetail({firstState:'active'});
  const before = payload.classItem.schedulePlan;
  const request = { id:id(750), teacher_catalog_id:id(101), request_kind:'cancel_makeup', cancel_date:'2026-10-01',
    makeup_slots:[{startAt:'2026-10-02T10:00:00+09:00',endAt:'2026-10-02T11:00:00+09:00',classroom:'합성 강의실'},
      {startAt:'2026-10-02T12:00:00+09:00',endAt:'2026-10-02T13:00:00+09:00',classroom:'합성 강의실'}] };
  payload.classItem.schedulePlan=buildLegacyMakeupApprovalPlan(before,request,{teacher:{id:id(101),name:'합성 담당'},classrooms:[{id:id(201),name:'합성 강의실'}]});
  const page = await recoveryEditor(t,payload);
  for (const date of ['2026-10-01','2026-10-02']) {
    const panel=await selectLegacyRecoveryRow(page,date);
    assert.match(panel.textContent,/승인된 휴보강 일정/);
    assert.equal(panel.querySelector('a[href="/admin/makeup-requests"]')?.textContent,'휴보강');
    assert.equal(panel.querySelector('input[type="time"]'),null);
    assert.equal(panel.querySelector('textarea'),null);
    assert.equal(panel.querySelector('button[aria-label$="일정 해제"]'),null);
    const cell=document.querySelector(`[data-lesson-calendar-date="${date}"]`);
    assert.ok(cell); assert.equal(cell.draggable,false);
    const previous=JSON.stringify(page.observed.lessonPlanDraft);
    await act(async()=>cell.click());
    assert.equal(JSON.stringify(page.observed.lessonPlanDraft),previous,'calendar click selects without changing state');
  }
  assert.equal(saveRequests(page).length,0);
});

test('ordinary lesson sharing an approved makeup date stays editable by ID while request rows remain opaque', async t => {
  const payload = legacyRecoveryDetail({ firstState: 'active' });
  const ordinary = { ...payload.classItem.schedulePlan.sessions.find(row => row.date === '2026-10-01'),
    id: 'ordinary-same-date', sessionKey: 'ordinary-same-date', date: '2026-10-02', sessionNumber: 99,
    memo: '  ordinary\n memo  ' };
  const request = { id: id(751), teacher_catalog_id: id(101), request_kind: 'cancel_makeup', cancel_date: '2026-10-01',
    makeup_slots: [{ startAt: '2026-10-02T10:00:00+09:00', endAt: '2026-10-02T11:00:00+09:00', classroom: '합성 강의실' }] };
  payload.classItem.schedulePlan = buildLegacyMakeupApprovalPlan(payload.classItem.schedulePlan, request,
    { teacher: { id: id(101), name: '합성 담당' }, classrooms: [{ id: id(201), name: '합성 강의실' }] });
  payload.classItem.schedulePlan.sessions.push(ordinary);
  const saved = structuredClone(payload.classItem.schedulePlan), page = await recoveryEditor(t, payload);
  await selectLegacyRecoveryRow(page, '2026-10-02');
  const panelFor = rowId => [...document.querySelectorAll('[data-lesson-period-session-id]')].find(row => row.dataset.lessonPeriodSessionId === rowId);
  await act(async () => panelFor(ordinary.id).querySelector('button').click());
  const panel = panelFor(ordinary.id), textarea = panel.querySelector('textarea');
  assert.ok(textarea, 'same-date ownership does not disable an unrelated ID');
  assert.equal(textarea.value, ordinary.memo);
  assert.doesNotMatch(panel.textContent, /승인된 휴보강 일정/);
  const authored = '  ordinary edited\n  exact text  ';
  await changeTextarea(textarea, authored);
  for (const row of saved.sessions.filter(row => row.makeupRequestId === request.id)) {
    await act(async () => panelFor(row.id).querySelector('button').click());
    const protectedPanel = panelFor(row.id);
    assert.match(protectedPanel.textContent, /승인된 휴보강 일정/);
    assert.equal(protectedPanel.querySelector('textarea'), null);
    assert.equal(protectedPanel.querySelector('input[type="time"]'), null);
    assert.equal(protectedPanel.querySelector('button[aria-label$="일정 해제"]'), null);
  }
  const cell = document.querySelector('[data-lesson-calendar-date="2026-10-02"]');
  assert.equal(cell.draggable, false, 'date-addressed calendar guard remains intact');
  const draftBeforeClick = JSON.stringify(page.observed.lessonPlanDraft);
  await act(async () => cell.click());
  assert.equal(JSON.stringify(page.observed.lessonPlanDraft), draftBeforeClick);
  await clickLessonSave();
  assert.equal(saveRequests(page).length, 1, page.observed.lessonDesignSaveError);
  const sent = saveRequests(page)[0].args.p_patch.schedule_plan;
  assert.deepEqual(sent.sessions, saved.sessions.map(row => row.id === ordinary.id ? { ...row, memo: authored } : row));
  assert.deepEqual(sent.sessionStates, saved.sessionStates, 'a duplicate-date edit does not rewrite shared date metadata');
  assert.deepEqual(sent.billingPeriods, saved.billingPeriods);
  assert.deepEqual(payload.classItem.schedulePlan, saved);
});

// Independent review fixtures retained with unchanged assertions.
test('independent: selecting an authored lesson after opaque null history must remain usable', async t => {
  const payload = missingOctoberDetail();
  const target = payload.classItem.schedulePlan.sessions.at(-1);
  payload.classItem.schedulePlan.sessions.splice(1, 0, null, 'opaque historical entry');
  const page = await recoveryEditor(t, payload);
  await act(async () => page.observed.setSelectedLessonSessionId(target.id));
  assert.ok(page.observed.lessonDesignSnapshot.sessions.some(row => row.id === target.id));
  assert.deepEqual(page.observed.lessonPlanForSave.sessions, payload.classItem.schedulePlan.sessions);
});


test('independent: canonical date-map fields and editing do not silently alter an untouched displayed field', async t => {
  const payload = septemberOctoberDetail();
  const target = payload.classItem.schedulePlan.sessions.find(row => row.date === '2026-10-08');
  target.startTime='09:00';target.endTime='10:00';
  payload.classItem.schedulePlan.sessions=[target];
  payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':{startTime:'11:00',endTime:'12:00'}};
  const page = await recoveryEditor(t, payload);
  await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:{version:1,basicSlots:[],catalogs:{teachers:payload.teacherCatalogs,rooms:payload.classroomCatalogs}}}});
  await act(async()=>page.observed.setSelectedLessonSessionId(target.id));
  const detailButton=document.querySelector('button[aria-label="10월 상세 보기"]');
  if(detailButton)await act(async()=>detailButton.click());
  const item=[...document.querySelectorAll('[data-lesson-period-session-id]')].find(row=>row.dataset.lessonPeriodSessionId===target.id);
  await act(async()=>item.querySelector('button').click());
  const shownStart=document.querySelector('input[aria-label="2026-10-08 시작"]').value;
  assert.equal(shownStart,'09:00','reproduction confirms candidate displays the raw value');
  await changeInput('2026-10-08 종료','13:00');
  assert.equal(page.observed.lessonPlanForSave.sessions[0].startTime,shownStart,'editing end preserves displayed start');
});

test('adjacent React: first calendar click cancels the existing ordinary lesson', async t => {
 const payload=septemberOctoberDetail();
 payload.classItem.schedulePlan.sessionStates={};
 payload.classItem.schedulePlan.sessionSchedules={};
 const page=await recoveryEditor(t,payload);
 const selector='[data-lesson-calendar-month="2026-10"] [data-lesson-calendar-date="2026-10-08"]';
 const cell=document.querySelector(selector);assert.ok(cell);assert.equal(cell.dataset.lessonCalendarState,'active');
 await act(async()=>cell.click());
 const stored=page.observed.lessonPlanForSave.sessions.find(row=>row.date==='2026-10-08');
 assert.ok(stored,'calendar preserves a stored lesson for this date');
 assert.equal(stored.scheduleState,'exception','actual calendar click must cancel exactly once');
 assert.equal(document.querySelector(selector).dataset.lessonCalendarState,'exception','calendar must display the cancellation');
});

test('adjacent date-map React: displayed edit and emitted save payload must agree with the operating resolver', async t => {
 const payload=septemberOctoberDetail();
 const row=payload.classItem.schedulePlan.sessions.find(row=>row.date==='2026-10-08');
 for(const field of ['startTime','endTime','teacherCatalogId','classroomCatalogId','teacherName','classroomName'])delete row[field];
 payload.classItem.schedulePlan.sessions=[row];
 payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':{startTime:'12:00',endTime:'13:00',teacherCatalogId:id(101),classroomCatalogId:id(201)}};
 const context={version:1,basicSlots:[{id:'basic',weekday:4,startTime:'09:00',endTime:'10:00',teacherCatalogId:id(101),classroomCatalogId:id(201)}],catalogs:{teachers:payload.teacherCatalogs,rooms:payload.classroomCatalogs}};
 const page=await recoveryEditor(t,payload);
 await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:context}});
 await selectLegacyRecoveryRow(page,'2026-10-08');
 assert.equal(document.querySelector('input[aria-label="2026-10-08 종료"]').value,'13:00');
 await changeInput('2026-10-08 종료','13:30');
 assert.equal(document.querySelector('input[aria-label="2026-10-08 종료"]').value,'13:30');
 await clickLessonSave();
 assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
 const sent=saveRequests(page)[0].args.p_patch.schedule_plan;
 assert.equal(sent.sessions[0].endTime,'13:30','actual save payload contains authored edit');
 const {effectiveInputForLesson,resolveEffectiveSchedule}=page.load('src/features/operations/legacy-effective-schedule.js');
 const result=resolveEffectiveSchedule(effectiveInputForLesson(sent,sent.sessions[0],context));
 t.diagnostic(JSON.stringify({raw:sent.sessions[0],dateMap:sent.sessionSchedules['2026-10-08'],resolved:result}));
 assert.equal(result.values.endTime,'13:30','operating resolver must consume the field emitted by the actual save path');
 t.diagnostic(JSON.stringify({lessonReaderCase:'actual-react-save-payload',input:effectiveInputForLesson(sent,sent.sessions[0],context),expected:result}));
});

const boundaryContext=payload=>({version:1,basicSlots:[{id:'basic',weekday:4,startTime:'09:00',endTime:'10:00',teacherCatalogId:id(101),classroomCatalogId:id(201)}],catalogs:{teachers:payload.teacherCatalogs,rooms:payload.classroomCatalogs}});
test('p3 boundary A: raw start remains displayed and an earlier edited end is rejected', async t=>{
 const payload=septemberOctoberDetail(),row=payload.classItem.schedulePlan.sessions.find(row=>row.date==='2026-10-08');
 Object.assign(row,{startTime:'14:00',endTime:'15:00'});payload.classItem.schedulePlan.sessions=[row];
 payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':{startTime:'12:00',endTime:'13:00'}};
 const page=await recoveryEditor(t,payload),context=boundaryContext(payload);
 await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:context}});
 await selectLegacyRecoveryRow(page,'2026-10-08');
 assert.equal(document.querySelector('input[aria-label="2026-10-08 시작"]').value,'14:00');
 await changeInput('2026-10-08 종료','13:30');
 assert.equal(document.querySelector('input[aria-label="2026-10-08 시작"]').value,'14:00');
 await clickLessonSave();

 assert.equal(saveRequests(page).length,0,'invalid end before the unchanged displayed start must not reach RPC');
 assert.match(page.observed.lessonDesignSaveError,/종료 시간을 시작 시간 이후로/);
});

test('p3 boundary B: explicit same-date edit must be represented by the operating resolver after save', async t=>{
 const payload=septemberOctoberDetail(),row=payload.classItem.schedulePlan.sessions.find(row=>row.date==='2026-10-08');
 Object.assign(row,{startTime:'14:00',endTime:'15:00',teacherCatalogId:id(101),classroomCatalogId:id(201)});
 const peer={...structuredClone(row),id:'peer-id',sessionKey:'peer-id',startTime:'16:00',endTime:'17:00'};
 payload.classItem.schedulePlan.sessions=[row,peer];
 payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':{startTime:'12:00',endTime:'13:00',teacherCatalogId:id(101),classroomCatalogId:id(201)}};
 const page=await recoveryEditor(t,payload),context=boundaryContext(payload);
 await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:context}});
 await selectLegacyRecoveryRow(page,'2026-10-08');
 assert.equal(document.querySelector('input[aria-label="2026-10-08 종료"]').value,'15:00');
 await changeInput('2026-10-08 종료','15:30');await clickLessonSave();
 assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
 const sent=saveRequests(page)[0].args.p_patch.schedule_plan;
 assert.equal(sent.sessions[0].endTime,'15:30');assert.deepEqual(sent.sessions[1],peer);
 const {effectiveInputForLesson,resolveEffectiveSchedule}=page.load('src/features/operations/legacy-effective-schedule.js');
 const input=effectiveInputForLesson(sent,sent.sessions[0],context),result=resolveEffectiveSchedule(input);
 t.diagnostic(JSON.stringify({lessonReaderCase:'same-date-shared-map',input,expected:result}));
 assert.equal(result.values.endTime,'15:30','a valid ID-addressed field edit must remain effective for that row');
});

test('p3 boundary C: editing only time preserves displayed name-only teacher and room', async t=>{
 const payload=septemberOctoberDetail(),row=payload.classItem.schedulePlan.sessions.find(row=>row.date==='2026-10-08');
 for(const field of ['teacherCatalogId','classroomCatalogId'])delete row[field];
 Object.assign(row,{startTime:'09:00',endTime:'10:00',teacherName:'합성 담당',classroomName:'합성 강의실'});
 payload.classItem.schedulePlan.sessions=[row];
 payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':{startTime:'09:00',endTime:'10:00',teacherName:'다른 합성 담당',classroomName:'다른 합성 강의실'}};
 const page=await recoveryEditor(t,payload),context=boundaryContext(payload);
 await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:context}});
 await selectLegacyRecoveryRow(page,'2026-10-08');
 const resourceValues=()=>({teacher:document.querySelector('[aria-label="2026-10-08 선생님"]').value,room:document.querySelector('[aria-label="2026-10-08 강의실"]').value});
 const before=resourceValues();assert.equal(before.teacher,id(102));assert.equal(before.room,id(202));
 await changeInput('2026-10-08 종료','13:30');const after=resourceValues();await clickLessonSave();
 assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
 const sent=saveRequests(page)[0].args.p_patch.schedule_plan;
 assert.equal(sent.sessions[0].endTime,'13:30');assert.equal(sent.sessions[0].teacherName,row.teacherName);assert.equal(sent.sessions[0].classroomName,row.classroomName);
 const {effectiveInputForLesson,resolveEffectiveSchedule}=page.load('src/features/operations/legacy-effective-schedule.js');
 const input=effectiveInputForLesson(sent,sent.sessions[0],context),result=resolveEffectiveSchedule(input);
 t.diagnostic(JSON.stringify({lessonReaderCase:'name-only-resources',input,expected:result}));
 assert.deepEqual(after,before,'editing only end time must not change either displayed resource');
 assert.equal(result.values.teacherCatalogId,before.teacher);assert.equal(result.values.classroomCatalogId,before.room);
});

test('field-priority reset: shared date fallback is labelled and only the selected row is reset', async t => {
 const payload=septemberOctoberDetail(),row=payload.classItem.schedulePlan.sessions.find(row=>row.date==='2026-10-08');
 Object.assign(row,{startTime:'14:00',endTime:'15:00',teacherCatalogId:id(101),classroomCatalogId:id(201)});
 const peer={...structuredClone(row),id:'peer-id',sessionKey:'peer-id',startTime:'16:00',endTime:'17:00'};
 payload.classItem.schedulePlan.sessions=[row,peer];
 const dateMap={startTime:'12:00',endTime:'13:00',teacherCatalogId:id(102),classroomCatalogId:id(202),opaque:true};
 payload.classItem.schedulePlan.sessionSchedules={'2026-10-08':dateMap};
 const page=await recoveryEditor(t,payload),context=boundaryContext(payload);
 await page.normalized({status:'ready',value:{source:'legacy',sessions:[],effectiveScheduleContext:context}});
 await selectLegacyRecoveryRow(page,'2026-10-08');
 const reset=document.querySelector('button[aria-label="2026-10-08 개별 설정 해제"]');
 assert.ok(reset);assert.match(reset.textContent,/날짜 설정 사용/);
 await act(async()=>reset.click());
 assert.equal(document.querySelector('input[aria-label="2026-10-08 시작"]').value,'12:00');
 await clickLessonSave();assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
 const sent=saveRequests(page)[0].args.p_patch.schedule_plan;
 assert.deepEqual(sent.sessions[1],peer);assert.deepEqual(sent.sessionSchedules['2026-10-08'],dateMap);
 const {effectiveInputForLesson,resolveEffectiveSchedule}=page.load('src/features/operations/legacy-effective-schedule.js');
 assert.equal(resolveEffectiveSchedule(effectiveInputForLesson(sent,sent.sessions[0],context)).values.startTime,'12:00');
 assert.equal(resolveEffectiveSchedule(effectiveInputForLesson(sent,sent.sessions[1],context)).values.startTime,'16:00');
});

for (const action of ['tbd','skipped','unlink']) {
 test(`PR161 P2: previously scheduled makeup on source date ${action} clears only selected link`,async t=>{
  const {setAuthoredLegacyMakeupDate}=await import('../src/features/operations/legacy-authored-lesson-plan.ts');
  const payload=legacyRecoveryDetail({firstState:'active'});
  let plan=payload.classItem.schedulePlan;
  const source=plan.sessions.find(row=>row.date==='2026-10-01'),september=plan.sessions.find(row=>row.date==='2026-09-29');
  plan=setAuthoredLegacyMakeupDate(plan,source.id,'2026-10-02');
  plan=setAuthoredLegacyMakeupDate(plan,september.id,source.date);
  const child=plan.sessions.find(row=>row.originalDate===source.date&&row.billingId===source.billingId);
  const peer=plan.sessions.find(row=>row.originalDate===september.date&&row.billingId===september.billingId);
  assert.ok(child);assert.ok(peer);assert.equal(peer.date,source.date);
  payload.classItem.schedulePlan=plan;
  const before=structuredClone(plan),page=await recoveryEditor(t,payload),panel=await selectLegacyRecoveryRow(page,source.date);
  const button=action==='skipped'?panel.querySelector('button[aria-label$=" 일정 해제"]'):[...panel.querySelectorAll('button')].find(item=>item.textContent.trim()===({tbd:'미정',unlink:'보강 해제'})[action]);
  assert.ok(button);await act(async()=>button.click());
  await clickLessonSave();assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
  const sent=saveRequests(page)[0].args.p_patch.schedule_plan;
  assert.deepEqual(sent.sessions.find(row=>row.id===peer.id),peer,'other original lesson\'s makeup is preserved');
  assert.deepEqual(sent.sessions.find(row=>row.id===september.id),before.sessions.find(row=>row.id===september.id),'other original source is preserved');
  t.diagnostic(JSON.stringify({reachable:true,action,source:sent.sessions.find(row=>row.id===source.id),child:sent.sessions.find(row=>row.id===child.id),peer:sent.sessions.find(row=>row.id===peer.id),saveRequests:saveRequests(page).length}));
  assert.equal(sent.sessions.some(row=>row.id===child.id),false,'selected link child must be removed');
  assert.equal(sent.sessions.find(row=>row.id===source.id).makeupDate,'');
  assert.equal(sent.sessions.find(row=>row.id===source.id).scheduleState,action==='unlink'?'exception':action);
  assert.deepEqual(sent.sessionStates,before.sessionStates,'shared date map is not reassigned to the selected source');
 });
}

test('PR161 P2: selecting a linked child resolves its exact same-date source in the React save path',async t=>{
 const {setAuthoredLegacyMakeupDate}=await import('../src/features/operations/legacy-authored-lesson-plan.ts');
 const payload=legacyRecoveryDetail({firstState:'active'});
 let plan=payload.classItem.schedulePlan;
 const source=plan.sessions.find(row=>row.date==='2026-10-01');
 const peer={...source,id:'same-date-source-peer',sessionKey:'same-date-source-peer',memo:' peer learning ',teacherNote:'keep peer'};
 plan={...plan,sessions:[...plan.sessions,peer]};
 plan=setAuthoredLegacyMakeupDate(plan,source.id,'2026-10-02',' own ');
 plan=setAuthoredLegacyMakeupDate(plan,peer.id,'2026-10-03',' other ');
 const own=plan.sessions.find(row=>row.originalSessionId===source.id),other=plan.sessions.find(row=>row.originalSessionId===peer.id);
 assert.ok(own);assert.ok(other);payload.classItem.schedulePlan=plan;
 const page=await recoveryEditor(t,payload),panel=await selectLegacyRecoveryRow(page,'2026-10-02');
 assert.equal(panel.dataset.lessonPeriodSessionId,own.id);
 const unlink=[...panel.querySelectorAll('button')].find(button=>button.textContent.trim()==='보강 해제');
 assert.ok(unlink);await act(async()=>unlink.click());await clickLessonSave();
 assert.equal(saveRequests(page).length,1,page.observed.lessonDesignSaveError);
 const saved=saveRequests(page)[0].args.p_patch.schedule_plan;
 assert.equal(saved.sessions.some(row=>row.id===own.id),false);
 assert.deepEqual(saved.sessions.find(row=>row.id===other.id),other);
 assert.deepEqual(saved.sessions.find(row=>row.id===peer.id),plan.sessions.find(row=>row.id===peer.id));
 assert.deepEqual(saved.sessions.find(row=>row.id===source.id),{...plan.sessions.find(row=>row.id===source.id),makeupDate:''});
});

function calendarPairDetail(withMakeup) {
  const payload = detail();
  if (withMakeup) {
    payload.classItem.schedulePlan = buildSchedulePlanForSave({
      selectedDays: [2, 4, 6],
      billingPeriods: [
        { id: 'september', label: '9월', month: 9, startDate: '2026-09-01', endDate: '2026-10-01' },
        { id: 'october', label: '10월', month: 10, startDate: '2026-10-03', endDate: '2026-10-31' },
      ],
      sessionStates: {
        '2026-09-26': { state: 'exception' },
        '2026-10-10': { state: 'exception', makeupDate: '2026-09-26', makeupMemo: '보강 11:00-13:00' },
      }, sessions: [],
    });
  } else {
    const plan = payload.classItem.schedulePlan, original = plan.sessions[0];
    plan.sessions.push(
      { ...original, id: 'same-date-second', sessionKey: 'same-date-second', memo: '두 번째 메모' },
      { ...original, id: 'same-date-third', sessionKey: 'same-date-third', memo: '세 번째 메모' },
    );
  }
  return payload;
}

function recordCalendarPairGeometry({ hidden = false } = {}) {
  const calendarDates = [], scrollCalls = [];
  const isSidebar = element => element.matches?.('[data-lesson-period-sidebar="true"]');
  const isDialog = element => element.getAttribute?.('data-testid') === 'lesson-design-dialog-scroll';
  const originalStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = element => {
    const styles = originalStyle(element);
    if (!isSidebar(element)) return styles;
    return new Proxy(styles, { get(target, key) {
      if (key === 'position') return hidden ? 'static' : 'sticky';
      if (key === 'overflowY') return 'auto';
      return Reflect.get(target, key, target);
    } });
  };
  globalThis.getComputedStyle = window.getComputedStyle;
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return isDialog(this) ? 4000 : isSidebar(this) ? 2000 : 100; } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return isDialog(this) ? 800 : isSidebar(this) ? 500 : 100; } });
  window.HTMLElement.prototype.getClientRects = function () {
    return hidden && this.closest('[data-testid="lesson-desktop-calendar"]') ? [] : [{ width: 500, height: 84 }];
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const date = this.getAttribute('data-lesson-calendar-date');
    if (date) calendarDates.push(date);
    const top = date ? 1200 + Number(date.slice(-2)) * 10 : this.hasAttribute('data-lesson-period-session-id') ? 300 : isSidebar(this) ? 100 : 0;
    const height = date ? 84 : this.hasAttribute('data-lesson-period-session-id') ? 120 : isSidebar(this) ? 500 : 800;
    return { top, y: top, left: 0, x: 0, width: 500, height, right: 500, bottom: top + height, toJSON() { return {}; } };
  };
  window.HTMLElement.prototype.scrollTo = function (options) {
    scrollCalls.push({ target: isDialog(this) ? 'dialog' : isSidebar(this) ? 'sidebar' : this.tagName, top: options.top });
    this.scrollTop = options.top || 0;
  };
  window.HTMLElement.prototype.scrollIntoView = function () {
    const date = this.getAttribute('data-lesson-calendar-date');
    if (date) calendarDates.push(date);
    scrollCalls.push({ target: date ? 'calendar' : this.tagName, date });
  };
  return { calendarDates, scrollCalls };
}

for (const scenario of [
  { name: 'primary ordinary session', target: 'primary' },
  { name: 'second ordinary same-date session', target: 'same-date-second' },
  { name: 'third ordinary same-date session', target: 'same-date-third' },
  { name: 'different-date session', target: 'different' },
  { name: 'same-date linked makeup', target: 'makeup', withMakeup: true },
  { name: 'primary session in a dialog', target: 'primary', route: 'class-schedule' },
  { name: 'secondary session in a dialog', target: 'same-date-second', route: 'class-schedule' },
  { name: 'hidden mobile calendar for primary session', target: 'primary', hidden: true },
  { name: 'hidden mobile calendar for secondary session', target: 'same-date-second', hidden: true },
]) test(`calendar pair: ${scenario.name} preserves identity and the draft without saving`, async t => {
  const page = await editor(t, scenario.route || 'curriculum/lesson-design');
  const payload = calendarPairDetail(scenario.withMakeup);
  await refreshDetail(page, payload);
  const sessions = page.observed.lessonDesignSnapshot.sessions;
  const firstDate = scenario.withMakeup ? '2026-09-26' : '2026-08-03';
  const cell = document.querySelector(`[data-lesson-calendar-date="${firstDate}"]`);
  assert.ok(cell);
  const primaryId = cell.getAttribute('data-lesson-calendar-session-id');
  const selected = scenario.target === 'primary' ? sessions.find(row => row.id === primaryId)
    : scenario.target === 'different' ? sessions.find(row => row.dateValue !== firstDate)
    : scenario.target === 'makeup' ? sessions.find(row => row.dateValue === firstDate && row.scheduleState === 'makeup')
    : sessions.find(row => row.id === scenario.target);
  assert.ok(selected, 'fixture contains the intended distinct lesson');
  const period = payload.classItem.schedulePlan.billingPeriods.find(row => row.id === selected.periodId)
    || payload.classItem.schedulePlan.billingPeriods[0];
  const open = document.querySelector(`button[aria-label="${period.label} 상세 보기"]`);
  if (open) await act(async () => open.click());
  await editPlan(page, 'UNSAVED PAIR COLOR');
  assert.equal(dirty(), true);
  const before = JSON.stringify(page.observed.lessonPlanDraft);
  const recorder = recordCalendarPairGeometry(scenario);
  const trigger = document.querySelector(`[data-lesson-period-session-id="${selected.id}"] button[aria-pressed]`);
  assert.ok(trigger, 'select via the real monthly-session button');
  await act(async () => {
    trigger.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    trigger.click();
  });
  for (let step = 0; step < 5; step++) await act(async () => new Promise(resolve => window.setTimeout(resolve, 12)));
  assert.equal(page.observed.selectedLessonSessionId, selected.id);
  assert.equal(document.querySelector(`[data-lesson-period-session-id="${selected.id}"] button[aria-pressed]`).getAttribute('aria-pressed'), 'true');
  assert.equal(JSON.stringify(page.observed.lessonPlanDraft), before, 'selection preserves all lesson IDs, notes, learning, billing and unsaved inputs');
  assert.equal(dirty(), true);
  assert.equal(saveRequests(page).length, 0);
  if (scenario.hidden) {
    assert.deepEqual(recorder.calendarDates, [], 'never align to the hidden desktop calendar');
  } else {
    assert.ok(recorder.calendarDates.length > 0, 'the selected lesson resolves to its displayed calendar date cell');
    assert.ok(recorder.calendarDates.every(date => date === selected.dateValue), 'never align to a different date');
    if (scenario.route === 'class-schedule') assert.ok(recorder.scrollCalls.some(call => call.target === 'dialog' && call.top > 200), 'dialog alignment runs with the resolved whole date cell');
  }
});
