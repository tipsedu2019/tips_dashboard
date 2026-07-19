"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimePickerControl } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  getEligibleSharedAppointmentTracks,
  getLatestRegistrationLevelTestActivityIds,
  getRegistrationAppointmentEditMode,
  getRegistrationAppointmentPayloadTrackIds,
} from "./registration-track-model.js"
import { REGISTRATION_TIME_OPTIONS } from "./registration-workflow.js"
import { sendRegistrationVisitNotificationTarget } from "./registration-consultation-notification.js"
import {
  buildRegistrationAppointmentConfirmation,
  compareRegistrationAppointmentDraft,
  getRegistrationAppointmentParticipantSubjects,
  isRegistrationNotificationProcessingReady,
  rebaseRegistrationAppointmentDraft,
  type RegistrationAppointmentConflict,
  type RegistrationAppointmentDraft,
  type RegistrationNotificationProcessingReadiness,
} from "./registration-appointment-draft"
import {
  cancelRegistrationAppointment,
  closeRegistrationLevelTestTrack,
  completeRegistrationLevelTestAttempt,
  createRegistrationMutationRequestKey,
  getRegistrationNotificationProcessingReadiness,
  getRegistrationNotificationJobStatus,
  previewRegistrationAppointmentReminders,
  retryRegistrationNotificationJob,
  saveRegistrationSharedAppointment,
  startRegistrationLevelTestAttempt,
  type OpsRegistrationAppointment,
  type OpsRegistrationConsultation,
  type OpsRegistrationLevelTest,
  type OpsRegistrationTrackSummary,
  type RegistrationAppointmentMutationResponse,
  type RegistrationNotificationJobStatus,
} from "./registration-track-service"

type RegistrationAppointmentActivity = OpsRegistrationLevelTest | OpsRegistrationConsultation

export type RegistrationAppointmentEditorProps = {
  kind: OpsRegistrationAppointment["kind"]
  taskId: string
  eligibleTracks: OpsRegistrationTrackSummary[]
  initialTrackId?: string
  appointment: OpsRegistrationAppointment | null
  activities: RegistrationAppointmentActivity[]
  onSaved: (saved: RegistrationAppointmentMutationResponse) => void | Promise<void>
  onWarning: (message: string) => void
  onReload?: () => void | Promise<void>
  onClose?: () => void
  onRebook?: (trackId: string) => void
  embedded?: boolean
  notificationToken?: string
  notificationProcessingReadiness?: RegistrationNotificationProcessingReadiness | null
  onDirtyChange?: (dirty: boolean) => void
  onTrackDirtyChange?: (trackId: string, dirty: boolean) => void
}

type SubmissionKeys = {
  getOrCreate: (kind: string, logicalDraft: string) => string
  clear: (kind: string, logicalDraft: string) => void
}

const ACTIVITY_STATUS_LABELS: Record<RegistrationAppointmentActivity["status"], string> = {
  waiting: "전화상담 대기",
  scheduled: "예약",
  in_progress: "진행",
  completed: "완료",
  absent: "미응시",
  canceled: "취소",
}

type PersistedConflictDraft = {
  local: RegistrationAppointmentDraft
  appointmentId: string | null
  expectedNotificationRevision: number | null
}

