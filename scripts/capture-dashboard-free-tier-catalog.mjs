import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
const FIXED_STATEMENT = `begin read only;
with migration_ledger as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', migration_row.version, 'name', migration_row.name,
    'statements_sha256', migration_row.statements_sha256
  ) order by migration_row.version), '[]'::jsonb) as entries
  from supabase_migrations.schema_migrations as migration_row
), allowed_relations(schema_name, relation_name) as (
  values
    ('auth', 'users'),
    ('public', 'academic_event_exam_details'), ('public', 'academic_events'), ('public', 'academic_schools'),
    ('public', 'class_groups'), ('public', 'class_group_members'), ('public', 'class_lesson_sessions'), ('public', 'class_terms'), ('public', 'classes'),
    ('public', 'ops_registration_appointment_calendar'), ('public', 'ops_tasks'), ('public', 'progress_logs'), ('public', 'profiles'), ('public', 'students'), ('public', 'textbooks')
), scoped_catalog as (
  select 'role'::text object_kind, ''::text schema_name, role_row.rolname identity,
    pg_catalog.jsonb_build_object('login', role_row.rolcanlogin, 'inherit', role_row.rolinherit, 'superuser', role_row.rolsuper) fingerprint
  from pg_catalog.pg_roles role_row where role_row.rolname in ('anon', 'authenticated', 'postgres', 'service_role')
  union all select 'schema', '', namespace.nspname, pg_catalog.jsonb_build_object('acl', namespace.nspacl)
  from pg_catalog.pg_namespace namespace where namespace.nspname in ('auth', 'dashboard_private', 'extensions', 'public', 'supabase_migrations')
  union all select 'type', namespace.nspname, type_row.typname, pg_catalog.jsonb_build_object('type', pg_catalog.format_type(type_row.oid, null), 'labels', labels.labels)
  from pg_catalog.pg_type type_row join pg_catalog.pg_namespace namespace on namespace.oid = type_row.typnamespace
  left join lateral (select pg_catalog.jsonb_agg(enum.enumlabel order by enum.enumsortorder) labels from pg_catalog.pg_enum enum where enum.enumtypid = type_row.oid) labels on true
  where (namespace.nspname, type_row.typname) in (('public','academic_event_type'),('public','class_status'),('public','user_role'))
  union all select 'sequence', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('acl', relation_row.relacl)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  where relation_row.relkind = 'S' and (namespace.nspname, relation_row.relname) in (('public', 'classes_id_seq'))
  union all select 'table', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('columns', columns.columns, 'acl', relation_row.relacl)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  join lateral (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', attribute.attname, 'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), 'notNull', attribute.attnotnull) order by attribute.attnum) columns from pg_catalog.pg_attribute attribute where attribute.attrelid = relation_row.oid and attribute.attnum > 0 and not attribute.attisdropped) columns on true
  where relation_row.relkind in ('r','p')
  union all select 'default', namespace.nspname, relation_row.relname || '.' || attribute.attname, pg_catalog.jsonb_build_object('expression', pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid))
  from pg_catalog.pg_attrdef default_row join pg_catalog.pg_attribute attribute on attribute.attrelid = default_row.adrelid and attribute.attnum = default_row.adnum join pg_catalog.pg_class relation_row on relation_row.oid = default_row.adrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'constraint', namespace.nspname, relation_row.relname || '.' || constraint_row.conname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
  from pg_catalog.pg_constraint constraint_row join pg_catalog.pg_class relation_row on relation_row.oid = constraint_row.conrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'index', namespace.nspname, index_row.relname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_indexdef(index_row.oid))
  from pg_catalog.pg_index catalog_index join pg_catalog.pg_class index_row on index_row.oid = catalog_index.indexrelid join pg_catalog.pg_class table_row on table_row.oid = catalog_index.indrelid join pg_catalog.pg_namespace namespace on namespace.oid = index_row.relnamespace join pg_catalog.pg_namespace table_namespace on table_namespace.oid = table_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (table_namespace.nspname, table_row.relname)
  union all select 'function', namespace.nspname, procedure.proname || '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')', pg_catalog.jsonb_build_object('signature', pg_catalog.pg_get_function_identity_arguments(procedure.oid), 'bodyHash', dashboard_private.continuous_class_schedule_hash_v1(pg_catalog.to_jsonb(pg_catalog.pg_get_functiondef(procedure.oid))), 'owner', pg_catalog.pg_get_userbyid(procedure.proowner), 'securityDefiner', procedure.prosecdef, 'searchPath', procedure.proconfig, 'acl', procedure.proacl)
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace where (namespace.nspname, procedure.proname || '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')') in (('public', 'get_dashboard_conflict_sources_v1(date, date)'), ('public', 'get_dashboard_summary_sources_v1()'), ('public', 'list_dashboard_class_session_dates_v1(date, date)'))
  union all select 'rls', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('enabled', relation_row.relrowsecurity, 'forced', relation_row.relforcerowsecurity)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname) where relation_row.relkind in ('r','p')
  union all select 'policy', namespace.nspname, relation_row.relname || '.' || policy.polname, pg_catalog.jsonb_build_object('command', policy.polcmd, 'roles', policy.polroles, 'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), 'check', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid))
  from pg_catalog.pg_policy policy join pg_catalog.pg_class relation_row on relation_row.oid = policy.polrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'grant', namespace.nspname, relation_row.relname || '.' || grant_row.grantee::text, pg_catalog.jsonb_build_object('acl', relation_row.relacl, 'expanded', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee', acl.grantee, 'privilege', acl.privilege_type) order by acl.grantee, acl.privilege_type) from pg_catalog.aclexplode(relation_row.relacl) acl))
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname) join lateral (select distinct acl.grantee from pg_catalog.aclexplode(relation_row.relacl) acl) grant_row on true
  union all select 'grant', pg_catalog.coalesce(namespace.nspname, ''), 'default.' || owner.rolname || '.' || pg_catalog.coalesce(namespace.nspname, '') || '.' || default_acl.defaclobjtype, pg_catalog.jsonb_build_object('acl', default_acl.defaclacl, 'owner', owner.rolname, 'schema', namespace.nspname, 'objectType', default_acl.defaclobjtype)
  from pg_catalog.pg_default_acl default_acl join pg_catalog.pg_roles owner on owner.oid = default_acl.defaclrole left join pg_catalog.pg_namespace namespace on namespace.oid = default_acl.defaclnamespace where pg_catalog.coalesce(namespace.nspname, '') in ('', 'auth', 'dashboard_private', 'extensions', 'public', 'supabase_migrations')
  union all select 'trigger', namespace.nspname, relation_row.relname || '.' || case when trigger_row.tgtype & 2 = 2 then 'before' else 'after' end || '.' || trigger_row.tgname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true), 'function', trigger_row.tgfoid::regprocedure::text, 'order', row_number() over (partition by trigger_row.tgrelid, trigger_row.tgtype order by trigger_row.oid))
  from pg_catalog.pg_trigger trigger_row join pg_catalog.pg_class relation_row on relation_row.oid = trigger_row.tgrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname) where not trigger_row.tgisinternal
)
select pg_catalog.jsonb_build_object(
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'migrationLedger', migration_ledger.entries,
  'catalog', pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('objectKind', scoped_catalog.object_kind, 'schema', scoped_catalog.schema_name, 'identity', scoped_catalog.identity, 'definitionSha256', dashboard_private.continuous_class_schedule_hash_v1(scoped_catalog.fingerprint)) order by scoped_catalog.object_kind, scoped_catalog.schema_name, scoped_catalog.identity), '[]'::jsonb)
) from migration_ledger cross join scoped_catalog;
rollback;`;

