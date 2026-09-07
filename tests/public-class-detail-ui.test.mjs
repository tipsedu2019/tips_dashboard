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
async function loadDetail() {
  const file = new URL(
    "../src/components/public/classes/class-detail.tsx",
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
    ["./helpers", helpers],
    [
      "./public-classes.module.css",
      {
        __esModule: true,
        default: new Proxy({}, { get: (_, key) => String(key) }),
      },
    ],
  ]);
  const runtime = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, {
    filename: file.pathname,
  })(
    (name) => (modules.has(name) ? modules.get(name) : require(name)),
    runtime,
    runtime.exports,
  );
  return runtime.exports.default;
}
test("detail explains full selection inside the dialog while removal stays enabled", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://tipsedu.co.kr/classes" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const originalFetch = globalThis.fetch;
  const id = "b6b5da5a-b000-4b46-bc7a-dabea5b53e12";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      classItem: {
        id,
        name: "초6 수학",
        teacher: "선생님",
        room: "본관",
        tuition: 230000,
        schedule: "월 15:30-17:00",
        schedulePlan: {
          textbooks: [],
          sessions: [
            {
              id: "session-1",
              date: "2026-09-07",
              scheduleState: "active",
              sessionNumber: 1,
            },
          ],
        },
      },
      textbooks: [],
      progressLogs: [],
      availability: "live",
      generatedAt: "2026-09-07T00:00:00Z",
    }),
  });
  const Detail = await loadDetail();
  const root = createRoot(document.getElementById("root"));
  let toggles = 0;
  const onSave = () => {
    toggles++;
  };
  try {
    await act(async () =>
      root.render(
        createElement(Detail, {
          id,
          saved: false,
          onSave,
          canSave: true,
          selectionFull: true,
        }),
      ),
    );
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "시간표에 담기",
    );
    assert.ok(save.disabled);
    assert.match(
      document.getElementById(save.getAttribute("aria-describedby"))
        .textContent,
      /최대 6개/,
    );
    assert.equal(
      document.getElementById("detail-save-limit").getAttribute("role"),
      "status",
    );
    await act(async () => save.click());
    assert.equal(toggles, 0);
    await act(async () =>
      root.render(
        createElement(Detail, {
          id,
          saved: true,
          onSave,
          canSave: true,
          selectionFull: false,
        }),
      ),
    );
    assert.equal(document.getElementById("detail-save-limit"), null);
    const remove = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "시간표에서 빼기",
    );
    assert.equal(remove.disabled, false);
    await act(async () => remove.click());
    assert.equal(toggles, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});

test("detail renders each period's exact book progress rather than another period's first matching number", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://tipsedu.co.kr/classes" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const originalFetch = globalThis.fetch;
  const id = "b6b5da5a-b000-4b46-bc7a-dabea5b53e13";
  const sessions = [
    {
      id: "period-a-session",
      date: "2026-09-07",
      billingId: "period-a",
      scheduleState: "active",
      sessionNumber: 1,
      textbookEntries: [{ textbookId: "book" }],
    },
    {
      id: "period-b-session",
      date: "2026-09-28",
      billingId: "period-b",
      scheduleState: "active",
      sessionNumber: 1,
      textbookEntries: [{ textbookId: "book" }],
    },
  ];
  const baseLog = {
    classId: id,
    textbookId: "book",
    progressKey: "",
    status: "done",
    rangeStart: "",
    rangeEnd: "",
    publicNote: "",
    updatedAt: null,
    completedLessonIds: [],
  };
  const logs = [
    {
      ...baseLog,
      id: "b-log",
      sessionId: sessions[1].id,
      sessionOrder: 8,
      rangeLabel: "B 구간의 실제 진도",
    },
    {
      ...baseLog,
      id: "a-log",
      sessionId: sessions[0].id,
      sessionOrder: 9,
      rangeLabel: "A 구간의 실제 진도",
    },
    {
      ...baseLog,
      id: "unknown-log",
      sessionId: "unknown",
      sessionOrder: 1,
      rangeLabel: "잘못된 진도",
    },
    {
      ...baseLog,
      id: "legacy-log",
      sessionId: "",
      sessionOrder: 1,
      rangeLabel: "구간 불명 진도",
    },
  ];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      classItem: {
        id,
        name: "수학",
        teacher: "선생님",
        room: "본관",
        tuition: 230000,
        schedule: "월 15:30-17:00",
        schedulePlan: { textbooks: [], sessions },
      },
      textbooks: [{ id: "book", title: "교재" }],
      progressLogs: logs,
      availability: "live",
      generatedAt: "2026-09-07T00:00:00Z",
    }),
  });
  const Detail = await loadDetail();
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        createElement(Detail, {
          id,
          saved: false,
          onSave: () => {},
          canSave: true,
          selectionFull: false,
        }),
      ),
    );
    for (const [date, expected] of [
      ["2026-09-07", "A 구간의 실제 진도"],
      ["2026-09-28", "B 구간의 실제 진도"],
    ]) {
      await act(async () =>
        document.querySelector(`button[aria-label^="${date}"]`).click(),
      );
      const panel = document.querySelector(".sessionPanel");
      assert.equal(panel.querySelectorAll("dd")[1].textContent, expected);
      assert.doesNotMatch(panel.textContent, /잘못된 진도|구간 불명 진도/);
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});

