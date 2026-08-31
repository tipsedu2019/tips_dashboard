import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url), rootPath = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function modules(supabase, overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    let input = readFileSync(file, 'utf8');
    if (file.endsWith('/approval-workspace.tsx') && overrides['@test/observer']) input = input.replace('  const approverOptions = useMemo(',
      '  require("@test/observer").observe({ catalogs, commentDrafts, input, checklistTextDraft, templateName, editingRequestId });\n  const approverOptions = useMemo(');
    const source = ts.transpileModule(input, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const resolve = (specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (specifier === '@/lib/supabase') return { supabase };
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(existsSync);
      assert.ok(target, `production module required: ${specifier}`); return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return (entry) => load(path.join(rootPath, entry));
}
const id = (n) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-08-31T00:00:00+00:00';
const row = (n, patch = {}) => ({ id: id(n), type: 'monthly_report', status: 'draft', title: `문서 ${n}`,
  requesterId: id(800), requesterLabel: '작성자', approverId: '', approverLabel: '결재자 미정', subject: 'general', templateKey: 'free',
  reportMonth: '2026-08', classSummary: '', studentIssues: '', nextMonthPlan: '', body: '본문', checklistItems: [], attachmentLinks: '', memo: '',
  submittedAt: '', decidedAt: '', createdAt: stamp, updatedAt: stamp, comments: [], events: [], ...patch });
const counts = { mine: 260, review: 12, open: 270, done: 2, returned: 3 };
function response(request, totalCount = counts[request.args.p_view], patch = {}) {
  const { p_page: page, p_page_size: pageSize } = request.args;
  return { page, pageSize, totalCount, tabCounts: { ...counts, [request.args.p_view]: totalCount },
    rows: Array.from({ length: Math.min(pageSize, Math.max(0, totalCount - (page - 1) * pageSize)) }, (_, i) => row((page - 1) * pageSize + i + 1)), ...patch };
}
function transport() {
  const requests = [], arrivals = new Set(); let actor = id(800), listener;
  const supabase = { auth: { async getUser() { return { data: { user: actor ? { id: actor } : null }, error: null }; },
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    rpc(name, args) { return pending({ name, args }); },
    from(table) { return pending({ table, steps: [] }); },
  };
  function pending(metadata) {
    const deferred = Promise.withResolvers(), request = { ...metadata, ...deferred }; requests.push(request);
    for (const notify of arrivals) notify();
    const chain = { then: deferred.promise.then.bind(deferred.promise), abortSignal(signal) { request.signal = signal; return this; },
      retry(value) { request.retry = value; return this; } };
    for (const name of ['select', 'order', 'eq', 'single', 'maybeSingle', 'insert', 'update']) chain[name] = (...args) => { request.steps.push({ name, args }); return chain; };
    return chain;
  }
  function waitForRequest(name, ordinal = 1) {
    const matching = () => requests.filter((request) => (request.name || request.table) === name)[ordinal - 1];
    if (matching()) return Promise.resolve(matching());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        arrivals.delete(notify);
        reject(new Error(`Timed out waiting for ${name} #${ordinal}; received: ${requests.map((request) => request.name || request.table).join(', ')}`));
      }, 2000);
      const notify = () => { const request = matching(); if (request) { clearTimeout(timeout); arrivals.delete(notify); resolve(request); } };
      arrivals.add(notify);
    });
  }
  return { supabase, requests, waitForRequest, setActor(value) { actor = value; listener?.(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null); }, refreshToken() { listener?.('TOKEN_REFRESHED', { user: { id: actor } }); } };
}

