import { createProductionRegistrationCustomerGuidanceSettingsHandler } from "@/features/tasks/server/registration-customer-message-settings-route"
import { RegistrationCustomerMessageHttpError } from "@/features/tasks/server/registration-customer-message-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handler: ReturnType<typeof createProductionRegistrationCustomerGuidanceSettingsHandler> | null = null

export function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Vary": "Authorization" }
  if (!/^Bearer [^\s]+$/iu.test(request.headers.get("authorization") || "")) {
    return Response.json({ ok: false, code: "registration_customer_message_unauthorized" }, { status: 401, headers })
  }
  try {
    handler ??= createProductionRegistrationCustomerGuidanceSettingsHandler()
    return handler(request)
  } catch (error) {
    return Response.json({ ok: false, code: "registration_customer_message_settings_unavailable" }, {
      status: error instanceof RegistrationCustomerMessageHttpError ? error.status : 503, headers,
    })
  }
}
