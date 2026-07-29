import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const probeSourceUrl = new URL(
  "../src/features/academic/continuous-class-schedule-runtime-probe.ts",
  import.meta.url,
);

async function loadProbeFactory() {
  const source = await readFile(probeSourceUrl, "utf8");
  const startMarker = "// continuous-class-schedule-runtime-probe-factory:start";
  const endMarker = "// continuous-class-schedule-runtime-probe-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, "runtime probe factory start marker must exist");
  assert.ok(end > start, "runtime probe factory end marker must follow start marker");

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createContinuousScheduleRuntimeProbe, ContinuousScheduleRuntimeIntegrityError };`,
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
        assert.equal(table, "class_lesson_sessions");
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

for (const scenario of [
  {
    name: "version 1 is ready",
    readiness: { data: 1, error: null },
    expected: { mode: "ready", version: 1 },
    tableReads: 0,
  },
  {
    name: "version 0 is shadow",
    readiness: { data: 0, error: null },
    expected: { mode: "shadow", version: 0 },
    tableReads: 0,
  },
  {
    name: "unknown version fails closed to shadow",
    readiness: { data: 9, error: null },
    expected: { mode: "shadow", version: 0 },
    tableReads: 0,
  },
]) {
  test(scenario.name, async () => {
    const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
    const harness = createClient({ readiness: [scenario.readiness] });
    const runtime = createContinuousScheduleRuntimeProbe(harness.client);

    assert.deepEqual({ ...(await runtime.probe()) }, scenario.expected);
    assert.deepEqual(harness.calls.rpcNames, [
      "continuous_class_schedule_runtime_version",
    ]);
    assert.equal(harness.calls.child, scenario.tableReads);
  });
}

test("missing RPC plus missing table returns legacy from the zero-row head probe", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: null, error: { code: "PGRST202", message: "missing RPC" } }],
    child: [{ data: null, error: { code: "PGRST205", message: "missing table" } }],
  });
  const runtime = createContinuousScheduleRuntimeProbe(harness.client);

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "legacy", version: 0 });
  assert.deepEqual(harness.calls.childSelects.map((read) => ({
    ...read,
    options: { ...read.options },
  })), [{
    table: "class_lesson_sessions",
    columns: "id",
    options: { head: true, count: "exact" },
    limit: 0,
  }]);
});

test("missing RPC plus an existing table returns shadow", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: null, error: { code: "42883", message: "function does not exist" } }],
    child: [{ data: null, error: null, count: 0 }],
  });

  assert.deepEqual(
    { ...(await createContinuousScheduleRuntimeProbe(harness.client).probe()) },
    { mode: "shadow", version: 0 },
  );
});

test("only the matching schema-cache message falls back to the table probe", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{
      data: null,
      error: {
        message: "Could not find the function public.continuous_class_schedule_runtime_version in the schema cache",
      },
    }],
    child: [{ data: null, error: { code: "42P01", message: "relation does not exist" } }],
  });

  assert.deepEqual(
    { ...(await createContinuousScheduleRuntimeProbe(harness.client).probe()) },
    { mode: "legacy", version: 0 },
  );
});

test("unrelated RPC and table errors propagate without fallback", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const unrelatedRpcError = { message: "Could not find another function in the schema cache" };
  const rpcHarness = createClient({
    readiness: [{ data: null, error: unrelatedRpcError }],
  });

  await assert.rejects(
    createContinuousScheduleRuntimeProbe(rpcHarness.client).probe(),
    (error) => error === unrelatedRpcError,
  );
  assert.equal(rpcHarness.calls.child, 0);

  const tableError = { code: "42501", message: "permission denied" };
  const tableHarness = createClient({
    readiness: [{ data: null, error: { code: "PGRST202" } }],
    child: [{ data: null, error: tableError }],
  });
  await assert.rejects(
    createContinuousScheduleRuntimeProbe(tableHarness.client).probe(),
    (error) => error === tableError,
  );
});

test("concurrent probes share one request and cache the resolved state until reset", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const firstReadiness = deferred();
  const harness = createClient({
    readiness: [firstReadiness.promise, { data: 1, error: null }],
  });
  const runtime = createContinuousScheduleRuntimeProbe(harness.client);

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

test("reset during an in-flight probe cannot repopulate the cache with a stale result", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  const staleReadiness = deferred();
  const freshReadiness = deferred();
  const harness = createClient({
    readiness: [staleReadiness.promise, freshReadiness.promise],
  });
  const runtime = createContinuousScheduleRuntimeProbe(harness.client);

  const stale = runtime.probe();
  runtime.reset();
  const fresh = runtime.probe();
  assert.equal(harness.calls.rpc, 2);

  staleReadiness.resolve({ data: 0, error: null });
  assert.deepEqual({ ...(await stale) }, { mode: "shadow", version: 0 });
  freshReadiness.resolve({ data: 1, error: null });
  assert.deepEqual({ ...(await fresh) }, { mode: "ready", version: 1 });
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.equal(harness.calls.rpc, 2);
});

test("ready-state integrity failure resets the cache and throws an explicit error", async () => {
  const {
    createContinuousScheduleRuntimeProbe,
    ContinuousScheduleRuntimeIntegrityError,
  } = await loadProbeFactory();
  const harness = createClient({
    readiness: [{ data: 1, error: null }, { data: 1, error: null }],
  });
  const runtime = createContinuousScheduleRuntimeProbe(harness.client);

  await runtime.probe();
  const cause = { code: "PGRST205", message: "relation disappeared" };
  assert.throws(
    () => runtime.invalidateAfterReadyFailure(cause),
    (error) => (
      error instanceof ContinuousScheduleRuntimeIntegrityError
      && error.code === "CONTINUOUS_SCHEDULE_RUNTIME_INTEGRITY_ERROR"
      && error.cause === cause
    ),
  );

  await runtime.probe();
  assert.equal(harness.calls.rpc, 2);
});

test("probe cache expires and a focus reset fetches the runtime marker again", async () => {
  const { createContinuousScheduleRuntimeProbe } = await loadProbeFactory();
  let now = 0;
  const harness = createClient({
    readiness: [{ data: 0, error: null }, { data: 1, error: null }, { data: 0, error: null }],
  });
  const runtime = createContinuousScheduleRuntimeProbe(harness.client, {
    now: () => now,
    maxAgeMs: 1_000,
  });

  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "shadow", version: 0 });
  now = 999;
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "shadow", version: 0 });
  assert.equal(harness.calls.rpc, 1);

  now = 1_000;
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "ready", version: 1 });
  assert.equal(harness.calls.rpc, 2);

  runtime.resetForFocus();
  assert.deepEqual({ ...(await runtime.probe()) }, { mode: "shadow", version: 0 });
  assert.equal(harness.calls.rpc, 3);
});
