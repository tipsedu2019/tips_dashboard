import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import * as helpers from "../src/components/public/classes/helpers.ts";
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function loadView() {
  const file = new URL(
    "../src/components/public/public-classes-view.tsx",
    import.meta.url,
  );
  const output = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file.pathname,
  }).outputText;
  const modules = new Map([
    ["./classes/helpers", helpers],
    [
      "./classes/public-classes.module.css",
      {
        __esModule: true,
        default: new Proxy({}, { get: (_, key) => String(key) }),
      },
    ],
    [
      "./classes/public-dialog",
      {
        PublicDialog: ({ children }) => createElement("section", {}, children),
      },
    ],
    [
      "./classes/weekly-timetable",
      { WeekGrid: () => null, WeeklyTimetable: () => null },
    ],
    ["next/dynamic", () => () => null],
  ]);
  const runtime = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, {
    filename: file.pathname,
  })(
    (name) => (modules.has(name) ? modules.get(name) : require(name)),
    runtime,
    runtime.exports,
  );
  return runtime.exports.PublicClassesView;
}
test("real catalog interactions synchronize filters, saved IDs, back navigation and unavailable state", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://tipsedu.co.kr/classes" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const View = await loadView();
  const root = createRoot(document.getElementById("root"));
  const ids = Array.from(
    { length: 7 },
    (_, i) => `b6b5da5a-b000-4b46-bc7a-dabea5b53e1${i}`,
  );
  const classes = ids.map((id, i) => ({
    id,
    name: `수업${i}`,
    className: `수업${i}`,
    subject: i === 6 ? "과학" : "영어",
    grade: "고1",
    teacher: "김 선생님",
    room: "본관",
    classroom: "본관",
    schedule: "월 17:00-19:00",
    capacity: 10,
    enrolledCount: 3,
    waitlistCount: 0,
    fee: 200000,
    tuition: 200000,
    status: "수강",
  }));
  const catalog = {
    classes,
    generatedAt: "2026-09-07T00:00:00Z",
    availability: "live",
  };
  try {
    localStorage.setItem(helpers.STORAGE_KEY, JSON.stringify([ids[0], "bad"]));
    await act(async () =>
      root.render(createElement(View, { catalog, initialQuery: "" })),
    );
    assert.equal(
      document
        .querySelector('[aria-label="수업0 시간표에서 빼기"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    const science = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "과학",
    );
    await act(async () => science.click());
    assert.equal(
      new URL(window.location.href).searchParams.get("subject"),
      "과학",
    );
    assert.equal(document.querySelectorAll("article").length, 1);
    await act(async () =>
      document.querySelector('[aria-label="수업6 시간표에 담기"]').click(),
    );
    assert.deepEqual(JSON.parse(localStorage.getItem(helpers.STORAGE_KEY)), [
      ids[0],
      ids[6],
    ]);
    await act(async () => {
      window.history.replaceState(null, "", "/classes");
      window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
    });
    assert.equal(document.querySelectorAll("article").length, 7);
    for (const i of [1, 2, 3, 4])
      await act(async () =>
        document.querySelector(`[aria-label="수업${i} 시간표에 담기"]`).click(),
      );
    await act(async () =>
      document.querySelector('[aria-label="수업5 시간표에 담기"]').click(),
    );
    assert.equal(
      JSON.parse(localStorage.getItem(helpers.STORAGE_KEY)).length,
      6,
    );
    assert.match(document.body.textContent, /최대 6개 수업을 담을 수 있습니다/);
    await act(async () => {
      window.history.replaceState(null, "", "/classes?selected=unknown");
      window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
    });
    assert.equal(
      document.querySelectorAll('article button[aria-pressed="true"]').length,
      0,
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("disabled");
      },
    });
    await act(async () =>
      document.querySelector('[aria-label="수업0 시간표에 담기"]').click(),
    );
    assert.match(window.location.search, /selected=b6b5/);
    assert.match(document.body.textContent, /저장이 유지되지 않을 수 있습니다/);
    await act(async () =>
      root.render(
        createElement(View, {
          catalog: {
            classes: [],
            generatedAt: null,
            availability: "unavailable",
          },
          initialQuery: "",
        }),
      ),
    );
    assert.match(
      document.querySelector('[role="alert"]').textContent,
      /불러오지 못했습니다/,
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.localStorage;
  }
});
