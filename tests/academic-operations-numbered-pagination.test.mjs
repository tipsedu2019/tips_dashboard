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
      '  require("@test/observer").observe({ sourceKey: lessonPlanSourceKey, revision: lessonMutationLifecycleRef.current?.revision, requestedClassId: lessonMutationLifecycleRef.current?.requestedClassId });\n  const classScheduleWorkspaceContent = (');
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
    resolvedPeriodId: request.args.p_filters.periodId || id(900),
    stats: { total: totalCount, managedClassCount: totalCount, totalSessions: totalCount, completedSessions: 520, pendingSessions: 0,
      linkedTextbooks: 260, unlinkedClassCount: 0, noScheduleClassCount: 0, updateNeededClassCount: 0, completedClassCount: 260,
      viewModeCounts: { all: 270, unlinked: 10, unscheduled: 0, update: 0, done: 260 } },
    filterOptions: { periods: [{ value: id(900), label: '학기', isDefault: true }], statuses: ['수강'], subjects: ['수학'], grades: ['고1'], teachers: ['교사'], classrooms: [] },
  } : { stats: { total: totalCount, active: totalCount, draft: 0 }, filterOptions: { terms: [], subjects: ['수학'], grades: ['고1'], teachers: [], syncGroups: [{ value: id(900), label: '그룹' }] },
    syncGroupCounts: [{ groupId: id(900), memberCount: totalCount, representativeClassId: id(999) }] }), ...patch };
}
async function setup(t, domain, initial = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/admin/${domain === 'academic' ? 'curriculum' : 'class-schedule'}${initial.search || ''}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = window.clearTimeout; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // react-dom was loaded before JSDOM; its legacy input-event fallback needs these DOM-only shims.
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify({ 'academic:curriculum': { mode: 'manual', pageSize: initial.pageSize || 10 }, 'operations:class-schedule': { mode: 'manual', pageSize: initial.pageSize || 10 } }));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  let auth = { user: { id: id(800), app_metadata: { role: 'teacher' } }, role: 'admin', loading: false, session: null, ...initial.auth };
  const requests = [], supabase = { from() { throw new Error('unexpected table read/write'); }, rpc(name, args) {
    const pending = Promise.withResolvers(), request = { name, args, ...pending }; requests.push(request);
    return { then: pending.promise.then.bind(pending.promise), abortSignal(signal) { request.signal = signal; return this; }, retry() { return pending.promise; } };
  } };
  t.after(() => assert.deepEqual(requests.filter((request) => !/^(get_|list_|continuous_class_schedule_runtime_version$)/.test(request.name)).map((request) => request.name), [], 'consumer tests never trigger domain mutations or sends'));
  let previousSearch = '', params = new URLSearchParams();
  let observed;
  const load = modules(supabase, {
    '@test/observer': { observe(value) { observed = value; } },
    '@/providers/auth-provider': { useAuth: () => auth },
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
  return { requests, render, load, domain, writes, unmount: async () => act(async () => root.unmount()), get state() { return state; }, get observed() { return observed; }, get props() { return props; },
    numbered: () => requests.filter((request) => request.name.includes('numbered_page')),
    finish: (request, total = 260, patch = {}) => request.resolve({ error: null, data: response(domain, request, total, patch) }),
    auth: async (patch) => { auth = { ...auth, ...patch }; await render(); }, remount: async () => { mountKey++; await render(); },
  };
}
for (const domain of ['academic', 'operations']) {
  test(`${domain}: accepted scope owns paging after failed filter while explicit Retry retains the failed target`, async (t) => {
    const page = await setup(t, domain, { request: { page: 11 } });
    await act(async () => page.finish(page.numbered()[0]));
    await page.render({ search: 'FAILED_FILTER' });
    await act(async () => page.numbered().at(-1).reject(new Error('filter failure')));
    await page.render();
    await act(async () => { void page.state.refresh(); });
    assert.equal(page.numbered().at(-1).args.p_filters.search, 'FAILED_FILTER');
    await act(async () => page.numbered().at(-1).reject(new Error('filter retry failure')));
    await act(async () => { void page.state.goToPage(12); });
    assert.equal(page.numbered().at(-1).args.p_filters.search, '');
    assert.equal(page.numbered().at(-1).args.p_page, 12);
    if (domain === 'academic') assert.equal(page.numbered().at(-1).args.p_filters.periodId, id(900));
    await act(async () => page.numbered().at(-1).reject(new Error('page failure')));
    await page.render();
    await act(async () => { void page.state.refresh(); });
    assert.equal(page.numbered().at(-1).args.p_page, 12);
    assert.equal(page.numbered().at(-1).args.p_filters.search, '');
    await act(async () => page.finish(page.numbered().at(-1)));
    assert.equal(page.state.page, 12);
    assert.equal(page.state.displayRequest.search, '');
    assert.equal(page.state.dataMatchesCurrentScope, false, 'unadopted FAILED_FILTER inputs must not be claimed current');
  });
  for (const [acceptedSize, failedPreference] of [[10, 15], [10, 20], [20, 10]]) {
    test(`${domain}: accepted ${acceptedSize} size owns paging after failed ${failedPreference} preference`, async (t) => {
      const page = await setup(t, domain, { pageSize: acceptedSize, request: { page: 2 } });
      await act(async () => page.finish(page.numbered()[0]));
      await act(async () => page.state.setPageSizePreference(failedPreference));
      assert.equal(page.numbered().at(-1).args.p_page_size, failedPreference);
      await act(async () => page.numbered().at(-1).reject(new Error('size failure')));
      await page.render();
      await act(async () => { void page.state.refresh(); });
      assert.equal(page.numbered().at(-1).args.p_page_size, failedPreference);
      await act(async () => page.numbered().at(-1).reject(new Error('size retry failure')));
      await act(async () => { void page.state.goToPage(3); });
      assert.equal(page.numbered().at(-1).args.p_page_size, acceptedSize);
      assert.equal(page.numbered().at(-1).args.p_page, 3);
      await act(async () => page.finish(page.numbered().at(-1)));
      assert.equal(page.state.pageSize, acceptedSize);
      assert.equal('pageSizeMode' in page.state, false);
      assert.equal(page.numbered().length, 4);
      await act(async () => page.state.setPageSizePreference(failedPreference));
      assert.equal(page.numbered().length, 5, 'selecting the still-stored preference again is a new request intent');
      assert.equal(page.numbered().at(-1).args.p_page_size, failedPreference);
      assert.equal(page.numbered().at(-1).args.p_page, 1);
    });
  }
  test(`${domain}: workspace failed filter pager recovery adopts controls URL and return path without page1 replay`, async (t) => {
    const page = await setup(t, domain, { workspace: true, search: '?page=11&q=accepted&keep=1' });
    await act(async () => page.finish(page.numbered()[0]));
    await page.render();
    window.history.pushState(null, '', '?page=7&q=FAILED_FILTER&keep=1');
    await page.render();
    await act(async () => page.numbered().at(-1).reject(new Error('filter failure')));
    await act(async () => document.querySelector('button[aria-label="12 페이지"]').click());
    const recovery = page.numbered().at(-1);
    assert.equal(recovery.args.p_filters.search, 'accepted');
    assert.equal(recovery.args.p_page, 12);
    assert.equal(page.numbered().length, 3, 'control adoption must not issue page1');
    await act(async () => page.finish(recovery));
    await page.render();
    assert.equal(document.querySelector('input[placeholder*="검색"]').value, 'accepted');
    assert.equal(new URLSearchParams(window.location.search).get('q'), 'accepted');
    assert.equal(new URLSearchParams(window.location.search).get('page'), '12');
    assert.equal(new URLSearchParams(window.location.search).get('keep'), '1');
    assert.equal(page.numbered().length, 3, 'internal URL acknowledgement must not replay');
    if (domain === 'academic') {
      const returnTo = new URL(document.querySelector('tbody a').href).searchParams.get('returnTo');
      assert.equal(new URL(returnTo, window.location.origin).searchParams.get('page'), '12');
      assert.equal(new URL(returnTo, window.location.origin).searchParams.get('q'), 'accepted');
    }
    await act(async () => document.querySelector('button[aria-label="13 페이지"]').click());
    assert.equal(page.numbered().at(-1).args.p_page, 13);
    assert.equal(page.numbered().at(-1).args.p_filters.search, 'accepted');
  });
  test(`${domain}: effect replay retains restored page and a live controller`, async (t) => {
    const page = await setup(t, domain, { strict: true, request: { page: 11 } });
    assert.ok(page.numbered().length > 0);
    assert.equal(page.numbered().at(-1).args.p_page, 11);
    await act(async () => page.finish(page.numbered().at(-1)));
    assert.equal(page.state.page, 11); assert.equal(page.state.loading, false);
    await act(async () => { void page.state.goToPage(12); });
    assert.equal(page.numbered().at(-1).args.p_page, 12);
  });
  test(`${domain}: accepted-page acknowledgement does not suppress later range-to-list reads`, async (t) => {
    const page = await setup(t, domain);
    const numberedRequest = { ...page.props };
    await act(async () => page.finish(page.numbered()[0]));
    await act(async () => { void page.state.goToPage(2); });
    await act(async () => page.finish(page.numbered()[1]));
    await page.render(domain === 'academic'
      ? { mode: 'timetable', dateFrom: '2026-08-01', dateTo: '2026-08-07', filters: { classGroupId: null, status: null, subject: null } }
      : { mode: 'calendar', dateFrom: '2026-08-01', dateTo: '2026-08-07' });
    await page.render({ ...numberedRequest, dateFrom: undefined, dateTo: undefined, filters: undefined });
    assert.equal(page.numbered().length, 3, 'range return is not a control adoption acknowledgement');
  });
  test(`${domain}: unresolved auth does not issue reads and readiness recovery cannot stick loading`, async (t) => {
    const page = await setup(t, domain, { auth: { loading: true, role: null } });
    assert.equal(page.requests.length, 0);
    await page.auth({ loading: false, role: 'admin' });
    assert.equal(page.numbered().length, 1);
    await page.auth({ loading: true });
    await act(async () => page.finish(page.numbered()[0]));
    assert.equal(page.state.data, null);
    await page.auth({ loading: false });
    assert.equal(page.numbered().length, 2);
    await act(async () => page.finish(page.numbered()[1]));
    assert.equal(page.state.loading, false); assert.equal(page.state.totalCount, 260);
  });
  test(`${domain}: real hook direct page11, retained errors, retry and shrink clamp`, async (t) => {
    const page = await setup(t, domain, { request: { page: 11 } });
    assert.equal(page.numbered().length, 1); assert.equal(page.numbered()[0].args.p_page, 11);
    await act(async () => page.finish(page.numbered()[0]));
    assert.equal(page.state.page, 11); assert.equal(document.querySelector('p').textContent.includes('101'), true);
    await act(async () => { void page.state.goToPage(12); });
    await act(async () => page.numbered()[1].reject(new Error('offline')));
    assert.equal(page.state.page, 11); assert.equal(page.state.totalCount, 260); assert.ok(page.state.error);
    await act(async () => { void page.state.refresh(); });
    assert.equal(page.numbered()[2].args.p_page, 12);
    await act(async () => page.finish(page.numbered()[2], 97));
    assert.equal(page.numbered()[3].args.p_page, 10);
    await act(async () => page.finish(page.numbered()[3], 97));
    assert.equal(page.state.page, 10); assert.equal(page.state.totalCount, 97);
  });
  test(`${domain}: filters and size reset atomically, stale metadata cannot replace accepted rows`, async (t) => {
    const page = await setup(t, domain, { request: { page: 11 } });
    await act(async () => page.finish(page.numbered()[0]));
    await page.render({ search: 'new' });
    assert.equal(page.numbered()[1].args.p_page, 1); assert.equal(page.numbered()[1].args.p_filters.search, 'new');
    assert.equal(page.state.page, 11); assert.equal(page.state.data.stats.total, 260);
    await act(async () => { void page.state.refresh(); });
    assert.equal(page.numbered()[2].args.p_page, 1);
    await act(async () => page.finish(page.numbered()[1], 12));
    assert.equal(page.state.totalCount, 260);
    await act(async () => page.finish(page.numbered()[2], 40));
    await act(async () => page.state.setPageSizePreference(20));
    assert.equal(page.numbered()[3].args.p_page, 1); assert.equal(page.numbered()[3].args.p_page_size, 20);
  });
  test(`${domain}: resolved auth readiness, role change and logout mask rows and reject old callbacks`, async (t) => {
    const page = await setup(t, domain);
    await act(async () => page.finish(page.numbered()[0]));
    const oldRefresh = page.state.refresh;
    const oldGoToPage = page.state.goToPage;
    const oldSetPreference = page.state.setPageSizePreference;
    await page.auth({ role: 'teacher' });
    assert.equal(page.state.data?.page?.rows?.length || 0, 0);
    await page.auth({ user: null, role: null });
    const count = page.requests.length;
    await act(async () => { void oldRefresh(); void oldGoToPage(2); oldSetPreference(20); });
    assert.equal(page.requests.length, count); assert.equal(page.state.data, null);
  });
}

test('unchanged timetable, calendar and annual hooks keep their range readers and independent catalogs', async (t) => {
  for (const [domain, request, rpc, data] of [
    ['academic', { mode: 'timetable', dateFrom: '2026-08-01', dateTo: '2026-08-07', filters: { classGroupId: null, status: null, subject: null } }, 'get_academic_timetable_range_v1', { ok: true, complete: true, range: { dateFrom: '2026-08-01', dateTo: '2026-08-07' }, rows: [], classSummaries: [], classTerms: [], classGroups: [], classGroupMembers: [], teacherCatalogs: [], classroomCatalogs: [], statusOptions: [], subjectOptions: [] }],
    ['operations', { mode: 'calendar', dateFrom: '2026-08-01', dateTo: '2026-08-07' }, 'get_operations_calendar_range_v1', { ok: true, complete: true, range: { dateFrom: '2026-08-01', dateTo: '2026-08-07' }, rows: [] }],
    ['operations', { mode: 'annual', academicYear: 2026 }, 'get_operations_annual_board_v1', { ok: true, data: { academicYear: 2026, rows: [] } }],
  ]) await t.test(request.mode, async (child) => {
    const page = await setup(child, domain, { request });
    assert.equal(page.numbered().length, 0); assert.equal(page.requests[0].name, rpc);
    await act(async () => page.requests[0].resolve({ error: null, data }));
    assert.equal(page.state.loading, false); assert.equal(page.state.data.ok, true);
    if (domain === 'operations') {
      const catalogs = page.requests.find((entry) => entry.name === 'list_operations_catalogs_v1');
      await act(async () => catalogs.resolve({ error: null, data: { academicSchools: [{ id: id(20), name: '학교' }] } }));
      assert.equal(page.state.data.catalogs.academicSchools[0].name, '학교');
    }
  });
});

for (const domain of ['academic', 'operations']) test(`${domain}: displayed rows, totals and pager survive failed navigation and remain outside scrollport`, async (t) => {
  const page = await setup(t, domain, { workspace: true, search: '?page=11' });
  await act(async () => page.finish(page.numbered()[0]));
  const content = [...document.querySelectorAll('tbody tr')].map((row) => row.textContent);
  const pager = document.querySelector('nav[aria-label="페이지 탐색"]');
  assert.ok(pager); assert.equal(pager.closest('[data-slot="scroll-area-viewport"]'), null);
  assert.equal(document.querySelectorAll('[data-slot="pagination-number-group"] button').length, 10);
  await act(async () => document.querySelector('button[aria-label="12 페이지"]').click());
  assert.deepEqual([...document.querySelectorAll('tbody tr')].map((row) => row.textContent), content);
  assert.ok(document.querySelector('button[aria-current="page"][aria-label="11 페이지"]'));
  await act(async () => page.numbered()[1].reject(new Error('PAGE FAILURE')));
  assert.deepEqual([...document.querySelectorAll('tbody tr')].map((row) => row.textContent), content);
  assert.match(document.body.textContent, /260건/); assert.match(document.body.textContent, /PAGE FAILURE/);
  const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === '다시 시도');
  assert.ok(retry, 'failed navigation exposes a working retry');
  await act(async () => retry.click());
  assert.equal(page.numbered().at(-1).args.p_page, 12);
  await act(async () => page.finish(page.numbered().at(-1)));
  if (domain === 'operations') {
    const group = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('그룹') && button.textContent.includes('260'));
    assert.ok(group, 'full-filter independent group count');
    await act(async () => group.click());
    assert.equal(page.numbered().at(-1).args.p_filters.syncGroupId, id(900));
    assert.equal(page.numbered().at(-1).args.p_page, 1);
    assert.equal(page.observed.requestedClassId, id(999), 'representative outside the page owns existing group action');
  }
});

