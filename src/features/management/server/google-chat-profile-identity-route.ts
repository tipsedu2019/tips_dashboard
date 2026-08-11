import { createClient } from "@supabase/supabase-js"

import {
  parseGoogleChatProfileIdentity,
  parseGoogleChatProfileIdentitySnapshot,
  parseGoogleChatProfileIdentitySyncSource,
  type GoogleChatProfileIdentity,
  type GoogleChatProfileIdentitySyncSource,
} from "../google-chat-profile-identity-types.ts"
import {
  createProductionGoogleWorkspaceDirectoryClient,
  type GoogleWorkspaceDirectoryClient,
  type GoogleWorkspaceDirectoryLookupResult,
} from "./google-workspace-directory-client.ts"

type RpcResult = Readonly<{ data?: unknown; error?: unknown }>
type AuthResult = Readonly<{
  data?: { user?: { id?: unknown } | null } | null
  error?: unknown
}>

type AuthenticatedClient = Readonly<{
  auth: { getUser(token: string): PromiseLike<AuthResult> }
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
}>

type ServiceClient = Readonly<{
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
}>

type RouteDependencies = Readonly<{
  createAuthenticatedClient(token: string): AuthenticatedClient
  createServiceClient(): ServiceClient
  directory: GoogleWorkspaceDirectoryClient
}>

type AuthContext = Readonly<{
  actorProfileId: string
  role: "admin" | "staff"
  actorClient: AuthenticatedClient
}>

type SyncInput = Readonly<{
  profileId: string
  lookupMode: "auto" | "manual"
  chatUserId: string | null
  expectedIdentityRevision: string
  requestId: string
}>

