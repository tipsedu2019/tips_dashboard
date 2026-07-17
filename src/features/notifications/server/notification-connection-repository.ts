import {
  NOTIFICATION_CONNECTION_KEYS,
  NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN,
  type NotificationConnectionDto,
  type NotificationConnectionKey,
  type NotificationConnectionState,
} from "../notification-control-plane-types.ts"
import { randomUUID } from "node:crypto"
import {
  decodeNotificationConnectionEncryptionKey,
  decryptNotificationConnectionSecret,
  encryptNotificationConnectionSecret,
  isAllowedGoogleChatWebhookUrl,
  maskGoogleChatWebhookUrl,
} from "./notification-connection-crypto.ts"

export const GOOGLE_CHAT_CONNECTION_TEST_MESSAGE =
  "TIPS 알림 연결 테스트입니다. 이 메시지는 연결 상태 확인용입니다."

const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONNECTION_KEY_SET = new Set<string>(NOTIFICATION_CONNECTION_KEYS)
const CONNECTION_TO_CHANNEL = {
  "google_chat.management": "admin",
  "google_chat.executive": "executive",
  "google_chat.math": "math",
  "google_chat.english": "english",
} as const
const CHANNEL_TO_CONNECTION = Object.fromEntries(
  Object.entries(CONNECTION_TO_CHANNEL).map(([connectionKey, channel]) => [channel, connectionKey]),
) as Record<string, NotificationConnectionKey>

type GoogleChatChannel = (typeof CONNECTION_TO_CHANNEL)[NotificationConnectionKey]

type LegacyConnectionResult = Readonly<{
  connection_key?: unknown
  connection_state?: unknown
  revision?: unknown
  configured?: unknown
  webhook_url_mask?: unknown
}>

type LegacyReplaceDependencies = Readonly<{
  requestId?: () => string
  loadCurrentRevision: (channel: GoogleChatChannel) => Promise<string>
  replaceAtomic: (input: Readonly<{
    channel: GoogleChatChannel
    webhookUrl: string
    webhookUrlCiphertext: string
    webhookUrlMask: string
    expectedRevision: string
    requestId: string
    actorUserId: string
  }>) => Promise<LegacyConnectionResult>
}>

export type NotificationConnectionRow = Readonly<{
  channel: string
  webhook_url: string | null
  webhook_url_ciphertext: string | null
  webhook_url_mask: string | null
  connection_state: string
  revision: string | number | bigint
  updated_by?: string | null
  last_verified_at: string | null
  last_error_code: string | null
}>

type NotificationConnectionMutationResult = NotificationConnectionRow | NotificationConnectionDto

type MutationIdentity = Readonly<{
  channel: GoogleChatChannel
  expectedRevision: string
  requestId: string
  actorUserId: string
  actorClient: unknown
}>

export type NotificationConnectionStore = Readonly<{
  listRows: () => Promise<ReadonlyArray<NotificationConnectionRow>>
  getRow: (
    channel: GoogleChatChannel,
    actor: Pick<MutationIdentity, "actorUserId" | "actorClient">,
  ) => Promise<NotificationConnectionRow | null>
  beginVerificationAtomic: (
    input: MutationIdentity,
  ) => Promise<Readonly<{
    shouldSend: boolean
    pending: boolean
    row: NotificationConnectionMutationResult | null
  }>>
  replaceAtomic: (
    input: MutationIdentity & Readonly<{
      webhookUrl: string
      webhookUrlCiphertext: string
      webhookUrlMask: string
    }>,
  ) => Promise<NotificationConnectionMutationResult>
  disconnectAtomic: (input: MutationIdentity) => Promise<NotificationConnectionMutationResult>
  recordVerificationAtomic: (
    input: MutationIdentity & Readonly<{
      succeeded: boolean
      resultCode: string
      verifiedAt: string
    }>,
  ) => Promise<NotificationConnectionMutationResult>
}>

