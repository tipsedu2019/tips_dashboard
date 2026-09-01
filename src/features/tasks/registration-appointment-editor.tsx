"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DateTimePickerControl } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  canCancelRegistrationSharedAppointment,
  getEligibleSharedAppointmentTracks,
  getLatestRegistrationLevelTestActivityIds,
  getRegistrationAppointmentEditMode,
  getRegistrationAppointmentPayloadTrackIds,
} from "./registration-track-model.js"
import {
  REGISTRATION_LEVEL_TEST_PLACES,
  normalizeRegistrationLevelTestPlace,
} from "./registration-level-test-place.ts"
import { getRegistrationPersistenceErrorMessage, REGISTRATION_TIME_OPTIONS } from "./registration-workflow.js"
import { RegistrationSaveButton } from "./registration-save-button"
import type { RegistrationCustomerMessageTarget } from "./registration-customer-message-contract"
import {
  getRegistrationAppointmentNotificationReadiness,
  sendRegistrationVisitNotificationTarget,
} from "./registration-consultation-notification.js"
import {
  compareRegistrationAppointmentDraft,
  getRegistrationAppointmentParticipantSubjects,
  getRegistrationResultLinkHref,
  rebaseRegistrationAppointmentDraft,
  type RegistrationAppointmentConflict,
  type RegistrationAppointmentDraft,
} from "./registration-appointment-draft"
import {
  createRegistrationMutationRequestKey,
  cancelRegistrationAppointment,
  saveRegistrationSharedAppointment,
  saveRegistrationLevelTestResult,
  type OpsRegistrationAppointment,
  type OpsRegistrationConsultation,
  type OpsRegistrationLevelTest,
  type OpsRegistrationTrackSummary,
  type RegistrationAppointmentMutationResponse,
} from "./registration-track-service"

type RegistrationAppointmentActivity = OpsRegistrationLevelTest | OpsRegistrationConsultation

export type RegistrationAppointmentEditorProps = {
  kind: OpsRegistrationAppointment["kind"]
  taskId: string
  studentName?: string
  eligibleTracks: OpsRegistrationTrackSummary[]
  initialTrackId?: string
  appointment: OpsRegistrationAppointment | null
  activities: RegistrationAppointmentActivity[]
  readOnly?: boolean
  onSaved: (saved: RegistrationAppointmentMutationResponse) => void | Promise<void>
  onWarning: (message: string) => void
  onReload?: () => void | Promise<void>
  embedded?: boolean
  subjectScoped?: boolean
  visibleTrackId?: string
  notificationToken?: string
  onDirtyChange?: (dirty: boolean) => void
  onTrackDirtyChange?: (trackId: string, dirty: boolean) => void
  onBeforeSave?: () => boolean | Promise<boolean>
  externalDirty?: boolean
  actionLabel?: string
  saveAriaLabel?: string
  canOpenCustomerMessage?: boolean
  onOpenCustomerMessage?: (target: RegistrationCustomerMessageTarget) => void
  canSendManagementNotification?: boolean
}

type SubmissionKeys = {
  getOrCreate: (kind: string, logicalDraft: string) => string
  clear: (kind: string, logicalDraft: string) => void
}

type PersistedConflictDraft = {
  local: RegistrationAppointmentDraft
  appointmentId: string | null
  expectedNotificationRevision: number | null
}

const persistedAppointmentSubmissionKeys = new Map<string, string>()
const persistedAppointmentConflictDrafts = new Map<string, PersistedConflictDraft>()

