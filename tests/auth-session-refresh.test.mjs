import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, useEffect, useState } from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repo = new URL("../", import.meta.url);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://test.invalid/admin/textbooks?tab=inventory", pretendToBeVisual: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const session = (id = "user-a", expires = 100, patch = {}) => ({
  user: { id, email: `${id}@example.invalid`, user_metadata: {}, ...patch },
  expires_at: expires, access_token: `synthetic-${id}-${expires}`,
});
const profile = (id = "user-a", role = "admin", patch = {}) => ({ id, role, name: id, ...patch });

// The provider, guard, coordinator and auth operations run unchanged. Only the
// Supabase transport and Next navigation boundary are deferred test dependencies.
function loadAuth(client, destinations) {
  const router = { replace: href => destinations.push(href) };
  const overrides = new Map([
    ["@/lib/supabase", { supabase: client, supabaseConfigError: null, fallbackAdminEmails: [], fallbackStaffEmails: [], fallbackTeacherEmails: [] }],
    ["next/navigation", { useRouter: () => router, usePathname: () => "/admin/textbooks", useSearchParams: () => new URLSearchParams("tab=inventory") }],
  ]);
  const cache = new Map();
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href).exports;
    const runtime = { exports: {} };
    cache.set(url.href, runtime);
    const code = ts.transpileModule(readFileSync(url, "utf8"), {
      fileName: url.pathname,
      compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const resolve = specifier => {
      if (overrides.has(specifier)) return overrides.get(specifier);
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const stem = specifier.startsWith("@/") ? new URL(`src/${specifier.slice(2)}`, repo) : new URL(specifier, url);
        const target = [stem, ...[".ts", ".tsx", ".js"].map(suffix => new URL(stem.href + suffix))].find(existsSync);
        assert.ok(target, `missing production import ${specifier}`);
        return load(target);
      }
      return require(specifier);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: url.pathname })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return { ...load(new URL("src/providers/auth-provider.tsx", repo)), ...load(new URL("src/components/auth/auth-guard.tsx", repo)) };
}

async function setup(t, { strict = false, initialPending = false } = {}) {
  const initial = Promise.withResolvers();
  const requests = [], listeners = new Set(), destinations = [];
  let getSessionCalls = 0, context, mounts = 0;
  const client = {
    auth: {
      getSession() { getSessionCalls += 1; return initial.promise; },
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
      signOut: async () => ({ error: null }),
    },
    from(table) {
      assert.equal(table, "profiles");
      const pending = Promise.withResolvers();
      const request = { ...pending, filters: [] };
      requests.push(request);
      const query = {
        select() { return query; }, eq(...args) { request.filters.push(args); return query; },
        or(...args) { request.filters.push(args); return query; }, order() { return query; }, limit() { return query; },
        abortSignal(signal) { request.signal = signal; return query; }, maybeSingle() { return query; },
        retry(value) { assert.equal(value, false); return pending.promise; },
      };
      return query;
    },
  };
  const { AuthProvider, AuthGuard, useAuth } = loadAuth(client, destinations);
  function Draft() {
    const [value, setValue] = useState("");
    useEffect(() => { mounts += 1; }, []);
    return createElement("input", { "aria-label": "작성 중인 메모", value, onChange: event => setValue(event.target.value) });
  }
  function Probe() { context = useAuth(); return createElement(AuthGuard, null, createElement(Draft)); }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
    container.remove();
  };
  t.after(unmount);
  if (!initialPending) initial.resolve({ data: { session: session() }, error: null });
  await act(async () => {
    root.render(createElement(strict ? StrictMode : "div", null, createElement(AuthProvider, null, createElement(Probe))));
  });
  // The provider intentionally installs its SDK callback outside the current task.
  await act(async () => { await delay(0); });
  assert.equal(listeners.size, 1);
  return {
    requests, destinations, container, unmount,
    get context() { return context; }, get mounts() { return mounts; }, get initialCalls() { return getSessionCalls; },
    input: () => container.querySelector("input"),
    initial: value => act(async () => initial.resolve({ data: { session: value }, error: null })),
    resolve: (index, data = profile()) => act(async () => requests[index].resolve({ data, error: null })),
    fail: index => act(async () => requests[index].resolve({ data: null, error: { message: "Failed to fetch" } })),
    emit: (event, next) => act(async () => {
      listeners.forEach(callback => callback(event, next));
      await delay(0);
    }),
    edit: value => act(async () => {
      const input = container.querySelector("input");
      assert.ok(input, "protected form must be mounted");
      input.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }),
  };
}

test("same-user token refresh preserves the actual input, focus and selection while updating session and profile", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("아직 저장하지 않은 상담 메모");
  const input = h.input();
  input.setSelectionRange(3, 6);
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  assert.equal(h.requests.length, 2, "refresh must still recheck authoritative profile permissions");
  assert.equal(h.context.session.access_token, "synthetic-user-a-200");
  assert.equal(h.context.user.id, "user-a");
  assert.equal(h.context.loading, false);
  assert.ok(h.input() === input, "normal credential refresh must not unmount the form");
  await h.resolve(1, profile("user-a", "admin", { name: "새 프로필 이름" }));
  assert.ok(h.input() === input, "the original input node stays mounted");
  assert.equal(input.value, "아직 저장하지 않은 상담 메모");
  assert.ok(document.activeElement === input, "input focus is preserved");
  assert.equal(input.selectionStart, 3);
  assert.equal(input.selectionEnd, 6);
  assert.equal(h.context.user.name, "새 프로필 이름");
  assert.equal(h.mounts, 1);
  assert.deepEqual(h.destinations, []);
});

