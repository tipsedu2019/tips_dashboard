import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

import { JSDOM } from "jsdom";
import {
  act,
  cloneElement,
  createContext,
  createElement,
  forwardRef,
  useContext,
} from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const componentUrl = new URL(
  "../src/features/management/class-enrollment-status-cell.tsx",
  import.meta.url,
);

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children);
  });
}

function createPopoverStubs() {
  const PopoverContext = createContext(null);

  function Popover({ children, open, onOpenChange }) {
    return createElement(PopoverContext.Provider, { value: { open, onOpenChange } }, children);
  }

  function PopoverTrigger({ children }) {
    const context = useContext(PopoverContext);
    return cloneElement(children, {
      onClick: (event) => {
        children.props.onClick?.(event);
        context.onOpenChange(!context.open);
      },
    });
  }

  function PopoverContent({ children, ...props }) {
    const context = useContext(PopoverContext);
    const contentProps = { ...props };
    delete contentProps.align;
    delete contentProps.sideOffset;
    return context.open ? createElement("div", { role: "dialog", ...contentProps }, children) : null;
  }

  return { Popover, PopoverContent, PopoverTrigger };
}

async function loadEnrollmentStatusCell() {
  let source;
  try {
    source = await readFile(componentUrl, "utf8");
  } catch {
    return null;
  }

  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentUrl.pathname,
  }).outputText;
  const localModules = new Map([
    ["@/components/ui/badge", { Badge: passthrough("span") }],
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/popover", createPopoverStubs()],
    ["@/lib/utils", { cn: (...values) => values.filter(Boolean).join(" ") }],
  ]);
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    const local = localModules.get(specifier);
    if (local) return local;
    throw new Error(`unexpected enrollment status cell import: ${specifier}`);
  };
  const triggerUrl = new URL("../src/features/management/enrollment-status-trigger.tsx", import.meta.url);
  const triggerSource = ts.transpileModule(await readFile(triggerUrl, "utf8"), {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: triggerUrl.pathname,
  }).outputText;
  const triggerModule = { exports: {} };
  vm.runInThisContext(`(function(require, module, exports) {${triggerSource}\n})`, { filename: triggerUrl.pathname })(runtimeRequire, triggerModule, triggerModule.exports);
  localModules.set("./enrollment-status-trigger", triggerModule.exports);
  const runtimeModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: componentUrl.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports.ClassEnrollmentStatusCell || null;
}

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
];

