import type { SupabaseClient } from "@supabase/supabase-js"

import { withPromiseTimeout } from "./promise-timeout.ts"

const AUTH_OPERATION_TIMEOUT_MS = 10_000
const AUTH_OPERATION_TIMEOUT_CODE = "auth_operation_timeout"
const AUTH_OPERATION_TIMEOUT_MESSAGE =
  "서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."

type AuthClient = Pick<SupabaseClient, "auth">
type PasswordCredentials = Parameters<
  SupabaseClient["auth"]["signInWithPassword"]
>[0]

function withAuthOperationTimeout<T>(operation: PromiseLike<T>, timeoutMs: number) {
  return withPromiseTimeout(operation, {
    timeoutMs,
    code: AUTH_OPERATION_TIMEOUT_CODE,
    message: AUTH_OPERATION_TIMEOUT_MESSAGE,
  })
}

export function loadAuthSession(
  client: AuthClient,
  timeoutMs = AUTH_OPERATION_TIMEOUT_MS,
) {
  return withAuthOperationTimeout(client.auth.getSession(), timeoutMs)
}

export function signInWithPassword(
  client: AuthClient,
  credentials: PasswordCredentials,
  timeoutMs = AUTH_OPERATION_TIMEOUT_MS,
) {
  return withAuthOperationTimeout(
    client.auth.signInWithPassword(credentials),
    timeoutMs,
  )
}
