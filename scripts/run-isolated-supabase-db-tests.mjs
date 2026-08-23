import { spawn } from "node:child_process";
import { createHash, randomBytes as secureRandomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const SQL_TEST = /^supabase\/tests\/[a-z0-9_]+\.sql$/u;
const PROBE = /^(?:tests\/[a-z0-9_./-]+\.mjs|scripts\/probe-dashboard-audit-chain-concurrency\.mjs)$/u;
const MIGRATION = /^(\d{14})_([a-z0-9_]+)\.sql$/u;
const SUPABASE = "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase";
const ISOLATED_SCHEMA_REPAIR_PATH = "scripts/fixtures/dashboard-free-tier-isolated-schema-repair.sql";
const ISOLATED_SCHEMA_REPAIR_SHA256 = "00c1a584269816060933bb6d728494aef085592d6c6b08dbc8a715cf6ee2794b";
const ISOLATED_MIGRATION_PREREQUISITE_PATH = "scripts/fixtures/dashboard-free-tier-migration-prerequisites.sql";
const ISOLATED_MIGRATION_PREREQUISITE_SHA256 = "051f9a7f82ab02abfb3437c6064782651032e4eded02aa89d8986dc9cf94c5f1";
const REVIEWED_MANIFEST_BOOTSTRAP = Object.freeze({
  baseSha: "c7ea76b3dcd94101503305feadc95ce591f68050",
  baseManifestSha256: "0b55a4b7629dc8105fb9df45828db7fa1122651601096e529c8c79c5e801eef1",
  headSha: "dd7a61557efab0f623e99385630e3f66282e3f18",
  headManifestSha256: "1863b8d3762e3aaa464ef1ec52e0e6883527a44e54412efbc7966975d8de5c30",
  baselineSha256: "5ff38fdc315d28ba998489d896b8083a1a2ccd223fc8a378d7f92ec74e315269",
  promotedFileName: "20260820150057_ops_task_completion_actor.sql",
  promotedSha256: "2bd12279b8f79757dfbf6e5d84423bf34019d5f172c80e36377166002e89ceba",
  functionAclBaselineRepair: Object.freeze({
    headSha: "7865388b134af488bb7be3944e49eceb25e1d649",
    headManifestSha256: "d103e6a1aa6a3be4835783ee122937a54108064e37f3836e4097b9ed7733749b",
    baselineSha256: "75fdc621929dbacf4ba049667feef65977f5996ac8f1cd39675585ecb1136fb7",
    activePointerSha256: "c25411d4a1a1910a7a8b072bdf892ea02499fbdb62341f4ced34c33b111b56d3",
    captureId: "47838c718a358344",
    captureManifestSha256: "be5871f1cbc6b4b304d9aa00b4388bbe9891d574b7d6444064c820ce56efcc14",
    catalogSha256: "4d925b43c13bcf4b24cdf69db16d6d648b68fe8661999416118f49357d99ed6d",
    paritySha256: "be49575aff62c800078cf73a21957e0f1ea4a392aee838619de05b409eeaf1ab",
  }),
});

function fail(code) { throw new Error(code); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function sanitizeChildDiagnostic(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s;]+@/giu, "$1[redacted]@")
    .replace(/(["']?authorization["']?\s*[:=]\s*)(?:(["'])(?:bearer|basic)\s+[^"'\r\n]*\2|(?:bearer|basic)\s+[^\s;,&}]+)/giu, (_match, prefix, quote) => `${prefix}${quote || ""}[redacted]${quote || ""}`)
    .replace(/(["']?[a-z0-9_-]*(?:token|password|secret|key)["']?\s*[:=]\s*)(?:(["'])[^"'\r\n]*\2|[^\s;,&}]+)/giu, (_match, prefix, quote) => `${prefix}${quote || ""}[redacted]${quote || ""}`)
    .replace(/\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/giu, "[redacted]")
    .replace(/\b(?:sbp|sb_secret|sb_publishable)_[a-z0-9._-]+\b/giu, "[redacted]")
    .slice(-8000);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}
export function decodeUtf8ProcessChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.every((chunk) => Buffer.isBuffer(chunk))) fail("isolated_supabase_db_child_output_invalid");
  return Buffer.concat(chunks).toString("utf8");
}
function safeRepoPath(root, path) {
  if (typeof path !== "string" || path.includes("..") || relative(root, resolve(root, path)).startsWith("..")) fail("isolated_supabase_db_target_invalid");
  return resolve(root, path);
}
export function buildIsolatedSupabaseConfig(projectId, ports, databaseMajorVersion) {
  if (![15, 17].includes(databaseMajorVersion)) fail("isolated_supabase_db_major_version_invalid");
  return `project_id = "${projectId}"\n[api]\nenabled = true\nport = ${ports.api}\n[db]\nport = ${ports.db}\nmajor_version = ${databaseMajorVersion}\n[studio]\nenabled = false\n[inbucket]\nenabled = false\n[analytics]\nenabled = false\n`;
}
function processResult(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks = []; const stderrChunks = [];
    child.stdout.on("data", (chunk) => { stdoutChunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderrChunks.push(chunk); });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({
      code,
      stdout: decodeUtf8ProcessChunks(stdoutChunks),
      stderr: decodeUtf8ProcessChunks(stderrChunks),
    }));
  });
}

