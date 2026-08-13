import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const captureUrl = new URL("../scripts/capture-dashboard-free-tier-catalog.mjs", import.meta.url);
const runnerUrl = new URL("../scripts/run-isolated-supabase-db-tests.mjs", import.meta.url);

async function makeRepo(t) {
  const root = await mkdtemp(join(tmpdir(), "tips-dashboard-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of [
    "scripts/fixtures/dashboard-free-tier-baseline-scope.json",
    "scripts/fixtures/supabase-management-read-only-query-contract.json",
    "supabase/test-baselines/dashboard-free-tier-v1.manifest.json",
    "supabase/test-baselines/dashboard-free-tier-v1.sql",
    "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
    "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
    "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url));
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

test("catalog capture refuses unapproved or incomplete production reads before HTTP", async () => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  let calls = 0;
  await assert.rejects(
    captureDashboardFreeTierCatalog({
      argv: ["--mode", "execute"],
      fetch: async () => { calls += 1; },
      env: {},
    }),
    /dashboard_free_tier_catalog_approval_required/,
  );
  assert.equal(calls, 0);
});

test("catalog capture refuses a token or project ref passed through argv", async () => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const originMainSha = "a".repeat(40);
  const env = {
    SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret",
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    TASK_ORIGIN_MAIN_SHA: originMainSha,
  };
  await assert.rejects(
    captureDashboardFreeTierCatalog({
      argv: ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "sbp_only-read-secret"],
      env,
      gitOriginMainSha: async () => originMainSha,
      fetch: async () => { throw new Error("HTTP must not run"); },
    }),
    /dashboard_free_tier_catalog_argv_secret_refused/,
  );
});

test("catalog capture pins the Management API read-only request and redacts credentials", async () => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo({ after() {} });
  const originMainSha = "a".repeat(40);
  let request;
  await assert.rejects(
    captureDashboardFreeTierCatalog({
      argv: [
        "--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f",
        "--origin-main-sha", originMainSha,
        "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json",
        "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
        "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql",
        "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
      ],
      root,
      gitOriginMainSha: async () => originMainSha,
      env: {
        SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret",
        SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
        TASK_ORIGIN_MAIN_SHA: originMainSha,
      },
      fetch: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ unexpected: true }), { status: 201 });
      },
    }),
    /management_api_contract_drift/,
  );
  assert.equal(request.url, "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer sbp_only-read-secret");
  assert.deepEqual(JSON.parse(request.init.body), { query: request.init.query, parameters: [] });
  assert.doesNotMatch(request.init.query, /\b(?:vault|cron|webhook)\b/i);
  await rm(root, { recursive: true, force: true });
});

test("catalog capture maps read-only endpoint failures without producing baseline artifacts", async () => {
  const { classifyManagementApiFailure } = await import(captureUrl.href);
  assert.equal(classifyManagementApiFailure(401), "credential_invalid");
  assert.equal(classifyManagementApiFailure(403), "database_read_permission_missing");
  assert.equal(classifyManagementApiFailure(429), "rate_limited_no_output");
  assert.equal(classifyManagementApiFailure(404), "endpoint_contract_drift");
  assert.equal(classifyManagementApiFailure(500), "provider_unavailable_no_output");
  assert.equal(classifyManagementApiFailure(200), "management_api_contract_drift");
});

test("isolated DB runner only plans without the explicit local authorization contract", async () => {
  const { parseIsolatedDbArguments } = await import(runnerUrl.href);
  const plan = parseIsolatedDbArguments(["--test", "supabase/tests/dashboard_daily_brief_test.sql"]);
  assert.deepEqual(plan.tests, ["supabase/tests/dashboard_daily_brief_test.sql"]);
  assert.equal(plan.execute, false);
  assert.throws(
    () => parseIsolatedDbArguments(["--execute", "--authorized", "--request-id", "x", "--test", "../bad.sql"]),
    /isolated_supabase_db_target_invalid/,
  );
});

test("isolated DB runner refuses draft or hash-drift migrations before a local process", async () => {
  const { validateBaselineManifest } = await import(runnerUrl.href);
  assert.throws(
    () => validateBaselineManifest({
      baselineVersion: "dashboard-free-tier-v1",
      originMainSha: "a".repeat(40),
      baselineSha256: "b".repeat(64),
      catalogSha256: "c".repeat(64),
      requiredObjectSignatures: [],
      orderedNewMigrations: [{ fileName: "20260814000000_test.sql", status: "draft", sha256: null }],
    }),
    /isolated_supabase_db_manifest_invalid/,
  );
});

test("isolated DB runner binds the source-controlled baseline and catalog to manifest hashes", async (t) => {
  const { validateBaselineArtifactHashes } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  const manifest = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), "utf8"));
  await assert.doesNotReject(validateBaselineArtifactHashes({ root, manifest }));
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "-- drift\n");
  await assert.rejects(
    validateBaselineArtifactHashes({ root, manifest }),
    /isolated_supabase_db_baseline_hash_drift/,
  );
});
