import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import vm from "node:vm";

import { JSDOM } from "jsdom";
import { act, createElement, forwardRef } from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://tips.example/sign-in",
  pretendToBeVisual: true,
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? dom.window : dom.window[name],
  });
}
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

function loadLogin(auth, router, next) {
  const modules = new Map([
    ["next/navigation", {
      useRouter: () => router,
      useSearchParams: () => new URLSearchParams(next === null ? "" : { next }),
    }],
    ["next/link", { default: forwardRef(function Link({ children, ...props }, ref) {
      return createElement("a", { ...props, ref }, children);
    }), __esModule: true }],
    ["@/providers/auth-provider", { useAuth: () => auth }],
  ]);
  const cache = new Map();
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const output = ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: url.pathname,
    }).outputText;
    const runtimeModule = { exports: {} };
    const runtimeRequire = (specifier) => {
      if (modules.has(specifier)) return modules.get(specifier);
      if (specifier.startsWith("@/")) {
        const stem = new URL(`src/${specifier.slice(2)}`, root);
        const resolved = [".ts", ".tsx", ".js"].map((suffix) => new URL(stem.href + suffix)).find(existsSync);
        assert.ok(resolved, `Unresolved application import: ${specifier}`);
        return load(resolved);
      }
      return require(specifier);
    };
    const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename: url.pathname });
    factory(runtimeRequire, runtimeModule, runtimeModule.exports);
    cache.set(url.href, runtimeModule.exports);
    return runtimeModule.exports;
  }
  return load(new URL("src/app/(auth)/sign-in/components/login-form-1.tsx", root)).LoginForm1;
}

async function renderLogin(t, { next = null, signedIn = false, loginError = null, loading = false } = {}) {
  const destinations = [];
  const credentials = [];
  const Login = loadLogin({
    user: signedIn ? { id: "fixture-user" } : null,
    loading,
    authError: null,
    login: async (...values) => {
      credentials.push(values);
      if (loginError) throw loginError;
    },
  }, { replace: (href) => destinations.push(href) }, next);
  const container = document.createElement("div");
  document.body.append(container);
  const reactRoot = createRoot(container);
  t.after(async () => {
    await act(async () => reactRoot.unmount());
    container.remove();
  });
  await act(async () => reactRoot.render(createElement(Login)));
  async function submit() {
    await act(async () => {
      const values = ["fixture", "fixture-password"];
      [...container.querySelectorAll("input")].forEach((input, index) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, values[index]);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    });
    await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  }
  return { container, destinations, credentials, submit };
}

const returnCases = [
  [null, "/admin/dashboard"],
  ["/admin/registration?flow=level_test&taskPage=2&taskId=fixture-task#history", "/admin/registration?flow=level_test&taskPage=2&taskId=fixture-task#history"],
  ["/admin/students?search=%ED%99%8D%EA%B8%B8%EB%8F%99", "/admin/students?search=%ED%99%8D%EA%B8%B8%EB%8F%99"],
  ["/admin/classes?returnTo=https%3A%2F%2Foutside.example", "/admin/classes?returnTo=https%3A%2F%2Foutside.example"],
  ["/admin/students/../classes?status=active#list", "/admin/classes?status=active#list"],
  ["javascript:void(0)", "/admin/dashboard"],
  ["JaVaScRiPt:void(0)", "/admin/dashboard"],
  ["data:text/html,unsafe", "/admin/dashboard"],
  ["https://outside.example/login", "/admin/dashboard"],
  ["//outside.example/login", "/admin/dashboard"],
  ["/\\outside.example/login", "/admin/dashboard"],
  ["/\t/outside.example/login", "/admin/dashboard"],
  ["/admin/..//outside.example/login", "/admin/dashboard"],
  ["/admin/%2e%2e//outside.example/login", "/admin/dashboard"],
];

for (const [next, expected] of returnCases) {
  test(`existing session safely returns from ${JSON.stringify(next)}`, async (t) => {
    const page = await renderLogin(t, { next, signedIn: true });
    assert.deepEqual(page.destinations, [expected]);
    assert.deepEqual(page.credentials, []);
  });
}

for (const [next, expected] of returnCases) {
  test(`successful form submission safely returns from ${JSON.stringify(next)}`, async (t) => {
    const page = await renderLogin(t, { next });
    assert.deepEqual(page.destinations, []);
    await page.submit();
    assert.deepEqual(page.credentials, [["fixture", "fixture-password"]]);
    assert.deepEqual(page.destinations, [expected]);
  });
}

test("failed login preserves the inputs and does not navigate", async (t) => {
  const page = await renderLogin(t, { next: "javascript:void(0)", loginError: new Error("로그인에 실패했습니다.") });
  await page.submit();
  assert.deepEqual(page.destinations, []);
  assert.match(page.container.querySelector("[role=alert]").textContent, /로그인에 실패/);
  assert.deepEqual([...page.container.querySelectorAll("input")].map((input) => input.value), ["fixture", "fixture-password"]);
});

test("an unresolved session does not navigate", async (t) => {
  const page = await renderLogin(t, { next: "javascript:void(0)", signedIn: true, loading: true });
  assert.deepEqual(page.destinations, []);
});
