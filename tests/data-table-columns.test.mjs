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
  useEffect,
  useState,
} from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const columnsUrl = new URL("../src/components/data-table/data-table-columns.tsx", import.meta.url);
const settingsUrl = new URL("../src/components/data-table/data-table-settings.tsx", import.meta.url);

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children);
  });
}

function Button(props, ref) {
  const buttonProps = { ...props };
  const children = buttonProps.children;
  const asChild = buttonProps.asChild;
  delete buttonProps.children;
  delete buttonProps.asChild;
  delete buttonProps.variant;
  delete buttonProps.size;
  if (asChild) return cloneElement(children, { ...buttonProps, ref });
  return createElement("button", { ...buttonProps, ref }, children);
}
const ForwardedButton = forwardRef(Button);

const Checkbox = forwardRef(function Checkbox({ checked, onCheckedChange, ...props }, ref) {
  const checkboxProps = { ...props };
  delete checkboxProps.className;
  return createElement("button", {
    ...checkboxProps,
    ref,
    type: "button",
    role: "checkbox",
    "aria-checked": Boolean(checked),
    "data-state": checked ? "checked" : "unchecked",
    onClick: () => {
      if (!checkboxProps.disabled) onCheckedChange?.(!checked);
    },
  });
});

function createPopoverStubs() {
  const PopoverContext = createContext(null);

  function Popover({ children, open, onOpenChange }) {
    const [triggerElement, setTriggerElement] = useState(null);
    return createElement(PopoverContext.Provider, {
      value: { open, onOpenChange, triggerElement, setTriggerElement },
    }, children);
  }

  function PopoverTrigger({ children }) {
    const context = useContext(PopoverContext);
    return cloneElement(children, {
      "aria-expanded": context.open,
      "data-state": context.open ? "open" : "closed",
      onClick: (event) => {
        context.setTriggerElement(event.currentTarget);
        children.props.onClick?.(event);
        context.onOpenChange(!context.open);
      },
    });
  }

  function MountedPopoverContent({ children, onOpenAutoFocus, onCloseAutoFocus, ...props }) {
    const context = useContext(PopoverContext);
    const triggerElement = context.triggerElement;
    useEffect(() => {
      const event = { preventDefault() {} };
      onOpenAutoFocus?.(event);
      return () => {
        if (onCloseAutoFocus) onCloseAutoFocus(event);
        else triggerElement?.focus();
      };
    }, [onCloseAutoFocus, onOpenAutoFocus, triggerElement]);

    const contentProps = { ...props };
    for (const key of ["align", "side", "sideOffset", "collisionPadding"]) delete contentProps[key];
    return createElement("div", {
      ...contentProps,
      "data-testid": "popover-content",
      onKeyDown: (event) => {
        props.onKeyDown?.(event);
        if (event.key === "Escape" && !event.defaultPrevented) context.onOpenChange(false);
      },
    }, children);
  }

  function PopoverContent(props) {
    const context = useContext(PopoverContext);
    return context.open ? createElement(MountedPopoverContent, props) : null;
  }

  return { Popover, PopoverContent, PopoverTrigger };
}

async function compileModule(url, localModules) {
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    const local = localModules.get(specifier);
    if (local) return local;
    throw new Error(`unexpected data table import: ${specifier}`);
  };
  const runtimeModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: url.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}

async function loadDataTableColumns() {
  const popover = createPopoverStubs();
  const icons = new Proxy({}, { get: () => () => createElement("span", { "aria-hidden": "true" }) });
  const settings = await compileModule(settingsUrl, new Map([
    ["lucide-react", icons],
    ["@/components/ui/button", { Button: ForwardedButton }],
    ["@/components/ui/checkbox", { Checkbox }],
    ["@/components/ui/input", { Input: passthrough("input") }],
    ["@/components/ui/popover", popover],
    ["@/components/ui/select", {
      Select: passthrough("div"),
      SelectContent: passthrough("div"),
      SelectItem: passthrough("div"),
      SelectTrigger: passthrough("button"),
      SelectValue: passthrough("span"),
    }],
    ["@/lib/utils", { cn: (...values) => values.filter(Boolean).join(" ") }],
  ]));
  return compileModule(columnsUrl, new Map([
    ["lucide-react", icons],
    ["@/components/ui/button", { Button: ForwardedButton }],
    ["@/components/ui/checkbox", { Checkbox }],
    ["@/components/ui/popover", popover],
    ["@/components/data-table/data-table-settings", settings],
  ]));
}

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
];

