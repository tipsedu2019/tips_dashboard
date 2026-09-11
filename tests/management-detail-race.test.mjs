import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import ts from "typescript";
import { classRow, createManagementDetailFixture, defaultsFor } from "./helpers/management-detail-fixture.mjs";
import { requestAppNavigation } from "../src/lib/guarded-navigation.ts";

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
function loadPage(fixture, navigation, componentOverrides = []) {
  const overrides = new Map([
    ["@/lib/supabase", { supabase: null, supabaseConfigError: null }],
    ["@/providers/auth-provider", { useAuth: () => fixture.auth }],
    ["@/features/management/use-management-records", { useManagementRecords: () => fixture.records }],
    ["next/navigation", navigation],
    ["./management-data-table", { ManagementDataTable: ({ actions, rows }) => createElement("div", null,
      createElement("button", { onClick: actions.onCreate }, "수업 등록"),
      actions.onBulkUpdateRows && createElement("button", { onClick: () => actions.onBulkUpdateRows(rows, { field: "grade", value: "중2" }) }, "검수 일괄 수정"),
      actions.onBulkDeleteRows && createElement("button", { onClick: () => actions.onBulkDeleteRows(rows) }, "검수 삭제 요청"),
      ...rows.map(row => createElement("button", { key: row.id, onClick: () => actions.onOpenRow(row) }, row.title))) }],
    ["@/components/ui/date-time-picker", { TimePickerControl: ({ value, onChange, ariaLabel, disabled }) => createElement("input", { "aria-label": ariaLabel, value, disabled, onChange: event => onChange(event.target.value) }) }],
    ...componentOverrides,
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
  const kind = options.kind || "classes";
  const pathname = `/admin/${kind}`;
  window.history.replaceState(null, "", pathname);
  const fixture = createManagementDetailFixture();
  fixture.deferDetail = Boolean(options.deferDetail);
  options.configureFixture?.(fixture);
  const navigationCalls = [];
  const traversals = [];
  // JSDOM has no Navigation API. Browser integration covers the native event;
  // the History API fallback has its own stateful browser/history tests.
  const navigation = new window.EventTarget();
  navigation.traverseTo = key => {
    traversals.push(key);
    return { committed: Promise.resolve(), finished: Promise.resolve() };
  };
  Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
  const router = { push(href) { navigationCalls.push(href); }, replace() {} };
  let search = new URLSearchParams();
  const { ManagementPage } = loadPage(fixture, { useRouter: () => router, usePathname: () => pathname, useSearchParams: () => search }, options.componentOverrides);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  const render = () => root.render(createElement(ManagementPage, { kind }));
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
    container.remove();
  };
  t.after(unmount);
  await act(async () => render());
  const findButton = label => {
    const button = [...document.querySelectorAll("button")].findLast(node => node.textContent.trim() === label || node.getAttribute("aria-label") === label);
    assert.ok(button, `button not found: ${label}`);
    return button;
  };
  return {
    ...fixture, unmount, navigationCalls, traversals,
    traverse: async key => {
      const event = new window.Event("navigate", { cancelable: true });
      Object.assign(event, { navigationType: "traverse", destination: { key, url: "https://test.invalid/admin/tasks", sameDocument: true } });
      await act(async () => navigation.dispatchEvent(event));
      return event.defaultPrevented;
    },
    click: label => act(async () => {
      const button = findButton(label);
      assert.equal(button.disabled, false, `${label} must be enabled`);
      button.click();
    }),
    clickTogether: (...labels) => act(async () => {
      const buttons = labels.map(findButton);
      for (const button of buttons) button.click();
    }),
    submitTogether: () => act(async () => {
      const form = document.querySelector('[role="dialog"] form');
      assert.ok(form, "create form must be open");
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    }),
    editField: (id, value) => act(async () => {
      const input = document.getElementById(id);
      assert.ok(input, `field not found: ${id}`);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    }),
    escape: () => act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
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
    navigate: query => act(async () => { search = new URLSearchParams(query); window.history.replaceState(null, "", `${pathname}?${search}`); render(); }),
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

test("normalized schedule rejects same-tick duplicate saves for one class and releases it on failure", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.clickTogether("기본 시간표 저장", "기본 시간표 저장");
  assert.equal(ui.requests.filter(request => request.type === "save").length, 1);
  const key = ui.requests[1].input.requestKey;
  await ui.reject(1, "검수 시간표 저장 실패");
  await ui.clickTogether("기본 시간표 저장", "기본 시간표 저장");
  assert.equal(ui.requests.filter(request => request.type === "save").length, 2);
  assert.equal(ui.requests[2].input.requestKey, key, "an unchanged failed draft retains its idempotency key");
  await ui.resolve(2, defaultsFor("18:00", 2));
  assert.match(ui.text(), /기본 시간표 저장 완료/);
});

test("normalized schedule locks the class across reopening and keeps independent classes writable", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.click("수업 상세 닫기");
  await ui.click("B 영어반");
  await ui.resolve(2, defaultsFor("17:00", 8));
  await ui.editTime("19:00");
  await ui.clickTogether("기본 시간표 저장", "기본 시간표 저장");
  assert.deepEqual(ui.requests.filter(request => request.type === "save").map(request => request.input.classId), ["a", "b"]);
  await ui.click("수업 상세 닫기");
  await ui.click("A 영어반");
  await ui.resolve(4, defaultsFor("17:00", 1));
  await ui.editTime("19:30");
  const saveButton = [...document.querySelectorAll("button")].find(node => node.textContent === "기본 시간표 저장 중");
  assert.ok(saveButton, "reopening shows the same class's pending save");
  assert.equal(saveButton.disabled, true);
  await act(async () => saveButton.click());
  assert.equal(ui.requests.filter(request => request.type === "save").length, 2);
  await ui.resolve(1, defaultsFor("18:00", 2));
  assert.equal(ui.time(), "19:30", "the previous lifetime cannot replace the reopened draft");
  assert.doesNotMatch(ui.text(), /기본 시간표 저장 완료/);
  await ui.click("기본 시간표 저장");
  assert.deepEqual(ui.requests.filter(request => request.type === "save").map(request => request.input.classId), ["a", "b", "a"]);
  await ui.resolve(3, defaultsFor("19:00", 9));
  assert.match(ui.text(), /기본 시간표 저장 중/, "B completion must not unlock A's newer request");
  await ui.resolve(5, defaultsFor("19:30", 3));
  assert.match(ui.text(), /기본 시간표 저장 완료/);
});

function studentFixture(fixture, serviceNames, relatedClassIds = []) {
  fixture.rows.splice(0, fixture.rows.length, {
    ...classRow("student-a", "김학생"), kind: "students", badge: "중1", badgeValue: "중1",
    raw: { id: "student-a", name: "김학생", grade: "중1", status: "재원", class_ids: relatedClassIds, waitlist_class_ids: [] },
  });
  fixture.records.totalCount = 1;
  deferServices(fixture, serviceNames);
}

function deferServices(fixture, names) {
  fixture.mutations = [];
  for (const name of names) {
    fixture.service[name] = (...args) => {
      const deferred = Promise.withResolvers();
      fixture.mutations.push({ name, args, ...deferred });
      return deferred.promise;
    };
  }
}

test("dirty student close keeps the draft until explicit discard and restores focus after continuing", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 수정");
  const input = document.getElementById("students-detail-name");
  await act(async () => input.focus());
  const unload = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  await ui.escape();
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.ok(document.activeElement === input, "continue returns to the field that requested Escape");
  assert.equal(input.value, "김학생 수정");
  await ui.click("학생 정보 닫기");
  await ui.click("변경사항 버리기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  const cleanUnload = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(cleanUnload);
  assert.equal(cleanUnload.defaultPrevented, false);
});

test("unchanged and trim-equivalent student drafts close without confirmation", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", " 김학생 ");
  await ui.click("학생 정보 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("dirty student return navigation waits for discard and keeps the draft after cancelling", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.navigate(`studentId=student-a&returnTo=${encodeURIComponent("/admin/classes?classId=a&tab=students")}`);
  await ui.click("김학생");
  await ui.editField("students-detail-name", "돌아가기 전 초안");
  await ui.click("수업 상세");
  assert.deepEqual(ui.navigationCalls, []);
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-detail-name").value, "돌아가기 전 초안");
  await ui.click("수업 상세");
  await ui.click("변경사항 버리기");
  assert.deepEqual(ui.navigationCalls, ["/admin/classes?classId=a&tab=students"]);
  assert.equal(ui.mutations.length, 0);
});

test("opening and closing a detail records its URL immediately while preserving list context", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.navigate("school=제주중&page=2");
  await ui.click("김학생");
  assert.equal(new URLSearchParams(window.location.search).get("studentId"), "student-a");
  assert.equal(new URLSearchParams(window.location.search).get("school"), "제주중");
  assert.equal(new URLSearchParams(window.location.search).get("page"), "2");
  await ui.click("학생 정보 닫기");
  assert.equal(new URLSearchParams(window.location.search).get("studentId"), null);
  assert.equal(new URLSearchParams(window.location.search).get("school"), "제주중");
  assert.equal(new URLSearchParams(window.location.search).get("page"), "2");
});

