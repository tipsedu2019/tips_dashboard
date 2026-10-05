import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const issuerId = '10000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000002';
const otherOwnerId = '10000000-0000-4000-8000-000000000003';
const credentialId = '20000000-0000-4000-8000-000000000001';
const expiresAt = '2099-10-06T00:00:00Z';
const issued = {
  id: credentialId, label: '개인 요청', credentialKind: 'personal',
  ownerProfileId: ownerId, issuerProfileId: issuerId, ownerName: '합성 교사', issuerName: '합성 관리자',
  scopes: ['ai-agent:requests:read'], grant: { queues: ['employee_requests'], actions: ['read'] },
  expiresAt, token: 'tips_agent_' + 'a'.repeat(64),
};
const { token: unusedToken, ...metadata } = issued;
assert.ok(unusedToken);
const listed = { ...metadata, createdAt: '2026-10-05T00:00:00Z', revokedAt: null, lastUsedAt: null };

async function mount(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/settings/agent-access' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of [
    'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Element',
    'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent',
    'Node', 'NodeFilter', 'DOMRect', 'getComputedStyle',
  ]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 32, height: 32 }]; };
  let auth = {
    user: { id: issuerId, isFallbackRole: false, name: '합성 관리자' }, role: 'admin', loading: false,
    session: { user: { id: issuerId }, access_token: 'synthetic' },
    ...options.auth,
  };
  const previousFetch = globalThis.fetch, previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
  const writes = [], reads = [], ownerReads = [], rpcReads = [], spaceReads = [], pagePreferences = [];
  let ownerFailure = options.ownerFailure ?? false;
  let listDeferred = options.listDeferred ?? false;
  const owners = options.owners ?? [{ id: ownerId, name: '합성 교사' }, { id: otherOwnerId, name: null }];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(new URL(url, 'https://test.invalid').hostname, 'test.invalid', 'fixture must never use an external host');
    if (url.includes('/spaces')) {
      spaceReads.push({ url, method: init.method });
      return Response.json({ data: {
      items: Array.from({ length: 7 }, (_, index) => ({
        key: `space_${index + 1}`, label: `합성 공간 ${index + 1}`, configured: index === 0,
        selectable: index === 0, reason: index ? 'space_not_configured' : null, revision: '1',
      })),
      }, error: null });
    }
    assert.match(url, /\/rest\/v1\/rpc\/ai_agent_(personal_)?credential_api_v1$/);
    const args = JSON.parse(init.body);
    if (args.p_action === 'list') rpcReads.push({ url, args });
    if (url.endsWith('/ai_agent_credential_api_v1') && args.p_action === 'list') {
      return Response.json({ items: [], total: 0, supportEnabled: true });
    }
    if (args.p_action === 'owners') {
      ownerReads.push(args.p_input);
      if (ownerFailure) throw new Error('synthetic owner lookup unavailable');
      const { page, pageSize } = args.p_input;
      return Response.json({ items: owners.slice((page - 1) * pageSize, page * pageSize), total: owners.length, page, pageSize });
    }
    if (args.p_action === 'list') {
      if (!listDeferred) return Response.json({ items: options.rows ?? [], total: options.rows?.length ?? 0, supportEnabled: options.support ?? true });
      const pending = Promise.withResolvers(); reads.push({ ...pending, args }); return pending.promise;
    }
    const pending = Promise.withResolvers(); writes.push({ ...pending, args }); return pending.promise;
  };
  const overrides = new Map([
    ['@/providers/auth-provider', { useAuth: () => auth }],
    ['@/lib/supabase', { supabase: {
      auth: { getSession: async () => ({ data: { session: auth.session }, error: null }) },
      rpc: () => { const result = Promise.resolve({ data: { items: [], total: 0 }, error: null }); result.abortSignal = () => result; result.retry = () => result; return result; },
    } }],
    ['@/lib/guarded-navigation', { requestAppNavigation: callback => callback() }],
    ['@/hooks/use-data-table-page-size', { useDataTablePageSize: key => {
      pagePreferences.push(key); return { pageSize: 10, ready: true, setPreference: () => {} };
    } }],
  ]);
  const loadedModule = loadNotificationComponent(options.integration
    ? 'src/features/agent-api/agent-access-workspace.tsx'
    : 'src/features/ai-agent/ai-agent-personal-credential-workspace.tsx', overrides);
  const Component = options.integration
    ? () => createElement(loadedModule.AgentAccessWorkspace, { apiEnabled: false })
    : loadedModule.AiAgentPersonalCredentialWorkspace;
  const { createRoot } = await import('react-dom/client');
  let root = createRoot(document.getElementById('root'));
  const flush = async callback => act(async () => { callback?.(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const renderComponent = () => options.strict
    ? createElement(StrictMode, null, createElement(Component))
    : createElement(Component);
  await flush(() => root.render(renderComponent()));
  t.after(async () => {
    await flush(() => root.unmount()); globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    dom.window.close();
  });
  const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
  const edit = async (id, value) => flush(() => {
    const input = document.getElementById(id); assert.ok(input, id);
    const prototype = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const submit = async () => flush(() => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  return {
    writes, reads, ownerReads, rpcReads, spaceReads, pagePreferences, flush, button, edit, submit,
    async open() { await flush(() => { const opener = button('개인 요청 키 발급') ?? button('발급 결과 확인'); opener.focus(); opener.click(); }); },
    async selectOwner(id = ownerId) { await edit('ai-personal-credential-owner', id); },
    async switch(next) {
      auth = { ...auth, ...next, user: next.user ?? auth.user };
      auth.session = { user: { id: auth.user.id }, access_token: 'synthetic' };
      await flush(() => root.render(renderComponent()));
    },
    async remount() { await flush(() => root.unmount()); root = createRoot(document.getElementById('root')); await flush(() => root.render(renderComponent())); },
    failOwners(value = true) { ownerFailure = value; },
    deferLists(value = true) { listDeferred = value; },
  };
}

for (const auth of [{ role: 'teacher' }, { role: 'staff' }, { role: 'viewer' }, { user: { id: issuerId, isFallbackRole: true } }]) {
  test(`only resolved admin sees personal controls (${auth.role ?? 'fallback'})`, async t => {
    const ui = await mount(t, { auth });
    assert.equal(ui.button('개인 요청 키 발급'), undefined);
    assert.equal(ui.writes.length, 0); assert.equal(ui.ownerReads.length, 0);
    await ui.switch({ role: 'admin', user: { id: issuerId, isFallbackRole: false } });
    assert.ok(ui.button('개인 요청 키 발급'));
  });
}

test('metadata separates owner and issuer and uses its own page preference', async t => {
  const ui = await mount(t, { rows: [{ ...listed, ownerName: null }] });
  assert.deepEqual([...document.querySelectorAll('th')].map(cell => cell.textContent), ['이름', '요청 소유자', '발급 관리자', '권한', '알림 공간', '만료', '상태', '작업']);
  const cells = [...document.querySelectorAll('tbody td')];
  assert.equal(cells[1].textContent, `이름 없음${ownerId}`);
  assert.equal(cells[2].textContent, `합성 관리자${issuerId}`);
  assert.ok(ui.pagePreferences.every(key => key === 'settings:personal-credential'));
  assert.equal(ui.writes.length, 0);
});

test('disabled support does not issue while allowing inventory and revocation', async t => {
  const ui = await mount(t, { support: false, rows: [listed] });
  assert.equal(ui.button('개인 요청 키 발급').disabled, true);
  assert.match(document.body.textContent, /개인 요청 키 발급 준비 중/);
  assert.equal(ui.button('폐기').disabled, false);
  assert.equal(ui.writes.length, 0);
});

test('StrictMode personal workspace loads inventory, configured spaces, and owners without a write', async t => {
  const ui = await mount(t, { strict: true, rows: [listed] });
  assert.equal(ui.button('개인 요청 키 발급').disabled, false);
  assert.ok(ui.rpcReads.some(read => read.url.endsWith('/ai_agent_personal_credential_api_v1')));
  assert.ok(ui.spaceReads.length > 0);
  assert.match(document.querySelector('tbody').textContent, /합성 교사/);
  await ui.open();
  assert.ok(ui.ownerReads.some(read => read.page === 1 && read.pageSize === 20));
  assert.ok([...document.getElementById('ai-personal-credential-owner').options].some(option => option.value === ownerId));
  await ui.selectOwner();
  await ui.flush(() => document.getElementById('ai-personal-credential-chat').click());
  assert.equal(document.getElementById('ai-personal-credential-space_space_1').disabled, false);
  assert.equal(document.getElementById('ai-personal-credential-space_space_2').disabled, true);
  assert.equal(document.querySelector('form button[type="submit"]').disabled, true, 'completion still requires an explicit space');
  assert.doesNotMatch(document.body.textContent, /목록을 불러오지 못했습니다/);
  assert.equal(ui.writes.length, 0);
});

test('StrictMode actual central tab loads inventory and configured spaces without a write', async t => {
  const ui = await mount(t, { strict: true, integration: true });
  await ui.flush(() => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'AI 요청 키')
    .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 })));
  assert.equal(ui.button('AI 요청 키 발급').disabled, false);
  assert.ok(ui.rpcReads.some(read => read.url.endsWith('/ai_agent_credential_api_v1')));
  assert.ok(ui.spaceReads.length > 0);
  await ui.flush(() => ui.button('AI 요청 키 발급').click());
  const chat = [...document.querySelectorAll('label')].find(label => label.textContent === 'Chat 전송 권한').querySelector('[role="checkbox"]');
  await ui.flush(() => chat.click());
  const configured = [...document.querySelectorAll('label')].find(label => label.textContent === '합성 공간 1').querySelector('[role="checkbox"]');
  assert.equal(configured.disabled, false);
  assert.doesNotMatch(document.body.textContent, /목록을 불러오지 못했습니다/);
  assert.equal(ui.ownerReads.length, 0, 'central tab must not fetch personal owners');
  assert.equal(ui.writes.length, 0);
});

test('owner is required without any automatic selection; read-only and one-day are default', async t => {
  const ui = await mount(t); await ui.open();
  const owner = document.getElementById('ai-personal-credential-owner');
  assert.equal(owner.value, ''); assert.equal(owner.required, true);
  assert.equal(document.querySelector('form button[type="submit"]').disabled, true);
  await ui.submit(); assert.equal(ui.writes.length, 0);
  await ui.selectOwner(); await ui.submit();
  const payload = ui.writes[0].args.p_input;
  assert.equal(payload.ownerProfileId, ownerId);
  assert.deepEqual(payload.scopes, ['ai-agent:requests:read']);
  assert.deepEqual(payload.grant, { queues: ['employee_requests'], actions: ['read'] });
  assert.ok(Date.parse(payload.expiresAt) - Date.now() > 23 * 3_600_000);
  assert.ok(Date.parse(payload.expiresAt) - Date.now() <= 24 * 3_600_000);
  assert.equal(Object.hasOwn(payload, 'issuerProfileId'), false);
});

test('owner lookup failure and empty result independently prevent new issuance', async t => {
  const ui = await mount(t, { ownerFailure: true }); await ui.open();
  assert.match(document.body.textContent, /요청 소유자 목록을 불러오지 못했습니다/);
  assert.equal(document.querySelector('form button[type="submit"]').disabled, true);
  ui.failOwners(false); await ui.flush(() => ui.button('소유자 목록 다시 시도').click());
  await ui.selectOwner(); assert.equal(document.querySelector('form button[type="submit"]').disabled, false);
  assert.equal(ui.writes.length, 0);
});

test('empty owner catalog never defaults the administrator as owner', async t => {
  const ui = await mount(t, { owners: [] }); await ui.open();
  assert.match(document.body.textContent, /선택할 수 있는 교사가 없습니다/);
  assert.equal(document.getElementById('ai-personal-credential-owner').value, '');
  await ui.submit(); assert.equal(ui.writes.length, 0);
});

test('owner pages append duplicate/null names by ID and preserve the explicit selection', async t => {
  const owners = Array.from({ length: 21 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: index === 20 ? null : '같은 이름',
  }));
  const ui = await mount(t, { owners }); await ui.open();
  await ui.selectOwner(owners[0].id); await ui.flush(() => ui.button('더 불러오기').click());
  const select = document.getElementById('ai-personal-credential-owner');
  assert.equal(select.value, owners[0].id); assert.equal(select.options.length, 22);
  assert.equal(select.options[1].textContent, `같은 이름 · ${owners[0].id}`);
  assert.equal(select.options[21].textContent, `이름 없음 · ${owners[20].id}`);
  assert.deepEqual(ui.ownerReads, [{ page: 1, pageSize: 20 }, { page: 2, pageSize: 20 }]);
});

