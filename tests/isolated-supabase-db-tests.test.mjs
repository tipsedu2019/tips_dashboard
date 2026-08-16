import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const captureUrl = new URL("../scripts/capture-dashboard-free-tier-catalog.mjs", import.meta.url);
const runnerUrl = new URL("../scripts/run-isolated-supabase-db-tests.mjs", import.meta.url);
const docker = "/usr/local/bin/docker";
const postgres17Image = "public.ecr.aws/supabase/postgres:17.6.1.156";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}

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
    create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists dashboard_private;
    create or replace function dashboard_private.continuous_class_schedule_hash_v1(value jsonb)
    returns text language sql immutable as $$ select repeat('0', 64) $$;
    create or replace function public.get_dashboard_conflict_sources_v1(p_date_from date, p_date_to date)
    returns void language plpgsql as $$ begin end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    create extension if not exists pgtap;
    do $$ begin create role catalog_reader nologin; exception when duplicate_object then null; end $$;
    grant usage on schema supabase_migrations to catalog_reader;
    grant select on supabase_migrations.schema_migrations to catalog_reader;
    revoke all on function dashboard_private.continuous_class_schedule_hash_v1(jsonb) from public, catalog_reader;
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

async function activateCanonicalBaseline(root) {
  const base = join(root, "supabase/test-baselines");
  const [manifestSource, baseline, catalog, parity] = await Promise.all([
    readFile(join(base, "dashboard-free-tier-v1.manifest.json"), "utf8"),
    readFile(join(base, "dashboard-free-tier-v1.sql"), "utf8"),
    readFile(join(base, "dashboard-free-tier-origin-main-catalog.json"), "utf8"),
    readFile(join(root, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"), "utf8"),
  ]);
  const captureId = createHash("sha256").update(canonical({ baseline, catalog, manifest: JSON.parse(manifestSource), parity })).digest("hex").slice(0, 16);
  const capture = join(base, "dashboard-free-tier-v1-captures", captureId);
  await mkdir(capture, { recursive: true });
  for (const [contents, target] of [
    [manifestSource, join(capture, "manifest.json")],
    [baseline, join(capture, "baseline.sql")],
    [catalog, join(capture, "catalog.json")],
    [parity, join(capture, "parity.sql")],
  ]) await writeFile(target, contents);
  await writeFile(join(base, "dashboard-free-tier-v1.active.json"), JSON.stringify({ captureSetVersion: 1, captureId, artifactPaths: { catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql", parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql" } }));
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
  const probePlan = parseIsolatedDbArguments(["--probe", "scripts/probe-dashboard-audit-chain-concurrency.mjs"]);
  assert.deepEqual(probePlan.probes, ["scripts/probe-dashboard-audit-chain-concurrency.mjs"]);
  assert.throws(
    () => parseIsolatedDbArguments(["--execute", "--authorized", "--request-id", "x", "--test", "../bad.sql"]),
    /isolated_supabase_db_target_invalid/,
  );
});

test("isolated DB runner exposes an explicit final-only lifecycle gate", async () => {
  const { parseIsolatedDbArguments } = await import(runnerUrl.href);
  const plan = parseIsolatedDbArguments(["--require-final"]);
  assert.equal(plan.requireFinal, true);
});

test("isolated DB runner allocates four distinct loopback ports by default", async () => {
  const { allocateLoopbackPorts } = await import(runnerUrl.href);
  const ports = await allocateLoopbackPorts(4);
  assert.equal(ports.length, 4);
  assert.equal(new Set(ports).size, 4);
  assert.ok(ports.every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535));
});

test("isolated DB config keeps project_id at the top level", async () => {
  const { buildIsolatedSupabaseConfig } = await import(runnerUrl.href);
  const config = buildIsolatedSupabaseConfig("tips_isolated_fixture", { api: 54321, db: 54322, studio: 54323, inbucket: 54324 });
  assert.match(config, /^project_id = "tips_isolated_fixture"\n/u);
  assert.ok(config.indexOf("project_id") < config.indexOf("[api]"));
  assert.doesNotMatch(config, /\[analytics\][\s\S]*project_id/u);
});

test("isolated DB runner refuses canonical files when no active capture-set pointer exists", async (t) => {
  const { runIsolatedSupabaseDbTests } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  await assert.rejects(runIsolatedSupabaseDbTests({ root, argv: [] }), /isolated_supabase_db_baseline_review_required/);
});

