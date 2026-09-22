import type { NotificationWorkflowKey } from "../notification-control-plane-types.ts"
import type { NotificationWorkflowAdapter } from "./notification-workflow-adapter.ts"
import { makeupRequestsNotificationAdapter } from "./adapters/makeup-requests-notification-adapter.ts"
import { registrationNotificationAdapter } from "./adapters/registration-notification-adapter.ts"
import { tasksNotificationAdapter } from "./adapters/tasks-notification-adapter.ts"
import { transferNotificationAdapter } from "./adapters/transfer-notification-adapter.ts"
import { withdrawalNotificationAdapter } from "./adapters/withdrawal-notification-adapter.ts"
import { wordRetestsNotificationAdapter } from "./adapters/word-retests-notification-adapter.ts"

const adapters: Readonly<Partial<Record<NotificationWorkflowKey, NotificationWorkflowAdapter>>> = Object.freeze({
  tasks: tasksNotificationAdapter,
  word_retests: wordRetestsNotificationAdapter,
  registration: registrationNotificationAdapter,
  transfer: transferNotificationAdapter,
  withdrawal: withdrawalNotificationAdapter,
  makeup_requests: makeupRequestsNotificationAdapter,
})

export function getNotificationWorkflowAdapter(workflowKey: string) {
  return adapters[workflowKey as NotificationWorkflowKey] ?? null
}

export const notificationWorkflowAdapters = adapters
