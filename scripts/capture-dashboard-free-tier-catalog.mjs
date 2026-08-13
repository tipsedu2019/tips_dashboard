import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const OBJECT_ORDER = ["role", "schema", "type", "collation", "sequence", "table", "default", "constraint", "index", "function", "rls", "policy", "grant", "trigger"];

// `digest` belongs to pgcrypto's extension schema, which differs by project. The
// server statement therefore only reads a single MVCC snapshot; SHA-256 is
// calculated by this producer from its canonical JSON representation.
const FIXED_STATEMENT = `with migration_ledger as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', migration_row.version, 'name', migration_row.name,
    'statements_sha256', migration_row.statements_sha256
  ) order by migration_row.version), '[]'::jsonb) as entries
  from supabase_migrations.schema_migrations as migration_row
), scoped_catalog as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'objectKind', 'table', 'schema', schema_row.nspname, 'identity', relation_row.relname,
    'definition', pg_catalog.format('create table %I.%I (%s)', schema_row.nspname, relation_row.relname,
      pg_catalog.string_agg(pg_catalog.format('%I %s%s', column_row.attname,
        pg_catalog.format_type(column_row.atttypid, column_row.atttypmod),
        case when column_row.attnotnull then ' not null' else '' end), ', ' order by column_row.attnum)
    )
  ) order by schema_row.nspname, relation_row.relname), '[]'::jsonb) as entries
  from pg_catalog.pg_class as relation_row
  join pg_catalog.pg_namespace as schema_row on schema_row.oid = relation_row.relnamespace
  join pg_catalog.pg_attribute as column_row on column_row.attrelid = relation_row.oid
    and column_row.attnum > 0 and not column_row.attisdropped
  where relation_row.relkind in ('r', 'p')
    and (schema_row.nspname, relation_row.relname) in (
      ('auth', 'users'), ('public', 'academic_event_exam_details'), ('public', 'academic_events'),
      ('public', 'academic_schools'), ('public', 'class_group_members'), ('public', 'class_groups'),
      ('public', 'class_lesson_sessions'), ('public', 'class_terms'), ('public', 'classes'),
      ('public', 'ops_registration_appointment_calendar'), ('public', 'ops_tasks'),
      ('public', 'progress_logs'), ('public', 'profiles'), ('public', 'students'), ('public', 'textbooks')
    )
  group by schema_row.nspname, relation_row.relname
)
select pg_catalog.jsonb_build_object(
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'migrationLedger', migration_ledger.entries,
  'catalog', scoped_catalog.entries
) from migration_ledger cross join scoped_catalog`;

function fail(code) { throw new Error(code); }
function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function valuesFor(flag, argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === flag) values.push(argv[index + 1]);
  return values;
}
function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}
function safeRepoPath(root, path) {
  if (typeof path !== "string" || !/^(?:scripts|supabase)\/[a-z0-9_./-]+$/u.test(path) || path.includes("..")) fail("dashboard_free_tier_catalog_arguments_invalid");
  const resolved = resolve(root, path);
  if (relative(root, resolved).startsWith("..")) fail("dashboard_free_tier_catalog_arguments_invalid");
  return resolved;
}

export function classifyManagementApiFailure(status) {
  return ({ 401: "credential_invalid", 403: "database_read_permission_missing", 404: "endpoint_contract_drift", 405: "endpoint_contract_drift", 429: "rate_limited_no_output", 500: "provider_unavailable_no_output" })[status] || "management_api_contract_drift";
}

export function parseCatalogCaptureArguments(argv) {
  const value = (flag) => valuesFor(flag, argv)[0];
  const parsed = { mode: value("--mode"), authorized: argv.includes("--authorized"), requestId: value("--request-id"), originMainSha: value("--origin-main-sha"), scope: value("--scope"), catalog: value("--catalog"), baseline: value("--baseline"), parityTest: value("--parity-test") };
  if (valuesFor("--token", argv).length || valuesFor("--project-ref", argv).length) fail("dashboard_free_tier_catalog_argv_secret_refused");
  if (!parsed.authorized || parsed.mode !== "execute") fail("dashboard_free_tier_catalog_approval_required");
  if (!REQUEST_ID.test(parsed.requestId || "") || !SHA40.test(parsed.originMainSha || "")) fail("dashboard_free_tier_catalog_arguments_invalid");
  return parsed;
}

