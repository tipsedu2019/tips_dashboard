import type { NotificationRuleDto } from "./notification-control-plane-types.ts"

export const REGISTRATION_NOTIFICATION_VISIT_EVENTS = [
  "registration.visit_scheduled",
  "registration.visit_rescheduled",
  "registration.visit_replaced",
  "registration.visit_subject_deselected",
  "registration.visit_canceled",
] as const

export const REGISTRATION_NOTIFICATION_PROGRESS_EVENTS = [
  "registration.case_created",
  "registration.consultation_completed",
  "registration.waiting_transitioned",
  "registration.admission_started",
] as const

// These identities remain readable for historical settings and delivery evidence.
// Keep this list aligned with notification_registration_setting_archived_v1 in SQL.
export const REGISTRATION_NOTIFICATION_ARCHIVED_EVENTS = [
  "registration.observation_scheduled",
  "registration.observation_rescheduled",
  "registration.observation_canceled",
  "registration.observation_reminder_due",
  "registration.observation_feedback_due",
  "registration.observation_feedback_submitted",
  "registration.observation_director_reassigned",
  "registration.appointment_reminder_due",
  "registration.registration_completed",
  "registration.case_closed",
] as const

export const REGISTRATION_NOTIFICATION_GROUP_LABELS = {
  visit: "방문상담 인계",
  progress: "관리팀 진행 공유",
  subject: "과목팀 등록 공유",
  archive: "이전 설정",
} as const

export type RegistrationNotificationRulePolicy = Readonly<{
  group: keyof typeof REGISTRATION_NOTIFICATION_GROUP_LABELS
  label: string
  mode: "manual" | "automatic" | "compatibility" | "archived"
  editable: boolean
}>

type RuleIdentity = Pick<NotificationRuleDto, "workflowKey" | "eventKey" | "channelKey">

export function getRegistrationNotificationRulePolicy(
  rule: RuleIdentity,
): RegistrationNotificationRulePolicy | null {
  if (rule.workflowKey !== "registration" || rule.channelKey !== "google_chat") return null
  if (rule.eventKey === "registration.subject_registration_completed") {
    return { group: "subject", label: REGISTRATION_NOTIFICATION_GROUP_LABELS.subject, mode: "automatic", editable: true }
  }
  if ((REGISTRATION_NOTIFICATION_ARCHIVED_EVENTS as readonly string[]).includes(rule.eventKey)) {
    return { group: "archive", label: REGISTRATION_NOTIFICATION_GROUP_LABELS.archive, mode: "archived", editable: false }
  }
  if ((REGISTRATION_NOTIFICATION_VISIT_EVENTS as readonly string[]).includes(rule.eventKey)) {
    return {
      group: "visit",
      label: REGISTRATION_NOTIFICATION_GROUP_LABELS.visit,
      mode: ["registration.visit_replaced", "registration.visit_subject_deselected"].includes(rule.eventKey)
        ? "compatibility" : "manual",
      editable: true,
    }
  }
  if ((REGISTRATION_NOTIFICATION_PROGRESS_EVENTS as readonly string[]).includes(rule.eventKey)) {
    return { group: "progress", label: REGISTRATION_NOTIFICATION_GROUP_LABELS.progress, mode: "manual", editable: true }
  }
  return null
}
