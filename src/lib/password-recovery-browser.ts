import { createPasswordRecoveryClient, PASSWORD_RECOVERY_STORAGE_KEY } from "@/lib/supabase"
import { createPasswordRecoveryFlow } from "@/lib/password-recovery"

let recovery: ReturnType<typeof createPasswordRecoveryFlow> | undefined

export function getPasswordRecoveryFlow() {
  if (recovery) return recovery
  const client = createPasswordRecoveryClient()
  if (!client) return null
  const marker = `${PASSWORD_RECOVERY_STORAGE_KEY}-verified`
  recovery = createPasswordRecoveryFlow(client.auth, {
    readUser: () => window.sessionStorage.getItem(marker),
    rememberUser: id => {
      if (id) window.sessionStorage.setItem(marker, id)
      else window.sessionStorage.removeItem(marker)
    },
    clear: () => {
      try { window.sessionStorage.removeItem(marker) }
      finally { window.sessionStorage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY) }
    },
  })
  return recovery
}

export function scrubRecoveryURL() {
  // No return URL from a reset link is used. Credentials and provider error
  // descriptions must not remain in history or leak through navigation.
  window.history.replaceState(window.history.state, "", "/reset-password")
}
