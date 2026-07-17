import { createClient } from "@supabase/supabase-js"

import {
  authenticateNotificationRequest,
  requireNotificationRole,
} from "./notification-auth.ts"
import {
  NOTIFICATION_WORKFLOW_OPTIONS,
  NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN,
  parseNotificationControlPlaneSnapshot,
  type NotificationControlPlaneSnapshot,
  type NotificationRevisionMap,
  type NotificationRuleDto,
  type NotificationScheduleConfig,
  type NotificationWorkflowKey,
} from "../notification-control-plane-types.ts"

const WORKFLOW_KEYS = new Set<string>(
  NOTIFICATION_WORKFLOW_OPTIONS.map(({ key }) => key),
)
const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_CONNECTION_MASK = /^chat\.googleapis\.com\/v1\/spaces\/(?:…|[A-Za-z0-9_.-]{1,8}…[A-Za-z0-9_.-]{1,8})\/messages$/

type AuthContext = Readonly<{
  userId: string
  role: string
  client: unknown
}>

type HandlerDependencies = Readonly<{
  authenticate: (request: Request) => Promise<AuthContext>
  getControlPlane: (input: {
    workflowKey: NotificationWorkflowKey
    client: unknown
  }) => Promise<unknown>
  saveControlPlane: (input: {
    workflowKey: NotificationWorkflowKey
    expectedRevisions: NotificationRevisionMap
    patch: { rules: Record<string, Record<string, unknown>> }
    requestId: string
    client: unknown
  }) => Promise<unknown>
}>

type StructuredError = Error & {
  status?: number
  code?: string
  currentSnapshot?: unknown
  currentRevisions?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function badRequest(): Response {
  return json({ ok: false, code: "notification_invalid_request" }, 400)
}

function workflowKey(value: unknown): NotificationWorkflowKey | null {
  return typeof value === "string" && WORKFLOW_KEYS.has(value)
    ? value as NotificationWorkflowKey
    : null
}

function scheduleConfigToWire(value: NotificationScheduleConfig): unknown {
  if (value === null) return null
  if ("leadMinutes" in value) {
    return {
      anchor_key: value.anchorKey,
      lead_minutes: value.leadMinutes,
      timezone: value.timezone,
    }
  }
  return {
    anchor_key: value.anchorKey,
    local_time: value.localTime,
    timezone: value.timezone,
  }
}

function ruleToWire(rule: NotificationRuleDto) {
  return {
    id: rule.id,
    workflow_key: rule.workflowKey,
    event_key: rule.eventKey,
    event_label: rule.eventLabel,
    group_label: rule.groupLabel,
    trigger_description: rule.triggerDescription,
    sort_order: rule.sortOrder,
    audience_key: rule.audienceKey,
    audience_label: rule.audienceLabel,
    channel_key: rule.channelKey,
    channel_label: rule.channelLabel,
    connection_key: rule.connectionKey,
    rule_variant_key: rule.ruleVariantKey,
    delivery_mode: rule.deliveryMode,
    schedule_key: rule.scheduleKey,
    schedule_config: scheduleConfigToWire(rule.scheduleConfig),
    enabled: rule.enabled,
    active_template_id: rule.activeTemplateId,
    revision: rule.revision,
    updated_at: rule.updatedAt,
    template: {
      id: rule.template.id,
      rule_id: rule.template.ruleId,
      version: rule.template.version,
      title_template: rule.template.titleTemplate,
      body_template: rule.template.bodyTemplate,
      allowed_variables: rule.template.allowedVariables.map((variable) => ({
        key: variable.key,
        token: variable.token,
        pii_class: variable.piiClass,
      })),
      payload_schema_version: rule.template.payloadSchemaVersion,
      checksum: rule.template.checksum,
    },
  }
}

function snapshotToWire(snapshot: NotificationControlPlaneSnapshot) {
  for (const connection of snapshot.connections) {
    if (
      connection.webhookUrlMask !== null &&
      !SAFE_CONNECTION_MASK.test(connection.webhookUrlMask)
    ) {
      const error = new Error("unsafe connection mask") as StructuredError
      error.status = 502
      error.code = "notification_unsafe_response"
      throw error
    }
    if (
      connection.lastErrorCode !== null &&
      !NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(connection.lastErrorCode)
    ) {
      const error = new Error("unsafe connection error") as StructuredError
      error.status = 502
      error.code = "notification_unsafe_response"
      throw error
    }
  }
  return {
    scope_key: snapshot.scopeKey,
    workflow_key: snapshot.workflowKey,
    rules: snapshot.rules.map(ruleToWire),
    connections: snapshot.connections.map((connection) => ({
      connection_key: connection.connectionKey,
      connection_state: connection.connectionState,
      revision: connection.revision,
      webhook_url_mask: connection.webhookUrlMask,
      last_verified_at: connection.lastVerifiedAt,
      last_error_code: connection.lastErrorCode,
      editable: connection.editable,
    })),
    delivery_summary: {
      pending_count: snapshot.deliverySummary.pendingCount,
      sent_count: snapshot.deliverySummary.sentCount,
      failed_count: snapshot.deliverySummary.failedCount,
      unknown_count: snapshot.deliverySummary.unknownCount,
      latest_delivery_at: snapshot.deliverySummary.latestDeliveryAt,
    },
    loaded_at: snapshot.loadedAt,
  }
}

function safeSnapshotWire(input: unknown): ReturnType<typeof snapshotToWire> {
  const parsed = parseNotificationControlPlaneSnapshot(input)
  if (!parsed.ok) {
    const error = new Error("unsafe notification snapshot") as StructuredError
    error.status = 502
    error.code = "notification_unsafe_response"
    throw error
  }
  return snapshotToWire(parsed.value)
}

function safeRevisionMap(input: unknown): NotificationRevisionMap | null {
  if (!isRecord(input)) return null
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!UUID.test(key) || typeof value !== "string" || !DECIMAL_REVISION.test(value)) {
      return null
    }
    result[key] = value
  }
  return result
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validScheduleConfig(input: unknown) {
  if (input === null) return true
  if (!isRecord(input) || input.timezone !== "Asia/Seoul" || typeof input.anchor_key !== "string") {
    return false
  }
  if (exactKeys(input, ["anchor_key", "local_time", "timezone"])) {
    return typeof input.local_time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.local_time)
  }
  if (exactKeys(input, ["anchor_key", "lead_minutes", "timezone"])) {
    return Number.isInteger(input.lead_minutes) && (input.lead_minutes as number) >= 0
  }
  return false
}