function normalizeLedger(value) {
  if (!Array.isArray(value)) fail("management_api_contract_drift");
  const ledger = value.map((row) => {
    if (!exactKeys(row, ["name", "statements_sha256", "version"]) || !/^\d{14}$/u.test(row.version) || !/^[a-z0-9_]+$/u.test(row.name) || !SHA256.test(row.statements_sha256)) fail("management_api_contract_drift");
    return { version: row.version, name: row.name, statements_sha256: row.statements_sha256 };
  }).sort((left, right) => left.version.localeCompare(right.version));
  if (new Set(ledger.map((row) => row.version)).size !== ledger.length) fail("management_api_contract_drift");
  return ledger;
}

function normalizeCatalog(value, scope) {
  if (!Array.isArray(value)) fail("management_api_contract_drift");
  const allowed = new Set(scope.relations || []);
  const allowedFunctions = new Set(scope.functions || []);
  const allowedSchemas = new Set(scope.schemas || []);
  const allowedRoles = new Set(scope.roles || []);
  const forbidden = (scope.forbiddenTerms || []).map((term) => String(term).toLowerCase());
  const seen = new Set();
  return value.map((row) => {
    if (!exactKeys(row, ["definition", "identity", "objectKind", "schema"]) || typeof row.definition !== "string" || typeof row.identity !== "string" || typeof row.objectKind !== "string" || typeof row.schema !== "string") fail("management_api_contract_drift");
    const qualified = `${row.schema}.${row.identity}`;
    if (row.objectKind === "table" && !allowed.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "function" && !allowedFunctions.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "schema" && !allowedSchemas.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "role" && !allowedRoles.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (!OBJECT_ORDER.includes(row.objectKind) || forbidden.some((term) => row.definition.toLowerCase().includes(term))) fail("dashboard_free_tier_catalog_scope_drift");
    const key = `${row.objectKind}|${row.schema}|${row.identity}`;
    if (seen.has(key)) fail("management_api_contract_drift");
    seen.add(key);
    return { objectKind: row.objectKind, schema: row.schema, identity: row.identity, definition: row.definition.normalize("NFC") };
  }).sort((left, right) => (
    left.objectKind.localeCompare(right.objectKind) || left.schema.localeCompare(right.schema) || left.identity.localeCompare(right.identity)
  ));
}

function artifactSet({ payload, originMainSha, definitions }) {
  const ledger = normalizeLedger(payload.migrationLedger);
  const catalog = definitions.map(({ definition, ...entry }) => ({ ...entry, definitionSha256: sha256(definition) }));
  const normalized = {
    captureStatus: "reviewed", originMainSha, serverMajor: payload.serverMajor,
    migrationLedgerCount: ledger.length, migrationLedgerMaxVersion: ledger.at(-1)?.version || null,
    migrationLedgerSha256: sha256(canonical(ledger)), catalog,
  };
  const baseline = `${definitions.slice().sort((left, right) => OBJECT_ORDER.indexOf(left.objectKind) - OBJECT_ORDER.indexOf(right.objectKind) || left.schema.localeCompare(right.schema) || left.identity.localeCompare(right.identity)).map((entry) => `${entry.definition.trim()};`).join("\n")}\n`;
  const parity = `begin;\nselect plan(${catalog.length});\n${catalog.map((entry) => entry.objectKind === "table" ? `select has_table('${entry.schema}', '${entry.identity}', 'catalog table ${entry.schema}.${entry.identity}');` : `select pass('catalog ${entry.objectKind} ${entry.schema}.${entry.identity} is reviewed');`).join("\n")}\nselect * from finish();\nrollback;\n`;
  return { catalog: `${JSON.stringify(normalized, null, 2)}\n`, baseline, parity, normalized };
}

async function writeAtomic(files) {
  const staged = [];
  try {
    for (const [path, contents] of files) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.tmp-${process.pid}-${staged.length}`;
      await writeFile(temporary, contents, { mode: 0o600 });
      staged.push([temporary, path]);
    }
    for (const [temporary, path] of staged) await rename(temporary, path);
  } catch (error) {
    await Promise.all(staged.map(async ([temporary]) => { try { await import("node:fs/promises").then(({ rm }) => rm(temporary, { force: true })); } catch {} }));
    throw error;
  }
}

export async function captureDashboardFreeTierCatalog({ argv = process.argv.slice(2), env = process.env, root = ROOT, fetch = globalThis.fetch, gitOriginMainSha = async () => (await import("node:child_process")).execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(), log = () => {} } = {}) {
  if (argv.includes(env.SUPABASE_DATABASE_READ_TOKEN) || argv.includes(env.SUPABASE_PROJECT_REF)) fail("dashboard_free_tier_catalog_argv_secret_refused");
  const args = parseCatalogCaptureArguments(argv);
  if (typeof env.SUPABASE_DATABASE_READ_TOKEN !== "string" || !PROJECT_REF.test(env.SUPABASE_PROJECT_REF || "") || env.TASK_ORIGIN_MAIN_SHA !== args.originMainSha) fail("dashboard_free_tier_catalog_credentials_missing");
  if ((await gitOriginMainSha()) !== args.originMainSha) fail("dashboard_free_tier_catalog_origin_main_drift");
  const [contract, scope] = await Promise.all([readFile(safeRepoPath(root, args.scope), "utf8").then(JSON.parse), readFile(safeRepoPath(root, args.scope), "utf8").then(JSON.parse)]);
  // The contract has a fixed path in source; read it separately to avoid caller control.
  const readOnlyContract = JSON.parse(await readFile(resolve(root, "scripts/fixtures/supabase-management-read-only-query-contract.json"), "utf8"));
  if (readOnlyContract.method !== "POST" || readOnlyContract.pathTemplate !== "/v1/projects/{ref}/database/query/read-only" || readOnlyContract.successStatus !== 201 || readOnlyContract.oauthScope !== "database:read" || readOnlyContract.fineGrainedPermission !== "database_read") fail("management_api_contract_drift");
  void contract;
  const statementSha256 = sha256(FIXED_STATEMENT);
  log(JSON.stringify({ statementId: "dashboard_free_tier_catalog_v1", statementSha256 }));
  const response = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query/read-only`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${env.SUPABASE_DATABASE_READ_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: FIXED_STATEMENT, parameters: [] }) });
  if (response.status !== 201 || response.redirected) fail(classifyManagementApiFailure(response.status));
  let payload;
  try { payload = await response.json(); } catch { fail("management_api_contract_drift"); }
  if (!exactKeys(payload, ["catalog", "migrationLedger", "serverMajor"]) || !Number.isInteger(payload.serverMajor)) fail("management_api_contract_drift");
  const definitions = normalizeCatalog(payload.catalog, scope);
  const artifacts = artifactSet({ payload, originMainSha: args.originMainSha, definitions });
  const manifestPath = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.originMainSha = args.originMainSha;
  manifest.baselineSha256 = sha256(artifacts.baseline);
  manifest.catalogSha256 = sha256(artifacts.catalog);
  await writeAtomic([[safeRepoPath(root, args.catalog), artifacts.catalog], [safeRepoPath(root, args.baseline), artifacts.baseline], [safeRepoPath(root, args.parityTest), artifacts.parity], [manifestPath, `${JSON.stringify(manifest, null, 2)}\n`]]);
  return artifacts.normalized;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) captureDashboardFreeTierCatalog().then((result) => process.stdout.write(`${JSON.stringify({ captureStatus: result.captureStatus, statementId: "dashboard_free_tier_catalog_v1" })}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
