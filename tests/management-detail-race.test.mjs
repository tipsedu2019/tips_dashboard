import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import ts from "typescript";
import { configureSnapshotFixture, snapshotStudentId } from "./helpers/management-relation-snapshot-fixture.mjs";
import { classRow, createManagementDetailFixture, defaultsFor } from "./helpers/management-detail-fixture.mjs";
import { requestAppNavigation } from "../src/lib/guarded-navigation.ts";
import { extractManagementReconcile } from "../scripts/measure-management-refresh.mjs";

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
      actions.onBulkUpdateRows && createElement("button", { onClick: async () => {
        const result = await actions.onBulkUpdateRows(rows, { field: "grade", value: "중2" });
        fixture.bulkResults?.push(result);
      } }, "검수 일괄 수정"),
      actions.onBulkDeleteRows && createElement("button", { onClick: () => actions.onBulkDeleteRows(rows) }, "검수 삭제 요청"),
      ...rows.map(row => createElement("button", { key: row.id, onClick: () => actions.onOpenRow(row) }, row.title))) }],
    ["@/components/ui/date-time-picker", { TimePickerControl: ({ value, onChange, ariaLabel, disabled }) => createElement("input", { "aria-label": ariaLabel, value, disabled, onChange: event => onChange(event.target.value) }) }],
    ...componentOverrides,
  ]);
  if (fixture.actualTable) overrides.delete("./management-data-table");
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
  const page = load(new URL("src/features/management/management-page.tsx", repo));
  fixture.bindProduction?.(load);
  return page;
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

function relationPaginationFixture(fixture, relationKind = "registered_students") {
  fixture.relationRequests = [];
  fixture.relationMutations = [];
  for (const row of fixture.rows) {
    row.raw[`${relationKind}_relation_page`] = { rows: [], hasMore: true, nextCursor: `${row.id}:first` };
  }
  fixture.records.loadRelationPage = input => {
    const deferred = Promise.withResolvers();
    fixture.relationRequests.push({ input, ...deferred });
    return deferred.promise;
  };
  for (const name of ["updateClass", "saveClassScheduleDefaults", "replaceClassGroupMemberships", "updateStudent", "addStudentClass", "removeStudentClass"]) {
    fixture.service[name] = async () => { fixture.relationMutations.push(name); throw new Error("unexpected mutation"); };
  }
}

function snapshotRoster() {
  const roster = document.querySelector('[data-testid="class-enrolled-student-roster"]');
  assert.ok(roster);
  const buttons = [...roster.querySelectorAll("button")];
  return {
    ids: [...roster.querySelectorAll('[data-class-roster-student-id]')].map(node => node.getAttribute('data-class-roster-student-id')),
    next: buttons.find(button => button.textContent.trim() === "다음 30건"),
    loading: buttons.find(button => button.textContent.trim() === "더 불러오는 중"),
  };
}

async function removeSnapshotStudent() {
  const trigger = document.querySelector('[aria-label="합성 학생 001 학생 관리"]');
  assert.ok(trigger);
  assert.equal(trigger.disabled, false, "a pending relation read does not disable the existing mutation");
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  const item = document.querySelector('[role="menuitem"][aria-label="합성 학생 001 수강 해제"]');
  assert.ok(item);
  assert.notEqual(item.getAttribute("data-disabled"), "");
  await act(async () => item.click());
}

async function openSnapshotWithPendingLastPage(t) {
  const ui = await setup(t, { configureFixture: configureSnapshotFixture });
  await ui.click("합성 경합 수업");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "보존할 상세 초안");
  assert.equal(snapshotRoster().ids.length, 30);
  await ui.click("다음 30건");
  await act(async () => ui.snapshotState.finishPage(0));
  assert.equal(snapshotRoster().ids.length, 60);
  await ui.click("다음 30건");
  assert.equal(ui.snapshotState.relationReads.length, 2);
  assert.equal(ui.snapshotState.relationReads[1].frozenPage.rows[0].id, snapshotStudentId(61));
  assert.ok(snapshotRoster().loading?.disabled);
  return ui;
}

for (const mutation of ["none", "rejected"]) {
  test(`relation snapshot keeps the current page after ${mutation} mutation`, async t => {
    const ui = await openSnapshotWithPendingLastPage(t);
    const state = ui.snapshotState;
    if (mutation === "rejected") {
      await removeSnapshotStudent();
      await act(async () => state.finishWrite(false));
      assert.match(ui.text(), /합성 수강 해제 실패/);
    }
    await act(async () => state.finishPage(1));
    const roster = snapshotRoster();
    assert.deepEqual(roster.ids, state.roster().map(row => row.id));
    assert.equal(roster.ids.length, 90);
    assert.equal(roster.next, undefined);
    assert.equal(roster.loading, undefined);
    assert.equal(state.writes.length, mutation === "none" ? 0 : 1);
    assert.equal(document.getElementById("classes-detail-name").value, "보존할 상세 초안");
  });
}

for (const oldOutcome of ["success", "failure"]) {
  test(`relation snapshot replacement rejects old ${oldOutcome} and pages from the fresh cursor`, async t => {
    const ui = await openSnapshotWithPendingLastPage(t);
    const state = ui.snapshotState;
    await removeSnapshotStudent();
    await act(async () => state.finishWrite(true));
    assert.match(ui.text(), /연결 해제 완료/);
    assert.equal(state.writes.length, 1);
    assert.equal(state.detailReads.length, 2);
    assert.equal(state.detailReads[1].registeredCount, 89);
    assert.equal(snapshotRoster().ids.length, 30);
    assert.equal(snapshotRoster().loading, undefined, "new snapshot releases the obsolete read slot");
    assert.ok(snapshotRoster().next);
    await ui.click("다음 30건");
    assert.equal(state.relationReads.length, 3);
    assert.equal(state.relationReads[2].args.p_cursor_id, snapshotStudentId(31), "discard the old cursor at 060");
    if (oldOutcome === "success") {
      await act(async () => state.finishPage(1));
    } else {
      await act(async () => state.relationReads[1].reject(new Error("변경 전 페이지 실패")));
    }
    assert.equal(snapshotRoster().ids.length, 30, "old result cannot append to the new snapshot");
    assert.ok(snapshotRoster().loading?.disabled, "old finally cannot clear the new request's loading");
    assert.doesNotMatch(ui.text(), /변경 전 페이지 실패/);
    await act(async () => state.finishPage(2));
    assert.equal(snapshotRoster().ids.length, 60);
    await ui.click("다음 30건");
    assert.equal(state.relationReads[3].args.p_cursor_id, snapshotStudentId(61));
    await act(async () => state.finishPage(3));
    const roster = snapshotRoster();
    assert.deepEqual(roster.ids, state.roster().map(row => row.id));
    assert.equal(roster.ids.length, 89);
    assert.equal(roster.next, undefined);
    assert.equal(roster.loading, undefined);
    assert.equal(document.getElementById("classes-detail-name").value, "보존할 상세 초안");
    assert.equal(state.writes.length, 1);
    t.diagnostic(JSON.stringify({ metric: "same-detail-fresh-relation-snapshot", oldOutcome, visible: roster.ids.length, expected: state.roster().length, syntheticWrites: state.writes.length }));
  });
}

