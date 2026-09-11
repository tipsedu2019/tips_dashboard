import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const row = {
  subject: "영어", isActive: true, registrationCreateEnabled: true,
  gradeLevels: ["중1", "중2"], defaultDirectorProfileId: null,
};

async function mount({ isAdmin = true, strict = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/settings/subjects" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  for (const key of ["HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "DOMRect", "getComputedStyle"]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const requests = [], writes = [];
  let teacherReads = 0;
  const service = {
    list() { const request = Promise.withResolvers(); requests.push(request); return request.promise; },
    update(payload) { const write = { ...Promise.withResolvers(), payload }; writes.push(write); return write.promise; },
  };
  const Component = loadNotificationComponent("src/features/management/subject-master-workspace.tsx", new Map([
    ["./academic-subject-settings-service", { academicSubjectSettingsService: service }],
    ["./management-service.js", { managementService: { listTeacherAccountSettingsData: async () => { teacherReads += 1; return { teachers: [] }; } } }],
    // Navigation is exercised with the real shared hook in settings-draft-navigation.test.mjs.
    ["@/hooks/use-draft-navigation", { useDraftNavigation: () => ({ confirmation: null, requestNavigation: (intent) => intent() }) }],
    ["@/providers/auth-provider", { useAuth: () => ({ isAdmin }) }],
  ])).SubjectMasterWorkspace;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(strict ? createElement(StrictMode, null, createElement(Component)) : createElement(Component)); });
  const flush = async (callback) => { await act(async () => { callback?.(); await Promise.resolve(); }); };
  const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === text);
  const active = () => document.querySelector('[data-subject-key="english"] button[role="checkbox"]');
  return { requests, writes, flush, button, active, teacherReads: () => teacherReads, async close() { await act(async () => root.unmount()); dom.window.close(); } };
}

test("subject: repeated save clicks commit once and keep every editor disabled until acceptance", async () => {
  const ui = await mount();
  try {
    await ui.flush(() => ui.requests[0].resolve([row]));
    await ui.flush(() => ui.active().click());
    await ui.flush(() => { const save = ui.button("저장"); save.click(); save.click(); });
    assert.equal(ui.writes.length, 1, "same-turn clicks must submit one request");
    assert.equal(ui.writes[0].payload.isActive, false);
    assert.equal(ui.active().disabled, true);
    await ui.flush(() => ui.active().click());
    await ui.flush(() => ui.writes[0].resolve({ ...row, isActive: false }));
    assert.equal(ui.active().getAttribute("aria-checked"), "false");
    assert.equal(ui.active().disabled, false);
    assert.equal(ui.requests.length, 1, "the returned result is accepted without another list read");
    assert.ok(document.querySelector('[data-slot="action-feedback"] [role="status"]'));
  } finally { await ui.close(); }
});

test("subject: a rejected save keeps the draft and exposes recoverable action feedback", async () => {
  const ui = await mount();
  try {
    await ui.flush(() => ui.requests[0].resolve([row]));
    await ui.flush(() => ui.active().click());
    await ui.flush(() => ui.button("저장").click());
    await ui.flush(() => ui.writes[0].reject(new Error("write rejected")));
    assert.equal(ui.active().getAttribute("aria-checked"), "false");
    assert.equal(ui.active().disabled, false);
    assert.ok(document.querySelector('[data-slot="action-feedback"] [role="alert"]'));
    assert.ok(!document.body.textContent.includes("write rejected"), "internal exceptions must not be shown in the editor");
    await ui.flush(() => document.querySelector('[aria-label="처리 결과 닫기"]').click());
    assert.ok(document.activeElement === ui.button("저장"));
    await ui.flush(() => ui.button("저장").click());
    assert.equal(ui.writes.length, 2);
    assert.equal(ui.writes[1].payload.isActive, false);
    await ui.flush(() => ui.writes[1].resolve({ ...row, isActive: false }));
    assert.equal(ui.requests.length, 1);
  } finally { await ui.close(); }
});

test("subject: initial read failure can be retried without duplicate strict-mode reads or writes", async () => {
  const ui = await mount({ strict: true });
  try {
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.teacherReads(), 1);
    await ui.flush(() => ui.requests[0].reject(new Error("read offline")));
    assert.ok(ui.button("다시 불러오기"), "a failed initial read needs a recovery action");
    await ui.flush(() => { const retry = ui.button("다시 불러오기"); retry.click(); retry.click(); });
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.teacherReads(), 2);
    await ui.flush(() => ui.requests[1].resolve([row]));
    assert.equal(ui.active().getAttribute("aria-checked"), "true");
    assert.equal(ui.button("다시 불러오기"), undefined);
    assert.ok(document.activeElement === ui.button("저장"));
    assert.equal(ui.writes.length, 0);
  } finally { await ui.close(); }
});

test("subject: read-only roles retain disabled settings and no save action", async () => {
  const ui = await mount({ isAdmin: false });
  try {
    await ui.flush(() => ui.requests[0].resolve([row]));
    assert.equal(ui.active().disabled, true);
    assert.equal(ui.button("저장"), undefined);
    await ui.flush(() => ui.active().click());
    assert.equal(ui.writes.length, 0);
  } finally { await ui.close(); }
});

test("subject: a read retry stays mounted and focused when the next read also fails", async () => {
  const ui = await mount();
  try {
    await ui.flush(() => ui.requests[0].reject(new Error("read offline")));
    const retry = ui.button("다시 불러오기");
    await ui.flush(() => { retry.focus(); retry.click(); });
    assert.ok(ui.button("다시 불러오기") === retry);
    assert.equal(retry.disabled, true);
    await ui.flush(() => ui.requests[1].reject(new Error("still offline")));
    assert.ok(ui.button("다시 불러오기") === retry);
    assert.equal(retry.disabled, false);
    assert.ok(document.activeElement === retry);
  } finally { await ui.close(); }
});