for (const domain of ['academic', 'operations']) test(`${domain}: refresh retries restored pending page7 instead of displayed old page11`, async (t) => {
  const page = await setup(t, domain, { request: { page: 11, navigationKey: 'old' } });
  await act(async () => page.finish(page.numbered()[0]));
  await page.render({ page: 7, navigationKey: 'restored', search: 'new filter' });
  assert.equal(page.numbered()[1].args.p_page, 7);
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.numbered()[2].args.p_page, 7);
  assert.equal(page.numbered()[2].args.p_filters.search, 'new filter');
  await act(async () => page.numbered()[2].reject(new Error('pending failure')));
  await act(async () => { void page.state.refresh(); });
  assert.equal(page.numbered()[3].args.p_page, 7);
});

for (const domain of ['academic', 'operations']) test(`${domain}: range density recovery belongs only to its matching requested range`, async (t) => {
  const request = domain === 'academic' ? { mode: 'timetable', dateFrom: '2026-08-01', dateTo: '2026-08-07', filters: { classGroupId: null, status: null, subject: null } }
    : { mode: 'calendar', dateFrom: '2026-08-01', dateTo: '2026-08-07' };
  const page = await setup(t, domain, { request });
  await act(async () => page.requests[0].resolve({ error: null, data: { ok: false, code: 'visible_range_too_dense', range: { dateFrom: '2026-08-01', dateTo: '2026-08-07' }, rows: [], observedRowsAtLeast: 2001, suggestedDays: 7 } }));
  assert.equal(page.state.densityError.code, 'visible_range_too_dense');
  await page.render({ dateFrom: '2026-08-08', dateTo: '2026-08-14' });
  assert.equal(page.state.densityError, null);
});