test('page11 is one bounded RPC and full five-tab metadata reaches the actual adapter', async () => {
  const source = path.join(rootPath, 'src/features/approvals/approval-numbered-service.ts');
  assert.ok(existsSync(source), 'approval numbered adapter is missing');
  const t = transport(), service = modules(t.supabase)('src/features/approvals/approval-numbered-service.ts');
  const result = service.readApprovalNumberedPage({ view: 'mine', page: 11, pageSize: 10 });
  assert.equal(t.requests.length, 1);
  assert.deepEqual(t.requests[0].args, { p_view: 'mine', p_page: 11, p_page_size: 10 });
  assert.equal(t.requests[0].name, 'list_approval_numbered_page_v1'); assert.equal(t.requests[0].retry, false);
  t.requests[0].resolve({ data: response(t.requests[0]), error: null });
  const page = await result; assert.equal(page.rows[0].title, '문서 101'); assert.deepEqual(page.tabCounts, counts);
});

test('strict page/detail transport rejects malformed envelopes, missing RPC and foreign children; empty relationship IDs remain legitimate', async () => {
  assert.ok(existsSync('src/features/approvals/approval-numbered-service.ts'), 'approval numbered adapter is missing');
  for (const patch of [{ totalCount: -1 }, { tabCounts: { mine: 260 } }, { page: 2 }, { rows: [] },
    { rows: [row(1, { status: ['draft'] })] }, { rows: [row(1, { createdAt: '' })] },
    { rows: [row(1, { requesterId: null })] }, { rows: [row(1, { comments: [{ id: id(2), approvalId: id(3), authorId: '', authorLabel: '작성자', body: 'x', createdAt: stamp }] })] }]) {
    const t = transport(), service = modules(t.supabase)('src/features/approvals/approval-numbered-service.ts');
    const result = service.readApprovalNumberedPage({ view: 'mine', page: 1, pageSize: 10 });
    t.requests[0].resolve({ data: response(t.requests[0], 1, patch), error: null });
    await assert.rejects(result, /approval_numbered_response_invalid/);
  }
  const t = transport(), service = modules(t.supabase)('src/features/approvals/approval-numbered-service.ts');
  for (const input of [{ view: 'all', page: 1, pageSize: 10 }, { view: 'mine', page: 0, pageSize: 10 }, { view: 'mine', page: 1, pageSize: 5 }, { view: 'mine', page: 1, pageSize: 30 }]) await assert.rejects(service.readApprovalNumberedPage(input));
  assert.equal(t.requests.length, 0);
  const missing = service.readApprovalNumberedPage({ view: 'mine', page: 1, pageSize: 10 });
  t.requests[0].resolve({ error: { code: 'PGRST202' }, data: null }); await assert.rejects(missing, /approval_numbered_rpc_unavailable/);
  const detail = service.readApprovalDetail({ id: id(999) });
  assert.equal(t.requests[1].name, 'get_approval_detail_v1');
  t.requests[1].resolve({ data: row(999), error: null }); assert.equal((await detail).approverId, '');
});

test('raw persisted checklist JSON uses the existing parser without rejecting valid legacy rows', async () => {
  for (const [checklistItems, expected] of [[null, []], [{}, []], [[null, 7, { id: '', label: 'drop' },
    { id: 'a', label: ' A ', checked: true }, { id: 'a', label: ' B ', checked: true, state: 'na', group: ' G ' }],
    [{ id: 'a', label: 'A', checked: true, state: 'done' }, { id: 'a', label: 'B', checked: false, state: 'na', group: 'G' }]]]) {
    const t = transport(), service = modules(t.supabase)('src/features/approvals/approval-numbered-service.ts');
    const detail = service.readApprovalDetail({ id: id(1) });
    t.requests[0].resolve({ data: row(1, { checklistItems }), error: null });
    assert.deepEqual((await detail).checklistItems, expected);
  }
});

