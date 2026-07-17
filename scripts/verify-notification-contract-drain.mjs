import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const SHA256 = /^[a-f0-9]{64}$/

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function timestamp(value) {
  if (typeof value !== "string" || !value) return Number.NaN
  return Date.parse(value)
}

function coversFullSeoulCalendarDay(windowStart, windowEnd) {
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return false
  const day = 24 * 60 * 60_000
  const seoulOffset = 9 * 60 * 60_000
  const localStart = windowStart + seoulOffset
  const localDayStart = Math.floor(localStart / day) * day
  const firstCompleteDayStart = localStart === localDayStart
    ? localDayStart
    : localDayStart + day
  return windowEnd >= firstCompleteDayStart - seoulOffset + day
}

export function verifyNotificationContractDrain(evidence, now = Date.now()) {
  const blockers = []
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { passed: false, blockers: ["contract_drain_evidence_invalid"] }
  }
  if (evidence.evidenceVersion !== 2) blockers.push("database_evidence_version_invalid")
  if (evidence.evidenceSource !== "get_notification_contract_drain_evidence_v1") {
    blockers.push("database_telemetry_source_invalid")
  }
  const windowStart = timestamp(evidence.windowStart)
  const windowEnd = timestamp(evidence.windowEnd)
  const bridgeInstalledAt = timestamp(evidence.bridgeInstalledAt)
  const measuredHours = (windowEnd - windowStart) / 3_600_000
  if (
    !Number.isFinite(windowStart)
    || !Number.isFinite(windowEnd)
    || !Number.isFinite(bridgeInstalledAt)
    || windowEnd <= windowStart
  ) {
    blockers.push("database_telemetry_window_invalid")
  }
  if (
    !Number.isFinite(now)
    || (Number.isFinite(windowEnd) && (
      windowEnd < now - 5 * 60_000
      || windowEnd > now + 60_000
    ))
  ) blockers.push("database_telemetry_window_not_trailing")
  if (Number.isFinite(bridgeInstalledAt) && Number.isFinite(windowStart) && bridgeInstalledAt > windowStart) {
    blockers.push("bridge_not_installed_before_window")
  }
  if (
    !finiteNumber(evidence.continuousHours)
    || evidence.continuousHours < 24
    || !Number.isFinite(measuredHours)
    || measuredHours < 24
    || Math.abs(measuredHours - evidence.continuousHours) > 0.01
  ) {
    blockers.push("zero_traffic_window_under_24_hours")
  }
  if (!coversFullSeoulCalendarDay(windowStart, windowEnd)) {
    blockers.push("seoul_full_operating_day_not_covered")
  }
  if (evidence.fullOperatingDayCovered !== true) blockers.push("full_operating_day_missing")
  if (evidence.untranslatableOldContractTraffic !== 0) blockers.push("old_contract_traffic_detected")
  if (!finiteNumber(evidence.v2SourceTraffic)) blockers.push("v2_source_traffic_invalid")
  if (evidence.sourceIdTranslatorFailures !== 0) blockers.push("source_id_translator_failure")
  if (evidence.pendingV2RouteOutcomes !== 0) blockers.push("v2_route_outcome_pending")
  if (evidence.failedV2RouteOutcomes !== 0) blockers.push("v2_route_failure_detected")
  if (!finiteNumber(evidence.successfulV2RouteOutcomes)) blockers.push("v2_route_success_count_invalid")
  if (!Number.isSafeInteger(evidence.opsTaskRouteSuccesses) || evidence.opsTaskRouteSuccesses <= 0) {
    blockers.push("ops_task_route_success_missing")
  }
  if (!Number.isSafeInteger(evidence.makeupRouteSuccesses) || evidence.makeupRouteSuccesses <= 0) {
    blockers.push("makeup_route_success_missing")
  }

  const earliestReceiptAt = timestamp(evidence.earliestDeploymentReceiptAt)
  const latestReceiptAt = timestamp(evidence.latestDeploymentReceiptAt)
  if (!Number.isSafeInteger(evidence.deploymentReceiptCount) || evidence.deploymentReceiptCount <= 0) {
    blockers.push("deployment_receipt_missing")
  }
  if (
    !Number.isFinite(earliestReceiptAt)
    || !Number.isFinite(latestReceiptAt)
    || earliestReceiptAt > windowStart + 5 * 60_000
    || latestReceiptAt < windowEnd - 5 * 60_000
    || latestReceiptAt > windowEnd
  ) {
    blockers.push("deployment_receipt_window_incomplete")
  }
  if (
    !finiteNumber(evidence.maximumDeploymentReceiptGapSeconds)
    || evidence.maximumDeploymentReceiptGapSeconds > 600
  ) blockers.push("deployment_receipt_gap_exceeded")
  if (evidence.deploymentEvidenceCoversWindow !== true) {
    blockers.push("deployment_evidence_window_not_covered")
  }
  if (evidence.preBridgeServerInstances !== 0) blockers.push("pre_bridge_server_not_drained")
  if (evidence.bridgeAwareServerRatio !== 1) blockers.push("bridge_aware_servers_incomplete")
  if (evidence.deploymentBuildRevisionCount !== 1) {
    blockers.push("deployment_build_revision_changed")
  }
  if (!SHA256.test(evidence.latestCompliantBuildRevisionHash || "")) {
    blockers.push("deployment_build_revision_invalid")
  }
  if (evidence.closureReady !== true) blockers.push("database_closure_not_ready")
  return { passed: blockers.length === 0, blockers }
}

async function main() {
  const evidenceIndex = process.argv.indexOf("--evidence")
  if (evidenceIndex < 0 || !process.argv[evidenceIndex + 1]) {
    throw new Error("--evidence JSON 파일이 필요합니다.")
  }
  const evidence = JSON.parse(await readFile(process.argv[evidenceIndex + 1], "utf8"))
  const result = verifyNotificationContractDrain(evidence)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.passed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "contract drain 검증에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
