import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import ts from "typescript";
import { classRow, createManagementDetailFixture, defaultsFor } from "./helpers/management-detail-fixture.mjs";

const require = createRequire(import.meta.url);
const repo = new URL("../", import.meta.url);
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://test.invalid/admin/classes", pretendToBeVisual: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

// Render the production page and its dialogs. Defer the data boundary and use
// native inputs for the time widget; neither adapter implements form behavior.
function loadPage(fixture, navigation) {
  const overrides = new Map([
    ["@/lib/supabase", { supabase: null, supabaseConfigError: null }],
    ["@/providers/auth-provider", { useAuth: () => fixture.auth }],
    ["@/features/management/use-management-records", { useManagementRecords: () => fixture.records }],
    ["next/navigation", navigation],
    ["./management-data-table", { ManagementDataTable: ({ actions, rows }) => createElement("div", null,
      createElement("button", { onClick: actions.onCreate }, "수업 등록"),
      ...rows.map(row => createElement("button", { key: row.id, onClick: () => actions.onOpenRow(row) }, row.title))) }],
    ["@/components/ui/date-time-picker", { TimePickerControl: ({ value, onChange, ariaLabel, disabled }) => createElement("input", { "aria-label": ariaLabel, value, disabled, onChange: event => onChange(event.target.value) }) }],
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
        const exports = load(target);
        return target.pathname.endsWith("/management-service.js") ? { ...exports, managementService: fixture.service } : exports;
      }
      return require(specifier);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: url.pathname })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return load(new URL("src/features/management/management-page.tsx", repo));
}

async function setup(t, options = {}) {
  window.history.replaceState(null, "", "/admin/classes");
  const fixture = createManagementDetailFixture();
  fixture.deferDetail = Boolean(options.deferDetail);
  const router = { push() {}, replace() {} };
  let search = new URLSearchParams();
  const { ManagementPage } = loadPage(fixture, { useRouter: () => router, usePathname: () => "/admin/classes", useSearchParams: () => search });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const render = () => root.render(createElement(ManagementPage, { kind: "classes" }));
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
    container.remove();
  };
  t.after(unmount);
  await act(async () => render());
  return {
    ...fixture, unmount,
    click: label => act(async () => {
      const button = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label || node.getAttribute("aria-label") === label);
      assert.ok(button, `button not found: ${label}`);
      assert.equal(button.disabled, false, `${label} must be enabled`);
      button.click();
    }),
    resolve: (index, value) => act(async () => fixture.requests[index].resolve(value)),
    reject: (index, message = "이전 요청 실패") => act(async () => fixture.requests[index].reject(new Error(message))),
    time: () => document.querySelector('[aria-label="수업시간 1 시작시각"]')?.value,
    editTime: value => act(async () => {
      const input = document.querySelector('[aria-label="수업시간 1 시작시각"]');
      assert.ok(input);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }),
    title: () => document.querySelector('[role="dialog"] h2')?.textContent,
    text: () => document.querySelector('[role="dialog"]')?.textContent ?? "",
    navigate: query => act(async () => { search = new URLSearchParams(query); window.history.replaceState(null, "", `/admin/classes?${search}`); render(); }),
    actor: (id, role = "admin") => act(async () => { fixture.auth = { ...fixture.auth, user: id ? { id } : null, role, canManageAll: role === "admin" }; render(); }),
  };
}

test("current class loads normalized schedule and saves its own revision and slots", async t => {
  const ui = await setup(t);
  await ui.click("B 영어반");
  await ui.resolve(0, defaultsFor("17:00", 4));
  assert.equal(ui.time(), "17:00");
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[1].input.classId, "b");
  assert.equal(ui.requests[1].input.expectedScheduleRevision, 4);
  assert.equal(ui.requests[1].input.slots[0].startTime, "18:00");
  await ui.resolve(1, defaultsFor("18:00", 5));
  assert.match(ui.text(), /기본 시간표 저장 완료/);
});

test("late A defaults cannot overwrite B edits or B's next save", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.click("수업 상세 닫기");
  await ui.click("B 영어반");
  await ui.resolve(1, defaultsFor("17:00", 8));
  await ui.editTime("18:30");
  await ui.resolve(0, defaultsFor("09:00", 2));
  assert.match(ui.title(), /B 영어반/);
  assert.equal(ui.time(), "18:30");
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[2].input.classId, "b");
  assert.equal(ui.requests[2].input.expectedScheduleRevision, 8);
  assert.equal(ui.requests[2].input.slots[0].startTime, "18:30");
});

test("a closed class response cannot populate a new class form", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.click("수업 상세 닫기");
  await ui.click("수업 등록");
  await act(async () => {
    const input = document.querySelector("#classes-form-schedule");
    assert.ok(input);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "화 18:45-20:00");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await ui.resolve(0, defaultsFor("09:00"));
  assert.equal(document.querySelector("#classes-form-schedule").value, "화 18:45-20:00");
  assert.doesNotMatch(ui.text(), /기본 시간표 저장/);
});

test("late errors from the previous class stay out of the active detail", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.click("수업 상세 닫기");
  await ui.click("B 영어반");
  await ui.resolve(1, defaultsFor());
  await ui.reject(0);
  assert.doesNotMatch(ui.text(), /이전 요청 실패/);
});

