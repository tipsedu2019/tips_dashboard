import {
  parseGoogleChatProfileIdentity,
  parseGoogleChatProfileIdentitySnapshot,
  type GoogleChatProfileIdentity,
  type GoogleChatProfileIdentitySnapshot,
} from "./google-chat-profile-identity-types.ts"

export type GoogleChatProfileIdentitySyncInput = Readonly<{
  profile_id: string
  lookup_mode: "auto" | "manual"
  chat_user_id: string | null
  expected_identity_revision: string
  request_id: string
}>

type GoogleChatProfileIdentityServiceOptions = Readonly<{
  getAccessToken(): Promise<string | null>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}>

const ENDPOINT = "/api/admin/google-chat-identities"
const DEFAULT_TIMEOUT_MS = 12_000
const SAFE_ERROR_CODES = new Set([
  "google_chat_profile_identity_unauthorized",
  "google_chat_profile_identity_forbidden",
  "google_chat_profile_identity_invalid_request",
  "google_chat_profile_identity_not_found",
  "google_chat_profile_identity_revision_conflict",
  "google_chat_profile_identity_source_changed",
  "google_chat_directory_not_configured",
  "google_chat_profile_identity_runtime_unavailable",
  "google_chat_profile_identity_unsafe_response",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeErrorCode(value: unknown) {
  return isRecord(value) && typeof value.code === "string" && SAFE_ERROR_CODES.has(value.code)
    ? value.code
    : "google_chat_profile_identity_request_failed"
}

function withDeadline<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", handleExternalAbort)
      callback()
    }
    const handleExternalAbort = () => {
      finish(() => {
        controller.abort()
        reject(new Error("google_chat_profile_identity_request_aborted"))
      })
    }
    const timeout = setTimeout(() => {
      finish(() => {
        controller.abort()
        reject(new Error("google_chat_profile_identity_timeout"))
      })
    }, timeoutMs)

    if (externalSignal?.aborted) {
      handleExternalAbort()
      return
    }
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true })
    void operation(controller.signal).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>
}

export function createGoogleChatProfileIdentityService(
  options: GoogleChatProfileIdentityServiceOptions,
): Readonly<{
  list(signal?: AbortSignal): Promise<GoogleChatProfileIdentitySnapshot>
  sync(
    input: GoogleChatProfileIdentitySyncInput,
    signal?: AbortSignal,
  ): Promise<GoogleChatProfileIdentity>
}> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const configuredTimeout = Number(options.timeoutMs)
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS

  async function request(
    init: RequestInit,
    parse: (value: unknown) => GoogleChatProfileIdentity | GoogleChatProfileIdentitySnapshot,
    signal?: AbortSignal,
  ) {
    return withDeadline(timeoutMs, signal, async (requestSignal) => {
      const token = await options.getAccessToken()
      if (typeof token !== "string" || token.length === 0 || token.trim() !== token) {
        throw new Error("google_chat_profile_identity_auth_required")
      }
      if (requestSignal.aborted) {
        throw new Error("google_chat_profile_identity_request_aborted")
      }
      let response: Response
      try {
        response = await fetcher(ENDPOINT, {
          ...init,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
          },
          signal: requestSignal,
        })
      } catch (error) {
        if (requestSignal.aborted) throw error
        throw new Error("google_chat_profile_identity_request_failed")
      }
      const payload = await readJson(response)
      if (!response.ok) throw new Error(safeErrorCode(payload))
      return parse(payload)
    })
  }

  return Object.freeze({
    list(signal?: AbortSignal) {
      return request(
        { method: "GET" },
        parseGoogleChatProfileIdentitySnapshot,
        signal,
      ) as Promise<GoogleChatProfileIdentitySnapshot>
    },
    sync(input: GoogleChatProfileIdentitySyncInput, signal?: AbortSignal) {
      return request(
        { method: "POST", body: JSON.stringify(input) },
        parseGoogleChatProfileIdentity,
        signal,
      ) as Promise<GoogleChatProfileIdentity>
    },
  })
}