test("same-user SIGNED_IN with renewed credentials preserves a draft and duplicate events share the profile read", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("입력 유지");
  const input = h.input();
  await h.emit("SIGNED_IN", session("user-a", 200));
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  assert.equal(h.requests.length, 2);
  assert.ok(h.input() === input, "the original input node stays mounted");
  await h.resolve(1);
  await h.emit("SIGNED_IN", session("user-a", 200));
  assert.equal(h.requests.length, 2);
  assert.equal(h.input().value, "입력 유지");
});

test("refresh before the first profile resolves keeps protected children closed and rejects the older response", async t => {
  const h = await setup(t);
  assert.equal(h.input(), null);
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  await h.resolve(0);
  assert.equal(h.input(), null);
  assert.equal(h.context.loading, true);
  await h.resolve(1, profile("user-a", "teacher"));
  assert.equal(h.context.role, "teacher");
  assert.equal(h.context.canManageAll, false);
  assert.equal(h.mounts, 1);
});

test("overlapping renewals cannot restore permissions from an older profile response", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("보존할 내용");
  const input = h.input();
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  await h.emit("TOKEN_REFRESHED", session("user-a", 300));
  await h.resolve(2, profile("user-a", "teacher"));
  await h.resolve(1, profile("user-a", "admin"));
  assert.equal(h.context.role, "teacher");
  assert.equal(h.context.canManageAll, false);
  assert.equal(h.context.session.expires_at, 300);
  assert.ok(h.input() === input, "the original input node stays mounted");
  assert.equal(h.input().value, "보존할 내용");
});

test("a different user immediately loses the old user's form while stale refresh work remains rejected", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("A 계정의 비공개 작성 내용");
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  await h.emit("SIGNED_IN", session("user-b", 200));
  assert.equal(h.input(), null);
  assert.equal(h.context.user, null);
  await h.resolve(1);
  assert.equal(h.input(), null);
  await h.resolve(2, profile("user-b", "staff"));
  assert.equal(h.context.user.id, "user-b");
  assert.equal(h.input().value, "");
});

test("logout rejects a pending refresh and logging into the same account requires a fresh profile", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("로그아웃 전 메모");
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  await h.emit("SIGNED_OUT", null);
  assert.equal(h.input(), null);
  assert.equal(h.context.session, null);
  assert.match(h.destinations.at(-1), /^\/sign-in\?next=/);
  await h.resolve(1);
  assert.equal(h.context.user, null);
  await h.emit("SIGNED_IN", session("user-a", 200));
  assert.equal(h.input(), null);
  assert.equal(h.requests.length, 3);
  await h.resolve(2);
  assert.equal(h.input().value, "");
});

test("a stale initial session cannot replace a newer signed-in account", async t => {
  const h = await setup(t, { initialPending: true });
  await h.emit("SIGNED_IN", session("user-b", 200));
  await h.resolve(0, profile("user-b", "staff"));
  await h.initial(session());
  assert.equal(h.context.user.id, "user-b");
  assert.equal(h.requests.length, 1);
});

test("USER_UPDATED still refreshes password and role rules and applies the assistant route restriction", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.edit("권한 변경 전 메모");
  const input = h.input();
  await h.emit("USER_UPDATED", session("user-a", 100, { user_metadata: { must_change_password: true } }));
  assert.ok(h.input() === input, "the original input node stays mounted");
  await h.resolve(1, profile("user-a", "assistant"));
  assert.equal(h.context.role, "assistant");
  assert.equal(h.context.mustChangePassword, true);
  assert.equal(h.context.canManageAll, false);
  assert.equal(h.input(), null);
  assert.equal(h.destinations.at(-1), "/admin/word-retests");
});

test("a failed profile recheck retains the existing fallback policy instead of preserving old write privileges", async t => {
  const h = await setup(t);
  await h.resolve(0);
  await h.emit("TOKEN_REFRESHED", session("user-a", 200, { user_metadata: { role: "admin" } }));
  await h.fail(1);
  assert.equal(h.context.role, "viewer");
  assert.equal(h.context.canManageAll, false);
  assert.equal(h.context.user.isFallbackRole, true);
  assert.match(h.context.authError, /프로필을 불러오지 못해/);
});

test("React strict-effect replay shares initialization and does not remount children on renewal", async t => {
  const h = await setup(t, { strict: true });
  await h.resolve(0);
  await h.edit("strict 갱신 메모");
  const input = h.input(), mounts = h.mounts;
  assert.equal(h.initialCalls, 1);
  await h.emit("TOKEN_REFRESHED", session("user-a", 200));
  await h.resolve(1);
  assert.ok(h.input() === input, "the original input node stays mounted");
  assert.equal(h.input().value, "strict 갱신 메모");
  assert.equal(h.mounts, mounts);
});
