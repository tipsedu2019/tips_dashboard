import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";
import { requestAppNavigation } from "../src/lib/guarded-navigation.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://test.invalid/admin/academic-calendar", pretendToBeVisual: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const initial = { title: "기존 일정", typeLabel: "팁스", date: new Date(2026, 8, 11), endDate: new Date(2026, 8, 11), grade: "all", note: "원래 메모" };

async function setup(t, overrides = {}) {
  const calls = [], routes = [];
  const { EventForm } = loadNotificationComponent("src/app/admin/calendar/components/event-form.tsx", new Map([
    ["next/navigation", { useRouter: () => ({ push: href => routes.push(href) }) }],
    ["sonner", { toast: { error() {} } }],
  ]));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let props = { open: true, initialDraft: initial, onSave: data => { const call = Promise.withResolvers(); calls.push({ ...call, data }); return call.promise; }, ...overrides };
  const render = async patch => { props = { ...props, ...patch }; await act(async () => root.render(createElement(EventForm, { ...props, onOpenChange: open => { props = { ...props, open }; root.render(createElement(EventForm, { ...props, onOpenChange: onOpenChange })); } }))); };
  const onOpenChange = open => { props = { ...props, open }; root.render(createElement(EventForm, { ...props, onOpenChange })); };
  await render();
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  return { calls, routes, render, get props() { return props; } };
}
const title = () => document.querySelector("#title");
const confirm = () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
function button(name) { const found = [...document.querySelectorAll("button")].findLast(node => node.textContent.trim() === name); assert.ok(found, `button ${name}`); return found; }
async function click(name) { await act(async () => button(name).click()); }
async function edit(value) { await act(async () => { const input = title(); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); }); }
async function request(routes, value) { await act(async () => requestAppNavigation(() => routes.push(value))); }
async function waitFor(predicate) { for (let i = 0; i < 60; i++) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } assert.ok(predicate()); }

test("actual event form protects a dirty route and local close, while clean selection and reverted values do not prompt", async t => {
  const h = await setup(t);
  await request(h.routes, "clean"); assert.deepEqual(h.routes, ["clean"]);
  await edit("새 일정 제목");
  await request(h.routes, "cancelled"); assert.deepEqual(h.routes, ["clean"]); assert.ok(confirm());
  await click("계속 편집"); assert.equal(title().value, "새 일정 제목");
  await edit("기존 일정"); await request(h.routes, "reverted"); assert.deepEqual(h.routes, ["clean", "reverted"]);
  await edit("닫기 전에 남은 초안"); await click("닫기"); assert.ok(confirm());
  await click("계속 편집"); assert.equal(h.props.open, true);
  await click("닫기"); await click("변경사항 버리기"); await waitFor(() => !h.props.open);
  await h.render({ open: true }); assert.equal(title().value, "기존 일정");
  await request(h.routes, "new-clean-lifetime"); assert.equal(confirm(), null);
});

async function mountCaller(t, Component, props) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(Component, props)));
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
}

test("actual Calendar caller cannot close a new form after an older save resolves", async t => {
  const pending = Promise.withResolvers();
  const { Calendar } = loadNotificationComponent("src/app/admin/calendar/components/calendar.tsx", new Map([
    ["next/navigation", { useRouter: () => ({ push() {} }) }],
  ]));
  await mountCaller(t, Calendar, { events: [], eventDates: [], calendars: [], typeOptions: ["팁스"], initialDate: initial.date, onSaveEvent: () => pending.promise });
  await click("새 일정 추가"); await edit("이전 Calendar 저장"); await click("일정 추가");
  await click("닫기"); await click("변경사항 버리기"); await waitFor(() => !title());
  await click("새 일정 추가"); assert.ok(title());
  await act(async () => pending.resolve(true));
  assert.ok(title(), "new Calendar form remains open"); assert.equal(title().value, ""); assert.equal(title().disabled, false);
});

test("actual annual-board caller cannot reset a newer draft after an older save and refresh", async t => {
  const pending = Promise.withResolvers(), writes = [], params = new URLSearchParams("year=2026");
  const immediate = () => { const chain = { then: resolve => Promise.resolve({ data: [], error: null }).then(resolve), limit: () => chain, abortSignal: () => chain, retry: () => chain }; return chain; };
  const data = { ok: true, data: { rows: [], academicYear: 2026 }, catalogs: { academicSchools: [{ id: "school-1", name: "검수고", category: "high" }] } };
  const { AcademicAnnualBoardWorkspace } = loadNotificationComponent("src/features/operations/academic-annual-board-workspace.tsx", new Map([
    ["next/navigation", { useRouter: () => ({ push() {} }), useSearchParams: () => params }],
    ["@/providers/auth-provider", { useAuth: () => ({ canManageAll: true }) }],
    ["@/lib/supabase", { supabase: { rpc: immediate, from: table => ({ insert: payload => { writes.push({ table, payload }); return pending.promise; } }) } }],
    ["./use-operations-workspace-data", { useOperationsWorkspaceData: () => ({ data, loading: false, refresh: async () => {}, loadEventDetail: async () => null }) }],
    ["sonner", { toast: { success() {}, error() {}, info() {} } }],
  ]));
  await mountCaller(t, AcademicAnnualBoardWorkspace);
  await click("첫 일정 추가"); await edit("이전 연간보드 저장"); await click("일정 추가"); assert.equal(writes.length, 1);
  await click("닫기"); await click("변경사항 버리기"); await waitFor(() => !title());
  await click("첫 일정 추가"); const newTitle = title().value; assert.ok(newTitle);
  await act(async () => pending.resolve({ error: null }));
  assert.ok(title()); assert.equal(title().value, newTitle); assert.equal(title().disabled, false);
});

