import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const probe = new URL("../scripts/probe-dashboard-audit-chain-concurrency.mjs", import.meta.url);

test("audit concurrency probe refuses to run without a local nonce and loopback database URL", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(probe)], { env: { ...process.env, TASK_LOCAL_DB_URL: "", TASK_LOCAL_DB_NONCE: "" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /audit_chain_probe_local_authorization_required/u);
});
