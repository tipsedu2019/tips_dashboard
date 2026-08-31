import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildDashboardFreeTierParitySql, buildFinalSchemaReconciliation,
  publishDashboardFreeTierCaptureSet,
} from "./capture-dashboard-free-tier-catalog.mjs";

const TARGETS = [
  "dashboard_notifications.dashboard_notifications_assistant_makeup_hard_deny",
  "makeup_notification_deliveries.makeup_notification_deliveries_assistant_hard_deny",
  "makeup_notification_settings.makeup_notification_settings_assistant_hard_deny",
  "makeup_request_events.makeup_request_events_assistant_hard_deny",
  "makeup_requests.makeup_requests_assistant_hard_deny",
  "science_consultation_rate_limits.No direct client access",
  "science_consultation_requests.No direct client access",
];
const ARTIFACT_PATHS = {
  catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
  baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql",
  parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
};
const BASE = "supabase/test-baselines";
const SHA256 = /^[a-f0-9]{64}$/u;
const STATEMENT = `begin read only;
set local statement_timeout = '8s';
with targets(schema_name, identity) as (
  values ${TARGETS.map((identity) => `('public', '${identity}')`).join(",\n    ")}
), policies as (
  select 'policy'::text object_kind, namespace.nspname schema_name,
    relation_row.relname || '.' || policy.polname identity,
    pg_catalog.jsonb_build_object(
      'command', policy.polcmd, 'permissive', policy.polpermissive,
      'roles', (select pg_catalog.jsonb_agg(
        case when role_entry.role_oid = 0 then 'public' else pg_catalog.pg_get_userbyid(role_entry.role_oid) end
        order by role_entry.ordinality
      ) from unnest(policy.polroles) with ordinality role_entry(role_oid, ordinality)),
      'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      'check', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    )::text fingerprint
  from pg_catalog.pg_policy policy
  join pg_catalog.pg_class relation_row on relation_row.oid = policy.polrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  join targets on targets.schema_name = namespace.nspname
    and targets.identity = relation_row.relname || '.' || policy.polname
)
select pg_catalog.jsonb_build_object(
  'version', 1,
  'transactionReadOnly', pg_catalog.current_setting('transaction_read_only') = 'on',
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'capturedAt', pg_catalog.clock_timestamp(),
  'policies', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'objectKind', policies.object_kind, 'schema', policies.schema_name,
    'identity', policies.identity, 'fingerprint', policies.fingerprint
  ) order by policies.identity) from policies), '[]'::jsonb)
);
rollback;`;

export function dashboardFreeTierPolicyModeStatement() { return STATEMENT; }