test("actual event save has a same-tick lock and restores editable draft after failed save", async t => {
  const h = await setup(t); await edit("저장할 일정");
  await act(async () => { button("일정 추가").click(); button("일정 추가").click(); });
  assert.equal(h.calls.length, 1); assert.equal(title().disabled, true);
  await act(async () => h.calls[0].resolve(false)); assert.equal(h.props.open, true); assert.equal(title().value, "저장할 일정"); assert.equal(title().disabled, false);
  await click("일정 추가"); assert.equal(h.calls.length, 2);
  await act(async () => h.calls[1].resolve(true)); await waitFor(() => !h.props.open); assert.equal(confirm(), null);
});

test("late event save cannot close or reset a different reopened event", async t => {
  const h = await setup(t); await edit("A 제출 초안"); await click("일정 추가");
  await click("닫기"); await click("변경사항 버리기"); await waitFor(() => !h.props.open);
  await h.render({ open: true, initialDraft: { ...initial, title: "새 B 일정" } });
  await act(async () => h.calls[0].resolve(true));
  assert.equal(h.props.open, true); assert.equal(title().value, "새 B 일정"); assert.equal(title().disabled, false);
});

test("event catalog refresh and read-only selection do not create a dirty draft", async t => {
  const h = await setup(t);
  await h.render({ schoolOptions: [{ id: "school-1", name: "새로 조회한 학교", category: "high" }], initialDraft: { ...initial } });
  await request(h.routes, "catalog-refresh"); assert.deepEqual(h.routes, ["catalog-refresh"]); assert.equal(confirm(), null);
  await h.render({ readOnly: true, initialDraft: { ...initial, title: "조회할 일정" } });
  assert.equal(title().value, "조회할 일정"); assert.equal(title().disabled, true);
  await request(h.routes, "read-only"); assert.deepEqual(h.routes, ["catalog-refresh", "read-only"]);
});

test("a rejected event save retains the draft and a late failure does not inject errors into a reopened copy", async t => {
  const h = await setup(t); await edit("실패할 일정"); await click("일정 추가");
  await act(async () => h.calls[0].reject(new Error("offline")));
  assert.equal(title().value, "실패할 일정"); assert.match(document.body.textContent, /일정을 저장하지 못했습니다/); assert.equal(title().disabled, false);
  await click("일정 추가"); await click("닫기"); await click("변경사항 버리기"); await waitFor(() => !h.props.open);
  await h.render({ open: true }); assert.equal(title().value, "기존 일정");
  await act(async () => h.calls[1].reject(new Error("late failure")));
  assert.equal(h.props.open, true); assert.equal(title().value, "기존 일정"); assert.doesNotMatch(document.body.textContent, /일정을 저장하지 못했습니다/);
});

test("event deletion retains its explicit confirmation, shares the mutation lock, and cannot close a reopened editor", async t => {
  const deletion = Promise.withResolvers(), calls = [];
  const event = { ...initial, id: "7a000000-0000-4000-8000-000000000001", sourceId: "7a000000-0000-4000-8000-000000000001" };
  const h = await setup(t, { event, onDelete: id => { calls.push(id); return deletion.promise; } });
  await click("삭제"); assert.equal(calls.length, 0);
  await act(async () => { const target = button("삭제 확인"); target.click(); target.click(); }); assert.equal(calls.length, 1); assert.equal(title().disabled, true);
  await click("닫기"); await waitFor(() => !h.props.open);
  await h.render({ open: true });
  await act(async () => deletion.resolve(true)); assert.equal(h.props.open, true); assert.equal(title().value, "기존 일정");
});


test("event scope inputs expose distinct field and row accessibility names", async t => {
  await setup(t, { initialDraft: { ...initial, typeLabel: "영어시험일", textbookScopes: [{ name: "첫 교재", publisher: "출판사", scope: "1장" }, { name: "둘째 교재", publisher: "출판사", scope: "2장" }], subtextbookScopes: [{ name: "부교재", publisher: "출판사", scope: "3장" }] } });
  for (const [label, count] of [["교재 시험범위", 2], ["부교재 시험범위", 1]]) {
    for (let index = 1; index <= count; index++) {
      for (const field of ["교재명", "출판사", "범위"]) assert.equal(document.querySelectorAll(`input[aria-label="${label} ${index} ${field}"]`).length, 1);
    }
  }
});

test('late default-type catalogs do not reset a title already being edited in the same new event', async t => {
  const h=await setup(t,{initialDraft:{date:initial.date,endDate:initial.endDate},typeOptions:['팁스']});
  await edit('카탈로그 조회 중 작성한 제목');
  await h.render({typeOptions:['학교행사','팁스']});
  assert.equal(title().value,'카탈로그 조회 중 작성한 제목');
  await request(h.routes,'route');assert.ok(confirm());assert.deepEqual(h.routes,[]);
  await click('계속 편집');await click('닫기');await click('변경사항 버리기');await waitFor(()=>!h.props.open);
  await h.render({open:true});assert.equal(title().value,'');
  await request(h.routes,'clean-reopen');assert.deepEqual(h.routes,['clean-reopen']);
});

test('late default-type catalogs do not detach an accepted save from its current event lifetime', async t => {
  const h=await setup(t,{initialDraft:{title:'입력된 초기 제목',date:initial.date,endDate:initial.endDate},typeOptions:['팁스']});
  await click('일정 추가');assert.equal(h.calls.length,1);
  await h.render({typeOptions:['학교행사','팁스']});
  await act(async()=>h.calls[0].resolve(true));
  await waitFor(()=>!h.props.open);assert.equal(confirm(),null);
});
