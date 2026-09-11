import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";
import { requestAppNavigation } from "../src/lib/guarded-navigation.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://test.invalid/admin/tasks", pretendToBeVisual: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

async function mount(t, Component, props) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const unmount = async () => { if (!mounted) return; await act(async () => root.unmount()); host.remove(); mounted = false; };
  t.after(unmount);
  await act(async () => root.render(createElement(Component, props)));
  return { unmount, render: next => act(async () => root.render(createElement(Component, next))) };
}
async function click(label) {
  const button = [...document.querySelectorAll("button")].findLast(node => node.textContent.trim() === label || node.getAttribute("aria-label") === label);
  assert.ok(button, `missing ${label}; buttons=${[...document.querySelectorAll("button")].map(e => e.textContent.trim()).join("|")}`);
  assert.equal(button.disabled, false, `${label} enabled`);
  await act(async () => button.click());
  return button;
}
async function edit(input, value) {
  assert.ok(input, "editable input exists");
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function request(destinations, name) { await act(async () => requestAppNavigation(() => destinations.push(name))); }
function unloadBlocked() {
  return !window.dispatchEvent(new window.Event("beforeunload", { cancelable: true }));
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(predicate(), "asynchronous history cleanup completed");
}

async function opsWorkspace(t) {
  window.history.replaceState(null, "", "/admin/tasks");
  const requests = [];
  const supabase = {
    rpc(name, args) {
      const pending = Promise.withResolvers();
      const request = { name, args, ...pending }; requests.push(request);
      return { abortSignal(signal) { request.signal = signal; return this; }, retry() { return pending.promise; } };
    },
    from() {
      const query = new Proxy({}, { get(_target, key) {
        if (key === "then") return Promise.resolve({ data: [], error: null }).then.bind(Promise.resolve({ data: [], error: null }));
        return () => query;
      } });
      return query;
    },
  };
  const router = { replace(url) { window.history.replaceState(null, "", url); }, push(url) { window.history.pushState(null, "", url); } };
  let previous = "", params = new URLSearchParams();
  const { OpsTaskWorkspace } = loadNotificationComponent("src/features/tasks/ops-task-workspace.tsx", new Map([
    ["@/lib/supabase", { supabase }],
    ["@/providers/auth-provider", { useAuth: () => ({ user: { id: "actor-a", role: "staff", name: "Actor" }, role: "staff", loading: false, session: null, canManageAll: true, isAdmin: false, isStaff: true, isTeacher: false, isAssistant: false }) }],
    ["next/navigation", { useRouter: () => router, usePathname: () => window.location.pathname, useSearchParams: () => {
      if (previous !== window.location.search) { previous = window.location.search; params = new URLSearchParams(previous); }
      return params;
    } }],
  ]));
  const mounted = await mount(t, OpsTaskWorkspace, { workspace: "todo" });
  await act(async () => {
    for (const request of requests) if (request.name === "list_ops_task_numbered_page_v1") request.resolve({ error: null, data: { page: 1, pageSize: 10, totalCount: 0, rows: [] } });
  });
  return { ...mounted, requests };
}

test("task editor draft routes app navigation through its existing cancel and discard exactly once", async t => {
  const ui = await opsWorkspace(t);
  const destinations = [];
  await request(destinations, "clean");
  await click("추가");
  const input = document.querySelector('[role="dialog"] input');
  await edit(input, "이동 전 미저장 업무");
  assert.equal(unloadBlocked(), true);
  await request(destinations, "cancelled");
  assert.deepEqual(destinations, ["clean"]);
  await click("계속 편집");
  assert.equal(input.value, "이동 전 미저장 업무");
  assert.equal(unloadBlocked(), true, "cancelling route navigation keeps refresh protection");
  await request(destinations, "confirmed");
  await request(destinations, "must-not-replace-first");
  const discard = await click("변경사항 버리기");
  await act(async () => discard.click());
  await waitFor(() => destinations.includes("confirmed"));
  assert.deepEqual(destinations, ["clean", "confirmed"]);
  assert.equal(Boolean(document.querySelector('[role="dialog"]')), false, document.querySelector('[role="dialog"]')?.textContent?.slice(0, 500));
  assert.equal(unloadBlocked(), false);
  await ui.unmount();
  await request(destinations, "unmounted");
  assert.deepEqual(destinations, ["clean", "confirmed", "unmounted"]);
});

test("cancelling task app navigation leaves the ordinary close confirmation independent", async t => {
  await opsWorkspace(t);
  const destinations = [];
  await click("추가");
  await edit(document.querySelector('[role="dialog"] input'), "일반 닫기 초안");
  await request(destinations, "cancelled-route");
  await click("계속 편집");
  await click("닫기");
  await request(destinations, "must-not-replace-close");
  await click("계속 편집");
  assert.equal(document.querySelector('[role="dialog"] input').value, "일반 닫기 초안");
  await click("닫기");
  await click("변경사항 버리기");
  assert.deepEqual(destinations, []);
  assert.equal(unloadBlocked(), false);
});

function snapshot() {
  return {
    scopeKey: "global", workflowKey: "transfer", loadedAt: "2026-09-11T00:00:00Z",
    rules: [{ id: "rule-1", workflowKey: "transfer", eventKey: "transfer.processing_started", eventLabel: "검수 알림", groupLabel: "알림", sortOrder: 1,
      audienceKey: "management_team", audienceLabel: "관리팀", channelKey: "google_chat", channelLabel: "Google Chat", connectionKey: "google_chat.management", ruleVariantKey: "immediate", deliveryMode: "immediate", scheduleKey: null, scheduleConfig: null,
      enabled: true, configurationKind: "editable_rule", activationLocked: false, revision: "1", updatedAt: null,
      contentContract: { contractVersion: "1", availableVariables: [], requiredTokens: [], optionalLineTokens: [], mustHaveFacts: [], supportedPayloadVersions: [1], destinationPolicy: { allowedConnectionKeys: ["google_chat.management"], subjectScoped: false }, freeTextVisibility: {}, freeTextPriority: [], fieldPresence: {} },
      templateCompliance: { contractVersion: "1", compliance: "conformant", violations: [] }, template: { id: "template-1", ruleId: "rule-1", version: "1", titleTemplate: "검수 제목", bodyTemplate: "검수 내용", allowedVariables: [], payloadSchemaVersion: 1, contentContractVersion: "1", checksum: "fixture" },
    }],
    connections: [{ connectionKey: "google_chat.management", connectionState: "encrypted_active", revision: "1", lastVerifiedAt: null, lastErrorCode: null, editable: true }],
    deliverySummary: { pendingCount: 0, sentCount: 0, failedCount: 0, unknownCount: 0, latestDeliveryAt: null },
  };
}
async function notificationPanel(t, props = { workflowKey: "transfer", presentation: "page" }, save = async () => { throw new Error("unexpected save"); }) {
  window.history.replaceState({ __NA: true }, "", "/admin/settings/notifications");
  const saves = [];
  const { NotificationControlPanel } = loadNotificationComponent("src/features/notifications/notification-control-panel.tsx", new Map([
    ["./notification-control-plane-service", { NotificationControlPlaneHttpError: class extends Error {}, createNotificationControlPlaneService: () => ({ getControlPlane: async () => snapshot(), saveControlPlane: async input => { saves.push(input); return save(input); } }) }],
    ["./notification-mention-settings-service", { NotificationMentionSettingsHttpError: class extends Error {}, createNotificationMentionSettingsService: () => ({ getMentionSettings: async () => [] }) }],
  ]));
  return { ...(await mount(t, NotificationControlPanel, props)), saves };
}

test("notification draft uses existing continue and discard UI for app navigation after sentinel cleanup", async t => {
  const ui = await notificationPanel(t);
  const destinations = [];
  await request(destinations, "clean");
  const toggle = document.querySelector('[data-notification-rule-switch="rule-1"]');
  assert.ok(toggle);
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal(unloadBlocked(), true);
  await request(destinations, "cancelled");
  assert.deepEqual(destinations, ["clean"]);
  await click("계속 편집");
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  await request(destinations, "confirmed");
  await request(destinations, "must-not-replace-first");
  const discard = await click("변경사항 버리기");
  await act(async () => discard.click());
  await waitFor(() => destinations.length === 2);
  assert.deepEqual(destinations, ["clean", "confirmed"]);
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal(unloadBlocked(), false);
  assert.equal(ui.saves.length, 0);
  await ui.unmount();
  await request(destinations, "unmounted");
  assert.deepEqual(destinations, ["clean", "confirmed", "unmounted"]);
});

test("notification app intent waits through failed save and retry, and resumes only its approved destination", async t => {
  const pending = [];
  const ui = await notificationPanel(t, undefined, () => {
    const request = Promise.withResolvers(); pending.push(request); return request.promise;
  });
  const destinations = [];
  const toggle = document.querySelector('[data-notification-rule-switch="rule-1"]');
  await act(async () => toggle.click());
  await request(destinations, "approved-after-save");
  await click("저장하고 이동");
  assert.equal(ui.saves.length, 1);
  await request(destinations, "ignore-while-saving");
  const confirmButtons = ["계속 편집", "변경사항 버리기", "저장하고 이동"].map(label => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === label));
  assert.ok(confirmButtons.every(button => button?.disabled));
  assert.deepEqual(destinations, []);
  await act(async () => pending[0].reject(new Error("offline")));
  assert.match(document.querySelector('[role="dialog"] [role="alert"]')?.textContent || "", /설정을 저장하지 못했습니다/);
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.deepEqual(destinations, []);
  await click("저장하고 이동");
  assert.equal(ui.saves.length, 2);
  const saved = snapshot(); saved.rules[0].enabled = false;
  await act(async () => pending[1].resolve(saved));
  await waitFor(() => destinations.length === 1);
  assert.deepEqual(destinations, ["approved-after-save"]);
  assert.equal(unloadBlocked(), false);
});

