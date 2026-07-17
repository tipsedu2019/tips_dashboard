import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

const ENCRYPTION_ALGORITHM = "aes-256-gcm"
const ENCRYPTION_KEY_BYTES = 32
const INITIALIZATION_VECTOR_BYTES = 12
const AUTHENTICATION_TAG_BYTES = 16
const ENVELOPE_VERSION = "v1"
const ENVELOPE_CONTEXT = Buffer.from("notification-connection:v1", "utf8")
const MAX_SECRET_BYTES = 16 * 1024

const GOOGLE_CHAT_ORIGIN_PREFIX = "https://chat.googleapis.com/"
const GOOGLE_CHAT_PATH_PATTERN = /^\/v1\/spaces\/([A-Za-z0-9_-]+)\/messages$/
const GOOGLE_CHAT_QUERY_PATTERN = /^\?key=[^&#]+&token=[^&#]+$/

function invalidEncryptionKey(): Error {
  return new Error("Invalid notification connection encryption key")
}

function invalidSecret(): Error {
  return new Error("Invalid notification connection secret")
}

function invalidEnvelope(): Error {
  return new Error("Invalid notification connection secret envelope")
}

function asEncryptionKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== ENCRYPTION_KEY_BYTES) {
    throw invalidEncryptionKey()
  }

  return Buffer.from(key.buffer, key.byteOffset, key.byteLength)
}

function decodeBase64UrlPart(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidEnvelope()

  const decoded = Buffer.from(value, "base64url")
  if (!decoded.length || decoded.toString("base64url") !== value) {
    throw invalidEnvelope()
  }

  return decoded
}

export function decodeNotificationConnectionEncryptionKey(encodedKey: string): Buffer {
  if (typeof encodedKey !== "string" || !encodedKey) throw invalidEncryptionKey()

  let decoded: Buffer
  try {
    decoded = Buffer.from(encodedKey, "base64")
  } catch {
    throw invalidEncryptionKey()
  }

  if (
    decoded.byteLength !== ENCRYPTION_KEY_BYTES
    || decoded.toString("base64") !== encodedKey
  ) {
    throw invalidEncryptionKey()
  }

  return decoded
}

export function encryptNotificationConnectionSecret(
  secret: string,
  key: Uint8Array,
): string {
  if (typeof secret !== "string" || !secret || Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
    throw invalidSecret()
  }

  const encryptionKey = asEncryptionKey(key)
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, initializationVector, {
    authTagLength: AUTHENTICATION_TAG_BYTES,
  })
  cipher.setAAD(ENVELOPE_CONTEXT)

  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ])
  const authenticationTag = cipher.getAuthTag()

  return [
    ENVELOPE_VERSION,
    initializationVector.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":")
}

export function decryptNotificationConnectionSecret(
  envelope: string,
  key: Uint8Array,
): string {
  try {
    if (
      typeof envelope !== "string"
      || !envelope
      || Buffer.byteLength(envelope, "utf8") > MAX_SECRET_BYTES * 2
    ) {
      throw invalidEnvelope()
    }

    const parts = envelope.split(":")
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) throw invalidEnvelope()

    const initializationVector = decodeBase64UrlPart(parts[1])
    const authenticationTag = decodeBase64UrlPart(parts[2])
    const ciphertext = decodeBase64UrlPart(parts[3])
    if (
      initializationVector.byteLength !== INITIALIZATION_VECTOR_BYTES
      || authenticationTag.byteLength !== AUTHENTICATION_TAG_BYTES
      || ciphertext.byteLength > MAX_SECRET_BYTES
    ) {
      throw invalidEnvelope()
    }

    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      asEncryptionKey(key),
      initializationVector,
      { authTagLength: AUTHENTICATION_TAG_BYTES },
    )
    decipher.setAAD(ENVELOPE_CONTEXT)
    decipher.setAuthTag(authenticationTag)

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
  } catch {
    throw invalidEnvelope()
  }
}

type AllowedGoogleChatWebhook = {
  url: string
  spaceId: string
}

function parseAllowedGoogleChatWebhookUrl(value: unknown): AllowedGoogleChatWebhook | null {
  if (
    typeof value !== "string"
    || !value
    || value.length > 8_192
    || !value.startsWith(GOOGLE_CHAT_ORIGIN_PREFIX)
  ) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "chat.googleapis.com"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || !GOOGLE_CHAT_QUERY_PATTERN.test(parsed.search)
  ) {
    return null
  }

  const pathMatch = GOOGLE_CHAT_PATH_PATTERN.exec(parsed.pathname)
  if (!pathMatch) return null

  const queryEntries = Array.from(parsed.searchParams.entries())
  if (
    queryEntries.length !== 2
    || queryEntries[0][0] !== "key"
    || queryEntries[1][0] !== "token"
    || queryEntries.some(([, credential]) => (
      !credential
      || credential.length > 4_096
      || /[\u0000-\u0020\u007f]/.test(credential)
    ))
  ) {
    return null
  }

  return { url: value, spaceId: pathMatch[1] }
}

export function isAllowedGoogleChatWebhookUrl(value: unknown): value is string {
  return parseAllowedGoogleChatWebhookUrl(value) !== null
}

export function validateGoogleChatWebhookUrl(value: unknown): string {
  const parsed = parseAllowedGoogleChatWebhookUrl(value)
  if (!parsed) throw new Error("Invalid Google Chat webhook URL")
  return parsed.url
}

export function maskGoogleChatWebhookUrl(value: string): string {
  const parsed = parseAllowedGoogleChatWebhookUrl(value)
  if (!parsed) throw new Error("Invalid Google Chat webhook URL")

  const maskedSpaceId = parsed.spaceId.length > 8
    ? `${parsed.spaceId.slice(0, 4)}…${parsed.spaceId.slice(-4)}`
    : "…"

  return `chat.googleapis.com/v1/spaces/${maskedSpaceId}/messages`
}
