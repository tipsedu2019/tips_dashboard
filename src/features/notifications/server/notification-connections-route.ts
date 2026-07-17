import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  NOTIFICATION_CONNECTION_KEYS,
  NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN,
  NOTIFICATION_CONNECTION_STATES,
  type NotificationConnectionDto,
  type NotificationConnectionKey,
} from "../notification-control-plane-types.ts"
import {
  authenticateNotificationRequest,
  requireNotificationRole,
} from "./notification-auth.ts"
import {
  createNotificationConnectionRepository,
  type NotificationConnectionRow,
  type NotificationConnectionStore,
} from "./notification-connection-repository.ts"

const CONNECTION_KEYS = new Set<string>(NOTIFICATION_CONNECTION_KEYS)
const CONNECTION_STATES = new Set<string>(NOTIFICATION_CONNECTION_STATES)
const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_CONNECTION_MASK = /^chat\.googleapis\.com\/v1\/spaces\/(?:…|[A-Za-z0-9_.-]{1,8}…[A-Za-z0-9_.-]{1,8})\/messages$/
const ROW_COLUMNS = [
  "channel",
  "webhook_url",
  "webhook_url_ciphertext",
  "webhook_url_mask",
  "connection_state",
  "revision",
  "updated_by",
  "last_verified_at",
  "last_error_code",
].join(",")

type AuthContext = Readonly<{
  userId: string
  role: string
  client: unknown
}>

type ConnectionRepository = ReturnType<typeof createNotificationConnectionRepository>

type HandlerDependencies = Readonly<{
  authenticate: (request: Request) => Promise<AuthContext>
  repository?: ConnectionRepository
  createRepository?: (context: AuthContext) => Promise<ConnectionRepository> | ConnectionRepository
}>

