import { createProductionGoogleChatProfileIdentityRouteHandlers } from "../../../../features/management/server/google-chat-profile-identity-route.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let handlers: ReturnType<typeof createProductionGoogleChatProfileIdentityRouteHandlers> | null = null

function productionHandlers() {
  handlers ??= createProductionGoogleChatProfileIdentityRouteHandlers()
  return handlers
}

export function GET(request: Request) {
  return productionHandlers().get(request)
}

export function POST(request: Request) {
  return productionHandlers().post(request)
}