test("same-document Back and Forward stop before route restoration and require a fresh decision", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "기록 이동 전 초안");
  assert.equal(await ui.traverse("previous-entry"), true);
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-detail-name").value, "기록 이동 전 초안");
  assert.deepEqual(ui.traversals, []);
  assert.equal(await ui.traverse("next-entry"), true);
  // Multiple history attempts while the dialog is open cannot change its intent.
  assert.equal(await ui.traverse("previous-entry"), true);
  await ui.click("변경사항 버리기");
  assert.deepEqual(ui.traversals, ["next-entry"]);
  assert.equal(await ui.traverse("next-entry"), false, "the approved traversal is consumed exactly once");
  assert.equal(await ui.traverse("next-entry"), true, "a later traversal is guarded again");
});

test("captured in-app links share the dirty confirmation but modifier clicks remain independent", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "링크 이동 전 초안");
  const link = document.createElement("a");
  link.href = "/admin/tasks?view=mine";
  document.body.append(link);
  t.after(() => link.remove());
  // Stop JSDOM's unsupported actual navigation after observing the capture phase.
  let captured = false;
  link.addEventListener("click", event => { captured = event.defaultPrevented; event.preventDefault(); });
  await act(async () => link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })));
  assert.equal(captured, false);
  assert.equal(document.querySelector('[data-testid="management-discard-confirm-dialog"]'), null);
  await act(async () => link.click());
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  assert.deepEqual(ui.navigationCalls, []);
  await ui.click("변경사항 버리기");
  assert.deepEqual(ui.navigationCalls, ["/admin/tasks?view=mine"]);
});