test('academic: default dataset survives detail return as a resolved URL selector', async (t) => {
  const page = await setup(t, 'academic', { workspace: true, search: '?page=11' });
  await act(async () => page.finish(page.numbered()[0]));
  const link = document.querySelector('tbody a');
  const returnTo = new URL(link.href).searchParams.get('returnTo');
  assert.equal(new URL(returnTo, window.location.origin).searchParams.get('period'), id(900));
  assert.equal(new URL(returnTo, window.location.origin).searchParams.get('page'), '11');
  window.history.replaceState(null, '', returnTo);
  await page.remount();
  assert.equal(page.numbered().at(-1).args.p_filters.periodId, id(900));
});

test('academic: explicit period-name alias remains a visible selector and is not narrowed to one group', async (t) => {
  const page = await setup(t, 'academic', { workspace: true, search: '?period=동일학기&page=11' });
  const defaults = response('academic', page.numbered()[0]).filterOptions;
  await act(async () => page.finish(page.numbered()[0], 260, { filterOptions: { ...defaults,
    periods: [{ value: id(900), label: '동일학기', isDefault: true }, { value: id(901), label: '동일학기', isDefault: false }] } }));
  await act(async () => document.querySelector('button[aria-label^="필터"]').click());
  assert.match(document.querySelector('button[aria-label="기간"]').textContent, /동일학기/);
  assert.equal(new URLSearchParams(window.location.search).get('period'), '동일학기');
  assert.equal(page.numbered().length, 1);
});

