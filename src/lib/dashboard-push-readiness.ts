export const DASHBOARD_PUSH_STATES = [
  "checking",
  "unsupported",
  "insecure",
  "server_unconfigured",
  "asset_missing",
  "permission_prompt",
  "permission_denied",
  "subscription_missing",
  "subscription_owner_mismatch",
  "ready",
  "self_test_sent",
  "self_test_expired",
  "self_test_failed",
  "check_failed",
] as const

export type DashboardPushState = typeof DASHBOARD_PUSH_STATES[number]

export type DashboardPushStateFacts = Readonly<{
  browserApisAvailable: boolean
  secureContext: boolean | null
  assetsAvailable: boolean | null
  serverCapability: "configured" | "unconfigured" | "asset_missing" | null
  permission: "default" | "denied" | "granted" | null
  subscriptionPresent: boolean | null
  publicKeyMatches: boolean | null
  ownerBinding: "missing" | "mismatch" | "owned" | null
  checkFailed: boolean
}>

export type DashboardPushSelfTestOutcome = "sent" | "expired" | "failed"

export function resolveDashboardPushState(facts: DashboardPushStateFacts): DashboardPushState {
  if (!facts.browserApisAvailable) return "unsupported"
  if (facts.secureContext === null) return "checking"
  if (!facts.secureContext) return "insecure"
  if (facts.checkFailed) return "check_failed"
  if (facts.serverCapability === null) return "checking"
  if (facts.serverCapability === "unconfigured") return "server_unconfigured"
  if (facts.permission === null) return "checking"
  if (facts.permission === "default") return "permission_prompt"
  if (facts.permission === "denied") return "permission_denied"
  if (facts.assetsAvailable === null) return "checking"
  if (!facts.assetsAvailable || facts.serverCapability === "asset_missing") return "asset_missing"
  if (facts.subscriptionPresent === null) return "checking"
  if (!facts.subscriptionPresent) return "subscription_missing"
  if (facts.publicKeyMatches === null) return "checking"
  if (!facts.publicKeyMatches) return "subscription_owner_mismatch"
  if (facts.ownerBinding === null) return "checking"
  if (facts.ownerBinding === "missing") return "subscription_missing"
  if (facts.ownerBinding === "mismatch") return "subscription_owner_mismatch"
  return "ready"
}

export function applyDashboardPushSelfTestOutcome(
  currentState: DashboardPushState,
  outcome: DashboardPushSelfTestOutcome,
): DashboardPushState {
  if (currentState !== "ready") {
    throw new Error("Push self-test는 ready 상태에서만 실행할 수 있습니다.")
  }
  if (outcome === "sent") return "self_test_sent"
  if (outcome === "expired") return "self_test_expired"
  return "self_test_failed"
}