test("relation pagination keeps the new detail cursor after a closed detail resolves", async t => {
  const ui = await setup(t, { configureFixture: relationPaginationFixture });
  const relationRequests = ui.relationRequests;
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("다음 30건");
  await ui.click("수업 상세 닫기");
  await ui.click("B 영어반");
  await ui.resolve(1, defaultsFor());
  const blockedNewDetailUntilOldSettled = [...document.querySelectorAll("button")].some(button => button.textContent.trim() === "더 불러오는 중" && button.disabled);
  await act(async () => relationRequests[0].resolve({ page: { rows: [], hasMore: true, nextCursor: "a:stale-next" } }));
  await ui.click("다음 30건");
  const observation = {
    blockedNewDetailUntilOldSettled,
    nextDetailId: relationRequests[1].input.id,
    nextDetailCursor: relationRequests[1].input.cursor,
    mutations: ui.relationMutations.length,
  };
  t.diagnostic(JSON.stringify({ metric: "relation-pagination-closed-detail", ...observation }));
  assert.deepEqual(observation, { blockedNewDetailUntilOldSettled: false, nextDetailId: "b", nextDetailCursor: "b:first", mutations: 0 });
  await act(async () => relationRequests[1].resolve({ page: { rows: [], hasMore: false, nextCursor: null } }));
});

test("relation pagination appends the current page once, preserves edits and finishes at the final page", async t => {
  const ui = await setup(t, { configureFixture: relationPaginationFixture });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "보존할 페이지 초안");
  await ui.clickTogether("다음 30건", "다음 30건");
  assert.equal(ui.relationRequests.length, 1, "same-tick clicks share one read slot");
  await act(async () => ui.relationRequests[0].resolve({ page: { rows: [{ id: "synthetic-student", name: "합성 다음 학생" }], hasMore: false, nextCursor: null } }));
  assert.match(document.querySelector('[data-testid="class-enrolled-student-roster"]').textContent, /합성 다음 학생/);
  assert.equal(document.getElementById("classes-detail-name").value, "보존할 페이지 초안");
  assert.equal([...document.querySelectorAll("button")].some(button => /다음 30건|더 불러오는 중/.test(button.textContent)), false);
  assert.equal(ui.relationMutations.length, 0);
});

test("relation pagination ignores a late final page after reopening the same row", async t => {
  const ui = await setup(t, { configureFixture: relationPaginationFixture });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("다음 30건");
  await ui.click("수업 상세 닫기");
  await ui.click("A 영어반");
  await ui.resolve(1, defaultsFor());
  await act(async () => ui.relationRequests[0].resolve({ page: { rows: [{ id: "old-student", name: "이전 상세 학생" }], hasMore: false, nextCursor: null } }));
  assert.doesNotMatch(ui.text(), /이전 상세 학생/);
  await ui.click("다음 30건");
  assert.equal(ui.relationRequests[1].input.cursor, "a:first");
  await act(async () => ui.relationRequests[1].resolve({ page: { rows: [], hasMore: false, nextCursor: null } }));
  assert.equal(ui.relationMutations.length, 0);
});

for (const outcome of ["success", "failure"]) {
  test(`relation pagination old ${outcome} cannot release or overwrite a new detail read`, async t => {
    const ui = await setup(t, { configureFixture: relationPaginationFixture });
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    await ui.click("다음 30건");
    await ui.click("수업 상세 닫기");
    await ui.click("B 영어반");
    await ui.resolve(1, defaultsFor());
    await ui.click("다음 30건");
    if (outcome === "success") {
      await act(async () => ui.relationRequests[0].resolve({ page: { rows: [{ id: "stale-student", name: "늦은 이전 학생" }], hasMore: true, nextCursor: "a:stale" } }));
    } else {
      await act(async () => ui.relationRequests[0].reject(new Error("늦은 이전 목록 오류")));
    }
    const loading = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "더 불러오는 중");
    assert.ok(loading?.disabled, "the current read still owns loading");
    assert.doesNotMatch(ui.text(), /늦은 이전 학생|늦은 이전 목록 오류/);
    assert.equal(ui.relationRequests.length, 2);
    await act(async () => ui.relationRequests[1].resolve({ page: { rows: [{ id: "new-student", name: "현재 상세 학생" }], hasMore: true, nextCursor: "b:second" } }));
    assert.match(ui.text(), /현재 상세 학생/);
    await ui.click("다음 30건");
    assert.equal(ui.relationRequests[2].input.cursor, "b:second");
    await act(async () => ui.relationRequests[2].resolve({ page: { rows: [], hasMore: false, nextCursor: null } }));
    assert.equal(ui.relationMutations.length, 0);
  });
}

test("relation pagination current failure keeps rows and cursor for an explicit retry", async t => {
  const ui = await setup(t, { configureFixture: relationPaginationFixture });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("다음 30건");
  await act(async () => ui.relationRequests[0].reject(new Error("합성 목록 오류")));
  assert.match(ui.text(), /합성 목록 오류/);
  await ui.click("다음 30건");
  assert.equal(ui.relationRequests[1].input.cursor, "a:first");
  assert.doesNotMatch(ui.text(), /합성 목록 오류/);
  await act(async () => ui.relationRequests[1].resolve({ page: { rows: [], hasMore: false, nextCursor: null } }));
  assert.equal(ui.relationMutations.length, 0);
});

test("relation pagination cannot start from the previous detail while a replacement is pending", async t => {
  const ui = await setup(t, { deferDetail: true, configureFixture: relationPaginationFixture });
  await ui.click("A 영어반");
  await ui.resolve(0, ui.rows[0]);
  await ui.resolve(1, defaultsFor());
  await ui.navigate("classId=b");
  assert.match(ui.title(), /A 영어반/);
  await ui.click("다음 30건");
  assert.equal(ui.relationRequests.length, 0, "the displayed old row has not been accepted into the replacement lifetime");
  await ui.resolve(2, ui.rows[1]);
  assert.match(ui.title(), /B 영어반/);
  await ui.click("다음 30건");
  assert.equal(ui.relationRequests[0].input.id, "b", "accepted detail can page while schedule defaults are pending");
  await act(async () => ui.relationRequests[0].resolve({ page: { rows: [], hasMore: false, nextCursor: null } }));
  await ui.resolve(3, defaultsFor());
  assert.equal(ui.relationMutations.length, 0);
});

