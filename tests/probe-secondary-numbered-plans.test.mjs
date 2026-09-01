import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  assertMeasuredPayload,
  buildMeasurementSql,
  derivePagePositions,
  parseSecondaryPlanProbeEnvironment,
  prepareFixturePrefixForDirectPsql,
  SECONDARY_PLAN_SCENARIOS,
  selectVerifiedFixturePrefix,
} from "./probe-secondary-numbered-plans.mjs";

const execFileAsync = promisify(execFile);
const probeSourceUrl = new URL("./probe-secondary-numbered-plans.mjs", import.meta.url);

test("derives first middle and final existing pages from the authorized total", () => {
  assert.deepEqual(derivePagePositions(111, 10), [
    { label: "first", page: 1 },
    { label: "middle", page: 6 },
    { label: "final", page: 12 },
  ]);
  assert.deepEqual(derivePagePositions(126, 10), [
    { label: "first", page: 1 },
    { label: "middle", page: 7 },
    { label: "final", page: 13 },
  ]);
});

test("refuses a fixture prefix when its exact staged bytes or unique marker drift", () => {
  const source = "begin;\nfixture();\n-- marker\nassertions();\n";
  const sha256 = createHash("sha256").update(source).digest("hex");

  assert.equal(
    selectVerifiedFixturePrefix({ source, sha256, marker: "-- marker" }),
    "begin;\nfixture();\n",
  );
  assert.throws(
    () => selectVerifiedFixturePrefix({ source, sha256: "0".repeat(64), marker: "-- marker" }),
    /secondary_plan_fixture_sha_drift/,
  );
  assert.throws(
    () => selectVerifiedFixturePrefix({ source: `${source}-- marker\n`, sha256: createHash("sha256").update(`${source}-- marker\n`).digest("hex"), marker: "-- marker" }),
    /secondary_plan_fixture_marker_drift/,
  );
});

test("bootstraps the CLI-lifetime pgTAP extension and search path only inside the verified fixture transaction", () => {
  const prefix = "begin;\nselect no_plan();\ninsert into fixture values (1);\n";

  assert.equal(
    prepareFixturePrefixForDirectPsql(prefix),
    "begin;\ncreate temp table task5_pgtap_extension_before as select exists(select 1 from pg_catalog.pg_extension where extname='pgtap') as initially_present;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path = extensions, public;\nselect no_plan();\ninsert into fixture values (1);\n",
  );
  assert.throws(
    () => prepareFixturePrefixForDirectPsql("select no_plan();\n"),
    /secondary_plan_fixture_prefix_invalid/,
  );
});

test("accepts only the runner-issued loopback database contract without starting a database", () => {
  assert.deepEqual(
    parseSecondaryPlanProbeEnvironment({
      TASK_LOCAL_DB_URL: "postgresql://postgres@127.0.0.1:54321/postgres",
      TASK_LOCAL_DB_NONCE: "a".repeat(32),
    }),
    { port: 54321 },
  );
  assert.throws(
    () => parseSecondaryPlanProbeEnvironment({
      TASK_LOCAL_DB_URL: "postgresql://postgres@example.invalid:54321/postgres",
      TASK_LOCAL_DB_NONCE: "a".repeat(32),
    }),
    /secondary_plan_probe_local_authorization_required/,
  );
});

test("generates approval EXPLAIN SQL without interpolating its literal view through a quoted format string", () => {
  const approval = SECONDARY_PLAN_SCENARIOS.find((scenario) => scenario.name === "approval-list");
  const sql = buildMeasurementSql(approval);

  assert.match(sql, /format\(\$plan\$explain \(analyze, buffers, settings, format json\) select public\.list_approval_numbered_page_v1\('mine',%s,10\)\$plan\$,p_page\)/u);
  assert.doesNotMatch(sql, /format\('.*'mine'/su);
});

test("appends private pgTAP bootstrap metadata only after resetting the measured authenticated role", () => {
  const approval = SECONDARY_PLAN_SCENARIOS.find((scenario) => scenario.name === "approval-list");
  const sql = buildMeasurementSql(approval);
  const payloadEnd = sql.indexOf("reset role;", sql.indexOf("create temp table task5_probe_payload"));
  const bootstrapMetadata = sql.indexOf("pgtapBootstrap");

  assert.ok(payloadEnd >= 0);
  assert.ok(bootstrapMetadata > payloadEnd);
});

test("accepts the same warmup counts after jsonb returns its own key ordering", () => {
  const payload = {
    version: 1,
    totalCount: 111,
    pageSize: 10,
    noSendInvariant: true,
    authorization: { currentUser: "authenticated", authUid: "a", profileRole: "admin" },
    pgtapBootstrap: { initiallyPresent: false, availableDuringProbe: true },
    unmeasuredWarmupCalls: { total: 4, selectedPageReadCalls: 3, countPageReadCalls: 1 },
    functionDefinitionSha256: "a".repeat(64),
    plans: [
      { label: "first", page: 1, observedRowCount: 10, plan: [{}] },
      { label: "middle", page: 6, observedRowCount: 10, plan: [{}] },
      { label: "final", page: 12, observedRowCount: 1, plan: [{}] },
    ],
  };

  assert.strictEqual(assertMeasuredPayload(payload), payload);
});

test("a realpath-different staged probe entrypoint still executes and rejects absent local authorization before Docker", async () => {
  const root = await mkdtemp(join(tmpdir(), "secondary-plan-probe-main-"));
  const target = join(root, "target.mjs");
  const entry = join(root, "staged-probe.mjs");
  await writeFile(target, await readFile(probeSourceUrl));
  await symlink(target, entry);

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [entry], {
        env: { PATH: process.env.PATH || "" },
      }),
      (error) => error?.code === 1 && /secondary_plan_probe_local_authorization_required/u.test(error.stderr || ""),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