export class NotificationConnectionError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status = 400) {
    super("알림 연결 요청을 처리하지 못했습니다.")
    this.name = "NotificationConnectionError"
    this.code = code
    this.status = status
  }
}

function requireConnectionKey(value: string): NotificationConnectionKey {
  if (!CONNECTION_KEY_SET.has(value)) {
    throw new NotificationConnectionError("notification_connection_invalid")
  }
  return value as NotificationConnectionKey
}

function requireMutationIdentity(input: {
  connectionKey: string
  expectedRevision: string
  requestId: string
  actorUserId: string
  actorClient: unknown
}): MutationIdentity {
  const connectionKey = requireConnectionKey(input.connectionKey)
  if (
    typeof input.expectedRevision !== "string" ||
    !DECIMAL_REVISION.test(input.expectedRevision) ||
    typeof input.requestId !== "string" ||
    !UUID.test(input.requestId) ||
    typeof input.actorUserId !== "string" ||
    !UUID.test(input.actorUserId) ||
    (typeof input.actorClient !== "object" && typeof input.actorClient !== "function") ||
    input.actorClient === null
  ) {
    throw new NotificationConnectionError("notification_connection_invalid")
  }
  return {
    channel: CONNECTION_TO_CHANNEL[connectionKey],
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    actorUserId: input.actorUserId,
    actorClient: input.actorClient,
  }
}

function normalizeRevision(value: string | number | bigint): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
  }
  const revision = typeof value === "string" ? value : String(value)
  if (!DECIMAL_REVISION.test(revision)) {
    throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
  }
  return revision
}

export async function replaceLegacyGoogleChatConnection(input: Readonly<{
  role: string
  userId: string
  channel: string
  webhookUrl: string
  encryptionKey: string
}>, dependencies: LegacyReplaceDependencies) {
  if (input.role !== "admin" || !UUID.test(input.userId)) {
    throw new Error("notification_access_denied")
  }
  if (!(Object.values(CONNECTION_TO_CHANNEL) as string[]).includes(input.channel)) {
    throw new Error("notification_connection_invalid")
  }
  const channel = input.channel as GoogleChatChannel
  if (!isAllowedGoogleChatWebhookUrl(input.webhookUrl)) {
    throw new Error("notification_connection_invalid")
  }
  const encryptionKey = decodeNotificationConnectionEncryptionKey(input.encryptionKey)
  const expectedRevision = normalizeRevision(await dependencies.loadCurrentRevision(channel))
  const requestId = (dependencies.requestId ?? randomUUID)()
  if (!UUID.test(requestId)) throw new Error("notification_connection_request_id_invalid")
  const webhookUrlMask = maskGoogleChatWebhookUrl(input.webhookUrl)
  const result = await dependencies.replaceAtomic({
    channel,
    webhookUrl: input.webhookUrl,
    webhookUrlCiphertext: encryptNotificationConnectionSecret(input.webhookUrl, encryptionKey),
    webhookUrlMask,
    expectedRevision,
    requestId,
    actorUserId: input.userId,
  })
  if (
    result.connection_state !== "encrypted_active" ||
    result.configured !== true ||
    result.webhook_url_mask !== webhookUrlMask ||
    typeof result.revision !== "string" ||
    !DECIMAL_REVISION.test(result.revision)
  ) {
    throw new Error("notification_connection_unsafe_response")
  }
  return { configured: true, maskedUrl: webhookUrlMask }
}