async function setup(t, initial = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://test.invalid/approvals${initial.search || ''}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ['HTMLElement', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = dom.window.getComputedStyle; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0); window.cancelAnimationFrame = window.clearTimeout; window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {}; window.HTMLElement.prototype.attachEvent = () => {}; window.HTMLElement.prototype.detachEvent = () => {};
  window.localStorage.setItem('tips.data-table-page-size.v1', JSON.stringify({ 'approvals:requests': { mode: 'manual', pageSize: initial.pageSize || 10 } }));
  const root = createRoot(document.getElementById('root')), io = transport();
  let auth = { user: { id: id(800), name: '교사' }, role: 'admin', loading: false, canManageAll: true, isStaff: false, isAdmin: true, ...initial.auth };
  let search = null, params, observed;
  const load = modules(io.supabase, { '@test/observer': { observe(value) { observed = value; } }, '@/providers/auth-provider': { useAuth: () => auth }, 'next/navigation': { useSearchParams() {
    if (search !== window.location.search) { search = window.location.search; params = new URLSearchParams(search); } return params;
  } } });
  const Workspace = load('src/features/approvals/approval-workspace.tsx').ApprovalWorkspace;
  const render = async () => act(async () => root.render(createElement(Workspace)));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  await render();
  return { ...io, load, render, get observed() { return observed; }, numbered: () => io.requests.filter((r) => r.name === 'list_approval_numbered_page_v1'),
    finish: (request, total, patch) => request.resolve({ error: null, data: response(request, total, patch) }),
    auth: async (patch) => { auth = { ...auth, ...patch }; io.setActor(auth.user?.id || null); await render(); },
    catalogs: async () => act(async () => { for (const r of io.requests.filter((r) => r.table)) r.resolve({ error: null, data: [] }); }),
  };
}
const button = (label) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label);
const changeInput = async (input, value) => act(async () => input[Object.keys(input).find((key) => key.startsWith('__reactProps'))].onChange({ target: { value } }));

test('actual approval workspace restores page11, preserves accepted rows/counts on failure, retries and clamps', async (t) => {
  const p = await setup(t, { search: '?page=11&view=mine&other=keep' });
  assert.equal(p.numbered().length, 1, 'workspace must use the numbered service');
  assert.equal(p.numbered()[0].args.p_page, 11);
  await act(async () => p.finish(p.numbered()[0]));
  assert.match(document.body.textContent, /문서 101/); assert.match(document.body.textContent, /260건/);
  assert.equal(document.querySelectorAll('article').length, 10);
  await act(async () => button('12 페이지').click());
  await act(async () => p.numbered()[1].reject(new Error('PAGE FAILURE')));
  assert.match(document.body.textContent, /문서 101/); assert.match(document.body.textContent, /PAGE FAILURE/);
  assert.ok(button('11 페이지').getAttribute('aria-current'));
  await act(async () => button('다시 시도').click()); assert.equal(p.numbered()[2].args.p_page, 12);
  await act(async () => p.finish(p.numbered()[2], 97)); assert.equal(p.numbered()[3].args.p_page, 10);
  await act(async () => p.finish(p.numbered()[3], 97)); assert.match(document.body.textContent, /97건/);
  assert.equal(new URLSearchParams(window.location.search).get('other'), 'keep');
});

test('unresolved auth does not read; user/role changes discard old page, detail and catalog callbacks', async (t) => {
  const p = await setup(t, { search: `?approvalId=${id(999)}`, auth: { loading: true, role: null } });
  assert.equal(p.requests.length, 0);
  await p.auth({ loading: false, role: 'admin' });
  assert.equal(p.numbered().length, 1);
  const oldPage = p.numbered()[0], oldDetail = p.requests.find((r) => r.name === 'get_approval_detail_v1');
  await p.auth({ role: 'teacher', canManageAll: false, isAdmin: false });
  await act(async () => { p.finish(oldPage); oldDetail.resolve({ data: row(999, { title: 'OLD DETAIL' }), error: null }); });
  assert.doesNotMatch(document.body.textContent, /문서 1|OLD DETAIL/);
  await p.auth({ user: null, role: null }); await p.catalogs();
  assert.equal(document.querySelectorAll('article').length, 0);
});