test("application-wide command navigation uses the same draft decision and releases on unmount", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  const destinations = [];
  await act(async () => requestAppNavigation(() => destinations.push("clean")));
  assert.deepEqual(destinations, ["clean"]);
  await ui.click("김학생");
  await ui.editField("students-detail-name", "빠른 이동 전 초안");
  await act(async () => requestAppNavigation(() => destinations.push("discard")));
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  assert.deepEqual(destinations, ["clean"]);
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-detail-name").value, "빠른 이동 전 초안");
  await act(async () => requestAppNavigation(() => destinations.push("confirmed")));
  await ui.click("변경사항 버리기");
  assert.deepEqual(destinations, ["clean", "confirmed"]);
  await ui.unmount();
  requestAppNavigation(() => destinations.push("unmounted"));
  assert.deepEqual(destinations, ["clean", "confirmed", "unmounted"]);
});

test("a failed save keeps discard protection and a successful retry accepts only its submitted draft", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 수정");
  await ui.click("저장");
  await act(async () => ui.mutations[0].reject(new Error("검수 실패")));
  await ui.click("학생 정보 닫기");
  await ui.click("계속 편집");
  await ui.click("저장");
  await act(async () => ui.mutations[1].resolve({ id: "student-a" }));
  await ui.click("학생 정보 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null, "successful saving does not ask to discard the accepted form");
});

test("edits typed during an accepted save remain protected as a newer draft", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 제출");
  await ui.click("저장");
  await ui.editField("students-detail-name", "김학생 다음 입력");
  await act(async () => ui.mutations[0].resolve({ id: "student-a" }));
  await ui.click("학생 정보 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-detail-name").value, "김학생 다음 입력");
});

test("pending save coverage belongs to its original detail lifetime, including reopening the same student", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "제출한 이전 입력");
  await ui.click("저장");
  await ui.click("학생 정보 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null, "the submitted draft may leave during its save");
  await ui.click("김학생");
  await ui.editField("students-detail-name", "아직 제출하지 않은 새 입력");
  await ui.click("학생 정보 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-detail-name").value, "아직 제출하지 않은 새 입력");
  assert.equal(ui.mutations.length, 1);
});

