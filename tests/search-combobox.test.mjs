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
  useState,
} from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const componentUrl = new URL("../src/components/ui/search-combobox.tsx", import.meta.url);
const textbookPickerUrl = new URL("../src/features/management/class-textbook-picker.tsx", import.meta.url);
const relationPickerUrl = new URL("../src/features/management/management-relation-combobox.tsx", import.meta.url);

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children);
  });
}

function createComboboxUiStubs() {
  const PopoverContext = createContext(null);

  function Popover({ children, open, onOpenChange }) {
    return createElement(PopoverContext.Provider, { value: { open, onOpenChange } }, children);
  }

  function PopoverTrigger({ children }) {
    const context = useContext(PopoverContext);
    return cloneElement(children, {
      "aria-controls": children.props["aria-controls"] || "popover-content",
      onClick: (event) => {
        children.props.onClick?.(event);
        context.onOpenChange(!context.open);
      },
    });
  }

  function PopoverContent({ children, ...props }) {
    const context = useContext(PopoverContext);
    return context.open ? createElement("div", { ...props, id: "popover-content" }, children) : null;
  }

  const Command = forwardRef(function Command(props, ref) {
    const commandProps = { ...props };
    delete commandProps.children;
    delete commandProps.shouldFilter;
    delete commandProps.onValueChange;
    commandProps.onKeyDown = (event) => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented || event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.querySelector('[role="option"]')?.click();
    };
    return createElement("div", { ...commandProps, ref }, props.children);
  });
  const CommandInput = forwardRef(function CommandInput({ onValueChange, ...props }, ref) {
    const inputProps = { ...props };
    delete inputProps.id;
    return createElement("input", {
      ...inputProps,
      id: "cmdk-input",
      ref,
      onChange: (event) => onValueChange?.(event.target.value),
    });
  });
  const CommandList = forwardRef(function CommandList({ children, ...props }, ref) {
    const listProps = { ...props };
    delete listProps.id;
    return createElement("div", { ...listProps, id: "cmdk-list", ref, role: "listbox" }, children);
  });
  const CommandEmpty = passthrough("div");
  const CommandGroup = passthrough("div");
  const CommandItem = forwardRef(function CommandItem({ children, onSelect, value, ...props }, ref) {
    return createElement("button", {
      ...props,
      ref,
      type: "button",
      role: "option",
      onClick: () => onSelect?.(value),
    }, children);
  });

  return {
    command: {
      Command,
      CommandEmpty,
      CommandGroup,
      CommandInput,
      CommandItem,
      CommandList,
    },
    popover: { Popover, PopoverContent, PopoverTrigger },
  };
}

async function loadSearchCombobox() {
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
  const ui = createComboboxUiStubs();
  const localModules = new Map([
    ["lucide-react", { ChevronsUpDownIcon: () => createElement("span", { "aria-hidden": "true" }) }],
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/command", ui.command],
    ["@/components/ui/popover", ui.popover],
    ["@/components/ui/separator", { Separator: passthrough("hr") }],
    ["@/lib/utils", { cn: (...values) => values.filter(Boolean).join(" ") }],
  ]);
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    const local = localModules.get(specifier);
    if (local) return local;
    throw new Error(`unexpected search combobox import: ${specifier}`);
  };
  const runtimeModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: componentUrl.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}

async function loadClassTextbookPicker(searchCombobox) {
  const source = await readFile(textbookPickerUrl, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: textbookPickerUrl.pathname,
  }).outputText;
  const ui = createComboboxUiStubs();
  const taxonomy = await import("../src/features/textbooks/textbook-taxonomy.ts");
  const pickerModel = await import("../src/features/management/class-textbook-picker-model.ts");
  const Select = forwardRef(function Select(props, ref) {
    const selectProps = { ...props };
    delete selectProps.children;
    delete selectProps.onValueChange;
    return createElement("div", { ...selectProps, ref }, props.children);
  });
  const SelectContent = passthrough("div");
  const SelectGroup = passthrough("div");
  const SelectItem = passthrough("button");
  const SelectTrigger = passthrough("button");
  const SelectValue = passthrough("span");
  const localModules = new Map([
    ["lucide-react", { ChevronDown: () => createElement("span", { "aria-hidden": "true" }) }],
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/input", { Input: passthrough("input") }],
    ["@/components/ui/popover", ui.popover],
    ["@/components/ui/search-combobox", searchCombobox],
    ["@/components/ui/select", { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue }],
    ["@/features/textbooks/textbook-taxonomy", taxonomy],
    ["./class-textbook-picker-model", pickerModel],
    ["./picker-meta-pills", { PickerMetaPills: () => null }],
    ["./picker-filter-surface", {
      PICKER_FILTER_TRIGGER_CLASS_NAME: "",
      PickerFilterField: passthrough("div"),
      PickerFilterSurface: passthrough("div"),
    }],
  ]);
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    const local = localModules.get(specifier);
    if (local) return local;
    throw new Error(`unexpected class textbook picker import: ${specifier}`);
  };
  const runtimeModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: textbookPickerUrl.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports.ClassTextbookPicker;
}