async function withDom(run) {
  const previous = new Map(DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://tipsedu.co.kr/admin/textbooks",
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

function createHarness(useDataTableColumns) {
  let latest;
  const receiveLatest = (value) => { latest = value; };
  function Harness({ columns, storageKey = "columns-test", options }) {
    const result = useDataTableColumns(storageKey, columns, options);
    useEffect(() => receiveLatest(result), [result]);
    return createElement("div", null, result.columnSettingsControl);
  }
  return { Harness, latest: () => latest };
}

test("column visibility restores, enforces required columns, and persists optional toggles", async () => {
  await withDom(async ({ container, root }) => {
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    const columns = [
      { id: "title", label: "교재명", required: true },
      { id: "location", label: "위치" },
    ];
    window.localStorage.setItem("columns-test", JSON.stringify({ title: false, location: false, stale: true }));

    await act(async () => root.render(createElement(harness.Harness, {
      columns,
      options: { title: "교재 처리표 컬럼 구성" },
    })));
    assert.equal(harness.latest().isColumnVisible("title"), true);
    assert.equal(harness.latest().isColumnVisible("location"), false);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-test")), { title: true, location: false });

    const trigger = container.querySelector('button[aria-label="컬럼 구성"]');
    assert.equal(trigger?.title, "컬럼 구성");
    await act(async () => trigger.click());
    assert.match(container.textContent, /교재 처리표 컬럼 구성/);
    assert.match(container.textContent, /필수 1개 고정/);
    assert.match(container.textContent, /교재명/);
    assert.equal(container.querySelector('button[role="checkbox"][aria-label="교재명 표시"]'), null);
    const optional = container.querySelector('button[role="checkbox"][aria-label="위치 표시"]');
    assert.ok(optional);
    assert.equal(optional.getAttribute("aria-checked"), "false");
    assert.equal(container.querySelector('input[type="number"]'), null);
    assert.equal(container.querySelector('button[aria-label$="이동"]'), null);

    await act(async () => optional.click());
    assert.equal(harness.latest().isColumnVisible("location"), true);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-test")), { title: true, location: true });
  });
});

test("changing the column list removes stale entries and shows new dynamic columns by default", async () => {
  await withDom(async ({ root }) => {
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    const initial = [
      { id: "title", label: "교재명", required: true },
      { id: "main", label: "본관" },
    ];
    window.localStorage.setItem("columns-test", JSON.stringify({ title: true, main: false }));
    await act(async () => root.render(createElement(harness.Harness, { columns: initial })));

    const changed = [
      { id: "title", label: "교재명", required: true },
      { id: "annex", label: "별관" },
    ];
    await act(async () => root.render(createElement(harness.Harness, { columns: changed })));
    assert.equal(harness.latest().isColumnVisible("main"), false);
    assert.equal(harness.latest().isColumnVisible("annex"), true);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-test")), { title: true, annex: true });
  });
});

test("async column definitions keep saved dynamic visibility until the definitions are ready", async () => {
  await withDom(async ({ root }) => {
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    const requiredOnly = [{ id: "title", label: "교재명", required: true }];
    window.localStorage.setItem("columns-test", JSON.stringify({ title: true, "location:main": false }));

    await act(async () => root.render(createElement(harness.Harness, {
      columns: requiredOnly,
      options: { ready: false },
    })));
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-test")), {
      title: true,
      "location:main": false,
    });

    const complete = [
      ...requiredOnly,
      { id: "location:main", label: "본관" },
      { id: "location:annex", label: "별관" },
    ];
    await act(async () => root.render(createElement(harness.Harness, {
      columns: complete,
      options: { ready: true },
    })));
    assert.equal(harness.latest().isColumnVisible("location:main"), false);
    assert.equal(harness.latest().isColumnVisible("location:annex"), true);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-test")), {
      title: true,
      "location:main": false,
      "location:annex": true,
    });
  });
});

