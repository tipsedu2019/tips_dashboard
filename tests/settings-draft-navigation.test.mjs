import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const subjectRow = { subject: "영어", isActive: true, registrationCreateEnabled: true, gradeLevels: ["중1"], defaultDirectorProfileId: null };
const cases = [
  { kind: "school", component: "SchoolMasterWorkspace", table: "academic_schools", field: "school-name", upsert: "upsertAcademicSchools", row: { id: "school-1", name: "기존학교", category: "elementary", color: null, sort_order: 1 } },
  { kind: "classroom", component: "ClassroomMasterWorkspace", table: "classroom_catalogs", field: "classroom-name", upsert: "upsertClassroomCatalogs", row: { id: "room-1", name: "기존강의실", subjects: ["영어"], campus: "본관", is_visible: true, sort_order: 1 } },
  { kind: "class-group", component: "ClassGroupMasterWorkspace", table: "class_schedule_sync_groups", field: "class-group-name", upsert: "upsertClassGroups", row: { id: "group-1", name: "기존그룹", subject: "영어", sort_order: 1, is_default: false } },
  { kind: "teacher", component: "TeacherMasterWorkspace", field: "teacher-name", upsert: "upsertTeacherCatalogs", row: { id: "teacher-1", name: "기존선생님", subjects: ["영어팀"], profile_id: null, account_email: "", dashboard_role: "teacher", is_visible: true, sort_order: 1 } },
  { kind: "subject", component: "SubjectMasterWorkspace", row: subjectRow },
];
async function mount(t, spec, rows = [spec.row]) {
  const dom = new JSDOM('<div id="root"></div><a href="/admin/dashboard">다른 페이지</a>', { url: `https://test.invalid/admin/settings/${spec.kind}` });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.self = dom.window;
  for (const key of ["HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "DOMRect", "getComputedStyle"]) globalThis[key] = dom.window[key];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 32, height: 32 }]; };
  const traversals = [], routes = [], writes = [], request = Promise.withResolvers();
  window.navigation = Object.assign(new window.EventTarget(), { traverseTo: key => { traversals.push(key); return { committed: Promise.resolve(), finished: Promise.resolve() }; } });
  const router = { push: href => routes.push(href) };
  const supabase = { from() { const query = { then: request.promise.then.bind(request.promise) }; for (const method of ["select", "order", "or", "range", "limit", "abortSignal", "retry"]) query[method] = () => query; return query; } };
  const managementService = {
    [spec.upsert || "unused"](payload) { const write = { ...Promise.withResolvers(), payload }; writes.push(write); return write.promise; },
    listTeacherAccountSettingsData: async () => spec.kind === "teacher" ? request.promise.then(data => ({ teachers: data.data, profiles: [], auditLogs: [], isAccountSchemaReady: true })) : { teachers: [] },
  };
  const subjectService = { list: () => request.promise, update(payload) { const write = { ...Promise.withResolvers(), payload }; writes.push(write); return write.promise; } };
  const Component = loadNotificationComponent(`src/features/management/${spec.kind}-master-workspace.tsx`, new Map([
    ["next/navigation", { useRouter: () => router }],
    ["@/lib/supabase", { supabase }],
    ["./management-service.js", { managementService, createId: () => "new-record", filterClassroomCatalogRowsForSubject: rows => rows }],
    ["./academic-subject-settings-service", { academicSubjectSettingsService: subjectService }],
    ["./settings-table-columns", { useSettingsTableColumns: () => ({ isColumnVisible: () => true, visibleColumnCount: 4, columnSettingsControl: null }) }],
    ["@/providers/auth-provider", { useAuth: () => ({ user: { id: "actor", role: "admin" }, role: "admin", isAdmin: true, canManageAll: true, isTeacher: false }) }],
    ["./teacher-google-chat-identity-panel", { TeacherGoogleChatIdentityPanel: () => null }],
  ]))[spec.component];
  const { requestAppNavigation } = loadNotificationComponent("src/lib/guarded-navigation.ts");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const flush = async callback => { await act(async () => { callback?.(); await new Promise(resolve => setTimeout(resolve, 25)); }); };
  await flush(() => root.render(createElement(Component)));
  t.after(async () => { await act(async () => root.unmount()); await flush(); dom.window.close(); });
  const button = name => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === name);
  const field = (subject = "english") => spec.kind === "subject" ? document.querySelector(`[data-subject-key="${subject}"] button[role="checkbox"]`) : document.querySelector(`input[name="${spec.field}"]`);
  const edit = async (subject = "english") => { await flush(() => {
    field(subject).focus();
    if (spec.kind === "subject") field(subject).click();
    else { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field(), "미저장 초안"); field().dispatchEvent(new window.Event("input", { bubbles: true })); field().dispatchEvent(new window.Event("change", { bubbles: true })); }
  }); };
  const confirmation = () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
  const app = async (href = "/admin/other") => flush(() => requestAppNavigation(() => routes.push(href)));
  const save = async (subject = "english") => flush(() => { if (spec.kind === "subject") [...document.querySelectorAll(`[data-subject-key="${subject}"] button`)].find(b => b.textContent === "저장").click(); else button("변경 저장").click(); });
  const unload = () => { const e = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
  const acceptLoad = () => flush(() => request.resolve(spec.kind === "subject" ? rows : { data: rows, error: null }));
  const acceptSave = index => flush(() => writes[index].resolve(spec.kind === "subject" ? writes[index].payload : undefined));
  return { flush, button, field, edit, confirmation, app, save, unload, routes, writes, traversals, acceptLoad, acceptSave };
}
for (const spec of cases) test(`${spec.kind}: clean load, anchor cancellation, app discard and Back share draft protection`, async t => {
  const ui = await mount(t, spec);
  assert.equal(ui.unload(), false, "loading is not a draft"); await ui.acceptLoad(); await ui.app("/clean"); assert.deepEqual(ui.routes, ["/clean"]);
  await ui.edit(); assert.equal(ui.unload(), true);
  await ui.flush(() => document.querySelector("a").click()); assert.ok(ui.confirmation()); assert.equal(ui.routes.length, 1);
  await ui.flush(() => ui.button("계속 편집").click()); assert.equal(ui.confirmation(), null); assert.ok(document.activeElement === ui.field());
  assert.equal(spec.kind === "subject" ? ui.field().getAttribute("aria-checked") : ui.field().value, spec.kind === "subject" ? "false" : "미저장 초안");
  await ui.flush(() => { const e = new window.Event("navigate", { cancelable: true }); Object.assign(e, { navigationType: "traverse", destination: { key: "old-entry", sameDocument: true } }); window.navigation.dispatchEvent(e); assert.equal(e.defaultPrevented, true); });
  assert.ok(ui.confirmation()); await ui.flush(() => ui.button("계속 편집").click()); assert.deepEqual(ui.traversals, []);
  await ui.app("/accepted"); await ui.app("/must-not-overwrite"); assert.ok(ui.confirmation()); await ui.flush(() => ui.button("변경사항 버리기").click()); assert.deepEqual(ui.routes, ["/clean", "/accepted"]);
});
for (const spec of cases) test(`${spec.kind}: pending/failed save keeps guard; accepted save becomes clean`, async t => {
  const ui = await mount(t, spec); await ui.acceptLoad(); await ui.edit(); await ui.save(); assert.equal(ui.writes.length, 1); assert.equal(ui.unload(), true, "submitted but unaccepted values remain protected");
  await ui.app(); assert.ok(ui.confirmation()); await ui.flush(() => ui.button("계속 편집").click());
  await ui.flush(() => ui.writes[0].reject(new Error("synthetic failed save"))); assert.equal(ui.unload(), true); await ui.app(); assert.ok(ui.confirmation()); await ui.flush(() => ui.button("계속 편집").click());
  await ui.save(); assert.equal(ui.writes.length, 2); await ui.acceptSave(1); assert.equal(ui.unload(), false); await ui.app(); assert.equal(ui.confirmation(), null); assert.equal(ui.routes.length, 1);
});
test("subject: reverting edits is clean and saving one subject keeps another subject protected", async t => {
  const ui = await mount(t, cases[4], [subjectRow, { ...subjectRow, subject: "수학" }]); await ui.acceptLoad(); await ui.edit(); await ui.edit(); assert.equal(ui.unload(), false);
  await ui.edit(); await ui.edit("math"); await ui.save(); await ui.acceptSave(0); assert.equal(ui.unload(), true); await ui.app(); assert.ok(ui.confirmation()); await ui.flush(() => ui.button("계속 편집").click());
  await ui.save("math"); await ui.acceptSave(1); assert.equal(ui.unload(), false);
});
test("accepted subject save dismisses an open confirmation without reopening it on the next edit", async t => {
  const ui = await mount(t, cases[4]); await ui.acceptLoad(); await ui.edit(); await ui.save(); await ui.app(); assert.ok(ui.confirmation());
  await ui.acceptSave(0); assert.equal(ui.confirmation(), null); assert.deepEqual(ui.routes, []);
  await ui.edit(); assert.equal(ui.confirmation(), null); await ui.app(); assert.ok(ui.confirmation()); await ui.flush(() => ui.button("계속 편집").click());
});
