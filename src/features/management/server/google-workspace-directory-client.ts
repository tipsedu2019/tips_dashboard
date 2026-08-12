import { admin, auth } from "@googleapis/admin"

export type GoogleWorkspaceDirectoryConfiguration = Readonly<{
  status: "ready" | "not_configured"
  configured: boolean
}>

export type GoogleWorkspaceDirectoryLookupResult =
  | Readonly<{
      kind: "found"
      id: string
      primaryEmail: string
      aliases: ReadonlyArray<string>
      suspended: boolean
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "provider_error" }>

export type GoogleWorkspaceDirectoryClient = Readonly<{
  configuration: GoogleWorkspaceDirectoryConfiguration
  lookup(userKey: string): Promise<GoogleWorkspaceDirectoryLookupResult>
}>

type DirectoryGetParameters = Readonly<{
  userKey: string
  projection: "basic"
  viewType: "admin_view"
}>

type DirectoryClientDependencies = Readonly<{
  configured: boolean
  getUser(parameters: DirectoryGetParameters): Promise<unknown>
}>

type DirectoryEnvironment = Readonly<Record<string, string | undefined>>

const CHAT_USER_ID = /^[1-9][0-9]{0,31}$/u
const ACCOUNT_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function providerStatus(error: unknown) {
  if (!isRecord(error)) return null
  if (typeof error.code === "number") return error.code
  if (typeof error.status === "number") return error.status
  if (isRecord(error.response) && typeof error.response.status === "number") {
    return error.response.status
  }
  return null
}

function closedUser(value: unknown): GoogleWorkspaceDirectoryLookupResult {
  if (!isRecord(value) || !isRecord(value.data)) return Object.freeze({ kind: "provider_error" })
  const { id, primaryEmail, aliases, suspended } = value.data
  if (
    typeof id !== "string"
    || !CHAT_USER_ID.test(id)
    || typeof primaryEmail !== "string"
    || primaryEmail.length === 0
    || primaryEmail.trim() !== primaryEmail
    || (aliases !== undefined && aliases !== null && !(
      Array.isArray(aliases)
      && aliases.every((alias) => (
        typeof alias === "string" && alias.length > 0 && alias.trim() === alias
      ))
    ))
    || (suspended !== undefined && suspended !== null && typeof suspended !== "boolean")
  ) {
    return Object.freeze({ kind: "provider_error" })
  }
  return Object.freeze({
    kind: "found",
    id,
    primaryEmail,
    aliases: Object.freeze(aliases ? [...aliases as string[]] : []),
    suspended: suspended === true,
  })
}

export function createGoogleWorkspaceDirectoryClient(
  dependencies: DirectoryClientDependencies,
): GoogleWorkspaceDirectoryClient {
  const configuration = Object.freeze(dependencies.configured
    ? { status: "ready" as const, configured: true }
    : { status: "not_configured" as const, configured: false })

  return Object.freeze({
    configuration,
    async lookup(userKey: string): Promise<GoogleWorkspaceDirectoryLookupResult> {
      if (
        !configuration.configured
        || typeof userKey !== "string"
        || userKey.length === 0
        || userKey.trim() !== userKey
      ) return Object.freeze({ kind: "provider_error" })

      try {
        const response = await dependencies.getUser({
          userKey,
          projection: "basic",
          viewType: "admin_view",
        })
        return closedUser(response)
      } catch (error) {
        return Object.freeze({
          kind: providerStatus(error) === 404 ? "not_found" : "provider_error",
        })
      }
    },
  })
}

function environmentValue(environment: DirectoryEnvironment, name: string) {
  const value = environment[name]
  return typeof value === "string" ? value : ""
}

function closedOperatorAllowlist(value: string) {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) return null
    const entries = Object.entries(parsed)
    if (entries.length === 0) return null
    const ids = new Set<string>()
    for (const [email, id] of entries) {
      if (!ACCOUNT_EMAIL.test(email) || typeof id !== "string" || !CHAT_USER_ID.test(id) || ids.has(id)) {
        return null
      }
      ids.add(id)
    }
    return new Map(entries as ReadonlyArray<readonly [string, string]>)
  } catch {
    return null
  }
}

export function createProductionGoogleWorkspaceDirectoryClient(
  environment: DirectoryEnvironment = process.env,
): GoogleWorkspaceDirectoryClient {
  const clientEmail = environmentValue(environment, "GOOGLE_WORKSPACE_DIRECTORY_CLIENT_EMAIL").trim()
  const privateKey = environmentValue(environment, "GOOGLE_WORKSPACE_DIRECTORY_PRIVATE_KEY")
  const subject = environmentValue(environment, "GOOGLE_WORKSPACE_DIRECTORY_SUBJECT").trim()
  if (!clientEmail || !privateKey.trim() || !subject) {
    const allowlist = closedOperatorAllowlist(
      environmentValue(environment, "GOOGLE_CHAT_PROFILE_IDENTITY_ALLOWLIST").trim(),
    )
    if (allowlist) {
      return createGoogleWorkspaceDirectoryClient({
        configured: true,
        async getUser({ userKey }) {
          const byEmail = allowlist.get(userKey)
          const matched = byEmail
            ? [userKey, byEmail] as const
            : [...allowlist.entries()].find(([, id]) => id === userKey)
          if (!matched) throw Object.assign(new Error("google_chat_profile_identity_not_found"), { code: 404 })
          return {
            data: {
              id: matched[1],
              primaryEmail: matched[0],
              aliases: [],
              suspended: false,
            },
          }
        },
      })
    }
    return createGoogleWorkspaceDirectoryClient({
      configured: false,
      async getUser() {
        throw new Error("google_workspace_directory_not_configured")
      },
    })
  }

  const jwt = new auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/gu, "\n"),
    scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
    subject,
  })
  const directory = admin({ version: "directory_v1", auth: jwt })
  return createGoogleWorkspaceDirectoryClient({
    configured: true,
    getUser(parameters) {
      return directory.users.get(parameters)
    },
  })
}