async function withDom(run) {
  const previous = new Map(DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://tipsedu.co.kr/admin/classes",
  });
  for (const key of DOM_GLOBALS) {
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("root");
  const root = createRoot(container);

  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
  };
  try {
    return await run({ container, root, unmount });
  } finally {
    await unmount();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("count-only class rows load and show the registered roster when the badge opens", async () => {
  const ClassEnrollmentStatusCell = await loadEnrollmentStatusCell();
  assert.ok(ClassEnrollmentStatusCell, "class enrollment status cell should exist");

  await withDom(async ({ container, root }) => {
    const calls = [];
    const row = {
      id: "class-1",
      raw: { registeredCount: 2, waitlistCount: 0 },
      metrics: { studentCount: 2, waitlistCount: 0 },
    };

    await act(async () => {
      root.render(createElement(ClassEnrollmentStatusCell, {
        row,
        onLoadRoster: async (classId, mode, cursor) => {
          calls.push([classId, mode, cursor]);
          return { rows: [
            { id: "student-2", name: "나학생", school: "중앙여고", grade: "고2" },
            { id: "student-1", name: "가학생", school: "중앙여고", grade: "고2" },
          ], nextCursor: null, hasMore: false };
        },
      }));
    });

    const trigger = container.querySelector('button[aria-label="등록 학생 2명 보기"]');
    assert.ok(trigger, "registered roster trigger should render from the count-only list row");

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.deepEqual(calls, [["class-1", "registered", null]]);
    assert.match(container.textContent, /가학생\(중앙여고2\)/);
    assert.match(container.textContent, /나학생\(중앙여고2\)/);
    assert.ok(
      container.textContent.indexOf("가학생") < container.textContent.indexOf("나학생"),
      "loaded roster should use Korean ascending name order",
    );

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(calls.length, 1, "reopening the same roster should reuse the loaded names");
  });
});


const rosterStudents = (count, label = "등록", start = 1) => Array.from({ length: count }, (_, offset) => ({
  id: `synthetic-${label}-${start + offset}`,
  name: `합성 ${label} ${String(start + offset).padStart(3, "0")}`,
  school: "합성중", grade: "중1",
}));
const rosterPage = (rows = [], nextCursor = null) => ({ rows, nextCursor, hasMore: nextCursor !== null });
const rosterRow = (id = "class-1", registered = 35, waitlist = 7) => ({
  id, raw: { registeredCount: registered, waitlistCount: waitlist },
  metrics: { studentCount: registered, waitlistCount: waitlist },
});

async function withRoster(run, initialRow = rosterRow()) {
  const Cell = await loadEnrollmentStatusCell();
  assert.ok(Cell);
  await withDom(async ({ container, root, unmount }) => {
    const requests = [];
    const onLoadRoster = (classId, mode, cursor) => {
      const pending = Promise.withResolvers();
      requests.push({ classId, mode, cursor, ...pending });
      return pending.promise;
    };
    let row = initialRow;
    const render = async (next = row) => {
      row = next;
      await act(async () => root.render(createElement(Cell, { row, onLoadRoster })));
    };
    await render();
    const button = label => {
      const match = [...container.querySelectorAll("button")].find(node => node.textContent.trim() === label || node.getAttribute("aria-label") === label);
      assert.ok(match, `button missing: ${label}`);
      return match;
    };
    await run({ container, requests, render, unmount, button,
      text: () => container.querySelector('[role="dialog"]')?.textContent || "",
      names: () => (container.querySelector('[role="dialog"]')?.textContent || "").match(/합성 (?:등록|대기) \d{3}/g) || [],
      click: async label => act(async () => { const target = button(label); assert.equal(target.disabled, false); target.click(); }),
      clickTogether: async label => act(async () => { const target = button(label); target.click(); target.click(); }),
      resolve: (index, value) => act(async () => requests[index].resolve(value)),
      reject: index => act(async () => requests[index].reject(new Error("synthetic-private-roster-503"))),
    });
  });
}

function assertLocalRosterError(ui) {
  const alert = ui.container.querySelector('[role="alert"]');
  assert.ok(alert, "failed reference read must have a local alert");
  assert.match(alert.textContent, /명단을 불러오지 못했습니다/);
  assert.doesNotMatch(ui.text(), /synthetic-private-roster-503|명단 불러오는 중|학생이 없습니다/);
  assert.equal(ui.button("다시 시도").disabled, false);
}

test("class roster preview pagination: 35 registered students remain reachable after the first 30 without duplicates", async () => {
  await withRoster(async ui => {
    const registered = rosterStudents(35);
    assert.equal(ui.requests.length, 0, "rosters are read only on opening");
    await ui.click("등록 학생 35명 보기");
    assert.deepEqual(ui.requests.map(({ classId, mode, cursor }) => [classId, mode, cursor]), [["class-1", "registered", null]]);
    await ui.resolve(0, rosterPage(registered.slice(0, 30).reverse(), "opaque-registered-30"));
    assert.deepEqual(ui.names(), registered.slice(0, 30).map(student => student.name));
    assert.match(ui.text(), /30\s*\/\s*35명/);
    await ui.clickTogether("명단 더 불러오기");
    assert.equal(ui.requests.length, 2, "same-tick clicks must not duplicate the next-page read");
    assert.equal(ui.requests[1].cursor, "opaque-registered-30");
    await ui.resolve(1, rosterPage([registered[29], ...registered.slice(30)].reverse()));
    assert.deepEqual(ui.names(), registered.map(student => student.name));
    assert.equal(new Set(ui.names()).size, 35);
    assert.equal([...ui.container.querySelectorAll("button")].some(node => node.textContent.trim() === "명단 더 불러오기"), false);
    await ui.click("등록 학생 35명 보기");
    await ui.click("등록 학생 35명 보기");
    assert.equal(ui.requests.length, 2, "close and reopen reuse the accepted pages");
    assert.equal(ui.names().length, 35);
  });
});

test("class roster preview pagination: registered and waiting reads and caches remain independent", async () => {
  await withRoster(async ui => {
    await ui.click("등록 학생 35명 보기");
    await ui.click("대기 학생 7명 보기");
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.requests[1].mode, "waitlist");
    assert.equal(ui.requests[1].cursor, null);
    await ui.resolve(1, rosterPage(rosterStudents(7, "대기")));
    await ui.resolve(0, rosterPage(rosterStudents(30), "registered-next"));
    assert.deepEqual(ui.names(), rosterStudents(7, "대기").map(student => student.name));
    assert.doesNotMatch(ui.text(), /합성 등록/);
    await ui.click("등록 학생 35명 보기");
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.names().length, 30);
    await ui.click("대기 학생 7명 보기");
    assert.equal(ui.requests.length, 2);
    assert.equal(ui.names().length, 7);
  });
});

