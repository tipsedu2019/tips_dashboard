import assert from "node:assert/strict";
import test from "node:test";

import { OperationTimeoutError, withPromiseTimeout } from "../src/lib/promise-timeout.ts";

test("withPromiseTimeout rejects a never-settling operation with a stable code", async () => {
  await assert.rejects(
    withPromiseTimeout(new Promise(() => {}), {
      timeoutMs: 5,
      code: "auth_operation_timeout",
      message: "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    }),
    (error) => error instanceof OperationTimeoutError
      && error.code === "auth_operation_timeout"
      && error.message === "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  );
});

test("withPromiseTimeout returns an on-time resolution unchanged", async () => {
  const result = await withPromiseTimeout(Promise.resolve({ status: "ready" }), {
    timeoutMs: 5,
    code: "auth_operation_timeout",
    message: "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  });

  assert.deepEqual(result, { status: "ready" });
});

test("withPromiseTimeout preserves the original rejection", async () => {
  const originalError = new Error("original failure");

  await assert.rejects(
    withPromiseTimeout(Promise.reject(originalError), {
      timeoutMs: 5,
      code: "auth_operation_timeout",
      message: "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
    }),
    (error) => error === originalError,
  );
});
