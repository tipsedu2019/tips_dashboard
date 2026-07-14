"use client"

import { useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimePickerControl } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  getEligibleSharedAppointmentTracks,
  getLatestRegistrationLevelTestActivityIds,
  getRegistrationAppointmentEditMode,
  getRegistrationAppointmentPayloadTrackIds,
} from "./registration-track-model.js"
import { REGISTRATION_TIME_OPTIONS } from "./registration-workflow.js"
import { sendRegistrationVisitNotificationTarget } from "./registration-consultation-notification.js"
import {
  cancelRegistrationAppointment,
  closeRegistrationLevelTestTrack,
  completeRegistrationLevelTestAttempt,
  createRegistrationMutationRequestKey,
  saveRegistrationSharedAppointment,
  startRegistrationLevelTestAttempt,
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
  eligibleTracks: OpsRegistrationTrackSummary[]
  initialTrackId?: string
  appointment: OpsRegistrationAppointment | null
  activities: RegistrationAppointmentActivity[]
  onSaved: (saved: RegistrationAppointmentMutationResponse) => void | Promise<void>
  onWarning: (message: string) => void
  onReload?: () => void | Promise<void>
  onClose?: () => void
  onRebook?: (trackId: string) => void
  notificationToken?: string
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

function useSubmissionKeys(): SubmissionKeys {
  const keysRef = useRef(new Map<string, string>())
  return {
    getOrCreate(kind, logicalDraft) {
      const logicalKey = `${kind}:${logicalDraft}`
      const current = keysRef.current.get(logicalKey)
      if (current) return current
      const next = createRegistrationMutationRequestKey(kind, logicalDraft)
      keysRef.current.set(logicalKey, next)
      return next
    },
    clear(kind, logicalDraft) {
      keysRef.current.delete(`${kind}:${logicalDraft}`)
    },
  }
}

function RegistrationActivityStatusBadge({ status }: { status: RegistrationAppointmentActivity["status"] }) {
  const variant = ["completed"].includes(status)
    ? "default"
    : ["absent", "canceled"].includes(status)
      ? "secondary"
      : "outline"
  return <Badge variant={variant}>{ACTIVITY_STATUS_LABELS[status]}</Badge>
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
  notificationToken = "",
}: RegistrationAppointmentEditorProps) {
  const submissionKeys = useSubmissionKeys()
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

  const [scheduledAt, setScheduledAt] = useState(() => toLocalDateTime(appointment?.scheduledAt))
  const [place, setPlace] = useState(appointment?.place || "")
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(() => Array.from(new Set(initialSelectedTrackIds)))
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({})
  const [closureReasons, setClosureReasons] = useState<Record<string, string>>({})
  const [cancelReason, setCancelReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [activitySavingId, setActivitySavingId] = useState("")
  const [refreshPending, setRefreshPending] = useState(false)
  const [committedAppointment, setCommittedAppointment] = useState<RegistrationAppointmentMutationResponse | null>(null)
  const [pendingNotificationTargets, setPendingNotificationTargets] = useState<RegistrationAppointmentMutationResponse["notificationTargets"]>([])

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

  const normalizedDraft = JSON.stringify({
    appointmentId: appointment?.id || null,
    expectedNotificationRevision: appointment?.notificationRevision ?? null,
    kind,
    scheduledAt: toScheduledAt(scheduledAt),
    place: place.trim(),
    trackIds: [...effectiveSelectedTrackIds].sort(),
    replaceRemaining: editMode === "replace_remaining",
  })
  const canSave = Boolean(scheduledAt && place.trim() && effectiveSelectedTrackIds.length > 0 && !saving && !mutationLocked)

  function resetAuthoritativeDraft() {
    setScheduledAt(toLocalDateTime(appointment?.scheduledAt))
    setPlace(appointment?.place || "")
    setSelectedTrackIds(Array.from(new Set(initialSelectedTrackIds)))
    setCancelReason("")
  }

  async function handleRevisionConflict(kindKey: string, logicalDraft: string) {
    submissionKeys.clear(kindKey, logicalDraft)
    resetAuthoritativeDraft()
    try {
      await onReload?.()
    } catch {
      // The stale local draft remains discarded even if the parent reload cannot complete.
    }
    onWarning("다른 사용자가 예약을 변경했습니다. 최신 내용을 확인하세요")
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

  async function handoffCommittedAppointment(saved: RegistrationAppointmentMutationResponse) {
    try {
      await onSaved(saved)
      setCommittedAppointment(null)
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning("예약 저장과 알림 처리는 완료되었습니다. 최신 내용 다시 불러오기를 눌러 화면을 갱신하세요.")
    }
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
      await handoffCommittedAppointment(committedAppointment)
    } finally {
      setSaving(false)
    }
  }

  async function reloadAfterCommittedMutation() {
    setRefreshPending(true)
    try {
      await onReload?.()
      setRefreshPending(false)
    } catch {
      onWarning("저장은 완료되었습니다. 최신 내용 다시 불러오기를 눌러 중복 처리를 막아 주세요.")
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
      onWarning("예약 일시, 장소, 적용 과목을 모두 입력하세요.")
      return
    }
    const kindKey = "registration-appointment"
    const requestKey = submissionKeys.getOrCreate(kindKey, normalizedDraft)
    setSaving(true)
    let saved: RegistrationAppointmentMutationResponse
    try {
      saved = await saveRegistrationSharedAppointment({
        appointmentId: appointment?.id || null,
        expectedNotificationRevision: appointment?.notificationRevision ?? null,
        taskId,
        kind,
        scheduledAt: toScheduledAt(scheduledAt),
        place: place.trim(),
        trackIds: effectiveSelectedTrackIds,
        replaceRemaining: editMode === "replace_remaining",
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "예약을 저장하지 못했습니다.")
      if (message.includes("registration_appointment_revision_conflict")) {
        await handleRevisionConflict(kindKey, normalizedDraft)
        setSaving(false)
        return
      }
      onWarning(message)
      setSaving(false)
      return
    }
    submissionKeys.clear(kindKey, normalizedDraft)
    await finishAppointmentSave(saved)
    setSaving(false)
  }

  async function cancelAppointment() {
    if (!appointment || !cancelReason.trim() || saving || mutationLocked) return
    const logicalDraft = `${appointment.id}:${appointment.notificationRevision}:${cancelReason.trim()}`
    const kindKey = "registration-appointment-cancel"
    const requestKey = submissionKeys.getOrCreate(kindKey, logicalDraft)
    setSaving(true)
    let saved: RegistrationAppointmentMutationResponse
    try {
      saved = await cancelRegistrationAppointment({
        appointmentId: appointment.id,
        expectedNotificationRevision: appointment.notificationRevision,
        reason: cancelReason.trim(),
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "예약을 취소하지 못했습니다.")
      if (message.includes("registration_appointment_revision_conflict")) {
        await handleRevisionConflict(kindKey, logicalDraft)
        setSaving(false)
        return
      }
      onWarning(message)
      setSaving(false)
      return
    }
    submissionKeys.clear(kindKey, logicalDraft)
    await finishAppointmentSave(saved)
    setSaving(false)
  }

  async function startAttempt(activity: OpsRegistrationLevelTest) {
    if (mutationLocked) return
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
    await reloadAfterCommittedMutation()
    setActivitySavingId("")
  }

  async function completeAttempt(
    activity: OpsRegistrationLevelTest,
    status: "completed" | "absent" | "canceled",
  ) {
    if (mutationLocked) return
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
    await reloadAfterCommittedMutation()
    setActivitySavingId("")
  }

  async function closeInquiry(activity: OpsRegistrationLevelTest) {
    if (mutationLocked) return
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
    await reloadAfterCommittedMutation()
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
    <section className="grid min-w-0 gap-4 rounded-md border bg-background p-3" aria-label={kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{kind === "level_test" ? "레벨테스트 예약" : "방문상담 예약"}</h3>
          <p className="text-xs text-muted-foreground">같은 일정은 한 번만 정하고, 과목별 진행 결과는 각각 기록합니다.</p>
        </div>
        {onClose ? <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving || mutationLocked}>닫기</Button> : null}
      </div>

      {pendingNotificationTargets.length > 0 ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span>예약은 저장되었습니다. 실패한 방문상담 알림만 다시 보냅니다.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void retryCommittedNotifications()} disabled={saving}>알림 재시도</Button>
        </div>
      ) : refreshPending ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span>저장은 완료되었습니다. 화면만 최신 상태로 갱신하면 됩니다.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)]">
        <Label className="grid min-w-0 gap-1.5">
          <span>예약 일시 <span className="text-xs font-semibold text-primary">필수</span></span>
          <DateTimePickerControl
            value={scheduledAt}
            onChange={setScheduledAt}
            required
            disabled={saving || mutationLocked}
            disablePortal
            timeOptions={REGISTRATION_TIME_OPTIONS}
          />
        </Label>
        <Label className="grid min-w-0 gap-1.5">
          <span>장소 <span className="text-xs font-semibold text-primary">필수</span></span>
          <Input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="본관, 상담실 등" disabled={saving || mutationLocked} />
        </Label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">적용 과목 <span className="text-xs font-semibold text-primary">필수</span></legend>
        <div className="flex flex-wrap gap-2">
          {selectableTracks.map((track) => {
            const selected = effectiveSelectedTrackIds.includes(track.id)
            return (
              <Button
                key={track.id}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
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
        <Button type="button" onClick={() => void saveAppointment()} disabled={!canSave}>
          {appointment
            ? editMode === "replace_remaining" ? "남은 과목 일정 다시 잡기" : "예약 수정"
            : "예약 저장"}
        </Button>
      </div>

      {kind === "level_test" ? (
        <div className="grid gap-3 border-t pt-4">
          {activities.map((activity) => {
            if (!("attemptNumber" in activity) || !displayActivityIds.has(activity.id)) return null
            const track = trackById.get(activity.trackId)
            const materialLink = draftLinks[activity.id] ?? activity.materialLink ?? ""
            const terminal = ["completed", "absent", "canceled"].includes(activity.status)
            const canClose = ["absent", "canceled"].includes(activity.status)
              && latestLevelTestActivityIds.has(activity.id)
              && !matchingActivities.some((item) => item.trackId === activity.trackId && ["scheduled", "in_progress"].includes(item.status))
            return (
              <section key={activity.id} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{track?.subject || "과목"}</Badge>
                  <RegistrationActivityStatusBadge status={activity.status} />
                </div>
                <Label className="grid gap-1.5">
                  시험지·결과지 URL
                  <Input
                    type="url"
                    value={materialLink}
                    onChange={(event) => setDraftLinks((current) => ({ ...current, [activity.id]: event.target.value }))}
                    placeholder="https://drive.google.com/..."
                    disabled={terminal || mutationLocked || activitySavingId === activity.id}
                  />
                </Label>
                {activity.status === "scheduled" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void completeAttempt(activity, "absent")} disabled={mutationLocked || Boolean(activitySavingId)}>미응시</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void completeAttempt(activity, "canceled")} disabled={mutationLocked || Boolean(activitySavingId)}>과목 취소</Button>
                    <Button type="button" size="sm" onClick={() => void startAttempt(activity)} disabled={mutationLocked || Boolean(activitySavingId)}>시험 시작</Button>
                  </div>
                ) : activity.status === "in_progress" ? (
                  <div className="grid gap-2">
                    {!track?.directorProfileId ? <p className="text-xs text-amber-700">완료 전에 상담 책임자를 지정하세요.</p> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void completeAttempt(activity, "absent")} disabled={mutationLocked || Boolean(activitySavingId)}>미응시</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void completeAttempt(activity, "canceled")} disabled={mutationLocked || Boolean(activitySavingId)}>과목 취소</Button>
                      <Button type="button" size="sm" onClick={() => void completeAttempt(activity, "completed")} disabled={mutationLocked || Boolean(activitySavingId) || !materialLink.trim() || !track?.directorProfileId}>결과 완료</Button>
                    </div>
                  </div>
                ) : null}
                {canClose ? (
                  <div className="grid gap-2 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <Input
                      value={closureReasons[activity.trackId] || ""}
                      onChange={(event) => setClosureReasons((current) => ({ ...current, [activity.trackId]: event.target.value }))}
                      placeholder="문의 종료 사유"
                      disabled={mutationLocked || Boolean(activitySavingId)}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => onRebook?.(activity.trackId)} disabled={mutationLocked || Boolean(activitySavingId)}>다시 예약</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void closeInquiry(activity)} disabled={mutationLocked || Boolean(activitySavingId) || !(closureReasons[activity.trackId] || "").trim()}>문의 종료</Button>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}

      {appointment?.status === "scheduled" && currentActivities.some((activity) => activity.status === "scheduled") ? (
        <div className="grid gap-2 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="예약 취소 사유" disabled={saving || mutationLocked} className="min-h-16" />
          <Button type="button" variant="ghost" onClick={() => void cancelAppointment()} disabled={saving || mutationLocked || !cancelReason.trim()}>
            예약 취소
          </Button>
        </div>
      ) : null}
    </section>
  )
}