test("class roster preview pagination: first failure and malformed pages recover through an explicit same-page retry", async () => {
  const invalidPages = [null, { rows: null, hasMore: false, nextCursor: null }, { rows: [], hasMore: true, nextCursor: null }];
  for (const failure of ["reject", ...invalidPages]) {
    await withRoster(async ui => {
      await ui.click("등록 학생 35명 보기");
      if (failure === "reject") await ui.reject(0);
      else await ui.resolve(0, failure);
      assertLocalRosterError(ui);
      await ui.clickTogether("다시 시도");
      assert.equal(ui.requests.length, 2);
      assert.deepEqual([ui.requests[1].classId, ui.requests[1].mode, ui.requests[1].cursor], ["class-1", "registered", null]);
      await ui.resolve(1, rosterPage(rosterStudents(30), "first-retry-next"));
      assert.equal(ui.names().length, 30);
      assert.equal(ui.container.querySelector('[role="alert"]'), null);
    });
  }
});

test("class roster preview pagination: failed or invalid next page keeps accepted rows and retries the exact cursor", async () => {
  for (const failure of ["reject", null, { rows: rosterStudents(5, "등록", 31), hasMore: true, nextCursor: "same-next" }]) {
    await withRoster(async ui => {
      await ui.click("등록 학생 35명 보기");
      await ui.resolve(0, rosterPage(rosterStudents(30), "same-next"));
      await ui.click("명단 더 불러오기");
      if (failure === "reject") await ui.reject(1);
      else await ui.resolve(1, failure);
      assertLocalRosterError(ui);
      assert.equal(ui.names().length, 30, "accepted first-page names remain visible on a next-page error");
      assert.match(ui.text(), /30\s*\/\s*35명/);
      await ui.clickTogether("다시 시도");
      assert.equal(ui.requests.length, 3);
      assert.equal(ui.requests[2].cursor, "same-next");
      assert.equal(ui.requests[2].mode, "registered");
      await ui.resolve(2, rosterPage(rosterStudents(5, "등록", 31)));
      assert.equal(ui.names().length, 35);
      assert.equal(ui.container.querySelector('[role="alert"]'), null);
    });
  }
});

test("class roster preview pagination: zero total and unavailable positive-total information are distinct", async () => {
  await withRoster(async ui => {
    await ui.click("등록 학생 0명 보기");
    assert.equal(ui.requests.length, 0);
    assert.match(ui.text(), /등록 학생이 없습니다/);
    assert.equal(ui.container.querySelector('[role="alert"]'), null);
  }, rosterRow("class-zero", 0, 0));
  await withRoster(async ui => {
    await ui.click("등록 학생 35명 보기");
    await ui.resolve(0, rosterPage());
    assert.match(ui.text(), /학생 정보를 확인할 수 없습니다/);
    assert.doesNotMatch(ui.text(), /등록 학생이 없습니다|불러오는 중/);
  });
});

for (const change of ["row", "count"]) {
  test(`class roster preview pagination: ${change} changes invalidate earlier successful and failed reads`, async () => {
    for (const outcome of ["success", "error"]) {
      await withRoster(async ui => {
        await ui.click("등록 학생 35명 보기");
        const nextRow = change === "row" ? rosterRow("class-2", 2, 0) : rosterRow("class-1", 36, 7);
        await ui.render(nextRow);
        assert.equal(ui.container.querySelector('[role="dialog"]'), null, "new count or row begins with a new closed preview");
        await ui.click(`등록 학생 ${nextRow.raw.registeredCount}명 보기`);
        assert.equal(ui.requests.length, 2);
        await ui.resolve(1, rosterPage([{ id: "fresh-student", name: "새 범위 합성 학생" }]));
        if (outcome === "success") await ui.resolve(0, rosterPage(rosterStudents(30), "stale-next"));
        else await ui.reject(0);
        assert.match(ui.text(), /새 범위 합성 학생/);
        assert.doesNotMatch(ui.text(), /합성 등록|synthetic-private-roster-503/);
        assert.equal(ui.container.querySelector('[role="alert"]'), null);
        assert.equal([...ui.container.querySelectorAll("button")].some(node => node.textContent.trim() === "명단 더 불러오기"), false);
      });
    }
  });
}

test("class roster preview pagination: late completion after unmount cannot recreate the preview", async () => {
  for (const outcome of ["success", "error"]) {
    await withRoster(async ui => {
      await ui.click("등록 학생 35명 보기");
      await ui.unmount();
      if (outcome === "success") await ui.resolve(0, rosterPage(rosterStudents(30), "late-next"));
      else await ui.reject(0);
      assert.equal(ui.container.textContent, "");
      assert.equal(ui.requests.length, 1);
    });
  }
});