for (const nextName of ["새로운 후속 입력", "김학생"]) {
  test(`pending save coverage preserves later student edits, including reverting to ${nextName}`, async t => {
    const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
    await ui.navigate(`studentId=student-a&returnTo=${encodeURIComponent("/admin/classes?classId=a")}`);
    await ui.click("김학생");
    await ui.editField("students-detail-name", "제출한 입력");
    await ui.click("저장");
    await ui.editField("students-detail-name", nextName);
    const unload = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    assert.equal(await ui.traverse("previous-entry"), true);
    await ui.click("계속 편집");
    await ui.click("수업 상세");
    assert.deepEqual(ui.navigationCalls, []);
    await ui.click("계속 편집");
    await ui.click("학생 정보 닫기");
    assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
    await ui.click("계속 편집");
    assert.equal(document.getElementById("students-detail-name").value, nextName);
  });
}

test("pending save coverage locks student creation fields and restores them after failure", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["createStudent"]) });
  await ui.click("수업 등록");
  await ui.editField("students-form-name", "제출한 등록명");
  await ui.submitTogether();
  assert.equal(document.getElementById("students-form-name").disabled, true);
  assert.equal(document.getElementById("students-form-status").disabled, true);
  await act(async () => ui.mutations[0].reject(new Error("생성 실패")));
  assert.equal(document.getElementById("students-form-name").disabled, false);
  assert.equal(document.getElementById("students-form-status").disabled, false);
  assert.equal(document.getElementById("students-form-name").value, "제출한 등록명");
  await ui.click("학생 정보 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  await ui.submitTogether();
  await ui.click("학생 정보 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null, "submitted creation can still leave while saving");
  assert.equal(ui.mutations.length, 2);
});

for (const [kind, serviceName, fieldIds] of [
  ["classes", "createClass", ["name", "status", "teacher", "schedule", "classroom", "capacity", "fee"]],
  ["textbooks", "createTextbook", ["title", "price", "tags"]],
]) {
  test(`pending save coverage locks ${kind} creation controls while preserving exit`, async t => {
    const ui = await setup(t, { kind, configureFixture: fixture => deferServices(fixture, [serviceName]) });
    await ui.click("수업 등록");
    await ui.editField(`${kind}-form-${fieldIds[0]}`, "신규 등록");
    await ui.submitTogether();
    for (const field of fieldIds) assert.equal(document.getElementById(`${kind}-form-${field}`).disabled, true, `${field} must be locked`);
    await ui.escape();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.mutations.length, 1);
  });
}

test("class creation protects free-text schedule drafts before their values can be normalized", async t => {
  const ui = await setup(t);
  await ui.click("수업 등록");
  await ui.editField("classes-form-schedule", "월요일 시간 입력 중");
  await ui.escape();
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  assert.equal(document.getElementById("classes-form-schedule").value, "월요일 시간 입력 중");
});

test("pending save coverage never includes a dirty form in a relation mutation", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["assignStudentToClass"], ["class-a"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "관계 변경과 별도인 이름");
  await ui.click("대기 전환");
  await ui.click("학생 정보 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  assert.equal(ui.mutations[0].name, "assignStudentToClass");
});

test("pending save coverage does not follow a normalized schedule into a reopened class", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await ui.click("A 영어반");
  await ui.resolve(2, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  assert.equal(ui.requests.filter(request => request.type === "save").length, 1);
});

test("pending save coverage for only a normalized schedule leaves class fields protected", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "미제출 수업명");
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
});

for (const nextTime of ["19:00", "17:00"]) {
  test(`pending save coverage preserves later schedule edits, including reverting to ${nextTime}`, async t => {
    const ui = await setup(t);
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    await ui.editTime("18:00");
    await ui.click("기본 시간표 저장");
    await ui.editTime(nextTime);
    await ui.click("수업 상세 닫기");
    assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
    await ui.click("계속 편집");
    assert.equal(ui.time(), nextTime);
  });
}

test("pending save coverage for class fields excludes its unsaved normalized schedule", async t => {
  const ui = await setup(t, { configureFixture: fixture => deferServices(fixture, ["updateClass"]) });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "제출할 수업명");
  await ui.editTime("18:00");
  await ui.click("저장");
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
});

test("pending save coverage combines separately submitted class fields and schedule", async t => {
  const ui = await setup(t, { configureFixture: fixture => deferServices(fixture, ["updateClass"]) });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "제출할 수업명");
  await ui.editTime("18:00");
  await ui.click("저장");
  await ui.click("기본 시간표 저장");
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("pending save coverage compares legacy schedule submissions canonically", async t => {
  const ui = await setup(t, { configureFixture: fixture => {
    for (const row of fixture.rows) row.raw.schedule_storage_mode = "legacy";
    deferServices(fixture, ["updateClass"]);
  } });
  await ui.click("A 영어반");
  await ui.editTime("18:00");
  await ui.click("저장");
  await ui.editTime("19:00");
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  await ui.editTime("18:00");
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null, "returning to the submitted slots is covered");
});

