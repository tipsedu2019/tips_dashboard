import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAuditConcurrencyProbe } from "../scripts/probe-dashboard-audit-chain-concurrency.mjs";

const probe = new URL("../scripts/probe-dashboard-audit-chain-concurrency.mjs", import.meta.url);

test("audit concurrency probe refuses to run without a local nonce and loopback database URL", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(probe)], { env: { ...process.env, TASK_LOCAL_DB_URL: "", TASK_LOCAL_DB_NONCE: "" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /audit_chain_probe_local_authorization_required/u);
});

test("audit concurrency probe validates the exact chain and rollback-gap result", async () => {
  const result = await runAuditConcurrencyProbe({
    env: { TASK_LOCAL_DB_URL: "postgresql://postgres:postgres@127.0.0.1:55432/postgres", TASK_LOCAL_DB_NONCE: "0123456789abcdef" },
    execute: async () => ({ version: 1, sameEntityChain: true, rollbackGapPreserved: true }),
  });
  assert.deepEqual(result, { version: 1, sameEntityChain: true, rollbackGapPreserved: true });
});

test("audit concurrency probe rejects incomplete runtime evidence", async () => {
  await assert.rejects(
    runAuditConcurrencyProbe({
      env: { TASK_LOCAL_DB_URL: "postgresql://postgres:postgres@localhost:55432/postgres", TASK_LOCAL_DB_NONCE: "0123456789abcdef" },
      execute: async () => ({ version: 1, sameEntityChain: true, rollbackGapPreserved: false }),
    }),
    /audit_chain_probe_result_drift/u,
  );
});
