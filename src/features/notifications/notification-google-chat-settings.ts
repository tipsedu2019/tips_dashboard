import type { NotificationRuleDto } from "./notification-control-plane-types"

export function selectEditableGoogleChatRules(
  rules: ReadonlyArray<NotificationRuleDto>,
) {
  return rules.filter((rule) => rule.channelKey === "google_chat")
}