test("hidden notification panel does not consume another editor's app navigation", async t => {
  const props = { workflowKey: "transfer", presentation: "dialog", open: true };
  const ui = await notificationPanel(t, props);
  const destinations = [];
  await act(async () => document.querySelector('[data-notification-rule-switch="rule-1"]').click());
  await ui.render({ ...props, open: false });
  await request(destinations, "visible-editor-route");
  assert.deepEqual(destinations, ["visible-editor-route"]);
  await ui.render(props);
  await waitFor(() => !window.history.state?.notificationSettingsGuard && !unloadBlocked());
  assert.equal(ui.saves.length, 0);
});

test("notification save confirmation ignores same-tick duplicate and competing decisions", async t => {
  const pending = Promise.withResolvers();
  const ui = await notificationPanel(t, undefined, () => pending.promise);
  const destinations = [];
  await act(async () => document.querySelector('[data-notification-rule-switch="rule-1"]').click());
  await request(destinations, "saved-route");
  const button = label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  const save = button("저장하고 이동");
  const discard = button("변경사항 버리기");
  const cancel = button("계속 편집");
  await act(async () => { save.click(); save.click(); discard.click(); cancel.click(); });
  assert.equal(ui.saves.length, 1);
  assert.deepEqual(destinations, []);
  const saved = snapshot(); saved.rules[0].enabled = false;
  await act(async () => pending.resolve(saved));
  await waitFor(() => destinations.length === 1);
  assert.deepEqual(destinations, ["saved-route"]);
});