function parsePatchBody(input: unknown) {
  if (
    !isRecord(input) ||
    !exactKeys(input, ["workflow_key", "expected_revisions", "patch", "request_id"])
  ) return null
  const selectedWorkflow = workflowKey(input.workflow_key)
  const expectedRevisions = safeRevisionMap(input.expected_revisions)
  if (!selectedWorkflow || !expectedRevisions || typeof input.request_id !== "string" || !UUID.test(input.request_id)) {
    return null
  }
  if (!isRecord(input.patch) || !exactKeys(input.patch, ["rules"]) || !isRecord(input.patch.rules)) {
    return null
  }
  const rules: Record<string, Record<string, unknown>> = {}
  const allowedRuleKeys = new Set(["enabled", "title_template", "body_template", "schedule_config"])
  for (const [ruleId, candidate] of Object.entries(input.patch.rules)) {
    if (!UUID.test(ruleId) || !isRecord(candidate)) return null
    const keys = Object.keys(candidate)
    if (keys.length === 0 || keys.some((key) => !allowedRuleKeys.has(key))) return null
    if ("enabled" in candidate && typeof candidate.enabled !== "boolean") return null
    if ("title_template" in candidate && typeof candidate.title_template !== "string") return null
    if ("body_template" in candidate && typeof candidate.body_template !== "string") return null
    if ("schedule_config" in candidate && !validScheduleConfig(candidate.schedule_config)) return null
    rules[ruleId] = candidate
  }
  return {
    workflowKey: selectedWorkflow,
    expectedRevisions,
    patch: { rules },
    requestId: input.request_id,
  }
}

function parseReconciliationJob(input: unknown) {
  if (
    !isRecord(input) ||
    typeof input.job_kind !== "string" ||
    typeof input.job_id !== "string" ||
    typeof input.status !== "string" ||
    !Number.isSafeInteger(input.attempt_count) ||
    (input.attempt_count as number) < 0
  ) return null
  return {
    job_kind: input.job_kind,
    job_id: input.job_id,
    status: input.status,
    attempt_count: input.attempt_count,
  }
}

function safeSuccessPayload(input: unknown) {
  const snapshot = safeSnapshotWire(input)
  if (!isRecord(input) || input.reconciliation_job === undefined) return snapshot
  const reconciliationJob = parseReconciliationJob(input.reconciliation_job)
  if (!reconciliationJob) {
    const error = new Error("unsafe reconciliation job") as StructuredError
    error.status = 502
    error.code = "notification_unsafe_response"
    throw error
  }
  return { ...snapshot, reconciliation_job: reconciliationJob }
}

function errorResponse(error: unknown) {
  const structured = error as StructuredError
  const code = typeof structured?.code === "string"
    ? structured.code
    : "notification_request_failed"
  const status = code === "notification_revision_conflict"
    ? 409
    : Number.isInteger(structured?.status)
      ? structured.status as number
      : 500
  const payload: Record<string, unknown> = { ok: false, code }
  if (code === "notification_revision_conflict") {
    try {
      payload.current_snapshot = safeSnapshotWire(structured.currentSnapshot)
      const revisions = safeRevisionMap(structured.currentRevisions)
      if (!revisions) throw new Error("unsafe revisions")
      payload.current_revisions = revisions
    } catch {
      return json({ ok: false, code: "notification_unsafe_response" }, 502)
    }
  }
  return json(payload, status)
}

