import type { NotificationWorkflowKey } from "../notification-control-plane-types.ts"

export function legacyNotificationWorkflowKey(eventKey: string): NotificationWorkflowKey {
  const prefix = eventKey.split(".")[0]
  if (prefix === "task") return "tasks"
  if (prefix === "word_retest") return "word_retests"
  if (
    prefix === "registration"
    || prefix === "transfer"
    || prefix === "withdrawal"
  ) return prefix
  throw new Error("legacy_notification_workflow_invalid")
}
