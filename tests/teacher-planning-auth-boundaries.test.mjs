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


globalThis.fetch=async()=>{throw Error('external network forbidden by independent audit')};
test('teacher planning bounded permission denial revokes the accepted normalized supplement snapshot',async t=>{
 const page=await setup(t,'operations',{workspace:true,auth:{role:'teacher'},search:`?lessonDesign=1&classId=${id(999)}&section=lesson-design-board`});
 const request=page.requests.find(r=>r.name==='get_operations_class_lesson_design_detail_v1');assert.ok(request);
 await act(async()=>request.resolve({error:null,data:detail()}));
 await page.normalized({status:'ready',value:{source:'normalized',data:{scheduleRevision:1,contentHash:'synthetic-read',sessions:[
 {id:id(600),session_key:'session-one',session_date:'2026-08-03',session_number:1,revision:1,schedule_state:'active',memo:'BOUNDED_NORMALIZED_PERMISSION_CANARY'}]}}});
 assert.equal(page.observed.lessonDesignSnapshot.sessions.some(s=>s.memo==='BOUNDED_NORMALIZED_PERMISSION_CANARY'),true,'accepted normalized supplement is consumed by the real React workspace');
 await page.normalized({status:'ready',value:{source:'error',error:{code:'42501',message:'SYNTHETIC_PERMISSION_DENIED'}}});
 const stale=page.observed.lessonDesignSnapshot?.sessions.some(s=>s.memo==='BOUNDED_NORMALIZED_PERMISSION_CANARY')||false;
 console.log('PLANNING_BOUNDARY_AFTER_DENIAL',JSON.stringify({staleNormalizedSnapshot:stale,domCanary:document.body.textContent.includes('BOUNDED_NORMALIZED_PERMISSION_CANARY')}));
 assert.equal(stale,false,'same-actor bounded authorization failure must clear the accepted normalized supplement');
 assert.equal(document.body.textContent.includes('BOUNDED_NORMALIZED_PERMISSION_CANARY'),false);
 assert.equal(page.requests.some(r=>!/^get_|^list_|^continuous_class_schedule_runtime_version$/.test(r.name)),false,'no producer calls');
});
