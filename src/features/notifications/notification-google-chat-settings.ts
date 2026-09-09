import type { NotificationRuleDto } from "./notification-control-plane-types"

export function selectEditableGoogleChatRules(
  rules: ReadonlyArray<NotificationRuleDto>,
) {
  return rules.filter((rule) => rule.channelKey === "google_chat" && (
    rule.workflowKey !== "word_retests"
    || (rule.eventKey === "word_retest.result_reported"
      && rule.audienceKey === "subject_team"
      && (rule.connectionKey === null || rule.connectionKey === "google_chat.english")
      && rule.ruleVariantKey === "immediate"
      && rule.contentContract?.destinationPolicy.subjectScoped === true
      && rule.contentContract.destinationPolicy.allowedConnectionKeys.length === 1
      && rule.contentContract.destinationPolicy.allowedConnectionKeys[0] === "google_chat.english")
  ))
}
