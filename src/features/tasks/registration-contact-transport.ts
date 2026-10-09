export type RegistrationContactCommand = "create" | "update_common" | "save_inquiry" | "set_workflow_status" | "waiting_details" | "close" | "reopen"
export type RegistrationContactMutation = {
  command: RegistrationContactCommand
  taskId: string | null
  requestKey: string
  expectedGeneration: string | null
  expectedRevision: string | null
  payload: Record<string, unknown>
}

/** The browser supplies a session, never a trusted contact digest or service credential. */
export function createRegistrationContactTransport(options: {
  getAccessToken: () => Promise<string | null>
  fetch?: typeof fetch
  timeoutMs?: number
}) {
  return async (mutation: RegistrationContactMutation): Promise<Record<string, unknown>> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error("registration_contact_mutation_timeout"))
      }, options.timeoutMs ?? 8_000)
    })
    try {
      return await Promise.race([(async () => {
        const token = await options.getAccessToken()
        if (!token) throw new Error("registration_contact_auth_required")
        if (controller.signal.aborted) throw new Error("registration_contact_mutation_timeout")
        const response = await (options.fetch ?? fetch)("/api/registration/contact", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(mutation),
        })
        const result: unknown = await response.json()
        if (!response.ok) {
          const code = result && typeof result === "object" && "error" in result ? (result as { error: unknown }).error : null
          throw new Error(typeof code === "string" && /^[a-z0-9_]+$/.test(code) ? code : "registration_contact_mutation_failed")
        }
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("registration_contact_response_invalid")
        return result as Record<string, unknown>
      })(), timeout])
    } catch (error) {
      if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) throw error
      throw new Error("registration_contact_mutation_unavailable")
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