test("relation pagination student enrollment pages share the current detail lifetime", async t => {
  const ui = await setup(t, { kind: "students", configureFixture(fixture) {
    studentFixture(fixture, []);
    relationPaginationFixture(fixture, "enrollments");
  } });
  await ui.click("김학생");
  await ui.click("다음 30건");
  assert.equal(ui.relationRequests[0].input.relationKind, "enrollments");
  await act(async () => ui.relationRequests[0].resolve({ page: { rows: [{ id: "synthetic-class", name: "합성 다음 수업", status: "enrolled" }], hasMore: false, nextCursor: null } }));
  assert.match(ui.text(), /합성 다음 수업/);
  assert.equal(ui.relationMutations.length, 0);
});

test("relation pagination actor replacement and unmount ignore the old pending response", async t => {
  const ui = await setup(t, { configureFixture: relationPaginationFixture });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("다음 30건");
  await ui.actor("other-staff");
  await ui.click("A 영어반");
  await ui.resolve(1, defaultsFor());
  await act(async () => ui.relationRequests[0].reject(new Error("이전 직원 상세 오류")));
  assert.doesNotMatch(ui.text(), /이전 직원 상세 오류/);
  await ui.click("다음 30건");
  await ui.unmount();
  await act(async () => ui.relationRequests[1].resolve({ page: { rows: [{ id: "unmounted", name: "닫힌 페이지 학생" }], hasMore: false, nextCursor: null } }));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(ui.relationMutations.length, 0);
});

test("class roster search keeps membership counts and drafts while filtering enrolled and waiting students", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    Object.assign(fixture.rows[0].raw, {
      student_ids: ['s1', 's2'], waitlist_ids: ['s3'],
      registered_students: [{ id: 's1', name: '합성학생', school: '제주중', grade: '중3' }, { id: 's2', name: '다른학생', school: '제주고', grade: '고1' }],
      waitlist_students: [{ id: 's3', name: '합성대기', school: '제주중', grade: '중3' }],
    });
  } });
  await ui.click('A 영어반');
  await ui.resolve(0, defaultsFor());
  await ui.editField('classes-detail-name', '보존할 초안');
  const search = document.querySelector('input[aria-label="명단 학생 검색"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '제주중 중3');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('[data-testid="class-roster-student-row"]').length, 2);
  assert.match(document.querySelector('[data-testid="class-enrolled-student-roster"]').textContent, /1 \/ 2명/);
  assert.match(document.querySelector('[data-testid="class-waitlist-student-roster"]').textContent, /1 \/ 1명/);
  assert.equal(document.getElementById('classes-detail-name').value, '보존할 초안');
  await ui.click('명단 학생 검색 초기화');
  assert.equal(document.activeElement, search);
  assert.equal(document.querySelectorAll('[data-testid="class-roster-student-row"]').length, 3);
  assert.deepEqual(ui.rows[0].raw.student_ids, ['s1', 's2']);
});

test("class save failure appears once beside save, retains the draft, and retries the same intent", async t => {
  let attempts = 0;
  const ui = await setup(t, { configureFixture(fixture) {
    fixture.service.updateClass = async input => {
      attempts += 1;
      if (attempts === 1) throw new Error('합성 저장 실패');
      return input;
    };
  } });
  await ui.click('A 영어반');
  await ui.resolve(0, defaultsFor());
  await ui.editField('classes-detail-name', '실패 후에도 보존');
  await ui.click('저장');
  const footer = document.querySelector('[data-testid="class-detail-actions"]');
  assert.match(footer.textContent, /합성 저장 실패/);
  assert.equal((ui.text().match(/합성 저장 실패/g) || []).length, 1);
  assert.equal(document.getElementById('classes-detail-name').value, '실패 후에도 보존');
  await ui.click('저장');
  assert.equal(attempts, 2);
  assert.doesNotMatch(footer.textContent, /합성 저장 실패/);
  assert.match(footer.textContent, /저장 완료/);
});

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

function deferReconciliationReads(fixture) {
  fixture.refreshes = [];
  fixture.reconciliationDetails = [];
  let captureNextDetail = false;
  const initialDetail = fixture.records.loadDetail;
  fixture.records.refresh = () => {
    const deferred = Promise.withResolvers();
    fixture.refreshes.push(deferred);
    captureNextDetail = true;
    return deferred.promise;
  };
  fixture.records.loadDetail = id => {
    if (!captureNextDetail) return initialDetail(id);
    captureNextDetail = false;
    const deferred = Promise.withResolvers();
    fixture.reconciliationDetails.push({ id, ...deferred });
    return deferred.promise;
  };
}

function relationRefreshFixture(fixture, mode = "enrolled") {
  studentFixture(fixture, ["removeStudentFromClass", "assignStudentToClass", "updateStudent"], mode === "enrolled" ? ["class-a"] : []);
  fixture.rows[0].raw.waitlist_class_ids = mode === "waitlist" ? ["class-a"] : [];
  fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생", class_ids: [], waitlist_class_ids: [] } });
  deferReconciliationReads(fixture);
}

const relationRefreshStatus = () => document.querySelector('[data-testid="management-save-status"]')?.textContent ?? "";
const relationRefreshButton = () => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "화면 다시 불러오기");
const removedRelationRow = ui => ({ ...ui.rows[0], raw: { ...ui.rows[0].raw, class_ids: [], waitlist_class_ids: [] } });

function captureButtonHandler(button) {
  // Deliberately replay the actual Button's earlier React callback. This is a
  // controlled stale-handler test, not a claim that a detached native click fires.
  assert.ok(button);
  const propsKey = Object.keys(button).find(key => key.startsWith("__reactProps$"));
  const handler = button[propsKey]?.onClick;
  assert.equal(typeof handler, "function");
  return handler;
}

const captureRelationRefreshHandler = () => captureButtonHandler(relationRefreshButton());

async function removeFirstClassRelationStudent() {
  const trigger = document.querySelector('[data-testid="class-enrolled-student-roster"] button[aria-haspopup="menu"]');
  assert.ok(trigger);
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  const remove = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === "수강 해제");
  assert.ok(remove);
  await act(async () => remove.click());
}

async function failSavedRelationRefresh(ui) {
  await ui.click("수강 해제");
  assert.equal(ui.mutations.length, 1);
  assert.deepEqual(ui.mutations[0].args[0], { studentId: "student-a", classId: "class-a" });
  assert.doesNotMatch(relationRefreshStatus(), /연결 해제 완료/);
  assert.equal(relationRefreshButton(), undefined, "unconfirmed writes never offer a read retry");
  await act(async () => ui.mutations[0].resolve(undefined));
  assert.match(relationRefreshStatus(), /연결 해제 완료/);
  assert.doesNotMatch(relationRefreshStatus(), /저장 실패/);
  await act(async () => ui.refreshes[0].resolve(undefined));
  await act(async () => ui.reconciliationDetails[0].reject(new Error("합성 상세 조회 실패")));
  assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(relationRefreshStatus(), /저장 실패|기존 데이터 유지/);
  assert.equal(relationRefreshButton()?.disabled, false);
}