function fail(code) { throw new Error(`dashboard_policy_mode_repair_${code}`); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}
function parse(source) {
  try { return JSON.parse(source); } catch { fail("malformed_input"); }
}
async function sourceFile(root, path) {
  try {
    const target = join(root, path);
    if (!(await lstat(target)).isFile()) fail("source_invalid");
    const bytes = await readFile(target);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) fail("source_invalid");
    return text;
  } catch { fail("source_invalid"); }
}
function validateManifest(manifest) {
  if (!manifest || manifest.baselineVersion !== "dashboard-free-tier-v1"
    || !/^[a-f0-9]{40}$/u.test(manifest.originMainSha || "")
    || !SHA256.test(manifest.baselineSha256 || "") || !SHA256.test(manifest.catalogSha256 || "")
    || !Array.isArray(manifest.requiredObjectSignatures) || !Array.isArray(manifest.orderedNewMigrations)) fail("manifest_invalid");
  let previous = "";
  for (const migration of manifest.orderedNewMigrations) {
    if (!exactKeys(migration, ["fileName", "status", "sha256"])
      || !/^\d{14}_[a-z0-9_]+\.sql$/u.test(migration.fileName)
      || migration.status !== "final" || !SHA256.test(migration.sha256 || "")
      || migration.fileName.slice(0, 14) <= previous) fail("manifest_not_final");
    previous = migration.fileName.slice(0, 14);
  }
}
function validateEnvelope(envelope) {
  if (!exactKeys(envelope, ["version", "transport", "statementSha256", "result"])
    || envelope.version !== 1 || envelope.transport !== "supabase-mcp"
    || envelope.statementSha256 !== sha256(STATEMENT)) fail("envelope_invalid");
  const result = envelope.result;
  if (!exactKeys(result, ["version", "transactionReadOnly", "serverMajor", "capturedAt", "policies"])
    || result.version !== 1 || result.transactionReadOnly !== true || result.serverMajor !== 17
    || typeof result.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result.capturedAt)
    || !Number.isFinite(Date.parse(result.capturedAt)) || !Array.isArray(result.policies)
    || result.policies.length !== TARGETS.length) fail("envelope_invalid");
  const seen = new Set();
  return result.policies.map((row) => {
    if (!exactKeys(row, ["objectKind", "schema", "identity", "fingerprint"])
      || row.objectKind !== "policy" || row.schema !== "public" || !TARGETS.includes(row.identity)
      || seen.has(row.identity) || typeof row.fingerprint !== "string") fail("targets_invalid");
    seen.add(row.identity);
    const fingerprint = parse(row.fingerprint);
    if (!exactKeys(fingerprint, ["command", "roles", "using", "check", "permissive"])
      || fingerprint.permissive !== false || !["*", "r", "a", "w", "d"].includes(fingerprint.command)
      || !Array.isArray(fingerprint.roles) || !fingerprint.roles.length
      || !fingerprint.roles.every((role) => typeof role === "string" && /^[a-z_][a-z0-9_]*$/u.test(role))
      || new Set(fingerprint.roles).size !== fingerprint.roles.length
      || ![fingerprint.using, fingerprint.check].every((predicate) => predicate === null || (typeof predicate === "string" && predicate === predicate.normalize("NFC")))) fail("fingerprint_invalid");
    // PostgreSQL JSONB text orders these keys by byte length, then bytes.
    // Match the original producer's semantic role normalization byte-for-byte.
    const modeFree = `{"check": ${JSON.stringify(fingerprint.check)}, "roles": [${fingerprint.roles.map((role) => JSON.stringify(role)).join(", ")}], "using": ${JSON.stringify(fingerprint.using)}, "command": ${JSON.stringify(fingerprint.command)}}`;
    return { objectKind: "policy", schema: "public", identity: row.identity,
      legacySha256: sha256(modeFree), replayFingerprint: `${modeFree.slice(0, -1)}, "permissive": false}` };
  });
}

