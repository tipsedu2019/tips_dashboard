import { createHash } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const FORBIDDEN_SQL = /\b(?:insert|update|delete|alter|drop|vacuum|reindex|restart|cron\.schedule)\b/iu;
const CONTRACT_PATH = "scripts/fixtures/supabase-management-read-only-query-contract.json";
const MAX_PAYLOAD_BYTES = 256 * 1024;

function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function statement(sql) {
  const value = `begin transaction read only; set local statement_timeout = '4000ms'; set local lock_timeout = '500ms'; set local application_name = 'tips_free_tier_evidence_v1'; ${sql}; commit;`;
  if (FORBIDDEN_SQL.test(value)) throw new Error("resource_evidence_manifest_forbidden_sql");
  return value;
}

const sectionStatements = {
  database: statement("select pg_catalog.pg_database_size(pg_catalog.current_database()) as database_bytes"),
  relations: statement("select n.nspname as schema_name, c.relname, pg_catalog.pg_total_relation_size(c.oid) as total_bytes from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','m','i','t') order by pg_catalog.pg_total_relation_size(c.oid) desc limit 20"),
  activity_blockers: statement("select a.state, pg_catalog.count(*)::bigint as session_count, pg_catalog.max(pg_catalog.clock_timestamp() - a.query_start) filter (where a.query_start is not null) as max_query_age from pg_catalog.pg_stat_activity a group by a.state order by session_count desc limit 20"),
  statements: statement("select s.queryid::text, s.calls, s.total_exec_time, s.shared_blks_read, encode(extensions.digest(s.query, 'sha256'), 'hex') as statement_sha256 from extensions.pg_stat_statements s order by s.total_exec_time desc, s.shared_blks_read desc limit 20"),
  scans: statement("select relname, seq_scan, seq_tup_read, idx_scan, n_dead_tup, last_autovacuum from pg_catalog.pg_stat_user_tables order by seq_tup_read desc limit 20"),
  cron: statement("select jobname, active, schedule from cron.job where jobname = 'tips-registration-customer-reminder-v1' limit 20"),
  audit_growth: statement("select pg_catalog.date_trunc('month', created_at) as month, pg_catalog.count(*)::bigint as row_count, pg_catalog.sum(pg_catalog.pg_column_size(a.*))::bigint as bytes_estimate from public.dashboard_audit_logs a group by 1 order by 1 desc limit 20"),
  extensions_resets: statement("select pg_catalog.current_setting('server_version') as server_version, d.stats_reset as database_stats_reset, i.stats_reset as statements_stats_reset, exists(select 1 from pg_catalog.pg_extension where extname = 'pg_stat_statements') as has_pg_stat_statements, exists(select 1 from pg_catalog.pg_extension where extname = 'pg_cron') as has_pg_cron, exists(select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') as has_pgcrypto from pg_catalog.pg_stat_database d left join extensions.pg_stat_statements_info i on true where d.datname = pg_catalog.current_database() limit 1"),
};

export const RESOURCE_EVIDENCE_SECTIONS = [
  ...Object.entries(sectionStatements).map(([id, sql]) => ({ id, sql, checksum: sha256(sql), maxRows: 20 })),
  { id: "advisors", checksum: sha256("GET:/advisors/performance+security"), maxRows: 20 },
];

function fail(code) { throw new Error(code); }
function flagValues(argv, flag) { return argv.flatMap((item, index) => item === flag ? [argv[index + 1]] : []); }
function one(argv, flag) { const values = flagValues(argv, flag); return values.length === 1 ? values[0] : undefined; }
function cleanOutputPath(value) {
  if (typeof value !== "string" || !isAbsolute(value)) fail("resource_evidence_output_path_invalid");
  return resolve(value);
}

export function parseResourceEvidenceArguments(argv) {
  if (flagValues(argv, "--token").length || flagValues(argv, "--project-ref").length || argv.some((value) => /^(?:sbp_|postgres(?:ql)?:\/\/)/iu.test(value))) fail("resource_evidence_argv_secret_refused");
  const mode = one(argv, "--mode");
  if (mode !== "plan" && mode !== "execute") fail("resource_evidence_arguments_invalid");
  const args = { mode, authorized: argv.includes("--authorized"), output: one(argv, "--output"), requestId: one(argv, "--request-id") };
  if (mode === "execute") {
    if (!args.authorized) fail("resource_evidence_approval_required");
    args.output = cleanOutputPath(args.output);
    if (!REQUEST_ID.test(args.requestId || "")) fail("resource_evidence_arguments_invalid");
  }
  return args;
}

function apiFailure(status) {
  return ({ 401: "credential_invalid", 403: "database_read_permission_missing", 404: "endpoint_contract_drift", 405: "endpoint_contract_drift", 429: "rate_limited_no_output", 500: "provider_unavailable_no_output" })[status] || "management_api_contract_drift";
}

