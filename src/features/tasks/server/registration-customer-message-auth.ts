import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type RegistrationCustomerMessageRole =
  | "admin"
  | "staff"
  | "teacher"
  | "assistant"
  | "viewer"

export type RegistrationCustomerMessageAuthContext = Readonly<{
  actorProfileId: string
  role: string
  actorClient: SupabaseClient
  serviceClient: SupabaseClient
}>

export class RegistrationCustomerMessageHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = "RegistrationCustomerMessageHttpError"
    this.status = status
    this.code = code
  }
}

type AuthDependencies = Readonly<{
  createAuthenticatedClient(token: string): SupabaseClient
  createServiceClient(): SupabaseClient
}>

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")
  const match = authorization?.match(/^Bearer ([^\s]+)$/iu)
  return match?.[1] ?? ""
}

export function createRegistrationCustomerMessageAuth(dependencies: AuthDependencies) {
  return Object.freeze({
    async authenticate(request: Request): Promise<RegistrationCustomerMessageAuthContext> {
      const token = bearerToken(request)
      if (!token) {
        throw new RegistrationCustomerMessageHttpError(
          401,
          "registration_customer_message_unauthorized",
        )
      }

      let actorClient: SupabaseClient
      let serviceClient: SupabaseClient
      try {
        actorClient = dependencies.createAuthenticatedClient(token)
        serviceClient = dependencies.createServiceClient()
      } catch {
        throw new RegistrationCustomerMessageHttpError(
          503,
          "registration_customer_message_runtime_unavailable",
        )
      }

      let actorProfileId = ""
      try {
        const result = await actorClient.auth.getUser(token)
        actorProfileId = text(result.data.user?.id)
        if (result.error || !actorProfileId) {
          throw new RegistrationCustomerMessageHttpError(
            401,
            "registration_customer_message_unauthorized",
          )
        }
      } catch (error) {
        if (error instanceof RegistrationCustomerMessageHttpError) throw error
        throw new RegistrationCustomerMessageHttpError(
          401,
          "registration_customer_message_unauthorized",
        )
      }

      try {
        const result = await serviceClient
          .from("profiles")
          .select("role")
          .eq("id", actorProfileId)
          .maybeSingle()
        if (result.error) {
          throw new RegistrationCustomerMessageHttpError(
            503,
            "registration_customer_message_runtime_unavailable",
          )
        }
        const role = text((result.data as { role?: unknown } | null)?.role)
        if (!role) {
          throw new RegistrationCustomerMessageHttpError(
            403,
            "registration_customer_message_forbidden",
          )
        }
        return { actorProfileId, role, actorClient, serviceClient }
      } catch (error) {
        if (error instanceof RegistrationCustomerMessageHttpError) throw error
        throw new RegistrationCustomerMessageHttpError(
          503,
          "registration_customer_message_runtime_unavailable",
        )
      }
    },

    async authorizeTask(context: RegistrationCustomerMessageAuthContext, taskId: string) {
      try {
        const result = await context.actorClient
          .from("ops_tasks")
          .select("id,type")
          .eq("id", taskId)
          .eq("type", "registration")
          .maybeSingle()
        return !result.error && text((result.data as { id?: unknown } | null)?.id) === taskId
      } catch {
        return false
      }
    },
  })
}

export function createProductionRegistrationCustomerMessageAuth() {
  const url = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const anonKey = text(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  )
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!url || !anonKey || !serviceRoleKey) {
    throw new RegistrationCustomerMessageHttpError(
      503,
      "registration_customer_message_runtime_unavailable",
    )
  }
  return createRegistrationCustomerMessageAuth({
    createAuthenticatedClient(token) {
      return createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    },
    createServiceClient() {
      return createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    },
  })
}