test("isolated DB runner rejects parity drift inside the active immutable capture", async (t) => {
  const { runIsolatedSupabaseDbTests } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  await activateCanonicalBaseline(root);
  const pointer = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json"), "utf8"));
  const parity = join(root, "supabase/test-baselines/dashboard-free-tier-v1-captures", pointer.captureId, "parity.sql");
  await writeFile(parity, "-- drift\n");
  await assert.rejects(
    runIsolatedSupabaseDbTests({ root, argv: [] }),
    /isolated_supabase_db_capture_identity_drift/,
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

test("isolated DB final gate rejects candidate lifecycle and accepts the same exact final bytes", async (t) => {
  const { runIsolatedSupabaseDbTests, sha256 } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  const manifestPath = join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.orderedNewMigrations = [{ fileName: "20260814000000_fixture.sql", status: "candidate", sha256: sha256("select 1;\n") }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await activateCanonicalBaseline(root);
  await assert.rejects(runIsolatedSupabaseDbTests({ root, argv: ["--require-final"] }), /isolated_supabase_db_final_manifest_required/);

  manifest.orderedNewMigrations[0].status = "final";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await activateCanonicalBaseline(root);
  const plan = await runIsolatedSupabaseDbTests({ root, argv: ["--require-final"] });
  assert.equal(plan.status, "plan");
  assert.equal(plan.manifest.orderedNewMigrations[0].status, "final");
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

test("isolated DB runner rejects an unlisted migration absent from the reviewed production ledger", async (t) => {
  const { validateManifestMigrations } = await import(runnerUrl.href);
  const root = await mkdtemp(join(tmpdir(), "tips-dashboard-manifest-completeness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "supabase/migrations"), { recursive: true });
  const listedFile = "20260814000001_listed.sql";
  const omittedFile = "20260814000002_omitted.sql";
  const appliedLaterFile = "20260814000003_already_applied.sql";
  const listedSql = "select 1;\n";
  const omittedSql = "select 2;\n";
  const appliedLaterSql = "select 3;\n";
  await writeFile(join(root, "supabase/migrations", listedFile), listedSql);
  await writeFile(join(root, "supabase/migrations", omittedFile), omittedSql);
  await writeFile(join(root, "supabase/migrations", appliedLaterFile), appliedLaterSql);
  const manifest = {
    orderedNewMigrations: [{
      fileName: listedFile,
      status: "candidate",
      sha256: createHash("sha256").update(listedSql).digest("hex"),
    }],
  };

  await assert.rejects(
    validateManifestMigrations({ root, manifest, baselineVersions: ["20260814000003"] }),
    /isolated_supabase_db_migration_manifest_incomplete/,
  );

  manifest.orderedNewMigrations.push({
    fileName: omittedFile,
    status: "candidate",
    sha256: createHash("sha256").update(omittedSql).digest("hex"),
  });
  await assert.doesNotReject(validateManifestMigrations({ root, manifest, baselineVersions: ["20260814000003"] }));
});

test("reviewed catalog capture activates an immutable set and publishes canonical copies", async (t) => {
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
      migrationLedger: [{ version: "20260813093446", statements: ["select 1;"], name: "registration_observation_legacy_schedule_slot_catalogs" }],
      catalog: completeCatalogFixture().map((entry) => entry.objectKind === "table" ? {
        ...entry,
        fingerprint: JSON.stringify({ columns: [{ name: "id", type: "text", notNull: true }], acl: null }),
      } : entry),
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
  assert.equal(catalog.catalog.find((entry) => entry.objectKind === "table" && entry.identity === "classes").definitionSha256, createHash("sha256").update('{"acl": null, "columns": [{"name": "id", "type": "text", "notNull": true}]}').digest("hex"));
  assert.equal(catalog.migrationLedgerSha256, createHash("sha256").update(JSON.stringify([{ name: "registration_observation_legacy_schedule_slot_catalogs", statementsSha256: createHash("sha256").update('["select 1;"]').digest("hex"), version: "20260813093446" }])).digest("hex"));
  assert.equal(JSON.stringify(catalog).includes("select 1;"), false);
  assert.match(baseline, /create table if not exists public\."classes"/u);
  assert.match(parity, /pg_get_functiondef/u);
  assert.match(parity, /catalog trigger public\.classes\.before\.insert\.01\.normalize fingerprint/u);
  assert.equal(canonicalCatalog, JSON.stringify(catalog, null, 2) + "\n");
  assert.equal(canonicalBaseline, baseline);
  assert.equal(canonicalParity, parity);
  assert.deepEqual(pointer.artifactPaths, { catalog: output[0], baseline: output[1], parityTest: output[2] });
  assert.equal(pointer.captureSetVersion, 1);
});

test("reviewed capture identity changes when the approved migration manifest changes", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "e".repeat(40);
  const argv = ["--mode", "execute", "--authorized", "--request-id", "manifest-capture-identity", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"];
  const options = {
    root,
    argv,
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{ version: "20260813000000", statements: ["select 1;"], name: "baseline" }],
      catalog: completeCatalogFixture(),
    }), { status: 201 }),
  };

  await captureDashboardFreeTierCatalog(options);
  const pointerPath = join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json");
  const first = JSON.parse(await readFile(pointerPath, "utf8"));
  const manifestPath = join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.orderedNewMigrations.push({ fileName: "20260814000000_added.sql", status: "candidate", sha256: "a".repeat(64) });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await captureDashboardFreeTierCatalog(options);
  const second = JSON.parse(await readFile(pointerPath, "utf8"));
  assert.notEqual(second.captureId, first.captureId);
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
  const reviewedCatalog = JSON.stringify({ captureStatus: "reviewed", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", migrationLedger: [], catalog: [] });
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
  await activateCanonicalBaseline(root);
  const pointer = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json"), "utf8"));
  const capture = join(root, "supabase/test-baselines/dashboard-free-tier-v1-captures", pointer.captureId);
  const originalParity = await readFile(join(capture, "parity.sql"));
  const originalSmoke = await readFile(join(root, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"));
  const originalProbe = await readFile(join(root, "tests/probe.mjs"));
  const calls = [];
  const staged = { baseline: false, parity: false, smoke: false, migration: false, probe: false };
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
      if (invocation.args[0] === "init") {
        await writeFile(join(capture, "baseline.sql"), "-- mutated after verification\n");
        await writeFile(join(capture, "parity.sql"), "-- mutated after verification\n");
        await writeFile(join(root, "supabase/migrations/20260814000000_candidate.sql"), "select 2;\n");
        await writeFile(join(root, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"), "-- mutated after verification\n");
        await writeFile(join(root, "tests/probe.mjs"), "process.exit(9);\n");
      }
      if (invocation.args[0] === "db") staged.baseline = (await readFile(join(invocation.cwd, "supabase/migrations/00000000000000_dashboard_free_tier_test_baseline.sql"))).equals(baseline);
      if (invocation.args[0] === "test" && invocation.args.includes("supabase/tests/dashboard_free_tier_catalog_parity_test.sql")) {
        staged.parity = (await readFile(join(invocation.cwd, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"))).equals(originalParity);
        staged.smoke = (await readFile(join(invocation.cwd, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"))).equals(originalSmoke);
      }
      if (invocation.args[0] === "migration") staged.migration = (await readFile(join(invocation.cwd, "supabase/migrations/20260814000000_candidate.sql"), "utf8")) === "select 1;\n";
      if (invocation.command === process.execPath) staged.probe = (await readFile(invocation.args[0])).equals(originalProbe);
      if (invocation.args[0] === "status") return { code: 0, stdout: JSON.stringify({ DB_URL: "postgresql://postgres:postgres@127.0.0.1:55433/postgres" }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls.filter((call) => call.command.endsWith("/supabase")).map((call) => call.args[0]), ["init", "db", "test", "migration", "test", "status", "stop"]);
  assert.equal(calls.filter((call) => call.args[0] === "stop").length, 1);
  assert.equal(calls.find((call) => call.command === process.execPath).env.TASK_LOCAL_DB_URL.includes("127.0.0.1"), true);
  assert.equal(calls.find((call) => call.command === process.execPath).env.SUPABASE_DATABASE_READ_TOKEN, undefined);
  assert.deepEqual(staged, { baseline: true, parity: true, smoke: true, migration: true, probe: true });
  assert.match(await readFile(result.runtime.configPath, "utf8"), /project_id = "tips_supabase_db_qa_a1b2c3d4e5f6"/u);
  t.after(() => rm(result.runtime.tempRoot, { recursive: true, force: true }));
  await writeFile(join(capture, "baseline.sql"), baseline);
  await writeFile(join(capture, "parity.sql"), originalParity);
  await writeFile(join(root, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"), originalSmoke);
  await writeFile(join(root, "tests/probe.mjs"), originalProbe);
  await writeFile(join(root, "supabase/migrations/20260814000000_candidate.sql"), "select 2;\n");
  await assert.rejects(runIsolatedSupabaseDbTests({ root, argv: ["--execute", "--authorized", "--request-id", "4f77e691-9f40-49aa-9bc4-0be2321e2c8f"], executeProcess: async () => { throw new Error("must not start"); } }), /isolated_supabase_db_migration_hash_drift/);
});

test("runner stages each requested SQL file after init and before target pgtap", async (t) => {
  const { runIsolatedSupabaseDbTests, sha256 } = await import(runnerUrl.href);
  const root = await makeRepo(t);
  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"));
  const catalog = JSON.stringify({ captureStatus: "reviewed", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", migrationLedger: [], catalog: [] });
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"), catalog);
  await mkdir(join(root, "supabase/migrations"), { recursive: true });
  await mkdir(join(root, "supabase/tests"), { recursive: true });
  await writeFile(join(root, "supabase/tests/target_test.sql"), "select 1;\n");
  await writeFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), JSON.stringify({ baselineVersion: "dashboard-free-tier-v1", originMainSha: "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101", baselineSha256: sha256(baseline), catalogSha256: sha256(catalog), requiredObjectSignatures: [], orderedNewMigrations: [] }));
  await activateCanonicalBaseline(root);
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
  const payload = { serverMajor: 17, migrationLedger: [{ version: "20260813093446", statements: ["select 1;"], name: "registration_observation_legacy_schedule_slot_catalogs" }], catalog: [{ objectKind: "table", schema: "public", identity: "classes", definition: "create table public.classes (id text primary key)" }] };
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
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [{ version: "20260813093446", statements: ["select 1;"], name: "registration_observation_legacy_schedule_slot_catalogs" }], catalog: completeCatalogFixture() }), { status: 201 }),
  }));
  assert.equal(await readFile(catalogPath, "utf8"), priorCatalog);
  assert.equal(await readFile(join(baselinePath, "sentinel"), "utf8"), "keep\n");
  assert.deepEqual(JSON.parse(await readFile(pointerPath, "utf8")), { captureId: "prior" });
});

test("canonical publication reports rollback failure and never advances the active capture", async (t) => {
  const { publishDashboardFreeTierCapture } = await import(captureUrl.href);
  const root = await mkdtemp(join(tmpdir(), "tips-dashboard-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, "stage"); const final = join(root, "captures", "a".repeat(16));
  const active = join(root, "active.json");
  const artifactTargets = { catalog: join(root, "catalog.json"), baseline: join(root, "baseline.sql"), parityTest: join(root, "parity.sql") };
  await mkdir(stage, { recursive: true });
  await writeFile(active, JSON.stringify({ captureSetVersion: 1, captureId: "b".repeat(16), artifactPaths: {} }));
  for (const target of Object.values(artifactTargets)) await writeFile(target, "prior\n");
  const injectedRename = async (source, target) => {
    if (source.includes(".tmp-") && target === artifactTargets.baseline) throw new Error("replacement_failed");
    if (source.includes(".restore-") && target === artifactTargets.catalog) throw new Error("rollback_failed");
    await rename(source, target);
  };
  await assert.rejects(
    publishDashboardFreeTierCapture({ stage, final, active, captureId: "a".repeat(16), artifactPaths: {}, artifactTargets, artifacts: { catalog: "new catalog\n", baseline: "new baseline\n", parity: "new parity\n" }, renameFile: injectedRename }),
    (error) => error instanceof AggregateError && error.message === "dashboard_free_tier_catalog_publication_and_rollback_failed" && error.errors.some((entry) => entry.message === "rollback_failed"),
  );
  assert.equal(JSON.parse(await readFile(active, "utf8")).captureId, "b".repeat(16));
});

test("fixed read-only capture statement enumerates every scoped catalog kind without raw definition output", async () => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  const statement = dashboardFreeTierCatalogStatement();
  for (const catalog of ["pg_roles", "pg_namespace", "pg_type", "pg_class", "pg_attrdef", "pg_constraint", "pg_index", "pg_proc", "pg_policy", "pg_trigger", "pg_default_acl", "aclexplode"]) {
    assert.match(statement, new RegExp(catalog));
  }
  for (const kind of ["role", "schema", "type", "sequence", "table", "default", "constraint", "index", "function", "rls", "policy", "grant", "trigger"]) assert.match(statement, new RegExp(`'${kind}'`));
  assert.match(statement, /'fingerprint',\s*scoped_catalog\.fingerprint::text/u);
  assert.match(statement, /allowed_relations/u);
  assert.doesNotMatch(statement, /'definition',\s*scoped_catalog/u);
  assert.match(statement, /begin read only/u);
  assert.match(statement, /migration_row\.statements/u);
  assert.doesNotMatch(statement, /statements_sha256/u);
  assert.doesNotMatch(statement, /dashboard_private\.continuous_class_schedule_hash_v1/u);
});

test("PostgreSQL trigger capture and parity follow name order across the full BEFORE UPDATE group", async (t) => {
  const { buildDashboardFreeTierParitySql, dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const setup = psql(`
      create table public.classes(id bigint);
      create function public.trigger_fixture() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger z_last before update on public.classes for each row execute function public.trigger_fixture();
      create trigger a_first before update on public.classes for each row execute function public.trigger_fixture();
    `);
    assert.equal(setup.status, 0, setup.stderr);
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const triggers = payload.catalog.filter((entry) => entry.objectKind === "trigger");
    assert.deepEqual(triggers.map((entry) => entry.identity), [
      "classes.before.update.01.a_first",
      "classes.before.update.02.z_last",
    ]);
    assert.deepEqual(triggers.map((entry) => JSON.parse(entry.fingerprint).order), [1, 2]);
    const parityCatalog = triggers.map((entry) => ({ ...entry, definitionSha256: createHash("sha256").update(entry.fingerprint).digest("hex") }));
    const parity = psql(`set search_path to public, extensions, pg_catalog;\n${buildDashboardFreeTierParitySql(parityCatalog)}`);
    assert.equal(parity.status, 0, parity.stderr);
    assert.equal((parity.stdout.match(/^ok /gmu) || []).length, 2, parity.stdout);
  });
});

test("PostgreSQL 17 restricted catalog reader executes the fixed statement against the real migration shape", async (t) => {
  const { dashboardFreeTierCatalogStatement, normalizeDashboardFunctionIdentity } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const seeded = psql("insert into supabase_migrations.schema_migrations(version, statements, name) values ('20260813093446', array['select 1;', 'select 2;'], 'fixture');");
    assert.equal(seeded.status, 0, seeded.stderr);
    const result = psql(`set role catalog_reader;\n${dashboardFreeTierCatalogStatement()}`);
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split("\n").filter(Boolean);
    assert.equal(rows.length, 1);
    const payload = JSON.parse(rows[0]);
    assert.equal(payload.serverMajor, 17);
    assert.deepEqual(payload.migrationLedger, [{ version: "20260813093446", statements: ["select 1;", "select 2;"], name: "fixture" }]);
    assert.ok(Array.isArray(payload.catalog));
    assert.ok(payload.catalog.some((entry) => entry.objectKind === "function" && entry.identity === "get_dashboard_conflict_sources_v1(date,date)"));
    const identity = psql("select proname || '(' || pg_catalog.pg_get_function_identity_arguments(oid) || ')' from pg_catalog.pg_proc where oid = 'public.get_dashboard_conflict_sources_v1(date,date)'::regprocedure;");
    assert.equal(identity.status, 0, identity.stderr);
    assert.equal(identity.stdout.trim(), "get_dashboard_conflict_sources_v1(p_date_from date, p_date_to date)");
    assert.equal(normalizeDashboardFunctionIdentity(identity.stdout.trim()), "get_dashboard_conflict_sources_v1(date,date)");
  });
});

test("function identities canonicalize named and unnamed arguments but reject different types", async () => {
  const { normalizeDashboardFreeTierCatalog, normalizeDashboardFunctionIdentity } = await import(captureUrl.href);
  assert.equal(normalizeDashboardFunctionIdentity("get_dashboard_conflict_sources_v1(date, date)"), "get_dashboard_conflict_sources_v1(date,date)");
  assert.equal(normalizeDashboardFunctionIdentity("get_dashboard_conflict_sources_v1(date,date)"), "get_dashboard_conflict_sources_v1(date,date)");
  assert.equal(normalizeDashboardFunctionIdentity("get_dashboard_conflict_sources_v1(p_date_from date, p_date_to date)"), "get_dashboard_conflict_sources_v1(date,date)");
  assert.equal(normalizeDashboardFunctionIdentity("example(IN p_value double precision, VARIADIC p_tags text[] )"), "example(double precision,text[])");
  const scope = captureScopeFixture(["public.get_dashboard_conflict_sources_v1(date,date)"]);
  const spaced = completeCatalogFixture("get_dashboard_conflict_sources_v1(date, date)");
  const normalized = normalizeDashboardFreeTierCatalog(spaced, scope);
  assert.equal(normalized.find((entry) => entry.objectKind === "function").identity, "get_dashboard_conflict_sources_v1(date,date)");
  assert.throws(
    () => normalizeDashboardFreeTierCatalog(completeCatalogFixture("get_dashboard_conflict_sources_v1(timestamp,date)"), scope),
    /dashboard_free_tier_catalog_scope_drift/,
  );
});

test("catalog normalization hashes schema fingerprints without treating ordinary type and column names as leaked values", async () => {
  const { normalizeDashboardFreeTierCatalog } = await import(captureUrl.href);
  const scope = captureScopeFixture();
  const fingerprint = JSON.stringify({
    columns: [
      { name: "phone", type: "text", notNull: false },
      { name: "token_hash", type: "uuid", notNull: true },
    ],
    acl: null,
  });
  const fixture = completeCatalogFixture().map((entry) => (
    entry.objectKind === "table"
      ? { objectKind: entry.objectKind, schema: entry.schema, identity: entry.identity, fingerprint }
      : entry
  ));

  const normalized = normalizeDashboardFreeTierCatalog(fixture, scope);
  const table = normalized.find((entry) => entry.objectKind === "table" && entry.identity === "classes");
  assert.equal(table.definition, null);
  assert.equal(table.definitionSha256, createHash("sha256").update(fingerprint).digest("hex"));

  assert.throws(
    () => normalizeDashboardFreeTierCatalog(
      completeCatalogFixture().map((entry) => (
        entry.objectKind === "table" ? { ...entry, definition: "create table public.classes(secret_token text)" } : entry
      )),
      scope,
    ),
    /dashboard_free_tier_catalog_scope_drift/,
  );
});

test("catalog normalization scopes view fingerprints separately from tables", async () => {
  const { normalizeDashboardFreeTierCatalog } = await import(captureUrl.href);
  const scope = {
    version: 1,
    schemas: [],
    relations: [],
    views: ["public.ops_registration_appointment_calendar"],
    types: [],
    sequences: [],
    collations: [],
    functions: [],
    roles: [],
    triggerTables: [],
    requiredKinds: ["view"],
    forbiddenTerms: ["secret"],
  };
  const fingerprint = JSON.stringify({ definition: " SELECT 1 AS id;", options: ["security_invoker=true"], acl: null });

  const normalized = normalizeDashboardFreeTierCatalog([{
    objectKind: "view",
    schema: "public",
    identity: "ops_registration_appointment_calendar",
    fingerprint,
  }], scope);
  assert.equal(normalized[0].definition, null);
  assert.equal(normalized[0].definitionSha256, createHash("sha256").update(fingerprint).digest("hex"));

  assert.throws(
    () => normalizeDashboardFreeTierCatalog([{
      objectKind: "view",
      schema: "public",
      identity: "unreviewed_view",
      fingerprint,
    }], scope),
    /dashboard_free_tier_catalog_scope_drift/,
  );
});

test("reviewed capture builds the replay baseline from exact production migration ledger statements", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "d".repeat(40);
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "ledger-baseline-capture", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [
        { version: "20260813000000", statements: ["create table public.from_ledger(id bigint)"], name: "from_ledger" },
        { version: "20260813000001", statements: ["alter table public.from_ledger add column note text"], name: "from_ledger_note" },
      ],
      catalog: completeCatalogFixture(),
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.equal(baseline, "create table public.from_ledger(id bigint);\nalter table public.from_ledger add column note text;\n");
  assert.doesNotMatch(baseline, /create table public\.classes/u);
});

test("reviewed capture retains schema-qualified dynamic DDL that prepares a later migration", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "8".repeat(40);
  const dynamicPreparation = "do $$ begin execute pg_catalog.format('alter table public.classes drop constraint %I', 'classes_outcome_check'); end $$";
  const temporaryGate = "do $$ begin execute pg_catalog.format('alter table pg_temp.capture_gate add constraint gate_check %s', 'check (value is not null)'); end $$";
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "dynamic-ddl-replay", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [{ version: "20260816000000", statements: [dynamicPreparation, temporaryGate], name: "dynamic_ddl_preparation" }], catalog: completeCatalogFixture() }), { status: 201 }),
  });
  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /execute pg_catalog\.format\('alter table public\.classes drop constraint %I'/u);
  assert.doesNotMatch(baseline, /alter table pg_temp\.capture_gate/u);
});

test("reviewed capture compares policy roles semantically and omits redundant OID-keyed grant rows", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "7".repeat(40);
  const catalog = completeCatalogFixture().map((entry) => {
    if (entry.objectKind === "policy") return { ...entry, definition: undefined, fingerprint: JSON.stringify({ command: "r", roles: ["16485"], using: "true", check: null }) };
    if (entry.objectKind === "grant") return { ...entry, identity: "classes.16485", definition: undefined, fingerprint: JSON.stringify({ acl: ["authenticated=r/postgres"], expanded: [{ grantee: "16485", privilege: "SELECT" }] }) };
    return entry;
  });
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "stable-policy-role-capture", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [], catalog }), { status: 201 }),
  });
  const published = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"), "utf8"));
  assert.equal(published.catalog.some((entry) => entry.objectKind === "grant"), false);
  const policy = published.catalog.find((entry) => entry.objectKind === "policy");
  assert.equal(policy.definitionSha256, createHash("sha256").update('{"check": null, "roles": ["authenticated"], "using": "true", "command": "r"}').digest("hex"));
});

