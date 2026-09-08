import { parseRegistrationCustomerGuidanceSettings } from "../registration-customer-message-settings-contract.ts"
import {
  createProductionRegistrationCustomerMessageAuth,
  RegistrationCustomerMessageHttpError,
  type RegistrationCustomerMessageAuthContext,
} from "./registration-customer-message-auth.ts"

type Dependencies = Readonly<{
  authenticate: (request: Request) => Promise<RegistrationCustomerMessageAuthContext>
  listSettings: (context: RegistrationCustomerMessageAuthContext) => Promise<unknown>
}>

export function createRegistrationCustomerGuidanceSettingsHandler(dependencies: Dependencies) {
  return async (request: Request) => {
    const headers = { "Cache-Control": "no-store", "Vary": "Authorization" }
    try {
      const context = await dependencies.authenticate(request)
      if (!["admin", "staff"].includes(context.role)) throw new RegistrationCustomerMessageHttpError(403, "registration_customer_message_forbidden")
      if (request.method !== "GET" || new URL(request.url).searchParams.size) throw new RegistrationCustomerMessageHttpError(400, "registration_customer_message_settings_input_invalid")
      return Response.json({ ok: true, settings: parseRegistrationCustomerGuidanceSettings(await dependencies.listSettings(context)) }, { headers })
    } catch (error) {
      return Response.json({ ok: false, code: error instanceof RegistrationCustomerMessageHttpError ? error.code : "registration_customer_message_settings_unavailable" }, {
        status: error instanceof RegistrationCustomerMessageHttpError ? error.status : 503, headers,
      })
    }
  }
}

export function createProductionRegistrationCustomerGuidanceSettingsHandler() {
  const auth = createProductionRegistrationCustomerMessageAuth()
  return createRegistrationCustomerGuidanceSettingsHandler({
    authenticate: auth.authenticate,
    async listSettings(context) {
      const result = await context.serviceClient.rpc("get_registration_customer_guidance_settings_v1", { p_actor_profile_id: context.actorProfileId })
      if (result.error) throw new RegistrationCustomerMessageHttpError(result.error.code === "42501" ? 403 : 503, "registration_customer_message_settings_unavailable")
      return result.data
    },
  })
}
