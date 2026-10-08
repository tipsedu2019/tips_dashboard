import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const actor = { userId: '10000000-0000-4000-8000-000000000001', role: 'admin' };

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/students' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  let role = 'admin';
  let session = { user: { id: actor.userId, email: 'fixture@example.invalid', user_metadata: {} }, access_token: 'fixture', expires_at: 2000000000 };
  let authCallback;
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(callback) {
        authCallback = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from() {
      const query = { retry: async () => ({ data: { id: session.user.id, name: '합성 사용자', role }, error: null }) };
      for (const method of ['select', 'eq', 'abortSignal', 'maybeSingle']) query[method] = () => query;
      return query;
    },
  };
  const recovery = loadNotificationComponent('src/features/ai-agent/ai-agent-request-recovery.ts');
  const { AuthProvider, useAuth } = loadNotificationComponent('src/providers/auth-provider.tsx', new Map([
    ['@/features/ai-agent/ai-agent-request-recovery', recovery],
    ['@/lib/supabase', { supabase: client, fallbackAdminEmails: [], fallbackStaffEmails: [], fallbackTeacherEmails: [], supabaseConfigError: null }],
  ]));
  function OtherRoute() {
    const auth = useAuth();
    return createElement('p', null, `${auth.user?.id ?? 'anonymous'}:${auth.role}:${auth.loading}`);
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const flush = async callback => act(async () => {
    callback?.();
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  await flush(() => root.render(createElement(AuthProvider, null, createElement(OtherRoute))));
  t.after(async () => { await flush(() => root.unmount()); dom.window.close(); });
  for(let turn=0;turn<8&&(typeof authCallback!=='function'||!document.body.textContent.includes('admin:false'));turn++)await flush();
  assert.match(document.body.textContent, /admin:false/);
  assert.equal(typeof authCallback, 'function');
  return {
    recovery, flush,
    update: async (event, nextRole = role, nextSession = session) => {
      role = nextRole;
      session = nextSession;
      await flush(() => authCallback(event, session));
    },
    session: () => session,
  };
}

function seed(recovery) {
  for (const scope of ['create', 'request:request-id:question-id', 'policy:target-id']) {
    recovery.writeAiRequestDraft(actor, scope, `departing-${scope}`);
  }
}

function assertEmpty(recovery) {
  for (const scope of ['create', 'request:request-id:question-id', 'policy:target-id']) {
    assert.equal(recovery.readAiRequestDraft(actor, scope), undefined, scope);
  }
}

test('real AuthProvider discards departed authorization drafts and intents while AI feature is unmounted', async t => {
  const ui = await mount(t);
  seed(ui.recovery);
  const first = ui.recovery.getAiRequestAttempt(actor, 'create');
  await assert.rejects(first.submit({ title: 'uncertain' }, async () => { throw new Error('lost receipt'); }));
  const key = first.pending.key;
  await ui.update('USER_UPDATED', 'viewer');
  assertEmpty(ui.recovery);
  await ui.update('USER_UPDATED', 'admin');
  assertEmpty(ui.recovery);
  const second = ui.recovery.getAiRequestAttempt(actor, 'create');
  assert.equal(second.pending, null);
  await second.submit({ title: 'new' }, async (_, nextKey) => assert.notEqual(nextKey, key));
});

test('real AuthProvider preserves token refresh but clears account and anonymous session transitions off-route', async t => {
  const ui = await mount(t);
  seed(ui.recovery);
  const oldSession = ui.session();
  await ui.update('TOKEN_REFRESHED', 'admin', { ...oldSession, access_token: 'renewed', expires_at: 2000000100 });
  assert.equal(ui.recovery.readAiRequestDraft(actor, 'create'), 'departing-create');
  await ui.update('SIGNED_IN', 'admin', { ...oldSession, user: { ...oldSession.user, id: '10000000-0000-4000-8000-000000000002' } });
  assertEmpty(ui.recovery);
  await ui.update('SIGNED_IN', 'admin', oldSession);
  assertEmpty(ui.recovery);
  seed(ui.recovery);
  await ui.update('SIGNED_OUT', 'admin', null);
  assertEmpty(ui.recovery);
  await ui.update('SIGNED_IN', 'admin', oldSession);
  assertEmpty(ui.recovery);
});
