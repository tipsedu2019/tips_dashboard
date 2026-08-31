import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function modules(supabase, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === '@/lib/supabase') return { supabase };
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, `module ${specifier}`);
      return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return (entry) => load(path.join(rootPath, entry));
}
const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, patch = {}) => ({
  id: id(n), title: `업무 ${n}`, type: 'general', status: 'requested', priority: 'normal', requestedById: null,
  requestedByLabel: '', requestedTeam: '', assigneeId: null, assigneeLabel: '', assigneeTeam: '', secondaryAssigneeId: null,
  secondaryAssigneeLabel: '', studentId: null, studentName: '', classId: null, className: '', textbookId: null, textbookTitle: '',
  campus: '', subject: '', startAt: null, dueAt: null, completedAt: null, completedById: null, completedByLabel: '', memo: '',
  createdAt: '2026-08-31T00:00:00+00:00', updatedAt: '2026-08-31T00:00:00+00:00', summaryFlags: [], ...patch,
});
const strings = (names) => Object.fromEntries(names.split(' ').map((name) => [name, '']));
function operationPatch(type, studentName = '서버 학생') {
  if (type === 'word_retest') return { type, status: 'in_progress', studentName, inlineState: {
    retryOfTaskId: null, retryTaskId: null, teacherId: null, branch: '본관', teacherName: '담당', className: '수업', studentName,
    textbookName: '교재', unit: '1', requestNote: '', testAt: null, expectedRetestAt: null,
    totalQuestionCount: 30, cutoffQuestionCount: 25, firstScore: null, secondScore: null, thirdScore: null, retestStatus: 'in_progress',
  }, displayValues: strings('status testAt expectedRetestAt teacher class student textbook unit note total cutoff score result') };
  if (type === 'withdrawal') return { type, studentName, inlineState: {
    ...strings('teacherName withdrawalSession customerReason teacherOpinion undistributedTextbooks'), withdrawalDate: null,
    completedLessonHours: null, fourWeekLessonHours: null, makeeduWithdrawalDone: false, feeProcessed: false, textbookFeeProcessed: false,
  }, displayValues: strings('status subject teacher className student withdrawalDate withdrawalSession completedLessonHours fourWeekLessonHours progress customerReason teacherOpinion undistributedTextbooks operationsChecklist') };
  return { type, studentName, inlineState: {
    fromClassId: null, toClassId: null, fromClassEndDate: null, toClassStartDate: null,
    ...strings('fromTeacherName toTeacherName fromClassName toClassName fromClassEndSession toClassStartSession transferReason fromUndistributedTextbooks toUndistributedTextbooks'),
    makeeduTransferDone: false, feeProcessed: false, textbookFeeProcessed: false,
  }, displayValues: strings('status subject fromTeacher fromClassName student transferReason fromUndistributedTextbooks fromClassEndDate fromClassEndSession toTeacher toClassName toClassStartDate toClassStartSession toUndistributedTextbooks operationsChecklist') };
}
function registrationPatch(n, studentName = '등록 학생') {
  return { type: 'registration', studentName, registration: {
    ...strings('pipelineStatus schoolGrade schoolName parentPhone studentPhone levelTestResult levelTestPlace levelTestMaterialLink counselor classStartSession requestNote'),
    ...Object.fromEntries('inquiryAt levelTestAt levelTestCompletedAt phoneConsultationAt visitConsultationAt consultationAt classStartDate'.split(' ').map((key) => [key, null])),
  }, registrationTracks: ['영어', '수학'].map((subject, i) => ({
    id: id(1000 + n * 2 + i), taskId: id(n), subject, status: 'inquiry', workflowStatus: 'inquiry', workflowRevision: 1,
    workflowStatusEnteredAt: '2026-08-31T00:00:00Z', stageEnteredAt: '2026-08-31T00:00:00Z', legacy: false,
    ...strings('directorName directorAssignmentRuleKey directorAssignmentSource waitingKind waitingDetailKind waitingDetailRetakeDecision levelTestRetakeDecision'),
    ...Object.fromEntries('directorProfileId waitingDetailClassId observationCurrentId observationCurrentAppointmentId phoneReadyAt levelTestScheduledAt visitScheduledAt observationNearestScheduledAt levelTestPlace visitPlace phoneReadySource observationAttemptCount observationNotificationRevision observationRevision observationFeedbackRevision observationCurrentStatus observationNearestPlace'.split(' ').map((key) => [key, null])),
    enrollmentDetailRows: [], migrationReviewRequired: false, observationSummaryVisible: true,
  })) };
}
function transport(pendingRpcNames = []) {
  const requests = [];
  return { requests, supabase: { rpc(name, args) {
    const pending = Promise.withResolvers();
    const request = { name, args, ...pending }; requests.push(request);
    return { ...(name === 'add_ops_task_comment_v2' || pendingRpcNames.includes(name) ? { then: pending.promise.then.bind(pending.promise) } : {}), abortSignal(signal) { request.signal = signal; return this; }, retry() { return pending.promise; } };
  } }, finish(index, totalCount = 260, patches = []) {
    const request = requests[index], { p_page: page, p_page_size: pageSize } = request.args;
    request.resolve({ error: null, data: { page, pageSize, totalCount,
      rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => row((page - 1) * pageSize + i + 1, patches[i])),
    } });
  } };
}
async function setup(t, url = 'https://test.invalid/admin/tasks') {
  const dom = new JSDOM('<div id="root"></div>', { url });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify({ 'ops-task:general': { mode: 'manual', pageSize: 10 } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  return { root };
}
async function hook(t, initial = {}) {
  const { root } = await setup(t);
  const io = transport(), load = modules(io.supabase);
  const hookPath = 'src/features/tasks/use-ops-task-numbered-page.ts';
  assert.ok(existsSync(path.join(rootPath, hookPath)), 'task numbered hook must exist');
  const { useOpsTaskNumberedPage } = load(hookPath);
  const { createDefaultOpsTaskPageFilters } = load('src/features/tasks/ops-task-service.ts');
  let state, props = { viewerId: 'actor-a', viewerRole: 'staff', enabled: true, filters: createDefaultOpsTaskPageFilters('general', 'actor-a'), ...initial };
  function Probe(props) { const result = useOpsTaskNumberedPage(props); useEffect(() => { state = result; }); return createElement('div', null, result.rows.map((task) => createElement('p', { key: task.id }, task.title))); }
  const render = async (next = {}) => { props = { ...props, ...next }; await act(async () => root.render(createElement(Probe, props))); };
  await render();
  return { ...io, render, get state() { return state; }, get props() { return props; } };
}
test('real hook jumps directly to page 11, retains displayed page on failure, retries and clamps refresh', async (t) => {
  const page = await hook(t);
  assert.equal(page.requests.length, 1);
  await act(async () => page.finish(0));
  await act(async () => { void page.state.goToPage(11); });
  assert.equal(page.requests.length, 2); assert.equal(page.requests[1].args.p_page, 11);
  assert.equal(page.state.page, 1); assert.equal(page.state.rows[0].title, '업무 1');
  await act(async () => page.requests[1].reject(new Error('offline')));
  assert.equal(page.state.page, 1); assert.ok(page.state.error);
  await act(async () => { void page.state.retry(); });
  assert.equal(page.requests[2].args.p_page, 11);
  await act(async () => page.finish(2));
  assert.equal(page.state.page, 11); assert.equal(page.state.rows[0].title, '업무 101');
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.requests[3].args.p_page, 11);
  await act(async () => page.finish(3, 97));
  assert.equal(page.requests[4].args.p_page, 10);
  await act(async () => page.finish(4, 97));
  assert.equal(page.state.page, 10); assert.equal(page.state.totalCount, 97);
});
test('filter and size changes request page one atomically and reject obsolete responses', async (t) => {
  const page = await hook(t); await act(async () => page.finish(0));
  await act(async () => { void page.state.goToPage(11); });
  await page.render({ filters: { ...page.props.filters, search: '새 검색' } });
  assert.equal(page.requests[1].signal.aborted, true);
  assert.deepEqual(page.requests.slice(1).map((r) => [r.args.p_page, r.args.p_filters.search]), [[11, ''], [1, '새 검색']]);
  await act(async () => page.finish(2, 2)); await act(async () => page.finish(1));
  assert.equal(page.state.page, 1); assert.equal(page.state.totalCount, 2);
  await act(async () => { page.state.setPageSizePreference(15); });
  assert.deepEqual(page.requests.slice(3).map((r) => [r.args.p_page, r.args.p_page_size]), [[1, 15]]);
});
test('restoration is edge-triggered and only successful commits notify the workspace without URL writes', async (t) => {
  const commits = [];
  const page = await hook(t, { restoredPage: 11, restorationKey: 'entry-A', onPageCommit: (value) => commits.push(value) });
  assert.equal(page.requests[0].args.p_page, 11);
  const before = window.location.href;
  await act(async () => page.finish(0));
  assert.equal(commits.length, 1); assert.equal(commits[0].page, 11); assert.equal(window.location.href, before);
  await page.render({ restoredPage: 12 });
  assert.equal(page.requests.length, 1, 'same restoration key is not another command');
  await act(async () => { void page.state.goToPage(12); });
  await act(async () => page.requests[1].reject(new Error('offline')));
  assert.equal(commits.length, 1);
  await page.render({ filters: { ...page.props.filters, search: 'new' } });
  assert.equal(page.requests[2].args.p_page, 1, 'unchanged restoration key cannot restore stale page11 on filter change');
  await page.render({ restorationKey: 'entry-B', restoredPage: 7 });
  assert.equal(page.requests[3].args.p_page, 7);
});
test('explicit complete fixture adapter replaces rows and counts parent items', async () => {
  const { getCompleteOpsTaskFixturePage } = modules(null)('src/features/tasks/use-ops-task-numbered-page.ts');
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1) }));
  assert.deepEqual(getCompleteOpsTaskFixturePage(rows, 2, 15), { rows: rows.slice(15), page: 2, pageSize: 15, totalCount: 26 });
  assert.deepEqual(getCompleteOpsTaskFixturePage([], 7, 10), { rows: [], page: 1, pageSize: 10, totalCount: 0 });
});