test("final schema reconciliation restores current columns, policies, RLS, and triggers", async () => {
  const { buildFinalSchemaReconciliation } = await import(captureUrl.href);
  const definitions = [
    { objectKind: "table", schema: "public", identity: "classes", replayFingerprint: JSON.stringify({ columns: [{ name: "current_note", type: "text", notNull: true }], acl: ["authenticated=r/postgres"] }) },
    { objectKind: "default", schema: "public", identity: "classes.current_note", replayFingerprint: JSON.stringify({ expression: "''::text", generated: "" }) },
    { objectKind: "constraint", schema: "public", identity: "classes.classes_note_check", replayFingerprint: JSON.stringify({ definition: "CHECK ((current_note <> ''::text))" }) },
    { objectKind: "rls", schema: "public", identity: "classes", replayFingerprint: JSON.stringify({ enabled: true, forced: false }) },
    { objectKind: "policy", schema: "public", identity: "classes.classes_read", replayFingerprint: JSON.stringify({ check: null, roles: ["authenticated"], using: "is_admin_or_staff()", command: "r" }) },
    { objectKind: "trigger", schema: "public", identity: "classes.before.update.01.classes_touch", replayFingerprint: JSON.stringify({ definition: "CREATE TRIGGER classes_touch BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()" }) },
  ];
  const sql = buildFinalSchemaReconciliation(definitions);
  assert.match(sql, /add column if not exists "current_note" text/u);
  assert.match(sql, /alter column "current_note" set not null/u);
  assert.match(sql, /add constraint "classes_note_check" CHECK/u);
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /create or replace function public\.is_admin_or_staff\(\)/u);
  assert.match(sql, /create policy "classes_read".*to "authenticated" using \(is_admin_or_staff\(\)\)/u);
  assert.match(sql, /CREATE TRIGGER classes_touch BEFORE UPDATE/u);
  assert.match(sql, /grant select on table "public"\."classes" to "authenticated"/u);
});