export async function repairDashboardFreeTierPolicyModes({ root, authorized, requestId, expectedCaptureId, envelope, publish } = {}) {
  if (authorized !== true) fail("approval_required");
  if (typeof root !== "string" || !/^[a-z0-9][a-z0-9-]{7,127}$/u.test(requestId || "")
    || !/^[a-f0-9]{16}$/u.test(expectedCaptureId || "")) fail("arguments_invalid");
  const definitions = validateEnvelope(envelope);
  const pointer = parse(await sourceFile(root, `${BASE}/dashboard-free-tier-v1.active.json`));
  if (!exactKeys(pointer, ["captureSetVersion", "captureId", "artifactPaths"])
    || pointer.captureSetVersion !== 1 || pointer.captureId !== expectedCaptureId
    || canonical(pointer.artifactPaths) !== canonical(ARTIFACT_PATHS)) fail("source_drift");
  const captureBase = `${BASE}/dashboard-free-tier-v1-captures/${expectedCaptureId}`;
  const [baseline, catalogText, parity, captureManifestText, manifestText] = await Promise.all([
    sourceFile(root, `${captureBase}/baseline.sql`), sourceFile(root, `${captureBase}/catalog.json`),
    sourceFile(root, `${captureBase}/parity.sql`), sourceFile(root, `${captureBase}/manifest.json`),
    sourceFile(root, `${BASE}/dashboard-free-tier-v1.manifest.json`),
  ]);
  const captureManifest = parse(captureManifestText);
  const manifest = parse(manifestText);
  validateManifest(captureManifest);
  validateManifest(manifest);
  if (sha256(canonical({ baseline, catalog: catalogText, manifest: captureManifest, parity })).slice(0, 16) !== expectedCaptureId
    || captureManifest.baselineSha256 !== sha256(baseline) || captureManifest.catalogSha256 !== sha256(catalogText)) fail("source_drift");
  const metadata = (value) => { const rest = { ...value }; delete rest.orderedNewMigrations; return rest; };
  if (canonical(metadata(manifest)) !== canonical(metadata(captureManifest))
    || canonical(manifest.orderedNewMigrations.slice(0, captureManifest.orderedNewMigrations.length)) !== canonical(captureManifest.orderedNewMigrations)) fail("manifest_drift");
  for (const [key, text] of Object.entries({ baseline, catalog: catalogText, parityTest: parity })) {
    if (await sourceFile(root, ARTIFACT_PATHS[key]) !== text) fail("source_drift");
  }
  for (const migration of manifest.orderedNewMigrations) {
    if (sha256(await sourceFile(root, `supabase/migrations/${migration.fileName}`)) !== migration.sha256) fail("migration_drift");
  }
  const source = parse(catalogText);
  if (source.captureStatus !== "reviewed" || source.serverMajor !== 17 || source.originMainSha !== manifest.originMainSha || !Array.isArray(source.catalog)
    || !Array.isArray(source.migrationLedger) || source.migrationLedgerSha256 !== sha256(canonical(source.migrationLedger))) fail("source_invalid");
  const replacement = new Map();
  for (const definition of definitions) {
    const matches = source.catalog.filter((row) => row.objectKind === "policy" && row.schema === "public" && row.identity === definition.identity);
    if (matches.length !== 1 || Object.hasOwn(matches[0], "policyFingerprintVersion") || matches[0].definitionSha256 !== definition.legacySha256) fail("policy_drift");
    replacement.set(definition.identity, { ...matches[0], definitionSha256: sha256(definition.replayFingerprint), policyFingerprintVersion: 2 });
  }
  const catalog = { ...source,
    catalog: source.catalog.map((row) => row.objectKind === "policy" && row.schema === "public" && replacement.has(row.identity) ? replacement.get(row.identity) : row),
    policyModeRepair: { version: 1, kind: "policy-mode-only-derived-capture", requestId,
      sourceCaptureId: expectedCaptureId, sourceCatalogSha256: sha256(catalogText), sourceBaselineSha256: sha256(baseline),
      statementSha256: envelope.statementSha256, snapshotSha256: sha256(canonical(envelope.result)), capturedAt: envelope.result.capturedAt,
      targets: TARGETS.map((identity) => `public.${identity}`) },
  };
  const artifacts = { baseline: `${baseline}\n-- Policy-mode-only repair; not a fresh whole-schema capture.\n${buildFinalSchemaReconciliation(definitions)}`,
    catalog: `${JSON.stringify(catalog, null, 2)}\n`, parity: buildDashboardFreeTierParitySql(catalog.catalog) };
  const nextManifest = { ...manifest, baselineSha256: sha256(artifacts.baseline), catalogSha256: sha256(artifacts.catalog) };
  try {
    const result = await publishDashboardFreeTierCaptureSet({ root, artifacts, manifest: nextManifest, artifactPaths: ARTIFACT_PATHS, publishManifest: true, publish });
    return { captureId: result.captureId, sourceCaptureId: expectedCaptureId, repairedPolicyCount: TARGETS.length };
  } catch (error) {
    if (error instanceof AggregateError && error.message === "dashboard_free_tier_catalog_publication_and_rollback_failed") fail("publication_and_rollback_failed");
    fail("publication_failed");
  }
}
