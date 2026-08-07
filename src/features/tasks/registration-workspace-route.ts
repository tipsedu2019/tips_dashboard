import type { RegistrationAppointmentCalendarKind } from "./registration-appointment-calendar-model"
import type { RegistrationWorkflowViewKey } from "./registration-case-list-model"

export type RegistrationConsultationOwnerScope = "mine" | "all"
export type RegistrationWorkspaceCalendarKind = "all" | RegistrationAppointmentCalendarKind

export type RegistrationWorkspaceRouteTarget =
  | {
      mode: "list"
      view: RegistrationWorkflowViewKey
      ownerScope: RegistrationConsultationOwnerScope
    }
  | {
      mode: "calendar"
      calendarKind: RegistrationWorkspaceCalendarKind
    }

export type RegistrationDirectDeepLinkTarget = {
  kind: "track"
  taskId: string
  trackId: string
} | {
  kind: "case"
  taskId: string
} | {
  kind: "appointment"
  taskId: string
  trackId: string | null
  appointmentId: string
}

const DETAIL_KEYS = ["taskId", "trackId", "appointmentId"] as const

export function isRegistrationConsultationViewKey(
  value: string,
): value is "consultation_requested" | "consultation_completed" {
  return value === "consultation_requested" || value === "consultation_completed"
}

export function normalizeRegistrationConsultationOwnerScope(
  value: string | null,
): RegistrationConsultationOwnerScope {
  return value === "all" ? "all" : "mine"
}

export function normalizeRegistrationWorkspaceCalendarKind(
  value: string | null,
): RegistrationWorkspaceCalendarKind {
  return value === "level_test" || value === "visit_consultation" ? value : "all"
}

export function getRegistrationDirectDeepLinkTarget(input: {
  viewerId: string
  taskId: string
  trackId: string
  appointmentId: string
  workspaceReady: boolean
  currentSelectionKey: string
  currentAppointmentId?: string
}): RegistrationDirectDeepLinkTarget | null {
  const viewerId = input.viewerId.trim()
  const taskId = input.taskId.trim()
  const trackId = input.trackId.trim()
  const appointmentId = input.appointmentId.trim()
  if (
    !viewerId
    || !taskId
  ) return null

  // A persisted workspace list can be stale. Exact URL targets remain authoritative
  // even when cached list data is already available.

  if (appointmentId) {
    if (
      input.currentSelectionKey === `appointment:${taskId}:${appointmentId}`
      || input.currentAppointmentId?.trim() === appointmentId
    ) return null

    return {
      kind: "appointment",
      taskId,
      trackId: trackId && !trackId.startsWith("legacy:") ? trackId : null,
      appointmentId,
    }
  }

  if (!trackId) {
    if (
      input.currentSelectionKey === `case:${taskId}`
      || input.currentSelectionKey.startsWith(`${taskId}:`)
    ) return null

    return { kind: "case", taskId }
  }

  if (
    trackId.startsWith("legacy:")
    || input.currentSelectionKey === `${taskId}:${trackId}`
  ) return null

  return { kind: "track", taskId, trackId }
}

export function shouldDeferRegistrationWorkspaceLoad(input: {
  viewerId: string
  taskId: string
  trackId: string
  appointmentId: string
  workspaceReady: boolean
  applicationHostKind: "closed" | "create" | "loading_detail" | "detail" | "refresh_failed"
}): boolean {
  const viewerId = input.viewerId.trim()
  const taskId = input.taskId.trim()
  const trackId = input.trackId.trim()
  const appointmentId = input.appointmentId.trim()
  if (
    !viewerId
    || !taskId
    || (!appointmentId && trackId.startsWith("legacy:"))
  ) return false

  return input.applicationHostKind === "closed" || input.applicationHostKind === "loading_detail"
}

export function buildRegistrationWorkspaceSearchParams(
  current: URLSearchParams,
  target: RegistrationWorkspaceRouteTarget,
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of DETAIL_KEYS) next.delete(key)
  next.delete("list")
  next.delete("focus")

  if (target.mode === "calendar") {
    next.set("view", "calendar")
    next.delete("flow")
    next.delete("owner")
    if (target.calendarKind === "all") next.delete("kind")
    else next.set("kind", target.calendarKind)
    return next
  }

  next.set("flow", target.view)
  next.delete("view")
  next.delete("kind")
  if (isRegistrationConsultationViewKey(target.view) && target.ownerScope === "all") {
    next.set("owner", "all")
  } else {
    next.delete("owner")
  }
  return next
}