test('query readiness pauses without clearing the successful actor page', async (t) => {
  const page = await hook(t);
  await act(async () => page.finish(0));
  await page.render({ enabled: false, filters: { ...page.props.filters, search: '복원 중' } });
  assert.equal(page.requests.length, 1);
  assert.equal(page.state.rows[0]?.title, '업무 1');
  await page.render({ enabled: true, restoredPage: 7, restorationKey: 'back' });
  assert.equal(page.requests[1].args.p_page, 7);
  await act(async () => page.requests[1].reject(new Error('restoration offline')));
  assert.equal(page.state.rows[0]?.title, '업무 1');
  assert.equal(page.state.totalCount, 260);
});
for (const outcome of ['complete', 'reject']) test(`paused in-flight ${outcome} resumes its requested page without page-one replay`, async (t) => {
  const page = await hook(t);
  await act(async () => page.finish(0));
  await act(async () => { void page.state.goToPage(2); });
  await page.render({ enabled: false });
  await act(async () => outcome === 'complete' ? page.finish(1) : page.requests[1].reject(new Error('paused offline')));
  assert.equal(page.state.rows[0].title, '업무 1'); assert.equal(page.state.totalCount, 260);
  await page.render({ enabled: true });
  assert.equal(page.requests.length, 3);
  assert.equal(page.requests[2].args.p_page, 2);
  await act(async () => page.finish(2));
  assert.equal(page.state.loading, false); assert.equal(page.state.error, null);
  assert.equal(page.state.page, 2); assert.equal(page.state.rows[0].title, '업무 11');
});
test('paused request recovery yields to a restored target and rejects an old-scope completion', async (t) => {
  const page = await hook(t);
  await act(async () => page.finish(0));
  await act(async () => { void page.state.goToPage(2); });
  await page.render({ enabled: false });
  await page.render({ enabled: false, filters: { ...page.props.filters, search: 'NEW SCOPE' }, restoredPage: 7, restorationKey: 'restore-seven' });
  await act(async () => page.finish(1));
  await page.render({ enabled: true });
  assert.equal(page.requests.length, 3); assert.equal(page.requests[2].args.p_page, 7);
  assert.equal(page.requests[2].args.p_filters.search, 'NEW SCOPE');
  assert.equal(page.state.rows[0].title, '업무 1');
  await act(async () => page.finish(2, 70));
  assert.equal(page.state.page, 7); assert.equal(page.state.loading, false);
});
test('paused old-actor request cannot resume into the new actor or publish late completion', async (t) => {
  const page = await hook(t);
  await act(async () => page.finish(0));
  await act(async () => { void page.state.goToPage(2); });
  await page.render({ enabled: false });
  await page.render({ viewerId: 'actor-b', enabled: false });
  await act(async () => page.finish(1));
  assert.equal(page.state.rows.length, 0);
  await page.render({ enabled: true });
  assert.equal(page.requests.length, 3); assert.equal(page.requests[2].args.p_page, 1);
  await act(async () => page.finish(2, 1, [{ title: 'B ONLY' }]));
  assert.equal(page.state.rows[0].title, 'B ONLY'); assert.equal(page.state.loading, false);
});
test('same-id role change, logout, actor switch and unresolved profile clear output without anonymous reads', async (t) => {
  const page = await hook(t, { enabled: false, viewerRole: '' }); assert.equal(page.requests.length, 0);
  await page.render({ enabled: true, viewerRole: 'staff' }); assert.equal(page.requests.length, 1);
  await act(async () => page.finish(0));
  await page.render({ viewerRole: 'teacher' });
  assert.equal(page.state.rows.length, 0); assert.equal(page.state.totalCount, null);
  await act(async () => page.finish(1));
  await act(async () => { void page.state.goToPage(11); });
  await page.render({ viewerId: '', viewerRole: '', enabled: false });
  assert.equal(page.state.rows.length, 0); assert.equal(page.requests.length, 3); assert.equal(page.requests[2].signal.aborted, true);
  await act(async () => page.finish(2)); assert.equal(page.state.rows.length, 0);
  await page.render({ viewerId: 'actor-b', viewerRole: 'staff', enabled: true });
  assert.equal(page.requests[3].args.p_page, 1);
  await act(async () => page.finish(3, 1, [{ title: 'B 업무' }])); assert.equal(document.body.textContent, 'B 업무');
});