for (const change of ['logout', 'role', 'back', 'unmount']) test(`academic: queued URL writer cannot outlive ${change}`, async (t) => {
  const page = await setup(t, 'academic', { workspace: true, search: '?page=11' });
  const queue = [], original = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (callback) => queue.push(callback);
  try {
    await act(async () => page.finish(page.numbered()[0]));
    assert.ok(queue.length > 0);
    if (change === 'logout') await page.auth({ user: null, role: null });
    if (change === 'role') await page.auth({ role: 'teacher' });
    if (change === 'unmount') await page.unmount();
    if (change === 'back') { window.history.pushState(null, '', '?page=7&q=restored'); await page.render(); }
    await act(async () => { queue.splice(0).forEach((callback) => callback()); });
    assert.equal(page.writes.length, 0, 'obsolete URL write is cancelled');
    assert.equal(new URLSearchParams(window.location.search).get('page'), change === 'back' ? '7' : '11');
  } finally { globalThis.queueMicrotask = original; }
});
test('academic: resolved default pins next page/retry while explicit name alias remains intact', async (t) => {
  const page = await setup(t, 'academic');
  await act(async () => page.finish(page.numbered()[0]));
  await act(async () => { void page.state.goToPage(11); });
  assert.equal(page.numbered()[1].args.p_filters.periodId, id(900));
  await page.render({ periodId: '중복 학기 이름' });
  await act(async () => page.finish(page.numbered()[2]));
  await act(async () => { void page.state.goToPage(2); });
  assert.equal(page.numbered()[3].args.p_filters.periodId, '중복 학기 이름');
});
test('operations: catalogs settle independently and old logout session cannot seed the real cache', async (t) => {
  const page = await setup(t, 'operations');
  const old = page.requests.find((r) => r.name === 'list_operations_catalogs_v1');
  assert.ok(old, 'catalog starts independently before page completion');
  await act(async () => old.resolve({ data: { teachers: [{ name: 'first' }], classrooms: [] }, error: null }));
  assert.equal(page.state.data.catalogs.teachers[0].name, 'first');
  await page.auth({ user: null, role: null });
  await page.auth({ user: { id: id(800) }, role: 'admin' });
  const pending = page.requests.filter((r) => r.name === 'list_operations_catalogs_v1').at(-1);
  assert.notEqual(pending, old);
  await page.auth({ user: null, role: null });
  await act(async () => pending.resolve({ data: { teachers: [{ name: 'STALE' }], classrooms: [] }, error: null }));
  await page.auth({ user: { id: id(800) }, role: 'admin' });
  assert.notEqual(page.requests.filter((r) => r.name === 'list_operations_catalogs_v1').at(-1), pending);
  assert.equal(page.state.data?.catalogs?.teachers?.length || 0, 0);
});

