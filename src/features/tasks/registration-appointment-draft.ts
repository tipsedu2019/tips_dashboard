import type { OpsRegistrationAppointment } from "./registration-track-service"

export type RegistrationAppointmentDraft = {
  scheduledAt: string
  place: string
  trackIds: string[]
  replaceRemaining: boolean
}

export type RegistrationAppointmentConflict = {
  local: RegistrationAppointmentDraft
  server: OpsRegistrationAppointment
  serverTrackIds: string[]
}

type DraftComparisonField<T> = {
  local: T
  server: T
  changed: boolean
}

export type RegistrationAppointmentDraftComparison = {
  local: RegistrationAppointmentDraft
  server: RegistrationAppointmentDraft
  fields: {
    scheduledAt: DraftComparisonField<string>
    place: DraftComparisonField<string>
    trackIds: DraftComparisonField<string[]>
  }
  hasDifferences: boolean
}

export type RegistrationAppointmentRebase = {
  appointmentId: string
  expectedNotificationRevision: number
  draft: RegistrationAppointmentDraft
}

export type RegistrationAppointmentConfirmationInput = {
  action: "save" | "cancel"
  previous: RegistrationAppointmentDraft | null
  next: RegistrationAppointmentDraft | null
  previousReminderRoundCount: number | null
  nextReminderRoundCount: number | null
  trackLabels?: Record<string, string>
}

export type RegistrationNotificationProcessingReadiness = {
  registrationRuntimeMarker: "registration_appointment_reminders_runtime_version"
  registrationRuntimeVersion: unknown
  adaptersRuntimeMarker: "notification_workflow_adapters_runtime_version"
  adaptersRuntimeVersion: unknown
  workerHeartbeat: { kind: "worker"; phase: unknown; createdAt: unknown } | null
  watchdogHeartbeat: { kind: "watchdog"; phase: unknown; createdAt: unknown } | null
}

const PROCESSING_HEARTBEAT_MAX_AGE_MS = 3 * 60 * 1000

function normalizedTrackIds(trackIds: readonly string[]) {
  return Array.from(new Set(trackIds.map((trackId) => String(trackId).trim()).filter(Boolean))).sort()
}

export function getRegistrationAppointmentParticipantSubjects(
  draft: Pick<RegistrationAppointmentDraft, "trackIds"> | null | undefined,
  trackLabels: Record<string, string>,
) {
  return normalizedTrackIds(draft?.trackIds || [])
    .map((trackId) => trackLabels[trackId])
    .filter((subject): subject is string => Boolean(subject))
}

function cloneDraft(draft: RegistrationAppointmentDraft): RegistrationAppointmentDraft {
  return {
    scheduledAt: String(draft.scheduledAt || ""),
    place: String(draft.place || ""),
    trackIds: normalizedTrackIds(draft.trackIds),
    replaceRemaining: draft.replaceRemaining === true,
  }
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function compareRegistrationAppointmentDraft(
  conflict: RegistrationAppointmentConflict,
): RegistrationAppointmentDraftComparison {
  const local = cloneDraft(conflict.local)
  const server: RegistrationAppointmentDraft = {
    scheduledAt: String(conflict.server.scheduledAt || ""),
    place: String(conflict.server.place || ""),
    trackIds: normalizedTrackIds(conflict.serverTrackIds),
    replaceRemaining: false,
  }
  const fields = {
    scheduledAt: {
      local: local.scheduledAt,
      server: server.scheduledAt,
      changed: local.scheduledAt !== server.scheduledAt,
    },
    place: {
      local: local.place,
      server: server.place,
      changed: local.place !== server.place,
    },
    trackIds: {
      local: [...local.trackIds],
      server: [...server.trackIds],
      changed: !sameList(local.trackIds, server.trackIds),
    },
  }
  return {
    local,
    server,
    fields,
    hasDifferences: fields.scheduledAt.changed || fields.place.changed || fields.trackIds.changed,
  }
}

export function rebaseRegistrationAppointmentDraft(
  conflict: RegistrationAppointmentConflict,
): RegistrationAppointmentRebase {
  return {
    appointmentId: conflict.server.id,
    expectedNotificationRevision: conflict.server.notificationRevision,
    draft: cloneDraft(conflict.local),
  }
}

function roundCountLabel(value: number | null) {
  return Number.isInteger(value) && Number(value) >= 0 ? `${value}회` : "확인 불가"
}

function draftLabel(
  draft: RegistrationAppointmentDraft | null,
  trackLabels: Record<string, string>,
  emptyLabel: string,
) {
  if (!draft) return emptyLabel
  const tracks = normalizedTrackIds(draft.trackIds)
    .map((trackId) => trackLabels[trackId] || trackId)
    .join(", ") || "적용 과목 없음"
  return `${draft.scheduledAt || "일시 없음"} · ${draft.place || "장소 없음"} · ${tracks}`
}

export function buildRegistrationAppointmentConfirmation(
  input: RegistrationAppointmentConfirmationInput,
) {
  const title = input.action === "cancel"
    ? "예약 취소 내용을 확인해 주세요."
    : "예약 변경 내용을 확인해 주세요."
  const labels = input.trackLabels || {}
  return [
    title,
    `이전 · ${draftLabel(input.previous, labels, "예약 없음")}`,
    `이후 · ${draftLabel(input.next, labels, input.action === "cancel" ? "예약 취소" : "예약 없음")}`,
    `미래 알림 · ${roundCountLabel(input.previousReminderRoundCount)} → ${roundCountLabel(input.nextReminderRoundCount)}`,
  ].join("\n")
}

function hasRecentSuccessfulHeartbeat(
  heartbeat:
    | RegistrationNotificationProcessingReadiness["workerHeartbeat"]
    | RegistrationNotificationProcessingReadiness["watchdogHeartbeat"],
  expectedKind: "worker" | "watchdog",
  now: number,
) {
  if (!heartbeat || heartbeat.kind !== expectedKind || heartbeat.phase !== "succeeded") return false
  const createdAt = Date.parse(String(heartbeat.createdAt || ""))
  if (!Number.isFinite(createdAt)) return false
  const age = now - createdAt
  return age >= 0 && age <= PROCESSING_HEARTBEAT_MAX_AGE_MS
}

export function isRegistrationNotificationProcessingReady(
  readiness: RegistrationNotificationProcessingReadiness | null | undefined,
  now = Date.now(),
) {
  return Boolean(
    readiness
    && readiness.registrationRuntimeMarker === "registration_appointment_reminders_runtime_version"
    && readiness.registrationRuntimeVersion === 1
    && readiness.adaptersRuntimeMarker === "notification_workflow_adapters_runtime_version"
    && readiness.adaptersRuntimeVersion === 1
    && hasRecentSuccessfulHeartbeat(readiness.workerHeartbeat, "worker", now)
    && hasRecentSuccessfulHeartbeat(readiness.watchdogHeartbeat, "watchdog", now),
  )
}
