import type {
  ImmediateNotificationAdapterDependencies,
  ImmediateNotificationAuthoritativeRevalidationInput,
} from "./immediate-notification-adapter.ts"
import type { NotificationRevalidationResult } from "../notification-workflow-adapter.ts"

type JsonRecord = Record<string, unknown>

export type ImmediateNotificationReadRpc = (
  name: string,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<unknown>

const CANCELED_REASONS = new Set([
  "source_status_changed",
  "source_schedule_changed",
  "source_revision_changed",
  "rule_revision_changed",
  "recipient_revoked",
])
const FAILED_REASONS = new Set([
  "retry_window_closed",
  "schedule_validation_failed",
  "payload_schema_unsupported",
  "render_validation_failed",
])
const FAIL_CLOSED: NotificationRevalidationResult = Object.freeze({
  ok: false,
  status: "failed",
  reason: "payload_schema_unsupported",
})

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonRecord, expected: ReadonlyArray<string>) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function wireRevalidationResult(value: unknown): NotificationRevalidationResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return FAIL_CLOSED
  if (value.ok) return hasExactKeys(value, ["ok"]) ? Object.freeze({ ok: true }) : FAIL_CLOSED
  if (
    !hasExactKeys(value, ["ok", "reason", "status"])
    || typeof value.status !== "string"
    || typeof value.reason !== "string"
  ) return FAIL_CLOSED
  if (value.status === "canceled" && CANCELED_REASONS.has(value.reason)) {
    return Object.freeze({
      ok: false,
      status: "canceled",
      reason: value.reason as Extract<NotificationRevalidationResult, { status: "canceled" }>["reason"],
    })
  }
  if (value.status === "failed" && FAILED_REASONS.has(value.reason)) {
    return Object.freeze({
      ok: false,
      status: "failed",
      reason: value.reason as Extract<NotificationRevalidationResult, { status: "failed" }>["reason"],
    })
  }
  return FAIL_CLOSED
}

function parametersFor(input: ImmediateNotificationAuthoritativeRevalidationInput) {
  return Object.freeze({
    p_workflow_key: input.workflowKey,
    p_event_id: input.eventId,
    p_delivery_id: input.deliveryId,
    p_event_key: input.eventKey,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_source_revision: input.sourceRevision,
    p_rule_id: input.ruleId,
    p_rule_revision: input.ruleRevision,
    p_target_generation: input.targetGeneration,
    p_scheduled_for: input.scheduledFor,
    p_target: Object.freeze({
      target_kind: input.target.targetKind,
      target_key: input.target.targetKey,
      target_profile_id: input.target.targetProfileId,
      connection_key: input.target.connectionKey,
      target_snapshot: input.target.targetSnapshot,
    }),
  })
}

function sourceUnavailable(): never {
  throw Object.assign(new Error("notification_authoritative_source_unavailable"), {
    code: "notification_source_unavailable",
  })
}

export function createImmediateNotificationRpcDependencies(input: Readonly<{
  rpc: ImmediateNotificationReadRpc
}>): ImmediateNotificationAdapterDependencies {
  if (!input || typeof input.rpc !== "function") sourceUnavailable()
  return Object.freeze({
    async revalidateAuthoritativeSource(request) {
      let data: unknown
      try {
        data = await input.rpc(
          "revalidate_immediate_notification_delivery_v1",
          parametersFor(request),
        )
      } catch {
        sourceUnavailable()
      }
      return wireRevalidationResult(data)
    },
  })
}

type SupabaseRpcClient = Readonly<{
  rpc(name: string, parameters: JsonRecord): PromiseLike<Readonly<{
    data: unknown
    error: unknown
  }>>
}>

function isAutomatedTestRuntime() {
  return process.env.NODE_ENV === "test"
    || typeof process.env.NODE_TEST_CONTEXT === "string"
    || process.argv.includes("--test")
    || process.execArgv.includes("--test")
}

function environmentValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ""
}

function createProductionDependencies(): ImmediateNotificationAdapterDependencies {
  let clientPromise: Promise<SupabaseRpcClient> | null = null
  const client = async () => {
    if (isAutomatedTestRuntime()) sourceUnavailable()
    const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL")
    const serviceRoleKey = environmentValue("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !serviceRoleKey) sourceUnavailable()
    clientPromise ||= import("@supabase/supabase-js").then(({ createClient }) => createClient(
      url,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    ) as unknown as SupabaseRpcClient)
    return clientPromise
  }
  return createImmediateNotificationRpcDependencies({
    async rpc(name, parameters) {
      const response = await (await client()).rpc(name, parameters as JsonRecord)
      if (response.error) sourceUnavailable()
      return response.data
    },
  })
}

export const immediateNotificationProductionDependencies = createProductionDependencies()
