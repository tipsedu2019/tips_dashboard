import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const captureUrl = new URL("../scripts/capture-dashboard-free-tier-catalog.mjs", import.meta.url);
const runnerUrl = new URL("../scripts/run-isolated-supabase-db-tests.mjs", import.meta.url);
const docker = "/usr/local/bin/docker";
const postgres17Image = "public.ecr.aws/supabase/postgres:17.6.1.156";

function captureScopeFixture(functions = ["public.get_dashboard_summary_sources_v1()"]) {
  return {
    version: 1, schemas: ["public"], relations: ["public.classes"], types: ["public.class_status"], sequences: ["public.classes_id_seq"],
    collations: [], functions, roles: ["anon"], triggerTables: ["public.classes"],
    requiredKinds: ["role", "schema", "type", "sequence", "table", "default", "constraint", "index", "function", "rls", "policy", "grant", "trigger"], forbiddenTerms: ["vault", "cron", "webhook", "secret", "token"],
  };
}

async function withPostgres17(t, run) {
  const name = `tips-task1-postgres17-${process.pid}-${randomBytes(4).toString("hex")}`;
  const invoke = (args, options = {}) => spawnSync(docker, args, { encoding: "utf8", timeout: 60_000, ...options });
  const started = invoke(["run", "--rm", "--detach", "--name", name, "--env", "POSTGRES_PASSWORD=task-local-only", postgres17Image]);
  assert.equal(started.status, 0, started.stderr);
  t.after(() => invoke(["rm", "--force", name]));
  let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = invoke(["exec", name, "psql", "--quiet", "--tuples-only", "--no-align", "--username", "supabase_admin", "--dbname", "postgres", "--command", "select 1"]);
    consecutiveReadyChecks = result.status === 0 ? consecutiveReadyChecks + 1 : 0;
    if (consecutiveReadyChecks === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(consecutiveReadyChecks, 3, "isolated PostgreSQL 17 did not become stably ready");
  const psql = (sql) => invoke(["exec", "--interactive", name, "psql", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--username", "supabase_admin", "--dbname", "postgres"], { input: sql });
  const setup = psql(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations(version text, name text, statements_sha256 text);
    create schema if not exists dashboard_private;
    create or replace function dashboard_private.continuous_class_schedule_hash_v1(value jsonb)
    returns text language sql immutable as $$ select repeat('0', 64) $$;
    create or replace function public.get_dashboard_conflict_sources_v1(date, date)
    returns void language plpgsql as $$ begin end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    create extension if not exists pgtap;
  `);
  assert.equal(setup.status, 0, setup.stderr);
  return run({ psql });
}

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

async function writeCaptureScope(root) {
  await writeFile(join(root, "scripts/fixtures/dashboard-free-tier-baseline-scope.json"), JSON.stringify(captureScopeFixture()));
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
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body, { query: body.query, parameters: [] });
  assert.doesNotMatch(body.query, /\b(?:vault|cron|webhook)\b/i);
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
  await writeCaptureScope(root);
  const manifest = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), "utf8"));
  await assert.doesNotReject(validateBaselineArtifactHashes({ root, manifest }));
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "-- drift\n");
  await assert.rejects(
    validateBaselineArtifactHashes({ root, manifest }),
    /isolated_supabase_db_baseline_hash_drift/,
  );
});

test("reviewed catalog capture atomically writes normalized catalog, baseline SQL, and parity checks", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "a".repeat(40);
  const output = [
    "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
    "supabase/test-baselines/dashboard-free-tier-v1.sql",
    "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
  ];
  const result = await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", output[0], "--baseline", output[1], "--parity-test", output[2]],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{ version: "20260813093446", name: "registration_observation_legacy_schedule_slot_catalogs", statements_sha256: "a".repeat(64) }],
      catalog: completeCatalogFixture(),
    }), { status: 201 }),
  });
  const pointer = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json"), "utf8"));
  const active = join(root, "supabase/test-baselines/dashboard-free-tier-v1-captures", pointer.captureId);
  const catalog = JSON.parse(await readFile(join(active, "catalog.json"), "utf8"));
  const baseline = await readFile(join(active, "baseline.sql"), "utf8");
  const parity = await readFile(join(active, "parity.sql"), "utf8");
  const canonicalCatalog = await readFile(join(root, output[0]), "utf8");
  const canonicalBaseline = await readFile(join(root, output[1]), "utf8");
  const canonicalParity = await readFile(join(root, output[2]), "utf8");
  assert.equal(result.captureStatus, "reviewed");
  assert.equal(catalog.catalog[0].definition, undefined);
  assert.equal(catalog.catalog.find((entry) => entry.objectKind === "table" && entry.identity === "classes").definitionSha256, createHash("sha256").update("create table public.classes (id text primary key)").digest("hex"));
  assert.match(baseline, /create table public\.classes/u);
  assert.match(parity, /pg_get_functiondef/u);
  assert.match(parity, /catalog trigger public\.classes\.before\.01\.normalize fingerprint/u);
  assert.equal(canonicalCatalog, JSON.stringify(catalog, null, 2) + "\n");
  assert.equal(canonicalBaseline, baseline);
  assert.equal(canonicalParity, parity);
  assert.deepEqual(pointer.artifactPaths, { catalog: output[0], baseline: output[1], parityTest: output[2] });
});

test("capture leaves all target artifacts unchanged for redirect, 405, and malformed JSON", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "a".repeat(40);
  const argv = ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"];
  const before = await Promise.all(argv.filter((value) => value.startsWith("supabase/")).map((path) => readFile(join(root, path), "utf8")));
  for (const response of [
    new Response("", { status: 405 }),
    { status: 201, redirected: true, json: async () => ({}) },
    new Response("not json", { status: 201 }),
  ]) {
    await assert.rejects(captureDashboardFreeTierCatalog({ root, argv, env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha }, gitOriginMainSha: async () => originMainSha, fetch: async () => response }));
  }
  const after = await Promise.all(argv.filter((value) => value.startsWith("supabase/")).map((path) => readFile(join(root, path), "utf8")));
  assert.deepEqual(after, before);
});

test("isolated DB execute uses sanitized temp config, verifies candidate bytes, gates probes, and stops once", async (t) => {
  const { runIsolatedSupabaseDbTests, sha256 } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"));
  const reviewedCatalog = JSON.stringify({ captureStatus: "reviewed", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", catalog: [] });
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"), reviewedCatalog);
  await mkdir(join(root, "supabase/migrations"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "supabase/migrations/20260814000000_candidate.sql"), "select 1;\n");
  await writeFile(join(root, "tests/probe.mjs"), "if (!process.env.TASK_LOCAL_DB_URL || !process.env.TASK_LOCAL_DB_NONCE) process.exit(1);\n");
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), JSON.stringify({
    baselineVersion: "dashboard-free-tier-v1", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101",
    baselineSha256: sha256(baseline), catalogSha256: sha256(reviewedCatalog), requiredObjectSignatures: [],
    orderedNewMigrations: [{ fileName: "20260814000000_candidate.sql", status: "candidate", sha256: sha256("select 1;\n") }],
  }));
  const calls = [];
  const result = await runIsolatedSupabaseDbTests({
    root,
    argv: ["--execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--test", "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql", "--probe", "tests/probe.mjs"],
    randomBytes: () => Buffer.from("a1b2c3d4e5f6", "hex"),
    retainTempRoot: true,
    allocatePort: (() => {
      let port = 55431;
      return () => ++port;
    })(),
    executeProcess: async (invocation) => {
      calls.push(invocation);
      if (invocation.args[0] === "status") return { code: 0, stdout: JSON.stringify({ DB_URL: "postgresql://postgres:postgres@127.0.0.1:55433/postgres" }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls.filter((call) => call.command.endsWith("/supabase")).map((call) => call.args[0]), ["init", "db", "test", "migration", "test", "status", "stop"]);
  assert.equal(calls.filter((call) => call.args[0] === "stop").length, 1);
  assert.equal(calls.find((call) => call.command === process.execPath).env.TASK_LOCAL_DB_URL.includes("127.0.0.1"), true);
  assert.equal(calls.find((call) => call.command === process.execPath).env.SUPABASE_DATABASE_READ_TOKEN, undefined);
  assert.match(await readFile(result.runtime.configPath, "utf8"), /project_id = "tips_supabase_db_qa_a1b2c3d4e5f6"/u);
  t.after(() => rm(result.runtime.tempRoot, { recursive: true, force: true }));
  await writeFile(join(root, "supabase/migrations/20260814000000_candidate.sql"), "select 2;\n");
  await assert.rejects(runIsolatedSupabaseDbTests({ root, argv: ["--execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f"], executeProcess: async () => { throw new Error("must not start"); } }), /isolated_supabase_db_migration_hash_drift/);
});

test("runner stages each requested SQL file after init and before target pgtap", async (t) => {
  const { runIsolatedSupabaseDbTests, sha256 } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"));
  const catalog = JSON.stringify({ captureStatus: "reviewed", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", catalog: [] });
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"), catalog);
  await mkdir(join(root, "supabase/tests"), { recursive: true });
  await writeFile(join(root, "supabase/tests/target_test.sql"), "select 1;\n");
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), JSON.stringify({ baselineVersion: "dashboard-free-tier-v1", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", baselineSha256: sha256(baseline), catalogSha256: sha256(catalog), requiredObjectSignatures: [], orderedNewMigrations: [] }));
  let sawTarget = false;
  await runIsolatedSupabaseDbTests({
    root,
    argv: ["--execute", "--authorized", "--request-id", "97f77e69-9f40-49aa-9bc4-0be2321e2c8f", "--test", "supabase/tests/target_test.sql"],
    allocatePort: (() => { let port = 55500; return () => ++port; })(),
    executeProcess: async (invocation) => {
      if (invocation.args[0] === "test" && invocation.args.includes("supabase/tests/target_test.sql")) {
        sawTarget = (await readFile(join(invocation.cwd, "supabase/tests/target_test.sql"), "utf8")) === "select 1;\n";
      }
      if (invocation.args[0] === "status") return { code: 0, stdout: JSON.stringify({ DB_URL: "postgresql://postgres:postgres@127.0.0.1:55502/postgres" }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(sawTarget, true);
  await assert.rejects(runIsolatedSupabaseDbTests({ root, argv: ["--execute", "--authorized", "--request-id", "98f77e69-9f40-49aa-9bc4-0be2321e2c8f", "--test", "supabase/tests/missing_test.sql"], allocatePort: (() => { let port = 55600; return () => ++port; })(), executeProcess: async () => ({ code: 0, stdout: "", stderr: "" }) }), /isolated_supabase_db_target_missing/);
});

test("incomplete required catalog kinds and a post-rename publication failure leave active pointer unchanged", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "a".repeat(40);
  const argv = ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"];
  const env = { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha };
  const payload = { serverMajor: 17, migrationLedger: [{ version: "20260813093446", name: "registration_observation_legacy_schedule_slot_catalogs", statements_sha256: "a".repeat(64) }], catalog: [{ objectKind: "table", schema: "public", identity: "classes", definition: "create table public.classes (id text primary key)" }] };
  await assert.rejects(captureDashboardFreeTierCatalog({ root, argv, env, gitOriginMainSha: async () => originMainSha, fetch: async () => new Response(JSON.stringify(payload), { status: 201 }) }), /dashboard_free_tier_catalog_incomplete/);
  const pointer = join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json");
  await writeFile(pointer, JSON.stringify({ captureId: "prior" }));
  await assert.rejects(captureDashboardFreeTierCatalog({ root, argv, env, gitOriginMainSha: async () => originMainSha, afterStageRename: async ({ final }) => { assert.match(final, /dashboard-free-tier-v1-captures\/[a-f0-9]{16}$/u); throw new Error("publish_failure"); }, fetch: async () => new Response(JSON.stringify({ ...payload, catalog: completeCatalogFixture() }), { status: 201 }) }), /publish_failure/);
  assert.deepEqual(JSON.parse(await readFile(pointer, "utf8")), { captureId: "prior" });
});

test("canonical artifact publication rolls back earlier files when a later rename fails", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "c".repeat(40);
  const catalogPath = join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json");
  const baselinePath = join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql");
  const pointerPath = join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json");
  const priorCatalog = await readFile(catalogPath, "utf8");
  await rm(baselinePath);
  await mkdir(baselinePath);
  await writeFile(join(baselinePath, "sentinel"), "keep\n");
  await writeFile(pointerPath, JSON.stringify({ captureId: "prior" }));
  await assert.rejects(captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "5f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [{ version: "20260813093446", name: "registration_observation_legacy_schedule_slot_catalogs", statements_sha256: "a".repeat(64) }], catalog: completeCatalogFixture() }), { status: 201 }),
  }));
  assert.equal(await readFile(catalogPath, "utf8"), priorCatalog);
  assert.equal(await readFile(join(baselinePath, "sentinel"), "utf8"), "keep\n");
  assert.deepEqual(JSON.parse(await readFile(pointerPath, "utf8")), { captureId: "prior" });
});

test("fixed read-only capture statement enumerates every scoped catalog kind without raw definition output", async () => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  const statement = dashboardFreeTierCatalogStatement();
  for (const catalog of ["pg_roles", "pg_namespace", "pg_type", "pg_class", "pg_attrdef", "pg_constraint", "pg_index", "pg_proc", "pg_policy", "pg_trigger", "pg_default_acl", "aclexplode"]) {
    assert.match(statement, new RegExp(catalog));
  }
  for (const kind of ["role", "schema", "type", "sequence", "table", "default", "constraint", "index", "function", "rls", "policy", "grant", "trigger"]) assert.match(statement, new RegExp(`'${kind}'`));
  assert.match(statement, /definitionSha256/u);
  assert.match(statement, /allowed_relations/u);
  assert.doesNotMatch(statement, /'definition',\s*scoped_catalog/u);
  assert.match(statement, /begin read only/u);
});

test("PostgreSQL 17 executes the fixed capture statement and returns one JSON object", async (t) => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split("\n").filter(Boolean);
    assert.equal(rows.length, 1);
    const payload = JSON.parse(rows[0]);
    assert.equal(payload.serverMajor, 17);
    assert.deepEqual(payload.migrationLedger, []);
    assert.ok(Array.isArray(payload.catalog));
    assert.ok(payload.catalog.some((entry) => entry.objectKind === "function" && entry.identity === "get_dashboard_conflict_sources_v1(date,date)"));
  });
});

test("function identities accept spaced or unspaced separators but reject different types", async () => {
  const { normalizeDashboardFreeTierCatalog, normalizeDashboardFunctionIdentity } = await import(captureUrl.href);
  assert.equal(normalizeDashboardFunctionIdentity("get_dashboard_conflict_sources_v1(date, date)"), "get_dashboard_conflict_sources_v1(date,date)");
  assert.equal(normalizeDashboardFunctionIdentity("get_dashboard_conflict_sources_v1(date,date)"), "get_dashboard_conflict_sources_v1(date,date)");
  const scope = captureScopeFixture(["public.get_dashboard_conflict_sources_v1(date,date)"]);
  const spaced = completeCatalogFixture("get_dashboard_conflict_sources_v1(date, date)");
  const normalized = normalizeDashboardFreeTierCatalog(spaced, scope);
  assert.equal(normalized.find((entry) => entry.objectKind === "function").identity, "get_dashboard_conflict_sources_v1(date,date)");
  assert.throws(
    () => normalizeDashboardFreeTierCatalog(completeCatalogFixture("get_dashboard_conflict_sources_v1(timestamp,date)"), scope),
    /dashboard_free_tier_catalog_scope_drift/,
  );
});

test("capture rejects non-canonical documented artifact paths before HTTP", async () => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const originMainSha = "a".repeat(40);
  const canonical = ["supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "supabase/test-baselines/dashboard-free-tier-v1.sql", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"];
  for (const index of [0, 1, 2]) {
    const output = canonical.with(index, `supabase/test-baselines/noncanonical-${index}.json`);
    await assert.rejects(captureDashboardFreeTierCatalog({
      argv: ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", output[0], "--baseline", output[1], "--parity-test", output[2]],
      env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
      gitOriginMainSha: async () => originMainSha,
      fetch: async () => { throw new Error("HTTP must not run"); },
    }), /dashboard_free_tier_catalog_output_path_invalid/);
  }
});

test("generated parity uses pg catalog definitions and detects representative object drift", async (t) => {
  const { buildDashboardFreeTierParitySql, captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "b".repeat(40);
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha }, gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [{ version: "20260813093446", name: "registration_observation_legacy_schedule_slot_catalogs", statements_sha256: "a".repeat(64) }], catalog: completeCatalogFixture() }), { status: 201 }),
  });
  const pointer = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json"), "utf8"));
  const parity = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1-captures", pointer.captureId, "parity.sql"), "utf8");
  for (const expression of ["pg_get_functiondef", "pg_get_constraintdef", "pg_get_indexdef", "pg_get_triggerdef", "pg_policy", "pg_roles", "aclexplode"]) assert.match(parity, new RegExp(expression));
  assert.doesNotMatch(parity, /is\(encode\(digest\(\$\$[a-f0-9]{64}:/u);
  await withPostgres17(t, ({ psql }) => {
    const catalog = [{ objectKind: "role", schema: "", identity: "anon", definitionSha256: "0".repeat(64) }];
    const matching = psql(`set search_path to public, extensions, pg_catalog;\n${buildDashboardFreeTierParitySql(catalog)}`);
    assert.equal(matching.status, 0, matching.stdout + matching.stderr);
    assert.match(matching.stdout, /ok 1 - catalog role \.anon fingerprint/u);
    const drifted = psql(`set search_path to public, extensions, pg_catalog;\n${buildDashboardFreeTierParitySql([{ ...catalog[0], definitionSha256: "a".repeat(64) }])}`);
    assert.equal(drifted.status, 0, drifted.stderr);
    assert.match(drifted.stdout, /not ok 1 - catalog role \.anon fingerprint/u);
  });
});

function completeCatalogFixture(functionIdentity = "get_dashboard_summary_sources_v1()") {
  return [
    { objectKind: "role", schema: "", identity: "anon", definition: "create role anon" },
    { objectKind: "schema", schema: "", identity: "public", definition: "create schema public" },
    { objectKind: "type", schema: "public", identity: "class_status", definition: "create type public.class_status as enum ('x')" },
    { objectKind: "sequence", schema: "public", identity: "classes_id_seq", definition: "create sequence public.classes_id_seq" },
    { objectKind: "table", schema: "public", identity: "classes", definition: "create table public.classes (id text primary key)" },
    { objectKind: "default", schema: "public", identity: "classes.id", definition: "alter table public.classes alter column id set default 'x'" },
    { objectKind: "constraint", schema: "public", identity: "classes.classes_pkey", definition: "alter table public.classes add constraint classes_pkey primary key (id)" },
    { objectKind: "index", schema: "public", identity: "classes_id_idx", definition: "create index classes_id_idx on public.classes (id)" },
    { objectKind: "function", schema: "public", identity: functionIdentity, definition: `create function public.${functionIdentity} returns jsonb language sql as 'select ''{}''::jsonb'` },
    { objectKind: "rls", schema: "public", identity: "classes", definition: "alter table public.classes enable row level security" },
    { objectKind: "policy", schema: "public", identity: "classes.authenticated_select", definition: "create policy authenticated_select on public.classes for select to authenticated using (true)" },
    { objectKind: "grant", schema: "public", identity: "classes.authenticated", definition: "grant select on public.classes to authenticated" },
    { objectKind: "trigger", schema: "public", identity: "classes.before.01.normalize", definition: "create trigger normalize before insert on public.classes execute function public.normalize()" },
  ];
}