test("calendar accessible names contain every visible date and chip for regular, holiday and crowded days", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://tipsedu.co.kr/classes" },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const originalFetch = globalThis.fetch;
  const id = "b6b5da5a-b000-4b46-bc7a-dabea5b53e14";
  const sessions = [
    {
      id: "regular",
      date: "2026-09-02",
      scheduleState: "active",
      sessionNumber: 1,
    },
    { id: "holiday", date: "2026-09-25", scheduleState: "exception" },
    {
      id: "crowded-1",
      date: "2026-09-09",
      scheduleState: "active",
      sessionNumber: 2,
    },
    {
      id: "crowded-2",
      date: "2026-09-09",
      scheduleState: "active",
      sessionNumber: 3,
    },
    {
      id: "crowded-3",
      date: "2026-09-09",
      scheduleState: "makeup",
      sessionNumber: 4,
    },
    { id: "crowded-4", date: "2026-09-09", scheduleState: "exception" },
  ];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      classItem: {
        id,
        name: "수학",
        teacher: "선생님",
        room: "본관",
        tuition: 230000,
        schedule: "수 15:30-17:00",
        schedulePlan: { textbooks: [], sessions },
      },
      textbooks: [],
      progressLogs: [],
      availability: "live",
      generatedAt: "2026-09-07T00:00:00Z",
    }),
  });
  const Detail = await loadDetail();
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        createElement(Detail, {
          id,
          saved: false,
          onSave: () => {},
          canSave: true,
          selectionFull: false,
        }),
      ),
    );
    for (const [date, expectedVisible] of [
      ["2026-09-02", "2 1회차"],
      ["2026-09-25", "25 휴강"],
      ["2026-09-09", "9 2회차 3회차 보강 휴강"],
    ]) {
      const button = document.querySelector(`button[aria-label^="${date}"]`);
      const visible = button.textContent.replace(/\s+/g, " ").trim();
      assert.equal(
        visible,
        expectedVisible,
        "calendar labels remain visually unchanged",
      );
      const accessibleName = button.getAttribute("aria-label");
      assert.ok(
        accessibleName.includes(visible),
        "complete visible label must occur contiguously in the accessible name",
      );
      assert.ok(accessibleName.includes(date), "full date context is retained");
      for (const session of sessions.filter((session) => session.date === date))
        assert.ok(accessibleName.includes(helpers.sessionState(session).label));
    }
    const nextEslintRequire = createRequire(
      require.resolve("eslint-config-next"),
    );
    const jsxA11yRequire = createRequire(
      nextEslintRequire.resolve("eslint-plugin-jsx-a11y"),
    );
    const axe = jsxA11yRequire("axe-core");
    axe.utils.getFlattenedTree(document.documentElement);
    for (const button of document.querySelectorAll(".calendarCell")) {
      const node = axe.utils.getNodeFromTree(button);
      const visible = axe.commons.text
        .subtreeText(node, { subtreeDescendant: true })
        .replace(/\s+/g, " ")
        .trim();
      const name = axe.commons.text.accessibleText(button);
      assert.ok(
        name.includes(visible),
        `axe subtree text ${visible} must be in ${name}`,
      );
    }
    // Negative control reproduces the exact pre-fix DOM, not an invented label.
    const oldMarkup = document
      .querySelector('button[aria-label^="2026-09-02"]')
      .cloneNode(true);
    for (const node of [...oldMarkup.childNodes])
      if (node.nodeType === 3 && !node.textContent.trim()) node.remove();
    document.body.append(oldMarkup);
    axe.utils.getFlattenedTree(document.documentElement);
    const oldVisible = axe.commons.text.subtreeText(
      axe.utils.getNodeFromTree(oldMarkup),
      { subtreeDescendant: true },
    );
    assert.equal(oldVisible, "21회차");
    assert.equal(
      axe.commons.text.accessibleText(oldMarkup).includes(oldVisible),
      false,
    );
    oldMarkup.remove();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