test("baseline capture preserves the non-login audit writer role used by public policies", async () => {
  const { dashboardFreeTierCatalogStatement, buildFinalSchemaReconciliation } = await import(captureUrl.href);
  assert.match(dashboardFreeTierCatalogStatement(), /dashboard_audit_writer_v2/u);
  const sql = buildFinalSchemaReconciliation([
    { objectKind: "role", schema: "", identity: "dashboard_audit_writer_v2", replayFingerprint: JSON.stringify({ login: false, inherit: false, superuser: false }) },
    { objectKind: "table", schema: "public", identity: "dashboard_audit_logs", replayFingerprint: JSON.stringify({ columns: [{ name: "id", type: "uuid", notNull: true }], acl: ["dashboard_audit_writer_v2=ar/postgres"] }) },
    { objectKind: "policy", schema: "public", identity: "dashboard_audit_logs.dashboard_audit_logs_writer_insert", replayFingerprint: JSON.stringify({ check: "true", roles: ["dashboard_audit_writer_v2"], using: null, command: "a" }) },
  ]);
  assert.match(sql, /create role "dashboard_audit_writer_v2" noinherit nologin nosuperuser/u);
  assert.match(sql, /to "dashboard_audit_writer_v2"/u);
  assert.match(sql, /grant insert, select on table "public"\."dashboard_audit_logs" to "dashboard_audit_writer_v2"/u);
});

