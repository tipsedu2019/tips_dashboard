import { createProductionRegistrationCustomerMessageRouteHandlers } from "@/features/tasks/server/registration-customer-message-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handlers: ReturnType<typeof createProductionRegistrationCustomerMessageRouteHandlers> | null = null

export function GET(request: Request) {
  handlers ??= createProductionRegistrationCustomerMessageRouteHandlers()
  return handlers.messages(request)
}
