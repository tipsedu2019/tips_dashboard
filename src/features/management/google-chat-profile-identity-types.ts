export const GOOGLE_CHAT_PROFILE_ROLES = [
  "admin",
  "staff",
  "teacher",
  "assistant",
  "viewer",
] as const

export type GoogleChatProfileRole = typeof GOOGLE_CHAT_PROFILE_ROLES[number]
export type GoogleChatProfileIdentitySource = "directory" | "manual"
export type GoogleChatProfileIdentityVerificationStatus =
  | "verified"
  | "unverified"
  | "not_found"
export type GoogleChatProfileIdentitySyncStatus =
  | "ok"
  | "not_found"
  | "email_mismatch"
  | "provider_error"

export type GoogleChatProfileIdentity = Readonly<{
  profileId: string
  profileName: string
  accountEmail: string
  dashboardRole: GoogleChatProfileRole
  chatUserId: string | null
  resourceName: string | null
  source: GoogleChatProfileIdentitySource | null
  verificationStatus: GoogleChatProfileIdentityVerificationStatus
  verifiedAt: string | null
  lastSyncStatus: GoogleChatProfileIdentitySyncStatus | null
  lastSyncAt: string | null
  identityRevision: string
  eligible: boolean
}>

export type GoogleChatProfileIdentitySnapshot = Readonly<{
  identities: ReadonlyArray<GoogleChatProfileIdentity>
  directory: Readonly<{
    status: "ready" | "not_configured"
    configured: boolean
  }>
  editable: boolean
}>

export type GoogleChatProfileIdentitySyncSource = Readonly<{
  profileId: string
  profileName: string
  accountEmail: string
  dashboardRole: GoogleChatProfileRole
  identityRevision: string
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const CHAT_USER_ID = /^[1-9][0-9]{0,31}$/u
const REVISION = /^(?:0|[1-9][0-9]*)$/u
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
const ROLE_SET = new Set<string>(GOOGLE_CHAT_PROFILE_ROLES)
const SOURCE_SET = new Set<string>(["directory", "manual"])
const VERIFICATION_SET = new Set<string>(["verified", "unverified", "not_found"])
const SYNC_STATUS_SET = new Set<string>(["ok", "not_found", "email_mismatch", "provider_error"])
const IDENTITY_KEYS = [
  "profileId",
  "profileName",
  "accountEmail",
  "dashboardRole",
  "chatUserId",
  "resourceName",
  "source",
  "verificationStatus",
  "verifiedAt",
  "lastSyncStatus",
  "lastSyncAt",
  "identityRevision",
  "eligible",
] as const
const SYNC_SOURCE_KEYS = [
  "profileId",
  "profileName",
  "accountEmail",
  "dashboardRole",
  "identityRevision",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

function isProfileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
}

function isNormalizedEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return false
  if (value.toLowerCase() !== value || /\s/u.test(value)) return false
  const at = value.indexOf("@")
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1
}

function isRole(value: unknown): value is GoogleChatProfileRole {
  return typeof value === "string" && ROLE_SET.has(value)
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && RFC3339.test(value) && Number.isFinite(Date.parse(value))
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value)
}

function invalidIdentity(): never {
  throw new Error("google_chat_profile_identity_invalid")
}

