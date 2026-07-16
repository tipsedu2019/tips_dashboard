import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const probeSourceUrl = new URL(
  "../src/features/tasks/registration-intake-runtime-probe.ts",
  import.meta.url,
);

async function loadProbeFactory() {
  let source;
  try {
    source = await readFile(probeSourceUrl, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  }
  const startMarker = "// registration-intake-runtime-probe-factory:start";
  const endMarker = "// registration-intake-runtime-probe-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, "intake runtime probe factory start marker must exist");
  assert.ok(end > start, "intake runtime probe factory end marker must follow start marker");

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationIntakeRuntimeProbe };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };

  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
  });
  return sandboxModule.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClient(results = []) {
  const queuedResults = [...results];
  const calls = { rpc: 0, rpcNames: [] };
  return {
    calls,
    client: {
      rpc(name) {
        calls.rpc += 1;
        calls.rpcNames.push(name);
        assert.ok(queuedResults.length > 0, "unexpected intake readiness RPC call");
        return queuedResults.shift();
      },
    },
  };
}

test("exact numeric intake runtime version 1 is available", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const harness = createClient([{ data: 1, error: null }]);
  const runtime = createRegistrationIntakeRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { available: true, version: 1 });
  assert.deepEqual(harness.calls.rpcNames, ["registration_intake_workflow_runtime_version"]);
});

test("a successful wrong numeric intake runtime version remains observable", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const harness = createClient([{ data: 2, error: null }]);

  assert.deepEqual(
    { ...(await createRegistrationIntakeRuntimeProbe(harness.client).probe()) },
    { available: true, version: 2 },
  );
});

test("a malformed successful intake runtime response is indeterminate", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();

  for (const data of ["1", null, { version: 1 }, [1]]) {
    const harness = createClient([{ data, error: null }]);
    await assert.rejects(
      createRegistrationIntakeRuntimeProbe(harness.client).probe(),
      /registration_intake_runtime_indeterminate/,
    );
  }
});

test("PGRST202 reports the intake runtime as unavailable", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const harness = createClient([{
    data: null,
    error: {
      code: "PGRST202",
      message: "Could not find the function public.registration_intake_workflow_runtime_version in the schema cache",
    },
  }]);

  assert.deepEqual(
    { ...(await createRegistrationIntakeRuntimeProbe(harness.client).probe()) },
    { available: false, version: 0 },
  );
});

test("PostgreSQL 42883 reports the intake runtime as unavailable", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const harness = createClient([{
    data: null,
    error: {
      code: "42883",
      message: "function public.registration_intake_workflow_runtime_version() does not exist",
    },
  }]);

  assert.deepEqual(
    { ...(await createRegistrationIntakeRuntimeProbe(harness.client).probe()) },
    { available: false, version: 0 },
  );
});

test("an unrelated PostgreSQL 42883 from inside the marker is indeterminate", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const unrelated = {
    code: "42883",
    message: "function dashboard_private.missing_dependency() does not exist",
  };
  const harness = createClient([{ data: null, error: unrelated }]);

  await assert.rejects(
    createRegistrationIntakeRuntimeProbe(harness.client).probe(),
    (error) => error === unrelated,
  );
});

test("the exact intake RPC schema-cache miss is unavailable", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const harness = createClient([{
    data: null,
    error: {
      message: "Could not find the function public.registration_intake_workflow_runtime_version in the schema cache",
    },
  }]);

  assert.deepEqual(
    { ...(await createRegistrationIntakeRuntimeProbe(harness.client).probe()) },
    { available: false, version: 0 },
  );
});

test("a schema-cache miss for another RPC propagates unchanged", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const unrelated = {
    message: "Could not find the function public.another_runtime_version in the schema cache",
  };
  const harness = createClient([{ data: null, error: unrelated }]);

  await assert.rejects(
    createRegistrationIntakeRuntimeProbe(harness.client).probe(),
    (error) => error === unrelated,
  );
});

test("permission errors propagate unchanged", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const permissionDenied = { code: "42501", message: "permission denied" };
  const harness = createClient([{ data: null, error: permissionDenied }]);

  await assert.rejects(
    createRegistrationIntakeRuntimeProbe(harness.client).probe(),
    (error) => error === permissionDenied,
  );
});

test("concurrent callers share one request and successful state stays cached", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const readiness = deferred();
  const harness = createClient([readiness.promise]);
  const runtime = createRegistrationIntakeRuntimeProbe(harness.client);

  const first = runtime.probe();
  const second = runtime.probe();
  assert.strictEqual(first, second);
  assert.equal(harness.calls.rpc, 1);

  readiness.resolve({ data: 1, error: null });
  assert.deepEqual({ ...(await first) }, { available: true, version: 1 });
  assert.deepEqual({ ...(await runtime.probe()) }, { available: true, version: 1 });
  assert.equal(harness.calls.rpc, 1);
});

test("reset during an in-flight request protects the fresh request and cache", async () => {
  const { createRegistrationIntakeRuntimeProbe } = await loadProbeFactory();
  const staleReadiness = deferred();
  const freshReadiness = deferred();
  const harness = createClient([staleReadiness.promise, freshReadiness.promise]);
  const runtime = createRegistrationIntakeRuntimeProbe(harness.client);

  const stale = runtime.probe();
  runtime.reset();
  const fresh = runtime.probe();
  assert.equal(harness.calls.rpc, 2);

  staleReadiness.resolve({ data: 2, error: null });
  assert.deepEqual({ ...(await stale) }, { available: true, version: 2 });
  assert.strictEqual(runtime.probe(), fresh, "stale finally must not clear the fresh request");

  freshReadiness.resolve({ data: 1, error: null });
  assert.deepEqual({ ...(await fresh) }, { available: true, version: 1 });
  assert.deepEqual({ ...(await runtime.probe()) }, { available: true, version: 1 });
  assert.equal(harness.calls.rpc, 2);
});