test('worker plus optional own completion only grants explicitly selected configured spaces', async t => {
  const ui = await mount(t); await ui.open(); await ui.selectOwner();
  await ui.edit('ai-personal-credential-preset', 'worker');
  await ui.flush(() => document.getElementById('ai-personal-credential-chat').click());
  assert.equal(document.querySelector('form button[type="submit"]').disabled, true);
  assert.equal(document.getElementById('ai-personal-credential-space_space_2').disabled, true);
  await ui.flush(() => document.getElementById('ai-personal-credential-space_space_1').click());
  await ui.submit();
  const payload = ui.writes[0].args.p_input;
  assert.deepEqual(payload.scopes, ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update', 'chat:outbox:read', 'chat:send']);
  assert.deepEqual(payload.grant, {
    queues: ['employee_requests'], actions: ['read', 'claim', 'renew', 'progress', 'question', 'done'],
    spaceKeys: ['space_1'], purposes: ['ai_completion'],
  });
  assert.doesNotMatch(document.body.textContent, /기존 대화 답글|Bridge|domain|직원 전체 요청/);
});

test('duplicate submit dispatches once; definite failure preserves the selected draft', async t => {
  const ui = await mount(t); await ui.open(); await ui.selectOwner(); await ui.edit('ai-personal-credential-label', '보존할 이름');
  await ui.flush(() => {
    const form = document.querySelector('form');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(ui.writes.length, 1);
  await ui.flush(() => ui.writes[0].resolve(Response.json({ code: '42501', message: 'synthetic private failure' }, { status: 403 })));
  assert.equal(document.getElementById('ai-personal-credential-owner').value, ownerId);
  assert.equal(document.getElementById('ai-personal-credential-label').value, '보존할 이름');
  assert.match(document.body.textContent, /소유자 권한과 선택 항목/);
  assert.doesNotMatch(document.body.textContent, /synthetic private failure/);
  await ui.submit(); assert.notEqual(ui.writes[1].args.p_input.idempotencyKey, ui.writes[0].args.p_input.idempotencyKey);
});

for (const dismissal of ['Close', 'Escape']) {
  test(`${dismissal} suppresses a late first token and restores the issuer control focus`, async t => {
    const ui = await mount(t); await ui.open(); await ui.selectOwner(); await ui.submit();
    await ui.flush(() => dismissal === 'Close'
      ? document.querySelector('[data-slot="dialog-close"]').click()
      : document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await ui.flush(() => ui.writes[0].resolve(Response.json(issued))); await ui.flush();
    assert.equal(document.querySelector('input[aria-label="발급된 개인 요청 키"]'), null);
    assert.equal(document.activeElement, ui.button('개인 요청 키 발급'));
  });

  test(`first-token ${dismissal} clears the raw token and restores the issuer control focus`, async t => {
    const ui = await mount(t); await ui.open(); await ui.selectOwner(); await ui.submit();
    await ui.flush(() => ui.writes[0].resolve(Response.json(issued)));
    assert.equal(document.querySelector('input[aria-label="발급된 개인 요청 키"]').value, issued.token);
    await ui.flush(() => dismissal === 'Close' ? ui.button('닫기').click()
      : document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await ui.flush(); await ui.flush();
    assert.equal(document.querySelector('input[aria-label="발급된 개인 요청 키"]'), null);
    assert.equal(document.activeElement, ui.button('개인 요청 키 발급'));
  });
}

test('ambiguous issuance remount freezes original owner/payload/key even with a failed owner lookup', async t => {
  const ui = await mount(t); await ui.open(); await ui.selectOwner(); await ui.submit();
  const first = ui.writes[0]; await ui.flush(() => first.reject(new Error('synthetic lost response')));
  ui.failOwners(); await ui.remount(); await ui.open();
  const select = document.getElementById('ai-personal-credential-owner');
  assert.equal(select.value, ownerId); assert.equal(select.disabled, true); assert.equal(select.required, false);
  assert.equal(document.getElementById('ai-personal-credential-label').disabled, true);
  assert.equal(document.querySelector('form').checkValidity(), true, 'native required validation must not block receipt recovery');
  assert.equal(document.querySelector('form button[type="submit"]').disabled, false);
  await ui.submit(); assert.deepEqual(ui.writes[1].args, first.args);
  await ui.flush(() => ui.writes[1].resolve(Response.json({ ...issued, token: null })));
  assert.equal(document.querySelector('input[aria-label="발급된 개인 요청 키"]'), null);
  assert.match(document.body.textContent, /원문 키는 다시 표시할 수 없습니다/);
});

test('personal uncertainty never populates the central issuance attempt namespace', async t => {
  const ui = await mount(t, { integration: true });
  assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['연결 키', 'AI 요청 키', '개인 요청 키', '알림 공간']);
  await ui.flush(() => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === '개인 요청 키').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 })));
  assert.ok(ui.button('개인 요청 키 발급'), document.body.textContent);
  await ui.open(); await ui.selectOwner(); await ui.submit();
  await ui.flush(() => ui.writes[0].reject(new Error('synthetic uncertain')));
  assert.equal(ui.writes[0].args.p_action, 'create');
  assert.equal(ui.writes[0].args.p_input.ownerProfileId, ownerId);
  await ui.flush(() => document.querySelector('[data-slot="dialog-close"]').click());
  await ui.flush(() => [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'AI 요청 키').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 })));
  assert.ok(ui.button('AI 요청 키 발급'));
  assert.equal(ui.button('발급 결과 확인'), undefined);
  assert.match(document.body.textContent, /직원 전체 요청|발급한 AI 요청 키/);
  assert.equal(ui.writes.length, 1);
});

