import { createProductionRegistrationCustomerReminderRouteHandlers } from "@/features/tasks/server/registration-customer-reminder-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handlers: ReturnType<typeof createProductionRegistrationCustomerReminderRouteHandlers> | null = null

export function POST(request: Request) {
  handlers ??= createProductionRegistrationCustomerReminderRouteHandlers()
  return handlers.worker(request)
}