export function parseIsolatedDbArguments(argv) {
  const result = { execute: false, authorized: false, requireFinal: false, reviewHead: false, reviewBaseSha: null, reviewHeadSha: null, lint: false, requestId: null, tests: [], probes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") result.execute = true;
    else if (value === "--authorized") result.authorized = true;
    else if (value === "--require-final") result.requireFinal = true;
    else if (value === "--review-head") result.reviewHead = true;
    else if (value === "--review-base-sha") result.reviewBaseSha = argv[++index] || null;
    else if (value === "--review-head-sha") result.reviewHeadSha = argv[++index] || null;
    else if (value === "--lint") result.lint = true;
    else if (value === "--request-id") result.requestId = argv[++index] || null;
    else if (value === "--test") result.tests.push(argv[++index] || "");
    else if (value === "--probe") result.probes.push(argv[++index] || "");
    else fail("isolated_supabase_db_arguments_invalid");
  }
  const hasReviewBase = result.reviewBaseSha !== null;
  const hasReviewHead = result.reviewHeadSha !== null;
  if (hasReviewBase || hasReviewHead) {
    if (!result.reviewHead || !hasReviewBase || !hasReviewHead || !SHA40.test(result.reviewBaseSha) || !SHA40.test(result.reviewHeadSha)) fail("isolated_supabase_db_review_revision_invalid");
  }
  if (!result.tests.every((path) => SQL_TEST.test(path)) || !result.probes.every((path) => PROBE.test(path))) fail("isolated_supabase_db_target_invalid");
  if (result.execute && (!result.authorized || !REQUEST_ID.test(result.requestId || ""))) fail("isolated_supabase_db_approval_required");
  return result;
}

export function validateBaselineManifest(manifest) {
  if (!manifest || manifest.baselineVersion !== "dashboard-free-tier-v1" || !SHA40.test(manifest.originMainSha || "") || !SHA256.test(manifest.baselineSha256 || "") || !SHA256.test(manifest.catalogSha256 || "") || !Array.isArray(manifest.requiredObjectSignatures) || !Array.isArray(manifest.orderedNewMigrations)) fail("isolated_supabase_db_manifest_invalid");
  const fileNames = [];
  const versions = [];
  for (const migration of manifest.orderedNewMigrations) {
    const match = migration?.fileName?.match(MIGRATION);
    if (!match || !["candidate", "final"].includes(migration.status) || !SHA256.test(migration.sha256 || "")) fail("isolated_supabase_db_manifest_invalid");
    fileNames.push(migration.fileName);
    versions.push(match[1]);
  }
  if (new Set(fileNames).size !== fileNames.length
    || new Set(versions).size !== versions.length
    || JSON.stringify(fileNames) !== JSON.stringify([...fileNames].sort())) {
    fail("isolated_supabase_db_manifest_invalid");
  }
  return manifest;
}