export function parseGoogleChatProfileIdentity(value: unknown): GoogleChatProfileIdentity {
  if (!isRecord(value) || !exactKeys(value, IDENTITY_KEYS)) invalidIdentity()

  const chatUserId = value.chatUserId
  const resourceName = value.resourceName
  const source = value.source
  const verificationStatus = value.verificationStatus
  const verifiedAt = value.verifiedAt
  const lastSyncStatus = value.lastSyncStatus
  const lastSyncAt = value.lastSyncAt

  if (
    !isUuid(value.profileId)
    || !isProfileName(value.profileName)
    || !isNormalizedEmail(value.accountEmail)
    || !isRole(value.dashboardRole)
    || !(chatUserId === null || (typeof chatUserId === "string" && CHAT_USER_ID.test(chatUserId)))
    || !(resourceName === null || typeof resourceName === "string")
    || !(source === null || (typeof source === "string" && SOURCE_SET.has(source)))
    || typeof verificationStatus !== "string"
    || !VERIFICATION_SET.has(verificationStatus)
    || !nullableTimestamp(verifiedAt)
    || !(lastSyncStatus === null || (
      typeof lastSyncStatus === "string" && SYNC_STATUS_SET.has(lastSyncStatus)
    ))
    || !nullableTimestamp(lastSyncAt)
    || !isRevision(value.identityRevision)
    || typeof value.eligible !== "boolean"
  ) invalidIdentity()

  const hasIdentity = chatUserId !== null
  if (
    (hasIdentity && resourceName !== `users/${chatUserId}`)
    || (!hasIdentity && resourceName !== null)
    || (hasIdentity !== (source !== null))
    || ((lastSyncStatus === null) !== (lastSyncAt === null))
    || (verificationStatus === "verified" && (!hasIdentity || verifiedAt === null))
    || (verificationStatus !== "verified" && (hasIdentity || verifiedAt !== null))
    || (lastSyncStatus === "ok" && verificationStatus !== "verified")
    || (lastSyncStatus === "not_found" && verificationStatus !== "not_found")
    || (lastSyncStatus === "email_mismatch" && verificationStatus !== "unverified")
    || (verificationStatus === "verified" && !(
      lastSyncStatus === "ok" || lastSyncStatus === "provider_error"
    ))
    || (verificationStatus === "not_found" && lastSyncStatus !== "not_found")
    || (verificationStatus === "unverified" && !(
      lastSyncStatus === null
      || lastSyncStatus === "email_mismatch"
      || lastSyncStatus === "provider_error"
    ))
    || (value.eligible && verificationStatus !== "verified")
  ) invalidIdentity()

  return Object.freeze({
    profileId: value.profileId,
    profileName: value.profileName,
    accountEmail: value.accountEmail,
    dashboardRole: value.dashboardRole,
    chatUserId,
    resourceName,
    source: source as GoogleChatProfileIdentitySource | null,
    verificationStatus: verificationStatus as GoogleChatProfileIdentityVerificationStatus,
    verifiedAt,
    lastSyncStatus: lastSyncStatus as GoogleChatProfileIdentitySyncStatus | null,
    lastSyncAt,
    identityRevision: value.identityRevision,
    eligible: value.eligible,
  })
}

export function parseGoogleChatProfileIdentitySnapshot(
  value: unknown,
): GoogleChatProfileIdentitySnapshot {
  if (
    !isRecord(value)
    || !exactKeys(value, ["identities", "directory", "editable"])
    || !Array.isArray(value.identities)
    || !isRecord(value.directory)
    || !exactKeys(value.directory, ["status", "configured"])
    || typeof value.directory.configured !== "boolean"
    || !(
      (value.directory.status === "ready" && value.directory.configured)
      || (value.directory.status === "not_configured" && !value.directory.configured)
    )
    || typeof value.editable !== "boolean"
  ) {
    throw new Error("google_chat_profile_identity_snapshot_invalid")
  }

  let identities: GoogleChatProfileIdentity[]
  try {
    identities = value.identities.map(parseGoogleChatProfileIdentity)
  } catch {
    throw new Error("google_chat_profile_identity_snapshot_invalid")
  }
  const profileIds = new Set(identities.map(({ profileId }) => profileId))
  if (profileIds.size !== identities.length) {
    throw new Error("google_chat_profile_identity_snapshot_invalid")
  }

  return Object.freeze({
    identities: Object.freeze(identities),
    directory: Object.freeze({
      status: value.directory.status,
      configured: value.directory.configured,
    }),
    editable: value.editable,
  })
}

export function parseGoogleChatProfileIdentitySyncSource(
  value: unknown,
): GoogleChatProfileIdentitySyncSource {
  if (
    !isRecord(value)
    || !exactKeys(value, SYNC_SOURCE_KEYS)
    || !isUuid(value.profileId)
    || !isProfileName(value.profileName)
    || !isNormalizedEmail(value.accountEmail)
    || !isRole(value.dashboardRole)
    || !isRevision(value.identityRevision)
  ) {
    throw new Error("google_chat_profile_identity_sync_source_invalid")
  }
  return Object.freeze({
    profileId: value.profileId,
    profileName: value.profileName,
    accountEmail: value.accountEmail,
    dashboardRole: value.dashboardRole,
    identityRevision: value.identityRevision,
  })
}
