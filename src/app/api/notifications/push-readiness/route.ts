import { createProductionPushReadinessRouteHandlers } from "../../../../features/notifications/server/notification-push-readiness-route.ts"

export const runtime = "nodejs"

const handlers = createProductionPushReadinessRouteHandlers()

export const GET = handlers.get
export const POST = handlers.post