async function loadManagementRelationCombobox(searchCombobox) {
  const source = await readFile(relationPickerUrl, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relationPickerUrl.pathname,
  }).outputText;
  const localModules = new Map([
    ["@/components/ui/search-combobox", searchCombobox],
    ["@/lib/utils", { cn: (...values) => values.filter(Boolean).join(" ") }],
  ]);
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier);
    const local = localModules.get(specifier);
    if (local) return local;
    throw new Error(`unexpected management relation combobox import: ${specifier}`);
  };
  const runtimeModule = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: relationPickerUrl.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports.ManagementRelationCombobox;
}

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
];

async function withDom(run) {
  const previous = new Map(DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://tipsedu.co.kr",
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

async function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("search combobox exposes its controlled search and option selection through listbox semantics", async () => {
  const { SearchCombobox, SearchComboboxItem } = await loadSearchCombobox();
  const queries = [];
  const selections = [];
  const actions = [];

  function Harness() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    return createElement(SearchCombobox, {
      open,
      onOpenChange: setOpen,
      triggerLabel: "교재 검색 또는 선택",
      triggerId: "textbook-picker-trigger",
      triggerPlaceholder: true,
      searchValue: query,
      onSearchValueChange: (value) => {
        queries.push(value);
        setQuery(value);
      },
      searchPlaceholder: "교재명, 출판사 검색",
      searchAriaLabel: "교재 검색",
      emptyMessage: "조건에 맞는 교재 없음",
      searchAction: createElement("button", {
        type: "button",
        "data-testid": "show-all",
        onClick: () => actions.push("show-all"),
      }, "전체 보기"),
      footer: createElement("button", {
        type: "button",
        "data-testid": "load-more",
        onClick: () => actions.push("load-more"),
      }, "다음 30건"),
      filters: createElement("div", { "data-testid": "filters" }, "필터"),
    }, createElement(SearchComboboxItem, {
        value: "book-1",
        onSelect: () => selections.push("book-1"),
      }, "첫 교재"));
  }

  await withDom(async ({ container, root }) => {
    await act(async () => root.render(createElement(Harness)));
    const trigger = container.querySelector('[role="combobox"]');
    assert.ok(trigger);
    assert.equal(trigger.id, "textbook-picker-trigger");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(container.querySelector('[role="listbox"]'), null);

    await act(async () => trigger.click());
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.ok(container.querySelector('[role="listbox"]'));
    assert.ok(container.querySelector('[data-testid="filters"]'));
    assert.ok(document.getElementById(trigger.getAttribute("aria-controls")));

    const input = container.querySelector('input[aria-label="교재 검색"]');
    assert.ok(input);
    await setInputValue(input, "수학");
    assert.deepEqual(queries, ["수학"]);

    const option = container.querySelector('[role="option"]');
    assert.ok(option);

    for (const testId of ["show-all", "load-more"]) {
      const action = container.querySelector(`[data-testid="${testId}"]`);
      assert.ok(action);
      const shouldRunDefault = action.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
      if (shouldRunDefault) action.click();
    }
    assert.deepEqual(actions, ["show-all", "load-more"]);
    assert.deepEqual(selections, []);

    await act(async () => option.click());
    assert.deepEqual(selections, ["book-1"]);
  });
});

test("class textbook picker searches and appends a textbook through the shared combobox without closing it", async () => {
  const searchCombobox = await loadSearchCombobox();
  const ClassTextbookPicker = await loadClassTextbookPicker(searchCombobox);
  const queries = [];
  const selections = [];
  const filters = [];
  const textbooks = [{
    id: "book-1",
    title: "고3 수학 실전",
    subject: "math",
    schoolLevel: "high",
    gradeLevel: "h3",
    schoolLevels: ["high"],
    gradeLevels: ["h3"],
    subSubject: "모의고사",
    publisher: "TIPS",
  }];
  const onFiltersChange = (value) => filters.push(value);

  function Harness() {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState([]);
    return createElement(ClassTextbookPicker, {
      classRecord: { subject: "수학", grade: "고3" },
      textbooks,
      selectedIds,
      disabled: false,
      loading: false,
      hasMore: false,
      query,
      onQueryChange: (value) => {
        queries.push(value);
        setQuery(value);
      },
      onFiltersChange,
      onLoadMore: () => undefined,
      onSelectedIdsChange: (value) => {
        selections.push(value);
        setSelectedIds(value);
      },
    });
  }

  await withDom(async ({ container, root }) => {
    await act(async () => root.render(createElement(Harness)));
    const trigger = container.querySelector('[role="combobox"]');
    assert.ok(trigger, "the picker trigger must expose combobox semantics");

    await act(async () => trigger.click());
    assert.match(container.textContent, /전체 보기/);
    const input = container.querySelector('input[aria-label="교재 검색"]');
    assert.ok(input);
    await setInputValue(input, "고3");
    assert.deepEqual(queries, ["고3"]);

    const option = container.querySelector('[role="option"]');
    assert.ok(option);
    await act(async () => option.click());
    assert.deepEqual(selections, [["book-1"]]);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(container.querySelector('[role="option"]'), null, "selected textbooks leave the candidate list");
    assert.ok(filters.length >= 1);
  });
});

test("class textbook picker keeps the show-all reset available while candidates remain", async () => {
  const captured = [];
  const SearchCombobox = (props) => {
    captured.push(props);
    return createElement("div");
  };
  const ClassTextbookPicker = await loadClassTextbookPicker({
    SearchCombobox,
    SearchComboboxItem: passthrough("div"),
  });
  const onFiltersChange = () => undefined;

  await withDom(async ({ root }) => {
    await act(async () => root.render(createElement(ClassTextbookPicker, {
      classRecord: { subject: "수학", grade: "고3" },
      textbooks: [{
        id: "book-1",
        title: "고3 수학 실전",
        subject: "math",
        schoolLevel: "high",
        gradeLevel: "h3",
      }],
      selectedIds: [],
      disabled: false,
      loading: false,
      hasMore: false,
      query: "",
      onQueryChange: () => undefined,
      onFiltersChange,
      onLoadMore: () => undefined,
      onSelectedIdsChange: () => undefined,
    })));

    assert.match(String(captured.at(-1).searchAction.props.children), /전체 보기/);
    assert.equal(captured.at(-1).emptyMessage, "조건에 맞는 교재 없음");
  });
});

test("management relation combobox forwards its selected command value and labeled trigger id", async () => {
  const captured = [];
  const SearchCombobox = (props) => {
    captured.push(props);
    return createElement("div");
  };
  const SearchComboboxItem = passthrough("div");
  const ManagementRelationCombobox = await loadManagementRelationCombobox({
    SearchCombobox,
    SearchComboboxItem,
  });

  await withDom(async ({ root }) => {
    await act(async () => root.render(createElement(ManagementRelationCombobox, {
      open: true,
      onOpenChange: () => undefined,
      disabled: false,
      relationLabel: "수업",
      selectedLabel: "고3 수학",
      query: "",
      onQueryChange: () => undefined,
      selectedId: "class-2",
      items: [{ id: "class-2", title: "고3 수학" }],
      onSelect: () => undefined,
      triggerId: "students-relation-picker-trigger",
    })));

    assert.equal(captured.at(-1).selectedValue, "class-2");
    assert.equal(captured.at(-1).triggerId, "students-relation-picker-trigger");
  });
});

test("management relation combobox selects one relation and exposes its selected label", async () => {
  const searchCombobox = await loadSearchCombobox();
  const ManagementRelationCombobox = await loadManagementRelationCombobox(searchCombobox);
  const selections = [];

  function Harness() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const selected = selectedId === "class-1" ? "고3 수학 · 월수금" : "";
    return createElement(ManagementRelationCombobox, {
      open,
      onOpenChange: setOpen,
      disabled: false,
      relationLabel: "수업",
      selectedLabel: selected,
      query,
      onQueryChange: setQuery,
      selectedId,
      items: [{ id: "class-1", title: "고3 수학", meta: createElement("span", null, "월수금") }],
      onSelect: (id) => {
        selections.push(id);
        setSelectedId(id);
        setQuery("");
        setOpen(false);
      },
      filters: createElement("div", null, "필터"),
    });
  }

  await withDom(async ({ container, root }) => {
    await act(async () => root.render(createElement(Harness)));
    const trigger = container.querySelector('[role="combobox"]');
    assert.ok(trigger);
    assert.match(trigger.textContent, /수업 검색 또는 선택/);

    await act(async () => trigger.click());
    const option = container.querySelector('[role="option"]');
    assert.ok(option);
    await act(async () => option.click());
    assert.deepEqual(selections, ["class-1"]);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.match(trigger.textContent, /고3 수학 · 월수금/);
  });
});