test('delayed catalogs from an old role cannot populate the new session catalog or composer', async (t) => {
  const p = await setup(t);
  const oldProfiles = p.requests.find((r) => r.table === 'profiles'), oldTemplates = p.requests.find((r) => r.table === 'approval_templates');
  await p.auth({ role: 'teacher', canManageAll: false, isAdmin: false });
  await act(async () => {
    oldProfiles.resolve({ data: [{ id: id(801), name: 'OLD PRIVATE APPROVER', role: 'admin', email: '' }], error: null });
    oldTemplates.resolve({ data: [{ id: id(901), name: 'OLD PRIVATE TEMPLATE', body: 'OLD PRIVATE BODY' }], error: null });
  });
  assert.deepEqual(p.observed.catalogs, { profiles: [], templates: [] });
  assert.equal(p.observed.input.approverId, ''); assert.equal(p.observed.templateName, '');
  const currentProfiles = p.requests.filter((r) => r.table === 'profiles').at(-1), currentTemplates = p.requests.filter((r) => r.table === 'approval_templates').at(-1);
  await act(async () => { currentProfiles.resolve({ data: [{ id: id(802), name: 'CURRENT', role: 'admin', email: '' }], error: null }); currentTemplates.resolve({ data: [], error: null }); });
  assert.equal(p.observed.catalogs.profiles[0].label, 'CURRENT');
});

test('caller cancellation and an eight-second deadline are combined; rejected reads never retry', async (t) => {
  const io = transport(), service = modules(io.supabase)('src/features/approvals/approval-numbered-service.ts');
  const original = AbortSignal.timeout, deadlines = [];
  AbortSignal.timeout = (ms) => { const deadline = new AbortController(); deadlines.push({ ms, deadline }); return deadline.signal; };
  t.after(() => { AbortSignal.timeout = original; });
  const caller = new AbortController(), first = service.readApprovalNumberedPage({ view: 'mine', page: 1, pageSize: 10, signal: caller.signal });
  assert.equal(deadlines[0].ms, 8000); caller.abort(); assert.equal(io.requests[0].signal.aborted, true);
  io.requests[0].resolve({ data: response(io.requests[0]), error: null }); await assert.rejects(first, { name: 'AbortError' });
  const second = service.readApprovalDetail({ id: id(999), signal: new AbortController().signal });
  deadlines[1].deadline.abort(); assert.equal(io.requests[1].signal.aborted, true);
  io.requests[1].resolve({ data: row(999), error: null }); await assert.rejects(second, { name: 'AbortError' });
  assert.equal(io.requests.length, 2); assert.ok(io.requests.every((r) => r.retry === false));
  await assert.rejects(service.readApprovalDetail({ id: id(999), signal: caller.signal })); assert.equal(io.requests.length, 2);
});

test('legacy unknown-owner retry is quarantined before any replacement write', { timeout: 2000 }, async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } });
  const attempt = { version: 1, salt: id(9), fingerprint: 'a'.repeat(64), requestId: id(10), createRequestId: id(11), transitionRequestId: id(12), createdAt: Date.now(), createdApprovalId: id(13), createdUpdatedAt: stamp };
  const key = 'tips.approval.mutation-attempt.v1:create'; window.sessionStorage.setItem(key, JSON.stringify(attempt));
  const service = p.load('src/features/approvals/approval-service.ts');
  const save = service.createMonthlyReportApproval({ body: 'same input', checklistItems: [] }, id(800), 'draft');
  // A known legacy attempt must synchronously reach an explicit recovery error, never a pending writer.
  const result = await save.then(() => 'wrote', (error) => error);
  assert.equal(result.code, 'approval_legacy_attempt_recovery_required');
  assert.equal(p.requests.filter((r) => r.name?.includes('create_approval')).length, 0);
  assert.equal(window.sessionStorage.getItem(key), JSON.stringify(attempt));
  service.discardLegacyApprovalMutationAttempt('create');
  assert.equal(window.sessionStorage.getItem(key), null);
});