test("candidate migrations do not schema-qualify PostgreSQL special SQL forms", async () => {
  const root = new URL("..", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url), "utf8"));
  for (const migration of manifest.orderedNewMigrations) {
    const sql = await readFile(new URL(`../supabase/migrations/${migration.fileName}`, import.meta.url), "utf8");
    assert.doesNotMatch(sql, /\bpg_catalog\.(?:(?:coalesce|nullif|greatest|least|position|extract)\s*\(|(?:current_date|current_time|current_timestamp|localtime|localtimestamp|current_user|session_user|current_role)\b)/iu, migration.fileName);
  }
  assert.ok(root);
});

test("reviewed capture omits production data mutations while retaining schema statements", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "6".repeat(40);
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "schema-only-ledger", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{
        version: "20260813000000",
        name: "mixed_schema_and_data",
        statements: [
          "create table public.fixture(id uuid primary key)",
          "insert into public.fixture(id) values (gen_random_uuid())",
          "update public.fixture set id = id",
          "do $$ begin update public.fixture set id = id; if not found then raise exception 'fixture_missing'; end if; end $$",
          "do $$ begin execute 'alter table public.fixture drop constraint if exists fixture_guard'; end $$",
          "-- readiness check\ndo $$ begin create temporary table fixture_gate(id uuid) on commit drop; if not exists (select 1 from public.fixture) then raise exception 'fixture_missing_commented'; end if; end $$",
          "select public.seed_fixture()",
          "repository migration supabase/migrations/fixture.sql; sha256=deadbeef",
          "begin; set local lock_timeout = '5s'; do $data$ begin update public.fixture set id = id; if not found then raise exception 'fixture_missing_compound'; end if; end $data$; create table public.fixture_companion(id uuid); commit",
          "create function public.fixture_write() returns void language sql as $$ update public.fixture set id = id $$",
        ],
      }],
      catalog: completeCatalogFixture(),
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /create table public\.fixture/u);
  assert.match(baseline, /create table public\.fixture_companion/u);
  assert.match(baseline, /create function public\.fixture_write/u);
  assert.match(baseline, /execute 'alter table public\.fixture drop constraint if exists fixture_guard'/u);
  assert.doesNotMatch(baseline, /^insert into|^update public\.fixture/gmu);
  assert.doesNotMatch(baseline, /fixture_missing_compound/u);
  assert.doesNotMatch(baseline, /fixture_missing_commented/u);
  assert.doesNotMatch(baseline, /select public\.seed_fixture/u);
  assert.doesNotMatch(baseline, /repository migration|sha256=deadbeef/u);
});

