import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { loadNotificationComponent } from './notification-component-loader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
export async function mountApiSettings(t, options = {}) {
 const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/admin/settings/agent-access' });
 globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
 for (const key of ['HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','NodeFilter','DOMRect','getComputedStyle']) globalThis[key] = dom.window[key];
 globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
 globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
 globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
 window.HTMLElement.prototype.scrollIntoView = () => {};
 window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 32, height: 32 }]; };
 let auth = { user: { id: '10000000-0000-4000-8000-000000000001', isFallbackRole: false }, role: 'admin', loading: false, ...options.auth };
 const rpcCalls = [], fetchCalls = [], previousFetch = globalThis.fetch;
 globalThis.fetch = async (...args) => { fetchCalls.push(args); throw new Error('unexpected HTTP request'); };
 const { AgentAccessWorkspace } = loadNotificationComponent('src/features/agent-api/agent-access-workspace.tsx', new Map([
  ['@/providers/auth-provider', { useAuth: () => auth }],
  ['@/lib/supabase', { supabase: { rpc(name, args) {
   rpcCalls.push({ name, args });
   const result = Promise.resolve(options.response ?? { data: { items: [], total: 0 }, error: null });
   result.abortSignal = () => result; result.retry = () => result; return result;
  } } }],
  ['next/link', props => { const { href, children, ...rest } = props; delete rest.prefetch; return createElement('a', { href, ...rest }, children); }],
  ['@/lib/guarded-navigation', { requestAppNavigation: callback => callback() }],
  ['@/hooks/use-data-table-page-size', { useDataTablePageSize: () => ({ pageSize: 10, ready: true, setPreference() {} }) }],
 ]));
 const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
 const flush = async callback => act(async () => { callback?.(); await new Promise(resolve => setTimeout(resolve, 20)); });
 const render = () => root.render(createElement(AgentAccessWorkspace, { apiEnabled: options.apiEnabled ?? true }));
 await flush(render);
 t.after(async () => { await flush(() => root.unmount()); globalThis.fetch = previousFetch; dom.window.close(); });
 const button = name => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === name);
 return { rpcCalls, fetchCalls, flush, button, async switch(next) { auth = { ...auth, ...next }; await flush(render); }, async tab(name) { await flush(() => { button(name).focus(); button(name).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); } };
}
