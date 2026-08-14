import { fileURLToPath } from "node:url";

export function parseAuditConcurrencyProbeEnvironment(env = process.env) {
  const url = env.TASK_LOCAL_DB_URL;
  const nonce = env.TASK_LOCAL_DB_NONCE;
  if (typeof url !== "string" || !/^postgres(?:ql)?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//iu.test(url) || typeof nonce !== "string" || !/^[a-z0-9-]{16,128}$/iu.test(nonce)) throw new Error("audit_chain_probe_local_authorization_required");
  return { url, nonce };
}

export function parseAuditConcurrencyProbeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || value.sameEntityChain !== true || value.rollbackGapPreserved !== true) throw new Error("audit_chain_probe_result_drift");
  return value;
}

export async function runAuditConcurrencyProbe({ env = process.env, execute } = {}) {
  const configuration = parseAuditConcurrencyProbeEnvironment(env);
  if (typeof execute !== "function") throw new Error("audit_chain_probe_executor_missing");
  return parseAuditConcurrencyProbeResult(await execute(configuration));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runAuditConcurrencyProbe().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