test("reviewed capture bootstraps a legacy public table that is absent from the production migration ledger", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  await writeCaptureScope(root);
  const originMainSha = "f".repeat(40);
  const tableFingerprint = JSON.stringify({
    columns: [
      { name: "id", type: "uuid", notNull: true },
      { name: "name", type: "text", notNull: false },
    ],
    acl: null,
  });
  const catalog = completeCatalogFixture().map((entry) => (
    entry.objectKind === "table"
      ? { objectKind: entry.objectKind, schema: entry.schema, identity: entry.identity, fingerprint: tableFingerprint }
      : entry.objectKind === "constraint" && entry.identity === "classes.classes_pkey"
        ? { objectKind: entry.objectKind, schema: entry.schema, identity: entry.identity, fingerprint: JSON.stringify({ definition: "PRIMARY KEY (id)" }) }
      : entry
  ));
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "legacy-table-bootstrap", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{ version: "20260813000000", statements: ["alter table public.classes add column if not exists status text"], name: "legacy_classes" }],
      catalog,
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /^create table if not exists public\."classes"/u);
  assert.ok(baseline.indexOf('alter table public."classes" add constraint "classes_pkey" PRIMARY KEY (id);') < baseline.indexOf("alter table public.classes add column if not exists status text;"));
  assert.match(baseline, /alter table public\."classes" add column if not exists "id" uuid;/u);
});