function rowToDto(
  row: NotificationConnectionRow,
  encryptionKey: ReturnType<typeof decodeNotificationConnectionEncryptionKey>,
): NotificationConnectionDto {
  const connectionKey = CHANNEL_TO_CONNECTION[row.channel]
  if (!connectionKey) {
    throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
  }
  if (![
    "legacy_active",
    "encrypted_active",
    "disconnected",
  ].includes(row.connection_state)) {
    throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
  }
  const connectionState = row.connection_state as NotificationConnectionState
  let safeMask: string | null = null
  if (connectionState === "legacy_active") {
    if (!row.webhook_url || !isAllowedGoogleChatWebhookUrl(row.webhook_url)) {
      throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
    }
    safeMask = maskGoogleChatWebhookUrl(row.webhook_url)
  } else if (connectionState === "encrypted_active") {
    if (!row.webhook_url_ciphertext) {
      throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
    }
    try {
      const decrypted = decryptNotificationConnectionSecret(row.webhook_url_ciphertext, encryptionKey)
      if (!isAllowedGoogleChatWebhookUrl(decrypted)) {
        throw new Error("invalid connection URL")
      }
      safeMask = maskGoogleChatWebhookUrl(decrypted)
    } catch {
      throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
    }
  }
  return {
    connectionKey,
    connectionState,
    revision: normalizeRevision(row.revision),
    configured: connectionState !== "disconnected",
    webhookUrlMask: safeMask,
    lastVerifiedAt: row.last_verified_at ?? null,
    lastErrorCode: typeof row.last_error_code === "string" && NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(row.last_error_code)
      ? row.last_error_code
      : null,
    editable: true,
  }
}

function safeResultToDto(input: NotificationConnectionDto): NotificationConnectionDto {
  if (
    !CONNECTION_KEY_SET.has(input.connectionKey) ||
    !["legacy_active", "encrypted_active", "disconnected"].includes(input.connectionState) ||
    typeof input.revision !== "string" ||
    !DECIMAL_REVISION.test(input.revision) ||
    (input.connectionState !== "disconnected" && (
      typeof input.webhookUrlMask !== "string" ||
      !/^chat\.googleapis\.com\/v1\/spaces\/(?:…|[A-Za-z0-9_.-]{1,8}…[A-Za-z0-9_.-]{1,8})\/messages$/.test(input.webhookUrlMask)
    )) ||
    (input.lastErrorCode !== null && !NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(input.lastErrorCode))
  ) {
    throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
  }
  return {
    connectionKey: input.connectionKey,
    connectionState: input.connectionState,
    revision: input.revision,
    configured: input.connectionState !== "disconnected",
    webhookUrlMask: input.connectionState === "disconnected" ? null : input.webhookUrlMask,
    lastVerifiedAt: input.lastVerifiedAt ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
    editable: true,
  }
}

function mutationResultToDto(
  input: NotificationConnectionMutationResult,
  encryptionKey: ReturnType<typeof decodeNotificationConnectionEncryptionKey>,
) {
  return "connectionKey" in input
    ? safeResultToDto(input)
    : rowToDto(input, encryptionKey)
}