test("relation refresh retries only reads after a confirmed removal, preserves the draft and rejects unusable details", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
  await ui.click("김학생");
  await ui.editField("students-detail-name", "아직 저장하지 않은 이름");
  await failSavedRelationRefresh(ui);
  for (const outcome of ["failure", "null", "wrong-id", "success"]) {
    const readIndex = ui.refreshes.length;
    relationRefreshButton().focus();
    await ui.clickTogether("화면 다시 불러오기", "화면 다시 불러오기", "저장", "검수 일괄 수정");
    assert.equal(document.activeElement?.getAttribute("role"), "dialog", "focus leaves the retry button before disabling it");
    assert.equal(ui.refreshes.length, readIndex + 1, "same-tick retries own one shared slot");
    assert.equal(ui.mutations.length, 1, "read retry cannot repeat the committed mutation or interleave a new write");
    assert.equal(relationRefreshButton()?.disabled, true, "the retry action remains visible while its read is pending");
    assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보 불러오는 중/);
    assert.doesNotMatch(relationRefreshStatus(), /저장 실패|저장 중/);
    await ui.clickTogether("화면 다시 불러오기", "불러오는 중", "검수 일괄 수정");
    assert.equal(ui.refreshes.length, readIndex + 1);
    assert.equal(ui.mutations.length, 1);
    await act(async () => ui.refreshes[readIndex].resolve(undefined));
    const detail = ui.reconciliationDetails[readIndex];
    assert.equal(detail.id, "student-a");
    await act(async () => {
      if (outcome === "failure") detail.reject(new Error("합성 재조회 실패"));
      else detail.resolve(outcome === "null" ? null : outcome === "wrong-id" ? { ...removedRelationRow(ui), id: "student-b", title: "잘못 온 다른 상세" } : removedRelationRow(ui));
    });
    assert.equal(document.getElementById("students-detail-name").value, "아직 저장하지 않은 이름");
    assert.match(ui.title(), /김학생/);
    assert.doesNotMatch(ui.text(), /잘못 온 다른 상세/);
    assert.equal(ui.mutations.length, 1);
    if (outcome !== "success") {
      assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보를 불러오지 못했습니다/);
      assert.equal(relationRefreshButton()?.disabled, false);
    }
  }
  assert.equal(relationRefreshStatus(), "연결 해제 완료");
  assert.equal(relationRefreshButton(), undefined);
  assert.equal([...document.querySelectorAll("button")].some(button => button.textContent.trim() === "수강 해제"), false);
  assert.equal(ui.refreshes.length, 5);
  assert.equal(ui.reconciliationDetails.length, 5);
});

for (const message of ["합성 저장 거절", "합성 저장 결과를 확인할 수 없습니다"]) {
  test(`relation refresh keeps an unconfirmed service rejection in the existing error path: ${message}`, async t => {
    const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
    await ui.click("김학생");
    await ui.click("수강 해제");
    await act(async () => ui.mutations[0].reject(new Error(message)));
    assert.ok(relationRefreshStatus().includes(message));
    assert.match(relationRefreshStatus(), /저장 실패/);
    assert.doesNotMatch(relationRefreshStatus(), /연결 해제 완료|최신 정보/);
    assert.equal(relationRefreshButton(), undefined);
    assert.equal(ui.refreshes.length, 0);
    assert.equal(ui.reconciliationDetails.length, 0);
    assert.equal(ui.mutations.length, 1);
  });
}

test("relation refresh clears earlier confirmed feedback when a subsequent write fails in the same detail", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
  await ui.click("김학생");
  await failSavedRelationRefresh(ui);
  await ui.editField("students-detail-name", "새 저장 초안");
  await ui.click("저장");
  assert.equal(ui.mutations[1].name, "updateStudent");
  assert.equal(ui.mutations[1].args[0].name, "새 저장 초안");
  assert.equal(relationRefreshButton(), undefined);
  await act(async () => ui.mutations[1].reject(new Error("합성 학생 정보 저장 실패")));
  assert.match(relationRefreshStatus(), /저장 실패.*합성 학생 정보 저장 실패/);
  assert.doesNotMatch(relationRefreshStatus(), /연결 해제 완료|최신 정보/);
  assert.equal(relationRefreshButton(), undefined);
  assert.equal(document.getElementById("students-detail-name").value, "새 저장 초안");
  assert.equal(ui.refreshes.length, 1, "a failed new write does not start another reconciliation");
});

test("relation refresh refuses a captured retry handler after a different detail opens", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
  await ui.click("김학생");
  await failSavedRelationRefresh(ui);
  const staleRetry = captureRelationRefreshHandler();
  await ui.click("학생 정보 닫기");
  await ui.click("이학생");
  await ui.editField("students-detail-name", "다른 상세의 초안");
  await act(async () => staleRetry());
  assert.equal(ui.refreshes.length, 1, "old callbacks cannot acquire a read slot in the new detail lifetime");
  assert.equal(ui.reconciliationDetails.length, 1);
  assert.equal(ui.mutations.length, 1);
  assert.match(ui.title(), /이학생/);
  assert.equal(document.getElementById("students-detail-name").value, "다른 상세의 초안");
  assert.equal(relationRefreshStatus(), "");
  assert.equal(relationRefreshButton(), undefined);
});

test("relation refresh refuses a captured retry handler after a newer write fails in the same detail", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
  await ui.click("김학생");
  await failSavedRelationRefresh(ui);
  const staleRetry = captureRelationRefreshHandler();
  await ui.editField("students-detail-name", "후속 저장 초안");
  await ui.click("저장");
  await act(async () => ui.mutations[1].reject(new Error("후속 저장 거절")));
  await act(async () => staleRetry());
  assert.equal(ui.refreshes.length, 1, "cleared feedback cannot be revived by its captured callback");
  assert.equal(ui.reconciliationDetails.length, 1);
  assert.equal(ui.mutations.length, 2);
  assert.match(relationRefreshStatus(), /저장 실패.*후속 저장 거절/);
  assert.doesNotMatch(relationRefreshStatus(), /연결 해제 완료|최신 정보/);
  assert.equal(relationRefreshButton(), undefined);
  assert.equal(document.getElementById("students-detail-name").value, "후속 저장 초안");
});

