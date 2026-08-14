import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseAuditConcurrencyProbeEnvironment(env = process.env) {
  const url = env.TASK_LOCAL_DB_URL;
  const nonce = env.TASK_LOCAL_DB_NONCE;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("audit_chain_probe_local_authorization_required"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/postgres" || typeof nonce !== "string" || !/^[a-z0-9-]{16,128}$/iu.test(nonce)) throw new Error("audit_chain_probe_local_authorization_required");
  return { url, nonce };
}

export function parseAuditConcurrencyProbeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || value.sameEntityChain !== true || value.rollbackGapPreserved !== true) throw new Error("audit_chain_probe_result_drift");
  return value;
}

function discoverLocalDatabaseContainer(configuration) {
  const port = Number(new URL(configuration.url).port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("audit_chain_probe_local_authorization_required");
  const result = spawnSync("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"], { encoding: "utf8" });
  const candidates = String(result.stdout || "").trim().split(/\s+/u).filter(Boolean);
  if (result.status !== 0 || candidates.length !== 1 || !/^[a-f0-9]{12,64}$/u.test(candidates[0])) throw new Error("audit_chain_probe_container_invalid");
  return candidates[0];
}

function runPsql(containerId, sql) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["exec", "-i", containerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise(stdout.trim()) : rejectPromise(new Error(`audit_chain_probe_psql_failed:${stderr.trim()}`)));
    child.stdin.end(sql);
  });
}

export async function executeAuditConcurrencyProbe(configuration) {
  const containerId = discoverLocalDatabaseContainer(configuration);
  const entityId = "a7d17000-0000-4000-8000-000000000001";
  const safeNonce = configuration.nonce.slice(0, 24).replace(/[^a-z0-9-]/giu, "");
  await runPsql(containerId, `
    delete from public.teacher_catalogs where id='${entityId}'::uuid;
    insert into public.teacher_catalogs(id,name,subjects,is_visible,sort_order)
    values ('${entityId}'::uuid,'__audit_probe_${safeNonce}',array['수학']::text[],true,991);
  `);
  const first = runPsql(containerId, `begin; update public.teacher_catalogs set name='__audit_probe_a' where id='${entityId}'::uuid; select pg_catalog.pg_sleep(0.35); commit;`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  const second = runPsql(containerId, `begin; update public.teacher_catalogs set name='__audit_probe_b' where id='${entityId}'::uuid; commit;`);
  await Promise.all([first, second]);
  await runPsql(containerId, `begin; update public.teacher_catalogs set name='__audit_probe_rollback' where id='${entityId}'::uuid; rollback;`);
  await runPsql(containerId, `update public.teacher_catalogs set name='__audit_probe_final' where id='${entityId}'::uuid;`);
  const resultText = await runPsql(containerId, `
    with rows as (
      select audit_chain_id,chain_ordinal,event_sequence,predecessor_event_id
      from public.dashboard_audit_logs
      where entity_table='teacher_catalogs' and entity_id='${entityId}'
      order by event_sequence
    )
    select pg_catalog.json_build_object(
      'version',1,
      'sameEntityChain',
        pg_catalog.count(*)=4
        and pg_catalog.count(distinct audit_chain_id)=1
        and pg_catalog.array_agg(chain_ordinal order by event_sequence)=array[1,2,3,4]::bigint[]
        and pg_catalog.count(predecessor_event_id)=3,
      'rollbackGapPreserved',
        pg_catalog.max(event_sequence)-pg_catalog.min(event_sequence)>=4
    )::text
    from rows;
  `);
  return JSON.parse(resultText.split("\n").at(-1));
}

export async function runAuditConcurrencyProbe({ env = process.env, execute = executeAuditConcurrencyProbe } = {}) {
  const configuration = parseAuditConcurrencyProbeEnvironment(env);
  if (typeof execute !== "function") throw new Error("audit_chain_probe_executor_missing");
  return parseAuditConcurrencyProbeResult(await execute(configuration));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runAuditConcurrencyProbe().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