export async function validateBaselineArtifactHashes({ root = ROOT, manifest }) {
  const [baseline, catalog] = await Promise.all([readFile(join(root, "supabase/test-baselines/dashboard-free-tier-v1.sql")), readFile(join(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"))]);
  if (sha256(baseline) !== manifest.baselineSha256) fail("isolated_supabase_db_baseline_hash_drift");
  if (sha256(catalog) !== manifest.catalogSha256) fail("isolated_supabase_db_catalog_hash_drift");
  return true;
}

async function loadBaselineState(root, { reviewHead = false } = {}) {
  const base = join(root, "supabase/test-baselines");
  const expectedArtifactPaths = { catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json", baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql", parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql" };
  try {
    const pointer = JSON.parse(await readFile(join(base, "dashboard-free-tier-v1.active.json"), "utf8"));
    if (!exactActivePointer(pointer, expectedArtifactPaths)) fail("isolated_supabase_db_baseline_review_required");
    const capture = join(base, "dashboard-free-tier-v1-captures", pointer.captureId);
    const captureManifestPath = join(capture, "manifest.json");
    return {
      captureId: pointer.captureId,
      captureManifestPath,
      manifestPath: reviewHead ? join(base, "dashboard-free-tier-v1.manifest.json") : captureManifestPath,
      baselinePath: join(capture, "baseline.sql"),
      catalogPath: join(capture, "catalog.json"),
      parityPath: join(capture, "parity.sql"),
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) fail("isolated_supabase_db_baseline_review_required");
    throw error;
  }
}

function exactActivePointer(pointer, expectedArtifactPaths) {
  return pointer && typeof pointer === "object" && !Array.isArray(pointer)
    && Object.keys(pointer).sort().join("|") === "artifactPaths|captureId|captureSetVersion"
    && pointer.captureSetVersion === 1 && /^[a-f0-9]{16}$/u.test(pointer.captureId || "")
    && JSON.stringify(pointer.artifactPaths) === JSON.stringify(expectedArtifactPaths);
}

async function validateReviewedFunctionAclBaselineRepair({ headSha, headManifest, repairManifest, repairManifestSource, readRevisionFile }) {
  const repair = REVIEWED_MANIFEST_BOOTSTRAP.functionAclBaselineRepair;
  const withoutMigrations = (manifest) => {
    const metadata = { ...manifest };
    delete metadata.orderedNewMigrations;
    return metadata;
  };
  const repairEntries = repairManifest.orderedNewMigrations;
  const headEntries = headManifest.orderedNewMigrations;
  if (sha256(repairManifestSource) !== repair.headManifestSha256
    || repairManifest.baselineSha256 !== repair.baselineSha256
    || canonical(withoutMigrations(headManifest)) !== canonical(withoutMigrations(repairManifest))
    || headEntries.length < repairEntries.length) {
    fail("isolated_supabase_db_final_migration_history_drift");
  }
  for (let index = 0; index < repairEntries.length; index += 1) {
    if (canonical(headEntries[index]) !== canonical(repairEntries[index])) fail("isolated_supabase_db_final_migration_history_drift");
  }
  const appendedEntries = headEntries.slice(repairEntries.length);
  const fileNames = headEntries.map((entry) => entry.fileName);
  if (appendedEntries.some((entry) => entry.status !== "final")
    || new Set(fileNames).size !== fileNames.length
    || JSON.stringify(fileNames) !== JSON.stringify([...fileNames].sort())) {
    fail("isolated_supabase_db_final_migration_history_drift");
  }

  const pointerPath = "supabase/test-baselines/dashboard-free-tier-v1.active.json";
  const artifactPaths = {
    catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
    baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql",
    parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
  };
  const captureBase = `supabase/test-baselines/dashboard-free-tier-v1-captures/${repair.captureId}`;
  const [
    pointerSource,
    captureManifestSource,
    captureBaselineSource,
    captureCatalogSource,
    captureParitySource,
    canonicalBaselineSource,
    canonicalCatalogSource,
    canonicalParitySource,
  ] = await Promise.all([
    readRevisionFile(headSha, pointerPath),
    readRevisionFile(headSha, `${captureBase}/manifest.json`),
    readRevisionFile(headSha, `${captureBase}/baseline.sql`),
    readRevisionFile(headSha, `${captureBase}/catalog.json`),
    readRevisionFile(headSha, `${captureBase}/parity.sql`),
    readRevisionFile(headSha, artifactPaths.baseline),
    readRevisionFile(headSha, artifactPaths.catalog),
    readRevisionFile(headSha, artifactPaths.parityTest),
  ]);
  const pointer = JSON.parse(pointerSource);
  const captureManifest = validateBaselineManifest(JSON.parse(captureManifestSource));
  if (sha256(pointerSource) !== repair.activePointerSha256
    || !exactActivePointer(pointer, artifactPaths)
    || pointer.captureId !== repair.captureId
    || sha256(captureManifestSource) !== repair.captureManifestSha256
    || captureManifest.baselineSha256 !== repair.baselineSha256
    || captureManifest.catalogSha256 !== repair.catalogSha256
    || sha256(captureBaselineSource) !== repair.baselineSha256
    || sha256(captureCatalogSource) !== repair.catalogSha256
    || sha256(captureParitySource) !== repair.paritySha256
    || canonicalBaselineSource !== captureBaselineSource
    || canonicalCatalogSource !== captureCatalogSource
    || canonicalParitySource !== captureParitySource) {
    fail("isolated_supabase_db_final_migration_history_drift");
  }
  const captureId = sha256(canonical({
    baseline: captureBaselineSource,
    catalog: captureCatalogSource,
    manifest: captureManifest,
    parity: captureParitySource,
  })).slice(0, 16);
  if (captureId !== repair.captureId) fail("isolated_supabase_db_final_migration_history_drift");
}

async function validateArtifactPaths({ paths, manifest }) {
  const [baseline, catalog, parity] = await Promise.all([readFile(paths.baselinePath), readFile(paths.catalogPath), readFile(paths.parityPath)]);
  if (sha256(baseline) !== manifest.baselineSha256) fail("isolated_supabase_db_baseline_hash_drift");
  if (sha256(catalog) !== manifest.catalogSha256) fail("isolated_supabase_db_catalog_hash_drift");
  const captureId = sha256(canonical({ baseline: baseline.toString("utf8"), catalog: catalog.toString("utf8"), manifest, parity: parity.toString("utf8") })).slice(0, 16);
  if (captureId !== paths.captureId) fail("isolated_supabase_db_capture_identity_drift");
  return { baseline, catalog, parity };
}

export async function validateManifestMigrations({ root = ROOT, manifest, baselineVersions }) {
  if (!Array.isArray(baselineVersions) || !baselineVersions.every((version) => /^\d{14}$/u.test(version)) || new Set(baselineVersions).size !== baselineVersions.length) fail("isolated_supabase_db_manifest_invalid");
  const appliedVersions = new Set(baselineVersions);
  const pendingFiles = (await readdir(join(root, "supabase/migrations")))
    .filter((fileName) => {
      const match = fileName.match(MIGRATION);
      return match && !appliedVersions.has(match[1]);
    })
    .sort();
  const manifestFiles = manifest.orderedNewMigrations.map((migration) => migration.fileName);
  if (JSON.stringify(manifestFiles) !== JSON.stringify(pendingFiles)) fail("isolated_supabase_db_migration_manifest_incomplete");
  const verified = [];
  for (const migration of manifest.orderedNewMigrations) {
    const path = join(root, "supabase/migrations", migration.fileName);
    let contents;
    try { contents = await readFile(path); } catch { fail("isolated_supabase_db_migration_hash_drift"); }
    if (sha256(contents) !== migration.sha256) fail("isolated_supabase_db_migration_hash_drift");
    verified.push({ ...migration, contents });
  }
  return verified;
}

async function invokeGit({ root, args, executeGit }) {
  let result;
  try {
    result = await executeGit({ command: "git", args, cwd: root, env: process.env });
  } catch {
    fail("isolated_supabase_db_review_history_unavailable");
  }
  if (result?.code !== 0 || typeof result.stdout !== "string") fail("isolated_supabase_db_review_history_unavailable");
  return result.stdout;
}

export async function validateImmutableFinalMigrationHistory({
  root = ROOT,
  baseSha,
  headSha,
  executeGit = (invocation) => processResult(invocation.command, invocation.args, invocation),
} = {}) {
  if (!SHA40.test(baseSha || "") || !SHA40.test(headSha || "")) fail("isolated_supabase_db_review_revision_invalid");
  const mergeBaseSha = (await invokeGit({ root, args: ["merge-base", baseSha, headSha], executeGit })).trim();
  if (!SHA40.test(mergeBaseSha)) fail("isolated_supabase_db_review_history_unavailable");
  const manifestRelativePath = "supabase/test-baselines/dashboard-free-tier-v1.manifest.json";
  const readRevisionFile = async (revision, path) => invokeGit({
    root,
    args: ["show", `${revision}:${path}`],
    executeGit,
  });
  let baseManifestSource;
  let headManifestSource;
  let baseManifest;
  let headManifest;
  try {
    [baseManifestSource, headManifestSource] = await Promise.all([
      readRevisionFile(mergeBaseSha, manifestRelativePath),
      readRevisionFile(headSha, manifestRelativePath),
    ]);
    baseManifest = validateBaselineManifest(JSON.parse(baseManifestSource));
    headManifest = validateBaselineManifest(JSON.parse(headManifestSource));
  } catch (error) {
    if (error?.message === "isolated_supabase_db_review_history_unavailable") throw error;
    fail("isolated_supabase_db_final_migration_history_drift");
  }
  const baseEntries = baseManifest.orderedNewMigrations;
  const headEntries = headManifest.orderedNewMigrations;
  const baseFinalEntries = baseEntries.filter((entry) => entry.status === "final");
  const isReviewedManifestBootstrap = baseSha === REVIEWED_MANIFEST_BOOTSTRAP.baseSha
    && mergeBaseSha === REVIEWED_MANIFEST_BOOTSTRAP.baseSha;
  if (isReviewedManifestBootstrap) {
    const headManifestSha256 = sha256(headManifestSource);
    const isOriginalReviewedHead = headSha === REVIEWED_MANIFEST_BOOTSTRAP.headSha
      && headManifestSha256 === REVIEWED_MANIFEST_BOOTSTRAP.headManifestSha256;
    if (sha256(baseManifestSource) !== REVIEWED_MANIFEST_BOOTSTRAP.baseManifestSha256) fail("isolated_supabase_db_final_migration_history_drift");
    if (!isOriginalReviewedHead) {
      try {
        const repair = REVIEWED_MANIFEST_BOOTSTRAP.functionAclBaselineRepair;
        const repairManifestSource = await readRevisionFile(repair.headSha, manifestRelativePath);
        const repairManifest = validateBaselineManifest(JSON.parse(repairManifestSource));
        await validateReviewedFunctionAclBaselineRepair({ headSha, headManifest, repairManifest, repairManifestSource, readRevisionFile });
      } catch {
        fail("isolated_supabase_db_final_migration_history_drift");
      }
    }
    let nextHeadIndex = 0;
    for (const entry of baseFinalEntries) {
      const matchingHeadIndex = headEntries.findIndex((headEntry, index) => index >= nextHeadIndex && headEntry.fileName === entry.fileName);
      if (matchingHeadIndex < 0 || canonical(headEntries[matchingHeadIndex]) !== canonical(entry)) fail("isolated_supabase_db_final_migration_history_drift");
      nextHeadIndex = matchingHeadIndex + 1;
    }
    const baseCandidates = baseEntries.filter((entry) => entry.status === "candidate");
    const promotedHeadEntry = headEntries.find((entry) => entry.fileName === REVIEWED_MANIFEST_BOOTSTRAP.promotedFileName);
    if (baseCandidates.length !== 1
      || baseCandidates[0].fileName !== REVIEWED_MANIFEST_BOOTSTRAP.promotedFileName
      || baseCandidates[0].sha256 !== REVIEWED_MANIFEST_BOOTSTRAP.promotedSha256
      || canonical(promotedHeadEntry) !== canonical({ ...baseCandidates[0], status: "final" })) {
      fail("isolated_supabase_db_final_migration_history_drift");
    }
    try {
      for (const entry of baseEntries) {
        const migrationPath = `supabase/migrations/${entry.fileName}`;
        const [baseSql, headSql] = await Promise.all([
          readRevisionFile(mergeBaseSha, migrationPath),
          readRevisionFile(headSha, migrationPath),
        ]);
        if (baseSql !== headSql || sha256(baseSql) !== entry.sha256 || sha256(headSql) !== entry.sha256) fail("isolated_supabase_db_final_migration_history_drift");
      }
      for (const entry of headEntries) {
        const headSql = await readRevisionFile(headSha, `supabase/migrations/${entry.fileName}`);
        if (entry.status !== "final" || sha256(headSql) !== entry.sha256) fail("isolated_supabase_db_final_migration_history_drift");
      }
    } catch {
      fail("isolated_supabase_db_final_migration_history_drift");
    }
    return {
      mergeBaseSha,
      baseFinalCount: baseFinalEntries.length,
      appendedCount: headEntries.length - baseEntries.length,
    };
  }
  if (headEntries.length < baseEntries.length) fail("isolated_supabase_db_final_migration_history_drift");
  for (let index = 0; index < baseEntries.length; index += 1) {
    if (canonical(headEntries[index]) !== canonical(baseEntries[index])) fail("isolated_supabase_db_final_migration_history_drift");
  }
  for (const entry of baseFinalEntries) {
    const migrationPath = `supabase/migrations/${entry.fileName}`;
    let baseSql;
    let headSql;
    try {
      [baseSql, headSql] = await Promise.all([
        readRevisionFile(mergeBaseSha, migrationPath),
        readRevisionFile(headSha, migrationPath),
      ]);
    } catch {
      fail("isolated_supabase_db_final_migration_history_drift");
    }
    if (baseSql !== headSql || sha256(baseSql) !== entry.sha256 || sha256(headSql) !== entry.sha256) fail("isolated_supabase_db_final_migration_history_drift");
  }
  return {
    mergeBaseSha,
    baseFinalCount: baseFinalEntries.length,
    appendedCount: headEntries.length - baseEntries.length,
  };
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

export async function allocateLoopbackPorts(count) {
  if (!Number.isInteger(count) || count < 1 || count > 16) fail("isolated_supabase_db_port_invalid");
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      await new Promise((resolvePromise, rejectPromise) => {
        const onError = (error) => rejectPromise(error);
        server.once("error", onError);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
          server.off("error", onError);
          resolvePromise();
        });
      });
      servers.push(server);
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolvePromise) => server.close(resolvePromise))));
  }
}

