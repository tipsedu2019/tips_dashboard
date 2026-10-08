import type { SupabaseClient } from "@supabase/supabase-js"

export type RecoveryState = "ready" | "invalid" | "unavailable" | "complete"
type Auth = Pick<SupabaseClient["auth"], "setSession" | "verifyOtp" | "getSession" | "getUser" | "updateUser" | "signOut">

// All credentials stay inside this closure and the dedicated SDK storage.
// The view receives only a state; neither URLs nor provider errors are rendered.
type RecoveryStorage = {
  readUser: () => string | null
  rememberUser: (id: string | null) => void
  clear: () => void
}

export function createPasswordRecoveryFlow(auth: Auth, storage: RecoveryStorage) {
  const clearStorage = () => {
    try { storage.clear() } catch { /* cleanup cannot hide the verified result */ }
  }
  let initial: Promise<RecoveryState> | undefined
  let state: RecoveryState = "invalid"
  let userId: string | undefined
  let submitting = false

  const invalidate = (): RecoveryState => {
    userId = undefined
    state = "invalid"
    clearStorage()
    return state
  }

  function verificationError(error: { status?: number; name?: string }): RecoveryState {
    invalidate()
    if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500) {
      state = "unavailable"
    }
    return state
  }

  async function verify(url: URL): Promise<RecoveryState> {
    const hash = new URLSearchParams(url.hash.slice(1))
    const query = url.searchParams
    const hasError = [hash, query].some(params => params.has("error") || params.has("error_code"))
    if (hasError) return invalidate()

    try {
      const accessToken = hash.get("access_token")
      const refreshToken = hash.get("refresh_token")
      const tokenHash = query.get("token_hash")
      const hasCallback = url.hash !== "" || [...query.keys()].some(key =>
        ["token_hash", "token", "code", "type", "access_token", "refresh_token"].includes(key))

      if (accessToken && refreshToken && hash.get("type") === "recovery" && !tokenHash) {
        clearStorage()
        const { error } = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) return verificationError(error)
      } else if (tokenHash && query.get("type") === "recovery" && !url.hash) {
        clearStorage()
        const { error } = await auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
        if (error) return verificationError(error)
      } else if (hasCallback) {
        // Never exchange a generic sign-in code or accept a non-recovery link.
        return invalidate()
      }

      const { data, error } = await auth.getSession()
      if (error) return verificationError(error)
      if (!data.session) return invalidate()
      if (!hasCallback && storage.readUser() !== data.session.user.id) return invalidate()
      const verified = await auth.getUser()
      if (verified.error) return verificationError(verified.error)
      if (verified.data.user?.id !== data.session.user.id) return invalidate()
      userId = verified.data.user.id
      storage.rememberUser(userId)
      state = "ready"
      return state
    } catch {
      invalidate()
      state = "unavailable"
      return state
    }
  }

  return {
    initialize(url: URL, scrubURL: () => void) {
      // React strict effects and remounts must never consume an OTP twice.
      if (!initial) {
        scrubURL()
        initial = verify(url)
      }
      return initial.then(() => state)
    },
    async submit(password: string): Promise<RecoveryState | "busy" | "retry"> {
      if (submitting) return "busy"
      if (state !== "ready" || !userId) return state
      submitting = true
      try {
        const verified = await auth.getUser()
        if (verified.error) {
          if (verified.error.name === "AuthRetryableFetchError" || verified.error.status === 0 || (verified.error.status ?? 0) >= 500) return "retry"
          return invalidate()
        }
        if (verified.data.user?.id !== userId) return invalidate()
        const { error } = await auth.updateUser({ password })
        if (error) {
          if (error.status === 401 || error.status === 403) return invalidate()
          return "retry"
        }
        state = "complete"
        userId = undefined
        try { storage.rememberUser(null) } catch { /* still revoke the session */ }
        // Remove only this tab's recovery session even when logout is offline.
        // Sign-out must read the session before its persistent copy is removed.
        try { await auth.signOut({ scope: "local" }) } catch { /* local cleanup still runs */ }
        finally { clearStorage() }
        return state
      } catch {
        return "retry"
      } finally {
        submitting = false
      }
    },
  }
}