test('operations: independent catalog failure remains visible and refresh can recover without erasing page rows', async (t) => {
  const page = await setup(t, 'operations');
  await act(async () => page.finish(page.numbered()[0]));
  await act(async () => page.requests.find((r) => r.name === 'list_operations_catalogs_v1').reject(new Error('CATALOG FAILED')));
  assert.match(page.state.error || '', /CATALOG FAILED/); assert.equal(page.state.totalCount, 260);
  await act(async () => { void page.state.refresh(); });
  const catalogRequests = page.requests.filter((r) => r.name === 'list_operations_catalogs_v1');
  assert.equal(catalogRequests.length, 2);
  await act(async () => catalogRequests[1].resolve({ error: null, data: { teachers: [{ name: 'recovered' }] } }));
  assert.equal(page.state.data.catalogs.teachers[0].name, 'recovered');
});

for (const domain of ['academic', 'operations']) {
  for (const intervening of ['pending', 'error']) test(`${domain}: acknowledged self-written URL restores after ${intervening} navigation`, async (t) => {
    const page = await setup(t, domain, { workspace: true, search: '?page=11' });
    await act(async () => page.finish(page.numbered()[0]));
    await act(async () => document.querySelector('button[aria-label="12 페이지"]').click());
    await act(async () => page.finish(page.numbered()[1]));
    const writtenUrl = window.location.pathname + window.location.search;
    assert.equal(new URLSearchParams(window.location.search).get('page'), '12');
    await page.render(); // Acknowledge the router's own write before genuine Back/Forward navigation.
    assert.equal(page.numbered().length, 2);

    window.history.pushState(null, '', '?page=7&q=other');
    await act(async () => window.dispatchEvent(new window.PopStateEvent('popstate')));
    await page.render();
    const abandoned = page.numbered()[2];
    assert.equal(abandoned.args.p_page, 7); assert.equal(abandoned.args.p_filters.search, 'other');
    if (intervening === 'error') await act(async () => abandoned.reject(new Error('intervening read failed')));

    window.history.pushState(null, '', writtenUrl);
    await act(async () => window.dispatchEvent(new window.PopStateEvent('popstate')));
    await page.render();
    assert.equal(page.numbered().length, 4, 'returning to an acknowledged URL must adopt the restored scope');
    const restored = page.numbered()[3];
    assert.equal(restored.args.p_page, 12); assert.equal(restored.args.p_filters.search, '');
    assert.equal(document.querySelector('input[placeholder*="검색"]').value, '');
    if (domain === 'academic') assert.equal(restored.args.p_filters.periodId, id(900));
    if (intervening === 'pending') await act(async () => page.finish(abandoned, 80));
    assert.ok(document.querySelector('button[aria-label="12 페이지"][aria-current="page"]'));
    assert.match(document.body.textContent, /260건/);
    assert.equal(window.location.pathname + window.location.search, writtenUrl);

    await act(async () => restored.reject(new Error('restored read failed')));
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === '다시 시도');
    assert.ok(retry);
    await act(async () => retry.click());
    const retried = page.numbered()[4];
    assert.equal(retried.args.p_page, 12); assert.equal(retried.args.p_filters.search, '');
    if (domain === 'academic') assert.equal(retried.args.p_filters.periodId, id(900));
    await act(async () => page.finish(retried));
    assert.ok(document.querySelector('button[aria-label="12 페이지"][aria-current="page"]'));
    assert.equal(document.querySelector('input[placeholder*="검색"]').value, '');
    assert.match(document.querySelector('tbody tr').textContent, /111/);
    assert.equal(page.numbered().length, 5);
  });
  test(`${domain}: actual workspace page11 restoration and mounted Back preserve all controls before one read`, async (t) => {
    const periodKey = domain === 'academic' ? 'period' : 'term';
    const page = await setup(t, domain, { workspace: true, search: `?page=11&q=원본&${periodKey}=${id(900)}&subject=수학&grade=고1&teacher=교사&keep=1` });
    assert.equal(page.numbered().length, 1); assert.equal(page.numbered()[0].args.p_page, 11);
    await act(async () => page.finish(page.numbered()[0]));
    assert.ok(document.querySelector('button[aria-label="11 페이지"][aria-current="page"]'));
    assert.match(document.body.textContent, /260건/);
    const otherControls = domain === 'academic' ? '&status=종강&classroom=본관1&view=done' : `&syncGroup=${id(902)}`;
    window.history.pushState(null, '', `?page=7&q=복원&${periodKey}=${id(901)}&subject=영어&grade=중1&teacher=다른&keep=1${otherControls}`);
    await act(async () => window.dispatchEvent(new window.PopStateEvent('popstate')));
    await page.render();
    assert.equal(page.numbered().length, 2);
    const restored = page.numbered()[1];
    assert.equal(restored.args.p_page, 7); assert.equal(restored.args.p_filters.search, '복원');
    assert.equal(restored.args.p_filters.subject, '영어'); assert.equal(restored.args.p_filters.grade, '중1');
    assert.equal(restored.args.p_filters.teacher, '다른');
    assert.equal(restored.args.p_filters[domain === 'academic' ? 'periodId' : 'termId'], id(901));
    if (domain === 'academic') {
      assert.equal(restored.args.p_filters.status, '종강'); assert.equal(restored.args.p_filters.classroom, '본관1'); assert.equal(restored.args.p_filters.viewMode, 'done');
    } else assert.equal(restored.args.p_filters.syncGroupId, id(902));
    await act(async () => page.finish(restored));
    assert.ok(document.querySelector('button[aria-label="7 페이지"][aria-current="page"]'));
    assert.equal(new URLSearchParams(window.location.search).get('keep'), '1');
    await page.remount();
    assert.equal(page.numbered().at(-1).args.p_page, 7);
    assert.equal(page.numbered().at(-1).args.p_filters.search, '복원');
  });
  test(`${domain}: DTO through real records builder and workspace rows preserves server full-name numeric order`, async (t) => {
    const page = await setup(t, domain, { workspace: true });
    const rows = domain === 'academic' ? [
      { ...academicRow(2), title: 'Z 2', fullTitle: '[가] Z 2', term: '나' },
      { ...academicRow(10), title: 'Z 10', fullTitle: '[가] Z 10', term: '가' },
      { ...academicRow(12), title: 'A', fullTitle: '[나] A', term: '가' },
    ] : [operationsRow(2), operationsRow(10), { ...operationsRow(12), name: '[나] A' }];
    await act(async () => page.finish(page.numbered()[0], 3, { rows }));
    const rendered = [...document.querySelectorAll('tbody tr')].map((row) => row.textContent);
    assert.equal(rendered.length, 3);
    assert.match(rendered[0], /2/); assert.match(rendered[1], /10/); assert.match(rendered[2], /A/);
  });
}