export function dashboardFreeTierCatalogStatement() { return FIXED_STATEMENT; }

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

function assertCanonicalArtifactPaths(args) {
  const canonicalPaths = {
    catalog: "supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json",
    baseline: "supabase/test-baselines/dashboard-free-tier-v1.sql",
    parityTest: "supabase/tests/dashboard_free_tier_catalog_parity_test.sql",
  };
  for (const [key, expected] of Object.entries(canonicalPaths)) {
    if (args[key] !== expected) fail("dashboard_free_tier_catalog_output_path_invalid");
  }
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
  const normalized = value.map((row) => {
    const rawDefinition = typeof row.definition === "string" ? row.definition : null;
    const hash = typeof row.definitionSha256 === "string" ? row.definitionSha256 : rawDefinition ? sha256(rawDefinition) : null;
    if (!row || typeof row.identity !== "string" || typeof row.objectKind !== "string" || typeof row.schema !== "string" || !SHA256.test(hash || "")) fail("management_api_contract_drift");
    const qualified = `${row.schema}.${row.identity}`;
    if (row.objectKind === "table" && !allowed.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "function" && !allowedFunctions.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "schema" && !allowedSchemas.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "role" && !allowedRoles.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (!OBJECT_ORDER.includes(row.objectKind) || (rawDefinition && forbidden.some((term) => rawDefinition.toLowerCase().includes(term)))) fail("dashboard_free_tier_catalog_scope_drift");
    const key = `${row.objectKind}|${row.schema}|${row.identity}`;
    if (seen.has(key)) fail("management_api_contract_drift");
    seen.add(key);
    return { objectKind: row.objectKind, schema: row.schema, identity: row.identity, definition: rawDefinition?.normalize("NFC") || null, definitionSha256: hash, metadata: row.metadata || null };
  }).sort((left, right) => (
    left.objectKind.localeCompare(right.objectKind) || left.schema.localeCompare(right.schema) || left.identity.localeCompare(right.identity)
  ));
  for (const kind of scope.requiredKinds || []) {
    if (!normalized.some((entry) => entry.objectKind === kind)) fail("dashboard_free_tier_catalog_incomplete");
  }
  const requireIdentity = (kind, identities) => {
    for (const identity of identities) {
      if (!normalized.some((entry) => entry.objectKind === kind && (
        kind === "schema" || kind === "role" ? entry.identity === identity : `${entry.schema}.${entry.identity}` === identity
      ))) fail("dashboard_free_tier_catalog_incomplete");
    }
  };
  requireIdentity("table", scope.relations || []);
  requireIdentity("sequence", scope.sequences || []);
  requireIdentity("type", scope.types || []);
  requireIdentity("function", scope.functions || []);
  requireIdentity("schema", scope.schemas || []);
  requireIdentity("role", scope.roles || []);
  for (const table of scope.triggerTables || []) {
    const [schema, relation] = table.split(".");
    if (!normalized.some((entry) => entry.objectKind === "trigger" && entry.schema === schema && (entry.definition?.includes(table) || entry.identity.startsWith(`${relation}.`)))) fail("dashboard_free_tier_catalog_incomplete");
  }
  return normalized;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
export function dashboardFreeTierCatalogFingerprintSql(entry) {
  const schema = sqlLiteral(entry.schema);
  const identity = sqlLiteral(entry.identity);
  if (entry.objectKind === "function") return `(select pg_catalog.jsonb_build_object('signature', pg_catalog.pg_get_function_identity_arguments(procedure.oid), 'bodyHash', dashboard_private.continuous_class_schedule_hash_v1(pg_catalog.to_jsonb(pg_catalog.pg_get_functiondef(procedure.oid))), 'owner', pg_catalog.pg_get_userbyid(procedure.proowner), 'securityDefiner', procedure.prosecdef, 'searchPath', procedure.proconfig, 'acl', procedure.proacl) from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace ns on ns.oid = procedure.pronamespace where ns.nspname = ${schema} and (procedure.proname || '(' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')') = ${identity})`;
  if (entry.objectKind === "constraint") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(con.oid, true)) from pg_catalog.pg_constraint con join pg_catalog.pg_class rel on rel.oid = con.conrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || con.conname) = ${identity})`;
  if (entry.objectKind === "index") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_indexdef(rel.oid)) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity})`;
  if (entry.objectKind === "trigger") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_triggerdef(trg.oid, true), 'function', trg.tgfoid::regprocedure::text, 'order', row_number() over (partition by trg.tgrelid, trg.tgtype order by trg.oid)) from pg_catalog.pg_trigger trg join pg_catalog.pg_class rel on rel.oid = trg.tgrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where not trg.tgisinternal and ns.nspname = ${schema} and (rel.relname || '.' || case when trg.tgtype & 2 = 2 then 'before' else 'after' end || '.' || trg.tgname) = ${identity})`;
  if (entry.objectKind === "policy") return `(select pg_catalog.jsonb_build_object('command', pol.polcmd, 'roles', pol.polroles, 'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)) from pg_catalog.pg_policy pol join pg_catalog.pg_class rel on rel.oid = pol.polrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || pol.polname) = ${identity})`;
  if (entry.objectKind === "role") return `(select pg_catalog.jsonb_build_object('login', rolcanlogin, 'inherit', rolinherit, 'superuser', rolsuper) from pg_catalog.pg_roles where rolname = ${identity})`;
  if (entry.objectKind === "grant" && entry.identity.startsWith("default.")) return `(select pg_catalog.jsonb_build_object('acl', default_acl.defaclacl, 'owner', owner.rolname, 'schema', ns.nspname, 'objectType', default_acl.defaclobjtype) from pg_catalog.pg_default_acl default_acl join pg_catalog.pg_roles owner on owner.oid = default_acl.defaclrole left join pg_catalog.pg_namespace ns on ns.oid = default_acl.defaclnamespace where ('default.' || owner.rolname || '.' || pg_catalog.coalesce(ns.nspname, '') || '.' || default_acl.defaclobjtype) = ${identity})`;
  if (entry.objectKind === "grant") return `(select pg_catalog.jsonb_build_object('acl', rel.relacl, 'expanded', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee', acl.grantee, 'privilege', acl.privilege_type) order by acl.grantee, acl.privilege_type) from pg_catalog.aclexplode(rel.relacl) acl)) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || (split_part(${identity}, '.', 2))) = ${identity})`;
  if (entry.objectKind === "rls") return `(select pg_catalog.jsonb_build_object('enabled', rel.relrowsecurity, 'forced', rel.relforcerowsecurity) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity})`;
  if (entry.objectKind === "schema") return `(select pg_catalog.jsonb_build_object('acl', nspacl) from pg_catalog.pg_namespace where nspname = ${identity})`;
  if (entry.objectKind === "type") return `(select pg_catalog.jsonb_build_object('type', pg_catalog.format_type(type_row.oid, null), 'labels', labels.labels) from pg_catalog.pg_type type_row join pg_catalog.pg_namespace ns on ns.oid = type_row.typnamespace left join lateral (select pg_catalog.jsonb_agg(enum.enumlabel order by enum.enumsortorder) labels from pg_catalog.pg_enum enum where enum.enumtypid = type_row.oid) labels on true where ns.nspname = ${schema} and type_row.typname = ${identity})`;
  if (entry.objectKind === "default") return `(select pg_catalog.jsonb_build_object('expression', pg_catalog.pg_get_expr(def.adbin, def.adrelid)) from pg_catalog.pg_attrdef def join pg_catalog.pg_class rel on rel.oid = def.adrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace join pg_catalog.pg_attribute attr on attr.attrelid = rel.oid and attr.attnum = def.adnum where ns.nspname = ${schema} and (rel.relname || '.' || attr.attname) = ${identity})`;
  if (entry.objectKind === "table") return `(select pg_catalog.jsonb_build_object('columns', columns.columns, 'acl', rel.relacl) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace join lateral (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', attr.attname, 'type', pg_catalog.format_type(attr.atttypid, attr.atttypmod), 'notNull', attr.attnotnull) order by attr.attnum) columns from pg_catalog.pg_attribute attr where attr.attrelid = rel.oid and attr.attnum > 0 and not attr.attisdropped) columns on true where ns.nspname = ${schema} and rel.relname = ${identity} and rel.relkind in ('r','p'))`;
  if (entry.objectKind === "sequence") return `(select pg_catalog.jsonb_build_object('acl', rel.relacl) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity} and rel.relkind = 'S')`;
  return `(select pg_catalog.to_jsonb(${schema} || '.' || ${identity}))`;
}
export function buildDashboardFreeTierParitySql(catalog) {
  const rows = catalog.map((entry) => `select is(dashboard_private.continuous_class_schedule_hash_v1(${dashboardFreeTierCatalogFingerprintSql(entry)}), ${sqlLiteral(entry.definitionSha256)}, ${sqlLiteral(`catalog ${entry.objectKind} ${entry.schema}.${entry.identity} fingerprint`) });`).join("\n");
  return `begin;\nselect plan(${catalog.length});\n${rows}\nselect * from finish();\nrollback;\n`;
}

function artifactSet({ payload, originMainSha, definitions }) {
  const ledger = normalizeLedger(payload.migrationLedger);
  const catalog = definitions.map(({ definition, metadata, ...entry }) => entry);
  const normalized = {
    captureStatus: "reviewed", originMainSha, serverMajor: payload.serverMajor,
    migrationLedgerCount: ledger.length, migrationLedgerMaxVersion: ledger.at(-1)?.version || null,
    migrationLedgerSha256: sha256(canonical(ledger)), catalog,
  };
  const baseline = `${definitions.filter((entry) => entry.definition).slice().sort((left, right) => OBJECT_ORDER.indexOf(left.objectKind) - OBJECT_ORDER.indexOf(right.objectKind) || left.schema.localeCompare(right.schema) || left.identity.localeCompare(right.identity)).map((entry) => `${entry.definition.trim()};`).join("\n")}\n`;
  const parity = buildDashboardFreeTierParitySql(catalog);
  return { catalog: `${JSON.stringify(normalized, null, 2)}\n`, baseline, parity, normalized };
}

async function publishCapture({ root, artifacts, manifest, publish }) {
  const captures = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1-captures");
  const captureId = sha256(artifacts.catalog).slice(0, 16);
  const stage = join(captures, `.stage-${captureId}-${process.pid}`);
  const active = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json");
  const final = join(captures, captureId);
  try {
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await writeFile(join(stage, "catalog.json"), artifacts.catalog, { mode: 0o600 });
    await writeFile(join(stage, "baseline.sql"), artifacts.baseline, { mode: 0o600 });
    await writeFile(join(stage, "parity.sql"), artifacts.parity, { mode: 0o600 });
    await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await publish({ stage, final, active, captureId });
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function captureDashboardFreeTierCatalog({ argv = process.argv.slice(2), env = process.env, root = ROOT, fetch = globalThis.fetch, gitOriginMainSha = async () => (await import("node:child_process")).execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(), log = () => {}, afterStageRename = async () => {}, publish = async ({ stage, final, active, captureId }) => { await mkdir(dirname(final), { recursive: true, mode: 0o700 }); await rename(stage, final); await afterStageRename({ final, active, captureId }); const pointer = `${active}.tmp-${process.pid}`; await writeFile(pointer, `${JSON.stringify({ captureId })}\n`, { mode: 0o600 }); await rename(pointer, active); } } = {}) {
  if (argv.includes(env.SUPABASE_DATABASE_READ_TOKEN) || argv.includes(env.SUPABASE_PROJECT_REF)) fail("dashboard_free_tier_catalog_argv_secret_refused");
  const args = parseCatalogCaptureArguments(argv);
  assertCanonicalArtifactPaths(args);
  if (typeof env.SUPABASE_DATABASE_READ_TOKEN !== "string" || !PROJECT_REF.test(env.SUPABASE_PROJECT_REF || "") || env.TASK_ORIGIN_MAIN_SHA !== args.originMainSha) fail("dashboard_free_tier_catalog_credentials_missing");
  if ((await gitOriginMainSha()) !== args.originMainSha) fail("dashboard_free_tier_catalog_origin_main_drift");
  const scope = await readFile(safeRepoPath(root, args.scope), "utf8").then(JSON.parse);
  // The contract has a fixed path in source; read it separately to avoid caller control.
  const readOnlyContract = JSON.parse(await readFile(resolve(root, "scripts/fixtures/supabase-management-read-only-query-contract.json"), "utf8"));
  if (readOnlyContract.method !== "POST" || readOnlyContract.pathTemplate !== "/v1/projects/{ref}/database/query/read-only" || readOnlyContract.successStatus !== 201 || readOnlyContract.oauthScope !== "database:read" || readOnlyContract.fineGrainedPermission !== "database_read") fail("management_api_contract_drift");
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
  await publishCapture({ root, artifacts, manifest, publish });
  return artifacts.normalized;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) captureDashboardFreeTierCatalog().then((result) => process.stdout.write(`${JSON.stringify({ captureStatus: result.captureStatus, statementId: "dashboard_free_tier_catalog_v1" })}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
