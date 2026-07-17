import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const FIVE_MINUTES = 5 * 60_000
const SHA256 = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function deterministicUuid(value) {
  const digest = sha256(value)
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}

function httpsOrigin(value) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) throw new Error("운영 origin은 경로가 없는 HTTPS 주소여야 합니다.")
  return parsed
}

async function jsonResponse(response, errorCode) {
  if (!response.ok) throw new Error(`${errorCode}:${response.status}`)
  const value = await response.json().catch(() => null)
  const parsed = record(value)
  if (!parsed) throw new Error(`${errorCode}:invalid_json`)
  return parsed
}

export async function collectNotificationDeploymentReceipt(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch
  const now = dependencies.now || Date.now()
  const origin = httpsOrigin(config.productionOrigin)
  const projectId = text(config.vercelProjectId)
  const teamId = text(config.vercelTeamId)
  const vercelToken = text(config.vercelToken)
  const supabaseUrl = httpsOrigin(config.supabaseUrl)
  const serviceRoleKey = text(config.supabaseServiceRoleKey)
  if (!projectId || !teamId || !vercelToken || !serviceRoleKey || !Number.isFinite(now)) {
    throw new Error("배포 inventory 기록 환경값이 완전하지 않습니다.")
  }

  const deploymentUrl = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(origin.hostname)}`,
  )
  deploymentUrl.searchParams.set("teamId", teamId)
  const deployment = await jsonResponse(await fetchImpl(deploymentUrl, {
    headers: { Authorization: `Bearer ${vercelToken}` },
  }), "vercel_production_inventory_unavailable")
  const deploymentId = text(deployment.id)
  const observedProjectId = text(deployment.projectId || record(deployment.project)?.id)
  const aliases = Array.isArray(deployment.alias) ? deployment.alias.map(text) : []
  if (
    !deploymentId
    || observedProjectId !== projectId
    || deployment.target !== "production"
    || deployment.readyState !== "READY"
    || !aliases.includes(origin.hostname)
  ) throw new Error("Vercel production alias inventory가 기대한 배포와 일치하지 않습니다.")

  const manifestUrl = new URL("/api/notifications/contract-version", origin)
  manifestUrl.searchParams.set("observation", String(Math.floor(now / FIVE_MINUTES)))
  const manifest = await jsonResponse(await fetchImpl(manifestUrl, {
    headers: { "Cache-Control": "no-cache" },
  }), "production_contract_manifest_unavailable")
  const deploymentIdHash = text(manifest.deploymentIdHash)
  const projectIdHash = text(manifest.projectIdHash)
  const buildRevisionHash = text(manifest.buildRevisionHash)
  if (
    manifest.ok !== true
    || manifest.contractVersion !== 2
    || manifest.environment !== "production"
    || !SHA256.test(deploymentIdHash)
    || !SHA256.test(projectIdHash)
    || !SHA256.test(buildRevisionHash)
    || deploymentIdHash !== sha256(deploymentId)
    || projectIdHash !== sha256(projectId)
  ) throw new Error("운영 bundle hash가 Vercel production inventory와 일치하지 않습니다.")

  const observationBucket = Math.floor(now / FIVE_MINUTES)
  const inventoryObservationHash = sha256(JSON.stringify({
    source: "vercel_production_alias_v1",
    deploymentIdHash,
    projectIdHash,
    buildRevisionHash,
    contractVersion: 2,
    observationBucket,
  }))
  const requestId = deterministicUuid(
    `notification-contract-deployment-receipt-v1:${inventoryObservationHash}`,
  )
  const rpcUrl = new URL(
    "/rest/v1/rpc/record_notification_contract_deployment_receipt_v1",
    supabaseUrl,
  )
  const receipt = await jsonResponse(await fetchImpl(rpcUrl, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_request_id: requestId,
      p_project_key_hash: projectIdHash,
      p_build_revision_hash: buildRevisionHash,
      p_contract_version: 2,
      p_observation_bucket: observationBucket,
      p_active_server_deployment_hashes: [deploymentIdHash],
      p_bridge_aware_server_deployment_hashes: [deploymentIdHash],
      p_pre_bridge_server_deployment_hashes: [],
    }),
  }), "deployment_receipt_rpc_failed")
  if (
    receipt.recorded !== true
    || !UUID.test(text(receipt.requestId))
    || receipt.inventorySource !== "vercel_production_alias_v1"
    || receipt.buildRevisionHash !== buildRevisionHash
  ) throw new Error("배포 inventory 영수증 응답이 고정 계약과 다릅니다.")

  return {
    recorded: true,
    requestId: receipt.requestId,
    inventorySource: receipt.inventorySource,
    recordedAt: receipt.recordedAt,
  }
}

async function main() {
  const result = await collectNotificationDeploymentReceipt({
    productionOrigin: process.env.NOTIFICATION_PRODUCTION_ORIGIN,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
    vercelToken: process.env.VERCEL_TOKEN,
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "배포 영수증 기록에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