async function prepareRuntime({ requestId, randomBytes = secureRandomBytes, allocatePort, log, tempDirectory }) {
  const suffix = randomBytes(6).toString("hex");
  const projectId = `tips_supabase_db_qa_${suffix}`;
  if (typeof tempDirectory !== "string" || !tempDirectory) fail("isolated_supabase_db_temp_root_invalid");
  const tempRoot = join(tempDirectory, `tips-supabase-db-qa-${requestId}`);
  try { await mkdir(tempRoot, { recursive: false, mode: 0o700 }); } catch { fail("isolated_supabase_db_temp_root_invalid"); }
  try {
    const values = allocatePort
      ? [await allocatePort(), await allocatePort(), await allocatePort(), await allocatePort()]
      : await allocateLoopbackPorts(4);
    const ports = { api: values[0], db: values[1], studio: values[2], inbucket: values[3] };
    if (new Set(Object.values(ports)).size !== 4 || !Object.values(ports).every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535)) fail("isolated_supabase_db_port_invalid");
    const configPath = join(tempRoot, "supabase/config.toml");
    return { tempRoot, projectId, ports, configPath };
  } catch (error) {
    let tempRootState = "removed";
    try { await rm(tempRoot, { recursive: true, force: true }); } catch { tempRootState = "failed"; }
    log(JSON.stringify({ cleanup: tempRootState === "removed" ? "succeeded" : "failed", stop: "not_required", tempRoot: tempRootState }));
    throw error;
  }
}

