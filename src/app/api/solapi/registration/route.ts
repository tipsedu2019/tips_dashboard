import { createProductionRegistrationCustomerMessageRouteHandlers } from "@/features/tasks/server/registration-customer-message-route"

import { createRegistrationAdmissionRouteHandlers } from "./core.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let customerMessageHandlers: ReturnType<typeof createProductionRegistrationCustomerMessageRouteHandlers> | null = null

const handlers = createRegistrationAdmissionRouteHandlers({
  listAdmissionMessages(request: Request) {
    customerMessageHandlers ??= createProductionRegistrationCustomerMessageRouteHandlers()
    return customerMessageHandlers.messages(request)
  },
})

export function GET(request: Request) {
  return handlers.get(request)
}

export function POST() {
  return handlers.post()
}
