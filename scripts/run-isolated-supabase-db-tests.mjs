import { spawn } from "node:child_process";
import { createHash, randomBytes as secureRandomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const SQL_TEST = /^supabase\/tests\/[a-z0-9_]+\.sql$/u;
const PROBE = /^tests\/[a-z0-9_./-]+\.mjs$/u;
const MIGRATION = /^(\d{14})_([a-z0-9_]+)\.sql$/u;
const SUPABASE = "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase";

function fail(code) { throw new Error(code); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function safeRepoPath(root, path) {
  if (typeof path !== "string" || path.includes("..") || relative(root, resolve(root, path)).startsWith("..")) fail("isolated_supabase_db_target_invalid");
  return resolve(root, path);
}
function safeConfig(projectId, ports) {
  return `[api]\nenabled = true\nport = ${ports.api}\n[db]\nport = ${ports.db}\n[studio]\nenabled = false\n[inbucket]\nenabled = false\n[analytics]\nenabled = false\nproject_id = "${projectId}"\n`;
}
function processResult(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

export function parseIsolatedDbArguments(argv) {
  const result = { execute: false, authorized: false, requestId: null, tests: [], probes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") result.execute = true;
    else if (value === "--authorized") result.authorized = true;
    else if (value === "--request-id") result.requestId = argv[++index] || null;
    else if (value === "--test") result.tests.push(argv[++index] || "");
    else if (value === "--probe") result.probes.push(argv[++index] || "");
    else fail("isolated_supabase_db_arguments_invalid");
  }
  if (!result.tests.every((path) => SQL_TEST.test(path)) || !result.probes.every((path) => PROBE.test(path))) fail("isolated_supabase_db_target_invalid");
  if (result.execute && (!result.authorized || !REQUEST_ID.test(result.requestId || ""))) fail("isolated_supabase_db_approval_required");
  return result;
}

export function validateBaselineManifest(manifest) {
  if (!manifest || manifest.baselineVersion !== "dashboard-free-tier-v1" || !SHA40.test(manifest.originMainSha || "") || !SHA256.test(manifest.baselineSha256 || "") || !SHA256.test(manifest.catalogSha256 || "") || !Array.isArray(manifest.requiredObjectSignatures) || !Array.isArray(manifest.orderedNewMigrations)) fail("isolated_supabase_db_manifest_invalid");
  for (const migration of manifest.orderedNewMigrations) {
    if (!MIGRATION.test(migration?.fileName || "") || !["candidate", "final"].includes(migration.status) || !SHA256.test(migration.sha256 || "")) fail("isolated_supabase_db_manifest_invalid");
  }
  return manifest;
}

export async function validateBaselineArtifactHashes({ root = ROOT, manifest }) {
  const [baseline, catalog] = await Promise.all([readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql")), readFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"))]);
  if (sha256(baseline) !== manifest.baselineSha256) fail("isolated_supabase_db_baseline_hash_drift");
  if (sha256(catalog) !== manifest.catalogSha256) fail("isolated_supabase_db_catalog_hash_drift");
  return true;
}

async function loadBaselineState(root) {
  const base = join(root, "supabase/test-baselines");
  const fallback = { manifestPath: join(base, "dashboard-free-tier-v1.manifest.json"), baselinePath: join(base, "dashboard-free-tier-v1.sql"), catalogPath: join(base, "dashboard-free-tier-origin-main-catalog.json"), parityPath: join(root, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql") };
  try {
    const pointer = JSON.parse(await readFile(join(base, "dashboard-free-tier-v1.active.json"), "utf8"));
    if (!/^[a-f0-9]{16}$/u.test(pointer?.captureId || "")) fail("isolated_supabase_db_baseline_review_required");
    const capture = join(base, "dashboard-free-tier-v1-captures", pointer.captureId);
    return { manifestPath: join(capture, "manifest.json"), baselinePath: join(capture, "baseline.sql"), catalogPath: join(capture, "catalog.json"), parityPath: join(capture, "parity.sql") };
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function validateArtifactPaths({ paths, manifest }) {
  const [baseline, catalog] = await Promise.all([readFile(paths.baselinePath), readFile(paths.catalogPath)]);
  if (sha256(baseline) !== manifest.baselineSha256) fail("isolated_supabase_db_baseline_hash_drift");
  if (sha256(catalog) !== manifest.catalogSha256) fail("isolated_supabase_db_catalog_hash_drift");
}

export async function validateManifestMigrations({ root = ROOT, manifest }) {
  for (const migration of manifest.orderedNewMigrations) {
    const path = join(root, "supabase/migrations", migration.fileName);
    let contents;
    try { contents = await readFile(path); } catch { fail("isolated_supabase_db_migration_hash_drift"); }
    if (sha256(contents) !== migration.sha256) fail("isolated_supabase_db_migration_hash_drift");
  }
  return manifest.orderedNewMigrations;
}

function parseLocalDbUrl(stdout, port) {
  let value;
  try { value = JSON.parse(stdout); } catch { fail("isolated_supabase_db_status_invalid"); }
  if (!value || typeof value !== "object" || Object.keys(value).filter((key) => key === "DB_URL").length !== 1 || typeof value.DB_URL !== "string") fail("isolated_supabase_db_status_invalid");
  let url;
  try { url = new URL(value.DB_URL); } catch { fail("isolated_supabase_db_status_invalid"); }
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || Number(url.port) !== port || url.pathname !== "/postgres") fail("isolated_supabase_db_status_invalid");
  return value.DB_URL;
}

async function prepareRuntime({ requestId, randomBytes = secureRandomBytes, allocatePort = async () => 54321 }) {
  const suffix = randomBytes(6).toString("hex");
  const projectId = `tips_supabase_db_qa_${suffix}`;
  const tempRoot = join("/private/tmp", `tips-supabase-db-qa-${requestId}`);
  try { await mkdir(tempRoot, { recursive: false, mode: 0o700 }); } catch { fail("isolated_supabase_db_temp_root_invalid"); }
  const ports = { api: await allocatePort(), db: await allocatePort(), studio: await allocatePort(), inbucket: await allocatePort() };
  if (new Set(Object.values(ports)).size !== 4 || !Object.values(ports).every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535)) fail("isolated_supabase_db_port_invalid");
  const configPath = join(tempRoot, "supabase/config.toml");
  return { tempRoot, projectId, ports, configPath };
}

async function stageFile(source, target) { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await copyFile(source, target); }
async function stageRequestedTests(root, runtime, paths) {
  for (const path of paths) {
    const source = safeRepoPath(root, path);
    try { await readFile(source); } catch { fail("isolated_supabase_db_target_missing"); }
    await stageFile(source, join(runtime.tempRoot, path));
  }
}

export async function runIsolatedSupabaseDbTests({ argv = process.argv.slice(2), root = ROOT, log = () => {}, randomBytes, allocatePort, retainTempRoot = false, executeProcess = (invocation) => processResult(invocation.command, invocation.args, invocation) } = {}) {
  const args = parseIsolatedDbArguments(argv);
  const artifactPaths = await loadBaselineState(root);
  const manifest = validateBaselineManifest(JSON.parse(await readFile(artifactPaths.manifestPath, "utf8")));
  await validateArtifactPaths({ paths: artifactPaths, manifest });
  if (!args.execute) return { status: "plan", tests: args.tests, probes: args.probes, manifest };
  const catalog = JSON.parse(await readFile(artifactPaths.catalogPath, "utf8"));
  if (catalog.captureStatus !== "reviewed" || catalog.originMainSha !== manifest.originMainSha) fail("isolated_supabase_db_baseline_review_required");
  const migrations = await validateManifestMigrations({ root, manifest });
  const runtime = await prepareRuntime({ requestId: args.requestId, randomBytes, allocatePort });
  const cleanEnvironment = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
  const invoke = async (argsForCli, { env = cleanEnvironment } = {}) => {
    const result = await executeProcess({ command: SUPABASE, args: argsForCli, cwd: runtime.tempRoot, env });
    if (result.code !== 0) fail("isolated_supabase_db_child_failed");
    return result;
  };
  let startAttempted = false;
  try {
    await invoke(["init", "--workdir", runtime.tempRoot, "--yes"]);
    await mkdir(dirname(runtime.configPath), { recursive: true, mode: 0o700 });
    const temporaryConfig = `${runtime.configPath}.tmp-${process.pid}`;
    await writeFile(temporaryConfig, safeConfig(runtime.projectId, runtime.ports), { mode: 0o600 });
    await rename(temporaryConfig, runtime.configPath);
    await stageFile(artifactPaths.baselinePath, join(runtime.tempRoot, "supabase/migrations/00000000000000_dashboard_free_tier_test_baseline.sql"));
    await stageFile(artifactPaths.parityPath, join(runtime.tempRoot, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"));
    await stageFile(join(root, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"), join(runtime.tempRoot, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"));
    startAttempted = true;
    await invoke(["db", "start", "--workdir", runtime.tempRoot, "--yes"]);
    await invoke(["test", "db", "--local", "--workdir", runtime.tempRoot, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql", "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"]);
    for (const migration of migrations) await stageFile(join(root, "supabase/migrations", migration.fileName), join(runtime.tempRoot, "supabase/migrations", migration.fileName));
    await invoke(["migration", "up", "--local", "--workdir", runtime.tempRoot, "--include-all"]);
    await stageRequestedTests(root, runtime, args.tests);
    if (args.tests.length) await invoke(["test", "db", "--local", "--workdir", runtime.tempRoot, ...args.tests]);
    const status = await invoke(["status", "--workdir", runtime.tempRoot, "--output", "json"]);
    const localDbUrl = parseLocalDbUrl(status.stdout, runtime.ports.db);
    for (const probe of args.probes) {
      const nonce = secureRandomBytes(16).toString("hex");
      const probeResult = await executeProcess({ command: process.execPath, args: [safeRepoPath(root, probe)], cwd: runtime.tempRoot, env: { ...cleanEnvironment, TASK_LOCAL_DB_URL: localDbUrl, TASK_LOCAL_DB_NONCE: nonce } });
      if (probeResult.code !== 0) fail("isolated_supabase_db_probe_failed");
    }
    return { status: "passed", runtime: { ...runtime, configPath: runtime.configPath } };
  } finally {
    if (startAttempted) {
      try { await executeProcess({ command: SUPABASE, args: ["stop", "--workdir", runtime.tempRoot, "--project-id", runtime.projectId, "--no-backup", "--yes"], cwd: runtime.tempRoot, env: cleanEnvironment }); } catch {}
    }
    if (!retainTempRoot) await rm(runtime.tempRoot, { recursive: true, force: true });
    log(JSON.stringify({ cleanup: startAttempted ? "attempted" : "not_required" }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runIsolatedSupabaseDbTests().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