test('operations: exact detail opens independently and progress draft/lifecycle survive page replacement, then auth clears them', async (t) => {
  const page = await setup(t, 'operations', { workspace: true, search: `?lessonDesign=1&classId=${id(999)}&section=lesson-design-board` });
  const detailRequest = page.requests.find((r) => r.name === 'get_operations_class_lesson_design_detail_v1');
  assert.ok(detailRequest);
  const detail = { classItem: { id: id(999), name: 'OFF PAGE EXACT', subject: '수학', textbookIds: [id(700)],
    schedulePlan: { className: 'OFF PAGE EXACT', subject: '수학', selectedDays: [1], startDate: '2026-08-03', endDate: '2026-08-31',
      billingPeriods: [{ id: 'period-one', month: 8, label: '8월', startDate: '2026-08-03', endDate: '2026-08-31' }],
      sessions: [{ id: 'session-one', sessionNumber: 1, date: '2026-08-03', billingLabel: '8월', textbookEntries: [{ id: 'entry-one', textbookId: id(700), plan: { start: '1', end: '2', label: '저장 범위' } }] }] } },
    textbooks: [{ id: id(700), title: '정확한 교재', subject: '수학' }], teacherCatalogs: [], classroomCatalogs: [] };
  await act(async () => detailRequest.resolve({ error: null, data: detail }));
  // Exact detail is independent even while the list is still pending.
  assert.match(document.querySelector('[data-testid="lesson-design-modal-dialog"]')?.textContent || '', /OFF PAGE EXACT/);
  await act(async () => page.finish(page.numbered()[0]));
  const board = document.querySelector('[data-testid^="lesson-board-session-"]');
  assert.ok(board, `actual lesson board row exists: ${document.querySelector('[data-testid="lesson-design-modal-dialog"]')?.textContent}`);
  await act(async () => board.click());
  const input = document.querySelector('input[aria-label$="표시 문구"]');
  assert.ok(input, 'actual progress editor');
  const reactProps = input[Object.keys(input).find((key) => key.startsWith('__reactProps'))];
  await act(async () => reactProps.onChange({ target: { value: 'UNSAVED PROGRESS' } }));
  const observed = { ...page.observed };
  await act(async () => document.querySelector('button[aria-label="2 페이지"]').click());
  assert.equal(page.numbered().at(-1).args.p_page, 2);
  await act(async () => page.finish(page.numbered().at(-1)));
  assert.equal(document.querySelector('input[aria-label$="표시 문구"]').value, 'UNSAVED PROGRESS');
  assert.deepEqual(page.observed, observed);
  assert.equal(page.requests.filter((r) => r.name === 'get_operations_class_lesson_design_detail_v1').length, 1);
  await page.auth({ user: null, role: null });
  assert.equal(document.querySelector('input[aria-label$="표시 문구"]'), null);
  assert.equal(document.body.textContent.includes('OFF PAGE EXACT'), false);
  assert.equal(page.observed.requestedClassId, '');
  assert.equal(page.requests.some((r) => !/^(get_|list_|continuous_class_schedule_runtime_version)/.test(r.name)), false, 'no mutation or send');
});

