import { createProductionRegistrationCustomerReminderRouteHandlers } from "@/features/tasks/server/registration-customer-reminder-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handlers: ReturnType<typeof createProductionRegistrationCustomerReminderRouteHandlers> | null = null

function productionHandlers() {
  handlers ??= createProductionRegistrationCustomerReminderRouteHandlers()
  return handlers
}

export function GET(request: Request) {
  return productionHandlers().settings(request)
}

export function PATCH(request: Request) {
  return productionHandlers().settings(request)
}