async function workspace(t, initial = {}) {
  const { root } = await setup(t, `https://test.invalid/admin/${initial.workspace || 'tasks'}${initial.search || ''}`);
  if (initial.historyState) window.history.replaceState(initial.historyState, '', window.location.href);
  const io = transport(initial.pendingRpcNames);
  // Table/auth/router are external boundaries; hook, service DTO and workspace models stay real.
  const queries = [], tableRequests = [];
  io.supabase.from = (table) => {
    const pending = Promise.withResolvers();
    const request = { table, ...pending, filters: [] }; tableRequests.push(request);
    const query = new Proxy({}, { get(_target, key) {
      if (key === 'then') return pending.promise.then.bind(pending.promise);
      return (...args) => { request.filters.push([key, ...args]); return query; };
    } });
    if (!initial.deferTables && table !== 'ops_tasks') pending.resolve({ data: initial.tableData?.[table] || [], error: null });
    queries.push(table); return query;
  };
  let props = { workspace: 'todo', viewerId: 'actor-a', viewerRole: 'staff', loading: false, ...initial };
  const router = { replace(url) { window.history.replaceState(null, '', url); }, push(url) { window.history.pushState(null, '', url); } };
  let previousSearch = '', params = new URLSearchParams();
  const load = modules(io.supabase, {
    '@/providers/auth-provider': { useAuth: () => ({ user: props.viewerId ? { id: props.viewerId, role: props.viewerRole, name: 'Actor' } : null,
      session: null, loading: props.loading, role: props.viewerRole, canManageAll: ['staff', 'admin'].includes(props.viewerRole),
      isAdmin: props.viewerRole === 'admin', isStaff: props.viewerRole === 'staff', isTeacher: props.viewerRole === 'teacher', isAssistant: props.viewerRole === 'assistant' }) },
    'next/navigation': { useRouter: () => router, usePathname: () => window.location.pathname, useSearchParams: () => {
      if (previousSearch !== window.location.search) { previousSearch = window.location.search; params = new URLSearchParams(previousSearch); }
      return params;
    } },
  });
  if (initial.expandWordFixture) {
    const fixture = load('src/features/tasks/word-retest-browser-fixture.ts');
    const original = fixture.getWordRetestBrowserFixtureData;
    fixture.getWordRetestBrowserFixtureData = (role) => {
      const data = original(role), source = data.tasks[0];
      return { ...data, tasks: Array.from({ length: 12 }, (_, i) => {
        const name = `정렬학생${String(12 - i).padStart(2, '0')}`;
        return { ...source, id: id(i + 1), studentName: name, wordRetest: { ...source.wordRetest, studentName: name } };
      }) };
    };
  }
  const { OpsTaskWorkspace } = load('src/features/tasks/ops-task-workspace.tsx');
  let mountKey = 0;
  const render = async (next = {}) => { props = { ...props, ...next }; await act(async () => root.render(createElement(OpsTaskWorkspace, { workspace: props.workspace, key: mountKey }))); };
  await render();
  return { ...io, queries, tableRequests, render, load, remount: async () => { mountKey++; await render(); }, get props() { return props; } };
}
for (const fixture of [
  { label: 'literal descending', titles: ['Z 업무', 'A 업무'] },
  { label: 'natural numeric', titles: ['업무 2', '업무 10'] },
  { label: 'secondary tie', titles: ['Z tie', 'Y tie', 'A other'] },
]) test(`actual workspace preserves RPC ${fixture.label} row order and numbered total`, async (t) => {
  const page = await workspace(t);
  const index = page.requests.findIndex((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.notEqual(index, -1, 'workspace must issue a direct numbered RPC');
  await act(async () => page.finish(index, fixture.titles.length, fixture.titles.map((title, i) => ({ title, dueAt: `2026-09-${String(10 - i).padStart(2, '0')}T00:00:00+00:00` }))));
  const table = document.querySelector('[data-testid="todo-table-task-list"]');
  assert.ok(table, 'actual task table renders');
  const rendered = table.textContent;
  let previous = -1;
  for (const title of fixture.titles) { const position = rendered.indexOf(title); assert.ok(position > previous, `${title} retains RPC position`); previous = position; }
  assert.ok(document.body.textContent.includes(`${fixture.titles.length}건 · 1–${fixture.titles.length}번째`));
});
test('actual workspace suppresses unresolved auth reads and remounts same-id role state', async (t) => {
  const page = await workspace(t, { loading: true, viewerRole: '' });
  assert.equal(page.requests.length, 0); assert.equal(page.queries.length, 0);
  await page.render({ loading: false, viewerRole: 'staff' });
  let index = page.requests.findIndex((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(index, 1, [{ title: '이전 역할 업무' }]));
  assert.ok(document.body.textContent.includes('이전 역할 업무'));
  await page.render({ viewerRole: 'teacher' });
  assert.equal(document.body.textContent.includes('이전 역할 업무'), false);
  const newPages = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(newPages.length, 2);
  index = page.requests.indexOf(newPages[1]);
  await act(async () => page.finish(index, 1, [{ title: '새 역할 업무' }]));
  assert.ok(document.body.textContent.includes('새 역할 업무'));
});
test('registration list renders every delivered parent on both mirrors without a second window', async (t) => {
  const { root } = await setup(t);
  const load = modules(null);
  const { RegistrationCaseList } = load('src/features/tasks/registration-case-list.tsx');
  const { buildRegistrationCaseListItems, filterRegistrationCaseListItems } = load('src/features/tasks/registration-case-list-model.ts');
  const tasks = Array.from({ length: 41 }, (_, index) => ({ ...row(index + 1), type: 'registration', studentName: `학생 ${index + 1}`,
    registration: { parentPhone: '', studentPhone: '', schoolGrade: '', schoolName: '', requestNote: '' },
    registrationTracks: ['영어', '수학'].map((subject, i) => ({ id: id(1000 + index * 2 + i), taskId: id(index + 1), subject, status: 'inquiry', workflowStatus: 'inquiry', directorName: '', stageEnteredAt: '2026-08-31T00:00:00Z', migrationReviewRequired: false })) }));
  const items = filterRegistrationCaseListItems(buildRegistrationCaseListItems(tasks), 'inquiry');
  assert.equal(items.length, 41, 'two tracks remain one parent');
  await act(async () => root.render(createElement(RegistrationCaseList, { items, viewerId: 'actor-a', viewerRole: 'staff', classes: [], textbooks: [], canDelete: () => false, onOpen() {}, onEdit() {}, onStatusChange() {}, onDelete() {} })));
  assert.equal(document.querySelectorAll('[data-testid="registration-case-mobile-list"] [data-registration-case-row]').length, 41);
  assert.equal(document.querySelectorAll('[data-testid="registration-case-desktop-list"] [data-registration-case-row]').length, 41);
  assert.equal(document.body.textContent.includes('더 보기'), false);
});

test('numbered general page retains authorized textbook parent rows and its count', async (t) => {
  const page = await workspace(t);
  const index = page.requests.findIndex((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(index, 1, [{ type: 'textbook', title: '서버가 선택한 교재 업무' }]));
  assert.ok(document.body.textContent.includes('서버가 선택한 교재 업무'));
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});
test('workspace restores nondefault local filters sort and page atomically on detail-return remount and real Back', async (t) => {
  const filters = { taskType: 'general', search: '복원 검색', statuses: [], queue: 'sent', requestedById: id(900), requestedTeam: null, assigneeId: null, assigneeTeam: null, focus: 'none', sort: 'priority' };
  const saved = { version: 1, actorScope: '["actor-a","staff"]', pathname: '/admin/tasks', filters, page: 7, pageSize: 10, scrollY: 420 };
  const page = await workspace(t, { search: '?list=sent&sort=priority&taskPage=7&taskPageType=general', historyState: { __NA: true, tipsOpsTaskList: saved } });
  let requests = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.length, 1); assert.equal(requests[0].args.p_page, 7); assert.deepEqual(requests[0].args.p_filters, filters);
  await act(async () => page.finish(page.requests.indexOf(requests[0]), 61, [{ title: '복원 검색 결과' }]));
  assert.equal(window.history.state.__NA, true);
  const open = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('복원 검색 결과'));
  await act(async () => open.click());
  assert.ok(new URLSearchParams(window.location.search).has('taskId'));
  await page.remount();
  requests = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.length, 2); assert.equal(requests[1].args.p_page, 7); assert.deepEqual(requests[1].args.p_filters, filters);
  await act(async () => page.finish(page.requests.indexOf(requests[1]), 61, [{ title: '복원 검색 결과' }]));
  await act(async () => { const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true })); window.history.back(); await popped; });
  requests = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.at(-1).args.p_page, 7); assert.deepEqual(requests.at(-1).args.p_filters, filters);
  assert.equal(new URLSearchParams(window.location.search).has('taskId'), false);
  assert.equal(Boolean(document.querySelector('[role="dialog"][data-state="open"]')), false);
  assert.equal(requests.length, 3, 'Back consumes one restore command; own URL writes do not restore again');
});
for (const type of ['withdrawal', 'transfer', 'word_retest']) test(`${type} restored child controls retain server order without a post-load page-one reset`, async (t) => {
  const filters = type === 'word_retest'
    ? { taskType: type, search: '복원', statuses: [], queue: 'assistant', branch: null, period: 'all', dateFrom: null, dateTo: null, teacherId: id(900), classId: id(901), includeClosed: false, tableSortColumn: 'student', tableSortDirection: 'desc' }
    : { taskType: type, search: '복원', statuses: [], view: 'applicant', subject: '영어', teacher: '담당', period: 'all', dateFrom: null, dateTo: null, filterColumn: 'student', sortColumn: 'student', sortDirection: 'desc' };
  const saved = { version: 1, actorScope: '["actor-a","staff"]', pathname: `/admin/${type}`, filters, page: 7, pageSize: 10, scrollY: 0 };
  const page = await workspace(t, { workspace: type, historyState: { tipsOpsTaskList: saved } });
  let requests = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.length, 1); assert.equal(requests[0].args.p_page, 7); assert.deepEqual(requests[0].args.p_filters, filters);
  await act(async () => page.finish(page.requests.indexOf(requests[0]), 62, [operationPatch(type, 'Z 학생'), operationPatch(type, 'A 학생')]));
  requests = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.length, 1, 'child mount cannot replace restored controls with defaults');
  assert.ok(document.body.textContent.includes('Z 학생'));
  assert.ok(document.body.textContent.indexOf('Z 학생') < document.body.textContent.indexOf('A 학생'));
});
test('real Back with a different deferred search retains successful rows and count while restoration fails', async (t) => {
  const page = await workspace(t);
  const numbered = () => page.requests.filter((request) => request.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(numbered()[0]), 21));
  window.history.pushState(window.history.state, '', '?entry=second');
  const input = document.querySelector('input[placeholder*="검색"]');
  assert.ok(input);
  await act(async () => input[Object.keys(input).find((key) => key.startsWith('__reactProps'))].onChange({ target: { value: '현재검색' } }));
  assert.equal(numbered().at(-1).args.p_filters.search, '현재검색');
  await act(async () => page.finish(page.requests.indexOf(numbered().at(-1)), 1, [{ title: '현재 성공 페이지' }]));
  const before = numbered().length;
  await act(async () => { const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true })); window.history.back(); await popped; });
  assert.equal(numbered().length, before + 1);
  assert.equal(numbered().at(-1).args.p_filters.search, '');
  assert.ok(document.body.textContent.includes('현재 성공 페이지'));
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
  await act(async () => numbered().at(-1).reject(new Error('back offline')));
  assert.ok(document.body.textContent.includes('현재 성공 페이지'));
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});
test('incoming URL-owned controls override an inherited snapshot without blocking restored local controls', async (t) => {
  const filters = { taskType: 'general', search: 'local search', statuses: [], queue: 'sent', requestedById: id(900), requestedTeam: null, assigneeId: null, assigneeTeam: null, focus: 'none', sort: 'priority' };
  const page = await workspace(t, { search: '?list=inbox&sort=due', historyState: { tipsOpsTaskList: { version: 1, actorScope: '["actor-a","staff"]', pathname: '/admin/tasks', filters, page: 7, pageSize: 10, scrollY: 0 } } });
  const requests = page.requests.filter((request) => request.name === 'list_ops_task_numbered_page_v1');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].args.p_filters, { ...filters, queue: 'inbox', sort: 'due' });
  assert.equal(requests[0].args.p_page, 1);
});
test('same-id role transition from page 11 does not restore prior-role page or late stats/catalog/detail', async (t) => {
  const page = await workspace(t, { deferTables: true, search: '?taskPage=11&taskPageType=general' });
  const oldPage = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.equal(oldPage.args.p_page, 11);
  await act(async () => page.finish(page.requests.indexOf(oldPage), 101, [{ title: 'STAFF OLD', requestedById: id(900), requestedByLabel: 'Staff requester' }]));
  const oldStats = page.requests.find((r) => r.name === 'get_ops_task_list_stats_v1');
  const oldCatalog = page.load('src/features/tasks/ops-task-service.ts').loadOpsTaskWorkspaceOptionData({ taskType: 'general', viewerId: 'actor-a' });
  const oldTables = [...page.tableRequests];
  const open = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('STAFF OLD'));
  assert.ok(open); await act(async () => open.click());
  assert.ok(document.querySelector('[role="dialog"]'));
  const oldDetail = page.tableRequests.find((r) => r.table === 'ops_tasks');
  assert.ok(oldDetail);
  await page.render({ viewerRole: 'teacher' });
  assert.equal(document.body.textContent.includes('STAFF OLD'), false);
  assert.equal(Boolean(document.querySelector('[role="dialog"][data-state="open"]')), false, document.querySelector('[role="dialog"]')?.textContent.slice(0, 240));
  const newPage = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1').at(-1);
  assert.equal(newPage.args.p_page, 1, 'new actor role cannot inherit page11');
  const newStats = page.requests.filter((r) => r.name === 'get_ops_task_list_stats_v1');
  assert.equal(newStats.length, 2, 'new role must not share old-role in-flight stats');
  await act(async () => {
    newStats[1].resolve({ error: null, data: { total: 777, byView: { inbox: 7 }, facets: { requestedBy: [{ value: id(900), label: 'Teacher facet', count: 1 }] } } });
    page.finish(page.requests.indexOf(newPage), 1, [{ title: 'TEACHER NEW' }]);
    oldStats.resolve({ error: null, data: { total: 999, byView: { inbox: 999 }, facets: { requestedBy: [{ value: id(900), label: 'OLD FACET', count: 999 }] } } });
    oldTables.forEach((r) => r.resolve({ error: null, data: r.table === 'profiles' ? [{ id: id(900), name: 'OLD CATALOG', role: 'staff' }] : [] }));
    oldDetail.resolve({ error: null, data: { id: id(101), type: 'general', title: 'LATE DETAIL' } });
    await oldCatalog;
  });
  assert.ok(document.body.textContent.includes('TEACHER NEW'));
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'), 'pager ignores supplemental 777 total');
  assert.equal(/OLD FACET|OLD CATALOG|LATE DETAIL/.test(document.body.textContent), false);
  assert.equal(Boolean(document.querySelector('[role="dialog"][data-state="open"]')), false);
});
test('initial unresolved login preserves an incoming nonregistration deep link and loads outside-page detail without adding rows', async (t) => {
  const page = await workspace(t, { loading: true, viewerRole: '', search: `?taskId=${id(999)}` });
  assert.equal(page.requests.length, 0);
  await page.render({ loading: false, viewerRole: 'staff' });
  assert.equal(new URLSearchParams(window.location.search).get('taskId'), id(999));
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(request), 1, [{ title: '목록 행' }]));
  const detail = page.tableRequests.find((r) => r.table === 'ops_tasks');
  assert.ok(detail); assert.ok(detail.filters.some((f) => f[0] === 'eq' && f[1] === 'id' && f[2] === id(999)));
  await act(async () => detail.resolve({ error: null, data: { id: id(999), title: '독립 상세', type: 'general', status: 'requested', priority: 'normal' } }));
  assert.ok(document.querySelector('[role="dialog"]')?.textContent.includes('독립 상세'));
  assert.equal(document.querySelector('[data-testid="todo-table-task-list"]')?.textContent.includes('독립 상세'), false);
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});
for (const taskType of ['general', 'textbook']) test(`on-page exact ${taskType} detail owns its full payload while numbered summary rows stay unchanged`, async (t) => {
  const page = await workspace(t, { tableData: {
    ops_task_comments: [{ id: id(801), task_id: id(1), author_id: 'actor-a', body: 'DETAIL ONLY COMMENT', created_at: '2026-08-31T00:00:00Z' }],
    ops_task_attachments: [{ id: id(803), task_id: id(1), file_name: 'DETAIL ONLY FILE', file_kind: 'link', drive_file_id: '', drive_link: 'https://example.invalid/detail-file', uploaded_by: 'actor-a', uploaded_at: '2026-08-31T00:00:00Z' }],
    ops_task_events: [1, 2].map((n) => ({ id: id(803 + n), task_id: id(1), actor_id: 'actor-a', event_type: 'status_changed', field_name: 'status', before_value: 'requested', after_value: 'confirmed', created_at: '2026-08-31T00:00:00Z' })),
  } });
  const numbered = () => page.requests.filter((request) => request.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(numbered()[0]), 2, [{ type: taskType, title: 'LIST SUMMARY', memo: 'LIST MEMO' }, { title: 'SECOND ROW' }]));
  const open = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('LIST SUMMARY'));
  await act(async () => open.click());
  const detail = page.tableRequests.find((request) => request.table === 'ops_tasks');
  await act(async () => detail.resolve({ error: null, data: { id: id(1), title: 'FULL DETAIL', memo: 'FULL DETAIL MEMO', type: taskType, status: 'requested', priority: 'normal' } }));
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog.textContent.includes('FULL DETAIL'));
  assert.ok(dialog.textContent.includes('FULL DETAIL MEMO'));
  assert.ok(dialog.textContent.includes('DETAIL ONLY COMMENT'));
  if (taskType === 'textbook') {
    assert.equal(dialog.querySelector('a[href="https://example.invalid/detail-file"]')?.textContent, 'DETAIL ONLY FILE');
    assert.ok(dialog.textContent.includes('이력 2'));
  }
  const table = document.getElementById('root');
  assert.ok(table.textContent.includes('LIST SUMMARY')); assert.equal(table.textContent.includes('FULL DETAIL'), false);
  assert.ok(table.textContent.indexOf('LIST SUMMARY') < table.textContent.indexOf('SECOND ROW'));
  assert.ok(document.body.textContent.includes('2건 · 1–2번째'));
  const input = dialog.querySelector('textarea[placeholder="댓글"]');
  await act(async () => input[Object.keys(input).find((key) => key.startsWith('__reactProps'))].onChange({ target: { value: 'NEW COMMENT' } }));
  await act(async () => [...dialog.querySelectorAll('button')].find((button) => button.textContent === '댓글 추가').click());
  const mutationDetail = page.tableRequests.filter((request) => request.table === 'ops_tasks').at(-1);
  assert.notEqual(mutationDetail, detail);
  await act(async () => mutationDetail.resolve({ error: null, data: { id: id(1), title: 'FULL DETAIL', memo: 'FULL DETAIL MEMO', type: taskType, status: 'requested', priority: 'normal' } }));
  // The real producer hashes its idempotency request before issuing the RPC.
  for (let attempt = 0; attempt < 20 && !page.requests.some((request) => request.name === 'add_ops_task_comment_v2'); attempt++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  const mutation = page.requests.find((request) => request.name === 'add_ops_task_comment_v2');
  assert.ok(mutation);
  await act(async () => mutation.resolve({ error: null, data: { sourceId: id(802), sourceEventIds: [], comment: { id: id(802), task_id: id(1), author_id: 'actor-a', body: 'NEW COMMENT', created_at: '2026-08-31T00:01:00Z' } } }));
  assert.equal(numbered().length, 2);
  await act(async () => page.finish(page.requests.indexOf(numbered()[1]), 2, [{ title: 'REFRESHED LIST SUMMARY' }, { title: 'SECOND ROW' }]));
  assert.ok(dialog.textContent.includes('NEW COMMENT'));
  assert.ok(dialog.textContent.includes('DETAIL ONLY COMMENT'));
  assert.ok(dialog.textContent.includes('FULL DETAIL MEMO'));
  assert.ok(document.getElementById('root').textContent.includes('REFRESHED LIST SUMMARY'));
});
for (const statsOutcome of ['pending', 'unavailable']) test(`ordinary catalogs become visible with optional stats ${statsOutcome}`, async (t) => {
  const page = await workspace(t, { workspace: 'word_retest', deferTables: true });
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(request), 1, [operationPatch('word_retest')]));
  if (statsOutcome === 'unavailable') await act(async () => page.requests.find((r) => r.name === 'get_ops_task_list_stats_v1').reject(new Error('stats unavailable')));
  assert.equal(page.tableRequests.length, 0, 'catalog remains lazy until Add');
  const add = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('추가') && !button.getAttribute('aria-label'));
  assert.ok(add);
  await act(async () => add.click());
  await act(async () => {
    for (const pending of page.tableRequests) pending.resolve({ error: null, data: pending.table === 'teacher_catalogs'
      ? [{ id: id(800), name: 'CATALOG TEACHER', subjects: ['영어'], is_visible: true, sort_order: 1, profile_id: id(801), account_email: 'teacher@example.invalid' }]
      : pending.table === 'profiles' ? [{ id: id(801), name: 'CATALOG TEACHER', role: 'teacher', email: 'teacher@example.invalid', login_id: 'catalog-teacher' }] : [] });
  });
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  const selector = [...dialog.querySelectorAll('button[aria-labelledby]')].find((button) => document.getElementById(button.getAttribute('aria-labelledby'))?.textContent === '담당선생님');
  assert.ok(selector);
  await act(async () => selector.click());
  assert.ok(document.body.textContent.includes('CATALOG TEACHER'), `${selector.outerHTML}\n${document.body.textContent.slice(-800)}`);
  assert.equal(page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1').length, 1);
});