test('direct off-tab detail is separate from exactly ten numbered rows and preserves tab predicates', async (t) => {
  // Existing predicates: mine=all authored statuses; review=assigned AND not approved/returned/canceled;
  // open=not approved/returned/canceled; done=approved; returned=returned.
  const p = await setup(t, { search: `?approvalId=${id(999)}` });
  await act(async () => p.finish(p.numbered()[0]));
  const detail = p.requests.find((r) => r.name === 'get_approval_detail_v1');
  await act(async () => detail.resolve({ data: row(999, { requesterId: id(801), status: 'canceled', title: '외부 상세' }), error: null }));
  assert.equal(p.numbered().at(-1).args.p_view, 'open');
  await act(async () => p.finish(p.numbered().at(-1)));
  assert.match(document.querySelector('section[aria-label="연결된 문서 상세"]').textContent, /외부 상세/);
  assert.equal(document.querySelector('[aria-label="전자결재 목록"]').querySelectorAll('article').length, 10);
  assert.match(document.body.textContent, /270건/);
});

test('same-tab direct detail leaves a restored numbered page11 intact', async (t) => {
  const p = await setup(t, { search: `?page=11&view=mine&approvalId=${id(999)}` });
  await act(async () => p.requests.find((r) => r.name === 'get_approval_detail_v1').resolve({ data: row(999), error: null }));
  assert.equal(p.numbered().length, 1); assert.equal(p.numbered()[0].args.p_page, 11);
});

test('hydrating saved size20 preserves initial direct page11 instead of resetting it', async (t) => {
  const p = await setup(t, { search: '?page=11', pageSize: 20 });
  assert.equal(p.numbered().length, 1); assert.equal(p.numbered()[0].args.p_page, 11);
  assert.equal(p.numbered()[0].args.p_page_size, 20);
});

test('same actor composer and comment drafts survive page-away/back; failed sends retain and acknowledgments only clear matching text', async (t) => {
  const p = await setup(t); await act(async () => p.finish(p.numbered()[0]));
  const comment = () => document.querySelector('input[aria-label="문서 1 댓글"]');
  await changeInput(comment(), 'UNSENT');
  await act(async () => button('자유').click());
  const body = () => document.querySelector('textarea[placeholder*="본문"]') || document.querySelector('textarea');
  await changeInput(body(), 'COMPOSER DRAFT');
  await act(async () => button('2 페이지').click()); await act(async () => p.finish(p.numbered().at(-1)));
  assert.equal(comment(), null); assert.equal(body().value, 'COMPOSER DRAFT');
  await act(async () => button('1 페이지').click()); await act(async () => p.finish(p.numbered().at(-1)));
  assert.equal(comment().value, 'UNSENT');
  await act(async () => { comment().closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await p.waitForRequest('add_approval_comment_v2'); });
  const first = p.requests.find((r) => r.name === 'add_approval_comment_v2'); assert.ok(first);
  await act(async () => first.resolve({ data: null, error: { message: 'uncertain' } }));
  assert.equal(comment().value, 'UNSENT');
  await act(async () => { comment().closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await p.waitForRequest('add_approval_comment_v2', 2); });
  const retry = p.requests.filter((r) => r.name === 'add_approval_comment_v2').at(-1);
  assert.equal(retry.args.p_request_id, first.args.p_request_id);
  await changeInput(comment(), 'NEWER TEXT');
  await act(async () => retry.resolve({ data: {}, error: null }));
  assert.equal(comment().value, 'NEWER TEXT');
  await act(async () => p.finish(p.numbered().at(-1)));
  await act(async () => { comment().closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await p.waitForRequest('add_approval_comment_v2', 3); });
  await act(async () => p.requests.filter((r) => r.name === 'add_approval_comment_v2').at(-1).resolve({ data: {}, error: null }));
  assert.equal(comment().value, '', 'an acknowledged unchanged draft clears');
  await p.auth({ role: 'teacher' }); assert.equal(document.querySelector('article'), null);
  assert.doesNotMatch(document.body.textContent, /COMPOSER DRAFT|NEWER TEXT/);
});