export function createNotificationControlPlaneRouteHandlers(dependencies: HandlerDependencies) {
  return {
    async get(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        requireNotificationRole(context, ["admin", "staff"])
        const url = new URL(request.url)
        if (Array.from(url.searchParams.keys()).length !== 1 || !url.searchParams.has("workflow_key")) {
          return badRequest()
        }
        const selectedWorkflow = workflowKey(url.searchParams.get("workflow_key"))
        if (!selectedWorkflow) return badRequest()
        const result = await dependencies.getControlPlane({
          workflowKey: selectedWorkflow,
          client: context.client,
        })
        return json(safeSuccessPayload(result))
      } catch (error) {
        return errorResponse(error)
      }
    },

    async patch(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        requireNotificationRole(context, ["admin", "staff"])
        const body = await request.json().catch(() => null)
        const parsed = parsePatchBody(body)
        if (!parsed) return badRequest()
        const result = await dependencies.saveControlPlane({
          ...parsed,
          client: context.client,
        })
        return json(safeSuccessPayload(result))
      } catch (error) {
        return errorResponse(error)
      }
    },
  }
}

function env(name: string) {
  return typeof process.env[name] === "string" ? process.env[name]!.trim() : ""
}

function createAuthenticatedClient(token: string) {
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("VITE_SUPABASE_URL")
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY")
  if (!url || !anonKey) {
    const error = new Error("Supabase configuration unavailable") as StructuredError
    error.status = 503
    error.code = "notification_auth_unavailable"
    throw error
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function rpc(client: unknown, name: string, parameters: Record<string, unknown>) {
  if (!isRecord(client) || typeof client.rpc !== "function") {
    const error = new Error("invalid authenticated client") as StructuredError
    error.status = 503
    error.code = "notification_service_unavailable"
    throw error
  }
  const { data, error } = await (client.rpc as (
    rpcName: string,
    values: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)(name, parameters)
  if (error) {
    const failure = new Error("notification RPC failed") as StructuredError
    const message = isRecord(error) && typeof error.message === "string" ? error.message : ""
    if (message.includes("notification_revision_conflict")) {
      failure.status = 409
      failure.code = "notification_revision_conflict"
    } else if (message.includes("idempotency_key_reused")) {
      failure.status = 409
      failure.code = "idempotency_key_reused"
    } else if (message.includes("notification_settings_ui_disabled")) {
      failure.status = 409
      failure.code = "notification_settings_ui_disabled"
    } else if (message.includes("notification_google_chat_connection_required")) {
      failure.status = 409
      failure.code = "notification_google_chat_connection_required"
    } else if (message.includes("notification_access_denied")) {
      failure.status = 403
      failure.code = "notification_forbidden"
    } else if (
      message.includes("notification_patch_invalid") ||
      message.includes("notification_workflow_unknown") ||
      message.includes("notification_rule_unknown") ||
      message.includes("notification_invalid")
    ) {
      failure.status = 400
      failure.code = "notification_invalid_request"
    } else {
      failure.status = 503
      failure.code = "notification_service_unavailable"
    }
    throw failure
  }
  if (isRecord(data) && data.ok === false) {
    const failure = new Error("notification RPC rejected") as StructuredError
    failure.code = typeof data.code === "string" ? data.code : "notification_request_failed"
    failure.status = failure.code === "notification_revision_conflict" ? 409 : 400
    failure.currentSnapshot = data.current_snapshot
    failure.currentRevisions = data.current_revisions
    throw failure
  }
  return data
}

export function createProductionNotificationControlPlaneRouteHandlers() {
  return createNotificationControlPlaneRouteHandlers({
    authenticate: (request) => authenticateNotificationRequest(request, { createAuthenticatedClient }),
    getControlPlane: ({ workflowKey, client }) => rpc(
      client,
      "get_notification_control_plane_v1",
      { p_workflow_key: workflowKey },
    ),
    async saveControlPlane({ workflowKey, expectedRevisions, patch, requestId, client }) {
      try {
        return await rpc(
          client,
          "save_notification_control_plane_v1",
          {
            p_workflow_key: workflowKey,
            p_expected_revisions: expectedRevisions,
            p_patch: patch,
            p_request_id: requestId,
          },
        )
      } catch (error) {
        const structured = error as StructuredError
        if (structured.code !== "notification_revision_conflict") throw error
        const currentSnapshot = await rpc(
          client,
          "get_notification_control_plane_v1",
          { p_workflow_key: workflowKey },
        )
        const currentRevisions: Record<string, string> = {}
        if (!isRecord(currentSnapshot) || !Array.isArray(currentSnapshot.rules)) {
          const unsafe = new Error("unsafe conflict snapshot") as StructuredError
          unsafe.status = 502
          unsafe.code = "notification_unsafe_response"
          throw unsafe
        }
        for (const rule of currentSnapshot.rules) {
          if (
            !isRecord(rule) ||
            typeof rule.id !== "string" ||
            !UUID.test(rule.id) ||
            typeof rule.revision !== "string" ||
            !DECIMAL_REVISION.test(rule.revision)
          ) {
            const unsafe = new Error("unsafe conflict revisions") as StructuredError
            unsafe.status = 502
            unsafe.code = "notification_unsafe_response"
            throw unsafe
          }
          currentRevisions[rule.id] = rule.revision
        }
        structured.currentSnapshot = currentSnapshot
        structured.currentRevisions = currentRevisions
        throw structured
      }
    },
  })
}