test("notification Back cancellation retains its existing sentinel and allows a later app route", async t => {
  await notificationPanel(t);
  const events = [];
  const pop = () => events.push(window.history.state);
  window.addEventListener("popstate", pop);
  t.after(() => window.removeEventListener("popstate", pop));
  const destinations = [];
  await act(async () => document.querySelector('[data-notification-rule-switch="rule-1"]').click());
  await act(async () => window.history.back());
  await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes("저장하지 않은 변경사항이 있습니다"));
  await waitFor(() => events.length >= 2 && window.history.state?.notificationSettingsGuard === true);
  await request(destinations, "must-not-replace-back");
  await click("계속 편집");
  assert.deepEqual(destinations, []);
  assert.equal(document.querySelector('[data-notification-rule-switch="rule-1"]').getAttribute("aria-checked"), "false");
  assert.equal(unloadBlocked(), true);
  await request(destinations, "later-app-route");
  await click("변경사항 버리기");
  await waitFor(() => destinations.length === 1);
  assert.deepEqual(destinations, ["later-app-route"]);
});

test("unapplied notification template protects app navigation and its local close", async t => {
  await notificationPanel(t); const destinations = [];
  await click("내용 수정"); const input = document.querySelector('#notification-title-rule-1'); await edit(input, "아직 반영하지 않은 새 제목");
  await request(destinations, "template-route"); assert.deepEqual(destinations, []); await click("계속 편집"); assert.equal(input.value, "아직 반영하지 않은 새 제목");
  await click("취소"); assert.ok(document.querySelector('#notification-title-rule-1')); await click("계속 편집"); assert.equal(input.value, "아직 반영하지 않은 새 제목");
  await click("취소"); await click("변경사항 버리기"); assert.equal(document.querySelector('#notification-title-rule-1'), null); assert.equal(unloadBlocked(), false);
});

