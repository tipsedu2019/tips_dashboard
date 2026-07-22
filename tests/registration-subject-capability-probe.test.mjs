import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const probeSourceUrl = new URL(
  "../src/features/tasks/registration-subject-capability-probe.ts",
  import.meta.url,
);

async function loadProbeFactory() {
  const source = await readFile(probeSourceUrl, "utf8");
  const startMarker = "// registration-subject-capability-probe-factory:start";
  const endMarker = "// registration-subject-capability-probe-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, "capability probe factory start marker must exist");
  assert.ok(end > start, "capability probe factory end marker must follow start marker");

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationSubjectCapabilityProbe };`,
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

const allGrades = [
  "초1", "초2", "초3", "초4", "초5", "초6",
  "중1", "중2", "중3", "고1", "고2", "고3",
];

const SCIENCE_DIRECTOR_PROFILE_ID = "81000000-0000-4000-8000-000000000099";

function validRows() {
  return [
    {
      subject: "영어",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: allGrades,
      sort_order: 10,
      default_director_profile_id: null,
    },
    {
      subject: "수학",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: allGrades,
      sort_order: 20,
      default_director_profile_id: null,
    },
    {
      subject: "과학",
      is_active: true,
      registration_create_enabled: true,
      grade_levels: ["고1", "고2", "고3"],
      sort_order: 30,
      default_director_profile_id: SCIENCE_DIRECTOR_PROFILE_ID,
    },
  ];
}

function plainCapabilities(value) {
  return Array.from(value, (row) => ({
    subject: row.subject,
    isActive: row.isActive,
    registrationCreateEnabled: row.registrationCreateEnabled,
    gradeLevels: [...row.gradeLevels],
    sortOrder: row.sortOrder,
    defaultDirectorProfileId: row.defaultDirectorProfileId,
  }));
}

function assertCompatibilityFallback(value) {
  const rows = plainCapabilities(value);
  assert.deepEqual(Array.from(rows, (row) => row.subject), ["영어", "수학", "과학"]);
  assert.equal(rows[0].isActive, true);
  assert.equal(rows[0].registrationCreateEnabled, true);
  assert.deepEqual(rows[0].gradeLevels, allGrades);
  assert.equal(rows[1].isActive, true);
  assert.equal(rows[1].registrationCreateEnabled, true);
  assert.deepEqual(rows[1].gradeLevels, allGrades);
  assert.equal(rows[2].isActive, false);
  assert.equal(rows[2].registrationCreateEnabled, false);
  assert.deepEqual(rows[2].gradeLevels, ["고1", "고2", "고3"]);
  assert.equal(rows[0].defaultDirectorProfileId, null);
  assert.equal(rows[1].defaultDirectorProfileId, null);
  assert.equal(rows[2].defaultDirectorProfileId, null);
}

function createClient(results) {
  const queue = [...results];
  const calls = [];
  return {
    calls,
    client: {
      rpc(name) {
        calls.push(name);
        assert.ok(queue.length > 0, "unexpected capability RPC call");
        return queue.shift();
      },
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("a missing capability RPC keeps English/math available and disables science", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();

  for (const code of ["PGRST202", "42883"]) {
    const harness = createClient([{
      data: null,
      error: {
        code,
        message: "function public.list_registration_subject_capabilities_v1 does not exist",
      },
    }]);
    const probe = createRegistrationSubjectCapabilityProbe(harness.client);

    assertCompatibilityFallback(await probe.probe());
    assert.deepEqual(harness.calls, ["list_registration_subject_capabilities_v1"]);
  }
});

test("the exact PostgREST schema-cache miss falls back even when no code is supplied", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const harness = createClient([{
    data: null,
    error: {
      message: "Could not find the function public.list_registration_subject_capabilities_v1 in the schema cache",
    },
  }]);

  assertCompatibilityFallback(
    await createRegistrationSubjectCapabilityProbe(harness.client).probe(),
  );
});

test("a valid payload enables science only for high-school grades", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const harness = createClient([{ data: validRows(), error: null }]);
  const probe = createRegistrationSubjectCapabilityProbe(harness.client);

  assert.deepEqual(plainCapabilities(await probe.probe()), [
    {
      subject: "영어",
      isActive: true,
      registrationCreateEnabled: true,
      gradeLevels: allGrades,
      sortOrder: 10,
      defaultDirectorProfileId: null,
    },
    {
      subject: "수학",
      isActive: true,
      registrationCreateEnabled: true,
      gradeLevels: allGrades,
      sortOrder: 20,
      defaultDirectorProfileId: null,
    },
    {
      subject: "과학",
      isActive: true,
      registrationCreateEnabled: true,
      gradeLevels: ["고1", "고2", "고3"],
      sortOrder: 30,
      defaultDirectorProfileId: SCIENCE_DIRECTOR_PROFILE_ID,
    },
  ]);
});

test("unknown subjects, unsafe grades, and duplicate rows fail closed to compatibility capabilities", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const unsafePayloads = [
    [...validRows().slice(0, 2), { ...validRows()[2], subject: "사회" }],
    [...validRows().slice(0, 2), { ...validRows()[2], grade_levels: ["중3", "고1"] }],
    [...validRows(), { ...validRows()[2] }],
    validRows().map((row) => row.subject === "과학" ? { ...row, default_director_profile_id: "not-a-uuid" } : row),
  ];

  for (const rows of unsafePayloads) {
    const harness = createClient([{ data: rows, error: null }]);
    const probe = createRegistrationSubjectCapabilityProbe(harness.client);
    assertCompatibilityFallback(await probe.probe());
  }
});

test("unrelated RPC failures surface without being mistaken for compatibility", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const errors = [
    { code: "42501", message: "permission denied" },
    { code: "42883", message: "function public.another_function does not exist" },
    { code: "PGRST202", message: "Could not find another function in the schema cache" },
  ];

  for (const rpcError of errors) {
    const harness = createClient([{ data: null, error: rpcError }]);
    await assert.rejects(
      createRegistrationSubjectCapabilityProbe(harness.client).probe(),
      (error) => error === rpcError,
    );
  }
});

test("concurrent and resolved probes use one RPC until reset", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const firstResult = deferred();
  const harness = createClient([
    firstResult.promise,
    { data: validRows(), error: null },
  ]);
  const probe = createRegistrationSubjectCapabilityProbe(harness.client);

  const first = probe.probe();
  const concurrent = probe.probe();
  assert.strictEqual(first, concurrent);
  assert.equal(harness.calls.length, 1);

  firstResult.resolve({ data: validRows(), error: null });
  await first;
  await probe.probe();
  assert.equal(harness.calls.length, 1);

  probe.reset();
  await probe.probe();
  assert.equal(harness.calls.length, 2);
});

test("reset during an in-flight probe prevents stale cache restoration", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const staleResult = deferred();
  const freshResult = deferred();
  const harness = createClient([staleResult.promise, freshResult.promise]);
  const probe = createRegistrationSubjectCapabilityProbe(harness.client);

  const stale = probe.probe();
  probe.reset();
  const fresh = probe.probe();
  assert.equal(harness.calls.length, 2);

  staleResult.resolve({ data: validRows(), error: null });
  await stale;
  freshResult.resolve({ data: validRows(), error: null });
  await fresh;
  await probe.probe();
  assert.equal(harness.calls.length, 2);
});

test("returned capabilities are deeply immutable and cannot poison cached or shared fallback state", async () => {
  const { createRegistrationSubjectCapabilityProbe } = await loadProbeFactory();
  const missing = {
    data: null,
    error: {
      code: "PGRST202",
      message: "missing public.list_registration_subject_capabilities_v1",
    },
  };
  const fallbackHarness = createClient([missing, missing]);
  const fallbackProbe = createRegistrationSubjectCapabilityProbe(fallbackHarness.client);
  const fallback = await fallbackProbe.probe();

  assert.equal(Object.isFrozen(fallback), true);
  assert.equal(Object.isFrozen(fallback[2]), true);
  assert.equal(Object.isFrozen(fallback[2].gradeLevels), true);
  assert.throws(
    () => { fallback[2].isActive = true; },
    (error) => error?.name === "TypeError",
  );
  assert.throws(
    () => { fallback[2].gradeLevels.push("중3"); },
    (error) => error?.name === "TypeError",
  );
  assertCompatibilityFallback(await fallbackProbe.probe());

  fallbackProbe.reset();
  assertCompatibilityFallback(await fallbackProbe.probe());

  const validHarness = createClient([{ data: validRows(), error: null }]);
  const validProbe = createRegistrationSubjectCapabilityProbe(validHarness.client);
  const capabilities = await validProbe.probe();
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(Object.isFrozen(capabilities[2]), true);
  assert.equal(Object.isFrozen(capabilities[2].gradeLevels), true);
  assert.throws(
    () => { capabilities[2].gradeLevels.push("중3"); },
    (error) => error?.name === "TypeError",
  );
});