test("column visibility lookup stays stable across an unrelated rerender", async () => {
  await withDom(async ({ root }) => {
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    const columns = [
      { id: "title", label: "교재명", required: true },
      { id: "location", label: "위치" },
    ];
    await act(async () => root.render(createElement(harness.Harness, { columns })));
    const firstLookup = harness.latest().isColumnVisible;
    await act(async () => root.render(createElement(harness.Harness, { columns })));
    assert.equal(harness.latest().isColumnVisible, firstLookup);
  });
});

test("unavailable browser storage falls back to visible columns without breaking toggles", async () => {
  await withDom(async ({ container, root }) => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("blocked"); },
        removeItem() { throw new Error("blocked"); },
      },
    });
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    const columns = [
      { id: "title", label: "교재명", required: true },
      { id: "location", label: "위치" },
    ];
    await act(async () => root.render(createElement(harness.Harness, { columns })));
    assert.equal(harness.latest().isColumnVisible("title"), true);
    assert.equal(harness.latest().isColumnVisible("location"), true);
    await act(async () => container.querySelector('button[aria-label="컬럼 구성"]').click());
    await act(async () => container.querySelector('button[role="checkbox"][aria-label="위치 표시"]').click());
    assert.equal(harness.latest().isColumnVisible("location"), false);
  });
});

test("Escape closes column settings and restores focus to its trigger", async () => {
  await withDom(async ({ container, root }) => {
    const { useDataTableColumns } = await loadDataTableColumns();
    const harness = createHarness(useDataTableColumns);
    await act(async () => root.render(createElement(harness.Harness, {
      columns: [
        { id: "title", label: "교재명", required: true },
        { id: "location", label: "위치" },
      ],
    })));
    const trigger = container.querySelector('button[aria-label="컬럼 구성"]');
    trigger.focus();
    await act(async () => trigger.click());
    assert.equal(document.activeElement?.getAttribute("aria-label"), "컬럼 구성 닫기");
    const content = container.querySelector('[data-testid="popover-content"]');
    await act(async () => content.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(container.querySelector('[data-testid="popover-content"]'), null);
    assert.equal(document.activeElement, trigger);
  });
});

test("persisted hidden columns hydrate server markup without a mismatch before applying the preference", async () => {
  const { useDataTableColumns } = await loadDataTableColumns();
  const columns = [
    { id: "title", label: "교재명", required: true },
    { id: "classification", label: "분류" },
  ];
  function HydrationProbe() {
    const { isColumnVisible } = useDataTableColumns("columns-hydration", columns);
    return createElement("div", null,
      createElement("span", { "data-column": "title" }, "교재명"),
      isColumnVisible("classification")
        ? createElement("span", { "data-column": "classification" }, "분류")
        : null,
    );
  }

  const previous = new Map(DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of DOM_GLOBALS) delete globalThis[key];
  const serverMarkup = renderToString(createElement(HydrationProbe));
  assert.match(serverMarkup, /data-column="classification"/);

  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${serverMarkup}</div></body></html>`, {
    url: "https://tipsedu.co.kr/admin/textbooks",
  });
  dom.window.localStorage.setItem("columns-hydration", JSON.stringify({ title: true, classification: false }));
  for (const key of DOM_GLOBALS) {
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { hydrateRoot } = await import("react-dom/client");
  const recoverableErrors = [];
  const container = document.getElementById("root");
  const root = hydrateRoot(container, createElement(HydrationProbe), {
    onRecoverableError: (error) => recoverableErrors.push(error),
  });

  try {
    await act(async () => {});
    assert.deepEqual(recoverableErrors, []);
    assert.equal(container.querySelector('[data-column="classification"]'), null);
    assert.deepEqual(JSON.parse(window.localStorage.getItem("columns-hydration")), {
      title: true,
      classification: false,
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