export function createNotificationConnectionRepository(dependencies: {
  store: NotificationConnectionStore
  encryptionKey: string
  sendVerification: (input: {
    webhookUrl: string
    text: string
  }) => Promise<{ succeeded: boolean; resultCode: string }>
  now?: () => Date
}) {
  const encryptionKey = decodeNotificationConnectionEncryptionKey(dependencies.encryptionKey)
  const now = dependencies.now ?? (() => new Date())

  return {
    async listConnections(): Promise<ReadonlyArray<NotificationConnectionDto>> {
      const rows = await dependencies.store.listRows()
      const order = new Map<string, number>(
        NOTIFICATION_CONNECTION_KEYS.map((key, index) => [key, index]),
      )
      return rows
        .map((row) => rowToDto(row, encryptionKey))
        .sort((left, right) => (
          (order.get(left.connectionKey) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.connectionKey) ?? Number.MAX_SAFE_INTEGER)
        ))
    },

    async replaceConnection(input: {
      connectionKey: string
      webhookUrl: string
      expectedRevision: string
      requestId: string
      actorUserId: string
      actorClient: unknown
    }): Promise<NotificationConnectionDto> {
      const identity = requireMutationIdentity(input)
      if (!isAllowedGoogleChatWebhookUrl(input.webhookUrl)) {
        throw new NotificationConnectionError("notification_connection_url_invalid")
      }
      const row = await dependencies.store.replaceAtomic({
        ...identity,
        webhookUrl: input.webhookUrl,
        webhookUrlCiphertext: encryptNotificationConnectionSecret(
          input.webhookUrl,
          encryptionKey,
        ),
        webhookUrlMask: maskGoogleChatWebhookUrl(input.webhookUrl),
      })
      return mutationResultToDto(row, encryptionKey)
    },

    async disconnectConnection(input: {
      connectionKey: string
      expectedRevision: string
      requestId: string
      actorUserId: string
      actorClient: unknown
    }): Promise<NotificationConnectionDto> {
      const row = await dependencies.store.disconnectAtomic(requireMutationIdentity(input))
      return mutationResultToDto(row, encryptionKey)
    },

    async verifyConnection(input: {
      connectionKey: string
      expectedRevision: string
      requestId: string
      confirmed: boolean
      actorUserId: string
      actorClient: unknown
    }): Promise<NotificationConnectionDto> {
      if (input.confirmed !== true) {
        throw new NotificationConnectionError("notification_connection_confirmation_required")
      }
      const identity = requireMutationIdentity(input)
      const reservation = await dependencies.store.beginVerificationAtomic(identity)
      if (reservation.pending) {
        throw new NotificationConnectionError(
          "notification_connection_verification_in_progress",
          409,
        )
      }
      if (!reservation.shouldSend) {
        if (!reservation.row) {
          throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
        }
        return mutationResultToDto(reservation.row, encryptionKey)
      }
      const row = reservation.row
      if (!row) {
        throw new NotificationConnectionError("notification_connection_not_configured", 409)
      }
      if ("connectionKey" in row) {
        throw new NotificationConnectionError("notification_connection_unsafe_response", 502)
      }
      if (row.connection_state === "disconnected") {
        throw new NotificationConnectionError("notification_connection_not_configured", 409)
      }
      if (normalizeRevision(row.revision) !== identity.expectedRevision) {
        throw new NotificationConnectionError("notification_revision_conflict", 409)
      }

      let webhookUrl = ""
      let configurationError = false
      if (row.connection_state === "legacy_active") {
        webhookUrl = typeof row.webhook_url === "string" ? row.webhook_url : ""
      } else if (row.connection_state === "encrypted_active") {
        if (!row.webhook_url_ciphertext) {
          configurationError = true
        } else {
          try {
            webhookUrl = decryptNotificationConnectionSecret(
              row.webhook_url_ciphertext,
              encryptionKey,
            )
          } catch {
            configurationError = true
          }
        }
      } else {
        configurationError = true
      }

      if (!isAllowedGoogleChatWebhookUrl(webhookUrl)) {
        configurationError = true
      }
      const verifiedAt = now().toISOString()
      if (configurationError) {
        const updated = await dependencies.store.recordVerificationAtomic({
          ...identity,
          succeeded: false,
          resultCode: "configuration_error",
          verifiedAt,
        })
        return mutationResultToDto(updated, encryptionKey)
      }
      let providerResult: { succeeded: boolean; resultCode: string }
      try {
        providerResult = await dependencies.sendVerification({
          webhookUrl,
          text: GOOGLE_CHAT_CONNECTION_TEST_MESSAGE,
        })
      } catch {
        providerResult = { succeeded: false, resultCode: "transport_error" }
      }
      if (
        typeof providerResult?.succeeded !== "boolean" ||
        typeof providerResult?.resultCode !== "string" ||
        !NOTIFICATION_CONNECTION_RESULT_CODE_PATTERN.test(providerResult.resultCode)
      ) {
        throw new NotificationConnectionError("notification_connection_provider_invalid", 502)
      }
      const updated = await dependencies.store.recordVerificationAtomic({
        ...identity,
        succeeded: providerResult.succeeded,
        resultCode: providerResult.resultCode,
        verifiedAt,
      })
      return mutationResultToDto(updated, encryptionKey)
    },
  }
}
