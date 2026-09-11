import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cases = [
  { kind: "school", component: "SchoolMasterWorkspace", table: "academic_schools", add: "학교 추가", field: "school-name", upsert: "upsertAcademicSchools", remove: "deleteAcademicSchools", row: { id: "school-1", name: "기존학교", category: "elementary", color: null, sort_order: 1 } },
  { kind: "classroom", component: "ClassroomMasterWorkspace", table: "classroom_catalogs", add: "강의실 추가", field: "classroom-name", upsert: "upsertClassroomCatalogs", remove: "deleteClassroomCatalogs", row: { id: "room-1", name: "기존강의실", subjects: ["영어"], campus: "본관", is_visible: true, sort_order: 1 } },
  { kind: "class-group", component: "ClassGroupMasterWorkspace", table: "class_schedule_sync_groups", add: "그룹 추가", field: "class-group-name", upsert: "upsertClassGroups", remove: "deleteClassGroup", row: { id: "group-1", name: "기존그룹", subject: "영어", sort_order: 1, is_default: false } },
  { kind: "teacher", component: "TeacherMasterWorkspace", add: "선생님 추가", field: "teacher-name", upsert: "upsertTeacherCatalogs", remove: "deleteTeacherCatalogs", row: { id: "teacher-1", name: "기존선생님", subjects: ["영어팀"], profile_id: null, account_email: "", dashboard_role: "teacher", is_visible: true, sort_order: 1 } },
];

async function mount(spec) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/settings" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  for (const key of ["HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "DOMRect", "getComputedStyle"]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const requests = [], writes = [];
  const supabase = { from(table) {
    assert.equal(table, spec.table);
    const deferred = Promise.withResolvers();
    requests.push(deferred);
    const query = { then: deferred.promise.then.bind(deferred.promise) };
    for (const method of ["select", "order", "or", "limit", "abortSignal", "retry"]) query[method] = () => query;
    return query;
  } };
  const managementService = { [spec.upsert](payload) { const write = { ...Promise.withResolvers(), payload }; writes.push(write); return write.promise; }, [spec.remove]: async () => {} };
  managementService.listTeacherAccountSettingsData = () => {
    const deferred = Promise.withResolvers();
    requests.push(deferred);
    return deferred.promise.then(({ data, error }) => {
      if (error) throw error;
      return { teachers: data, profiles: [], auditLogs: [], isAccountSchemaReady: true };
    });
  };
  const overrides = new Map([
    ["@/lib/supabase", { supabase }],
    ["./management-service.js", { managementService, createId: () => "new-record", filterClassroomCatalogRowsForSubject: (rows) => rows }],
    ["./settings-table-columns", { useSettingsTableColumns: () => ({ isColumnVisible: () => true, visibleColumnCount: 4, columnSettingsControl: null }) }],
    // Navigation is exercised with the real shared hook in settings-draft-navigation.test.mjs.
    ["@/hooks/use-draft-navigation", { useDraftNavigation: () => ({ confirmation: null, requestNavigation: (intent) => intent() }) }],
    ["@/providers/auth-provider", { useAuth: () => ({ session: null, user: { id: "settings-test-actor", role: "staff" }, canManageAll: true, isTeacher: false }) }],
    ["./teacher-google-chat-identity-panel", { TeacherGoogleChatIdentityPanel: () => null }],
  ]);
  const component = loadNotificationComponent(`src/features/management/${spec.kind}-master-workspace.tsx`, overrides)[spec.component];
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(createElement(component)); });
  const flush = async (callback) => { await act(async () => { callback?.(); await Promise.resolve(); }); };
  const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === text);
  const name = () => document.querySelector(`input[name="${spec.field}"]`);
  const changeName = (value) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(name(), value);
    name().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    name().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  const edit = (value) => flush(() => changeName(value));
  return { requests, writes, flush, button, name, edit, changeName, async close() { await act(async () => root.unmount()); dom.window.close(); } };
}