test('actual service resumes same-actor uncertain create with stable IDs but rejects old-actor continuation and persistence', async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } }), service = p.load('src/features/approvals/approval-service.ts');
  const input = { body: 'same', checklistItems: [] };
  const first = service.createMonthlyReportApproval(input, id(800), 'submitted');
  const firstResult = first.catch((error) => error); await p.waitForRequest('create_approval_request_v2');
  const create = p.requests.at(-1); assert.equal(create.name, 'create_approval_request_v2');
  create.resolve({ error: null, data: { request: { id: id(77), status: 'draft', updated_at: stamp } } }); await p.waitForRequest('transition_approval_request_v2');
  const transition = p.requests.at(-1); assert.equal(transition.name, 'transition_approval_request_v2');
  transition.resolve({ data: null, error: { message: 'network uncertain' } }); await firstResult;
  const storedKey = `tips.approval.mutation-attempt.v1:${id(800)}:create`;
  const stored = JSON.parse(window.sessionStorage.getItem(storedKey)); assert.equal(stored.createdApprovalId, id(77));
  const retry = service.createMonthlyReportApproval(input, id(800), 'submitted'); const retryResult = retry.catch((error) => error); await p.waitForRequest('transition_approval_request_v2', 2);
  assert.equal(p.requests.filter((r) => r.name === 'create_approval_request_v2').length, 1);
  assert.equal(p.requests.at(-1).args.p_request_id, transition.args.p_request_id);
  const oldPending = p.requests.at(-1); const before = window.sessionStorage.getItem(storedKey);
  p.setActor(id(801)); oldPending.resolve({ data: { request: { id: id(77), status: 'submitted', updated_at: stamp } }, error: null });
  assert.equal((await retryResult).code, 'approval_session_changed'); assert.equal(window.sessionStorage.getItem(storedKey), before);
  const other = service.createMonthlyReportApproval(input, id(801), 'draft'); const otherResult = other.catch((error) => error); await p.waitForRequest('create_approval_request_v2', 2);
  assert.equal(p.requests.at(-1).name, 'create_approval_request_v2'); assert.notEqual(p.requests.at(-1).args.p_request_id, create.args.p_request_id);
  p.requests.at(-1).resolve({ error: { message: 'uncertain' }, data: null }); await otherResult;
});

test('actor switch before getUser/digest completion does not write, and normal token refresh preserves the save session', async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } });
  const authRead = Promise.withResolvers(); p.supabase.auth.getUser = () => authRead.promise;
  const service = p.load('src/features/approvals/approval-service.ts');
  const first = service.createMonthlyReportApproval({ body: 'x', checklistItems: [] }, id(800), 'draft').catch((error) => error);
  p.setActor(null); authRead.resolve({ data: { user: { id: id(800) } }, error: null });
  assert.equal((await first).code, 'approval_session_changed'); assert.equal(p.requests.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  p.setActor(id(800)); p.supabase.auth.getUser = async () => ({ data: { user: { id: id(800) } }, error: null });
  const next = service.createMonthlyReportApproval({ body: 'x', checklistItems: [] }, id(800), 'draft'); await p.waitForRequest('create_approval_request_v2'); p.refreshToken();
  p.requests.at(-1).resolve({ error: null, data: { request: { id: id(70), status: 'draft', updated_at: stamp } } });
  await next; assert.equal(window.sessionStorage.length, 0);
});

test('late create receipt after actor switch cannot persist progress or issue transition', async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } }), service = p.load('src/features/approvals/approval-service.ts');
  const pending = service.createMonthlyReportApproval({ body: 'PRIVATE BODY', checklistItems: [] }, id(800), 'submitted').catch((error) => error);
  const call = await p.waitForRequest('create_approval_request_v2');
  const key = `tips.approval.mutation-attempt.v1:${id(800)}:create`, before = window.sessionStorage.getItem(key);
  assert.doesNotMatch(before, /PRIVATE BODY/);
  p.setActor(id(801)); call.resolve({ data: { request: { id: id(77), status: 'draft', updated_at: stamp } }, error: null });
  assert.equal((await pending).code, 'approval_session_changed');
  assert.equal(window.sessionStorage.getItem(key), before); assert.equal(p.requests.length, 1);
});