test("relation refresh refuses a captured retry handler after that refresh has succeeded", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
  await ui.click("김학생");
  await failSavedRelationRefresh(ui);
  const staleRetry = captureRelationRefreshHandler();
  await ui.click("화면 다시 불러오기");
  await act(async () => ui.refreshes[1].resolve(undefined));
  await act(async () => ui.reconciliationDetails[1].resolve(removedRelationRow(ui)));
  await act(async () => staleRetry());
  assert.equal(ui.refreshes.length, 2, "a completed refresh cannot be restarted from its obsolete failure callback");
  assert.equal(ui.reconciliationDetails.length, 2);
  assert.equal(ui.mutations.length, 1);
  assert.equal(relationRefreshStatus(), "연결 해제 완료");
  assert.equal(relationRefreshButton(), undefined);
});

test("relation refresh in class detail waits for both reads before exposing its read-only retry", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    fixture.rows[0].raw.student_ids = ["student-a"];
    deferServices(fixture, ["removeStudentFromClass", "updateClass"]);
    deferReconciliationReads(fixture);
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await removeFirstClassRelationStudent();
  assert.deepEqual(ui.mutations[0].args[0], { studentId: "student-a", classId: "a" });
  await act(async () => ui.mutations[0].resolve(undefined));
  assert.equal(ui.refreshes.length, 1);
  assert.equal(ui.reconciliationDetails.length, 1, "class detail and page reads start together");
  await act(async () => ui.reconciliationDetails[0].reject(new Error("합성 수업 상세 조회 실패")));
  assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보 불러오는 중/);
  assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, true);
  assert.equal(relationRefreshButton(), undefined, "the sibling page read still owns the slot");
  await ui.clickTogether("불러오는 중", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  await act(async () => ui.refreshes[0].resolve(undefined));
  assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(relationRefreshStatus(), /저장 실패/);
  await ui.clickTogether("화면 다시 불러오기", "화면 다시 불러오기");
  assert.equal(ui.refreshes.length, 2);
  assert.equal(ui.reconciliationDetails.length, 2);
  await act(async () => ui.reconciliationDetails[1].resolve({ ...ui.rows[0], raw: { ...ui.rows[0].raw, student_ids: [] } }));
  assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, true);
  await act(async () => ui.refreshes[1].resolve(undefined));
  assert.equal(relationRefreshStatus(), "연결 해제 완료");
  assert.equal(relationRefreshButton(), undefined);
  assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, false);
  assert.equal(document.querySelectorAll('[data-class-roster-student-id]').length, 0);
  assert.equal(ui.mutations.length, 1);
});

for (const outcome of ["failure", "success"]) {
  test(`relation refresh ignores an older relation page ${outcome} while recovering the confirmed write`, async t => {
    const ui = await setup(t, { configureFixture(fixture) {
      fixture.rows[0].raw.student_ids = ["student-a"];
      fixture.rows[0].raw.registered_students_relation_page = { rows: [], hasMore: true, nextCursor: "a:before-write" };
      fixture.relationReads = [];
      fixture.records.loadRelationPage = input => {
        const deferred = Promise.withResolvers();
        fixture.relationReads.push({ input, ...deferred });
        return deferred.promise;
      };
      deferServices(fixture, ["removeStudentFromClass", "updateClass"]);
      deferReconciliationReads(fixture);
    } });
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    const nextPageButton = () => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "다음 30건");
    const stalePageHandler = captureButtonHandler(nextPageButton());
    await ui.click("다음 30건");
    assert.equal(ui.relationReads.length, 1);
    await removeFirstClassRelationStudent();
    await act(async () => ui.mutations[0].resolve(undefined));
    await act(async () => ui.reconciliationDetails[0].reject(new Error("합성 저장 후 상세 실패")));
    await act(async () => ui.refreshes[0].resolve(undefined));
    assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보를 불러오지 못했습니다/);
    assert.equal(nextPageButton()?.disabled, true, "only a fresh detail can provide the next usable relation cursor");
    await act(async () => {
      if (outcome === "failure") ui.relationReads[0].reject(new Error("이전 관계 목록의 늦은 실패"));
      else ui.relationReads[0].resolve({ page: { rows: [{ id: "obsolete-student", name: "이전 관계 목록 학생" }], hasMore: false, nextCursor: null } });
    });
    assert.match(relationRefreshStatus(), /연결 해제 완료.*최신 정보를 불러오지 못했습니다/);
    assert.doesNotMatch(ui.text(), /이전 관계 목록|저장 실패/);
    assert.equal(relationRefreshButton()?.disabled, false);
    assert.equal(nextPageButton()?.disabled, true);
    await act(async () => { nextPageButton().click(); stalePageHandler(); });
    assert.equal(ui.relationReads.length, 1, "neither disabled UI nor an earlier callback can page the obsolete relation snapshot");
    await ui.click("화면 다시 불러오기");
    await act(async () => ui.reconciliationDetails[1].resolve({ ...ui.rows[0], raw: {
      ...ui.rows[0].raw, student_ids: [],
      registered_students_relation_page: { rows: [], hasMore: true, nextCursor: "a:after-write" },
    } }));
    await act(async () => ui.refreshes[1].resolve(undefined));
    assert.equal(relationRefreshStatus(), "연결 해제 완료");
    assert.equal(relationRefreshButton(), undefined);
    assert.equal(nextPageButton()?.disabled, false);
    await ui.click("다음 30건");
    assert.equal(ui.relationReads.length, 2);
    assert.equal(ui.relationReads[1].input.cursor, "a:after-write");
    await act(async () => ui.relationReads[1].resolve({ page: {
      rows: [{ id: "current-student", name: "최신 관계 목록 학생" }], hasMore: false, nextCursor: null,
    } }));
    assert.match(ui.text(), /최신 관계 목록 학생/);
    assert.doesNotMatch(ui.text(), /이전 관계 목록|저장 실패/);
    assert.equal(nextPageButton(), undefined);
    assert.equal(ui.mutations.length, 1);
  });
}

for (const change of ["same-row", "other-row", "actor", "unmount"]) {
  for (const outcome of ["success", "failure"]) {
    test(`relation refresh ignores a retry's late ${outcome} after ${change}`, async t => {
      const ui = await setup(t, { kind: "students", configureFixture: relationRefreshFixture });
      await ui.click("김학생");
      await failSavedRelationRefresh(ui);
      await ui.click("화면 다시 불러오기");
      await act(async () => ui.refreshes[1].resolve(undefined));
      const lateDetail = ui.reconciliationDetails[1];
      if (change === "unmount") await ui.unmount();
      else if (change === "actor") {
        await ui.actor("other-actor");
        await ui.click("이학생");
      } else {
        await ui.click("학생 정보 닫기");
        await ui.click(change === "same-row" ? "김학생" : "이학생");
      }
      if (change !== "unmount") await ui.editField("students-detail-name", "새 상세의 초안");
      await act(async () => {
        if (outcome === "failure") lateDetail.reject(new Error("이전 상세의 재조회 실패"));
        else lateDetail.resolve({ ...removedRelationRow(ui), title: "이전 상세의 재조회 결과" });
      });
      assert.doesNotMatch(ui.text(), /이전 상세의 재조회|연결 해제 완료|최신 정보를 불러오지 못했습니다/);
      assert.equal(relationRefreshButton(), undefined);
      assert.equal(ui.mutations.length, 1);
      if (change === "unmount") assert.equal(document.querySelector('[role="dialog"]'), null);
      else {
        assert.match(ui.title(), change === "same-row" ? /김학생/ : /이학생/);
        assert.equal(document.getElementById("students-detail-name").value, "새 상세의 초안");
      }
    });
  }
}