async function stageContents(contents, target) { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, contents, { mode: 0o600 }); }
async function snapshotRequestedFiles(root, paths) {
  const snapshots = [];
  for (const path of paths) {
    try { snapshots.push({ path, contents: await readFile(safeRepoPath(root, path)) }); } catch { fail("isolated_supabase_db_target_missing"); }
  }
  return snapshots;
}

export async function runIsolatedSupabaseDbTests({ argv = process.argv.slice(2), root = ROOT, log = () => {}, randomBytes, allocatePort, retainTempRoot = false, tempDirectory = process.env.RUNNER_TEMP || tmpdir(), supabasePath: injectedSupabasePath, executeGit = (invocation) => processResult(invocation.command, invocation.args, invocation), executeProcess = (invocation) => processResult(invocation.command, invocation.args, invocation) } = {}) {
  const args = parseIsolatedDbArguments(argv);
  const artifactPaths = await loadBaselineState(root, { reviewHead: args.reviewHead });
  const captureManifest = validateBaselineManifest(JSON.parse(await readFile(artifactPaths.captureManifestPath, "utf8")));
  const manifest = validateBaselineManifest(JSON.parse(await readFile(artifactPaths.manifestPath, "utf8")));
  const artifacts = await validateArtifactPaths({ paths: artifactPaths, manifest: captureManifest });
  if (args.requireFinal && (!manifest.orderedNewMigrations.length || manifest.orderedNewMigrations.some((migration) => migration.status !== "final"))) fail("isolated_supabase_db_final_manifest_required");
  const reviewBoundary = args.reviewBaseSha ? await validateImmutableFinalMigrationHistory({ root, baseSha: args.reviewBaseSha, headSha: args.reviewHeadSha, executeGit }) : null;
  let migrations;
  let catalog;
  if (args.execute || reviewBoundary) {
    catalog = JSON.parse(artifacts.catalog.toString("utf8"));
    if (catalog.captureStatus !== "reviewed" || catalog.originMainSha !== manifest.originMainSha || !Array.isArray(catalog.migrationLedger) || ![15, 17].includes(catalog.serverMajor)) fail("isolated_supabase_db_baseline_review_required");
    migrations = await validateManifestMigrations({ root, manifest, baselineVersions: catalog.migrationLedger.map((row) => row.version) });
  }
  if (!args.execute) return { status: "plan", tests: args.tests, probes: args.probes, manifest, artifactPaths, reviewBoundary };
  const smokeTest = await readFile(join(root, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"));
  let schemaRepair;
  try { schemaRepair = await readFile(safeRepoPath(root, ISOLATED_SCHEMA_REPAIR_PATH)); } catch { fail("isolated_supabase_db_schema_repair_drift"); }
  if (sha256(schemaRepair) !== ISOLATED_SCHEMA_REPAIR_SHA256) fail("isolated_supabase_db_schema_repair_drift");
  let migrationPrerequisite;
  try { migrationPrerequisite = await readFile(safeRepoPath(root, ISOLATED_MIGRATION_PREREQUISITE_PATH)); } catch { fail("isolated_supabase_db_prerequisite_drift"); }
  if (sha256(migrationPrerequisite) !== ISOLATED_MIGRATION_PREREQUISITE_SHA256) fail("isolated_supabase_db_prerequisite_drift");
  const requestedTests = await snapshotRequestedFiles(root, args.tests);
  const probes = await snapshotRequestedFiles(root, args.probes);
  const runtime = await prepareRuntime({ requestId: args.requestId, randomBytes, allocatePort, log, tempDirectory });
  const cleanEnvironment = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
  const supabasePath = injectedSupabasePath || process.env.TASK_SUPABASE_CLI || SUPABASE;
  const invoke = async (argsForCli, { env = cleanEnvironment } = {}) => {
    const result = await executeProcess({ command: supabasePath, args: argsForCli, cwd: runtime.tempRoot, env });
    if (result.code !== 0) {
      const step = ["db", "migration", "test"].includes(argsForCli[0]) ? argsForCli.slice(0, 2).join(" ") : argsForCli[0];
      log(JSON.stringify({
        event: "isolated_supabase_db_child_failed",
        step,
        exitCode: Number.isInteger(result.code) ? result.code : null,
        stdout: sanitizeChildDiagnostic(result.stdout),
        stderr: sanitizeChildDiagnostic(result.stderr),
      }));
      fail("isolated_supabase_db_child_failed");
    }
    return result;
  };
  let startAttempted = false;
  let primaryError = null;
  try {
    await invoke(["init", "--workdir", runtime.tempRoot, "--yes"]);
    await mkdir(dirname(runtime.configPath), { recursive: true, mode: 0o700 });
    const temporaryConfig = `${runtime.configPath}.tmp-${process.pid}`;
    await writeFile(temporaryConfig, buildIsolatedSupabaseConfig(runtime.projectId, runtime.ports, catalog.serverMajor), { mode: 0o600 });
    await rename(temporaryConfig, runtime.configPath);
    await stageContents(artifacts.baseline, join(runtime.tempRoot, "supabase/migrations/00000000000000_dashboard_free_tier_test_baseline.sql"));
    await stageContents(schemaRepair, join(runtime.tempRoot, "supabase/migrations/00000000000001_dashboard_free_tier_test_schema_repair.sql"));
    await stageContents(migrationPrerequisite, join(runtime.tempRoot, "supabase/migrations/00000000000002_dashboard_free_tier_test_prerequisites.sql"));
    await stageContents(artifacts.parity, join(runtime.tempRoot, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql"));
    await stageContents(smokeTest, join(runtime.tempRoot, "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"));
    startAttempted = true;
    await invoke(["db", "start", "--workdir", runtime.tempRoot, "--yes"]);
    await invoke(["test", "db", "--local", "--workdir", runtime.tempRoot, "supabase/tests/dashboard_free_tier_catalog_parity_test.sql", "supabase/tests/dashboard_free_tier_baseline_smoke_test.sql"]);
    for (const migration of migrations) await stageContents(migration.contents, join(runtime.tempRoot, "supabase/migrations", migration.fileName));
    await invoke(["migration", "up", "--local", "--workdir", runtime.tempRoot, "--include-all"]);
    if (args.lint) await invoke(["db", "lint", "--local", "--workdir", runtime.tempRoot, "--fail-on", "error"]);
    for (const test of requestedTests) await stageContents(test.contents, join(runtime.tempRoot, test.path));
    if (args.tests.length) await invoke(["test", "db", "--local", "--workdir", runtime.tempRoot, ...args.tests]);
    const status = await invoke(["status", "--workdir", runtime.tempRoot, "--output", "json"]);
    const localDbUrl = parseLocalDbUrl(status.stdout, runtime.ports.db);
    for (const probe of probes) {
      const nonce = secureRandomBytes(16).toString("hex");
      const stagedProbe = join(runtime.tempRoot, probe.path);
      await stageContents(probe.contents, stagedProbe);
      const probeResult = await executeProcess({ command: process.execPath, args: [stagedProbe], cwd: runtime.tempRoot, env: { ...cleanEnvironment, TASK_LOCAL_DB_URL: localDbUrl, TASK_LOCAL_DB_NONCE: nonce } });
      if (probeResult.code !== 0) fail("isolated_supabase_db_probe_failed");
    }
    return { status: "passed", runtime: { ...runtime, configPath: runtime.configPath } };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let stopState = "not_required";
    let tempRootState = retainTempRoot ? "retained" : "removed";
    let cleanupFailed = false;
    let stopAttempted = false;
    let tempRootCleanupAttempted = false;
    if (startAttempted) {
      stopAttempted = true;
      try {
        const stopResult = await executeProcess({ command: supabasePath, args: ["stop", "--workdir", runtime.tempRoot, "--project-id", runtime.projectId, "--no-backup", "--yes"], cwd: runtime.tempRoot, env: cleanEnvironment });
        stopState = stopResult?.code === 0 ? "succeeded" : "failed";
      } catch {
        stopState = "failed";
      }
      cleanupFailed = stopState === "failed";
    }
    if (!retainTempRoot) {
      tempRootCleanupAttempted = true;
      try { await rm(runtime.tempRoot, { recursive: true, force: true }); } catch {
        tempRootState = "failed";
        cleanupFailed = true;
      }
    }
    const cleanupAttempted = stopAttempted || tempRootCleanupAttempted;
    log(JSON.stringify({ cleanup: cleanupFailed ? "failed" : cleanupAttempted ? "succeeded" : "not_required", stop: stopState, tempRoot: tempRootState }));
    if (cleanupFailed && !primaryError) fail("isolated_supabase_db_cleanup_failed");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runIsolatedSupabaseDbTests({ log: (entry) => process.stderr.write(`${entry}\n`) }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
