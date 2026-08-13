import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const SQL_TEST = /^supabase\/tests\/[a-z0-9_]+\.sql$/u;
const PROBE = /^[a-z0-9_./-]+\.mjs$/u;

function fail(code) { throw new Error(code); }

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
    if (!/^\d{14}_[a-z0-9_]+\.sql$/u.test(migration?.fileName || "") || migration.status !== "final" || !SHA256.test(migration.sha256 || "")) fail("isolated_supabase_db_manifest_invalid");
  }
  return manifest;
}

export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export async function validateBaselineArtifactHashes({ root = ROOT, manifest }) {
  const [baseline, catalog] = await Promise.all([
    readFile(resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.sql")),
    readFile(resolve(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json")),
  ]);
  if (sha256(baseline) !== manifest.baselineSha256) fail("isolated_supabase_db_baseline_hash_drift");
  if (sha256(catalog) !== manifest.catalogSha256) fail("isolated_supabase_db_catalog_hash_drift");
  return true;
}

export async function runIsolatedSupabaseDbTests({ argv = process.argv.slice(2), root = ROOT, log = () => {} } = {}) {
  const args = parseIsolatedDbArguments(argv);
  const manifest = validateBaselineManifest(JSON.parse(await readFile(resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json"), "utf8")));
  await validateBaselineArtifactHashes({ root, manifest });
  if (!args.execute) return { status: "plan", tests: args.tests, probes: args.probes, manifest };
  const catalog = JSON.parse(await readFile(resolve(root, "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json"), "utf8"));
  if (catalog.captureStatus !== "reviewed") fail("isolated_supabase_db_baseline_review_required");
  // The reviewed baseline is the only source copied into an ephemeral CLI workdir. No repository project config, linked ref, token, or database password is read here.
  log(JSON.stringify({ status: "blocked", reason: "isolated runner execution requires reviewed baseline catalog" }));
  fail("isolated_supabase_db_runtime_not_implemented_without_reviewed_baseline");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runIsolatedSupabaseDbTests().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
