import { createProductionNotificationConnectionsRouteHandlers } from "../../../../features/notifications/server/notification-connections-route.ts"

export const runtime = "nodejs"

const handlers = createProductionNotificationConnectionsRouteHandlers()

export const GET = handlers.get
export const PATCH = handlers.patch
