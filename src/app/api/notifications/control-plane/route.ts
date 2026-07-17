import { createProductionNotificationControlPlaneRouteHandlers } from "../../../../features/notifications/server/notification-control-plane-route.ts"

export const runtime = "nodejs"

const handlers = createProductionNotificationControlPlaneRouteHandlers()

export const GET = handlers.get
export const PATCH = handlers.patch