test('real consumer rejects old save completion after same-ID role change and clears its editor drafts', async (t) => {
  const p = await setup(t); await act(async () => p.finish(p.numbered()[0]));
  await act(async () => button('자유').click());
  await changeInput(document.querySelector('textarea'), 'OLD ACTOR DRAFT');
  await act(async () => { button('임시저장').click(); await p.waitForRequest('create_approval_request_v2'); });
  const create = p.requests.find((r) => r.name === 'create_approval_request_v2'); assert.ok(create);
  await p.auth({ role: 'teacher', canManageAll: false, isAdmin: false });
  const before = p.requests.length;
  await act(async () => create.resolve({ data: { request: { id: id(77), status: 'draft', updated_at: stamp } }, error: null }));
  assert.equal(p.requests.length, before, 'old save cannot issue new actor reload');
  assert.doesNotMatch(document.body.textContent, /임시 저장했습니다|OLD ACTOR DRAFT/);
});

test('save acknowledgment cannot close a checklist editor changed while the save was pending', async (t) => {
  const p = await setup(t); await act(async () => p.finish(p.numbered()[0]));
  await act(async () => button('자유').click());
  await act(async () => { button('임시저장').click(); await p.waitForRequest('create_approval_request_v2'); });
  const create = p.requests.find((r) => r.name === 'create_approval_request_v2');
  await act(async () => document.querySelector('section[aria-label="월간 보고서 점검"] > button').click());
  const editChecks = button('항목 편집'); assert.ok(editChecks);
  await act(async () => editChecks.click());
  const editor = () => document.querySelector('textarea[placeholder^="그룹:"]'); assert.ok(editor());
  await changeInput(editor(), 'UNSAVED GROUP: NEW CHECK');
  await act(async () => create.resolve({ data: { request: { id: id(77), status: 'draft', updated_at: stamp } }, error: null }));
  assert.ok(editor(), 'new unsaved checklist remains visibly editable'); assert.equal(editor().value, 'UNSAVED GROUP: NEW CHECK');
  await act(async () => p.finish(p.numbered().at(-1)));
});

test('uncertain update resumes update-to-transition with original receipts; auth failure never falls back to caller ID', async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } }), service = p.load('src/features/approvals/approval-service.ts');
  const input = { body: 'EDIT', checklistItems: [] };
  const first = service.updateMonthlyReportApproval(id(77), input, 'submitted').catch((error) => error); await p.waitForRequest('approval_requests');
  assert.equal(p.requests.at(-1).table, 'approval_requests');
  p.requests.at(-1).resolve({ data: { id: id(77), status: 'draft', updated_at: stamp }, error: null }); await p.waitForRequest('update_approval_request_v2');
  assert.equal(p.requests.at(-1).name, 'update_approval_request_v2');
  p.requests.at(-1).resolve({ data: { request: { id: id(77), status: 'draft', updated_at: stamp } }, error: null }); await p.waitForRequest('transition_approval_request_v2');
  const transition = p.requests.at(-1); transition.resolve({ data: null, error: { message: 'uncertain' } }); await first;
  const count = p.requests.length;
  const next = service.updateMonthlyReportApproval(id(77), input, 'submitted'); await p.waitForRequest('transition_approval_request_v2', 2);
  assert.equal(p.requests.length, count + 1); assert.equal(p.requests.at(-1).name, 'transition_approval_request_v2');
  assert.equal(p.requests.at(-1).args.p_request_id, transition.args.p_request_id);
  p.requests.at(-1).resolve({ data: { request: { id: id(77), status: 'submitted', updated_at: stamp } }, error: null }); await next;
  p.supabase.auth.getUser = async () => ({ data: { user: null }, error: new Error('AUTH FAILURE') });
  await assert.rejects(service.createMonthlyReportApproval(input, id(800), 'draft'), /AUTH FAILURE/);
  assert.equal(p.requests.length, count + 1);
});

