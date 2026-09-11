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

async function mount(spec, initialRole = "staff") {
  let actor = { id: "actor-1", role: initialRole };
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/settings" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.self = dom.window;
  for (const key of ["HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "DOMRect", "getComputedStyle"]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const requests = [], writes = [], removals = [];
  const supabase = { from(table) {
    assert.equal(table, spec.table);
    const deferred = Promise.withResolvers();
    requests.push(deferred);
    const query = { then: deferred.promise.then.bind(deferred.promise) };
    for (const method of ["select", "order", "or", "range", "limit", "abortSignal", "retry"]) query[method] = () => query;
    return query;
  } };
  const managementService = { [spec.upsert](payload) { const write = { ...Promise.withResolvers(), payload }; writes.push(write); return write.promise; }, [spec.remove](ids) { const removal = { ...Promise.withResolvers(), ids }; removals.push(removal); return removal.promise; } };
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
    ["@/providers/auth-provider", { useAuth: () => ({ session: null, user: actor, role: actor.role, canManageAll: ["admin", "staff"].includes(actor.role), isTeacher: actor.role === "teacher" }) }],
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
  return { requests, writes, removals, flush, button, name, edit, changeName,
    async actor(role, id = actor.id) { actor = { id, role }; await flush(() => root.render(createElement(component))); },
    handler(element) { const key = Object.keys(element).find(key => key.startsWith("__reactProps")); return element[key].onClick; }, async close() { await act(async () => root.unmount()); dom.window.close(); } };
}


for (const spec of cases.filter(item => item.kind !== "school")) {
  for (const role of ["admin", "staff", "teacher", "viewer"]) {
    test(`${spec.kind}: ${role} editing follows its catalog write policy`, async () => {
      const ui = await mount(spec, role);
      try {
        await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
        const allowed = ["admin", "staff"].includes(role) || (role === "teacher" && spec.kind !== "class-group");
        assert.equal(ui.name().disabled, !allowed);
        assert.equal(ui.button(spec.add).disabled, !allowed);
        if (!allowed) {
          assert.match(document.body.textContent, /읽기 전용/);
          const input = ui.name();
          const key = Object.keys(input).find(key => key.startsWith("__reactProps"));
          await ui.flush(() => input[key].onChange({ target: { value: "forbidden draft" } }));
          assert.equal(ui.name().value, spec.row.name, "the handler also rejects unauthorized edits");
          const previousFields = document.querySelectorAll(`input[name="${spec.field}"]`).length;
          await ui.flush(() => ui.handler(ui.button(spec.add))());
          assert.equal(document.querySelectorAll(`input[name="${spec.field}"]`).length, previousFields);
          await ui.flush(() => ui.handler(ui.button("변경 저장"))());
          assert.equal(ui.writes.length, 0);
          assert.equal(ui.removals.length, 0);
        } else {
          await ui.edit("허용된 역할의 수정");
          await ui.flush(() => ui.button("변경 저장").click());
          assert.equal(ui.writes.length, 1, "existing permitted roles can still submit the catalog");
          assert.equal(ui.writes[0].payload[0].name, "허용된 역할의 수정");
          await ui.flush(() => ui.writes[0].resolve([]));
          await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, name: "허용된 역할의 수정" }], error: null }));
        }
      } finally { await ui.close(); }
    });
  }

  test(`${spec.kind}: a role downgrade retains the draft but blocks a previously captured save handler`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("기존 계정의 초안");
      const oldSave = ui.handler(ui.button("변경 저장"));
      await ui.actor("viewer");
      assert.equal(ui.name().value, "기존 계정의 초안");
      assert.equal(ui.name().disabled, true);
      await ui.flush(() => oldSave());
      assert.equal(ui.writes.length, 0);
      await ui.actor("staff");
      assert.equal(ui.name().value, "기존 계정의 초안");
      assert.equal(ui.button("변경 저장").disabled, false);
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: changing accounts never submits or displays the previous actor's draft`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("이전 계정의 초안");
      const oldSave = ui.handler(ui.button("변경 저장"));
      await ui.actor("staff", "actor-2");
      assert.equal(ui.requests.length, 2, "new actor gets a separate read and editor state");
      await ui.flush(() => oldSave());
      assert.equal(ui.writes.length, 0, "unmounted actor handlers cannot submit");
      await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, name: "새 계정 조회 결과" }], error: null }));
      assert.equal(ui.name().value, "새 계정 조회 결과");
      assert.equal(ui.button("변경 저장").disabled, true);
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: a same-account role change rejects stale handlers even when both roles can edit`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("권한 맥락별 초안");
      const oldSave = ui.handler(ui.button("변경 저장"));
      await ui.actor(spec.kind === "class-group" ? "admin" : "teacher");
      assert.equal(ui.name().value, "권한 맥락별 초안");
      assert.equal(ui.button("변경 저장").disabled, false);
      await ui.flush(() => oldSave());
      assert.equal(ui.writes.length, 0, "old role handler cannot submit under the new role");
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.writes.length, 1, "current authorized role can explicitly submit the preserved draft");
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: a late save from another account cannot replace the current editor`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row], error: null }));
      await ui.edit("이전 계정 저장 중");
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.writes.length, 1);
      await ui.actor("staff", "actor-2");
      await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, name: "새 계정 조회 결과" }], error: null }));
      await ui.flush(() => ui.writes[0].resolve([]));
      assert.equal(ui.requests.length, 2, "old actor completion cannot request another read");
      assert.equal(ui.name().value, "새 계정 조회 결과");
      assert.equal(ui.button("변경 저장").disabled, true);
    } finally { await ui.close(); }
  });

  test(`${spec.kind}: a temporary role revocation prevents the next write after an in-flight deletion`, async () => {
    const ui = await mount(spec);
    try {
      await ui.flush(() => ui.requests[0].resolve({ data: [spec.row, { ...spec.row, id: "row-2", name: "남은 행" }], error: null }));
      const remove = [...document.querySelectorAll("button")].find(button => /삭제$/.test(button.getAttribute("aria-label") || ""));
      await ui.flush(() => remove.click());
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.removals.length, 1);
      await ui.actor("viewer");
      await ui.actor("staff");
      await ui.flush(() => ui.removals[0].resolve({ deletedIds: [spec.row.id] }));
      assert.equal(ui.writes.length, 0, "role revocation stops the following upsert");
      assert.equal(ui.requests.length, 1);
      assert.equal(ui.name().value, "남은 행");
      assert.match(document.body.textContent, /권한이 변경되어 저장을 중단했습니다/);
      await ui.flush(() => ui.button("변경 저장").click());
      assert.equal(ui.removals.length, 1, "an accepted deletion is not submitted again on retry");
      assert.equal(ui.writes.length, 1, "the current role can explicitly save the remaining changes");
      await ui.flush(() => ui.writes[0].resolve([]));
      await ui.flush(() => ui.requests[1].resolve({ data: [{ ...spec.row, id: "row-2", name: "남은 행" }], error: null }));
      assert.equal(ui.button("변경 저장").disabled, true);
    } finally { await ui.close(); }
  });
}
