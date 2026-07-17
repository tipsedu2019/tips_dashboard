import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/

export const NOTIFICATION_SHADOW_FIXTURE_SCOPES = Object.freeze([
  "tasks",
  "word_retests",
  "approvals",
  "transfer",
  "withdrawal",
  "makeup_requests",
  "registration",
  "registration_phone",
  "registration_visit",
  "registration_solapi",
])

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function deterministicUuid(value) {
  const chars = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("")
  chars[12] = "5"
  chars[16] = "8"
  const hex = chars.join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}

function httpsOrigin(value) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) throw new Error("Supabase URL은 HTTPS origin이어야 합니다.")
  return parsed
}

export function buildNotificationShadowFixturePlan({
  execute = false,
  authorization,
  batchRequestId,
} = {}) {
  const normalizedRequestId = text(batchRequestId)
  if (!UUID.test(normalizedRequestId)) {
    throw new Error("shadow_fixture_batch_request_id_invalid")
  }
  if (execute && authorization !== "shadow-fixture-approved") {
    throw new Error("explicit_shadow_fixture_authorization_required")
  }

  return {
    execute,
    batchRequestId: normalizedRequestId,
    calls: NOTIFICATION_SHADOW_FIXTURE_SCOPES.map((scopeKey) => ({
      rpc: "record_notification_shadow_fixture_evidence_v1",
      parameters: {
        p_scope_key: scopeKey,
        p_request_id: deterministicUuid(
          `notification-shadow-fixture-scope-v1:${normalizedRequestId}:${scopeKey}`,
        ),
      },
    })),
  }
}

export async function executeNotificationShadowFixturePlan(plan, dependencies = {}) {
  if (!plan?.execute || !Array.isArray(plan.calls) || plan.calls.length !== 10) {
    throw new Error("shadow_fixture_execution_plan_invalid")
  }
  const rpc = dependencies.rpc
  if (typeof rpc !== "function") throw new Error("shadow_fixture_rpc_unavailable")

  const results = []
  for (const call of plan.calls) {
    const scopeKey = call.parameters.p_scope_key
    const batchRequestId = call.parameters.p_request_id
    let result
    try {
      result = await rpc(call.rpc, call.parameters)
    } catch (error) {
      const code = text(error?.code || error?.message)
      if (!code.includes("notification_shadow_natural_comparison_required")) throw error
      throw new Error(`notification_shadow_natural_comparison_required:${scopeKey}`)
    }
    const commonContractValid = (
      !result
      ? false
      : result.recorded === true
        && result.scopeKey === scopeKey
        && result.requestId === batchRequestId
        && SHA256.test(text(result.scopeConfigDigest))
        && Number.isSafeInteger(result.enabledRuleCount)
        && result.enabledRuleCount >= 0
    )
    const naturalComparisonValid = (
      result?.evidenceKind === "natural_comparison"
      && result.enabledRuleCount > 0
      && SHA256.test(text(result.comparisonKey))
    )
    const noActiveRuleValid = (
      result?.evidenceKind === "no_active_rule"
      && result.enabledRuleCount === 0
      && result.comparisonKey === null
    )
    if (!commonContractValid || (!naturalComparisonValid && !noActiveRuleValid)) {
      throw new Error(`shadow_fixture_rpc_contract_invalid:${scopeKey}`)
    }
    results.push(result)
  }

  let completion
  try {
    completion = await rpc(
      "verify_notification_shadow_evidence_complete_v1",
      {},
    )
  } catch (error) {
    const code = text(error?.code || error?.message)
    throw new Error(code || "notification_shadow_scope_evidence_incomplete")
  }
  if (
    completion?.verified !== true
    || completion.scopeCount !== NOTIFICATION_SHADOW_FIXTURE_SCOPES.length
  ) {
    throw new Error("shadow_fixture_completion_contract_invalid")
  }

  return {
    recorded: true,
    batchRequestId: plan.batchRequestId,
    completedScopes: results.length,
    scopes: results.map((result) => ({
      scopeKey: result.scopeKey,
      requestId: result.requestId,
      evidenceKind: result.evidenceKind,
      enabledRuleCount: result.enabledRuleCount,
      comparisonKey: result.comparisonKey,
      scopeConfigDigest: result.scopeConfigDigest,
    })),
  }
}

function createSupabaseRpc({ supabaseUrl, serviceRoleKey }, fetchImpl = fetch) {
  const origin = httpsOrigin(supabaseUrl)
  const key = text(serviceRoleKey)
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY가 필요합니다.")
  return async (name, parameters) => {
    const url = new URL(`/rest/v1/rpc/${name}`, origin)
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parameters),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error(`shadow_fixture_rpc_failed:${response.status}`)
      error.code = text(payload?.message || payload?.code || error.message)
      throw error
    }
    return payload
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const execute = process.argv.includes("--apply")
  const plan = buildNotificationShadowFixturePlan({
    execute,
    authorization: argumentValue("--authorization"),
    batchRequestId: argumentValue("--request-id"),
  })
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      mode: "dry-run",
      message: "DB를 변경하지 않았습니다. 10개 범위 실행 계획만 표시합니다.",
      ...plan,
    }, null, 2)}\n`)
    return
  }

  const result = await executeNotificationShadowFixturePlan(plan, {
    rpc: createSupabaseRpc({
      supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "무발송 fixture 실행에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