test("discarding a local notification template preserves other staged settings and Back protection", async t => {
  await notificationPanel(t); const destinations = [];
  const toggle = document.querySelector('[data-notification-rule-switch="rule-1"]'); await act(async () => toggle.click());
  await click("내용 수정"); await edit(document.querySelector('#notification-title-rule-1'), "반영 전 제목");
  await click("취소"); await click("변경사항 버리기");
  assert.equal(toggle.getAttribute("aria-checked"), "false"); assert.equal(unloadBlocked(), true);
  await request(destinations, "parent-route"); assert.deepEqual(destinations, []); await click("계속 편집");
  await click("내용 수정"); assert.equal(document.querySelector('#notification-title-rule-1').value, "검수 제목");
  await edit(document.querySelector('#notification-title-rule-1'), "반영할 제목"); await click("변경사항에 반영"); assert.equal(document.querySelector('#notification-title-rule-1'), null);
  await request(destinations, "staged-route"); assert.deepEqual(destinations, []); assert.ok([...document.querySelectorAll('button')].find(button => button.textContent.trim() === "저장하고 이동"));
});

test("unsubmitted webhook input protects local close and app navigation without invoking the provider boundary", async t => {
  const ui = await notificationPanel(t); const destinations = [];
  await click("수신 채팅방"); const input = document.getElementById('connection-google_chat.management'); await edit(input, "https://example.invalid/synthetic-no-send");
  await request(destinations, "connection-route"); assert.deepEqual(destinations, []); assert.equal(ui.saves.length, 0); await click("계속 편집"); assert.match(input.value, /synthetic-no-send/);
  await click("수신 채팅방 닫기"); await click("계속 편집"); assert.match(input.value, /synthetic-no-send/);
  await edit(input, ""); await click("수신 채팅방 닫기"); await waitFor(() => !document.getElementById('connection-google_chat.management')); assert.equal(Boolean(document.getElementById('connection-google_chat.management')), false); assert.equal(unloadBlocked(), false);
});


test("template selection stays clean, same-tick title and body edits remain isolated, and reverting both removes its guard", async t => {
  const ui = await notificationPanel(t); const destinations = [];
  await click("내용 수정"); const title = document.querySelector('#notification-title-rule-1'), body = document.querySelector('#notification-body-rule-1');
  await request(destinations, "clean-selection"); assert.deepEqual(destinations, ["clean-selection"]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(title, "동시 제목"); title.dispatchEvent(new window.Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(body, "동시 본문"); body.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.equal(title.value, "동시 제목"); assert.equal(body.value, "동시 본문"); await edit(title, "검수 제목");
  await request(destinations, "body-still-dirty"); assert.deepEqual(destinations, ["clean-selection"]); await click("계속 편집");
  await edit(body, "검수 내용"); await click("취소"); await waitFor(() => !document.querySelector('#notification-title-rule-1'));
  assert.equal(unloadBlocked(), false); assert.equal(ui.saves.length, 0);
});

test("a clean notification draft queues app navigation until its pending sentinel cleanup completes", async t => {
  await notificationPanel(t); const destinations = [], originalBack = window.history.back.bind(window.history); let cleanups = 0;
  window.history.back = () => { cleanups++; }; t.after(() => { window.history.back = originalBack; });
  const toggle = document.querySelector('[data-notification-rule-switch="rule-1"]');
  await act(async () => toggle.click()); await act(async () => toggle.click()); assert.equal(cleanups, 1);
  await act(async () => requestAppNavigation(() => { destinations.push("classes"); window.history.pushState({ __NA: true }, "", "/admin/classes"); }));
  assert.deepEqual(destinations, [], "clean history retirement finishes before route publication");
  await act(async () => { originalBack(); await new Promise(resolve => setTimeout(resolve, 15)); });
  assert.deepEqual(destinations, ["classes"]); assert.equal(window.location.pathname, "/admin/classes");
});

test("a clean notification guard prepares an already-intercepted app intent without bypassing another editor", async t => {
  let approved;
  const intercept = event => { event.preventDefault(); approved = event.detail.intent; };
  window.addEventListener("tips:request-navigation", intercept); t.after(() => window.removeEventListener("tips:request-navigation", intercept));
  await notificationPanel(t); const destinations = [], originalBack = window.history.back.bind(window.history);
  window.history.back = () => {}; t.after(() => { window.history.back = originalBack; });
  const toggle = document.querySelector('[data-notification-rule-switch="rule-1"]');
  await act(async () => toggle.click()); await act(async () => toggle.click());
  await act(async () => requestAppNavigation(() => { destinations.push("classes"); window.history.pushState({ __NA: true }, "", "/admin/classes"); }));
  assert.deepEqual(destinations, []); assert.equal(typeof approved, "function");
  await act(async () => approved()); assert.deepEqual(destinations, []);
  await act(async () => { originalBack(); await new Promise(resolve => setTimeout(resolve, 15)); });
  assert.deepEqual(destinations, ["classes"]); assert.equal(window.location.pathname, "/admin/classes");
});