test("reviewed capture bootstraps public enum dependencies before legacy tables", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  const scope = captureScopeFixture();
  scope.relations.push("public.generation_runs");
  scope.types.push("public.subject_type");
  await writeFile(join(root, "scripts/fixtures/dashboard-free-tier-baseline-scope.json"), JSON.stringify(scope));
  const originMainSha = "e".repeat(40);
  const catalog = [
    ...completeCatalogFixture(),
    {
      objectKind: "type",
      schema: "public",
      identity: "subject_type",
      fingerprint: JSON.stringify({ type: "subject_type", labels: ["english", "math"] }),
    },
    {
      objectKind: "table",
      schema: "public",
      identity: "generation_runs",
      fingerprint: JSON.stringify({
        columns: [
          { name: "id", type: "uuid", notNull: true },
          { name: "subject", type: "subject_type", notNull: true },
        ],
        acl: null,
      }),
    },
  ];
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "legacy-enum-bootstrap", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{ version: "20260813000000", statements: ["alter table public.generation_runs add column if not exists note text"], name: "legacy_generation_runs" }],
      catalog,
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /^create type public\."subject_type" as enum \('english', 'math'\);\n/u);
  assert.ok(baseline.indexOf('create type public."subject_type"') < baseline.indexOf('create table if not exists public."generation_runs"'));
});

test("reviewed capture bootstraps a legacy table referenced before its later ledger create", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  const scope = captureScopeFixture();
  scope.relations.push("public.academic_curriculum_profiles");
  await writeFile(join(root, "scripts/fixtures/dashboard-free-tier-baseline-scope.json"), JSON.stringify(scope));
  const originMainSha = "9".repeat(40);
  const catalog = [
    ...completeCatalogFixture(),
    {
      objectKind: "table",
      schema: "public",
      identity: "academic_curriculum_profiles",
      fingerprint: JSON.stringify({ columns: [{ name: "id", type: "uuid", notNull: true }], acl: null }),
    },
  ];
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "legacy-forward-reference", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [
        { version: "20260813000000", statements: ["create table public.child(profile_id uuid references public.academic_curriculum_profiles(id))"], name: "child_first" },
        { version: "20260813000001", statements: ["create table if not exists public.academic_curriculum_profiles(id uuid primary key)"], name: "profile_later" },
      ],
      catalog,
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /^create table if not exists public\."academic_curriculum_profiles"/u);
});

test("reviewed capture restores legacy column defaults before ledger seed inserts", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  const scope = captureScopeFixture();
  scope.relations.push("public.textbooks");
  await writeFile(join(root, "scripts/fixtures/dashboard-free-tier-baseline-scope.json"), JSON.stringify(scope));
  const originMainSha = "8".repeat(40);
  const catalog = [
    ...completeCatalogFixture(),
    {
      objectKind: "table",
      schema: "public",
      identity: "textbooks",
      fingerprint: JSON.stringify({
        columns: [
          { name: "id", type: "uuid", notNull: true },
          { name: "lessons", type: "jsonb", notNull: true },
        ],
        acl: null,
      }),
    },
    {
      objectKind: "default",
      schema: "public",
      identity: "textbooks.lessons",
      fingerprint: JSON.stringify({ expression: "'[]'::jsonb" }),
    },
  ];
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "legacy-default-bootstrap", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({
      serverMajor: 17,
      migrationLedger: [{ version: "20260813000000", statements: ["insert into public.textbooks(id) values (gen_random_uuid())"], name: "legacy_seed" }],
      catalog,
    }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /alter table public\."textbooks" alter column "lessons" set default '\[\]'::jsonb;/u);
  assert.doesNotMatch(baseline, /insert into public\.textbooks/u);
});