test('late list and issuance results after account/role changes cannot reveal old identities or raw keys', async t => {
  const ui = await mount(t); await ui.open(); await ui.selectOwner(); await ui.submit();
  await ui.switch({ role: 'viewer' }); await ui.flush(() => ui.writes[0].resolve(Response.json(issued)));
  assert.equal(document.querySelector('input[aria-label="발급된 개인 요청 키"]'), null);
  assert.doesNotMatch(document.body.textContent, /합성 교사|개인 요청 키를 발급했습니다/);
  await ui.switch({ role: 'admin', user: { id: issuerId, isFallbackRole: false } });
  ui.deferLists(); await ui.flush(() => ui.button('새로고침').click());
  assert.equal(ui.reads.length, 1);
  await ui.switch({ user: { id: '10000000-0000-4000-8000-000000000004', isFallbackRole: false } });
  await ui.flush(() => ui.reads[0].resolve(Response.json({ items: [listed], total: 1, supportEnabled: true })));
  assert.doesNotMatch(document.body.textContent, /합성 교사/);
});

test('revocation uncertainty retries the exact target/key and cancel makes no dispatch', async t => {
  const ui = await mount(t, { rows: [listed] }); await ui.flush(() => ui.button('폐기').click());
  await ui.flush(() => ui.button('취소').click()); assert.equal(ui.writes.length, 0);
  await ui.flush(() => ui.button('폐기').click());
  await ui.flush(() => document.querySelector('[role="alertdialog"] button[aria-label="개인 요청 키 폐기 폐기"]').click());
  assert.equal(ui.writes.length, 1); const first = ui.writes[0];
  await ui.flush(() => first.reject(new Error('synthetic uncertain revoke')));
  await ui.flush(() => ui.button('결과 확인').click());
  assert.deepEqual(ui.writes[1].args, first.args);
  await ui.flush(() => ui.writes[1].resolve(Response.json({ id: credentialId, revokedAt: '2026-10-05T00:00:00Z' })));
  assert.match(document.body.textContent, /개인 요청 키를 폐기했습니다/);
});