async function writeAtomicExclusive(path, value) {
  try { await lstat(path); fail("resource_evidence_output_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    try { await lstat(path); fail("resource_evidence_output_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(temp, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temp, { force: true });
    throw error;
  }
}

async function loadContract(readFile) {
  const contract = JSON.parse(await readFile(resolve(ROOT, CONTRACT_PATH), "utf8"));
  if (contract?.method !== "POST" || contract?.pathTemplate !== "/v1/projects/{ref}/database/query/read-only" || contract?.successStatus !== 201) fail("management_api_contract_drift");
  return contract;
}

function iso(value) { return new Date(value).toISOString(); }
function validResponse(value) {
  if (!value || typeof value !== "object") fail("management_api_contract_drift");
  const rows = Array.isArray(value) ? value : Array.isArray(value.result) ? value.result : value.data;
  if (!Array.isArray(rows) || rows.length > 20) fail("management_api_contract_drift");
  return rows;
}

export async function collectSupabaseResourceEvidence({ argv = process.argv.slice(2), env = process.env, fetch = globalThis.fetch, readFile = (path, encoding) => import("node:fs/promises").then(({ readFile: read }) => read(path, encoding)), stdout = (line) => process.stdout.write(`${line}\n`), now = () => new Date(), monotonic = () => performance.now() } = {}) {
  const args = parseResourceEvidenceArguments(argv);
  const manifest = RESOURCE_EVIDENCE_SECTIONS.map(({ id, checksum, maxRows }) => ({ id, checksum, maxRows }));
  if (args.mode === "plan") { stdout(JSON.stringify({ mode: "plan", sections: manifest, maxDbSections: 8, maxPayloadBytes: MAX_PAYLOAD_BYTES })); return { mode: "plan", sections: manifest }; }
  if (typeof env.SUPABASE_DATABASE_READ_TOKEN !== "string" || !env.SUPABASE_DATABASE_READ_TOKEN || !PROJECT_REF.test(env.SUPABASE_PROJECT_REF || "")) fail("resource_evidence_credentials_missing");
  const contract = await loadContract(readFile);
  const endpoint = `https://api.supabase.com${contract.pathTemplate.replace("{ref}", env.SUPABASE_PROJECT_REF)}`;
  const request = async (query, parameters = []) => {
    const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${env.SUPABASE_DATABASE_READ_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, parameters }) });
    if (response.status !== 201) fail(apiFailure(response.status));
    return validResponse(await response.json());
  };
  const clientStartedAt = iso(now()); const startedMonotonic = monotonic();
  let startRows;
  try { startRows = await request(statement("select pg_catalog.clock_timestamp() as captured_at")); } catch (error) { if (error?.message === "resource_evidence_manifest_forbidden_sql") throw error; fail("evidence_bracket_incomplete"); }
  const sections = {};
  for (const { id, sql } of RESOURCE_EVIDENCE_SECTIONS.filter(({ id }) => id !== "advisors")) sections[id] = { available: true, rows: await request(sql) };
  const advisors = {};
  for (const kind of ["performance", "security"]) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/advisors/${kind}`, { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${env.SUPABASE_DATABASE_READ_TOKEN}` } });
    advisors[kind] = response.status === 200 ? await response.json() : { available: false, errorCode: "advisor_unavailable" };
  }
  sections.advisors = advisors;
  let endRows;
  try { endRows = await request(statement("select pg_catalog.clock_timestamp() as captured_at")); } catch (error) { if (error?.message === "resource_evidence_manifest_forbidden_sql") throw error; fail("evidence_bracket_incomplete"); }
  const clientEndedAt = iso(now()); const monotonicDurationMs = monotonic() - startedMonotonic;
  const bracket = { startedAt: startRows[0]?.captured_at, endedAt: endRows[0]?.captured_at };
  const starts = Date.parse(clientStartedAt); const ends = Date.parse(clientEndedAt); const dbStarts = Date.parse(bracket.startedAt); const dbEnds = Date.parse(bracket.endedAt);
  if (![starts, ends, dbStarts, dbEnds, monotonicDurationMs].every(Number.isFinite) || starts > dbStarts || dbStarts > dbEnds || dbEnds > ends || monotonicDurationMs < 0) fail("evidence_bracket_incomplete");
  const marker = sections.extensions_resets.rows[0] || {};
  const evidence = {
    version: 1, requestId: args.requestId, projectRef: env.SUPABASE_PROJECT_REF,
    clientStartedAt, clientEndedAt, monotonicDurationMs, bracket,
    environment: {
      postgresVersion: marker.server_version || null,
      databaseStatsReset: marker.database_stats_reset || null,
      statementsStatsReset: marker.statements_stats_reset || null,
      extensions: { pg_stat_statements: Boolean(marker.has_pg_stat_statements), pg_cron: Boolean(marker.has_pg_cron), pgcrypto: Boolean(marker.has_pgcrypto) },
    },
    sections,
  };
  if (Buffer.byteLength(JSON.stringify(evidence), "utf8") > MAX_PAYLOAD_BYTES) fail("resource_evidence_payload_exceeded");
  await writeAtomicExclusive(args.output, evidence);
  return evidence;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) collectSupabaseResourceEvidence().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
