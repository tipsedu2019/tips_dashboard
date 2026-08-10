import assert from "node:assert/strict";
import test from "node:test";

import {
  probeRegistrationObservationRuntime,
} from "../src/features/tasks/registration-observation-runtime-probe.ts";

function fakeRpcClient(result) {
  const calls = {
    rpcNames: [],
    retryArguments: [],
    abortSignals: [],
  };
  const client = {
    ...calls,
    rpc(name) {
      calls.rpcNames.push(name);
      const request = {
        abortSignal(signal) {
          calls.abortSignals.push(signal);
          return request;
        },
        retry(enabled) {
          calls.retryArguments.push(enabled);
          return request;
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return request;
    },
  };
  return client;
}

async function captureTimeout(work) {
  const originalAbortSignal = globalThis.AbortSignal;
  const timeoutCalls = [];
  globalThis.AbortSignal = {
    timeout(timeoutMs) {
      timeoutCalls.push(timeoutMs);
      return { timeoutMs };
    },
  };
  try {
    return { result: await work(), timeoutCalls };
  } finally {
    globalThis.AbortSignal = originalAbortSignal;
  }
}

test("runtime probe does not require the admin readiness RPC", async () => {
  const client = fakeRpcClient({ data: 0, error: null });

  const { result, timeoutCalls } = await captureTimeout(
    () => probeRegistrationObservationRuntime(client),
  );

  assert.deepEqual(result, { runtimeVersion: 0, available: false });
  assert.deepEqual(client.rpcNames, ["registration_observation_runtime_version"]);
  assert.deepEqual(client.retryArguments, [false]);
  assert.deepEqual(timeoutCalls, [12_000]);
  assert.deepEqual(client.abortSignals, [{ timeoutMs: 12_000 }]);
});

test("runtime version 1 is the only available observation runtime", async () => {
  const client = fakeRpcClient({ data: 1, error: null });

  assert.deepEqual(
    await probeRegistrationObservationRuntime(client),
    { runtimeVersion: 1, available: true },
  );

  for (const data of [-1, 2, "1", null, { runtimeVersion: 1 }]) {
    await assert.rejects(
      probeRegistrationObservationRuntime(fakeRpcClient({ data, error: null })),
      /registration_observation_runtime_payload_invalid/,
    );
  }
});

test("only an exact runtime function cache miss becomes runtime0", async () => {
  for (const error of [
    {
      code: "PGRST202",
      message: "Could not find the function public.registration_observation_runtime_version in the schema cache",
    },
    {
      code: "42883",
      message: "function public.registration_observation_runtime_version() does not exist",
    },
  ]) {
    assert.deepEqual(
      await probeRegistrationObservationRuntime(fakeRpcClient({ data: null, error })),
      { runtimeVersion: 0, available: false },
    );
  }
});

test("auth, network, and unrelated cache errors propagate unchanged", async () => {
  const errors = [
    { code: "42501", message: "permission denied" },
    { code: "PGRST202", message: "Could not find public.registration_observation_schema_readiness_v1" },
    { code: "42883", message: "function dashboard_private.missing_dependency() does not exist" },
    {
      code: "PGRST202",
      message: "Could not find public.registration_observation_runtime_version_helper in the schema cache",
    },
    {
      code: "42883",
      message: "function public.xregistration_observation_runtime_version() does not exist",
    },
    new Error("network unavailable"),
  ];

  for (const error of errors) {
    await assert.rejects(
      probeRegistrationObservationRuntime(fakeRpcClient({ data: null, error })),
      (received) => received === error,
    );
  }
});
