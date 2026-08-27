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
    return context.open ? createElement("div", contentProps, children) : null;
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

  try {
    return await run({ container, root });
  } finally {
    await act(async () => root.unmount());
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
        onLoadRoster: async (classId, mode) => {
          calls.push([classId, mode]);
          return [
            { id: "student-2", name: "나학생", school: "중앙여고", grade: "고2" },
            { id: "student-1", name: "가학생", school: "중앙여고", grade: "고2" },
          ];
        },
      }));
    });

    const trigger = container.querySelector('button[aria-label="등록 학생 2명 보기"]');
    assert.ok(trigger, "registered roster trigger should render from the count-only list row");

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    assert.deepEqual(calls, [["class-1", "registered"]]);
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
