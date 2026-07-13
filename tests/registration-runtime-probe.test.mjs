import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const probeSourceUrl = new URL(
  "../src/features/tasks/registration-runtime-probe.ts",
  import.meta.url,
);

async function loadProbeFactory() {
  const source = await readFile(probeSourceUrl, "utf8");
  const startMarker = "// registration-runtime-probe-factory:start";
  const endMarker = "// registration-runtime-probe-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, "runtime probe factory start marker must exist");
  assert.ok(end > start, "runtime probe factory end marker must follow start marker");

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationRuntimeProbe, RegistrationRuntimeIntegrityError };`,
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

function createClient({ readiness = [], child = [] } = {}) {
  const readinessResults = [...readiness];
  const childResults = [...child];
  const calls = {
    rpc: 0,
    child: 0,
    rpcNames: [],
    childSelects: [],
  };

  return {
    calls,
    client: {
      rpc(name) {
        calls.rpc += 1;
        calls.rpcNames.push(name);
        assert.ok(readinessResults.length > 0, "unexpected readiness RPC call");
        return readinessResults.shift();
      },
      from(table) {
        assert.equal(table, "ops_registration_subject_tracks");
        return {
          select(columns, options) {
            return {
              limit(limit) {
                calls.child += 1;
                calls.childSelects.push({ table, columns, options, limit });
                assert.ok(childResults.length > 0, "unexpected child-table probe");
                return childResults.shift();
              },
            };
          },
        };
      },
    },
  };
}

test("exact readiness version 1 returns ready without probing the child table", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({ readiness: [{ data: 1, error: null }] });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.deepEqual(harness.calls.rpcNames, ["registration_subject_tracks_runtime_version"]);
  assert.equal(harness.calls.child, 0);
});

test("an existing readiness function with a non-1 version is maintenance", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({ readiness: [{ data: 0, error: null }] });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "maintenance", version: 0 });
  assert.equal(harness.calls.child, 0);
});

test("PGRST202 plus a missing child relation is legacy and uses the zero-row head probe", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: null, error: { code: "PGRST202", message: "missing RPC" } }],
    child: [{ data: null, error: { code: "PGRST205", message: "missing relation" } }],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "legacy", version: 0 });
  assert.deepEqual(harness.calls.childSelects.map((read) => ({
    ...read,
    options: { ...read.options },
  })), [{
    table: "ops_registration_subject_tracks",
    columns: "id",
    options: { head: true, count: "exact" },
    limit: 0,
  }]);
});

test("SQL 42883 plus an existing child table is maintenance and never legacy", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: null, error: { code: "42883", message: "function does not exist" } }],
    child: [{ data: null, error: null, count: 0 }],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "maintenance", version: 0 });
  assert.equal(harness.calls.child, 1);
});

test("a narrowly matched PostgREST schema-cache message probes the child table", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{
      data: null,
      error: {
        message: "Could not find the function public.registration_subject_tracks_runtime_version in the schema cache",
      },
    }],
    child: [{ data: null, error: { code: "42P01", message: "relation does not exist" } }],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "legacy", version: 0 });
  assert.equal(harness.calls.child, 1);
});

test("unrelated readiness and child-table errors propagate without fallback", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const unrelatedSchemaError = {
    message: "Could not find another function in the schema cache",
  };
  const readinessHarness = createClient({
    readiness: [{ data: null, error: unrelatedSchemaError }],
  });

  await assert.rejects(
    readinessHarness.client
      ? createRegistrationRuntimeProbe(readinessHarness.client).probe()
      : Promise.resolve(),
    (error) => error === unrelatedSchemaError,
  );
  assert.equal(readinessHarness.calls.child, 0);

  const childError = { code: "42501", message: "permission denied" };
  const childHarness = createClient({
    readiness: [{ data: null, error: { code: "PGRST202" } }],
    child: [{ data: null, error: childError }],
  });
  await assert.rejects(
    createRegistrationRuntimeProbe(childHarness.client).probe(),
    (error) => error === childError,
  );
});

test("concurrent calls share one in-flight request and resolved states stay cached until reset", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const firstReadiness = deferred();
  const harness = createClient({
    readiness: [firstReadiness.promise, { data: 1, error: null }],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  const first = runtime.probe();
  const second = runtime.probe();
  assert.strictEqual(first, second);
  assert.equal(harness.calls.rpc, 1);

  firstReadiness.resolve({ data: 1, error: null });
  assert.deepEqual({ ...(await first) }, { mode: "ready", version: 1 });
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.equal(harness.calls.rpc, 1);

  runtime.reset();
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.equal(harness.calls.rpc, 2);
});

test("reset during an in-flight probe prevents the stale result from repopulating the cache", async () => {
  const { createRegistrationRuntimeProbe } = await loadProbeFactory();
  const staleReadiness = deferred();
  const freshReadiness = deferred();
  const harness = createClient({
    readiness: [staleReadiness.promise, freshReadiness.promise],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  const stale = runtime.probe();
  runtime.reset();
  const fresh = runtime.probe();
  assert.equal(harness.calls.rpc, 2);

  staleReadiness.resolve({ data: 0, error: null });
  assert.deepEqual({ ...(await stale) }, { mode: "maintenance", version: 0 });
  freshReadiness.resolve({ data: 1, error: null });
  assert.deepEqual({ ...(await fresh) }, { mode: "ready", version: 1 });
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.equal(harness.calls.rpc, 2);
});

test("a ready-state integrity failure resets the cache and throws an explicit error", async () => {
  const {
    createRegistrationRuntimeProbe,
    RegistrationRuntimeIntegrityError,
  } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: 1, error: null }, { data: 1, error: null }],
  });
  const runtime = createRegistrationRuntimeProbe(harness.client);

  await runtime.probe();
  const childReadError = { code: "PGRST205", message: "relation disappeared" };
  assert.throws(
    () => runtime.invalidateAfterReadyFailure(childReadError),
    (error) => (
      error instanceof RegistrationRuntimeIntegrityError
      && error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR"
      && error.cause === childReadError
    ),
  );

  await runtime.probe();
  assert.equal(harness.calls.rpc, 2);
});