test("out-of-order detail responses keep the latest selected class open", async t => {
  const ui = await setup(t, { deferDetail: true });
  await ui.click("A 영어반");
  await ui.click("B 영어반");
  await ui.resolve(1, classRow("b", "B 영어반"));
  await ui.resolve(0, classRow("a", "A 영어반"));
  assert.match(ui.title(), /B 영어반/);
  assert.equal(ui.requests.filter(request => request.type === "defaults").length, 1);
});

test("reopening the same class creates a separate editing lifetime", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.click("수업 상세 닫기");
  await ui.click("A 영어반");
  await ui.resolve(1, defaultsFor("19:00", 6));
  await ui.resolve(0, defaultsFor("09:00", 2));
  assert.equal(ui.time(), "19:00");
});

test("typing before the initial defaults arrive retains the draft and catalog IDs", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.editTime("18:30");
  await ui.resolve(0, defaultsFor("09:00", 7));
  assert.equal(ui.time(), "18:30");
  await ui.click("기본 시간표 저장");
  const input = ui.requests[1].input;
  assert.equal(input.expectedScheduleRevision, 7);
  assert.equal(input.slots[0].startTime, "18:30");
  assert.equal(input.slots[0].teacherCatalogId, "teacher-1");
  assert.equal(input.slots[0].classroomCatalogId, "room-1");
});

test("late save success cannot replace newer edits and the next save uses the new revision", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor("17:00", 1));
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.editTime("19:00");
  await ui.resolve(1, defaultsFor("18:00", 2));
  assert.equal(ui.time(), "19:00");
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[2].input.expectedScheduleRevision, 2);
  assert.equal(ui.requests[2].input.slots[0].startTime, "19:00");
  assert.notEqual(ui.requests[2].input.requestKey, ui.requests[1].input.requestKey);
});

for (const outcome of ["success", "failure"]) {
  test(`late A save ${outcome} cannot change B's pending save or status`, async t => {
    const ui = await setup(t);
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    await ui.editTime("18:00");
    await ui.click("기본 시간표 저장");
    await ui.click("수업 상세 닫기");
    await ui.click("B 영어반");
    await ui.resolve(2, defaultsFor("18:00", 8));
    await ui.editTime("19:00");
    await ui.click("기본 시간표 저장");
    if (outcome === "success") await ui.resolve(1, defaultsFor("18:00", 2));
    else await ui.reject(1);
    assert.equal(ui.time(), "19:00");
    assert.match(ui.text(), /기본 시간표 저장 중/);
    assert.doesNotMatch(ui.text(), /기본 시간표 저장 완료|이전 요청 실패/);
    await ui.resolve(3, defaultsFor("19:00", 9));
    assert.match(ui.text(), /기본 시간표 저장 완료/);
  });
}

test("unchanged failed saves retry their key, edited drafts get a new key", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.reject(1);
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[2].input.requestKey, ui.requests[1].input.requestKey);
  await ui.reject(2);
  await ui.editTime("19:00");
  await ui.click("기본 시간표 저장");
  assert.notEqual(ui.requests[3].input.requestKey, ui.requests[2].input.requestKey);
});

test("late reload keeps subsequent typing and updates the save revision", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.reject(1, "class_schedule_stale");
  await ui.click("최신값 불러오기");
  await ui.editTime("19:00");
  await ui.resolve(2, defaultsFor("09:00", 9));
  assert.equal(ui.time(), "19:00");
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[3].input.expectedScheduleRevision, 9);
});

test("late reload failure after changing classes stays out of the new detail", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.reject(1, "class_schedule_stale");
  await ui.click("최신값 불러오기");
  await ui.click("수업 상세 닫기");
  await ui.click("B 영어반");
  await ui.resolve(3, defaultsFor("19:00"));
  await ui.reject(2);
  assert.equal(ui.time(), "19:00");
  assert.doesNotMatch(ui.text(), /이전 요청 실패/);
});

test("an off-page deep link cannot reopen after a newer route request", async t => {
  const ui = await setup(t, { deferDetail: true });
  await ui.navigate("classId=outside-a");
  await ui.navigate("classId=outside-b");
  await ui.resolve(1, classRow("outside-b", "화면 밖 B"));
  await ui.resolve(0, classRow("outside-a", "화면 밖 A"));
  assert.match(ui.title(), /화면 밖 B/);
  assert.equal(ui.requests.filter(request => request.type === "defaults").length, 1);
});

test("removing a deep link while its detail is pending leaves the dialog closed", async t => {
  const ui = await setup(t, { deferDetail: true });
  await ui.navigate("classId=outside-a");
  await ui.navigate("");
  await ui.resolve(0, classRow("outside-a"));
  assert.equal(ui.title(), undefined);
  assert.equal(ui.requests.filter(request => request.type === "defaults").length, 0);
});

test("an old actor's pending detail cannot start a schedule request after logout", async t => {
  const ui = await setup(t, { deferDetail: true });
  await ui.click("A 영어반");
  await ui.actor(null, null);
  await ui.resolve(0, classRow("a"));
  assert.equal(ui.title(), undefined);
  assert.equal(ui.requests.filter(request => request.type === "defaults").length, 0);
});