test("teacher: account refresh and window focus preserve an unsaved draft", async () => {
  const spec = cases.find((item) => item.kind === "teacher");
  const ui = await mount(spec);
  try {
    await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
    await ui.edit("아직 저장하지 않은 이름");
    assert.equal(ui.button("계정 새로고침").disabled, true);
    await ui.flush(() => {
      ui.button("계정 새로고침").click();
      window.dispatchEvent(new window.Event("focus"));
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    assert.equal(ui.requests.length, 1, "refresh may not overwrite the current draft");
    assert.equal(ui.name().value, "아직 저장하지 않은 이름");
  } finally { await ui.close(); }
});

test("teacher: focus refresh retains accepted rows and deduplicates parallel focus events", async () => {
  const spec = cases.find((item) => item.kind === "teacher");
  const ui = await mount(spec);
  try {
    await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
    await ui.flush(() => {
      window.dispatchEvent(new window.Event("focus"));
      window.dispatchEvent(new window.Event("focus"));
    });
    assert.equal(ui.requests.length, 2, "only one background read can run at a time");
    assert.equal(ui.name()?.value, spec.row.name, "refresh must retain the accepted editor");
    assert.equal(ui.name().disabled, true, "pending refresh cannot accept an edit it will overwrite");
    await ui.flush(() => ui.requests[1].resolve({ data: null, error: new Error("network offline") }));
    assert.equal(ui.name().value, spec.row.name);
    assert.equal(ui.name().disabled, false);
    await ui.edit("재조회 실패 후 입력");
    assert.equal(ui.button("다시 불러오기").disabled, true, "retry cannot discard a new draft");
  } finally { await ui.close(); }
});

for (const spec of cases) {
  test(`${spec.kind}: a read retry keeps its action and focus through another failure`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: null, error: new Error("read offline") }));
      const retry = ui.button("다시 불러오기");
      await ui.flush(() => { retry.focus(); retry.click(); });
      assert.ok(ui.button("다시 불러오기") === retry, "the active recovery action stays mounted while reading");
      assert.equal(retry.disabled, true);
      await ui.flush(() => ui.requests[1].resolve({ data: null, error: new Error("still offline") }));
      assert.ok(ui.button("다시 불러오기") === retry);
      assert.equal(retry.disabled, false);
      assert.ok(document.activeElement === retry, "another read failure keeps focus on its recovery action");
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: failed read recovery preserves a newly edited draft for the next save`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("먼저 저장한 이름");
      await ui.flush(() => ui.button("변경 저장").click());
      await ui.flush(() => ui.writes[0].resolve([]));
      await ui.flush(() => ui.requests[1].resolve({ data: null, error: new Error("read offline") }));
      await ui.flush(() => {
        const retry = ui.button("다시 불러오기");
        ui.changeName("이어 작성한 새 초안");
        retry.click();
      });
      assert.equal(ui.requests.length, 2, "a read retry must not replace the current draft");
      assert.equal(ui.name().value, "이어 작성한 새 초안");
      assert.equal(ui.button("변경 저장").disabled, false);
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.writes[1].payload[0].name, "이어 작성한 새 초안");
      await ui.flush(() => ui.writes[1].resolve([]));
      await ui.flush(() => ui.requests[2].resolve({ data: [{ ...spec.row, name: "이어 작성한 새 초안" }], error: null }));
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: edits and additions cannot be lost during an in-flight save`, async () => {
    const ui = await mount(spec);
    try {
      assert.equal(ui.button(spec.add).disabled, true, "initial read must not accept a draft that its response will replace");
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("저장할 이름");
      await ui.flush(() => { const save = ui.button("변경 저장"); save.click(); save.click(); });
      assert.equal(ui.writes.length, 1, "same-turn repeat clicks invoke only one write");
      assert.equal(ui.button(spec.add).disabled, true, "a new row cannot be added while the saved snapshot is being committed");
      assert.equal(ui.name().disabled, true, "the input cannot accept a newer value that reload will overwrite");
      await ui.flush(() => ui.writes[0].resolve([]));
      assert.equal(ui.name().value, "저장할 이름", "keep the saved rows visible while re-reading");
      await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, name: "저장할 이름" }], error: null }));
      assert.equal(ui.name().value, "저장할 이름");
      assert.equal(ui.button("변경 저장").disabled, true);
      assert.equal(ui.button(spec.add).disabled, false);
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: post-save read failure preserves rows and retries only the read`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("저장된 이름");
      await ui.flush(() => ui.button("변경 저장").click());
      await ui.flush(() => ui.writes[0].resolve([]));
      await ui.flush(() => ui.requests[1].resolve({ data: null, error: new Error("network offline") }));
      assert.equal(ui.name()?.value, "저장된 이름", "a follow-up read failure must never clear the editor");
      assert.equal(ui.button("변경 저장").disabled, true, "the successful write must not be offered as an unsaved draft");
      assert.ok(ui.button("다시 불러오기"), "read failures have a direct recovery action");
      await ui.flush(() => ui.button("다시 불러오기").click());
      assert.equal(ui.writes.length, 1, "recovery does not repeat the write");
      await ui.flush(() => ui.requests[2].resolve({ data: [{ ...spec.row, name: "저장된 이름" }], error: null }));
      assert.equal(ui.name().value, "저장된 이름");
      assert.equal(ui.button("다시 불러오기"), undefined);
      assert.ok(document.activeElement === ui.button(spec.add), "completed read recovery returns focus to a stable action");
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: rejected save retains editable draft and allows save retry`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("재시도할 이름");
      await ui.flush(() => ui.button("변경 저장").click());
      await ui.flush(() => ui.writes[0].reject(new Error("write rejected")));
      assert.equal(ui.name().value, "재시도할 이름");
      assert.equal(ui.name().disabled, false);
      assert.equal(ui.button("변경 저장").disabled, false);
      assert.equal(ui.requests.length, 1, "a rejected write does not replace the draft with server data");
      assert.ok(document.querySelector('[data-slot="action-feedback"][role="alert"], [data-slot="action-feedback"] [role="alert"]'));
      assert.ok(!document.body.textContent.includes("write rejected"), "internal exceptions must not be shown in the editor");
      await ui.flush(() => document.querySelector('[aria-label="처리 결과 닫기"]').click());
      assert.ok(document.activeElement === ui.button(spec.add));
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.writes.length, 2);
      assert.equal(ui.writes[1].payload[0].name, "재시도할 이름");
      await ui.flush(() => ui.writes[1].resolve([]));
      await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, name: "재시도할 이름" }], error: null }));
    } finally { await ui.close(); }
  });
}
