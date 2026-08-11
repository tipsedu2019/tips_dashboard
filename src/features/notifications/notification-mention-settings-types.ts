import type { NotificationWorkflowKey } from "./notification-control-plane-types.ts"

export type NotificationMentionSettingDto = Readonly<{
  ruleId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  channelKey: "google_chat"
  mentionEnabled: boolean
  revision: string
  updatedAt: string | null
  editable: boolean
}>
