import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const OBJECT_ORDER = ["role", "schema", "type", "collation", "sequence", "table", "view", "default", "constraint", "index", "function", "rls", "policy", "grant", "trigger"];

// `digest` belongs to pgcrypto's extension schema, which differs by project. The
// server statement therefore only reads a single MVCC snapshot; SHA-256 is
// calculated by this producer from its canonical JSON representation.
const FIXED_STATEMENT = `begin read only;
with migration_ledger as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'version', migration_row.version, 'statements', migration_row.statements,
    'name', migration_row.name
  ) order by migration_row.version), '[]'::jsonb) as entries
  from supabase_migrations.schema_migrations as migration_row
), allowed_relations(schema_name, relation_name) as (
  select 'auth'::text, 'users'::text
  union all
  select namespace.nspname, relation_row.relname
  from pg_catalog.pg_class relation_row
  join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  where namespace.nspname = 'public'
    and relation_row.relkind in ('r', 'p', 'v')
), trigger_catalog as (
  select namespace.nspname schema_name, relation_row.relname relation_name, trigger_row.*,
    case when trigger_row.tgtype & 2 = 2 then 'before' else 'after' end timing_name,
    trigger_event.event_name,
    row_number() over (
      partition by trigger_row.tgrelid,
        case when trigger_row.tgtype & 2 = 2 then 'before' else 'after' end,
        trigger_event.event_name
      order by trigger_row.tgname
    ) fire_order
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation_row on relation_row.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  cross join lateral (values (4, 'insert'), (8, 'delete'), (16, 'update'), (32, 'truncate')) trigger_event(event_bit, event_name)
  where not trigger_row.tgisinternal
    and trigger_row.tgtype & trigger_event.event_bit = trigger_event.event_bit
), scoped_catalog as (
  select 'role'::text object_kind, ''::text schema_name, role_row.rolname::text identity,
    pg_catalog.jsonb_build_object('login', role_row.rolcanlogin, 'inherit', role_row.rolinherit, 'superuser', role_row.rolsuper) fingerprint
  from pg_catalog.pg_roles role_row where role_row.rolname in ('anon', 'authenticated', 'dashboard_audit_writer_v2', 'postgres', 'service_role')
  union all select 'schema', '', namespace.nspname, pg_catalog.jsonb_build_object('acl', namespace.nspacl)
  from pg_catalog.pg_namespace namespace where namespace.nspname in ('auth', 'dashboard_private', 'extensions', 'public', 'supabase_migrations')
  union all select 'type', namespace.nspname, type_row.typname, pg_catalog.jsonb_build_object('type', pg_catalog.format_type(type_row.oid, null), 'labels', labels.labels)
  from pg_catalog.pg_type type_row join pg_catalog.pg_namespace namespace on namespace.oid = type_row.typnamespace
  left join lateral (select pg_catalog.jsonb_agg(enum.enumlabel order by enum.enumsortorder) labels from pg_catalog.pg_enum enum where enum.enumtypid = type_row.oid) labels on true
  where namespace.nspname = 'public'
    and type_row.typtype = 'e'
  union all select 'sequence', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('acl', relation_row.relacl)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  where relation_row.relkind = 'S' and (namespace.nspname, relation_row.relname) in (('public', 'classes_id_seq'))
  union all select 'table', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('columns', columns.columns, 'acl', relation_row.relacl)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  join lateral (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', attribute.attname, 'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), 'notNull', attribute.attnotnull) order by attribute.attname) columns from pg_catalog.pg_attribute attribute where attribute.attrelid = relation_row.oid and attribute.attnum > 0 and not attribute.attisdropped) columns on true
  where relation_row.relkind in ('r','p')
  union all select 'view', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object(
    'definition', pg_catalog.pg_get_viewdef(relation_row.oid, true),
    'options', relation_row.reloptions,
    'acl', relation_row.relacl
  )
  from pg_catalog.pg_class relation_row
  join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace
  join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  where relation_row.relkind = 'v'
  union all select 'default', namespace.nspname, relation_row.relname || '.' || attribute.attname, pg_catalog.jsonb_build_object('expression', pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid), 'generated', attribute.attgenerated)
  from pg_catalog.pg_attrdef default_row join pg_catalog.pg_attribute attribute on attribute.attrelid = default_row.adrelid and attribute.attnum = default_row.adnum join pg_catalog.pg_class relation_row on relation_row.oid = default_row.adrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'constraint', namespace.nspname, relation_row.relname || '.' || constraint_row.conname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
  from pg_catalog.pg_constraint constraint_row join pg_catalog.pg_class relation_row on relation_row.oid = constraint_row.conrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'index', namespace.nspname, index_row.relname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_indexdef(index_row.oid))
  from pg_catalog.pg_index catalog_index join pg_catalog.pg_class index_row on index_row.oid = catalog_index.indexrelid join pg_catalog.pg_class table_row on table_row.oid = catalog_index.indrelid join pg_catalog.pg_namespace namespace on namespace.oid = index_row.relnamespace join pg_catalog.pg_namespace table_namespace on table_namespace.oid = table_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (table_namespace.nspname, table_row.relname)
  union all select 'function', namespace.nspname, procedure.proname || '(' || arguments.signature || ')', pg_catalog.jsonb_build_object('signature', arguments.signature, 'body', pg_catalog.pg_get_functiondef(procedure.oid), 'owner', pg_catalog.pg_get_userbyid(procedure.proowner), 'securityDefiner', procedure.prosecdef, 'searchPath', procedure.proconfig, 'acl', procedure.proacl)
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral (select coalesce(pg_catalog.string_agg(pg_catalog.format_type(argument_oid, null), ',' order by ordinality), '') signature from unnest(procedure.proargtypes::oid[]) with ordinality as argument(argument_oid, ordinality)) arguments
  where (namespace.nspname, procedure.proname || '(' || arguments.signature || ')') in (('public', 'get_dashboard_conflict_sources_v1(date,date)'), ('public', 'get_dashboard_summary_sources_v1()'), ('public', 'list_dashboard_class_session_dates_v1(date,date)'))
  union all select 'rls', namespace.nspname, relation_row.relname, pg_catalog.jsonb_build_object('enabled', relation_row.relrowsecurity, 'forced', relation_row.relforcerowsecurity)
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname) where relation_row.relkind in ('r','p')
  union all select 'policy', namespace.nspname, relation_row.relname || '.' || policy.polname, pg_catalog.jsonb_build_object('command', policy.polcmd, 'permissive', policy.polpermissive, 'roles', (select pg_catalog.jsonb_agg(case when role_entry.role_oid = 0 then 'public' else pg_catalog.pg_get_userbyid(role_entry.role_oid) end order by role_entry.ordinality) from unnest(policy.polroles) with ordinality role_entry(role_oid, ordinality)), 'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), 'check', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid))
  from pg_catalog.pg_policy policy join pg_catalog.pg_class relation_row on relation_row.oid = policy.polrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname)
  union all select 'grant', namespace.nspname, relation_row.relname || '.' || grant_row.grantee::text, pg_catalog.jsonb_build_object('acl', relation_row.relacl, 'expanded', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee', acl.grantee, 'privilege', acl.privilege_type) order by acl.grantee, acl.privilege_type) from pg_catalog.aclexplode(relation_row.relacl) acl))
  from pg_catalog.pg_class relation_row join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace join allowed_relations allowed on (allowed.schema_name, allowed.relation_name) = (namespace.nspname, relation_row.relname) join lateral (select distinct acl.grantee from pg_catalog.aclexplode(relation_row.relacl) acl) grant_row on true
  union all select 'grant', coalesce(namespace.nspname, ''), 'default.' || owner.rolname || '.' || coalesce(namespace.nspname, '') || '.' || default_acl.defaclobjtype::text, pg_catalog.jsonb_build_object('acl', default_acl.defaclacl, 'owner', owner.rolname, 'schema', namespace.nspname, 'objectType', default_acl.defaclobjtype)
  from pg_catalog.pg_default_acl default_acl join pg_catalog.pg_roles owner on owner.oid = default_acl.defaclrole left join pg_catalog.pg_namespace namespace on namespace.oid = default_acl.defaclnamespace where coalesce(namespace.nspname, '') in ('', 'auth', 'dashboard_private', 'extensions', 'public', 'supabase_migrations')
  union all select 'trigger', trigger_row.schema_name, trigger_row.relation_name || '.' || trigger_row.timing_name || '.' || trigger_row.event_name || '.' || pg_catalog.lpad(trigger_row.fire_order::text, 2, '0') || '.' || trigger_row.tgname, pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true), 'function', trigger_row.tgfoid::regprocedure::text, 'order', trigger_row.fire_order)
  from trigger_catalog trigger_row
), catalog_entries as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'objectKind', scoped_catalog.object_kind, 'schema', scoped_catalog.schema_name,
    'identity', scoped_catalog.identity,
    'fingerprint', scoped_catalog.fingerprint::text
  ) order by scoped_catalog.object_kind, scoped_catalog.schema_name, scoped_catalog.identity), '[]'::jsonb) as entries
  from scoped_catalog
)
select pg_catalog.jsonb_build_object(
  'serverMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
  'migrationLedger', migration_ledger.entries,
  'catalog', catalog_entries.entries
) from migration_ledger cross join catalog_entries;
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

function stripLeadingSqlTrivia(source) {
  let index = 0;
  while (index < source.length) {
    while (/\s/u.test(source[index] || "")) index += 1;
    if (source.startsWith("--", index)) {
      const lineEnd = source.indexOf("\n", index + 2);
      index = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) { depth += 1; index += 2; }
        else if (source.startsWith("*/", index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      if (depth !== 0) fail("management_api_contract_drift");
      continue;
    }
    break;
  }
  return source.slice(index);
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

function normalizeLedgerRows(value) {
  if (!Array.isArray(value)) fail("management_api_contract_drift");
  const rows = value.map((row) => {
    if (!exactKeys(row, ["name", "statements", "version"]) || !/^\d{14}$/u.test(row.version) || !(row.name === null || /^[a-z0-9_]+$/u.test(row.name)) || !Array.isArray(row.statements) || !row.statements.every((statement) => typeof statement === "string")) fail("management_api_contract_drift");
    if (row.statements.some((statement) => statement !== statement.normalize("NFC"))) fail("management_api_contract_drift");
    const statements = [...row.statements];
    return { version: row.version, name: row.name, statements };
  }).sort((left, right) => left.version.localeCompare(right.version));
  if (new Set(rows.map((row) => row.version)).size !== rows.length) fail("management_api_contract_drift");
  return rows;
}

function normalizeLedger(value) {
  return normalizeLedgerRows(value).map((row) => ({
    version: row.version,
    name: row.name,
    statementsSha256: sha256(canonical(row.statements)),
  }));
}

async function resolveRepositoryMigrationLedger(value, root) {
  const markerPattern = /^repository migration (supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql); sha256=([a-f0-9]{64})$/u;
  return Promise.all(normalizeLedgerRows(value).map(async (row) => {
    const markerStatements = row.statements.filter((statement) => {
      const firstToken = stripLeadingSqlTrivia(statement).match(/^([a-z_][a-z0-9_]*)/iu)?.[1]?.toLowerCase();
      return firstToken === "repository" || firstToken === "sha256";
    });
    if (markerStatements.length === 0) return row;
    if (row.statements.length !== 1 || markerStatements.length !== 1) fail("management_api_contract_drift");
    const match = markerStatements[0].match(markerPattern);
    if (!match || match[2] !== row.version || match[3] !== row.name) fail("management_api_contract_drift");
    let bytes;
    try { bytes = await readFile(safeRepoPath(root, match[1])); } catch { fail("management_api_contract_drift"); }
    if (sha256(bytes) !== match[4]) fail("management_api_contract_drift");
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) fail("management_api_contract_drift");
    if (source !== source.normalize("NFC")) fail("management_api_contract_drift");
    return { ...row, statements: [source] };
  }));
}

function stabilizeCatalogRoleFingerprints(value) {
  const roleByOid = new Map([["0", "public"]]);
  for (const row of value) {
    if (row?.objectKind !== "grant" || typeof row.fingerprint !== "string") continue;
    let fingerprint;
    try { fingerprint = JSON.parse(row.fingerprint); } catch { fail("management_api_contract_drift"); }
    const names = Array.isArray(fingerprint?.acl)
      ? fingerprint.acl.map((acl) => typeof acl === "string" ? acl.slice(0, acl.indexOf("=")) : null).filter(Boolean)
      : [];
    const oids = Array.isArray(fingerprint?.expanded)
      ? [...new Set(fingerprint.expanded.map((entry) => String(entry?.grantee || "")).filter((oid) => /^\d+$/u.test(oid)))]
      : [];
    if (names.length === oids.length) for (let index = 0; index < names.length; index += 1) roleByOid.set(oids[index], names[index]);
  }
  return value.map((row) => {
    if (row?.objectKind === "table" && typeof row.fingerprint === "string") {
      let fingerprint;
      try { fingerprint = JSON.parse(row.fingerprint); } catch { fail("management_api_contract_drift"); }
      if (!Array.isArray(fingerprint?.columns) || !(fingerprint.acl === null || Array.isArray(fingerprint.acl))) fail("management_api_contract_drift");
      const columns = [...fingerprint.columns].sort((left, right) => String(left?.name).localeCompare(String(right?.name))).map((column) => `{"name": ${JSON.stringify(column.name)}, "type": ${JSON.stringify(column.type)}, "notNull": ${JSON.stringify(column.notNull)}}`).join(", ");
      const acl = fingerprint.acl === null ? "null" : `[${fingerprint.acl.map((item) => JSON.stringify(item)).join(", ")}]`;
      return { ...row, fingerprint: `{"acl": ${acl}, "columns": [${columns}]}` };
    }
    if (row?.objectKind !== "policy" || typeof row.fingerprint !== "string") return row;
    let fingerprint;
    try { fingerprint = JSON.parse(row.fingerprint); } catch { fail("management_api_contract_drift"); }
    if (!Array.isArray(fingerprint?.roles) || typeof fingerprint.permissive !== "boolean") fail("management_api_contract_drift");
    const roles = fingerprint.roles.map((role) => roleByOid.get(String(role)) || (/^[a-z_][a-z0-9_]*$/u.test(String(role)) ? String(role) : fail("management_api_contract_drift")));
    const check = fingerprint.check ?? null;
    const using = fingerprint.using ?? null;
    const roleJson = `[${roles.map((role) => JSON.stringify(role)).join(", ")}]`;
    return { ...row, fingerprint: `{"check": ${JSON.stringify(check)}, "roles": ${roleJson}, "using": ${JSON.stringify(using)}, "command": ${JSON.stringify(fingerprint.command)}, "permissive": ${fingerprint.permissive}}` };
  });
}

function scanSqlCode(source) {
  const code = [...source];
  const literals = [];
  const mask = (start, end, marker) => {
    for (let index = start; index < end; index += 1) code[index] = source[index] === "\n" ? "\n" : " ";
    for (let index = 0; index < marker.length && start + index < end; index += 1) code[start + index] = marker[index];
  };
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const commentEnd = end < 0 ? source.length : end;
      mask(index, commentEnd, "");
      index = commentEnd;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) { depth += 1; index += 2; }
        else if (source.startsWith("*/", index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      if (depth !== 0) fail("management_api_contract_drift");
      mask(start, index, "");
      continue;
    }
    if (source[index] === "'") {
      const start = index;
      const escapeString = source[index - 1] === "e" && (index < 2 || !/[a-z0-9_$]/u.test(source[index - 2]));
      let value = "";
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (escapeString && source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
        } else if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) fail("management_api_contract_drift");
      literals.push({ start, end: index, value });
      mask(start, index, "''");
      continue;
    }
    if (source[index] === '"') {
      const start = index;
      let closed = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') index += 2;
        else if (source[index] === '"') { index += 1; closed = true; break; }
        else index += 1;
      }
      if (!closed) fail("management_api_contract_drift");
      mask(start, index, '""');
      continue;
    }
    if (source[index] === "$") {
      const tag = source.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/u)?.[0];
      if (tag) {
        const start = index;
        const closing = source.indexOf(tag, index + tag.length);
        if (closing < 0) fail("management_api_contract_drift");
        const end = closing + tag.length;
        literals.push({ start, end, value: source.slice(index + tag.length, closing) });
        mask(start, end, "''");
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return { code: code.join(""), literals };
}

function containsDataMutation(code, { includeRead = false } = {}) {
  const read = includeRead ? "|select\\s+|with\\b[^;]*\\bselect\\s+" : "";
  const pattern = new RegExp(`(?:\\bbegin\\b|;|\\bthen\\b|\\belse\\b|\\bloop\\b|^)(?:\\s|\\n)*(?:with\\b[^;]*\\b(?:insert\\s+into|update\\s+|delete\\s+from|merge\\s+into)${read}|insert\\s+into|update\\s+|delete\\s+from|merge\\s+into|copy\\s+|truncate\\s+|notify\\s+|call\\s+|perform\\s+)`, "u");
  return pattern.test(code);
}

function isSchemaReplayStatement(statement) {
  const normalized = stripLeadingSqlTrivia(statement).toLowerCase();
  if (!normalized) return false;
  if (/^(?:insert|update|delete|merge|copy|truncate|select|with|notify|lock|call|execute|prepare|deallocate|explain|vacuum|analyze|refresh|cluster|reindex|listen|unlisten)\b/u.test(normalized)) return false;
  if (/^(?:repository|sha256)\b/u.test(normalized)) fail("management_api_contract_drift");
  if (/^do\s+\$(?:[a-z_][a-z0-9_]*)?\$/u.test(normalized)) {
    const tag = normalized.match(/^do\s+(\$(?:[a-z_][a-z0-9_]*)?\$)/u)?.[1];
    if (!tag) fail("management_api_contract_drift");
    const bodyStart = normalized.indexOf(tag) + tag.length;
    const bodyEnd = normalized.lastIndexOf(tag);
    if (bodyEnd < bodyStart) fail("management_api_contract_drift");
    const { code, literals } = scanSqlCode(normalized.slice(bodyStart, bodyEnd));
    const directDdl = /\b(?:create\s+(?!(?:temp|temporary)\s+table\b)|alter\s+(?:table|function|procedure|schema|type|domain|sequence|view|policy|role)\b|drop\s+(?:table|function|procedure|schema|type|domain|sequence|view|policy|role)\b|grant\s+|revoke\s+|comment\s+on\b|security\s+label\b)/u.test(code);
    const executeStatements = [...code.matchAll(/\bexecute\b(?!\s+(?:function|procedure|on)\b)/gu)].map((match) => {
      const executeIndex = match.index;
      const expressionStart = executeIndex + "execute".length;
      const semicolon = code.indexOf(";", expressionStart);
      const expressionEnd = semicolon < 0 ? code.length : semicolon;
      const expression = code.slice(expressionStart, expressionEnd);
      const expressionLiterals = literals.filter((entry) => entry.start >= expressionStart && entry.start < expressionEnd);
      const literalCode = expressionLiterals.map((entry) => scanSqlCode(entry.value).code);
      const firstLiteralCode = literalCode[0];
      const bareLiteral = /^\s*e?''\s*$/u.test(expression);
      const literalOnlyFormat = /^\s*(?:pg_catalog\.)?format\s*\(\s*e?''(?:\s*,\s*e?'')*\s*\)\s*$/u.test(expression);
      const knownLiteral = bareLiteral || literalOnlyFormat;
      const nonTemporaryDdlIntent = literalCode.length > 0
        && literalCode.every((entry) => !/\bpg_temp\b/u.test(entry))
        && literalCode.some((entry) => /\b(?:create|alter|drop|grant|revoke|comment|security\s+label)\b/u.test(entry));
      const safeDdl = Boolean(firstLiteralCode)
        && knownLiteral
        && nonTemporaryDdlIntent
        && /\b(?:create|alter|drop|grant|revoke|comment|security\s+label)\b/u.test(firstLiteralCode)
        && literalCode.every((entry) => !containsDataMutation(entry, { includeRead: true }));
      return { nonTemporaryDdlIntent, safeDdl };
    });
    const dynamicDdl = executeStatements.some((entry) => entry.safeDdl);
    const hasDdlIntent = directDdl || executeStatements.some((entry) => entry.nonTemporaryDdlIntent);
    if (hasDdlIntent && (containsDataMutation(code) || executeStatements.some((entry) => !entry.safeDdl))) fail("management_api_contract_drift");
    return directDdl || dynamicDdl;
  }
  const code = scanSqlCode(normalized).code.trim();
  if (/^create\s+(?:temp|temporary)\s+table\b/u.test(code)) return false;
  if (/^create\s+(?:unlogged\s+)?table\b/u.test(code)) {
    if (/\bas\s*(?:\(\s*)*(?:select|with|table|values|execute)\b/u.test(code)) return false;
    return true;
  }
  if (/^create\s+materialized\s+view\b/u.test(code)) return /\bwith\s+no\s+data\s*$/u.test(code);
  if (/^create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:schema|extension|type|domain|sequence|view|index|function|procedure|constraint\s+trigger|trigger|policy|role|collation|cast|aggregate|operator(?:\s+(?:class|family))?|rule|statistics|publication|event\s+trigger)\b/u.test(code)) return true;
  if (/^alter\s+(?:table|index|function|procedure|schema|type|domain|sequence|view|materialized\s+view|policy|role|default\s+privileges|operator(?:\s+(?:class|family))?|publication|extension|collation|aggregate)\b/u.test(code)) return true;
  if (/^drop\s+(?:table|index|function|procedure|schema|type|domain|sequence|view|materialized\s+view|trigger|policy|role|collation|cast|aggregate|operator(?:\s+(?:class|family))?|rule|statistics|publication|extension|event\s+trigger)\b/u.test(code)) return true;
  if (/^(?:grant|revoke)\b/u.test(code)) return true;
  if (/^(?:comment\s+on|security\s+label\s+on)\b/u.test(code)) return true;
  if (/^(?:begin|start\s+transaction|commit|rollback|savepoint|release\s+savepoint|set|reset)\b/u.test(code)) return true;
  fail("management_api_contract_drift");
}

function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag = null;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === "/" && next === "*") { blockCommentDepth += 1; index += 2; continue; }
      if (character === "*" && next === "/") { blockCommentDepth -= 1; index += 2; continue; }
      index += 1;
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) { index += dollarTag.length; dollarTag = null; continue; }
      index += 1;
      continue;
    }
    if (singleQuoted) {
      if (character === "'" && next === "'") { index += 2; continue; }
      if (character === "'") singleQuoted = false;
      index += 1;
      continue;
    }
    if (doubleQuoted) {
      if (character === '"' && next === '"') { index += 2; continue; }
      if (character === '"') doubleQuoted = false;
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") { lineComment = true; index += 2; continue; }
    if (character === "/" && next === "*") { blockCommentDepth = 1; index += 2; continue; }
    if (character === "'") { singleQuoted = true; index += 1; continue; }
    if (character === '"') { doubleQuoted = true; index += 1; continue; }
    if (character === "$") {
      const match = source.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/iu);
      if (match) { dollarTag = match[0]; index += dollarTag.length; continue; }
    }
    if (character === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  if (singleQuoted || doubleQuoted || dollarTag || blockCommentDepth > 0) fail("management_api_contract_drift");
  const trailing = source.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function replayBaseline(value) {
  return normalizeLedgerRows(value).flatMap((row) => row.statements.flatMap(splitSqlStatements)).filter(isSchemaReplayStatement).map((statement) => {
    const trimmed = statement.trimEnd();
    if (!trimmed) fail("management_api_contract_drift");
    return `${trimmed}${trimmed.endsWith(";") ? "" : ";"}\n`;
  }).join("");
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/u.test(value)) fail("management_api_contract_drift");
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteStringLiteral(value) {
  if (typeof value !== "string" || value.includes("\0")) fail("management_api_contract_drift");
  return `'${value.replaceAll("'", "''")}'`;
}

