import { createClient } from "@supabase/supabase-js"

import { authenticateNotificationRequest, requireNotificationRole } from "./notification-auth.ts"
import {
  NOTIFICATION_WORKFLOW_OPTIONS,
  type NotificationWorkflowKey,
} from "../notification-control-plane-types.ts"
import type { NotificationMentionSettingDto } from "../notification-mention-settings-types.ts"

const WORKFLOW_KEYS = new Set<string>(NOTIFICATION_WORKFLOW_OPTIONS.map(({ key }) => key))
const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type AuthContext = Readonly<{ userId: string; role: string; client: unknown }>

type HandlerDependencies = Readonly<{
  authenticate: (request: Request) => Promise<AuthContext>
  getMentionSettings: (input: {
    workflowKey: NotificationWorkflowKey
    client: unknown
  }) => Promise<unknown>
  saveMentionSetting: (input: {
    ruleId: string
    mentionEnabled: boolean
    expectedRevision: string
    requestId: string
    client: unknown
  }) => Promise<unknown>
}>

type StructuredError = Error & { status?: number; code?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

function badRequest() {
  return json({ ok: false, code: "notification_invalid_request" }, 400)
}

function unsafeResponse(message: string): StructuredError {
  const error = new Error(message) as StructuredError
  error.status = 502
  error.code = "notification_unsafe_response"
  return error
}

function workflowKey(value: unknown): NotificationWorkflowKey | null {
  return typeof value === "string" && WORKFLOW_KEYS.has(value)
    ? value as NotificationWorkflowKey
    : null
}

function parseRpcSetting(input: unknown): NotificationMentionSettingDto {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "ruleId",
      "workflowKey",
      "eventKey",
      "channelKey",
      "mentionEnabled",
      "revision",
      "updatedAt",
      "editable",
    ]) ||
    typeof input.ruleId !== "string" ||
    !UUID.test(input.ruleId) ||
    typeof input.workflowKey !== "string" ||
    !WORKFLOW_KEYS.has(input.workflowKey) ||
    typeof input.eventKey !== "string" ||
    input.eventKey.length === 0 ||
    input.channelKey !== "google_chat" ||
    typeof input.mentionEnabled !== "boolean" ||
    typeof input.revision !== "string" ||
    !DECIMAL_REVISION.test(input.revision) ||
    (input.updatedAt !== null && typeof input.updatedAt !== "string") ||
    input.editable !== true
  ) {
    throw unsafeResponse("unsafe mention setting")
  }
  return {
    ruleId: input.ruleId,
    workflowKey: input.workflowKey as NotificationWorkflowKey,
    eventKey: input.eventKey,
    channelKey: "google_chat",
    mentionEnabled: input.mentionEnabled,
    revision: input.revision,
    updatedAt: input.updatedAt,
    editable: true,
  }
}

function settingToWire(setting: NotificationMentionSettingDto) {
  return {
    rule_id: setting.ruleId,
    workflow_key: setting.workflowKey,
    event_key: setting.eventKey,
    channel_key: setting.channelKey,
    mention_enabled: setting.mentionEnabled,
    revision: setting.revision,
    updated_at: setting.updatedAt,
    editable: setting.editable,
  }
}

function parsePatchBody(input: unknown) {
  if (
    !isRecord(input) ||
    !exactKeys(input, ["rule_id", "mention_enabled", "expected_revision", "request_id"]) ||
    typeof input.rule_id !== "string" ||
    !UUID.test(input.rule_id) ||
    typeof input.mention_enabled !== "boolean" ||
    typeof input.expected_revision !== "string" ||
    !DECIMAL_REVISION.test(input.expected_revision) ||
    typeof input.request_id !== "string" ||
    !UUID.test(input.request_id)
  ) return null
  return {
    ruleId: input.rule_id,
    mentionEnabled: input.mention_enabled,
    expectedRevision: input.expected_revision,
    requestId: input.request_id,
  }
}

function errorResponse(error: unknown) {
  const structured = error as StructuredError
  const status = Number.isInteger(structured?.status) ? structured.status! : 503
  const code = typeof structured?.code === "string"
    ? structured.code
    : "notification_service_unavailable"
  return json({ ok: false, code }, status)
}

export function createNotificationMentionSettingsRouteHandlers(dependencies: HandlerDependencies) {
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
        const result = await dependencies.getMentionSettings({
          workflowKey: selectedWorkflow,
          client: context.client,
        })
        if (!Array.isArray(result)) throw unsafeResponse("unsafe mention settings")
        const settings = result.map(parseRpcSetting)
        if (settings.some((setting) => setting.workflowKey !== selectedWorkflow)) {
          throw unsafeResponse("unsafe mention workflow")
        }
        return json({ settings: settings.map(settingToWire) })
      } catch (error) {
        return errorResponse(error)
      }
    },

    async patch(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        requireNotificationRole(context, ["admin", "staff"])
        const parsed = parsePatchBody(await request.json().catch(() => null))
        if (!parsed) return badRequest()
        const setting = parseRpcSetting(await dependencies.saveMentionSetting({
          ...parsed,
          client: context.client,
        }))
        if (setting.ruleId !== parsed.ruleId) throw unsafeResponse("unsafe mention setting identity")
        return json({ setting: settingToWire(setting) })
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

async function mentionRpc(client: unknown, name: string, parameters: Record<string, unknown>) {
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
  if (!error) return data

  const failure = new Error("notification mention setting RPC failed") as StructuredError
  const code = isRecord(error) && typeof error.code === "string" ? error.code : ""
  const message = isRecord(error) && typeof error.message === "string" ? error.message : ""
  if (code === "40001" || message.includes("notification_mention_setting_revision_conflict")) {
    failure.status = 409
    failure.code = "notification_mention_setting_revision_conflict"
  } else if (code === "42501" || message.includes("notification_access_denied")) {
    failure.status = 403
    failure.code = "notification_forbidden"
  } else if (
    code === "22023" ||
    code === "P0002" ||
    message.includes("notification_mention_setting_invalid") ||
    message.includes("notification_mention_setting_not_found")
  ) {
    failure.status = 400
    failure.code = "notification_invalid_request"
  } else {
    failure.status = 503
    failure.code = "notification_service_unavailable"
  }
  throw failure
}

export function createProductionNotificationMentionSettingsRouteHandlers() {
  return createNotificationMentionSettingsRouteHandlers({
    authenticate: (request) => authenticateNotificationRequest(request, { createAuthenticatedClient }),
    getMentionSettings: ({ workflowKey, client }) => mentionRpc(
      client,
      "list_notification_rule_mention_settings_v1",
      { p_workflow_key: workflowKey },
    ),
    saveMentionSetting: ({ ruleId, mentionEnabled, expectedRevision, requestId, client }) => mentionRpc(
      client,
      "save_notification_rule_mention_setting_v1",
      {
        p_rule_id: ruleId,
        p_mention_enabled: mentionEnabled,
        p_expected_revision: expectedRevision,
        p_request_id: requestId,
      },
    ),
  })
}
