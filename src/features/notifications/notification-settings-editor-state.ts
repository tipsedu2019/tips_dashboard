import type { NotificationRuleDraft } from "./notification-control-plane-model.ts"
import type { NotificationMentionSettingDto } from "./notification-mention-settings-types.ts"
import { NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS, type NotificationWorkflowKey, type NotificationRuleDto } from "./notification-control-plane-types.ts"

const REGISTRATION_PROGRESS_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  "registration.case_created": "상담 신청",
  "registration.consultation_completed": "상담 완료",
  "registration.waiting_transitioned": "대기 신청",
  "registration.admission_started": "등록 신청",
}

export function registrationNotificationDisplayRule(rule: NotificationRuleDto): NotificationRuleDto {
  const eventLabel = rule.workflowKey === "registration" && rule.channelKey === "google_chat"
    ? REGISTRATION_PROGRESS_DISPLAY_LABELS[rule.eventKey] : null
  return eventLabel ? { ...rule, eventLabel } : rule
}

export type NotificationSettingsSection = "rules" | "connections" | "customer"
export type RegistrationSettingsGroup = "visit" | "progress" | "archive"
export type NotificationSettingsLocation = {
  workflow: NotificationWorkflowKey
  section: NotificationSettingsSection
  group: RegistrationSettingsGroup | null
}

export function readNotificationSettingsLocation(params: URLSearchParams): NotificationSettingsLocation {
  const workflow = params.get("workflow")
  const section = params.get("section")
  const group = params.get("group")
  return {
    workflow: NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS.some((option) => option.key === workflow)
      ? workflow as NotificationWorkflowKey
      : "tasks",
    section: section === "connections" || section === "customer" ? section : "rules",
    group: group === "visit" || group === "progress" || group === "archive" ? group : null,
  }
}

export function notificationSettingsLocationUrl(href: string, location: NotificationSettingsLocation) {
  const url = new URL(href)
  url.searchParams.set("workflow", location.workflow)
  url.searchParams.set("section", location.section)
  if (location.workflow === "registration" && location.section === "rules" && location.group) {
    url.searchParams.set("group", location.group)
  } else {
    url.searchParams.delete("group")
  }
  return `${url.pathname}${url.search}${url.hash}`
}

export function createTemplateEditorDraft(value: NotificationRuleDraft): NotificationRuleDraft {
  return { ...value, scheduleConfig: value.scheduleConfig ? { ...value.scheduleConfig } : null }
}

export function createMentionDraft(settings: ReadonlyMap<string, NotificationMentionSettingDto>) {
  return new Map(Array.from(settings, ([ruleId, setting]) => [ruleId, setting.mentionEnabled]))
}

export function buildMentionDraftPatch(
  settings: ReadonlyMap<string, NotificationMentionSettingDto>,
  draft: ReadonlyMap<string, boolean>,
) {
  const mentionPatch: Record<string, boolean> = {}
  const expectedMentionRevisions: Record<string, string> = {}
  for (const [ruleId, setting] of settings) {
    const next = draft.get(ruleId)
    if (!setting.editable || next === undefined || next === setting.mentionEnabled) continue
    mentionPatch[ruleId] = next
    expectedMentionRevisions[ruleId] = setting.revision
  }
  return { mentionPatch, expectedMentionRevisions }
}

export function rebaseMentionDraft(
  base: ReadonlyMap<string, NotificationMentionSettingDto>,
  local: ReadonlyMap<string, boolean>,
  remote: ReadonlyMap<string, NotificationMentionSettingDto>,
) {
  const changes = buildMentionDraftPatch(base, local).mentionPatch
  const next = createMentionDraft(remote)
  for (const [ruleId, value] of Object.entries(changes)) {
    if (remote.get(ruleId)?.editable) next.set(ruleId, value)
  }
  return next
}
