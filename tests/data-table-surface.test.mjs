import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

import { JSDOM } from "jsdom";
import { act, createElement, forwardRef } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

const require = createRequire(import.meta.url);
const componentUrl = new URL("../src/components/data-table/data-table-surface.tsx", import.meta.url);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children);
  });
}

function classNames(...values) {
  return values.flat(Infinity).filter(Boolean).join(" ");
}

async function loadSurface() {
  const source = await readFile(componentUrl, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentUrl.pathname,
  }).outputText;
  const runtimeModule = { exports: {} };
  const icons = {
    ArrowDown: (props) => createElement("svg", { ...props, "data-icon": "down" }),
    ArrowUp: (props) => createElement("svg", { ...props, "data-icon": "up" }),
    ChevronsUpDown: (props) => createElement("svg", { ...props, "data-icon": "unsorted" }),
  };
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    if (specifier === "lucide-react") return icons;
    if (specifier === "@/components/ui/table") {
      return { TableCell: passthrough("td"), TableHead: passthrough("th"), TableRow: passthrough("tr") };
    }
    if (specifier === "@/components/ui/button") return { Button: passthrough("button") };
    if (specifier === "@/lib/utils") return { cn: classNames };
    return require(specifier);
  };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename: componentUrl.pathname });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

test("pinned wrapping cells inherit row interaction colors without changing legacy table defaults", async (t) => {
  const dom = installDom();
  t.after(() => dom.window.close());
  const { DataTableBodyCell, DataTableBodyRow } = await loadSurface();
  const container = document.createElement("table");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(createElement("tbody", null,
    createElement(DataTableBodyRow, { "data-state": "selected" },
      createElement(DataTableBodyCell, { pin: { left: 40, layer: 10 }, wrap: true }, "긴 운영 메모"),
    ),
  )));

  const row = container.querySelector("tr");
  const cell = container.querySelector("td");
  assert.match(row.className, /h-12/);
  assert.match(row.className, /data-\[state=selected\]:bg-accent/);
  assert.equal(cell.style.left, "40px");
  assert.equal(cell.style.zIndex, "10");
  assert.match(cell.className, /whitespace-normal/);
  assert.match(cell.className, /break-words/);
  assert.match(cell.className, /group-hover\/data-table-row:bg-muted/);
  assert.match(cell.className, /group-data-\[state=selected\]\/data-table-row:bg-accent/);

  await act(async () => root.unmount());
});

test("sort button exposes the current state and describes the next direction", async (t) => {
  const dom = installDom();
  t.after(() => dom.window.close());
  const { DataTableSortButton } = await loadSurface();
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => root.render(createElement(DataTableSortButton, { direction: "asc", label: "이름" }, "이름")));
  const button = container.querySelector("button");
  assert.equal(button.dataset.state, "sorted");
  assert.equal(button.getAttribute("aria-label"), "이름 내림차순 정렬");
  assert.equal(button.querySelector("svg")?.dataset.icon, "up");

  await act(async () => root.render(createElement(DataTableSortButton, { direction: false, label: "이름" }, "이름")));
  assert.equal(container.querySelector("button")?.dataset.state, "unsorted");
  assert.equal(container.querySelector("button")?.getAttribute("aria-label"), "이름 오름차순 정렬");
  assert.equal(container.querySelector("svg")?.dataset.icon, "unsorted");

  await act(async () => root.unmount());
});

test("toolbar and viewport keep their semantic slots and forward the scrollport ref", async (t) => {
  const dom = installDom();
  t.after(() => dom.window.close());
  const { DataTableToolbar, DataTableViewport } = await loadSurface();
  const container = document.createElement("div");
  const root = createRoot(container);
  const viewportRef = { current: null };

  await act(async () => root.render(createElement("div", null,
    createElement(DataTableToolbar, null, "도구"),
    createElement(DataTableViewport, { ref: viewportRef, role: "region", "aria-label": "학생 목록 스크롤" }, "표"),
  )));

  assert.equal(container.querySelector("[data-slot=data-table-toolbar]")?.textContent, "도구");
  assert.equal(viewportRef.current, container.querySelector("[data-slot=data-table-viewport]"));
  assert.equal(viewportRef.current.getAttribute("aria-label"), "학생 목록 스크롤");
  assert.match(viewportRef.current.className, /overflow-auto/);

  await act(async () => root.unmount());
});

test("management lists share the opt-in surface without replacing domain state ownership", async () => {
  const source = await readFile(new URL("../src/features/management/management-data-table.tsx", import.meta.url), "utf8");

  assert.match(source, /<DataTableToolbar/);
  assert.match(source, /<DataTableViewport/);
  assert.match(source, /<DataTableHeaderCell/);
  assert.match(source, /<DataTableBodyCell[\s\S]*?wrap/);
  assert.match(source, /<DataTableSortButton[\s\S]*?direction=\{sortState\}/);
  assert.match(source, /kind === "classes" \? \(\s*<ClassFilterPanel[\s\S]*?className=\{DATA_TABLE_TOOLBAR_CLASS_NAME\}/);
  assert.match(source, /const STORAGE_VERSION = MANAGEMENT_TABLE_STORAGE_VERSION/);
  assert.match(source, /useDebouncedValue\(globalFilter, 300\)/);
  assert.match(source, /getFilteredSelectedRowModel/);
  assert.match(source, /rememberManagementScrollPosition/);
});