const persistedAppointmentSubmissionKeys = new Map<string, string>()
const persistedAppointmentConflictDrafts = new Map<string, PersistedConflictDraft>()
const NOTIFICATION_JOB_POLL_ATTEMPTS = 8
const NOTIFICATION_JOB_POLL_INTERVAL_MS = 750

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function toLocalDateTime(value: string | null | undefined) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)?.[1] || ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toScheduledAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function useSubmissionKeys(scopeKey: string): SubmissionKeys {
  return {
    getOrCreate(kind, logicalDraft) {
      const logicalKey = `${scopeKey}:${kind}:${logicalDraft}`
      const current = persistedAppointmentSubmissionKeys.get(logicalKey)
      if (current) return current
      const next = createRegistrationMutationRequestKey(kind, logicalDraft)
      persistedAppointmentSubmissionKeys.set(logicalKey, next)
      return next
    },
    clear(kind, logicalDraft) {
      persistedAppointmentSubmissionKeys.delete(`${scopeKey}:${kind}:${logicalDraft}`)
    },
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function RegistrationActivityStatusBadge({ status }: { status: RegistrationAppointmentActivity["status"] }) {
  const variant = ["completed"].includes(status)
    ? "default"
    : ["absent", "canceled"].includes(status)
      ? "secondary"
      : "outline"
  return <Badge variant={variant}>{ACTIVITY_STATUS_LABELS[status]}</Badge>
}

function useOwnedDirtyState(dirty: boolean, onDirtyChange?: (dirty: boolean) => void) {
  const reportedRef = useRef(false)
  const callbackRef = useRef(onDirtyChange)
  useEffect(() => {
    callbackRef.current = onDirtyChange
  }, [onDirtyChange])
  useEffect(() => {
    if (reportedRef.current === dirty) return
    reportedRef.current = dirty
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => {
    if (reportedRef.current) callbackRef.current?.(false)
  }, [])
}

export function RegistrationAppointmentEditor({
  kind,
  taskId,
  eligibleTracks,
  initialTrackId = "",
  appointment,
  activities,
  onSaved,
  onWarning,
  onReload,
  onClose,
  onRebook,
  embedded = false,
  notificationToken = "",
  notificationProcessingReadiness = null,
  onDirtyChange,
  onTrackDirtyChange,
}: RegistrationAppointmentEditorProps) {
  const conflictScopeKey = `${taskId}:${kind}`
  const submissionKeys = useSubmissionKeys(conflictScopeKey)
  const trackById = useMemo(() => new Map(eligibleTracks.map((track) => [track.id, track])), [eligibleTracks])
  const matchingActivities = useMemo(() => activities.filter((activity) => (
    kind === "level_test"
      ? "attemptNumber" in activity
      : "mode" in activity && activity.mode === "visit"
  )), [activities, kind])
  const currentActivities = useMemo(() => (
    appointment
      ? matchingActivities.filter((activity) => activity.appointmentId === appointment.id)
      : []
  ), [appointment, matchingActivities])
  const editMode = getRegistrationAppointmentEditMode(currentActivities)
  const selectableTracks = getEligibleSharedAppointmentTracks(
    kind,
    eligibleTracks,
    matchingActivities,
    appointment?.id || null,
  )
  const initialSelectedTrackIds = appointment
    ? currentActivities.filter((activity) => activity.status === "scheduled").map((activity) => activity.trackId)
    : selectableTracks.some((track) => track.id === initialTrackId)
      ? [initialTrackId]
      : selectableTracks[0]?.id
        ? [selectableTracks[0].id]
        : []

  const cachedConflictDraft = persistedAppointmentConflictDrafts.get(conflictScopeKey) || null
  const initialDraft = cachedConflictDraft?.local || null

  const [scheduledAt, setScheduledAt] = useState(() => toLocalDateTime(initialDraft?.scheduledAt || appointment?.scheduledAt))
  const [place, setPlace] = useState(initialDraft?.place || appointment?.place || "")
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(() => Array.from(new Set(
    initialDraft?.trackIds || initialSelectedTrackIds,
  )))
  const [draftReplaceRemaining, setDraftReplaceRemaining] = useState(
    initialDraft?.replaceRemaining ?? editMode === "replace_remaining",
  )
  const [preserveLocalDraft, setPreserveLocalDraft] = useState(Boolean(cachedConflictDraft))
  const [baseAppointmentId, setBaseAppointmentId] = useState<string | null>(
    cachedConflictDraft ? cachedConflictDraft.appointmentId : appointment?.id || null,
  )
  const [expectedNotificationRevision, setExpectedNotificationRevision] = useState<number | null>(
    cachedConflictDraft
      ? cachedConflictDraft.expectedNotificationRevision
      : appointment?.notificationRevision ?? null,
  )
  const [conflict, setConflict] = useState<RegistrationAppointmentConflict | null>(() => (
    cachedConflictDraft && appointment
      ? {
          local: { ...cachedConflictDraft.local, trackIds: [...cachedConflictDraft.local.trackIds] },
          server: { ...appointment },
          serverTrackIds: [...initialSelectedTrackIds],
        }
      : null
  ))
  const [showConflictComparison, setShowConflictComparison] = useState(Boolean(cachedConflictDraft && appointment))
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({})
  const [closureReasons, setClosureReasons] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [activitySavingId, setActivitySavingId] = useState("")
  const [refreshPending, setRefreshPending] = useState(false)
  const [trackRefreshPendingIds, setTrackRefreshPendingIds] = useState<Set<string>>(() => new Set())
  const [trackRefreshRetryingId, setTrackRefreshRetryingId] = useState("")
  const [validationError, setValidationError] = useState("")
  const sectionRef = useRef<HTMLElement | null>(null)
  const [committedAppointment, setCommittedAppointment] = useState<RegistrationAppointmentMutationResponse | null>(null)
  const [pendingNotificationTargets, setPendingNotificationTargets] = useState<RegistrationAppointmentMutationResponse["notificationTargets"]>([])
  const [notificationJobStatuses, setNotificationJobStatuses] = useState<RegistrationNotificationJobStatus[]>([])
  const [notificationProcessingPhase, setNotificationProcessingPhase] = useState<"idle" | "processing" | "succeeded" | "failed">("idle")
  const [loadedProcessingReadiness, setLoadedProcessingReadiness] = useState<RegistrationNotificationProcessingReadiness | null>(null)
  const notificationRetryRequestIds = useRef(new Map<string, string>())
  const notificationPollGeneration = useRef(0)
  const latestConflictServerKey = useRef("")
  const [, setProcessingReadinessTick] = useState(0)
  const effectiveProcessingReadiness = notificationProcessingReadiness ?? loadedProcessingReadiness

  useEffect(() => {
    if (notificationProcessingReadiness || !notificationToken) return
    let canceled = false
    async function refreshProcessingReadiness() {
      try {
        const readiness = await getRegistrationNotificationProcessingReadiness(notificationToken)
        if (!canceled) setLoadedProcessingReadiness(readiness)
      } catch {
        if (!canceled) setLoadedProcessingReadiness(null)
      }
    }
    void refreshProcessingReadiness()
    const intervalId = window.setInterval(() => void refreshProcessingReadiness(), 60_000)
    return () => {
      canceled = true
      window.clearInterval(intervalId)
    }
  }, [notificationProcessingReadiness, notificationToken])

  useEffect(() => {
    const workerCreatedAt = Date.parse(String(effectiveProcessingReadiness?.workerHeartbeat?.createdAt || ""))
    const watchdogCreatedAt = Date.parse(String(effectiveProcessingReadiness?.watchdogHeartbeat?.createdAt || ""))
    if (!Number.isFinite(workerCreatedAt) || !Number.isFinite(watchdogCreatedAt)) return
    const expiresAt = Math.min(workerCreatedAt, watchdogCreatedAt) + 3 * 60 * 1000
    const timeoutId = window.setTimeout(() => {
      setProcessingReadinessTick((current) => current + 1)
    }, Math.max(0, expiresAt - Date.now() + 1))
    return () => window.clearTimeout(timeoutId)
  }, [effectiveProcessingReadiness])

  const conflictServerTrackKey = initialSelectedTrackIds.slice().sort().join("\u001f")
  const conflictServerSnapshotKey = appointment
    ? JSON.stringify({
        id: appointment.id,
        kind: appointment.kind,
        notificationRevision: appointment.notificationRevision,
        place: appointment.place,
        scheduledAt: appointment.scheduledAt,
        status: appointment.status,
        trackIds: conflictServerTrackKey,
      })
    : ""
  useEffect(() => {
    if (!preserveLocalDraft || !appointment) {
      latestConflictServerKey.current = ""
      return
    }
    if (latestConflictServerKey.current === conflictServerSnapshotKey) return
    const cached = persistedAppointmentConflictDrafts.get(conflictScopeKey)
    if (!cached) return
    latestConflictServerKey.current = conflictServerSnapshotKey
    setConflict({
      local: { ...cached.local, trackIds: [...cached.local.trackIds] },
      server: { ...appointment },
      serverTrackIds: conflictServerTrackKey ? conflictServerTrackKey.split("\u001f") : [],
    })
  }, [
    appointment,
    conflictScopeKey,
    conflictServerSnapshotKey,
    conflictServerTrackKey,
    preserveLocalDraft,
  ])

  const effectiveSelectedTrackIds = getRegistrationAppointmentPayloadTrackIds(
    editMode,
    selectedTrackIds,
    currentActivities,
    appointment?.id || null,
  )
  const latestLevelTestActivityIds = useMemo(() => new Set(
    getLatestRegistrationLevelTestActivityIds(matchingActivities.filter((activity) => "attemptNumber" in activity)),
  ), [matchingActivities])
  const mutationLocked = refreshPending || Boolean(committedAppointment)

  const displayActivityIds = useMemo(() => {
    if (appointment) return new Set(currentActivities.map((activity) => activity.id))
    return new Set(matchingActivities
      .filter((activity) => (
        "attemptNumber" in activity
        && latestLevelTestActivityIds.has(activity.id)
        && ["absent", "canceled"].includes(activity.status)
      ))
      .map((activity) => activity.id))
  }, [appointment, currentActivities, latestLevelTestActivityIds, matchingActivities])

  const appointmentDraft: RegistrationAppointmentDraft = {
    scheduledAt: toScheduledAt(scheduledAt),
    place: place.trim(),
    trackIds: [...(preserveLocalDraft ? selectedTrackIds : effectiveSelectedTrackIds)].sort(),
    replaceRemaining: draftReplaceRemaining,
  }
  const previousAppointmentDraft: RegistrationAppointmentDraft | null = appointment
    ? {
        scheduledAt: appointment.scheduledAt,
        place: appointment.place,
        trackIds: currentActivities
          .filter((activity) => activity.status === "scheduled")
          .map((activity) => activity.trackId)
          .sort(),
        replaceRemaining: false,
      }
    : null
  const initialAppointmentDraftRef = useRef<RegistrationAppointmentDraft>({
    scheduledAt: toScheduledAt(toLocalDateTime(initialDraft?.scheduledAt || appointment?.scheduledAt)),
    place: initialDraft?.place || appointment?.place || "",
    trackIds: [...(initialDraft?.trackIds || initialSelectedTrackIds)].sort(),
    replaceRemaining: initialDraft?.replaceRemaining ?? editMode === "replace_remaining",
  })
  const appointmentDirty = JSON.stringify(appointmentDraft) !== JSON.stringify(initialAppointmentDraftRef.current)
  useOwnedDirtyState(!mutationLocked && appointmentDirty, onDirtyChange)
  const reportedTrackDirtyRef = useRef(new Set<string>())
  const onTrackDirtyChangeRef = useRef(onTrackDirtyChange)
  useEffect(() => {
    onTrackDirtyChangeRef.current = onTrackDirtyChange
  }, [onTrackDirtyChange])
  useEffect(() => {
    const dirtyTrackIds = new Set<string>()
    for (const activity of matchingActivities) {
      if (!trackById.has(activity.trackId)) continue
      const linkDirty = "materialLink" in activity
        && (draftLinks[activity.id] ?? activity.materialLink ?? "") !== (activity.materialLink ?? "")
      const reasonDirty = Boolean(closureReasons[activity.trackId])
      if (linkDirty || reasonDirty) dirtyTrackIds.add(activity.trackId)
    }
    for (const trackId of new Set([...reportedTrackDirtyRef.current, ...dirtyTrackIds])) {
      const wasDirty = reportedTrackDirtyRef.current.has(trackId)
      const isDirty = dirtyTrackIds.has(trackId)
      if (wasDirty !== isDirty) onTrackDirtyChangeRef.current?.(trackId, isDirty)
    }
    reportedTrackDirtyRef.current = dirtyTrackIds
  }, [closureReasons, draftLinks, matchingActivities, trackById, trackRefreshPendingIds])
  useEffect(() => () => {
    for (const trackId of reportedTrackDirtyRef.current) onTrackDirtyChangeRef.current?.(trackId, false)
  }, [])
  const conflictComparison = conflict
    ? compareRegistrationAppointmentDraft({
        ...conflict,
        local: appointmentDraft,
      })
    : null
  const canApplyConflictDraft = Boolean(
    conflict
    && (
      conflict.server.id !== baseAppointmentId
      || conflict.server.notificationRevision !== expectedNotificationRevision
    ),
  )
  const processingReady = isRegistrationNotificationProcessingReady(
    effectiveProcessingReadiness,
  )
  const trackLabels = Object.fromEntries(eligibleTracks.map((track) => [track.id, track.subject]))
  const appointmentParticipantSubjects = getRegistrationAppointmentParticipantSubjects(
    appointmentDraft,
    trackLabels,
  )
  const appointmentParticipantSubjectLabel = appointmentParticipantSubjects.join("·")
    || eligibleTracks.map((track) => track.subject).join("·")
    || "과목"
  const appointmentSummarySubjects = Array.from(new Set(currentActivities.flatMap((activity) => {
    const subject = trackById.get(activity.trackId)?.subject
    return subject ? [subject] : []
  })))
  const appointmentSummarySubjectLabel = appointmentSummarySubjects.join("·") || "과목"
  const normalizedDraft = JSON.stringify({
    appointmentId: baseAppointmentId,
    expectedNotificationRevision,
    kind,
    ...appointmentDraft,
  })
  const canSave = Boolean(
    scheduledAt
    && place.trim()
    && appointmentDraft.trackIds.length > 0
    && !saving
    && !mutationLocked
    && !conflict,
  )

  function persistConflictDraft(local = appointmentDraft) {
    persistedAppointmentConflictDrafts.set(conflictScopeKey, {
      local: { ...local, trackIds: [...local.trackIds] },
      appointmentId: baseAppointmentId,
      expectedNotificationRevision,
    })
  }

  async function handleRevisionConflict() {
    setPreserveLocalDraft(true)
    persistConflictDraft()
    if (appointment) {
      setConflict({
        local: { ...appointmentDraft, trackIds: [...appointmentDraft.trackIds] },
        server: { ...appointment },
        serverTrackIds: [...(previousAppointmentDraft?.trackIds || [])],
      })
      setShowConflictComparison(true)
    }
    try {
      await onReload?.()
    } catch {
      // 로컬 초안과 기존 요청 키를 보존한 채 다시 비교할 수 있다.
    }
    onWarning("다른 사용자가 예약을 변경했습니다. 최신 내용을 확인하세요. 내 초안은 그대로 보존했습니다.")
  }

  async function compareLatestAppointment() {
    persistConflictDraft()
    setShowConflictComparison(true)
    try {
      await onReload?.()
      if (appointment) {
        setConflict({
          local: { ...appointmentDraft, trackIds: [...appointmentDraft.trackIds] },
          server: { ...appointment },
          serverTrackIds: [...(previousAppointmentDraft?.trackIds || [])],
        })
      }
    } catch {
      onWarning("최신 예약을 불러오지 못했습니다. 로컬 초안은 그대로 유지됩니다.")
    }
  }

  function applyConflictDraftAgain() {
    if (!conflict || !canApplyConflictDraft) return
    const rebased = rebaseRegistrationAppointmentDraft({
      ...conflict,
      local: appointmentDraft,
    })
    submissionKeys.clear("registration-appointment", normalizedDraft)
    setBaseAppointmentId(rebased.appointmentId)
    setExpectedNotificationRevision(rebased.expectedNotificationRevision)
    setScheduledAt(toLocalDateTime(rebased.draft.scheduledAt))
    setPlace(rebased.draft.place)
    setSelectedTrackIds([...rebased.draft.trackIds])
    setDraftReplaceRemaining(rebased.draft.replaceRemaining)
    setConflict(null)
    setShowConflictComparison(false)
    persistedAppointmentConflictDrafts.delete(conflictScopeKey)
    onWarning("최신 예약 기준에 내 초안을 다시 적용했습니다. 변경 내용을 확인한 뒤 저장하세요.")
  }

  function continueEditingConflictDraft() {
    persistConflictDraft()
    setShowConflictComparison(false)
  }

  async function reminderRoundCount(draft: RegistrationAppointmentDraft | null) {
    if (!draft || !draft.scheduledAt || draft.trackIds.length === 0) return 0
    try {
      return (await previewRegistrationAppointmentReminders({
        kind,
        scheduledAt: draft.scheduledAt,
        trackIds: draft.trackIds,
      })).length
    } catch {
      return null
    }
  }

  async function confirmAppointmentMutation(
    action: "save" | "cancel",
    next: RegistrationAppointmentDraft | null,
  ) {
    const [previousReminderRoundCount, nextReminderRoundCount] = await Promise.all([
      reminderRoundCount(previousAppointmentDraft),
      reminderRoundCount(next),
    ])
    return window.confirm(buildRegistrationAppointmentConfirmation({
      action,
      previous: previousAppointmentDraft,
      next,
      previousReminderRoundCount,
      nextReminderRoundCount,
      trackLabels,
    }))
  }

  async function dispatchNotificationTargets(
    notificationTargets: RegistrationAppointmentMutationResponse["notificationTargets"],
  ) {
    const failedTargets: RegistrationAppointmentMutationResponse["notificationTargets"] = []
    const warnings: string[] = []
    const failedMessages: string[] = []
    for (const target of notificationTargets) {
      try {
        const payload = await sendRegistrationVisitNotificationTarget(target, notificationToken)
        const warning = String(payload?.warning || "").trim()
        if (warning) warnings.push(warning)
      } catch (error) {
        failedTargets.push(target)
        failedMessages.push(errorMessage(error, "방문상담 알림을 보내지 못했습니다."))
      }
    }
    return { failedTargets, warnings, failedMessages }
  }

  async function handoffCommittedAppointment(
    saved: RegistrationAppointmentMutationResponse,
    notificationProcessingCompleted = false,
  ) {
    try {
      await onSaved(saved)
      onDirtyChange?.(false)
      persistedAppointmentConflictDrafts.delete(conflictScopeKey)
      notificationRetryRequestIds.current.clear()
      setCommittedAppointment(null)
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning(notificationProcessingCompleted
        ? "예약 저장과 알림 재계산은 완료되었습니다. 최신 내용 다시 불러오기를 눌러 화면을 갱신하세요."
        : "예약 저장은 완료되었습니다. 알림 재계산 상태는 확정되지 않았으니 최신 내용 다시 불러오기를 눌러 확인하세요.")
    }
  }

  function processingRuntimeIsStillReady() {
    return isRegistrationNotificationProcessingReady(
      effectiveProcessingReadiness,
      Date.now(),
    )
  }

  async function pollRegistrationNotificationJobs(saved: RegistrationAppointmentMutationResponse) {
    const generation = notificationPollGeneration.current + 1
    notificationPollGeneration.current = generation
    for (let attempt = 0; attempt < NOTIFICATION_JOB_POLL_ATTEMPTS; attempt += 1) {
      if (!processingRuntimeIsStillReady()) {
        if (notificationPollGeneration.current !== generation) return
        setNotificationProcessingPhase("idle")
        setNotificationJobStatuses([])
        await handoffCommittedAppointment(saved)
        return
      }
      try {
        const statuses = await Promise.all(saved.notificationJobs.map((job) => (
          getRegistrationNotificationJobStatus(job)
        )))
        if (notificationPollGeneration.current !== generation) return
        setNotificationJobStatuses(statuses)
        if (statuses.some((status) => status.status === "failed")) {
          setNotificationProcessingPhase("failed")
          return
        }
        if (statuses.length > 0 && statuses.every((status) => status.status === "succeeded")) {
          setNotificationProcessingPhase("succeeded")
          await delay(NOTIFICATION_JOB_POLL_INTERVAL_MS)
          if (notificationPollGeneration.current === generation) {
            await handoffCommittedAppointment(saved, true)
          }
          return
        }
      } catch {
        if (notificationPollGeneration.current !== generation) return
      }
      await delay(NOTIFICATION_JOB_POLL_INTERVAL_MS)
    }
    if (notificationPollGeneration.current === generation) {
      onWarning("예약 저장은 완료되었습니다. 알림 재계산 상태 확인이 지연되고 있습니다.")
    }
  }

  function beginRegistrationNotificationProcessing(saved: RegistrationAppointmentMutationResponse) {
    if (!processingRuntimeIsStillReady() || saved.notificationJobs.length === 0) return false
    setNotificationJobStatuses([])
    setNotificationProcessingPhase("processing")
    void pollRegistrationNotificationJobs(saved)
    return true
  }

  async function finishAppointmentSave(saved: RegistrationAppointmentMutationResponse) {
    setCommittedAppointment(saved)
    const { failedTargets, warnings, failedMessages } = await dispatchNotificationTargets(saved.notificationTargets)
    if (warnings.length > 0) onWarning(warnings.join(" "))
    if (failedTargets.length > 0) {
      setPendingNotificationTargets(failedTargets)
      onWarning(`예약은 저장되었습니다. ${failedMessages[0] || "방문상담 알림 전송에 실패했습니다."} 알림 재시도를 눌러 주세요.`)
      return
    }
    setPendingNotificationTargets([])
    if (beginRegistrationNotificationProcessing(saved)) return
    await handoffCommittedAppointment(saved)
  }

  async function retryCommittedNotifications() {
    if (!committedAppointment || pendingNotificationTargets.length === 0 || saving) return
    setSaving(true)
    try {
      const { failedTargets, warnings, failedMessages } = await dispatchNotificationTargets(pendingNotificationTargets)
      if (warnings.length > 0) onWarning(warnings.join(" "))
      if (failedTargets.length > 0) {
        setPendingNotificationTargets(failedTargets)
        onWarning(`${failedMessages[0] || "일부 방문상담 알림을 보내지 못했습니다."} 같은 저장본으로 다시 시도할 수 있습니다.`)
        return
      }
      setPendingNotificationTargets([])
      if (beginRegistrationNotificationProcessing(committedAppointment)) return
      await handoffCommittedAppointment(committedAppointment)
    } finally {
      setSaving(false)
    }
  }

  async function retryRegistrationNotificationJobStatus() {
    if (!committedAppointment || saving) return
    if (!processingRuntimeIsStillReady()) {
      setNotificationProcessingPhase("idle")
      setNotificationJobStatuses([])
      return
    }
    const failedJob = notificationJobStatuses.find((status) => status.status === "failed")
    if (!failedJob) {
      setNotificationProcessingPhase("processing")
      void pollRegistrationNotificationJobs(committedAppointment)
      return
    }
    const retryKey = `${failedJob.jobKind}:${failedJob.jobId}`
    const requestId = notificationRetryRequestIds.current.get(retryKey) || crypto.randomUUID()
    notificationRetryRequestIds.current.set(retryKey, requestId)
    setSaving(true)
    try {
      const retried = await retryRegistrationNotificationJob({
        jobKind: failedJob.jobKind,
        jobId: failedJob.jobId,
        expectedAttemptCount: failedJob.attemptCount,
        requestId,
      })
      notificationRetryRequestIds.current.delete(retryKey)
      setNotificationJobStatuses((current) => current.map((status) => (
        status.jobKind === retried.jobKind && status.jobId === retried.jobId ? retried : status
      )))
      setNotificationProcessingPhase("processing")
      void pollRegistrationNotificationJobs(committedAppointment)
    } catch {
      setNotificationProcessingPhase("failed")
      onWarning("같은 알림 재계산 작업을 다시 시작하지 못했습니다. 최신 상태를 확인하세요.")
    } finally {
      setSaving(false)
    }
  }

  async function reloadAfterCommittedMutation(trackId: string) {
    setTrackRefreshPendingIds((current) => new Set(current).add(trackId))
    try {
      await onReload?.()
      setTrackRefreshPendingIds((current) => {
        const next = new Set(current)
        next.delete(trackId)
        return next
      })
    } catch {
      onWarning("저장은 완료됐지만 최신 내용을 불러오지 못했습니다")
    }
  }

  async function retryTrackRefresh(trackId: string) {
    if (activitySavingId || trackRefreshRetryingId) return
    setTrackRefreshRetryingId(trackId)
    try {
      await onReload?.()
      setTrackRefreshPendingIds((current) => {
        const next = new Set(current)
        next.delete(trackId)
        return next
      })
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setTrackRefreshRetryingId("")
    }
  }

  async function retryRefresh() {
    if (saving) return
    setSaving(true)
    try {
      if (committedAppointment && pendingNotificationTargets.length === 0) {
        await handoffCommittedAppointment(committedAppointment)
      } else {
        await onReload?.()
        setRefreshPending(false)
      }
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  async function saveAppointment() {
    if (!canSave) {
      const message = "예약 일시, 장소, 적용 과목을 모두 입력하세요."
      setValidationError(message)
      onWarning(message)
      const selector = !scheduledAt
        ? "[data-appointment-field=scheduled-at] input, [data-appointment-field=scheduled-at] button"
        : !place.trim()
          ? "[data-appointment-field=place] input"
          : "[data-appointment-field=tracks] button"
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(selector)?.focus())
      return
    }
    setSaving(true)
    if (!(await confirmAppointmentMutation("save", appointmentDraft))) {
      setSaving(false)
      return
    }
    const kindKey = "registration-appointment"
    const requestKey = submissionKeys.getOrCreate(kindKey, normalizedDraft)
    let saved: RegistrationAppointmentMutationResponse
    try {
      saved = await saveRegistrationSharedAppointment({
        appointmentId: baseAppointmentId,
        expectedNotificationRevision,
        taskId,
        kind,
        scheduledAt: toScheduledAt(scheduledAt),
        place: place.trim(),
        trackIds: appointmentDraft.trackIds,
        replaceRemaining: editMode === "replace_remaining",
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "예약을 저장하지 못했습니다.")
      if (message.includes("registration_appointment_revision_conflict")) {
        await handleRevisionConflict()
        setSaving(false)
        return
      }
      onWarning(message)
      setSaving(false)
      return
    }
    submissionKeys.clear(kindKey, normalizedDraft)
    onDirtyChange?.(false)
    persistedAppointmentConflictDrafts.delete(conflictScopeKey)
    setConflict(null)
    setShowConflictComparison(false)
    await finishAppointmentSave(saved)
    setSaving(false)
  }

  async function cancelAppointment() {
    if (!appointment || saving || mutationLocked) return
    setSaving(true)
    if (!(await confirmAppointmentMutation("cancel", null))) {
      setSaving(false)
      return
    }
    const logicalDraft = `${appointment.id}:${expectedNotificationRevision ?? appointment.notificationRevision}:cancel`
    const kindKey = "registration-appointment-cancel"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    let saved: RegistrationAppointmentMutationResponse
    try {
      saved = await cancelRegistrationAppointment({
        appointmentId: appointment.id,
        expectedNotificationRevision: expectedNotificationRevision ?? appointment.notificationRevision,
        reason: "",
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "예약을 취소하지 못했습니다.")
      if (message.includes("registration_appointment_revision_conflict")) {
        await handleRevisionConflict()
        setSaving(false)
        return
      }
      onWarning(message)
      setSaving(false)
      return
    }
    submissionKeys.clear(kindKey, logicalDraft)
    persistedAppointmentConflictDrafts.delete(conflictScopeKey)
    setConflict(null)
    setShowConflictComparison(false)
    await finishAppointmentSave(saved)
    setSaving(false)
  }

  async function startAttempt(activity: OpsRegistrationLevelTest) {
    if (trackRefreshPendingIds.has(activity.trackId)) return
    const kindKey = "level-test-start"
    const requestKey = submissionKeys.getOrCreate(kindKey, activity.id)
    setActivitySavingId(activity.id)
    try {
      await startRegistrationLevelTestAttempt({ attemptId: activity.id, requestKey })
    } catch (error) {
      onWarning(errorMessage(error, "레벨테스트를 시작하지 못했습니다."))
      setActivitySavingId("")
      return
    }
    submissionKeys.clear(kindKey, activity.id)
    await reloadAfterCommittedMutation(activity.trackId)
    setActivitySavingId("")
  }

  async function completeAttempt(
    activity: OpsRegistrationLevelTest,
    status: "completed" | "absent" | "canceled",
  ) {
    if (trackRefreshPendingIds.has(activity.trackId)) return
    const materialLink = (draftLinks[activity.id] || activity.materialLink || "").trim()
    const track = trackById.get(activity.trackId)
    if (status === "completed" && !materialLink) {
      onWarning("완료하려면 시험지·결과지 URL을 입력하세요.")
      return
    }
    if (status === "completed" && !track?.directorProfileId) {
      onWarning(`[${track?.subject || "해당 과목"}] 상담 책임자를 먼저 지정하세요.`)
      return
    }
    const logicalDraft = `${activity.id}:${status}:${materialLink}`
    const kindKey = "level-test-complete"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    setActivitySavingId(activity.id)
    try {
      await completeRegistrationLevelTestAttempt({
        attemptId: activity.id,
        status,
        materialLink: status === "completed" ? materialLink : "",
        requestKey,
      })
    } catch (error) {
      onWarning(errorMessage(error, "레벨테스트 결과를 저장하지 못했습니다."))
      setActivitySavingId("")
      return
    }
    submissionKeys.clear(kindKey, logicalDraft)
    setDraftLinks((current) => {
      const next = { ...current }
      delete next[activity.id]
      return next
    })
    await reloadAfterCommittedMutation(activity.trackId)
    setActivitySavingId("")
  }

  async function closeInquiry(activity: OpsRegistrationLevelTest) {
    if (trackRefreshPendingIds.has(activity.trackId)) return
    const reason = (closureReasons[activity.trackId] || "").trim()
    if (!reason) {
      onWarning("문의 종료 사유를 입력하세요.")
      return
    }
    const logicalDraft = `${activity.trackId}:${reason}`
    const kindKey = "level-test-close-inquiry"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    setActivitySavingId(activity.id)
    try {
      await closeRegistrationLevelTestTrack({ trackId: activity.trackId, reason, requestKey })
    } catch (error) {
      onWarning(errorMessage(error, "문의를 종료하지 못했습니다."))
      setActivitySavingId("")
      return
    }
    submissionKeys.clear(kindKey, logicalDraft)
    setClosureReasons((current) => {
      const next = { ...current }
      delete next[activity.trackId]
      return next
    })
    await reloadAfterCommittedMutation(activity.trackId)
    setActivitySavingId("")
  }

  function toggleTrack(trackId: string) {
    if (editMode === "replace_remaining" || mutationLocked) return
    setSelectedTrackIds((current) => (
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId]
    ))
  }

  return (
    <section
      ref={sectionRef}
      className={embedded
        ? "grid min-w-0 gap-4"
        : "grid min-w-0 gap-4 rounded-md border bg-background p-3"}
      aria-label={kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}</h3>
          <p className="text-xs text-muted-foreground">같은 일정은 한 번만 정하고, 과목별 진행 결과는 각각 기록합니다.</p>
        </div>
        {onClose ? <Button type="button" size="sm" variant="ghost" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 편집 닫기`} onClick={onClose} disabled={saving || mutationLocked}>닫기</Button> : null}
      </div>

      {conflict ? (
        <div role="alert" className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950">
          <p>다른 사용자가 예약을 먼저 변경했습니다. 내 입력은 그대로 보존되어 있습니다.</p>
          {showConflictComparison && conflictComparison ? (
            <dl className="grid gap-2 rounded-md border border-amber-200 bg-white/70 p-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="font-semibold">예약 일시</dt>
                <dd>최신 · {toLocalDateTime(conflictComparison.fields.scheduledAt.server) || "없음"}</dd>
                <dd>내 초안 · {toLocalDateTime(conflictComparison.fields.scheduledAt.local) || "없음"}</dd>
              </div>
              <div>
                <dt className="font-semibold">장소</dt>
                <dd>최신 · {conflictComparison.fields.place.server || "없음"}</dd>
                <dd>내 초안 · {conflictComparison.fields.place.local || "없음"}</dd>
              </div>
              <div>
                <dt className="font-semibold">적용 과목</dt>
                <dd>최신 · {conflictComparison.fields.trackIds.server.map((trackId) => trackLabels[trackId] || trackId).join(", ") || "없음"}</dd>
                <dd>내 초안 · {conflictComparison.fields.trackIds.local.map((trackId) => trackLabels[trackId] || trackId).join(", ") || "없음"}</dd>
              </div>
            </dl>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 최신 예약 비교`} onClick={() => void compareLatestAppointment()} disabled={saving}>최신 예약 비교</Button>
            <Button type="button" size="sm" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 다시 적용`} onClick={applyConflictDraftAgain} disabled={saving || !canApplyConflictDraft}>다시 적용</Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 계속 편집`} onClick={continueEditingConflictDraft} disabled={saving}>계속 편집</Button>
          </div>
        </div>
      ) : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}

      {processingReady && committedAppointment && notificationProcessingPhase !== "idle" ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          <span>
            {notificationProcessingPhase === "succeeded"
              ? "예약 저장됨 · 알림 재계산 완료"
              : notificationProcessingPhase === "failed"
                ? "알림 재계산 실패 · 다시 시도"
                : "예약 저장됨 · 알림 재계산 중"}
          </span>
          {notificationProcessingPhase !== "succeeded" ? (
            <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 알림 재계산 다시 시도`} onClick={() => void retryRegistrationNotificationJobStatus()} disabled={saving}>
              {notificationProcessingPhase === "failed" ? "다시 시도" : "상태 다시 확인"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pendingNotificationTargets.length > 0 ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span>예약은 저장되었습니다. 실패한 방문상담 알림만 다시 보냅니다.</span>
          <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 알림 재시도`} onClick={() => void retryCommittedNotifications()} disabled={saving}>알림 재시도</Button>
        </div>
      ) : refreshPending || (committedAppointment && !processingReady) ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span>{refreshPending
            ? "저장은 완료됐지만 최신 내용을 불러오지 못했습니다"
            : "예약 저장은 완료됐지만 알림 재계산 상태는 아직 확인되지 않았습니다."}</span>
          <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 최신 내용 다시 불러오기`} onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
        </div>
      ) : null}

      {editMode !== "read_only" ? (
        <div
          data-registration-action-owner={`${appointmentParticipantSubjectLabel}:appointment-save`}
          data-registration-appointment-shared-controls
          data-registration-appointment-subjects={appointmentParticipantSubjects.join("|")}
          className="grid gap-3"
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)]">
            <Label data-appointment-field="scheduled-at" className="grid min-w-0 gap-1.5">
              <span>예약 일시 <span className="text-xs font-semibold text-primary">필수</span></span>
              <DateTimePickerControl
                value={scheduledAt}
                onChange={(value) => { setValidationError(""); setScheduledAt(value) }}
                dateAriaLabel={`${appointmentParticipantSubjectLabel} 예약 날짜`}
                timeAriaLabel={`${appointmentParticipantSubjectLabel} 예약 시각`}
                clearAriaLabel={`${appointmentParticipantSubjectLabel} 예약 날짜와 시각 지우기`}
                required
                disabled={saving || mutationLocked}
                disablePortal
                timeOptions={REGISTRATION_TIME_OPTIONS}
              />
            </Label>
            <Label data-appointment-field="place" className="grid min-w-0 gap-1.5">
              <span>장소 <span className="text-xs font-semibold text-primary">필수</span></span>
              <Input aria-label={`${appointmentParticipantSubjectLabel} 예약 장소`} value={place} onChange={(event) => { setValidationError(""); setPlace(event.target.value) }} placeholder="본관, 상담실 등" disabled={saving || mutationLocked} />
            </Label>
          </div>

          <fieldset data-appointment-field="tracks" className="grid gap-2">
            <legend className="text-sm font-medium">적용 과목 <span className="text-xs font-semibold text-primary">필수</span></legend>
            <div className="flex flex-wrap gap-2">
              {selectableTracks.map((track) => {
                const selected = appointmentDraft.trackIds.includes(track.id)
                return (
                  <Button
                    key={track.id}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    aria-pressed={selected}
                    aria-label={`${appointmentParticipantSubjectLabel} 예약 적용: ${track.subject} ${selected ? "선택됨" : "선택 안 됨"}`}
                    disabled={saving || mutationLocked || editMode === "replace_remaining"}
                    onClick={() => toggleTrack(track.id)}
                  >
                    {track.subject}
                  </Button>
                )
              })}
            </div>
            {selectableTracks.length === 0 ? <p className="text-xs text-muted-foreground">현재 함께 예약할 수 있는 과목이 없습니다.</p> : null}
            {editMode === "replace_remaining" ? (
              <p className="text-xs text-muted-foreground">이미 결과가 확정된 과목은 유지하고, 남은 예약 과목만 새 일정으로 옮깁니다.</p>
            ) : null}
          </fieldset>

          <div className="flex justify-end">
            <Button type="button" data-registration-primary-action={`${appointmentParticipantSubjectLabel}:appointment-save`} aria-label={`${appointmentParticipantSubjectLabel} 예약 저장`} onClick={() => void saveAppointment()} disabled={saving || mutationLocked || Boolean(conflict)}>
              {appointment
                ? editMode === "replace_remaining" ? "남은 과목 일정 다시 잡기" : "예약 수정"
                : "예약 저장"}
            </Button>
          </div>
        </div>
      ) : (
        <div
          data-registration-appointment-readonly-summary=""
          aria-label={`${appointmentSummarySubjectLabel} 저장된 예약 정보`}
          className="grid gap-3 rounded-md border bg-muted/30 p-3"
        >
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">예약 일시</dt>
              <dd className="text-sm font-medium">{toLocalDateTime(appointment?.scheduledAt).replace("T", " ") || "기록 없음"}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">장소</dt>
              <dd className="text-sm font-medium">{appointment?.place || "기록 없음"}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">참여 과목</dt>
              <dd className="flex flex-wrap gap-1">
                {appointmentSummarySubjects.map((subject) => <Badge key={subject} variant="secondary">{subject}</Badge>)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">완료된 예약 정보는 읽기 전용입니다.</p>
        </div>
      )}

      {kind === "level_test" ? (
        <div className="grid gap-3 border-t pt-4">
          {activities.map((activity) => {
            if (!("attemptNumber" in activity) || !displayActivityIds.has(activity.id)) return null
            const track = trackById.get(activity.trackId)
            const materialLink = draftLinks[activity.id] ?? activity.materialLink ?? ""
            const terminal = ["completed", "absent", "canceled"].includes(activity.status)
            const trackRefreshPending = trackRefreshPendingIds.has(activity.trackId)
            const canClose = ["absent", "canceled"].includes(activity.status)
              && latestLevelTestActivityIds.has(activity.id)
              && !matchingActivities.some((item) => item.trackId === activity.trackId && ["scheduled", "in_progress"].includes(item.status))
            return (
              <section key={activity.id} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{track?.subject || "과목"}</Badge>
                  <RegistrationActivityStatusBadge status={activity.status} />
                </div>
                {trackRefreshPending ? (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    <span>저장은 완료됐지만 최신 내용을 불러오지 못했습니다</span>
                    <Button type="button" size="sm" variant="outline" aria-label={`${track?.subject || "과목"} 최신 내용 다시 불러오기`} onClick={() => void retryTrackRefresh(activity.trackId)} disabled={Boolean(trackRefreshRetryingId)}>최신 내용 다시 불러오기</Button>
                  </div>
                ) : null}
                <Label className="grid gap-1.5">
                  시험지·결과지 URL
                  <Input
                    type="url"
                    aria-label={`${track?.subject || "과목"} 시험지·결과지 URL`}
                    value={materialLink}
                    onChange={(event) => setDraftLinks((current) => ({ ...current, [activity.id]: event.target.value }))}
                    placeholder="https://drive.google.com/..."
                    disabled={terminal || trackRefreshPending || activitySavingId === activity.id}
                  />
                </Label>
                {activity.status === "scheduled" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" aria-label={`${track?.subject || "과목"} 미응시`} size="sm" variant="outline" onClick={() => void completeAttempt(activity, "absent")} disabled={trackRefreshPending || Boolean(activitySavingId)}>미응시</Button>
                    <Button type="button" aria-label={`${track?.subject || "과목"} 과목 취소`} size="sm" variant="ghost" onClick={() => void completeAttempt(activity, "canceled")} disabled={trackRefreshPending || Boolean(activitySavingId)}>과목 취소</Button>
                    <Button type="button" aria-label={`${track?.subject || "과목"} 시험 시작`} size="sm" onClick={() => void startAttempt(activity)} disabled={trackRefreshPending || Boolean(activitySavingId)}>시험 시작</Button>
                  </div>
                ) : activity.status === "in_progress" ? (
                  <div className="grid gap-2">
                    {!track?.directorProfileId ? <p className="text-xs text-amber-700">완료 전에 상담 책임자를 지정하세요.</p> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" aria-label={`${track?.subject || "과목"} 미응시`} size="sm" variant="outline" onClick={() => void completeAttempt(activity, "absent")} disabled={trackRefreshPending || Boolean(activitySavingId)}>미응시</Button>
                      <Button type="button" aria-label={`${track?.subject || "과목"} 과목 취소`} size="sm" variant="ghost" onClick={() => void completeAttempt(activity, "canceled")} disabled={trackRefreshPending || Boolean(activitySavingId)}>과목 취소</Button>
                      <Button type="button" aria-label={`${track?.subject || "과목"} 결과 완료`} size="sm" onClick={() => void completeAttempt(activity, "completed")} disabled={trackRefreshPending || Boolean(activitySavingId) || !materialLink.trim() || !track?.directorProfileId}>결과 완료</Button>
                    </div>
                  </div>
                ) : null}
                {canClose ? (
                  <div className="grid gap-2 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <Input
                      value={closureReasons[activity.trackId] || ""}
                      aria-label={`${track?.subject || "과목"} 문의 종료 사유`}
                      onChange={(event) => setClosureReasons((current) => ({ ...current, [activity.trackId]: event.target.value }))}
                      placeholder="문의 종료 사유"
                      disabled={trackRefreshPending || Boolean(activitySavingId)}
                    />
                    <Button type="button" aria-label={`${track?.subject || "과목"} 다시 예약`} size="sm" variant="outline" onClick={() => onRebook?.(activity.trackId)} disabled={trackRefreshPending || Boolean(activitySavingId)}>다시 예약</Button>
                    <Button type="button" aria-label={`${track?.subject || "과목"} 문의 종료`} size="sm" variant="ghost" onClick={() => void closeInquiry(activity)} disabled={trackRefreshPending || Boolean(activitySavingId) || !(closureReasons[activity.trackId] || "").trim()}>문의 종료</Button>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}

      {appointment?.status === "scheduled" && currentActivities.some((activity) => activity.status === "scheduled") ? (
        <div className="flex justify-end border-t pt-4">
          <Button type="button" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 취소`} variant="ghost" onClick={() => void cancelAppointment()} disabled={saving || mutationLocked}>
            예약 취소
          </Button>
        </div>
      ) : null}
    </section>
  )
}