for (const action of ["add", "promote-waitlist"]) {
  test(`relation refresh preserves confirmed ${action} feedback without resubmitting its mutation`, async t => {
    const ui = await setup(t, {
      kind: "students",
      configureFixture: fixture => relationRefreshFixture(fixture, action === "add" ? "none" : "waitlist"),
      componentOverrides: [["./management-relation-combobox", {
        ManagementRelationCombobox: ({ onSelect, disabled }) => createElement("button", {
          type: "button", disabled, onClick: () => onSelect("class-a"),
        }, "검수 수업 선택"),
      }]],
    });
    await ui.click("김학생");
    if (action === "add") {
      await ui.click("검수 수업 선택");
      await ui.click("수강 추가");
      await ui.click("수강 추가");
    } else await ui.click("수강 전환");
    assert.deepEqual(ui.mutations[0].args[0], { studentId: "student-a", classId: "class-a", mode: "enrolled" });
    await act(async () => ui.mutations[0].resolve(undefined));
    await act(async () => ui.refreshes[0].resolve(undefined));
    await act(async () => ui.reconciliationDetails[0].reject(new Error("합성 관계 조회 실패")));
    assert.match(relationRefreshStatus(), action === "add" ? /등록 학생 추가 완료/ : /등록 전환 완료/);
    assert.match(relationRefreshStatus(), /최신 정보를 불러오지 못했습니다/);
    assert.doesNotMatch(relationRefreshStatus(), /저장 실패/);
    await ui.click("화면 다시 불러오기");
    await act(async () => ui.refreshes[1].resolve(undefined));
    await act(async () => ui.reconciliationDetails[1].resolve({ ...ui.rows[0], raw: { ...ui.rows[0].raw, class_ids: ["class-a"], waitlist_class_ids: [] } }));
    assert.equal(relationRefreshButton(), undefined);
    assert.equal(ui.mutations.length, 1);
  });
}

async function beginClassReconciliation(t) {
  const ui = await setup(t, { configureFixture(fixture) {
    deferServices(fixture, ["updateClass"]);
    deferReconciliationReads(fixture);
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "저장한 수업");
  await ui.clickTogether("저장", "저장", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1, "the same gesture retains the existing mutation lock");
  await act(async () => ui.mutations[0].resolve({ id: "a" }));
  assert.equal(ui.refreshes.length, 1);
  assert.equal(ui.reconciliationDetails.length, 1, "detail starts while the list read is unresolved");
  assert.equal(ui.reconciliationDetails[0].id, "a");
  return ui;
}

test("class reconciliation starts both reads and holds its mutation slot until both succeed", async t => {
  const ui = await beginClassReconciliation(t);
  const saveButton = () => document.querySelector('[data-testid="class-detail-save"]');
  assert.equal(saveButton().disabled, true);
  await act(async () => ui.reconciliationDetails[0].resolve(classRow("a", "서버 확인 수업")));
  assert.equal(saveButton().disabled, true, "early detail success cannot release the lock");
  assert.doesNotMatch(ui.title(), /서버 확인 수업/);
  await ui.clickTogether("저장 중", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  await act(async () => ui.refreshes[0].resolve(undefined));
  assert.equal(saveButton().disabled, false);
  assert.match(ui.title(), /서버 확인 수업/);
  assert.match(ui.text(), /저장 완료/);
});

for (const failed of ["list", "detail"]) {
  test(`class reconciliation ${failed} failure waits for the sibling read before releasing duplicate protection`, async t => {
    const ui = await beginClassReconciliation(t);
    const first = failed === "list" ? ui.refreshes[0] : ui.reconciliationDetails[0];
    const second = failed === "list" ? ui.reconciliationDetails[0] : ui.refreshes[0];
    await act(async () => first.reject(new Error(`${failed} 합성 조회 실패`)));
    assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, true);
    assert.doesNotMatch(ui.text(), /합성 조회 실패/);
    await ui.clickTogether("저장 중", "검수 일괄 수정");
    assert.equal(ui.mutations.length, 1);
    await act(async () => second.resolve(failed === "list" ? classRow("a") : undefined));
    assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, false);
    assert.match(ui.text(), /저장 완료 · 화면 갱신 대기 중/);
    assert.doesNotMatch(ui.text(), /합성 조회 실패|저장 실패/);
    await ui.click("저장");
    assert.equal(ui.mutations.length, 2, "both settled reads release the slot for the next explicit save");
    await act(async () => ui.mutations[1].reject(new Error("합성 후속 저장 실패")));
  });
}

test("class reconciliation keeps the committed result when both display reads fail", async t => {
  const ui = await beginClassReconciliation(t);
  await act(async () => ui.reconciliationDetails[0].reject(new Error("상세 오류 후순위")));
  await act(async () => ui.refreshes[0].reject(new Error("목록 오류 우선순위")));
  assert.match(ui.text(), /저장 완료 · 화면 갱신 대기 중/);
  assert.doesNotMatch(ui.text(), /목록 오류 우선순위|상세 오류 후순위|저장 실패/);
});

for (const change of ["account", "role"]) {
  test(`class reconciliation ignores an early detail result after ${change} changes during list refresh`, async t => {
    const ui = await beginClassReconciliation(t);
    await act(async () => ui.reconciliationDetails[0].resolve(classRow("a", "이전 권한 상세 결과")));
    await ui.actor(change === "account" ? "other-actor" : "staff-a", change === "role" ? "teacher" : "admin");
    await ui.click("B 영어반");
    await ui.resolve(1, defaultsFor("18:00"));
    await act(async () => ui.refreshes[0].resolve(undefined));
    assert.match(ui.title(), /B 영어반/);
    assert.doesNotMatch(ui.text(), /이전 권한 상세 결과|저장 완료|조회 실패/);
    assert.equal(ui.mutations.length, 1);
  });
}

test("class reconciliation cannot publish an early detail into a reopened draft while list refresh finishes", async t => {
  const ui = await beginClassReconciliation(t);
  await act(async () => ui.reconciliationDetails[0].resolve(classRow("a", "닫힌 상세 결과")));
  await ui.click("수업 상세 닫기");
  await ui.click("A 영어반");
  await ui.resolve(1, defaultsFor("18:00"));
  await ui.editField("classes-detail-name", "다시 연 초안");
  await ui.clickTogether("저장 중", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  await act(async () => ui.refreshes[0].resolve(undefined));
  assert.equal(document.getElementById("classes-detail-name").value, "다시 연 초안");
  assert.doesNotMatch(ui.text(), /닫힌 상세 결과|저장 완료/);
});

test("class reconciliation never reads after an atomic mutation fails", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    deferServices(fixture, ["updateClass"]); deferReconciliationReads(fixture);
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("저장");
  await act(async () => ui.mutations[0].reject(new Error("합성 원자 저장 실패")));
  assert.equal(ui.refreshes.length, 0); assert.equal(ui.reconciliationDetails.length, 0);
  assert.match(ui.text(), /합성 원자 저장 실패/);
});

test("class reconciliation without a selected ID retains one list read after bulk mutation", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    deferServices(fixture, ["updateClass"]); deferReconciliationReads(fixture);
  } });
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2);
  await act(async () => { ui.mutations[0].resolve({ id: "a" }); ui.mutations[1].resolve({ id: "b" }); });
  assert.equal(ui.refreshes.length, 1); assert.equal(ui.reconciliationDetails.length, 0);
  await act(async () => ui.refreshes[0].resolve(undefined));
});

