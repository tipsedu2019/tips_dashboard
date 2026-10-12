import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";
import { createObservationOpenHarness, deferred } from "./helpers/registration-observation-open-harness.mjs";

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

test("observation detail overlaps its cold editor import without waiting for it to commit data", async () => {
  const data = deferred();
  const attempt = deferred();
  const editor = deferred();
  const harness = await createObservationOpenHarness({
    loadDetail: () => data.promise,
    loadAttempt: () => attempt.promise,
    importEditor: () => editor.promise,
  });
  const opening = harness.open(harness.target);
  await Promise.resolve();
  assert.deepEqual(harness.calls, { detail: 1, attempt: 1, import: 1, preload: 1, options: 0 });
  assert.equal(harness.state.host.kind, "loading_detail");
  data.resolve(harness.detail);
  attempt.resolve(harness.attempt);
  const result = await opening;
  assert.equal(result.detail, harness.detail);
  assert.equal(harness.state.host.kind, "detail", "the module import must not become a new data commit gate");
  const rendered = harness.renderEditor();
  const component = function Editor() {};
  editor.resolve({ RegistrationApplication: component });
  assert.equal(await rendered, component);
  assert.equal(harness.calls.import, 1, "preload and render reuse one import");
});

test("observation preloading preserves early rejection and conditional option reads", async () => {
  for (const input of [{ runtimeVersion: 0 }, { taskType: "withdrawal" }]) {
    const harness = await createObservationOpenHarness(input);
    assert.equal(await harness.open(harness.target), null);
    assert.deepEqual(harness.calls, { detail: 0, attempt: 0, import: 0, preload: 0, options: 0 });
  }
  for (const input of [
    { loadAttempt: async () => null },
    { loadDetail: async () => ({ task: { id: "other-task" }, tracks: [] }) },
    { loadDetail: async () => { throw new Error("synthetic read failure"); } },
  ]) {
    const harness = await createObservationOpenHarness(input);
    assert.equal(await harness.open(harness.target), null);
    assert.equal(harness.state.host.kind, "closed");
    assert.deepEqual(harness.calls, { detail: 1, attempt: 1, import: 1, preload: 1, options: 0 });
  }
  const readOnly = await createObservationOpenHarness({ canManage: false });
  assert.ok(await readOnly.open(readOnly.target));
  assert.equal(readOnly.calls.options, 0);
});

test("observation preloading cannot commit stale selection, viewer, runtime, or released ownership", async () => {
  for (const invalidate of [
    h => { h.refs.registrationTrackSelectionRef.current = "new-selection"; },
    h => { h.refs.latestWorkspaceViewerIdRef.current = "new-viewer"; },
    h => { h.refs.registrationObservationRuntimeVersionRef.current = 0; },
    h => h.ownership.invalidate(),
  ]) {
    const data = deferred();
    const harness = await createObservationOpenHarness({ loadDetail: () => data.promise });
    const opening = harness.open(harness.target);
    invalidate(harness);
    data.resolve(harness.detail);
    assert.equal(await opening, null);
    assert.equal(harness.state.RegistrationCaseDetail, null);
    assert.equal(harness.state.host.kind, "loading_detail");
    assert.equal(harness.calls.options, 0);
  }
});

test("failed observation preload remains nonfatal and render retries the import", async () => {
  let imports = 0;
  const component = function Editor() {};
  const harness = await createObservationOpenHarness({ importEditor() {
    if (++imports === 1) throw new Error("synthetic chunk failure");
    return { RegistrationApplication: component };
  } });
  const result = await harness.open(harness.target);
  assert.ok(result);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.state.host.kind, "detail");
  assert.equal(await harness.renderEditor(), component);
  assert.equal(imports, 2);
  assert.equal(harness.calls.detail, 1);
  assert.equal(harness.calls.attempt, 1);
});