function legacyTableBootstrap(definitions, migrationLedger) {
  const ledgerSql = normalizeLedgerRows(migrationLedger).flatMap((row) => row.statements).join("\n");
  const typeSql = definitions
    .filter((entry) => entry.objectKind === "type" && entry.schema === "public" && entry.replayFingerprint)
    .filter((entry) => {
      const escaped = entry.identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const createPattern = new RegExp(String.raw`\bcreate\s+type\s+(?:"?public"?\s*\.\s*)?"?${escaped}"?\b`, "iu");
      return !createPattern.test(ledgerSql);
    })
    .map((entry) => {
      let fingerprint;
      try { fingerprint = JSON.parse(entry.replayFingerprint); } catch { fail("management_api_contract_drift"); }
      if (!fingerprint || !Array.isArray(fingerprint.labels) || !fingerprint.labels.length || !fingerprint.labels.every((label) => typeof label === "string")) fail("management_api_contract_drift");
      return `create type public.${quoteIdentifier(entry.identity)} as enum (${fingerprint.labels.map(quoteStringLiteral).join(", ")});\n`;
    })
    .join("");
  const legacyTables = definitions
    .filter((entry) => entry.objectKind === "table" && entry.schema === "public" && entry.replayFingerprint)
    .filter((entry) => {
      const escaped = entry.identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const createPattern = new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?${escaped}"?\b`, "iu");
      const createMatch = createPattern.exec(ledgerSql);
      if (!createMatch) return true;
      const referencePattern = new RegExp(String.raw`(?:"?public"?\s*\.\s*)"?${escaped}"?\b`, "iu");
      const firstReference = referencePattern.exec(ledgerSql);
      return Boolean(firstReference && firstReference.index < createMatch.index);
    })
  const tableNames = new Set(legacyTables.map((entry) => entry.identity));
  const legacyDefaults = definitions
    .filter((entry) => entry.objectKind === "default" && entry.schema === "public" && entry.replayFingerprint)
    .map((entry) => ({ entry, separator: entry.identity.indexOf(".") }))
    .filter(({ entry, separator }) => separator > 0 && tableNames.has(entry.identity.slice(0, separator)))
    .map(({ entry, separator }) => {
      let fingerprint;
      try { fingerprint = JSON.parse(entry.replayFingerprint); } catch { fail("management_api_contract_drift"); }
      const expression = fingerprint?.expression;
      const generated = fingerprint?.generated || "";
      if (typeof expression !== "string" || !expression.trim() || !["", "s"].includes(generated) || /(?:;|--|\/\*)/u.test(expression)) fail("management_api_contract_drift");
      return { tableName: entry.identity.slice(0, separator), columnName: entry.identity.slice(separator + 1), expression, generated };
    });
  const defaultByColumn = new Map(legacyDefaults.map((entry) => [`${entry.tableName}.${entry.columnName}`, entry]));
  const tableSql = legacyTables.map((entry) => {
      let fingerprint;
      try { fingerprint = JSON.parse(entry.replayFingerprint); } catch { fail("management_api_contract_drift"); }
      if (!fingerprint || !Array.isArray(fingerprint.columns) || !fingerprint.columns.length) fail("management_api_contract_drift");
      const columns = fingerprint.columns.map((column) => {
        if (!column || typeof column.type !== "string" || typeof column.notNull !== "boolean" || !/^[a-z0-9_ .,"()\[\]]+$/iu.test(column.type) || /(?:;|--|\/\*)/u.test(column.type)) fail("management_api_contract_drift");
        const defaultEntry = defaultByColumn.get(`${entry.identity}.${column.name}`);
        const generatedClause = defaultEntry?.generated === "s" ? ` generated always as (${defaultEntry.expression}) stored` : "";
        return `  ${quoteIdentifier(column.name)} ${column.type}${generatedClause}${column.notNull ? " not null" : ""}`;
      });
      return `create table if not exists public.${quoteIdentifier(entry.identity)} (\n${columns.join(",\n")}\n);\n`;
    })
    .join("");
  const defaultSql = legacyDefaults
    .filter((entry) => entry.generated !== "s")
    .map((entry) => `alter table public.${quoteIdentifier(entry.tableName)} alter column ${quoteIdentifier(entry.columnName)} set default ${entry.expression};\n`)
    .join("");
  const constraintSql = definitions
    .filter((entry) => entry.objectKind === "constraint" && entry.schema === "public" && entry.replayFingerprint)
    .map((entry) => ({ entry, separator: entry.identity.indexOf(".") }))
    .filter(({ entry, separator }) => separator > 0 && tableNames.has(entry.identity.slice(0, separator)))
    .map(({ entry, separator }) => {
      let fingerprint;
      try { fingerprint = JSON.parse(entry.replayFingerprint); } catch { fail("management_api_contract_drift"); }
      const definition = fingerprint?.definition;
      if (typeof definition !== "string" || !/^(?:PRIMARY KEY|UNIQUE)\b/iu.test(definition) || /(?:;|--|\/\*)/u.test(definition)) return "";
      const tableName = entry.identity.slice(0, separator);
      const constraintName = entry.identity.slice(separator + 1);
      return `alter table public.${quoteIdentifier(tableName)} add constraint ${quoteIdentifier(constraintName)} ${definition};\n`;
    })
    .join("");
  return `${typeSql}${tableSql}${defaultSql}${constraintSql}`;
}

function parsedReplayFingerprint(entry) {
  try { return JSON.parse(entry.replayFingerprint); } catch { fail("management_api_contract_drift"); }
}

function relationIdentity(entry) {
  const separator = entry.identity.indexOf(".");
  if (separator < 1) fail("management_api_contract_drift");
  return { relation: entry.identity.slice(0, separator), object: entry.identity.slice(separator + 1) };
}

function aclGrantSql(schema, relation, acl) {
  if (!(acl === null || Array.isArray(acl))) fail("management_api_contract_drift");
  const target = `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
  const allowedRoles = new Set(["anon", "authenticated", "dashboard_audit_writer_v2", "service_role", "postgres", "public"]);
  const privilegeByCode = new Map([["a", "insert"], ["r", "select"], ["w", "update"], ["d", "delete"], ["D", "truncate"], ["x", "references"], ["t", "trigger"], ["m", "maintain"]]);
  const statements = [`revoke all privileges on table ${target} from anon, authenticated, dashboard_audit_writer_v2, service_role;`];
  for (const item of acl || []) {
    if (typeof item !== "string") fail("management_api_contract_drift");
    const match = item.match(/^([^=]*)=([^/]*)\/[a-z_][a-z0-9_]*$/iu);
    if (!match) fail("management_api_contract_drift");
    const role = match[1] || "public";
    if (!allowedRoles.has(role)) continue;
    const privileges = [];
    for (const code of match[2].replaceAll("*", "")) {
      const privilege = privilegeByCode.get(code);
      if (privilege && !privileges.includes(privilege)) privileges.push(privilege);
    }
    if (privileges.length) statements.push(`grant ${privileges.join(", ")} on table ${target} to ${quoteIdentifier(role)};`);
  }
  return statements.join("\n");
}

function functionAclGrantSql(entry) {
  const fingerprint = parsedReplayFingerprint(entry);
  const identity = normalizeDashboardFunctionIdentity(entry.identity);
  const opening = identity.indexOf("(");
  const functionName = identity.slice(0, opening);
  const signature = identity.slice(opening + 1, -1);
  if (fingerprint?.owner !== "postgres" || fingerprint.signature !== signature || !Array.isArray(fingerprint.acl) || fingerprint.acl.length === 0) fail("management_api_contract_drift");
  const allowedRoles = new Set(["public", "anon", "authenticated", "service_role", "postgres"]);
  const seenRoles = new Set();
  const capturedRoles = [];
  for (const item of fingerprint.acl) {
    if (typeof item !== "string") fail("management_api_contract_drift");
    const match = item.match(/^([^=]*)=([^/]*)\/([a-z_][a-z0-9_]*)$/iu);
    if (!match) fail("management_api_contract_drift");
    const role = match[1] || "public";
    const privileges = match[2];
    const grantor = match[3];
    if (!allowedRoles.has(role) || seenRoles.has(role) || privileges !== "X" || grantor !== fingerprint.owner) fail("management_api_contract_drift");
    seenRoles.add(role);
    capturedRoles.push(role);
  }
  if (capturedRoles[0] !== fingerprint.owner) fail("management_api_contract_drift");
  const target = `${quoteIdentifier(entry.schema)}.${quoteIdentifier(functionName)}(${signature})`;
  const roleSql = (role) => role === "public" ? "public" : quoteIdentifier(role);
  return [
    `revoke all privileges on function ${target} from public, anon, authenticated, service_role, postgres;`,
    ...capturedRoles.map((role) => `grant execute on function ${target} to ${roleSql(role)};`),
  ];
}

export function buildFinalSchemaReconciliation(definitions) {
  for (const entry of definitions) {
    if (entry.objectKind === "policy" && Object.hasOwn(entry, "policyFingerprintVersion") && entry.policyFingerprintVersion !== 2) fail("management_api_contract_drift");
    if (entry.objectKind === "policy" && entry.replayFingerprint !== undefined && entry.replayFingerprint !== null
      && typeof parsedReplayFingerprint(entry)?.permissive !== "boolean") fail("management_api_contract_drift");
  }
  const publicTables = definitions.filter((entry) => entry.objectKind === "table" && entry.schema === "public" && entry.replayFingerprint);
  const defaults = new Map(definitions.filter((entry) => entry.objectKind === "default" && entry.schema === "public" && entry.replayFingerprint).map((entry) => [entry.identity, parsedReplayFingerprint(entry)]));
  const columnSql = publicTables.flatMap((entry) => {
    const fingerprint = parsedReplayFingerprint(entry);
    if (!Array.isArray(fingerprint?.columns)) fail("management_api_contract_drift");
    return fingerprint.columns.flatMap((column) => {
      if (!column || typeof column.name !== "string" || typeof column.type !== "string" || typeof column.notNull !== "boolean" || !/^[a-z0-9_ .,"()\[\]]+$/iu.test(column.type)) fail("management_api_contract_drift");
      const defaultEntry = defaults.get(`${entry.identity}.${column.name}`);
      const generatedClause = defaultEntry?.generated === "s" ? ` generated always as (${defaultEntry.expression}) stored` : "";
      return [
        `alter table public.${quoteIdentifier(entry.identity)} add column if not exists ${quoteIdentifier(column.name)} ${column.type}${generatedClause};`,
        `alter table public.${quoteIdentifier(entry.identity)} alter column ${quoteIdentifier(column.name)} ${column.notNull ? "set" : "drop"} not null;`,
      ];
    });
  });
  const defaultSql = [...defaults].flatMap(([identity, fingerprint]) => {
    const separator = identity.indexOf(".");
    if (separator < 1 || typeof fingerprint?.expression !== "string" || !["", "s"].includes(fingerprint.generated || "")) fail("management_api_contract_drift");
    if (fingerprint.generated === "s") return [];
    return [`alter table public.${quoteIdentifier(identity.slice(0, separator))} alter column ${quoteIdentifier(identity.slice(separator + 1))} set default ${fingerprint.expression};`];
  });
  const constraintSql = definitions.filter((entry) => entry.objectKind === "constraint" && entry.schema === "public" && entry.replayFingerprint).map((entry) => {
    const { relation, object } = relationIdentity(entry);
    const definition = parsedReplayFingerprint(entry)?.definition;
    if (typeof definition !== "string" || /(?:;|--|\/\*)/u.test(definition)) fail("management_api_contract_drift");
    if (/^TRIGGER\b/iu.test(definition)) return "";
    return `do $reconcile$ begin if not exists (select 1 from pg_catalog.pg_constraint constraint_row join pg_catalog.pg_class relation_row on relation_row.oid = constraint_row.conrelid join pg_catalog.pg_namespace namespace on namespace.oid = relation_row.relnamespace where namespace.nspname = 'public' and relation_row.relname = ${sqlLiteral(relation)} and constraint_row.conname = ${sqlLiteral(object)}) then alter table public.${quoteIdentifier(relation)} add constraint ${quoteIdentifier(object)} ${definition}; end if; end $reconcile$;`;
  });
  const constraintNames = new Set(definitions.filter((entry) => entry.objectKind === "constraint" && entry.schema === "public").map((entry) => relationIdentity(entry).object));
  const indexSql = definitions.filter((entry) => entry.objectKind === "index" && entry.schema === "public" && entry.replayFingerprint && !constraintNames.has(entry.identity)).map((entry) => {
    const definition = parsedReplayFingerprint(entry)?.definition;
    if (typeof definition !== "string" || !/^create (?:unique )?index /iu.test(definition) || /(?:;|--|\/\*)/u.test(definition)) fail("management_api_contract_drift");
    return `do $reconcile$ begin if pg_catalog.to_regclass(${sqlLiteral(`public.${entry.identity}`)}) is null then ${definition}; elsif pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(${sqlLiteral(`public.${entry.identity}`)})) <> ${sqlLiteral(definition)} then drop index public.${quoteIdentifier(entry.identity)}; ${definition}; end if; end $reconcile$;`;
  });
  const rlsSql = definitions.filter((entry) => entry.objectKind === "rls" && entry.schema === "public" && entry.replayFingerprint).flatMap((entry) => {
    const fingerprint = parsedReplayFingerprint(entry);
    if (typeof fingerprint?.enabled !== "boolean" || typeof fingerprint?.forced !== "boolean") fail("management_api_contract_drift");
    return [
      `alter table public.${quoteIdentifier(entry.identity)} ${fingerprint.enabled ? "enable" : "disable"} row level security;`,
      `alter table public.${quoteIdentifier(entry.identity)} ${fingerprint.forced ? "force" : "no force"} row level security;`,
    ];
  });
  const commandName = new Map([["r", "select"], ["a", "insert"], ["w", "update"], ["d", "delete"], ["*", "all"]]);
  const needsLegacyStaffHelper = definitions.some((entry) => entry.objectKind === "policy" && entry.replayFingerprint && /\bis_admin_or_staff\s*\(\s*\)/iu.test(entry.replayFingerprint));
  const helperSql = needsLegacyStaffHelper ? ["create or replace function public.is_admin_or_staff() returns boolean language sql stable security invoker set search_path = '' as $$ select public.current_dashboard_role() = any (array['admin'::text, 'staff'::text]) $$;"] : [];
  const policyRoles = new Set(["public", "anon", "authenticated", "service_role"]);
  const managedRoleSql = definitions.filter((entry) => entry.objectKind === "role" && entry.schema === "" && entry.identity === "dashboard_audit_writer_v2" && entry.replayFingerprint).map((entry) => {
    const fingerprint = parsedReplayFingerprint(entry);
    if (fingerprint?.login !== false || fingerprint?.inherit !== false || fingerprint?.superuser !== false) fail("management_api_contract_drift");
    policyRoles.add(entry.identity);
    return `do $reconcile$ begin if not exists (select 1 from pg_catalog.pg_roles where rolname = ${sqlLiteral(entry.identity)}) then create role ${quoteIdentifier(entry.identity)} noinherit nologin nosuperuser; end if; end $reconcile$;`;
  });
  const policySql = definitions.filter((entry) => entry.objectKind === "policy" && entry.schema === "public" && entry.replayFingerprint).flatMap((entry) => {
    const { relation, object } = relationIdentity(entry);
    const fingerprint = parsedReplayFingerprint(entry);
    const command = commandName.get(fingerprint?.command);
    if (!command || typeof fingerprint.permissive !== "boolean" || !Array.isArray(fingerprint.roles) || !fingerprint.roles.every((role) => policyRoles.has(role)) || !(fingerprint.using === null || typeof fingerprint.using === "string") || !(fingerprint.check === null || typeof fingerprint.check === "string")) fail("management_api_contract_drift");
    const clauses = [`create policy ${quoteIdentifier(object)} on public.${quoteIdentifier(relation)} as ${fingerprint.permissive ? "permissive" : "restrictive"} for ${command} to ${fingerprint.roles.map(quoteIdentifier).join(", ")}`];
    if (fingerprint.using !== null) clauses.push(`using (${fingerprint.using})`);
    if (fingerprint.check !== null) clauses.push(`with check (${fingerprint.check})`);
    return [`drop policy if exists ${quoteIdentifier(object)} on public.${quoteIdentifier(relation)};`, `${clauses.join(" ")};`];
  });
  const triggerSql = definitions.filter((entry) => entry.objectKind === "trigger" && entry.schema === "public" && entry.replayFingerprint).flatMap((entry) => {
    const relation = entry.identity.slice(0, entry.identity.indexOf("."));
    const fingerprint = parsedReplayFingerprint(entry);
    if (typeof fingerprint?.definition !== "string" || !/^create (?:constraint )?trigger /iu.test(fingerprint.definition) || /(?:;|--|\/\*)/u.test(fingerprint.definition)) fail("management_api_contract_drift");
    const name = fingerprint.definition.match(/^create (?:constraint )?trigger ("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)\s/iu)?.[1];
    if (!name) fail("management_api_contract_drift");
    return [`drop trigger if exists ${name} on public.${quoteIdentifier(relation)};`, `${fingerprint.definition};`];
  });
  const aclSql = publicTables.map((entry) => aclGrantSql("public", entry.identity, parsedReplayFingerprint(entry)?.acl));
  const functionAclSql = definitions
    .filter((entry) => entry.objectKind === "function" && entry.schema === "public" && entry.replayFingerprint)
    .flatMap(functionAclGrantSql);
  const statements = [...columnSql, ...defaultSql, ...constraintSql, ...indexSql, ...rlsSql, ...helperSql, ...managedRoleSql, ...policySql, ...triggerSql, ...aclSql, ...functionAclSql].filter(Boolean);
  return statements.length ? `${statements.join("\n")}\n` : "";
}

export function normalizeDashboardFunctionIdentity(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*\(.*\)$/u.test(value)) fail("management_api_contract_drift");
  const opening = value.indexOf("(");
  const name = value.slice(0, opening);
  const source = value.slice(opening + 1, -1).trim();
  if (!source) return `${name}()`;
  const argumentsList = [];
  let current = ""; let depth = 0; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') quoted = !quoted;
    if (!quoted && character === "(") depth += 1;
    if (!quoted && character === ")") depth -= 1;
    if (!quoted && depth === 0 && character === ",") { argumentsList.push(current); current = ""; } else current += character;
    if (depth < 0) fail("management_api_contract_drift");
  }
  if (quoted || depth !== 0) fail("management_api_contract_drift");
  argumentsList.push(current);
  const identifier = String.raw`(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)`;
  const typeGrammar = new RegExp(String.raw`^(?:(?:double\s+precision|character\s+varying|bit\s+varying|(?:timestamp|time)(?:\s*\(\s*\d+\s*\))?\s+(?:with|without)\s+time\s+zone|interval(?:\s+(?:year|month|day|hour|minute|second)(?:\s+to\s+(?:month|day|hour|minute|second))?)?|${identifier}(?:\s*\.\s*${identifier})*(?:\s*\([^()]*\))?))(?:\s*\[\s*\])*$`, "iu");
  const normalizeType = (argument) => {
    let candidate = argument.trim().replace(/^(?:inout|in|out|variadic)\s+/iu, "");
    if (!typeGrammar.test(candidate)) {
      const named = candidate.match(new RegExp(String.raw`^${identifier}\s+(.+)$`, "iu"));
      if (!named || !typeGrammar.test(named[1])) fail("management_api_contract_drift");
      candidate = named[1];
    }
    return candidate.trim().toLowerCase().replaceAll(/\s+/gu, " ").replaceAll(/\s*\.\s*/gu, ".").replaceAll(/\s*\[\s*\]/gu, "[]").replaceAll(/\(\s*/gu, "(").replaceAll(/\s*\)/gu, ")").replaceAll(/\s*,\s*/gu, ",");
  };
  return `${name}(${argumentsList.map(normalizeType).join(",")})`;
}

function normalizeScopedFunction(value) {
  if (typeof value !== "string") fail("management_api_contract_drift");
  const separator = value.indexOf(".");
  if (separator < 1) fail("management_api_contract_drift");
  return `${value.slice(0, separator)}.${normalizeDashboardFunctionIdentity(value.slice(separator + 1))}`;
}

export function normalizeDashboardFreeTierCatalog(value, scope) {
  if (!Array.isArray(value)) fail("management_api_contract_drift");
  const allowed = new Set(scope.relations || []);
  const allowedViews = new Set(scope.views || []);
  const allowedFunctions = new Set((scope.functions || []).map(normalizeScopedFunction));
  const allowedSchemas = new Set(scope.schemas || []);
  const allowedRoles = new Set(scope.roles || []);
  const forbidden = (scope.forbiddenTerms || []).map((term) => String(term).toLowerCase());
  const seen = new Set();
  const normalized = value.map((row) => {
    const rawDefinition = typeof row.definition === "string" ? row.definition : null;
    const fingerprint = typeof row.fingerprint === "string" ? row.fingerprint.normalize("NFC") : null;
    if (row.objectKind === "policy" && Object.hasOwn(row, "policyFingerprintVersion") && row.policyFingerprintVersion !== 2) fail("management_api_contract_drift");
    if (row.objectKind === "policy" && fingerprint !== null) {
      let parsed;
      try { parsed = JSON.parse(fingerprint); } catch { fail("management_api_contract_drift"); }
      if (typeof parsed?.permissive !== "boolean") fail("management_api_contract_drift");
    }
    const hash = fingerprint ? sha256(fingerprint) : typeof row.definitionSha256 === "string" ? row.definitionSha256 : rawDefinition ? sha256(rawDefinition) : null;
    if (!row || typeof row.identity !== "string" || typeof row.objectKind !== "string" || typeof row.schema !== "string" || !SHA256.test(hash || "")) fail("management_api_contract_drift");
    const identity = row.objectKind === "function" ? normalizeDashboardFunctionIdentity(row.identity) : row.identity;
    const qualified = `${row.schema}.${identity}`;
    if (row.objectKind === "table" && !allowed.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "view" && !allowedViews.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "function" && !allowedFunctions.has(qualified)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "schema" && !allowedSchemas.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (row.objectKind === "role" && !allowedRoles.has(row.identity)) fail("dashboard_free_tier_catalog_scope_drift");
    if (!OBJECT_ORDER.includes(row.objectKind) || (rawDefinition && forbidden.some((term) => rawDefinition.toLowerCase().includes(term)))) fail("dashboard_free_tier_catalog_scope_drift");
    const key = `${row.objectKind}|${row.schema}|${identity}`;
    if (seen.has(key)) fail("management_api_contract_drift");
    seen.add(key);
    return { objectKind: row.objectKind, schema: row.schema, identity, definition: rawDefinition?.normalize("NFC") || null, definitionSha256: hash, metadata: row.metadata || null, replayFingerprint: fingerprint, ...(row.objectKind === "policy" && (fingerprint || row.policyFingerprintVersion === 2) ? { policyFingerprintVersion: 2 } : {}) };
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
  requireIdentity("view", scope.views || []);
  requireIdentity("sequence", scope.sequences || []);
  requireIdentity("type", scope.types || []);
  requireIdentity("function", (scope.functions || []).map(normalizeScopedFunction));
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
  if (entry.objectKind === "function") return `(select pg_catalog.jsonb_build_object('signature', arguments.signature, 'body', pg_catalog.pg_get_functiondef(procedure.oid), 'owner', pg_catalog.pg_get_userbyid(procedure.proowner), 'securityDefiner', procedure.prosecdef, 'searchPath', procedure.proconfig, 'acl', procedure.proacl) from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace ns on ns.oid = procedure.pronamespace cross join lateral (select coalesce(pg_catalog.string_agg(pg_catalog.format_type(argument_oid, null), ',' order by ordinality), '') signature from unnest(procedure.proargtypes::oid[]) with ordinality as argument(argument_oid, ordinality)) arguments where ns.nspname = ${schema} and (procedure.proname || '(' || arguments.signature || ')') = ${identity})`;
  if (entry.objectKind === "constraint") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(con.oid, true)) from pg_catalog.pg_constraint con join pg_catalog.pg_class rel on rel.oid = con.conrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || con.conname) = ${identity})`;
  if (entry.objectKind === "index") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_indexdef(rel.oid)) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity})`;
  if (entry.objectKind === "trigger") return `(select pg_catalog.jsonb_build_object('definition', ranked.definition, 'function', ranked.function_identity, 'order', ranked.fire_order) from (select ns.nspname schema_name, rel.relname relation_name, trg.tgname, pg_catalog.pg_get_triggerdef(trg.oid, true) definition, trg.tgfoid::regprocedure::text function_identity, case when trg.tgtype & 2 = 2 then 'before' else 'after' end timing_name, trigger_event.event_name, row_number() over (partition by trg.tgrelid, case when trg.tgtype & 2 = 2 then 'before' else 'after' end, trigger_event.event_name order by trg.tgname) fire_order from pg_catalog.pg_trigger trg join pg_catalog.pg_class rel on rel.oid = trg.tgrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace cross join lateral (values (4, 'insert'), (8, 'delete'), (16, 'update'), (32, 'truncate')) trigger_event(event_bit, event_name) where not trg.tgisinternal and trg.tgtype & trigger_event.event_bit = trigger_event.event_bit) ranked where ranked.schema_name = ${schema} and (ranked.relation_name || '.' || ranked.timing_name || '.' || ranked.event_name || '.' || pg_catalog.lpad(ranked.fire_order::text, 2, '0') || '.' || ranked.tgname) = ${identity})`;
  if (entry.objectKind === "policy" && Object.hasOwn(entry, "policyFingerprintVersion") && entry.policyFingerprintVersion !== 2) fail("management_api_contract_drift");
  if (entry.objectKind === "policy") return `(select pg_catalog.jsonb_build_object('command', pol.polcmd,${entry.policyFingerprintVersion === 2 ? " 'permissive', pol.polpermissive," : ""} 'roles', (select pg_catalog.jsonb_agg(case when role_entry.role_oid = 0 then 'public' else pg_catalog.pg_get_userbyid(role_entry.role_oid) end order by role_entry.ordinality) from unnest(pol.polroles) with ordinality role_entry(role_oid, ordinality)), 'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), 'check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)) from pg_catalog.pg_policy pol join pg_catalog.pg_class rel on rel.oid = pol.polrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || pol.polname) = ${identity})`;
  if (entry.objectKind === "role") return `(select pg_catalog.jsonb_build_object('login', rolcanlogin, 'inherit', rolinherit, 'superuser', rolsuper) from pg_catalog.pg_roles where rolname = ${identity})`;
  if (entry.objectKind === "grant" && entry.identity.startsWith("default.")) return `(select pg_catalog.jsonb_build_object('acl', default_acl.defaclacl, 'owner', owner.rolname, 'schema', ns.nspname, 'objectType', default_acl.defaclobjtype) from pg_catalog.pg_default_acl default_acl join pg_catalog.pg_roles owner on owner.oid = default_acl.defaclrole left join pg_catalog.pg_namespace ns on ns.oid = default_acl.defaclnamespace where ('default.' || owner.rolname || '.' || coalesce(ns.nspname, '') || '.' || default_acl.defaclobjtype::text) = ${identity})`;
  if (entry.objectKind === "grant") return `(select pg_catalog.jsonb_build_object('acl', rel.relacl, 'expanded', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantee', acl.grantee, 'privilege', acl.privilege_type) order by acl.grantee, acl.privilege_type) from pg_catalog.aclexplode(rel.relacl) acl)) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and (rel.relname || '.' || (split_part(${identity}, '.', 2))) = ${identity})`;
  if (entry.objectKind === "rls") return `(select pg_catalog.jsonb_build_object('enabled', rel.relrowsecurity, 'forced', rel.relforcerowsecurity) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity})`;
  if (entry.objectKind === "schema") return `(select pg_catalog.jsonb_build_object('acl', nspacl) from pg_catalog.pg_namespace where nspname = ${identity})`;
  if (entry.objectKind === "type") return `(select pg_catalog.jsonb_build_object('type', pg_catalog.format_type(type_row.oid, null), 'labels', labels.labels) from pg_catalog.pg_type type_row join pg_catalog.pg_namespace ns on ns.oid = type_row.typnamespace left join lateral (select pg_catalog.jsonb_agg(enum.enumlabel order by enum.enumsortorder) labels from pg_catalog.pg_enum enum where enum.enumtypid = type_row.oid) labels on true where ns.nspname = ${schema} and type_row.typname = ${identity})`;
  if (entry.objectKind === "default") return `(select pg_catalog.jsonb_build_object('expression', pg_catalog.pg_get_expr(def.adbin, def.adrelid), 'generated', attr.attgenerated) from pg_catalog.pg_attrdef def join pg_catalog.pg_class rel on rel.oid = def.adrelid join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace join pg_catalog.pg_attribute attr on attr.attrelid = rel.oid and attr.attnum = def.adnum where ns.nspname = ${schema} and (rel.relname || '.' || attr.attname) = ${identity})`;
  if (entry.objectKind === "table") return `(select pg_catalog.jsonb_build_object('columns', columns.columns, 'acl', rel.relacl) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace join lateral (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', attr.attname, 'type', pg_catalog.format_type(attr.atttypid, attr.atttypmod), 'notNull', attr.attnotnull) order by attr.attname) columns from pg_catalog.pg_attribute attr where attr.attrelid = rel.oid and attr.attnum > 0 and not attr.attisdropped) columns on true where ns.nspname = ${schema} and rel.relname = ${identity} and rel.relkind in ('r','p'))`;
  if (entry.objectKind === "view") return `(select pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_viewdef(rel.oid, true), 'options', rel.reloptions, 'acl', rel.relacl) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity} and rel.relkind = 'v')`;
  if (entry.objectKind === "sequence") return `(select pg_catalog.jsonb_build_object('acl', rel.relacl) from pg_catalog.pg_class rel join pg_catalog.pg_namespace ns on ns.oid = rel.relnamespace where ns.nspname = ${schema} and rel.relname = ${identity} and rel.relkind = 'S')`;
  return `(select pg_catalog.to_jsonb(${schema} || '.' || ${identity}))`;
}
export function buildDashboardFreeTierParitySql(catalog) {
  const rows = catalog.map((entry) => `select is(encode(extensions.digest(pg_catalog.convert_to((${dashboardFreeTierCatalogFingerprintSql(entry)})::text, 'UTF8'), 'sha256'), 'hex'), ${sqlLiteral(entry.definitionSha256)}, ${sqlLiteral(`catalog ${entry.objectKind} ${entry.schema}.${entry.identity} fingerprint`) });`).join("\n");
  return `begin;\nselect plan(${catalog.length});\n${rows}\nselect * from finish();\nrollback;\n`;
}

function artifactSet({ payload, originMainSha, definitions, replayLedger = payload.migrationLedger }) {
  const ledger = normalizeLedger(payload.migrationLedger);
  const constraintIndexNames = new Set(definitions.filter((entry) => entry.objectKind === "constraint").map((entry) => relationIdentity(entry).object));
  const catalog = definitions.filter((entry) => entry.objectKind !== "grant" && !(entry.objectKind === "index" && constraintIndexNames.has(entry.identity))).map((entry) => ({ objectKind: entry.objectKind, schema: entry.schema, identity: entry.identity, definitionSha256: entry.definitionSha256, ...(entry.policyFingerprintVersion === 2 ? { policyFingerprintVersion: 2 } : {}) }));
  const normalized = {
    captureStatus: "reviewed", originMainSha, serverMajor: payload.serverMajor,
    migrationLedgerCount: ledger.length, migrationLedgerMaxVersion: ledger.at(-1)?.version || null,
    migrationLedgerSha256: sha256(canonical(ledger)), migrationLedger: ledger, catalog,
  };
  const baseline = `${legacyTableBootstrap(definitions, replayLedger)}${replayBaseline(replayLedger)}${buildFinalSchemaReconciliation(definitions)}`;
  const parity = buildDashboardFreeTierParitySql(catalog);
  return { catalog: `${JSON.stringify(normalized, null, 2)}\n`, baseline, parity, normalized };
}

export async function publishDashboardFreeTierCaptureSet({ root, artifacts, manifest, artifactPaths, publish = publishDashboardFreeTierCapture, publishManifest = false }) {
  const captures = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1-captures");
  const captureId = sha256(canonical({
    baseline: artifacts.baseline,
    catalog: artifacts.catalog,
    manifest,
    parity: artifacts.parity,
  })).slice(0, 16);
  const stage = join(captures, `.stage-${captureId}-${process.pid}`);
  const active = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.active.json");
  const final = join(captures, captureId);
  const artifactTargets = {
    catalog: safeRepoPath(root, artifactPaths.catalog),
    baseline: safeRepoPath(root, artifactPaths.baseline),
    parityTest: safeRepoPath(root, artifactPaths.parityTest),
    ...(publishManifest ? { manifest: resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json") } : {}),
  };
  try {
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await writeFile(join(stage, "catalog.json"), artifacts.catalog, { mode: 0o600 });
    await writeFile(join(stage, "baseline.sql"), artifacts.baseline, { mode: 0o600 });
    await writeFile(join(stage, "parity.sql"), artifacts.parity, { mode: 0o600 });
    await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await publish({ stage, final, active, captureId, artifactPaths, artifactTargets, artifacts, ...(publishManifest ? { manifest } : {}) });
    return { captureId };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function publishDashboardFreeTierCapture({ stage, final, active, captureId, artifactPaths, artifactTargets, artifacts, manifest, afterStageRename = async () => {}, renameFile = rename }) {
  await mkdir(dirname(final), { recursive: true, mode: 0o700 });
  await renameFile(stage, final);
  await afterStageRename({ final, active, captureId });
  const outputs = [
    [artifactTargets.catalog, artifacts.catalog],
    [artifactTargets.baseline, artifacts.baseline],
    [artifactTargets.parityTest, artifacts.parity],
    ...(artifactTargets.manifest ? [[artifactTargets.manifest, `${JSON.stringify(manifest, null, 2)}\n`]] : []),
  ];
  const temporaryOutputs = outputs.map(([target]) => `${target}.tmp-${process.pid}-${captureId}`);
  const restorationOutputs = outputs.map(([target]) => `${target}.restore-${process.pid}-${captureId}`);
  const pointer = `${active}.tmp-${process.pid}`;
  let previousOutputs;
  try {
    previousOutputs = await Promise.all(outputs.map(async ([target]) => {
      try { return { kind: "file", contents: await readFile(target) }; }
      catch (error) {
        if (error?.code === "ENOENT") return { kind: "absent" };
        if (error?.code === "EISDIR") return { kind: "other" };
        throw error;
      }
    }));
    for (let index = 0; index < outputs.length; index += 1) {
      const [target, contents] = outputs[index];
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(temporaryOutputs[index], contents, { mode: 0o600 });
    }
    for (let index = 0; index < outputs.length; index += 1) await renameFile(temporaryOutputs[index], outputs[index][0]);
    await writeFile(pointer, `${JSON.stringify({ captureSetVersion: 1, captureId, artifactPaths })}\n`, { mode: 0o600 });
    await renameFile(pointer, active);
  } catch (error) {
    const rollbackErrors = [];
    if (previousOutputs) {
      for (let index = 0; index < outputs.length; index += 1) {
        const previous = previousOutputs[index];
        const target = outputs[index][0];
        try {
          if (previous.kind === "file") {
            await writeFile(restorationOutputs[index], previous.contents, { mode: 0o600 });
            await renameFile(restorationOutputs[index], target);
          } else if (previous.kind === "absent") {
            await rm(target, { force: true });
          }
        } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "dashboard_free_tier_catalog_publication_and_rollback_failed");
    throw error;
  } finally {
    await Promise.all([...temporaryOutputs, ...restorationOutputs, pointer].map((path) => rm(path, { force: true })));
  }
}

export async function captureDashboardFreeTierCatalog({ argv = process.argv.slice(2), env = process.env, root = ROOT, fetch = globalThis.fetch, gitOriginMainSha = async () => (await import("node:child_process")).execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim(), log = () => {}, afterStageRename = async () => {}, publish = (input) => publishDashboardFreeTierCapture({ ...input, afterStageRename }) } = {}) {
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
  const definitions = normalizeDashboardFreeTierCatalog(stabilizeCatalogRoleFingerprints(payload.catalog), scope);
  const replayLedger = await resolveRepositoryMigrationLedger(payload.migrationLedger, root);
  const artifacts = artifactSet({ payload, originMainSha: args.originMainSha, definitions, replayLedger });
  const manifestPath = resolve(root, "supabase/test-baselines/dashboard-free-tier-v1.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.originMainSha = args.originMainSha;
  manifest.baselineSha256 = sha256(artifacts.baseline);
  manifest.catalogSha256 = sha256(artifacts.catalog);
  await publishDashboardFreeTierCaptureSet({ root, artifacts, manifest, artifactPaths: { catalog: args.catalog, baseline: args.baseline, parityTest: args.parityTest }, publish });
  return artifacts.normalized;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) captureDashboardFreeTierCatalog().then((result) => process.stdout.write(`${JSON.stringify({ captureStatus: result.captureStatus, statementId: "dashboard_free_tier_catalog_v1" })}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