test("class reconciliation keeps student detail save reads sequential", async t => {
  const ui = await setup(t, { kind: "students", configureFixture(fixture) {
    studentFixture(fixture, ["updateStudent"]); deferReconciliationReads(fixture);
  } });
  await ui.click("김학생"); await ui.click("저장");
  await act(async () => ui.mutations[0].resolve({ id: "student-a" }));
  assert.equal(ui.refreshes.length, 1); assert.equal(ui.reconciliationDetails.length, 0);
  await act(async () => ui.refreshes[0].resolve(undefined));
  assert.equal(ui.reconciliationDetails.length, 1);
  await ui.clickTogether("저장 중", "검수 일괄 수정");
  assert.equal(ui.mutations.length, 1);
  await act(async () => ui.reconciliationDetails[0].resolve(ui.rows[0]));
  assert.match(ui.text(), /저장 완료/);
});

test("class reconciliation extracted callback preserves textbook ordering and returned payload identity", async () => {
  const list = Promise.withResolvers(), reads = [], row = { id: "synthetic-textbook", title: "합성 교재" };
  const callback = extractManagementReconcile().bind({ kind: "textbooks", refresh: () => { reads.push("list"); return list.promise; }, loadDetail: async () => { reads.push("detail"); return row; } });
  const pending = callback(row.id);
  assert.deepEqual(reads, ["list"]);
  list.resolve(undefined);
  assert.equal(await pending, row);
  assert.deepEqual(reads, ["list", "detail"]);
});

test("autofocused student create form returns to its opening button after discarding", async t => {
  const ui = await setup(t, { kind: "students", configureFixture: fixture => studentFixture(fixture, []) });
  const opener = [...document.querySelectorAll("button")].find(node => node.textContent === "수업 등록");
  await act(async () => opener.focus());
  await ui.click("수업 등록");
  assert.equal(document.activeElement?.id, "students-form-name");
  await ui.editField("students-form-name", "새 합성 학생");
  await ui.click("학생 정보 닫기");
  await ui.click("계속 편집");
  assert.equal(document.getElementById("students-form-name").value, "새 합성 학생");
  await ui.click("학생 정보 닫기");
  await ui.click("변경사항 버리기");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(document.activeElement === opener);
});

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
  assert.equal(document.getElementById("students-form-school_category").disabled, true);
  await act(async () => ui.mutations[0].reject(new Error("생성 실패")));
  assert.equal(document.getElementById("students-form-name").disabled, false);
  assert.equal(document.getElementById("students-form-school_category").disabled, false);
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
    fixture.bulkResults = [];
    fixture.refreshes = [];
    fixture.records.refresh = async () => { fixture.refreshes.push(true); };
    fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
  } });
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2);
  await act(async () => ui.mutations[0].reject(new Error("첫 행 저장 실패")));
  await ui.clickTogether("검수 일괄 수정");
  assert.equal(ui.mutations.length, 2, "the second row is still being written");
  assert.equal(ui.refreshes.length, 0);
  await act(async () => ui.mutations[1].resolve({ id: "student-b" }));
  assert.equal(ui.refreshes.length, 1, "confirmed partial writes refresh the displayed page");
  assert.deepEqual(ui.bulkResults, [false, { failedIds: ["student-a"] }], "only failed rows are returned to the selection owner for retry");
  await ui.click("검수 일괄 수정");
  assert.equal(ui.mutations.length, 4, "retry is allowed after the entire previous batch settles");
  await act(async () => { ui.mutations[2].resolve({ id: "student-a" }); ui.mutations[3].resolve({ id: "student-b" }); });
});