test("untouched normalized defaults do not become a dirty form after asynchronous normalization", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor("17:30", 4));
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("normalized schedule saving clears only the schedule draft, preserving unsaved class fields", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "새 수업명");
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.resolve(1, defaultsFor("18:00", 2));
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.click("계속 편집");
  assert.equal(document.getElementById("classes-detail-name").value, "새 수업명");
});

test("saving only the normalized schedule permits a clean close", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("기본 시간표 저장");
  await ui.resolve(1, defaultsFor("18:00", 2));
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("saving class information does not clear an unsaved normalized schedule", async t => {
  const ui = await setup(t);
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editTime("18:00");
  await ui.click("저장");
  await ui.click("수업 상세 닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'));
  await ui.escape();
  assert.equal(document.querySelector('[data-testid="management-discard-confirm-dialog"]'), null);
  assert.equal(ui.time(), "18:00", "Escape cancels only the discard confirmation");
});

test("legacy schedule drafts compare canonical slots and accept a completed general save", async t => {
  const ui = await setup(t, { configureFixture: fixture => {
    for (const row of fixture.rows) row.raw.schedule_storage_mode = "legacy";
  } });
  await ui.click("A 영어반");
  await ui.editTime("18:00");
  await ui.editTime("16:00");
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null, "reverting the time does not become dirty because of formatting");
  await ui.click("A 영어반");
  await ui.editTime("18:00");
  await ui.click("수업 상세 닫기");
  await ui.click("계속 편집");
  await ui.click("저장");
  await ui.click("수업 상세 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test("new student drafts require explicit discard while untouched creation can close", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  await ui.click("수업 등록");
  await ui.click("학생 정보 닫기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await ui.click("수업 등록");
  await ui.editField("students-form-name", "새학생");
  await ui.click("학생 정보 닫기");
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-form-name").value, "새학생");
});

for (const action of ["저장", "대기 전환", "수강 해제"]) {
  for (const outcome of ["success", "failure"]) {
    test(`late student ${action} ${outcome} cannot replace the next detail or publish its status`, async t => {
      const refreshes = [];
      const ui = await setup(t, { kind: "students", configureFixture: fixture => {
        studentFixture(fixture, ["updateStudent", "assignStudentToClass", "removeStudentFromClass"], ["class-a"]);
        fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
        fixture.records.refresh = async () => { refreshes.push(true); };
      } });
      await ui.click("김학생");
      await ui.click(action);
      await ui.click("학생 정보 닫기");
      await ui.click("이학생");
      await ui.editField("students-detail-name", "이학생 다음 입력");
      await act(async () => {
        if (outcome === "success") ui.mutations[0].resolve({ id: "student-a" });
        else ui.mutations[0].reject(new Error("이전 학생 저장 실패"));
      });
      assert.match(ui.title(), /이학생/, "the response belongs to the closed detail");
      assert.equal(document.getElementById("students-detail-name").value, "이학생 다음 입력");
      assert.doesNotMatch(ui.text(), /저장 완료|대기 전환 완료|연결 해제 완료|이전 학생 저장 실패/);
      assert.equal(refreshes.length, outcome === "success" ? 1 : 0, "accepted writes still refresh the list");
    });
  }
}

for (const outcome of ["success", "failure"]) {
  test(`late create ${outcome} cannot close a new detail or publish its status`, async t => {
    const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["createStudent"]) });
    await ui.click("수업 등록");
    await ui.editField("students-form-name", "새학생");
    await ui.submitTogether();
    await ui.click("학생 정보 닫기");
    await ui.click("김학생");
    await act(async () => {
      if (outcome === "success") ui.mutations[0].resolve({ id: "student-new" });
      else ui.mutations[0].reject(new Error("이전 등록 실패"));
    });
    assert.match(ui.title(), /김학생/);
    assert.doesNotMatch(ui.text(), /이전 등록 실패/);
  });
}

test("reopening the same student isolates its new draft from the previous save", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 이전 입력");
  await ui.click("저장");
  await ui.click("학생 정보 닫기");
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 새 입력");
  await act(async () => ui.mutations[0].resolve({ id: "student-a" }));
  assert.equal(document.getElementById("students-detail-name").value, "김학생 새 입력");
  assert.doesNotMatch(ui.text(), /저장 완료/);
});