type StructuredError = Error & { status?: number; code?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(input: Record<string, unknown>, expectedKeys: readonly string[]) {
  const actual = Object.keys(input).sort()
  const expected = [...expectedKeys].sort()
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

function errorResponse(error: unknown) {
  const structured = error as StructuredError
  const code = typeof structured?.code === "string"
    ? structured.code
    : "notification_connection_failed"
  const status = Number.isInteger(structured?.status) ? structured.status as number : 500
  return json({ ok: false, code }, status)
}

function safeConnectionToWire(
  connection: NotificationConnectionDto,
  editable: boolean,
) {
  if (
    !CONNECTION_KEYS.has(connection.connectionKey) ||
    !CONNECTION_STATES.has(connection.connectionState) ||
    typeof connection.revision !== "string" ||
    !DECIMAL_REVISION.test(connection.revision) ||
    (connection.connectionState !== "disconnected" && (
      typeof connection.webhookUrlMask !== "string" ||
      !SAFE_CONNECTION_MASK.test(connection.webhookUrlMask)
    )) ||
    (connection.lastErrorCode !== null && !NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(connection.lastErrorCode))
  ) {
    const error = new Error("unsafe connection response") as StructuredError
    error.status = 502
    error.code = "notification_connection_unsafe_response"
    throw error
  }
  return {
    connection_key: connection.connectionKey,
    connection_state: connection.connectionState,
    revision: connection.revision,
    configured: connection.connectionState !== "disconnected",
    webhook_url_mask: typeof connection.webhookUrlMask === "string"
      ? connection.webhookUrlMask
      : null,
    last_verified_at: typeof connection.lastVerifiedAt === "string"
      ? connection.lastVerifiedAt
      : null,
    last_error_code: typeof connection.lastErrorCode === "string"
      ? connection.lastErrorCode
      : null,
    editable,
  }
}

function parseMutation(input: unknown) {
  if (!isRecord(input) || typeof input.action !== "string") return null
  const connectionKey = input.connection_key
  const expectedRevision = input.expected_revision
  const requestId = input.request_id
  if (
    typeof connectionKey !== "string" ||
    !CONNECTION_KEYS.has(connectionKey) ||
    typeof expectedRevision !== "string" ||
    !DECIMAL_REVISION.test(expectedRevision) ||
    typeof requestId !== "string" ||
    !UUID.test(requestId)
  ) return null

  const identity = {
    connectionKey: connectionKey as NotificationConnectionKey,
    expectedRevision,
    requestId,
  }
  if (input.action === "replace") {
    if (!exactKeys(input, [
      "action",
      "connection_key",
      "webhook_url",
      "expected_revision",
      "request_id",
    ]) || typeof input.webhook_url !== "string") return null
    return { action: "replace" as const, input: { ...identity, webhookUrl: input.webhook_url } }
  }
  if (input.action === "verify") {
    if (!exactKeys(input, [
      "action",
      "connection_key",
      "expected_revision",
      "request_id",
      "confirmed",
    ]) || input.confirmed !== true) return null
    return { action: "verify" as const, input: { ...identity, confirmed: true } }
  }
  if (input.action === "disconnect") {
    if (!exactKeys(input, [
      "action",
      "connection_key",
      "expected_revision",
      "request_id",
    ])) return null
    return { action: "disconnect" as const, input: identity }
  }
  return null
}

export function createNotificationConnectionsRouteHandlers(dependencies: HandlerDependencies) {
  async function repositoryFor(context: AuthContext) {
    if (dependencies.createRepository) return dependencies.createRepository(context)
    if (dependencies.repository) return dependencies.repository
    const error = new Error("connection repository unavailable") as StructuredError
    error.status = 503
    error.code = "notification_connection_unavailable"
    throw error
  }

  return {
    async get(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        requireNotificationRole(context, ["admin", "staff"])
        if (new URL(request.url).searchParams.size !== 0) return badRequest()
        const repository = await repositoryFor(context)
        const connections = await repository.listConnections()
        return json({
          connections: connections.map((connection) => (
            safeConnectionToWire(connection, context.role === "admin")
          )),
        })
      } catch (error) {
        return errorResponse(error)
      }
    },

    async patch(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        requireNotificationRole(context, ["admin"])
        const body = await request.json().catch(() => null)
        const mutation = parseMutation(body)
        if (!mutation) return badRequest()
        const repository = await repositoryFor(context)
        const actor = {
          actorUserId: context.userId,
          actorClient: context.client,
        }
        const connection = mutation.action === "replace"
          ? await repository.replaceConnection({ ...mutation.input, ...actor })
          : mutation.action === "verify"
            ? await repository.verifyConnection({ ...mutation.input, ...actor })
            : await repository.disconnectConnection({ ...mutation.input, ...actor })
        return json({ connection: safeConnectionToWire(connection, true) })
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

function createServiceClient() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("VITE_SUPABASE_URL")
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serviceRoleKey) {
    const error = new Error("Supabase service configuration unavailable") as StructuredError
    error.status = 503
    error.code = "notification_connection_unavailable"
    throw error
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function databaseError(code = "notification_connection_unavailable", status = 503): never {
  const error = new Error("notification connection database failure") as StructuredError
  error.status = status
  error.code = code
  throw error
}

function normalizeRow(input: unknown, revisionOverride?: string): NotificationConnectionRow {
  if (!isRecord(input)) databaseError("notification_connection_unsafe_response", 502)
  return {
    channel: String(input.channel ?? ""),
    webhook_url: typeof input.webhook_url === "string" ? input.webhook_url : null,
    webhook_url_ciphertext: typeof input.webhook_url_ciphertext === "string"
      ? input.webhook_url_ciphertext
      : null,
    webhook_url_mask: typeof input.webhook_url_mask === "string" ? input.webhook_url_mask : null,
    connection_state: String(input.connection_state ?? ""),
    revision: revisionOverride ?? (
      typeof input.revision === "string" || typeof input.revision === "number"
        ? input.revision
        : ""
    ),
    updated_by: typeof input.updated_by === "string" ? input.updated_by : null,
    last_verified_at: typeof input.last_verified_at === "string" ? input.last_verified_at : null,
    last_error_code: typeof input.last_error_code === "string" ? input.last_error_code : null,
  }
}

export function createSupabaseNotificationConnectionStore(
  serviceClient: SupabaseClient,
): NotificationConnectionStore {
  function rpcError(error: unknown): never {
    const message = isRecord(error) && typeof error.message === "string"
      ? error.message
      : ""
    if (message.includes("notification_connection_revision_conflict")) {
      databaseError("notification_revision_conflict", 409)
    }
    if (message.includes("idempotency_key_reused")) {
      databaseError("idempotency_key_reused", 409)
    }
    if (message.includes("notification_access_denied")) {
      databaseError("notification_forbidden", 403)
    }
    databaseError()
  }

  function safeRpcConnection(input: unknown): NotificationConnectionDto {
    if (!isRecord(input)) databaseError("notification_connection_unsafe_response", 502)
    const connectionKey = input.connection_key
    const connectionState = input.connection_state
    const revision = input.revision
    if (
      typeof connectionKey !== "string" ||
      !CONNECTION_KEYS.has(connectionKey) ||
      typeof connectionState !== "string" ||
      !CONNECTION_STATES.has(connectionState) ||
      typeof revision !== "string" ||
      !DECIMAL_REVISION.test(revision)
    ) {
      databaseError("notification_connection_unsafe_response", 502)
    }
    return {
      connectionKey: connectionKey as NotificationConnectionKey,
      connectionState: connectionState as NotificationConnectionDto["connectionState"],
      revision,
      configured: connectionState !== "disconnected",
      webhookUrlMask: typeof input.webhook_url_mask === "string" ? input.webhook_url_mask : null,
      lastVerifiedAt: typeof input.last_verified_at === "string" ? input.last_verified_at : null,
      lastErrorCode: typeof input.last_error_code === "string" ? input.last_error_code : null,
      editable: true,
    }
  }

  function rejectTerminalVerification(input: Record<string, unknown>) {
    if (input.terminal_code === undefined || input.terminal_code === null) return
    if (input.terminal_code === "verification_expired") {
      databaseError("notification_connection_verification_expired", 409)
    }
    if (input.terminal_code === "verification_superseded") {
      databaseError("notification_connection_verification_superseded", 409)
    }
    databaseError("notification_connection_unsafe_response", 502)
  }

  async function callMutationRpc(
    name: string,
    parameters: Record<string, unknown>,
  ) {
    const { data, error } = await serviceClient.rpc(name, parameters)
    if (error) rpcError(error)
    return data
  }

  async function loadRawRow(channel: string) {
    const { data, error } = await serviceClient
      .from("google_chat_webhook_settings")
      .select(ROW_COLUMNS)
      .eq("channel", channel)
      .maybeSingle()
    if (error) databaseError()
    return data ? normalizeRow(data) : null
  }

  return {
    async listRows() {
      const { data, error } = await serviceClient
        .from("google_chat_webhook_settings")
        .select(ROW_COLUMNS)
        .order("channel")
      if (error) databaseError()
      return (data ?? []).map((row) => normalizeRow(row))
    },
    async getRow(channel) {
      return loadRawRow(channel)
    },
    async replaceAtomic(input) {
      const data = await callMutationRpc(
        "replace_google_chat_connection_v1",
        {
          p_actor: input.actorUserId,
          p_channel: input.channel,
          p_webhook_url: input.webhookUrl,
          p_webhook_url_ciphertext: input.webhookUrlCiphertext,
          p_webhook_url_mask: input.webhookUrlMask,
          p_expected_revision: input.expectedRevision,
          p_request_id: input.requestId,
        },
      )
      return safeRpcConnection(data)
    },
    async disconnectAtomic(input) {
      const data = await callMutationRpc(
        "disconnect_google_chat_connection_v1",
        {
          p_actor: input.actorUserId,
          p_channel: input.channel,
          p_expected_revision: input.expectedRevision,
          p_request_id: input.requestId,
        },
      )
      return safeRpcConnection(data)
    },
    async beginVerificationAtomic(input) {
      const data = await callMutationRpc(
        "begin_google_chat_connection_verification_v1",
        {
          p_actor: input.actorUserId,
          p_channel: input.channel,
          p_expected_revision: input.expectedRevision,
          p_request_id: input.requestId,
        },
      )
      if (
        !isRecord(data) ||
        typeof data.should_send !== "boolean" ||
        typeof data.pending !== "boolean"
      ) {
        databaseError("notification_connection_unsafe_response", 502)
      }
      rejectTerminalVerification(data)
      if (data.should_send) {
        const row = await loadRawRow(input.channel)
        if (!row || String(row.revision) !== input.expectedRevision) {
          databaseError("notification_revision_conflict", 409)
        }
        return { shouldSend: true, pending: false, row }
      }
      return {
        shouldSend: false,
        pending: data.pending,
        row: data.pending || data.connection == null ? null : safeRpcConnection(data.connection),
      }
    },
    async recordVerificationAtomic(input) {
      const data = await callMutationRpc(
        "record_google_chat_connection_verification_v1",
        {
          p_actor: input.actorUserId,
          p_channel: input.channel,
          p_succeeded: input.succeeded,
          p_result_code: input.resultCode,
          p_expected_revision: input.expectedRevision,
          p_request_id: input.requestId,
        },
      )
      if (isRecord(data)) rejectTerminalVerification(data)
      return safeRpcConnection(data)
    },
  }
}

export function createProductionNotificationConnectionsRouteHandlers() {
  return createNotificationConnectionsRouteHandlers({
    authenticate: (request) => authenticateNotificationRequest(request, { createAuthenticatedClient }),
    createRepository() {
      const encryptionKey = env("NOTIFICATION_CONNECTION_ENCRYPTION_KEY")
      if (!encryptionKey) {
        const error = new Error("connection encryption unavailable") as StructuredError
        error.status = 503
        error.code = "notification_connection_unavailable"
        throw error
      }
      return createNotificationConnectionRepository({
        store: createSupabaseNotificationConnectionStore(createServiceClient()),
        encryptionKey,
        async sendVerification({ webhookUrl, text }) {
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(10_000),
          })
          return {
            succeeded: response.ok,
            resultCode: response.ok ? "accepted" : `http_${response.status}`,
          }
        },
      })
    },
  })
}
