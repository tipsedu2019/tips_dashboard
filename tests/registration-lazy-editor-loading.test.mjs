import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function createCallableModuleProxy() {
  let proxy;
  proxy = new Proxy(function callableModuleProxy() {
    return proxy;
  }, {
    get(_target, key) {
      if (key === "__esModule") return true;
      if (key === "default") return proxy;
      return proxy;
    },
  });
  return proxy;
}

function evaluateCommonJs(source, requireModule) {
  const sandboxModule = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    require: requireModule,
    console,
    process: { env: { NODE_ENV: "test" } },
    setTimeout,
    clearTimeout,
    URL,
    AbortSignal,
  });
  return sandboxModule.exports;
}

test("the registration list module does not evaluate the closed detail editor eagerly", async () => {
  const workspaceSource = await readFile(
    new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url),
    "utf8",
  );
  const requiredModules = [];
  const genericModule = createCallableModuleProxy();

  evaluateCommonJs(workspaceSource, (moduleId) => {
    requiredModules.push(moduleId);
    return genericModule;
  });

  assert.equal(
    requiredModules.includes("./registration-track-editor"),
    false,
    "the editor must stay outside the initial list module graph",
  );
  assert.equal(
    requiredModules.includes("./registration-application-lazy"),
    true,
    "the workspace should consume the lazy editor boundary",
  );
});

test("the lazy editor boundary imports the detail editor only when its loader runs", async () => {
  const lazySource = await readFile(
    new URL("../src/features/tasks/registration-application-lazy.tsx", import.meta.url),
    "utf8",
  );
  const requiredModules = [];
  const editorComponent = function EditorComponent() {};
  let capturedLoader = null;
  const genericModule = createCallableModuleProxy();

  evaluateCommonJs(lazySource, (moduleId) => {
    requiredModules.push(moduleId);
    if (moduleId === "next/dynamic") {
      return {
        __esModule: true,
        default(loader) {
          capturedLoader = loader;
          return function LazyEditorBoundary() {};
        },
      };
    }
    if (moduleId === "./registration-track-editor") {
      return { RegistrationApplication: editorComponent };
    }
    return genericModule;
  });

  assert.equal(requiredModules.includes("./registration-track-editor"), false);
  assert.equal(typeof capturedLoader, "function");

  const loadedComponent = await capturedLoader();

  assert.equal(requiredModules.includes("./registration-track-editor"), true);
  assert.equal(loadedComponent, editorComponent);
});

test("preloading the registration editor starts one shared import before the lazy boundary renders", async () => {
  const lazySource = await readFile(
    new URL("../src/features/tasks/registration-application-lazy.tsx", import.meta.url),
    "utf8",
  );
  const requiredModules = [];
  const editorComponent = function EditorComponent() {};
  let capturedLoader = null;
  const genericModule = createCallableModuleProxy();

  const lazyModule = evaluateCommonJs(lazySource, (moduleId) => {
    requiredModules.push(moduleId);
    if (moduleId === "next/dynamic") {
      return {
        __esModule: true,
        default(loader) {
          capturedLoader = loader;
          return function LazyEditorBoundary() {};
        },
      };
    }
    if (moduleId === "./registration-track-editor") {
      return { RegistrationApplication: editorComponent };
    }
    return genericModule;
  });

  assert.equal(
    typeof lazyModule.preloadRegistrationApplication,
    "function",
    "the click path needs an explicit preload entry point",
  );

  await lazyModule.preloadRegistrationApplication();
  const loadedComponent = await capturedLoader();

  assert.equal(
    requiredModules.filter((moduleId) => moduleId === "./registration-track-editor").length,
    1,
    "preload and render must share the same editor import",
  );
  assert.equal(loadedComponent, editorComponent);
});