test("closing during the saved row refresh prevents publication into the next detail", async t => {
  const refresh = Promise.withResolvers();
  const ui = await setup(t, { kind: "students", configureFixture: fixture => {
    studentFixture(fixture, ["updateStudent"]);
    fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
    fixture.records.refresh = () => refresh.promise;
  } });
  await ui.click("김학생");
  await ui.click("저장");
  await act(async () => ui.mutations[0].resolve({ id: "student-a" }));
  await ui.click("학생 정보 닫기");
  await ui.click("이학생");
  await act(async () => refresh.resolve(undefined));
  assert.match(ui.title(), /이학생/);
  assert.doesNotMatch(ui.text(), /저장 완료/);
});

test("late relation addition keeps the new detail's relation candidate intact", async t => {
  const ui = await setup(t, {
    kind: "students",
    configureFixture: fixture => {
      studentFixture(fixture, ["assignStudentToClass"]);
      fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
    },
    componentOverrides: [["./management-relation-combobox", {
      ManagementRelationCombobox: ({ onSelect, disabled }) => createElement("button", {
        type: "button", disabled, onClick: () => onSelect("new-class"),
      }, "검수 수업 선택"),
    }]],
  });
  await ui.click("김학생");
  await ui.click("검수 수업 선택");
  await ui.click("수강 추가");
  await ui.click("수강 추가");
  await ui.click("학생 정보 닫기");
  await ui.click("이학생");
  await ui.click("검수 수업 선택");
  await act(async () => ui.mutations[0].resolve(undefined));
  assert.match(ui.title(), /이학생/);
  assert.doesNotMatch(ui.text(), /등록 학생 추가 완료/);
  await ui.click("수강 추가");
  await ui.click("수강 추가");
  assert.deepEqual(ui.mutations[1].args[0], { studentId: "student-b", classId: "new-class", mode: "enrolled" });
  await act(async () => ui.mutations[1].resolve(undefined));
});

for (const retry of [false, true]) {
  test(`late class initialization ${retry ? "retry" : "create"} finishes its write without closing the next detail`, async t => {
    const refreshes = [];
    const ui = await setup(t, { configureFixture: fixture => {
      deferServices(fixture, ["createClass", "initializeClassSchedule"]);
      fixture.service.getClassScheduleDefaults = async () => ({ runtimeVersion: 1, authoritativeSource: "legacy", scheduleRevision: 0, schedulePlanHash: "created-class-plan" });
      fixture.records.refresh = async () => { refreshes.push(true); };
    } });
    await ui.click("수업 등록");
    await ui.editField("classes-form-name", "새 수업");
    await ui.submitTogether();
    if (retry) {
      await act(async () => ui.mutations[0].resolve({ id: "created-class" }));
      await act(async () => ui.mutations[1].reject(new Error("검수 초기화 실패")));
      await ui.click("기본 시간표 초기화 다시 시도");
    }
    await ui.click("모달 닫기");
    await ui.click("B 영어반");
    if (!retry) await act(async () => ui.mutations[0].resolve({ id: "created-class" }));
    const initialization = ui.mutations.at(-1);
    assert.equal(initialization.name, "initializeClassSchedule");
    assert.equal(initialization.args[0].classId, "created-class");
    await act(async () => initialization.resolve(undefined));
    assert.match(ui.title(), /B 영어반/);
    assert.doesNotMatch(ui.text(), /기본 시간표 초기화 다시 시도|검수 초기화 실패/);
    assert.equal(refreshes.length, 1, "the accepted class write still refreshes the list");
  });
}

for (const boundary of ["create", "defaults"]) {
  for (const change of ["account", "role", "logout", "unmount"]) {
    test(`class creation stops follow-up RPCs after ${change} during ${boundary}`, async t => {
      const ui = await setup(t, { configureFixture: fixture => {
        deferServices(fixture, ["createClass", "initializeClassSchedule"]);
      } });
      await ui.click("수업 등록");
      await ui.editField("classes-form-name", "원래 계정의 신규 수업");
      await ui.submitTogether();
      if (boundary === "defaults") {
        await act(async () => ui.mutations[0].resolve({ id: "created-class" }));
        assert.equal(ui.requests.filter(request => request.type === "defaults").length, 1);
      }
      if (change === "account") await ui.actor("other-actor", "admin");
      else if (change === "role") await ui.actor("staff-a", "teacher");
      else if (change === "logout") await ui.actor(null, null);
      else await ui.unmount();
      if (boundary === "create") {
        await act(async () => ui.mutations[0].resolve({ id: "created-class" }));
        assert.equal(ui.requests.filter(request => request.type === "defaults").length, 0, "old page cannot begin a new read using the current session");
      } else {
        await ui.resolve(0, { runtimeVersion: 1, authoritativeSource: "legacy", scheduleRevision: 0, schedulePlanHash: "created-class-plan" });
      }
      assert.equal(ui.mutations.filter(mutation => mutation.name === "initializeClassSchedule").length, 0, "old page cannot begin another write after its actor lifetime ends");
    });
  }
}