test('registration linked catalogs render independently while optional stats remain pending', async (t) => {
  const page = await workspace(t, { workspace: 'registration', search: '?flow=waiting', deferTables: true, pendingRpcNames: ['registration_subject_tracks_runtime_version'] });
  t.after(async () => act(async () => { for (const request of page.requests.filter((r) => r.name === 'registration_subject_tracks_runtime_version')) request.resolve({ error: null, data: 1 }); }));
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  const patch = registrationPatch(1);
  patch.registrationTracks = patch.registrationTracks.map((track) => ({ ...track, status: 'waiting', workflowStatus: 'waiting_current_class', waitingKind: 'current_class', waitingDetailKind: 'current_class', waitingDetailClassId: id(800) }));
  await act(async () => page.finish(page.requests.indexOf(request), 1, [patch]));
  assert.ok(document.body.textContent.includes(id(800)), document.body.textContent);
  await act(async () => {
    for (const pending of page.tableRequests) pending.resolve({ error: null, data: pending.table === 'classes'
      ? [{ id: id(800), name: 'INDEPENDENT CLASS', subject: '영어', grade: '중1', teacher: '담당', room: '101', textbook_ids: [], status: 'active' }] : [] });
  });
  assert.ok(document.body.textContent.includes('INDEPENDENT CLASS'));
  assert.equal(document.body.textContent.includes(id(800)), false);
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});
test('late rejected old-actor exact detail cannot erase a new actor detail URL', async (t) => {
  const page = await workspace(t, { search: `?taskId=${id(999)}` });
  const oldPage = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(oldPage), 1));
  const oldDetail = page.tableRequests.find((r) => r.table === 'ops_tasks');
  await page.render({ viewerRole: 'teacher' });
  const nextPage = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1').at(-1);
  await act(async () => page.finish(page.requests.indexOf(nextPage), 1, [{ title: '새 역할 상세 대상' }]));
  const open = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('새 역할 상세 대상'));
  await act(async () => open.click());
  const currentUrl = window.location.href;
  await act(async () => oldDetail.reject(new Error('late old-role rejection')));
  assert.equal(window.location.href, currentUrl);
});
test('generic incoming taskId identifies a registration task and delegates to the real registration case reader', async (t) => {
  const page = await workspace(t, { search: `?taskId=${id(999)}` });
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(request), 1));
  const exact = page.tableRequests.find((r) => r.table === 'ops_tasks');
  await act(async () => exact.resolve({ error: null, data: { id: id(999), title: '등록 상세', type: 'registration', status: 'requested', priority: 'normal' } }));
  assert.equal(page.tableRequests.filter((r) => r.table === 'ops_tasks').length, 2);
  assert.ok(page.tableRequests.some((r) => r.table === 'ops_registration_subject_tracks' && r.filters.some((f) => f[0] === 'eq' && f[1] === 'task_id' && f[2] === id(999))));
  assert.equal(new URLSearchParams(window.location.search).get('taskId'), id(999));
  assert.equal(document.querySelector('[data-testid="todo-table-task-list"]')?.textContent.includes('등록 상세'), false);
});
test('word-retest drafts survive numbered replacement while selection and bulk targets stay on the displayed page', async (t) => {
  const page = await workspace(t, { workspace: 'word_retest' });
  const requests = () => page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1');
  const finish = async (patches) => { const request = requests().at(-1); await act(async () => page.finish(page.requests.indexOf(request), 12, patches)); };
  const first = Array.from({ length: 10 }, (_, i) => operationPatch('word_retest', `학생${i + 1}`));
  await finish(first);
  const select = document.querySelector('input[aria-label="학생1 단어 재시험 선택"]');
  await act(async () => select.click()); assert.ok(document.body.textContent.includes('1건 선택'));
  const score = document.querySelector('input[aria-label="학생1 1차 점수"]');
  assert.ok(score); assert.equal(score.disabled, false);
  await act(async () => {
    const props = score[Object.keys(score).find((key) => key.startsWith('__reactProps'))];
    props.onChange({ target: { value: '27' } });
  });
  await act(async () => document.querySelector('button[aria-label="2 페이지"]').click());
  await finish([operationPatch('word_retest', '학생11'), operationPatch('word_retest', '학생12')]);
  assert.equal(document.body.textContent.includes('1건 선택'), false);
  await act(async () => document.querySelector('input[aria-label="보이는 단어 재시험 전체 선택"]').click());
  assert.ok(document.body.textContent.includes('2건 선택'));
  await act(async () => document.querySelector('button[aria-label="1 페이지"]').click()); await finish(first);
  assert.equal(document.body.textContent.includes('2건 선택'), false);
  assert.equal(document.querySelector('input[aria-label="학생1 1차 점수"]').value, '27');
  await page.render({ viewerRole: 'teacher' });
  assert.equal(Boolean(document.querySelector('input[aria-label="학생1 1차 점수"]')), false);
  await page.render({ viewerRole: 'staff' }); await finish(first);
  assert.equal(document.querySelector('input[aria-label="학생1 1차 점수"]').value, '', 'role session cannot inherit score drafts');
});
test('registration fixture dirty Back cancellation keeps the edited host and restores Forward without list URL writes', async (t) => {
  const env = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  t.after(() => { process.env.NODE_ENV = env; });
  const page = await workspace(t, { workspace: 'registration', search: '?fixture=registration-subject-tracks&fixtureRole=staff' });
  const entry = document.querySelector('[data-testid="registration-case-desktop-list"] [data-registration-case-row]');
  assert.ok(entry, document.body.textContent.slice(0, 300));
  await act(async () => entry.click());
  assert.ok(document.querySelector('[role="dialog"]'));
  const input = [...document.querySelectorAll('[role="dialog"] input')].find((input) => input.type === 'text' && !input.disabled);
  assert.ok(input, document.querySelector('[role="dialog"]')?.textContent.slice(0, 600));
  await act(async () => input[Object.keys(input).find((key) => key.startsWith('__reactProps'))].onChange({ target: { value: '변경된 초안' } }));
  const detailUrl = window.location.href;
  await act(async () => { const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true })); window.history.back(); await popped; });
  assert.ok(document.body.textContent.includes('변경사항') || document.body.textContent.includes('작성 중'));
  const cancel = [...document.querySelectorAll('button')].find((button) => /계속 작성|돌아가기|계속 수정/.test(button.textContent));
  assert.ok(cancel, [...document.querySelectorAll('button')].map((b) => b.textContent).join('|').slice(-600));
  await act(async () => { const forward = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true })); cancel.click(); await forward; });
  assert.equal(window.location.href, detailUrl);
  assert.equal(page.requests.length, 0, 'fixture never calls production page/detail authority');
});
test('complete word fixture sorts the full set before taking the numbered page', async (t) => {
  const page = await workspace(t, { workspace: 'word_retest', expandWordFixture: true, search: '?fixture=word-retest-expected-schedule&fixtureRole=assistant&role=assistant' });
  const header = document.querySelector('button[aria-label="학생 정렬"]');
  assert.ok(header);
  await act(async () => header.click());
  assert.ok(document.body.textContent.includes('정렬학생01'));
  assert.equal(document.body.textContent.includes('정렬학생12'), false);
  assert.equal(page.requests.length, 0, page.requests.map((request) => request.name).join(','));
});
test('eligible nonfixture word task still starts the existing automatic absent mutation through mocked transport', async (t) => {
  const page = await workspace(t, { workspace: 'word_retest' });
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  const patch = operationPatch('word_retest');
  patch.status = 'requested';
  patch.inlineState.retestStatus = 'not_started';
  patch.inlineState.testAt = '2020-01-01T09:00:00+09:00';
  patch.inlineState.expectedRetestAt = '2020-01-02T09:00:00+09:00';
  await act(async () => page.finish(page.requests.indexOf(request), 1, [patch]));
  assert.ok(page.requests.some((r) => r.name === 'report_word_retest_absent_v1'));
});
test('registration numbered DTO traverses real case models as one parent with two tracks and exact observation URLs stay unchanged', async (t) => {
  const search = `?taskId=${id(900)}&trackId=${id(901)}&appointmentId=${id(902)}&observationId=${id(903)}&view=calendar`;
  const page = await workspace(t, { workspace: 'registration', search });
  const request = page.requests.find((r) => r.name === 'list_ops_task_numbered_page_v1');
  assert.ok(request);
  await act(async () => page.finish(page.requests.indexOf(request), 1, [registrationPatch(1)]));
  assert.deepEqual([...new URLSearchParams(window.location.search).keys()].sort(), ['appointmentId', 'observationId', 'taskId', 'trackId', 'view']);
  assert.equal(window.history.state.tipsOpsTaskList.page, 1);
  window.history.replaceState(window.history.state, '', '/admin/registration');
  await page.remount();
  const next = page.requests.filter((r) => r.name === 'list_ops_task_numbered_page_v1').at(-1);
  await act(async () => page.finish(page.requests.indexOf(next), 1, [registrationPatch(1)]));
  assert.equal(document.querySelectorAll('[data-testid="registration-case-desktop-list"] [data-registration-case-row]').length, 1);
  assert.ok(document.body.textContent.includes('영어')); assert.ok(document.body.textContent.includes('수학'));
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});

test('registration tab pending and failure retain the accepted parent and matching tracks with its pager', async (t) => {
  const page = await workspace(t, { workspace: 'registration' });
  const first = page.requests.find((request) => request.name === 'list_ops_task_numbered_page_v1');
  await act(async () => page.finish(page.requests.indexOf(first), 1, [registrationPatch(1, '유지 학생')]));
  const list = () => document.querySelector('[data-testid="registration-case-desktop-list"]');
  const accepted = list().textContent;
  const nextTab = [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.getAttribute('aria-selected') === 'false' && /대기/.test(tab.textContent));
  assert.ok(nextTab);
  await act(async () => nextTab.click());
  const pending = page.requests.filter((request) => request.name === 'list_ops_task_numbered_page_v1').at(-1);
  assert.notEqual(pending, first);
  assert.equal(list()?.textContent, accepted, 'pending tab must not reshape accepted tracks');
  await act(async () => pending.reject(new Error('tab offline')));
  assert.equal(list()?.textContent, accepted, 'failed tab must retain accepted tracks');
  assert.ok(document.body.textContent.includes('1건 · 1–1번째'));
});