type StructuredError = Error & { status: number; code: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const CHAT_USER_ID = /^[1-9][0-9]{0,31}$/u
const REVISION = /^(?:0|[1-9][0-9]*)$/u
const SAFE_ERROR_STATUS = Object.freeze({
  google_chat_profile_identity_unauthorized: 401,
  google_chat_profile_identity_forbidden: 403,
  google_chat_profile_identity_invalid_request: 400,
  google_chat_profile_identity_not_found: 404,
  google_chat_profile_identity_revision_conflict: 409,
  google_chat_profile_identity_source_changed: 409,
  google_chat_directory_not_configured: 503,
  google_chat_profile_identity_runtime_unavailable: 503,
  google_chat_profile_identity_unsafe_response: 502,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function failure(code: keyof typeof SAFE_ERROR_STATUS): StructuredError {
  const error = new Error(code) as StructuredError
  error.status = SAFE_ERROR_STATUS[code]
  error.code = code
  return error
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function errorResponse(error: unknown) {
  if (
    isRecord(error)
    && typeof error.code === "string"
    && Object.prototype.hasOwnProperty.call(SAFE_ERROR_STATUS, error.code)
  ) {
    const code = error.code as keyof typeof SAFE_ERROR_STATUS
    return json({ ok: false, code }, SAFE_ERROR_STATUS[code])
  }
  return json(
    { ok: false, code: "google_chat_profile_identity_runtime_unavailable" },
    503,
  )
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")
  return /^Bearer ([^\s]+)$/iu.exec(authorization ?? "")?.[1] ?? ""
}

function hasNoQuery(request: Request) {
  try {
    return [...new URL(request.url).searchParams.keys()].length === 0
  } catch {
    return false
  }
}

function parseSyncInput(value: unknown): SyncInput | null {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      "profile_id",
      "lookup_mode",
      "chat_user_id",
      "expected_identity_revision",
      "request_id",
    ])
    || typeof value.profile_id !== "string"
    || !UUID.test(value.profile_id)
    || (value.lookup_mode !== "auto" && value.lookup_mode !== "manual")
    || typeof value.expected_identity_revision !== "string"
    || !REVISION.test(value.expected_identity_revision)
    || typeof value.request_id !== "string"
    || !UUID.test(value.request_id)
    || (value.lookup_mode === "auto" && value.chat_user_id !== null)
    || (value.lookup_mode === "manual" && (
      typeof value.chat_user_id !== "string" || !CHAT_USER_ID.test(value.chat_user_id)
    ))
  ) return null

  return Object.freeze({
    profileId: value.profile_id,
    lookupMode: value.lookup_mode,
    chatUserId: value.chat_user_id as string | null,
    expectedIdentityRevision: value.expected_identity_revision,
    requestId: value.request_id,
  })
}

async function authenticate(
  request: Request,
  dependencies: RouteDependencies,
): Promise<AuthContext> {
  const token = bearerToken(request)
  if (!token) throw failure("google_chat_profile_identity_unauthorized")

  let actorClient: AuthenticatedClient
  try {
    actorClient = dependencies.createAuthenticatedClient(token)
  } catch {
    throw failure("google_chat_profile_identity_runtime_unavailable")
  }
  if (
    !actorClient?.auth
    || typeof actorClient.auth.getUser !== "function"
    || typeof actorClient.rpc !== "function"
  ) throw failure("google_chat_profile_identity_runtime_unavailable")

  let actorProfileId = ""
  try {
    const authResult = await actorClient.auth.getUser(token)
    const candidate = authResult?.data?.user?.id
    if (authResult?.error || typeof candidate !== "string" || !UUID.test(candidate)) {
      throw failure("google_chat_profile_identity_unauthorized")
    }
    actorProfileId = candidate
  } catch (error) {
    if (isRecord(error) && error.code === "google_chat_profile_identity_unauthorized") throw error
    throw failure("google_chat_profile_identity_unauthorized")
  }

  let role = ""
  try {
    const roleResult = await actorClient.rpc("current_dashboard_role")
    if (roleResult?.error) throw failure("google_chat_profile_identity_runtime_unavailable")
    role = typeof roleResult?.data === "string" ? roleResult.data : ""
  } catch (error) {
    if (isRecord(error) && error.code === "google_chat_profile_identity_runtime_unavailable") {
      throw error
    }
    throw failure("google_chat_profile_identity_runtime_unavailable")
  }
  if (role !== "admin" && role !== "staff") {
    throw failure("google_chat_profile_identity_forbidden")
  }
  return Object.freeze({ actorProfileId, role, actorClient })
}

function rpcFailure(error: unknown): StructuredError {
  const message = isRecord(error) && typeof error.message === "string" ? error.message : ""
  if (message.includes("google_chat_profile_mentions_access_denied")) {
    return failure("google_chat_profile_identity_forbidden")
  }
  if (message.includes("google_chat_profile_identity_not_found")) {
    return failure("google_chat_profile_identity_not_found")
  }
  if (message.includes("google_chat_profile_identity_revision_conflict")) {
    return failure("google_chat_profile_identity_revision_conflict")
  }
  if (message.includes("google_chat_profile_identity_source_changed")) {
    return failure("google_chat_profile_identity_source_changed")
  }
  if (
    message.includes("google_chat_profile_identity_invalid")
    || message.includes("idempotency_key_reused")
  ) return failure("google_chat_profile_identity_invalid_request")
  return failure("google_chat_profile_identity_runtime_unavailable")
}

async function callRpc(
  client: AuthenticatedClient | ServiceClient,
  name: string,
  args?: Record<string, unknown>,
) {
  try {
    const result = await client.rpc(name, args)
    if (result?.error) throw rpcFailure(result.error)
    return result?.data
  } catch (error) {
    if (
      isRecord(error)
      && typeof error.code === "string"
      && Object.prototype.hasOwnProperty.call(SAFE_ERROR_STATUS, error.code)
    ) {
      throw error
    }
    throw rpcFailure(error)
  }
}

function createServiceClient(dependencies: RouteDependencies) {
  try {
    const serviceClient = dependencies.createServiceClient()
    if (!serviceClient || typeof serviceClient.rpc !== "function") {
      throw new Error("invalid service client")
    }
    return serviceClient
  } catch {
    throw failure("google_chat_profile_identity_runtime_unavailable")
  }
}

function parseIdentity(value: unknown): GoogleChatProfileIdentity {
  try {
    return parseGoogleChatProfileIdentity(value)
  } catch {
    throw failure("google_chat_profile_identity_unsafe_response")
  }
}

function parseSyncSource(value: unknown): GoogleChatProfileIdentitySyncSource {
  try {
    return parseGoogleChatProfileIdentitySyncSource(value)
  } catch {
    throw failure("google_chat_profile_identity_unsafe_response")
  }
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase()
}

function classifyDirectoryResult(
  result: GoogleWorkspaceDirectoryLookupResult,
  input: SyncInput,
  source: GoogleChatProfileIdentitySyncSource,
): Readonly<{ outcome: "verified" | "not_found" | "email_mismatch" | "provider_error"; chatUserId: string | null }> {
  if (result.kind === "not_found") return Object.freeze({ outcome: "not_found", chatUserId: null })
  if (result.kind === "provider_error") {
    return Object.freeze({ outcome: "provider_error", chatUserId: null })
  }
  if (result.suspended) return Object.freeze({ outcome: "not_found", chatUserId: null })
  if (input.lookupMode === "manual" && result.id !== input.chatUserId) {
    return Object.freeze({ outcome: "provider_error", chatUserId: null })
  }
  const expectedEmail = normalizedEmail(source.accountEmail)
  const matchesEmail = [result.primaryEmail, ...result.aliases]
    .some((candidate) => normalizedEmail(candidate) === expectedEmail)
  if (!matchesEmail) return Object.freeze({ outcome: "email_mismatch", chatUserId: null })
  return Object.freeze({ outcome: "verified", chatUserId: result.id })
}

export function createGoogleChatProfileIdentityRouteHandlers(dependencies: RouteDependencies) {
  return Object.freeze({
    async get(request: Request) {
      try {
        if (!hasNoQuery(request)) throw failure("google_chat_profile_identity_invalid_request")
        const context = await authenticate(request, dependencies)
        const data = await callRpc(context.actorClient, "list_google_chat_profile_identities_v1")
        let snapshot
        try {
          snapshot = parseGoogleChatProfileIdentitySnapshot({
            identities: data,
            directory: dependencies.directory.configuration,
            editable: true,
          })
        } catch {
          throw failure("google_chat_profile_identity_unsafe_response")
        }
        return json(snapshot)
      } catch (error) {
        return errorResponse(error)
      }
    },

    async post(request: Request) {
      try {
        if (!hasNoQuery(request)) throw failure("google_chat_profile_identity_invalid_request")
        const context = await authenticate(request, dependencies)
        const input = parseSyncInput(await request.json().catch(() => null))
        if (!input) throw failure("google_chat_profile_identity_invalid_request")

        const serviceClient = createServiceClient(dependencies)
        const source = parseSyncSource(await callRpc(
          serviceClient,
          "read_google_chat_profile_identity_sync_source_v1",
          { p_actor_profile_id: context.actorProfileId, p_profile_id: input.profileId },
        ))
        if (source.profileId !== input.profileId) {
          throw failure("google_chat_profile_identity_unsafe_response")
        }
        if (source.identityRevision !== input.expectedIdentityRevision) {
          throw failure("google_chat_profile_identity_revision_conflict")
        }
        if (!dependencies.directory.configuration.configured) {
          throw failure("google_chat_directory_not_configured")
        }

        let lookupResult: GoogleWorkspaceDirectoryLookupResult
        try {
          lookupResult = await dependencies.directory.lookup(
            input.lookupMode === "auto" ? source.accountEmail : input.chatUserId!,
          )
        } catch {
          lookupResult = Object.freeze({ kind: "provider_error" })
        }
        const classified = classifyDirectoryResult(lookupResult, input, source)
        const result = await callRpc(
          serviceClient,
          "apply_google_chat_profile_identity_sync_v1",
          {
            p_actor_profile_id: context.actorProfileId,
            p_profile_id: input.profileId,
            p_account_email_snapshot: source.accountEmail,
            p_lookup_mode: input.lookupMode,
            p_candidate_chat_user_id: classified.chatUserId,
            p_sync_outcome: classified.outcome,
            p_expected_identity_revision: input.expectedIdentityRevision,
            p_request_id: input.requestId,
          },
        )
        const identity = parseIdentity(result)
        if (identity.profileId !== input.profileId) {
          throw failure("google_chat_profile_identity_unsafe_response")
        }
        return json(identity)
      } catch (error) {
        return errorResponse(error)
      }
    },
  })
}

function environmentValue(name: string) {
  const value = process.env[name]
  return typeof value === "string" ? value.trim() : ""
}

export function createProductionGoogleChatProfileIdentityRouteHandlers() {
  const url = environmentValue("NEXT_PUBLIC_SUPABASE_URL") || environmentValue("VITE_SUPABASE_URL")
  const anonKey = environmentValue("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    || environmentValue("VITE_SUPABASE_ANON_KEY")
  const serviceRoleKey = environmentValue("SUPABASE_SERVICE_ROLE_KEY")

  return createGoogleChatProfileIdentityRouteHandlers({
    createAuthenticatedClient(token) {
      if (!url || !anonKey) throw failure("google_chat_profile_identity_runtime_unavailable")
      return createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    },
    createServiceClient() {
      if (!url || !serviceRoleKey) throw failure("google_chat_profile_identity_runtime_unavailable")
      return createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    },
    directory: createProductionGoogleWorkspaceDirectoryClient(),
  })
}