test("student detail save rejects same-tick duplicate and bulk writes, then retries the preserved draft after failure", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "김학생 수정");
  await ui.clickTogether("저장", "저장", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1, "one detail gesture owns the shared mutation slot");
  assert.equal(ui.mutations[0].args[0].name, "김학생 수정");
  await act(async () => ui.mutations[0].reject(new Error("검수 저장 실패")));
  assert.equal(document.getElementById("students-detail-name").value, "김학생 수정");
  await ui.click("저장");
  assert.equal(ui.mutations.length, 2, "failed requests release the mutation slot for retry");
  await act(async () => ui.mutations[1].resolve({ id: "student-a" }));
});

test("bulk update owns the same mutation slot as detail save and can retry after failure", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["updateStudent"]) });
  await ui.click("김학생");
  await ui.clickTogether("검수 일괄 수정", "검수 일괄 수정", "저장");
  assert.equal(ui.mutations.length, 1, "a bulk request cannot be repeated or interleaved with detail save");
  assert.equal(ui.mutations[0].args[0].grade, "중2");
  await act(async () => ui.mutations[0].reject(new Error("검수 일괄 저장 실패")));
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[1].resolve({ id: "student-a" }));
});

test("create submit rejects duplicate and competing mutations and releases its slot on failure", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["createStudent", "updateStudent"]) });
  await ui.click("수업 등록");
  await ui.editField("students-form-name", "새학생");
  await ui.submitTogether();
  await ui.clickTogether("검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].name, "createStudent");
  await act(async () => ui.mutations[0].reject(new Error("검수 등록 실패")));
  assert.equal(document.getElementById("students-form-name").value, "새학생");
  await ui.submitTogether();
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[1].resolve({ id: "student-new" }));
  assert.equal(document.querySelector('[role="dialog"] form'), null);
});

test("confirmed deletion rejects duplicate confirmation and releases the slot for a new confirmation after failure", async t => {
  const ui = await setup(t, { kind: "textbooks", configureFixture: fixture => {
    fixture.rows.splice(0, fixture.rows.length, { ...classRow("book-a", "교재 A"), kind: "textbooks", raw: { id: "book-a", title: "교재 A" } });
    fixture.records.totalCount = 1;
    deferServices(fixture, ["deleteTextbook", "updateTextbook"]);
  } });
  await ui.click("검수 삭제 요청");
  await ui.clickTogether("삭제", "삭제", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].name, "deleteTextbook");
  await act(async () => ui.mutations[0].reject(new Error("검수 삭제 실패")));
  await ui.click("검수 삭제 요청");
  await ui.click("삭제");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[1].resolve(undefined));
});

for (const action of ["대기 전환", "수강 해제"]) {
  test(`${action} serializes relation writes with detail save and can retry after failure`, async t => {
    const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, ["assignStudentToClass", "removeStudentFromClass", "updateStudent"], ["class-a"]) });
    await ui.click("김학생");
    await ui.clickTogether(action, action, "저장");
    assert.equal(ui.mutations.length, 1);
    assert.equal(ui.mutations[0].name, action === "대기 전환" ? "assignStudentToClass" : "removeStudentFromClass");
    await act(async () => ui.mutations[0].reject(new Error("검수 관계 변경 실패")));
    await ui.click(action);
    assert.equal(ui.mutations.length, 2);
    await act(async () => ui.mutations[1].resolve(undefined));
  });
}

test("confirmed relation addition shares the mutation slot with detail save and preserves the candidate after failure", async t => {
  const ui = await setup(t, {
    kind: "students",
    configureFixture: fixture => studentFixture(fixture, ["assignStudentToClass", "updateStudent"]),
    componentOverrides: [["./management-relation-combobox", {
      ManagementRelationCombobox: ({ onSelect, disabled }) => createElement("button", {
        type: "button", disabled, onClick: () => onSelect("new-class"),
      }, "검수 수업 선택"),
    }]],
  });
  await ui.click("김학생");
  await ui.click("검수 수업 선택");
  await ui.click("수강 추가");
  await ui.clickTogether("수강 추가", "수강 추가", "저장");
  assert.equal(ui.mutations.length, 1);
  assert.deepEqual(ui.mutations[0].args[0], { studentId: "student-a", classId: "new-class", mode: "enrolled" });
  await act(async () => ui.mutations[0].reject(new Error("검수 연결 실패")));
  await ui.click("수강 추가");
  await ui.click("수강 추가");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[1].resolve(undefined));
});