test("real management table retries only failed rows and preserves the bulk draft", async t => {
  const previousMatchMedia = window.matchMedia;
  const previousScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  const previousResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  t.after(() => { window.matchMedia = previousMatchMedia; window.HTMLElement.prototype.scrollIntoView = previousScrollIntoView; globalThis.ResizeObserver = previousResizeObserver; });
  const ui = await setup(t, { kind: "students", configureFixture: fixture => {
    studentFixture(fixture, ["updateStudent"]);
    fixture.actualTable = true;
    fixture.records.totalCount = 2;
    fixture.records.refresh = async () => { fixture.records.rows = [...fixture.records.rows].reverse(); };
    fixture.rows.push({ ...fixture.rows[0], id: "student-b", title: "이학생", raw: { ...fixture.rows[0].raw, id: "student-b", name: "이학생" } });
  } });
  const selections = () => [...document.querySelectorAll('tbody [role="checkbox"]')];
  assert.equal(selections().length, 2);
  await act(async () => { selections()[0].click(); selections()[1].click(); });
  await ui.click("선택 항목 일괄 수정");
  await act(async () => document.getElementById("management-bulk-value").click());
  await act(async () => [...document.querySelectorAll('[role="option"]')].find(option => option.textContent === "고등").click());
  await ui.click("일괄 수정");
  assert.equal(ui.mutations.length, 2);
  await act(async () => { ui.mutations[0].resolve({ id: "student-a" }); ui.mutations[1].reject(new Error("검수용 부분 실패")); });
  assert.equal(document.querySelector('[role="dialog"] h2').textContent, "선택 1건 수정");
  assert.match(document.getElementById("management-bulk-value").textContent, /고등/);
  assert.deepEqual(selections().map(box => box.getAttribute("aria-checked")), ["true", "false"], "selection follows failed row identity after the refreshed page reorders");
  await ui.click("일괄 수정");
  assert.equal(ui.mutations.length, 3, "the confirmed row is never submitted again");
  assert.equal(ui.mutations[2].args[0].id, "student-b");
  await act(async () => ui.mutations[2].resolve({ id: "student-b" }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(selections().map(box => box.getAttribute("aria-checked")), ["false", "false"]);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "학생 검색");
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

test("pending catalogs prevent schedule edits from losing normalized resource IDs", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    fixture.records.classFormReferencesStatus = "loading";
    fixture.records.classFormReferences = { teacherCatalogs: [], classroomCatalogs: [], scienceSubjectAreas: [] };
  } });
  await ui.click("A 영어반");
  assert.equal(document.getElementById("classes-detail-subject").disabled, true);
  const controls = [...document.querySelectorAll('[data-testid="class-schedule-slot-editor"] button, [data-testid="class-schedule-slot-editor"] input')];
  assert.ok(controls.length > 5);
  assert.ok(controls.every(control => control.disabled));
  // Even a dispatched event cannot change the draft while its catalogs are pending.
  await ui.editTime("18:30");
  await ui.resolve(0, defaultsFor("09:00", 7));
  assert.equal(ui.time(), "09:00");
  ui.records.classFormReferencesStatus = "ready";
  ui.records.classFormReferences = createManagementDetailFixture().records.classFormReferences;
  await ui.navigate("classId=a");
  await ui.editTime("18:30");
  await ui.click("기본 시간표 저장");
  assert.equal(ui.requests[1].input.slots[0].teacherCatalogId, "teacher-1");
  assert.equal(ui.requests[1].input.slots[0].classroomCatalogId, "room-1");
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

test("uncertain class close offers read-only confirmation and preserves edits made after submission", async t => {
  let writes = 0;
  let reads = 0;
  let committed = false;
  const ui = await setup(t, { configureFixture(fixture) {
    fixture.service.updateClass = async (_input, options) => {
      writes++;
      const confirm = async () => {
        assert.equal(options.confirmCloseResult.isCurrent(), true);
        options.confirmCloseResult.onChecking();
        reads++;
        if (!committed) throw Object.assign(new Error("종강 반영 여부를 확인하지 못했습니다. 입력은 유지됩니다."), { code: "CLASS_CLOSE_RESULT_UNCERTAIN", confirm });
        return { id: "a", status: "종강", closeConfirmation: "current-state" };
      };
      return confirm();
    };
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.editField("classes-detail-name", "제출한 초안");
  await ui.click("저장");
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.match(ui.text(), /종강 반영 여부를 확인하지 못했습니다/);
  assert.doesNotMatch(ui.text(), /다시 저장|저장 실패/);
  assert.equal(document.querySelector('[data-testid="class-detail-actions"] [role="alert"]'), null);
  await ui.editField("classes-detail-name", "제출 이후 편집");
  await ui.click("저장 결과 확인");
  assert.equal(reads, 2);
  committed = true;
  await ui.click("저장 결과 확인");
  assert.equal(writes, 1);
  assert.equal(reads, 3);
  assert.match(ui.text(), /종강 상태 확인됨/);
  assert.equal(document.getElementById("classes-detail-name").value, "제출 이후 편집");
  await ui.click("닫기");
  assert.ok(document.querySelector('[data-testid="management-discard-confirm-dialog"]'), "later edits were not marked saved");
});

test("known class save and confirmed state remain successful when the subsequent display refresh fails", async t => {
  for (const confirmed of [false, true]) {
    const ui = await setup(t, { configureFixture(fixture) {
      fixture.service.updateClass = async input => confirmed ? { id: input.id, status: "종강", closeConfirmation: "current-state" } : input;
      fixture.records.refresh = async () => { throw new Error("display unavailable"); };
    } });
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    await ui.click("저장");
    assert.match(ui.text(), confirmed ? /종강 상태 확인됨 · 화면 갱신 대기 중/ : /저장 완료 · 화면 갱신 대기 중/);
    assert.doesNotMatch(ui.text(), /display unavailable|저장 실패/);
    assert.equal(document.querySelector('[data-testid="class-detail-actions"] [role="alert"]'), null);
    await ui.unmount();
  }
});

test("pending class confirmation is owned by its detail lifetime and actor", async t => {
  for (const change of ["row", "actor", "unmount"]) {
    let complete;
    let owner;
    const ui = await setup(t, { configureFixture(fixture) {
      fixture.service.updateClass = async (_input, options) => {
        owner = options.confirmCloseResult.isCurrent;
        options.confirmCloseResult.onChecking();
        return new Promise(resolve => { complete = resolve; });
      };
    } });
    await ui.click("A 영어반");
    await ui.resolve(0, defaultsFor());
    await ui.click("저장");
    assert.match(ui.text(), /저장 결과 확인 중/);
    assert.equal(owner(), true);
    if (change === "row") {
      await ui.click("수업 상세 닫기");
      await ui.click("B 영어반");
      await ui.resolve(1, defaultsFor());
    } else if (change === "actor") await ui.actor("staff-b");
    else await ui.unmount();
    assert.equal(owner(), false);
    await act(async () => complete({ id: "a", status: "종강", closeConfirmation: "current-state" }));
    assert.doesNotMatch(ui.text(), /종강 상태 확인됨/);
    await ui.unmount();
  }
});

test("invalid textbook usage releases the class save lock before any writer and permits a corrected save", async t => {
  let writes = 0;
  const ui = await setup(t, { configureFixture(fixture) {
    Object.assign(fixture.rows[0].raw, { textbook_ids: ["book-1"], textbook_usage: {
      "book-1": { startDate: "2026-10-30", endDate: "2026-10-01", title: "합성 교재" },
    } });
    fixture.service.updateClass = async input => { writes++; return input; };
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("저장");
  assert.equal(writes, 0);
  assert.match(document.querySelector('[data-testid="class-detail-actions"]').textContent, /종료일은 시작일 이후/);
  assert.equal(document.querySelector('[data-testid="class-detail-save"]').disabled, false);
  await ui.editField("textbook-book-1-end", "2026-10-31");
  await ui.click("저장");
  assert.equal(writes, 1);
  assert.match(ui.text(), /저장 완료/);
});

test("confirmed class state reports pending public cache without claiming a request receipt", async t => {
  const ui = await setup(t, { configureFixture(fixture) {
    fixture.service.updateClass = async input => ({ id: input.id, status: "종강", closeConfirmation: "current-state", publicClassesCacheRefresh: { status: "pending" } });
  } });
  await ui.click("A 영어반");
  await ui.resolve(0, defaultsFor());
  await ui.click("저장");
  assert.match(ui.text(), /종강 상태 확인됨 · 공개 수업 캐시 갱신 대기 중/);
  assert.doesNotMatch(ui.text(), /저장은 완료되었습니다|저장 실패/);
});
