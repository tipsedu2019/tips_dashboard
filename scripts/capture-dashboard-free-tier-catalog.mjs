import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const REQUIRED_RESPONSE_KEYS = Object.freeze([
  "catalog",
  "migrationLedgerCount",
  "migrationLedgerMaxVersion",
  "migrationLedgerSha256",
  "serverMajor",
]);
const FIXED_STATEMENT = `with migration_ledger as (
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', migration_row.version, 'name', migration_row.name,
    'statements_sha256', migration_row.statements_sha256
  ) order by migration_row.version) as entries
  from supabase_migrations.schema_migrations as migration_row
)
select pg_catalog.jsonb_build_object(
  'catalog', pg_catalog.jsonb_build_array(),
  'migrationLedgerCount', pg_catalog.jsonb_array_length(pg_catalog.coalesce(migration_ledger.entries, '[]'::jsonb)),
  'migrationLedgerMaxVersion', pg_catalog.coalesce((migration_ledger.entries -> -1 ->> 'version'), ''),
  'migrationLedgerSha256', pg_catalog.encode(pg_catalog.digest(pg_catalog.coalesce(migration_ledger.entries, '[]'::jsonb)::text, 'sha256'), 'hex'),
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000
) from migration_ledger`;

function fail(code) {
  throw new Error(code);
}

function valuesFor(flag, argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) values.push(argv[index + 1]);
  }
  return values;
}

export function classifyManagementApiFailure(status) {
  return ({
    401: "credential_invalid",
    403: "database_read_permission_missing",
    404: "endpoint_contract_drift",
    405: "endpoint_contract_drift",
    429: "rate_limited_no_output",
    500: "provider_unavailable_no_output",
  })[status] || "management_api_contract_drift";
}

export function parseCatalogCaptureArguments(argv) {
  const value = (flag) => valuesFor(flag, argv)[0];
  const parsed = {
    mode: value("--mode"), authorized: argv.includes("--authorized"), requestId: value("--request-id"),
    originMainSha: value("--origin-main-sha"), scope: value("--scope"), catalog: value("--catalog"),
    baseline: value("--baseline"), parityTest: value("--parity-test"),
  };
  if (valuesFor("--token", argv).length || valuesFor("--project-ref", argv).length) fail("dashboard_free_tier_catalog_argv_secret_refused");
  if (!parsed.authorized || parsed.mode !== "execute") fail("dashboard_free_tier_catalog_approval_required");
  if (!REQUEST_ID.test(parsed.requestId || "") || !SHA40.test(parsed.originMainSha || "")) fail("dashboard_free_tier_catalog_arguments_invalid");
  for (const path of [parsed.scope, parsed.catalog, parsed.baseline, parsed.parityTest]) {
    if (typeof path !== "string" || !/^(?:scripts|supabase)\/[a-z0-9_./-]+$/u.test(path) || path.includes("..")) fail("dashboard_free_tier_catalog_arguments_invalid");
  }
  return parsed;
}

function statementId() {
  return createHash("sha256").update(FIXED_STATEMENT, "utf8").digest("hex");
}

function isExactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

export async function captureDashboardFreeTierCatalog({
  argv = process.argv.slice(2), env = process.env, root = ROOT, fetch = globalThis.fetch,
  gitOriginMainSha = async () => (await import("node:child_process")).execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(),
  log = () => {},
} = {}) {
  if (
    argv.includes(env.SUPABASE_DATABASE_READ_TOKEN)
    || argv.includes(env.SUPABASE_PROJECT_REF)
  ) fail("dashboard_free_tier_catalog_argv_secret_refused");
  const args = parseCatalogCaptureArguments(argv);
  if (env.SUPABASE_DATABASE_READ_TOKEN === undefined || !PROJECT_REF.test(env.SUPABASE_PROJECT_REF || "") || env.TASK_ORIGIN_MAIN_SHA !== args.originMainSha) {
    fail("dashboard_free_tier_catalog_credentials_missing");
  }
  if ((await gitOriginMainSha()) !== args.originMainSha) fail("dashboard_free_tier_catalog_origin_main_drift");
  const contract = JSON.parse(await readFile(resolve(root, "scripts/fixtures/supabase-management-read-only-query-contract.json"), "utf8"));
  if (contract.method !== "POST" || contract.pathTemplate !== "/v1/projects/{ref}/database/query/read-only" || contract.successStatus !== 201 || contract.oauthScope !== "database:read" || contract.fineGrainedPermission !== "database_read") fail("management_api_contract_drift");
  log(JSON.stringify({ statementId: "dashboard_free_tier_catalog_v1", statementSha256: statementId() }));
  const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query/read-only`;
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${env.SUPABASE_DATABASE_READ_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: FIXED_STATEMENT, parameters: [] }),
    query: FIXED_STATEMENT,
  });
  if (response.status !== 201 || response.redirected) fail(classifyManagementApiFailure(response.status));
  let payload;
  try { payload = await response.json(); } catch { fail("management_api_contract_drift"); }
  if (!isExactObject(payload, REQUIRED_RESPONSE_KEYS)) fail("management_api_contract_drift");
  // Artifacts are deliberately not emitted until a human reviews this snapshot and scope diff.
  fail("dashboard_free_tier_catalog_review_required");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  captureDashboardFreeTierCatalog().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
