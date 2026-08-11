import { useEffect, useRef } from "react"

import type { RegistrationAppointmentCalendarKind } from "./registration-appointment-calendar-model"
import type { RegistrationWorkflowViewKey } from "./registration-case-list-model"
import type {
  RegistrationObservationAttempt,
  RegistrationObservationManagerAttemptDetail,
} from "./registration-observation-model"
import type { LoadRegistrationObservationManagerAttemptInput } from "./registration-observation-service"

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
} | {
  kind: "observation"
  taskId: string
  trackId: string
  appointmentId: string
  observationId: string
  view: "calendar"
}

export const REGISTRATION_WORKSPACE_DETAIL_KEYS = [
  "taskId",
  "trackId",
  "appointmentId",
  "observationId",
  "view",
] as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RegistrationObservationAsyncOwnershipContext = Readonly<{
  targetKey: string
  viewerId: string
  runtimeVersion: 0 | 1
}>

export type RegistrationObservationAsyncOwnershipToken = Readonly<
  RegistrationObservationAsyncOwnershipContext & { generation: number }
>

export function createRegistrationObservationAsyncOwnership() {
  let generation = 0
  let activeToken: RegistrationObservationAsyncOwnershipToken | null = null

  return {
    begin(context: RegistrationObservationAsyncOwnershipContext) {
      generation += 1
      const token: RegistrationObservationAsyncOwnershipToken = Object.freeze({
        ...context,
        generation,
      })
      activeToken = token
      return token
    },
    invalidate(token?: RegistrationObservationAsyncOwnershipToken) {
      if (token && token !== activeToken) return false
      generation += 1
      activeToken = null
      return true
    },
    owns(
      token: RegistrationObservationAsyncOwnershipToken,
      context: RegistrationObservationAsyncOwnershipContext,
    ) {
      return activeToken === token
        && token.generation === generation
        && token.targetKey === context.targetKey
        && token.viewerId === context.viewerId
        && token.runtimeVersion === 1
        && context.runtimeVersion === 1
    },
  }
}

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
  observationRuntimeVersion: 0 | 1,
): RegistrationWorkspaceCalendarKind {
  if (value === "level_test" || value === "visit_consultation") return value
  return value === "observation" && observationRuntimeVersion === 1 ? value : "all"
}

export function getRegistrationDirectDeepLinkTarget(input: {
  viewerId: string
  searchParams: URLSearchParams
  observationRuntimeVersion: 0 | 1
  workspaceReady: boolean
  currentSelectionKey: string
  currentAppointmentId?: string
}): RegistrationDirectDeepLinkTarget | null {
  const viewerId = input.viewerId.trim()
  if (!viewerId) return null

  if (input.searchParams.has("observationId")) {
    if (input.observationRuntimeVersion !== 1) return null
    const entries = [...input.searchParams.entries()]
    if (
      entries.length !== REGISTRATION_WORKSPACE_DETAIL_KEYS.length
      || entries.some(([key]) => !REGISTRATION_WORKSPACE_DETAIL_KEYS.includes(
        key as (typeof REGISTRATION_WORKSPACE_DETAIL_KEYS)[number],
      ))
      || REGISTRATION_WORKSPACE_DETAIL_KEYS.some((key) => input.searchParams.getAll(key).length !== 1)
    ) return null

    const taskId = input.searchParams.get("taskId") || ""
    const trackId = input.searchParams.get("trackId") || ""
    const appointmentId = input.searchParams.get("appointmentId") || ""
    const observationId = input.searchParams.get("observationId") || ""
    const view = input.searchParams.get("view") || ""
    if (
      !UUID_PATTERN.test(taskId)
      || !UUID_PATTERN.test(trackId)
      || !UUID_PATTERN.test(appointmentId)
      || !UUID_PATTERN.test(observationId)
      || view !== "calendar"
    ) return null

    if (input.currentSelectionKey === `observation:${taskId}:${trackId}:${appointmentId}:${observationId}`) {
      return null
    }

    return {
      kind: "observation",
      taskId,
      trackId,
      appointmentId,
      observationId,
      view: "calendar",
    }
  }

  const taskId = (input.searchParams.get("taskId") || "").trim()
  const trackId = (input.searchParams.get("trackId") || "").trim()
  const appointmentId = (input.searchParams.get("appointmentId") || "").trim()
  if (
    !taskId
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

export function useRegistrationObservationRouteAdjudication(input: {
  enabled: boolean
  viewerId: string
  searchParams: URLSearchParams
  observationRuntimeVersion: 0 | 1
  runtimeProbed: boolean
  workspaceReady: boolean
  currentSelectionKey: string
  onOpen: (
    target: Extract<RegistrationDirectDeepLinkTarget, { kind: "observation" }>,
  ) => void | Promise<unknown>
  onReject: (searchParams: URLSearchParams) => void
}) {
  const {
    currentSelectionKey,
    enabled,
    observationRuntimeVersion,
    onOpen,
    onReject,
    runtimeProbed,
    searchParams: currentSearchParams,
    viewerId,
    workspaceReady,
  } = input
  const rejectedQueryRef = useRef("")
  const querySignature = currentSearchParams.toString()

  useEffect(() => {
    const searchParams = new URLSearchParams(querySignature)
    if (!enabled || !searchParams.has("observationId")) {
      rejectedQueryRef.current = ""
      return
    }
    if (!runtimeProbed) return

    const exactTarget = getRegistrationDirectDeepLinkTarget({
      viewerId,
      searchParams,
      observationRuntimeVersion,
      workspaceReady,
      currentSelectionKey: "",
    })
    if (exactTarget?.kind !== "observation") {
      if (rejectedQueryRef.current === querySignature) return
      rejectedQueryRef.current = querySignature
      onReject(searchParams)
      return
    }

    rejectedQueryRef.current = ""
    const target = getRegistrationDirectDeepLinkTarget({
      viewerId,
      searchParams,
      observationRuntimeVersion,
      workspaceReady,
      currentSelectionKey,
    })
    if (target?.kind === "observation") void onOpen(target)
  }, [
    currentSelectionKey,
    enabled,
    observationRuntimeVersion,
    onOpen,
    onReject,
    querySignature,
    runtimeProbed,
    viewerId,
    workspaceReady,
  ])
}

export async function loadRegistrationObservationDeepLinkedAttempt(
  target: Extract<RegistrationDirectDeepLinkTarget, { kind: "observation" }>,
  load: (
    input: LoadRegistrationObservationManagerAttemptInput,
  ) => Promise<RegistrationObservationManagerAttemptDetail>,
): Promise<RegistrationObservationAttempt | null> {
  try {
    const result = await load({
      trackId: target.trackId,
      observationId: target.observationId,
    })
    if (
      result.taskId !== target.taskId
      || result.trackId !== target.trackId
      || result.observation.taskId !== target.taskId
      || result.observation.trackId !== target.trackId
      || result.observation.appointmentId !== target.appointmentId
      || result.observation.observationId !== target.observationId
    ) return null
    return result.observation
  } catch {
    return null
  }
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
  for (const key of REGISTRATION_WORKSPACE_DETAIL_KEYS) next.delete(key)
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
