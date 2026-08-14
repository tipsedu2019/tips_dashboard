import { lstat, mkdir, open, rename, rm, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{7,127}$/u;
const PROJECT_REF = /^[a-z0-9]{20}$/u;
const CONTRACT = "scripts/fixtures/supabase-management-read-only-query-contract.json";
const PREVIEW_QUERY = `begin transaction read only; set local statement_timeout = '4000ms'; set local lock_timeout = '500ms'; set local application_name = 'tips_free_tier_audit_archive_preview_v1'; select pg_catalog.date_trunc('month', changed_at at time zone 'Asia/Seoul')::date as month, pg_catalog.min(changed_at) as min_changed_at, pg_catalog.max(changed_at) as max_changed_at, pg_catalog.count(*)::text as row_count, pg_catalog.sum(pg_catalog.pg_column_size(id) + pg_catalog.pg_column_size(changed_at))::bigint as estimated_bytes from public.dashboard_audit_logs where changed_at < $1 group by 1 order by 1 desc limit 6; commit;`;
const INDEX_QUERY = `begin transaction read only; set local statement_timeout = '4000ms'; set local lock_timeout = '500ms'; set local application_name = 'tips_free_tier_audit_archive_preview_v1'; select indexrelid::regclass::text as index_name from pg_catalog.pg_index where indrelid = 'public.dashboard_audit_logs'::regclass and pg_catalog.pg_get_indexdef(indexrelid) ~ '^CREATE INDEX .*\\(changed_at' limit 1; commit;`;
const EXPLAIN_QUERY = `begin transaction read only; set local statement_timeout = '4000ms'; set local lock_timeout = '500ms'; set local application_name = 'tips_free_tier_audit_archive_preview_v1'; explain (format json) select pg_catalog.date_trunc('month', changed_at at time zone 'Asia/Seoul')::date from public.dashboard_audit_logs where changed_at < $1 group by 1 order by 1 desc limit 6; commit;`;

function fail(code) { throw new Error(code); }
function values(argv, flag) { return argv.flatMap((value, index) => value === flag ? [argv[index + 1]] : []); }
function one(argv, flag) { const found = values(argv, flag); return found.length === 1 ? found[0] : undefined; }
function parseAsOf(value) { const date = new Date(value || ""); if (!/^\d{4}-\d{2}-\d{2}T/u.test(value || "") || !Number.isFinite(date.valueOf())) fail("audit_archive_preview_as_of_invalid"); return date; }
function completedCutoff(asOf) { const kst = new Date(asOf.toLocaleString("en-US", { timeZone: "Asia/Seoul" })); return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 6, 1)); }

export function parseAuditArchivePreviewArguments(argv) {
  if (values(argv, "--token").length || values(argv, "--project-ref").length) fail("audit_archive_preview_argv_secret_refused");
  const mode = one(argv, "--mode"); const asOf = one(argv, "--as-of"); const output = one(argv, "--output"); const requestId = one(argv, "--request-id");
  if (mode !== "plan" && mode !== "execute") fail("audit_archive_preview_arguments_invalid");
  parseAsOf(asOf);
  if (mode === "execute") {
    if (!argv.includes("--authorized")) fail("audit_archive_preview_approval_required");
    if (!isAbsolute(output || "") || !REQUEST_ID.test(requestId || "")) fail("audit_archive_preview_arguments_invalid");
  }
  return { mode, asOf, output: output && resolve(output), requestId };
}

async function exclusiveJson(path, value) {
  try { await lstat(path); fail("audit_archive_preview_output_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`; let handle;
  try { handle = await open(temp, "wx", 0o600); await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); await handle.close(); handle = undefined; await rename(temp, path); }
  catch (error) { await handle?.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
}

function fixedPreview(asOf, errorCode = "bounded_index_required") { return { version: 1, asOf, candidateOnly: true, archiveVerified: false, deleteAuthorized: false, available: false, errorCode, months: [] }; }

export async function previewDashboardAuditArchive({ argv = process.argv.slice(2), env = process.env, fetch = globalThis.fetch, stdout = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const args = parseAuditArchivePreviewArguments(argv);
  if (args.mode === "plan") { stdout(JSON.stringify({ mode: "plan", maxMonths: 6, candidateOnly: true, archiveVerified: false, deleteAuthorized: false })); return fixedPreview(args.asOf); }
  if (!PROJECT_REF.test(env.SUPABASE_PROJECT_REF || "") || !env.SUPABASE_DATABASE_READ_TOKEN) fail("audit_archive_preview_credentials_missing");
  const contract = JSON.parse(await readFile(resolve(ROOT, CONTRACT), "utf8"));
  if (contract.method !== "POST" || contract.pathTemplate !== "/v1/projects/{ref}/database/query/read-only" || contract.successStatus !== 201) fail("audit_archive_preview_contract_drift");
  const endpoint = `https://api.supabase.com${contract.pathTemplate.replace("{ref}", env.SUPABASE_PROJECT_REF)}`;
  const request = async (query, parameters = []) => { const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${env.SUPABASE_DATABASE_READ_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, parameters }) }); if (response.status !== 201) fail("audit_archive_preview_read_failed"); const data = await response.json(); if (!Array.isArray(data)) fail("audit_archive_preview_contract_drift"); return data; };
  const index = await request(INDEX_QUERY);
  if (index.length !== 1) { const result = fixedPreview(args.asOf); await exclusiveJson(args.output, result); return result; }
  const explain = await request(EXPLAIN_QUERY, [completedCutoff(parseAsOf(args.asOf)).toISOString()]);
  const planText = JSON.stringify(explain);
  if (/seq scan/iu.test(planText) || /"plan rows"\s*:\s*(?:1\d{5,}|[2-9]\d{5}|100000)/u.test(planText)) { const result = fixedPreview(args.asOf); await exclusiveJson(args.output, result); return result; }
  const rows = await request(PREVIEW_QUERY, [completedCutoff(parseAsOf(args.asOf)).toISOString()]);
  const months = rows.slice(0, 6).map(({ month, min_changed_at, max_changed_at, row_count, estimated_bytes }) => ({ month, minChangedAt: min_changed_at, maxChangedAt: max_changed_at, rowCount: String(row_count), estimatedBytes: String(estimated_bytes) }));
  const result = { version: 1, asOf: args.asOf, candidateOnly: true, archiveVerified: false, deleteAuthorized: false, available: true, months };
  await exclusiveJson(args.output, result); return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) previewDashboardAuditArchive().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
