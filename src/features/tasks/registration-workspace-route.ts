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
