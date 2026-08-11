import { createProductionNotificationMentionSettingsRouteHandlers } from "@/features/notifications/server/notification-mention-settings-route"

const handlers = createProductionNotificationMentionSettingsRouteHandlers()

export const GET = handlers.get
export const PATCH = handlers.patch