test("reviewed capture restores legacy stored generated columns without treating them as defaults", async (t) => {
  const { captureDashboardFreeTierCatalog } = await import(captureUrl.href);
  const root = await makeRepo(t);
  const scope = captureScopeFixture();
  scope.relations.push("public.textbooks");
  await writeFile(join(root, "scripts/fixtures/dashboard-free-tier-baseline-scope.json"), JSON.stringify(scope));
  const originMainSha = "7".repeat(40);
  const catalog = [
    ...completeCatalogFixture(),
    {
      objectKind: "table", schema: "public", identity: "textbooks",
      fingerprint: JSON.stringify({ columns: [
        { name: "subject", type: "text", notNull: false },
        { name: "subject_area_subject", type: "text", notNull: false },
      ], acl: null }),
    },
    {
      objectKind: "default", schema: "public", identity: "textbooks.subject_area_subject",
      fingerprint: JSON.stringify({ expression: "CASE WHEN subject = 'science'::text THEN '과학'::text ELSE NULL::text END", generated: "s" }),
    },
  ];
  await captureDashboardFreeTierCatalog({
    root,
    argv: ["--mode", "execute", "--authorized", "--request-id", "legacy-generated-bootstrap", "--origin-main-sha", originMainSha, "--scope", "scripts/fixtures/dashboard-free-tier-baseline-scope.json", "--catalog", "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", "--baseline", "supabase/test-baselines/dashboard-free-tier-v1.sql", "--parity-test", "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"],
    env: { SUPABASE_DATABASE_READ_TOKEN: "sbp_only-read-secret", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", TASK_ORIGIN_MAIN_SHA: originMainSha },
    gitOriginMainSha: async () => originMainSha,
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [], catalog }), { status: 201 }),
  });

  const baseline = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql"), "utf8");
  assert.match(baseline, /"subject_area_subject" text generated always as \(CASE WHEN subject = 'science'::text THEN '과학'::text ELSE NULL::text END\) stored/u);
  assert.doesNotMatch(baseline, /alter column "subject_area_subject" set default/u);
});

test("fixed catalog statement distinguishes stored generated expressions from defaults", async (t) => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const created = psql("create table public.textbooks(subject text, subject_area_subject text generated always as (case when subject = 'science' then '과학' else null end) stored);");
    assert.equal(created.status, 0, created.stderr);
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const generated = payload.catalog.find((entry) => entry.objectKind === "default" && entry.identity === "textbooks.subject_area_subject");
    assert.equal(JSON.parse(generated.fingerprint).generated, "s");
  });
});

test("fixed catalog statement captures every public enum dependency", async (t) => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const created = psql("create type public.subject_type as enum ('english', 'math');");
    assert.equal(created.status, 0, created.stderr);
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const type = payload.catalog.find((entry) => entry.objectKind === "type" && entry.identity === "subject_type");
    assert.ok(type);
    assert.deepEqual(JSON.parse(type.fingerprint).labels, ["english", "math"]);
  });
});

test("fixed catalog statement captures the appointment calendar view fingerprint", async (t) => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const created = psql("create view public.ops_registration_appointment_calendar with (security_invoker = true) as select 1::bigint as id;");
    assert.equal(created.status, 0, created.stderr);
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const view = payload.catalog.find((entry) => entry.objectKind === "view" && entry.identity === "ops_registration_appointment_calendar");
    assert.ok(view);
    const fingerprint = JSON.parse(view.fingerprint);
    assert.match(fingerprint.definition, /select 1::bigint as id/iu);
    assert.deepEqual(fingerprint.options, ["security_invoker=true"]);
  });
});

test("fixed catalog statement gives duplicate constraint names stable distinct identities", async (t) => {
  const { dashboardFreeTierCatalogStatement } = await import(captureUrl.href);
  await withPostgres17(t, ({ psql }) => {
    const created = psql("create table public.duplicate_constraint_identity_fixture_long(id bigint, left_value text, right_value text, constraint duplicate_constraint_name_for_left_value check (left_value is not null), constraint duplicate_constraint_name_for_right_value check (right_value is not null));");
    assert.equal(created.status, 0, created.stderr);
    const result = psql(dashboardFreeTierCatalogStatement());
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim());
    const constraints = payload.catalog.filter((entry) => entry.objectKind === "constraint" && entry.identity.startsWith("duplicate_constraint_identity_fixture_long.duplicate_constraint_name_for_"));
    assert.equal(constraints.length, 2);
    assert.equal(new Set(constraints.map((entry) => entry.identity)).size, 2);
  });
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
    fetch: async () => new Response(JSON.stringify({ serverMajor: 17, migrationLedger: [{ version: "20260813093446", statements: ["select 1;"], name: "registration_observation_legacy_schedule_slot_catalogs" }], catalog: completeCatalogFixture() }), { status: 201 }),
  });
  const pointer = JSON.parse(await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json"), "utf8"));
  const parity = await readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1-captures", pointer.captureId, "parity.sql"), "utf8");
  for (const expression of ["pg_get_functiondef", "pg_get_constraintdef", "pg_get_indexdef", "pg_get_triggerdef", "pg_policy", "pg_roles", "relacl"]) assert.match(parity, new RegExp(expression));
  assert.doesNotMatch(parity, /is\(encode\(digest\(\$\$[a-f0-9]{64}:/u);
  await withPostgres17(t, ({ psql }) => {
    const roleFingerprint = '{"login": false, "inherit": true, "superuser": false}';
    const catalog = [{ objectKind: "role", schema: "", identity: "anon", definitionSha256: createHash("sha256").update(roleFingerprint).digest("hex") }];
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
    { objectKind: "trigger", schema: "public", identity: "classes.before.insert.01.normalize", definition: "create trigger normalize before insert on public.classes execute function public.normalize()" },
  ];
}