function errorMessage(error: unknown, fallback: string) {
  const rawMessage = error instanceof Error && error.message
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : ""
  return getRegistrationPersistenceErrorMessage({ message: rawMessage }, rawMessage || fallback)
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

function registrationCustomerReminderHistoryLabel(
  reminder: OpsRegistrationAppointment["customerReminder"] | undefined,
) {
  if (!reminder) return null
  switch (reminder.state) {
    case "sent": return "과거 고객 리마인드 발송 이력 · 발송 완료"
    case "unknown": return "과거 고객 리마인드 발송 이력 · 전달 여부 확인 필요"
    case "processing": return "과거 고객 리마인드 처리 이력 · 상태 확인 필요"
    case "failed_hold": return "과거 고객 리마인드 발송 이력 · 발송 실패"
    default: return null
  }
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
  studentName = "",
  eligibleTracks,
  initialTrackId = "",
  appointment,
  activities,
  readOnly = false,
  onSaved,
  onWarning,
  onReload,
  embedded = false,
  subjectScoped = false,
  visibleTrackId = "",
  notificationToken = "",
  onDirtyChange,
  onTrackDirtyChange,
  onBeforeSave,
  externalDirty = false,
  actionLabel = "예약 저장",
  saveAriaLabel = "",
  canOpenCustomerMessage = false,
  onOpenCustomerMessage,
  canSendManagementNotification = false,
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
  const canCancelAppointment = !readOnly && canCancelRegistrationSharedAppointment(
    kind,
    appointment,
    eligibleTracks,
    currentActivities,
  )
  const editMode = getRegistrationAppointmentEditMode(currentActivities)
  const selectableTracks = getEligibleSharedAppointmentTracks(
    kind,
    eligibleTracks,
    matchingActivities,
    appointment?.id || null,
  )
  const initialSelectedTrackIds = appointment
    ? currentActivities.map((activity) => activity.trackId)
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
  const [saving, setSaving] = useState(false)
  const [activitySavingId, setActivitySavingId] = useState("")
  const [refreshPending, setRefreshPending] = useState(false)
  const [trackRefreshPendingIds, setTrackRefreshPendingIds] = useState<Set<string>>(() => new Set())
  const [trackRefreshRetryingId, setTrackRefreshRetryingId] = useState("")
  const [validationError, setValidationError] = useState("")
  const [pendingConfirmation, setPendingConfirmation] = useState(false)
  const [pendingCancellation, setPendingCancellation] = useState(false)
  const confirmationPending = Boolean(pendingConfirmation || pendingCancellation)
  const sectionRef = useRef<HTMLElement | null>(null)
  const confirmationRef = useRef<HTMLDivElement | null>(null)
  const [committedAppointment, setCommittedAppointment] = useState<RegistrationAppointmentMutationResponse | null>(null)
  const [visitManagementNotificationSending, setVisitManagementNotificationSending] = useState(false)
  const [visitManagementNotificationSent, setVisitManagementNotificationSent] = useState(false)
  const latestConflictServerKey = useRef("")

  useEffect(() => {
    if (!pendingConfirmation && !pendingCancellation) return
    window.requestAnimationFrame(() => confirmationRef.current?.focus())
  }, [pendingCancellation, pendingConfirmation])

  useEffect(() => {
    if (!canCancelAppointment) setPendingCancellation(false)
  }, [canCancelAppointment])

  useEffect(() => {
    if (!readOnly) return
    setPendingConfirmation(false)
    setPendingCancellation(false)
  }, [readOnly])

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
  const appointmentNotificationParticipants = currentActivities.flatMap((activity) => {
    const track = trackById.get(activity.trackId)
    return track ? [{
      trackId: track.id,
      subject: track.subject,
      directorProfileId: track.directorProfileId,
      directorName: track.directorName,
    }] : []
  })
  const appointmentNotificationReadiness = getRegistrationAppointmentNotificationReadiness({
    studentName,
    scheduledAt: appointment?.scheduledAt,
    place: appointment?.place,
    participants: appointmentNotificationParticipants,
  })
  const visitManagementNotificationIdentity = JSON.stringify({
    appointmentId: appointment?.id || "",
    notificationRevision: appointment?.notificationRevision || 0,
    studentName: studentName.trim(),
    scheduledAt: appointment?.scheduledAt || "",
    place: appointment?.place || "",
    participants: [...appointmentNotificationParticipants].sort((left, right) => left.trackId.localeCompare(right.trackId)),
  })
  const customerReminderHistoryLabel = registrationCustomerReminderHistoryLabel(appointment?.customerReminder)
  const notificationActionBlocked = appointmentDirty
    || externalDirty
    || saving
    || confirmationPending
    || refreshPending
    || Boolean(conflict)
  const customerMessageBlocked = readOnly
    || notificationActionBlocked
    || !appointmentNotificationReadiness.ready
    || appointment?.status !== "scheduled"
  const visitManagementNotificationBlocked = readOnly
    || !canSendManagementNotification
    || kind !== "visit_consultation"
    || !appointment
    || !notificationToken
    || notificationActionBlocked
    || !appointmentNotificationReadiness.ready
    || visitManagementNotificationSending
    || visitManagementNotificationSent
  useEffect(() => {
    setVisitManagementNotificationSent(false)
  }, [visitManagementNotificationIdentity])
  useOwnedDirtyState(!readOnly && !mutationLocked && appointmentDirty, onDirtyChange)
  const reportedTrackDirtyRef = useRef(new Set<string>())
  const onTrackDirtyChangeRef = useRef(onTrackDirtyChange)
  useEffect(() => {
    onTrackDirtyChangeRef.current = onTrackDirtyChange
  }, [onTrackDirtyChange])
  useEffect(() => {
    const dirtyTrackIds = new Set<string>()
    if (!readOnly) {
      for (const activity of matchingActivities) {
        if (!trackById.has(activity.trackId)) continue
        const linkDirty = "materialLink" in activity
          && (draftLinks[activity.id] ?? activity.materialLink ?? "") !== (activity.materialLink ?? "")
        if (linkDirty) dirtyTrackIds.add(activity.trackId)
      }
    }
    for (const trackId of new Set([...reportedTrackDirtyRef.current, ...dirtyTrackIds])) {
      const wasDirty = reportedTrackDirtyRef.current.has(trackId)
      const isDirty = dirtyTrackIds.has(trackId)
      if (wasDirty !== isDirty) onTrackDirtyChangeRef.current?.(trackId, isDirty)
    }
    reportedTrackDirtyRef.current = dirtyTrackIds
  }, [draftLinks, matchingActivities, readOnly, trackById, trackRefreshPendingIds])
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
  const trackLabels = Object.fromEntries(eligibleTracks.map((track) => [track.id, track.subject]))
  const appointmentParticipantSubjects = getRegistrationAppointmentParticipantSubjects(
    appointmentDraft,
    trackLabels,
  )
  const appointmentParticipantSubjectLabel = appointmentParticipantSubjects.join("·")
    || eligibleTracks.map((track) => track.subject).join("·")
    || "과목"
  const normalizedDraft = JSON.stringify({
    appointmentId: baseAppointmentId,
    expectedNotificationRevision,
    kind,
    ...appointmentDraft,
  })
  const selectedPlace = normalizeRegistrationLevelTestPlace(place) ?? ""
  const legacyLevelTestPlace = appointment?.place
    && !normalizeRegistrationLevelTestPlace(appointment.place)
      ? appointment.place
      : ""
  const canSave = Boolean(
    !readOnly
    && scheduledAt
    && selectedPlace
    && appointmentDraft.trackIds.length > 0
    && !saving
    && !confirmationPending
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
    if (readOnly || !conflict || !canApplyConflictDraft) return
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
    if (readOnly) return
    persistConflictDraft()
    setShowConflictComparison(false)
  }

  async function sendVisitManagementNotification() {
    if (visitManagementNotificationBlocked || !appointment) return
    setVisitManagementNotificationSending(true)
    try {
      const payload = await sendRegistrationVisitNotificationTarget({
        appointmentId: appointment.id,
        notificationRevision: appointment.notificationRevision,
      }, notificationToken)
      setVisitManagementNotificationSent(true)
      const warning = String(payload?.warning || "").trim()
      if (warning) onWarning(warning)
    } catch (error) {
      let reloadFailed = false
      try {
        await onReload?.()
      } catch {
        reloadFailed = true
      }
      const warning = errorMessage(error, "방문상담 관리 알림을 보내지 못했습니다. 저장된 예약에는 영향이 없습니다.")
      onWarning(reloadFailed ? `${warning} 최신 예약 정보도 다시 불러오지 못했습니다.` : warning)
    } finally {
      setVisitManagementNotificationSending(false)
    }
  }

  async function handoffCommittedAppointment(saved: RegistrationAppointmentMutationResponse) {
    try {
      await onSaved(saved)
      onDirtyChange?.(false)
      persistedAppointmentConflictDrafts.delete(conflictScopeKey)
      setCommittedAppointment(null)
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning("예약 저장은 완료되었습니다. 최신 내용 다시 불러오기를 눌러 화면을 갱신하세요.")
    }
  }

  async function finishAppointmentSave(saved: RegistrationAppointmentMutationResponse) {
    setCommittedAppointment(saved)
    await handoffCommittedAppointment(saved)
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
      if (committedAppointment) {
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
    if (readOnly || confirmationPending) return
    if (!canSave) {
      const message = "예약 일시와 장소를 모두 입력하세요."
      setValidationError(message)
      onWarning(message)
      const selector = !scheduledAt
        ? "[data-appointment-field=scheduled-at] input, [data-appointment-field=scheduled-at] button"
        : !selectedPlace
          ? "[data-appointment-field=place] button"
          : "[data-appointment-field=place] button"
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(selector)?.focus())
      return
    }
    if (externalDirty && !appointmentDirty && appointment) {
      setSaving(true)
      try {
        await onBeforeSave?.()
      } catch (error) {
        onWarning(errorMessage(error, "담당자 정보를 저장하지 못했습니다."))
      } finally {
        setSaving(false)
      }
      return
    }
    setPendingConfirmation(true)
  }

  async function performSaveAppointment() {
    if (readOnly) return
    let relatedFactsSaved = true
    if (onBeforeSave && externalDirty) {
      try {
        relatedFactsSaved = (await onBeforeSave()) !== false
      } catch {
        relatedFactsSaved = false
      }
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
        place: selectedPlace,
        trackIds: appointmentDraft.trackIds,
        replaceRemaining: editMode === "replace_remaining",
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "예약을 저장하지 못했습니다.")
      if (message.includes("registration_appointment_revision_conflict")) {
        await handleRevisionConflict()
        return
      }
      onWarning(relatedFactsSaved && externalDirty
        ? `담당자 정보는 저장되었지만 ${message}`
        : message)
      return
    }
    submissionKeys.clear(kindKey, normalizedDraft)
    onDirtyChange?.(false)
    persistedAppointmentConflictDrafts.delete(conflictScopeKey)
    setConflict(null)
    setShowConflictComparison(false)
    await finishAppointmentSave(saved)
    if (!relatedFactsSaved) {
      onWarning("예약은 저장되었습니다. 담당자 정보는 저장되지 않았습니다. 담당자를 입력한 뒤 관리 알림을 따로 보내세요.")
    }
  }

  function dismissAppointmentConfirmation() {
    if (saving) return
    setPendingConfirmation(false)
  }

  async function confirmPreparedAppointmentMutation() {
    if (readOnly || !pendingConfirmation || saving) return
    setSaving(true)
    try {
      await performSaveAppointment()
    } finally {
      setPendingConfirmation(false)
      setSaving(false)
    }
  }

  async function confirmAppointmentCancellation() {
    if (readOnly || !pendingCancellation || !appointment || !canCancelAppointment || saving) return
    const logicalDraft = JSON.stringify({
      appointmentId: appointment.id,
      expectedNotificationRevision: appointment.notificationRevision,
    })
    const kindKey = "registration-appointment-cancel"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    setSaving(true)
    try {
      const saved = await cancelRegistrationAppointment({
        appointmentId: appointment.id,
        expectedNotificationRevision: appointment.notificationRevision,
        reason: kind === "level_test" ? "레벨테스트 예약 취소" : "방문상담 예약 취소",
        requestKey,
      })
      submissionKeys.clear(kindKey, logicalDraft)
      onDirtyChange?.(false)
      await finishAppointmentSave(saved)
    } catch (error) {
      onWarning(errorMessage(error, "예약을 취소하지 못했습니다."))
    } finally {
      setPendingCancellation(false)
      setSaving(false)
    }
  }

  async function completeAttempt(activity: OpsRegistrationLevelTest) {
    if (readOnly || trackRefreshPendingIds.has(activity.trackId)) return
    const materialLink = (draftLinks[activity.id] || activity.materialLink || "").trim()
    const track = trackById.get(activity.trackId)
    if (!materialLink) {
      onWarning(`[${track?.subject || "해당 과목"}] 결과 링크를 입력하세요.`)
      return
    }
    const logicalDraft = `${activity.id}:completed:${materialLink}`
    const kindKey = "level-test-result"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    setActivitySavingId(activity.id)
    try {
      await saveRegistrationLevelTestResult({
        attemptId: activity.id,
        status: "completed",
        materialLink,
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

  return (
    <section
      ref={sectionRef}
      data-registration-subject-scoped={subjectScoped ? "" : undefined}
      className={embedded
        ? "grid min-w-0 gap-4"
        : "grid min-w-0 gap-4 rounded-md border bg-background p-3"}
      aria-label={kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}
    >
      <h3 className="text-sm font-semibold">{kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}</h3>

      {conflict ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>다른 사용자가 예약을 먼저 변경했습니다</AlertTitle>
          <AlertDescription className="gap-3 text-amber-950">
            <p>내 입력은 그대로 보존되어 있습니다.</p>
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
              <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 최신 예약 비교`} onClick={() => void compareLatestAppointment()} disabled={readOnly || saving}>최신 예약 비교</Button>
              <Button type="button" size="sm" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 다시 적용`} onClick={applyConflictDraftAgain} disabled={readOnly || saving || !canApplyConflictDraft}>다시 적용</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 예약 계속 편집`} onClick={continueEditingConflictDraft} disabled={readOnly || saving}>계속 편집</Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}

      {refreshPending ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>저장은 완료됐지만 최신 내용을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="items-end">
            <Button type="button" size="sm" variant="outline" aria-label={`${eligibleTracks.map((track) => track.subject).join("·") || "과목"} 최신 내용 다시 불러오기`} onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
          </AlertDescription>
        </Alert>
      ) : null}

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
              onChange={(value) => {
                if (readOnly) return
                setValidationError("")
                setScheduledAt(value)
              }}
              dateAriaLabel={`${appointmentParticipantSubjectLabel} 예약 날짜`}
              timeAriaLabel={`${appointmentParticipantSubjectLabel} 예약 시각`}
              clearAriaLabel={`${appointmentParticipantSubjectLabel} 예약 날짜와 시각 지우기`}
              required
              disabled={readOnly || saving || confirmationPending || mutationLocked}
              disablePortal
              timeOptions={REGISTRATION_TIME_OPTIONS}
            />
          </Label>
          <fieldset data-appointment-field="place" className="grid min-w-0 gap-1.5">
            <legend>장소 <span className="text-xs font-semibold text-primary">필수</span></legend>
            <div role="group" aria-label={`${appointmentParticipantSubjectLabel} 예약 장소`} className="grid grid-cols-2 gap-2">
              {REGISTRATION_LEVEL_TEST_PLACES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  aria-label={`${appointmentParticipantSubjectLabel} 예약 장소 ${option}`}
                  aria-pressed={selectedPlace === option}
                  variant={selectedPlace === option ? "default" : "outline"}
                  className="h-10"
                  onClick={() => {
                    if (readOnly) return
                    setValidationError("")
                    setPlace(option)
                  }}
                  disabled={readOnly || saving || confirmationPending || mutationLocked}
                >
                  {option}
                </Button>
              ))}
            </div>
            {legacyLevelTestPlace ? (
              <span className="text-xs text-muted-foreground">기존 저장 장소: {appointment?.place}</span>
            ) : null}
          </fieldset>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {canCancelAppointment ? (
            <Button
              type="button"
              className="min-h-11 min-w-11"
              variant="outline"
              disabled={saving || mutationLocked || confirmationPending || Boolean(conflict) || appointmentDirty || externalDirty}
              onClick={() => {
                if (readOnly) return
                setPendingCancellation(true)
              }}
            >
              예약 취소
            </Button>
          ) : null}
          <RegistrationSaveButton
            type="button"
            data-registration-primary-action={`${appointmentParticipantSubjectLabel}:appointment-save`}
            dirty={appointmentDirty || externalDirty}
            saving={saving}
            blocked={readOnly || mutationLocked || confirmationPending || Boolean(conflict)}
            actionLabel={actionLabel}
            cleanLabel={appointment ? "저장됨" : "예약 정보를 입력하세요"}
            aria-label={saveAriaLabel || `${appointmentParticipantSubjectLabel} 예약 저장`}
            onClick={() => void saveAppointment()}
          />
          {canSendManagementNotification && kind === "visit_consultation" ? (
            <Button
              type="button"
              className="min-h-11 min-w-11"
              variant="outline"
              disabled={visitManagementNotificationBlocked}
              onClick={() => void sendVisitManagementNotification()}
            >
              {visitManagementNotificationSending
                ? "관리 알림 보내는 중"
                : visitManagementNotificationSent
                  ? "방문상담 관리 알림 보냄"
                  : "방문상담 관리 알림 보내기"}
            </Button>
          ) : null}
          {canOpenCustomerMessage ? (
            <>
              <Button
                type="button"
                className="min-h-11 min-w-11"
                variant="outline"
                disabled={customerMessageBlocked}
                onClick={() => {
                  if (!appointment || customerMessageBlocked) return
                  onOpenCustomerMessage?.({
                    messageKind: kind === "level_test" ? "level_test_booking" : "visit_consultation_booking",
                    sourceId: appointment.id,
                  })
                }}
              >
                예약 안내 알림톡
              </Button>
            </>
          ) : null}
        </div>
        {customerReminderHistoryLabel ? (
          <p className="text-right text-xs text-muted-foreground">
            {customerReminderHistoryLabel}
          </p>
        ) : null}
        {(canOpenCustomerMessage || (canSendManagementNotification && kind === "visit_consultation")) ? (
          <p data-registration-appointment-notification-readiness className="text-right text-xs text-muted-foreground">
            알림 필수 정보: 학생, 일시, 장소, 과목, 담당자
            {appointmentNotificationReadiness.missingFields.length > 0
              ? ` · 미입력: ${appointmentNotificationReadiness.missingFields.join(", ")}`
              : " · 준비됨"}
          </p>
        ) : null}
        {canOpenCustomerMessage && customerMessageBlocked && appointmentNotificationReadiness.ready ? <p className="text-right text-xs text-muted-foreground">예약을 저장한 뒤 알림톡을 보낼 수 있습니다.</p> : null}
        {canSendManagementNotification && kind === "visit_consultation" && !notificationToken ? <p className="text-right text-xs text-muted-foreground">관리 알림 연결을 확인한 뒤 보낼 수 있습니다.</p> : null}
        {pendingConfirmation ? (
          <div
            ref={confirmationRef}
            role="alertdialog"
            aria-labelledby="registration-appointment-confirmation-title"
            tabIndex={-1}
            className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <h4 id="registration-appointment-confirmation-title" className="font-semibold">예약을 저장할까요?</h4>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" className="min-h-11 min-w-11" variant="outline" onClick={dismissAppointmentConfirmation} disabled={readOnly || saving}>돌아가기</Button>
              <Button type="button" className="min-h-11 min-w-11" onClick={() => void confirmPreparedAppointmentMutation()} disabled={readOnly || saving}>저장</Button>
            </div>
          </div>
        ) : null}
        {pendingCancellation ? (
          <div
            ref={confirmationRef}
            role="alertdialog"
            aria-labelledby="registration-appointment-cancellation-title"
            tabIndex={-1}
            className="grid gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-950 outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <h4 id="registration-appointment-cancellation-title" className="font-semibold">
              {kind === "level_test" ? "레벨테스트 예약을 취소할까요?" : "방문상담 예약을 취소할까요?"}
            </h4>
            <p className="text-sm">저장된 예약 사실만 취소합니다. 고객·관리 알림은 별도 명시 발송이며 자동으로 전송되지 않습니다.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" className="min-h-11 min-w-11" variant="outline" onClick={() => setPendingCancellation(false)} disabled={readOnly || saving}>돌아가기</Button>
              <Button type="button" className="min-h-11 min-w-11" variant="destructive" onClick={() => void confirmAppointmentCancellation()} disabled={readOnly || saving}>예약 취소</Button>
            </div>
          </div>
        ) : null}
      </div>

      {kind === "level_test" ? (
        <div className="grid gap-3 border-t pt-4">
          {matchingActivities.filter((activity) => !visibleTrackId || activity.trackId === visibleTrackId).map((activity) => {
            if (!("attemptNumber" in activity) || !displayActivityIds.has(activity.id)) return null
            const track = trackById.get(activity.trackId)
            const materialLink = draftLinks[activity.id] ?? activity.materialLink ?? ""
            const resultLinkHref = getRegistrationResultLinkHref(materialLink)
            const trackRefreshPending = trackRefreshPendingIds.has(activity.trackId)
            const resultDirty = materialLink !== (activity.materialLink || "")
            return (
              <section
                key={activity.id}
                className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"
                aria-label={`${track?.subject || "과목"} 레벨테스트 결과`}
              >
                <h3 className="text-sm font-semibold">레벨테스트 결과</h3>
                {trackRefreshPending ? (
                  <Alert className="border-amber-300 bg-amber-50 text-amber-950 sm:col-span-2">
                    <AlertTitle>저장은 완료됐지만 최신 내용을 불러오지 못했습니다</AlertTitle>
                    <AlertDescription className="items-end">
                      <Button type="button" size="sm" variant="outline" aria-label={`${track?.subject || "과목"} 최신 내용 다시 불러오기`} onClick={() => void retryTrackRefresh(activity.trackId)} disabled={Boolean(trackRefreshRetryingId)}>최신 내용 다시 불러오기</Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Label className="min-w-0">
                    <span className="sr-only">{track?.subject || "과목"} 레벨테스트 결과 링크</span>
                    <Input
                      type="url"
                      aria-label={`${track?.subject || "과목"} 레벨테스트 결과 링크`}
                      value={materialLink}
                      onChange={(event) => {
                        if (readOnly) return
                        setDraftLinks((current) => ({ ...current, [activity.id]: event.target.value }))
                      }}
                      placeholder="https://chat.google.com/..."
                      disabled={readOnly || trackRefreshPending || activitySavingId === activity.id}
                    />
                  </Label>
                  <div className="flex items-center justify-end gap-2">
                    {resultLinkHref ? (
                      <Button asChild type="button" variant="outline">
                        <a
                          href={resultLinkHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${track?.subject || "과목"} 레벨테스트 결과 링크 열기`}
                        >
                          결과 열기
                        </a>
                      </Button>
                    ) : null}
                    <RegistrationSaveButton
                      type="button"
                      dirty={resultDirty}
                      saving={activitySavingId === activity.id}
                      blocked={readOnly || trackRefreshPending || !materialLink.trim()}
                      actionLabel="결과 저장"
                      cleanLabel={activity.materialLink ? "저장됨" : "결과 링크를 입력하세요"}
                      aria-label={`${track?.subject || "과목"} 레벨테스트 결과 저장`}
                      onClick={() => void completeAttempt(activity)}
                    />
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      ) : null}

    </section>
  )
}