test('template lookup completion from old actor cannot continue to template DML', async (t) => {
  const p = await setup(t, { auth: { loading: true, role: null } }), service = p.load('src/features/approvals/approval-service.ts');
  const save = service.saveApprovalTemplate({ body: 'PRIVATE TEMPLATE', checklistItems: [] }, id(800), '서식').catch((error) => error);
  await p.waitForRequest('approval_templates'); assert.equal(p.requests.at(-1).table, 'approval_templates');
  p.setActor(id(801)); p.requests.at(-1).resolve({ data: { id: id(78) }, error: null });
  assert.equal((await save).code, 'approval_session_changed'); assert.equal(p.requests.length, 1);
});

test('template save acknowledgment keeps a newly edited template name visibly open', async (t) => {
  const p = await setup(t); await act(async () => p.finish(p.numbered()[0])); await p.catalogs();
  await act(async () => button('자유').click());
  await changeInput(document.querySelector('textarea'), 'TEMPLATE BODY');
  await act(async () => button('서식 저장').click());
  const name = () => document.querySelector('input[aria-label="서식명"]');
  await changeInput(name(), 'FIRST NAME');
  await act(async () => { button('저장').click(); await p.waitForRequest('approval_templates', 2); });
  await act(async () => { p.requests.filter((r) => r.table === 'approval_templates').at(-1).resolve({ data: null, error: null }); await p.waitForRequest('approval_templates', 3); });
  await changeInput(name(), 'NEW UNSAVED NAME');
  await act(async () => p.requests.filter((r) => r.table === 'approval_templates').at(-1).resolve({ data: null, error: null }));
  assert.ok(name(), 'new template-name draft remains visibly editable');
  assert.equal(name().value, 'NEW UNSAVED NAME');
});

test('legacy recovery UI discards only ambiguous local state and waits for a second intentional save', async (t) => {
  const p = await setup(t); await act(async () => p.finish(p.numbered()[0]));
  const legacyKey = 'tips.approval.mutation-attempt.v1:create';
  window.sessionStorage.setItem(legacyKey, JSON.stringify({ version: 1, salt: id(8), fingerprint: 'a'.repeat(64), requestId: id(9), createRequestId: id(10), transitionRequestId: id(11), createdAt: Date.now() }));
  const otherKey = `tips.approval.mutation-attempt.v1:${id(801)}:create`; window.sessionStorage.setItem(otherKey, 'preserve other actor');
  await act(async () => button('자유').click());
  await act(async () => { button('임시저장').click(); });
  assert.ok(button('로컬 재시도 기록 폐기')); assert.equal(p.requests.filter((r) => r.name === 'create_approval_request_v2').length, 0);
  await act(async () => button('로컬 재시도 기록 폐기').click());
  assert.equal(window.sessionStorage.getItem(legacyKey), null); assert.equal(window.sessionStorage.getItem(otherKey), 'preserve other actor');
  assert.equal(p.requests.filter((r) => r.name === 'create_approval_request_v2').length, 0, 'discard is not a server write');
  await act(async () => { button('임시저장').click(); await p.waitForRequest('create_approval_request_v2'); });
  assert.equal(p.requests.filter((r) => r.name === 'create_approval_request_v2').length, 1);
  await act(async () => p.requests.at(-1).resolve({ data: null, error: { message: 'uncertain' } }));
});

test('mounted Back restoration revisits an earlier self-written URL without echo suppression', async (t) => {
  const p = await setup(t, { search: '?page=11&view=mine&keep=yes' }); await act(async () => p.finish(p.numbered()[0]));
  const earlier = window.location.href;
  await act(async () => button('12 페이지').click()); await act(async () => p.finish(p.numbered().at(-1)));
  window.history.replaceState(null, '', '?page=7&view=returned&keep=yes'); await p.render();
  assert.equal(p.numbered().at(-1).args.p_page, 7); assert.equal(p.numbered().at(-1).args.p_view, 'returned');
  await act(async () => p.finish(p.numbered().at(-1), 100));
  window.history.replaceState(null, '', earlier); await p.render();
  assert.equal(p.numbered().at(-1).args.p_page, 11); assert.equal(p.numbered().at(-1).args.p_view, 'mine');
});