for (const change of ['role', 'actor']) test(`operations: actual detail rejects an old ${change} completion for the same requested class`, async (t) => {
  const page = await setup(t, 'operations', { workspace: true, search: `?lessonDesign=1&classId=${id(999)}` });
  const old = page.requests.find((request) => request.name === 'get_operations_class_lesson_design_detail_v1');
  await page.auth(change === 'role' ? { role: 'teacher' } : { user: { id: id(801) } });
  const current = page.requests.filter((request) => request.name === 'get_operations_class_lesson_design_detail_v1').at(-1);
  assert.notEqual(current, old);
  const detail = (name) => ({ classItem: { id: id(999), name, subject: '수학', schedulePlan: {}, textbookIds: [] }, textbooks: [], teacherCatalogs: [], classroomCatalogs: [] });
  await act(async () => old.resolve({ error: null, data: detail('OLD ACTOR DETAIL') }));
  assert.equal(document.body.textContent.includes('OLD ACTOR DETAIL'), false);
  await act(async () => current.resolve({ error: null, data: detail('NEW ACTOR DETAIL') }));
  assert.match(document.querySelector('[data-testid="lesson-design-modal-dialog"]').textContent, /NEW ACTOR DETAIL/);
  assert.equal(document.body.textContent.includes('OLD ACTOR DETAIL'), false);
});