test("the mutation slot stays occupied until the saved row has been reconciled", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => {
    studentFixture(fixture, ["updateStudent"]);
    fixture.refreshes = [];
    fixture.records.refresh = () => {
      const deferred = Promise.withResolvers();
      fixture.refreshes.push(deferred);
      return deferred.promise;
    };
  } });
  await ui.click("김학생");
  await ui.click("저장");
  await act(async () => ui.mutations[0].resolve({ id: "student-a" }));
  assert.equal(ui.refreshes.length, 1);
  await ui.clickTogether("검수 일괄 수정");
  assert.equal(ui.mutations.length, 1, "a successful write still owns the slot during refresh");
  await act(async () => ui.refreshes[0].resolve(undefined));
  await ui.click("저장");
  assert.equal(ui.mutations.length, 2, "reconciliation completion releases the slot");
  await act(async () => ui.mutations[1].reject(new Error("검수 저장 실패")));
});

test("a partially failed bulk update holds its slot until the remaining row write settles", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => {
    studentFixture(fixture, ["updateStudent"]);
    fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
  } });
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[0].reject(new Error("첫 행 저장 실패")));
  await ui.clickTogether("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2, "the second row is still being written");
  await act(async () => ui.mutations[1].resolve({ id: "student-b" }));
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 4, "retry is allowed after the entire previous batch settles");
  await act(async () => { ui.mutations[2].resolve({ id: "student-a" }); ui.mutations[3].resolve({ id: "student-b" }); });
});

test("a partially failed bulk deletion holds its slot until the remaining deletion settles", async t => {
  const ui = await setup(t, { kind: "textbooks", configureFixture: fixture => {
    fixture.rows.splice(0, fixture.rows.length, ...["a", "b"].map(id => ({ ...classRow(`book-${id}`, `교재 ${id}`), kind: "textbooks", raw: { id: `book-${id}`, title: `교재 ${id}` } })));
    deferServices(fixture, ["deleteTextbook"]);
  } });
  await ui.click("검수 삭제 요청");
  await ui.click("삭제");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[0].reject(new Error("첫 행 삭제 실패")));
  await ui.click("검수 삭제 요청");
  const confirmation = document.querySelector('[role="dialog"] button[data-variant="destructive"]');
  assert.ok(confirmation);
  assert.equal(confirmation.disabled, true, "confirmation stays disabled while another row is deleting");
  await act(async () => confirmation.click());
  assert.equal(ui.mutations.length, 2, "the second deletion still owns the batch slot");
  await act(async () => ui.mutations[1].resolve(undefined));
  await ui.click("삭제");
  assert.equal(ui.mutations.length, 4);
  await act(async () => { ui.mutations[2].resolve(undefined); ui.mutations[3].resolve(undefined); });
});

test("class initialization retry rejects same-tick repeats while preserving the created class", async t => {
  const ui = await setup(t, { configureFixture: fixture => {
    deferServices(fixture, ["createClass", "initializeClassSchedule", "updateClass"]);
    fixture.service.getClassScheduleDefaults = async () => ({ runtimeVersion: 1, authoritativeSource: "legacy", scheduleRevision: 0, schedulePlanHash: "created-class-plan" });
  } });
  await ui.click("수업 등록");
  await ui.editField("classes-form-name", "새 수업");
  await ui.submitTogether();
  assert.equal(ui.mutations.length, 1);
  await act(async () => ui.mutations[0].resolve({ id: "created-class" }));
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[1].reject(new Error("검수 초기화 실패")));
  await ui.clickTogether("기본 시간표 초기화 다시 시도", "기본 시간표 초기화 다시 시도", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 3);
  assert.equal(ui.mutations[2].name, "initializeClassSchedule");
  assert.equal(ui.mutations[2].args[0].classId, "created-class");
  await act(async () => ui.mutations[2].reject(new Error("검수 초기화 실패")));
  await ui.click("기본 시간표 초기화 다시 시도");
  assert.equal(ui.mutations.length, 4);
  await act(async () => ui.mutations[3].resolve(undefined));
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
  await ui.click("변경사항 버리기");
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
