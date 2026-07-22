"use client"

import { useEffect, useMemo, useRef, useState, type JSX } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import type {
  OpsClassOption,
  OpsProfileOption,
  OpsTask,
  OpsTeacherOption,
  OpsTextbookOption,
} from "./ops-task-service"
import {
  beginRegistrationConflictComparison,
  settleRegistrationConflictComparison,
  type RegistrationConflictComparison,
} from "./registration-application-model"
import {
  advanceRegistrationAutomaticSavingGeneration,
  resolveRegistrationTrackDirectorDefaults,
  shouldSettleRegistrationAutomaticSavingGeneration,
  type RegistrationDirectorCatalogStatus,
} from "./registration-director-default.js"
import { RegistrationEnrollmentEditor, type RegistrationEnrollmentDirtyScope } from "./registration-enrollment-editor"
import {
  assignRegistrationTrackDirector,
  completeRegistrationConsultation,
  createRegistrationMutationRequestKey,
  reopenRegistrationTrack,
  resolveRegistrationMigrationReview,
  routeRegistrationInquiry,
  transitionRegistrationWaiting,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationAppointment,
  type OpsRegistrationConsultation,
  type OpsRegistrationMigrationLegacySnapshot,
  type OpsRegistrationTrackStatus,
  type OpsRegistrationTrackSummary,
  type RegistrationSubject,
  type RegistrationWaitingKind,
} from "./registration-track-service"
import { RegistrationSelect } from "./registration-select"

export function isRegistrationDirectorCatalogRefreshError(message: string) {
  return message.includes("registration_director_refresh_required")
    || message.includes("registration_director_default_stale")
}

const COMMITTED_REFRESH_ERROR = "저장은 완료됐지만 최신 내용을 불러오지 못했습니다"

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

function focusFirstInvalid(container: HTMLElement | null, selector: string) {
  window.requestAnimationFrame(() => {
    container?.querySelector<HTMLElement>(selector)?.focus()
  })
}

function RegistrationRefreshRecovery({
  pending,
  retrying,
  onRetry,
  ownerLabel = "",
}: {
  pending: boolean
  retrying: boolean
  onRetry: () => void
  ownerLabel?: string
}) {
  if (!pending) return null
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-amber-950">
        <span>{COMMITTED_REFRESH_ERROR}</span>
        <Button type="button" size="sm" variant="outline" aria-label={`${ownerLabel ? `${ownerLabel} ` : ""}최신 내용 다시 불러오기`} onClick={onRetry} disabled={retrying}>최신 내용 다시 불러오기</Button>
      </AlertDescription>
    </Alert>
  )
}

function RegistrationTransitionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">취소</Button>
          </DialogClose>
          <Button type="button" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RegistrationTrackDirectorSection({
  task,
  detail,
  track,
  permissions,
  directorOptions,
  teacherOptions,
  directorCatalogStatus,
  subjectCapabilities,
  onRetryDirectorCatalog,
  onOpenVisit,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  directorOptions: OpsProfileOption[]
  teacherOptions: OpsTeacherOption[]
  directorCatalogStatus: RegistrationDirectorCatalogStatus
  subjectCapabilities: readonly RegistrationSubjectCapability[]
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  onOpenVisit: (trackId: string) => void
  onReload: (preferredTrackId?: string) => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const activeDirectorProfileIds = useMemo(
    () => new Set(teacherOptions.map((teacher) => teacher.profileId).filter(Boolean)),
    [teacherOptions],
  )
  const availableDirectors = useMemo(() => {
    if (track.subject !== "과학") {
      return directorOptions.filter((profile) => profile.role === "admin" && activeDirectorProfileIds.has(profile.id))
    }
    const configuredProfileId = subjectCapabilities.find((item) => item.subject === "과학" && item.isActive)?.defaultDirectorProfileId || ""
    const linkedScienceProfileIds = new Set(teacherOptions.filter((teacher) => (
      teacher.subjects?.includes("과학팀")
    )).map((teacher) => teacher.profileId).filter(Boolean))
    return directorOptions.filter((profile) => (
      profile.id === configuredProfileId && linkedScienceProfileIds.has(profile.id)
    ))
  }, [activeDirectorProfileIds, directorOptions, subjectCapabilities, teacherOptions, track.subject])
  const [directorDraft, setDirectorDraft] = useState({
    trackId: track.id,
    baselineProfileId: track.directorProfileId || "",
    value: track.directorProfileId || "",
  })
  const serverDirectorProfileId = track.directorProfileId || ""
  const directorProfileId = directorDraft.trackId === track.id
    && directorDraft.baselineProfileId === serverDirectorProfileId
    ? directorDraft.value
    : serverDirectorProfileId
  const [savingManual, setSavingManual] = useState(false)
  const [manualDirectorConflictAttempt, setManualDirectorConflictAttempt] = useState<RegistrationConflictComparison<{ profileId: string; label: string }> | null>(null)
  const [automaticError, setAutomaticError] = useState("")
  const [automaticRefreshError, setAutomaticRefreshError] = useState("")
  const [automaticRefreshTrackId, setAutomaticRefreshTrackId] = useState("")
  const [automaticRefreshRequest, setAutomaticRefreshRequest] = useState<{ id: number; preferredTrackId: string } | null>(null)
  const [visitCorrectionRequest, setVisitCorrectionRequest] = useState<{ id: number; trackId: string } | null>(null)
  const [automaticSaving, setAutomaticSaving] = useState(false)
  const [automaticRefreshing, setAutomaticRefreshing] = useState(false)
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false)
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)
  const requestKeysRef = useRef(new Map<string, string>())
  const attemptedRef = useRef(new Set<string>())
  const automaticGenerationRef = useRef(0)
  const refreshRequestIdRef = useRef(0)
  const refreshAttemptedRef = useRef(new Set<number>())
  const visitCorrectionRequestIdRef = useRef(0)
  const visitCorrectionAttemptedRef = useRef(new Set<number>())
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])
  const resolutions = useMemo(() => resolveRegistrationTrackDirectorDefaults({
    tracks: detail.tracks,
    grade: task.registration?.schoolGrade || "",
    inquiryAt: task.registration?.inquiryAt || "",
    teachers: teacherOptions,
    profiles: directorOptions,
    ...{ capabilities: subjectCapabilities },
    catalogStatus: directorCatalogStatus,
  }), [detail.tracks, directorCatalogStatus, directorOptions, subjectCapabilities, task.registration?.inquiryAt, task.registration?.schoolGrade, teacherOptions])
  const automaticActions = useMemo(
    () => resolutions.filter((resolution) => (
      resolution.trackId === track.id
      && (resolution.shouldAssign || resolution.shouldClear)
    )),
    [resolutions, track.id],
  )

  useEffect(() => {
    if (!automaticRefreshRequest || refreshAttemptedRef.current.has(automaticRefreshRequest.id)) return
    refreshAttemptedRef.current.add(automaticRefreshRequest.id)
    const request = automaticRefreshRequest
    setAutomaticRefreshing(true)
    void (async () => {
      try {
        await onReload(request.preferredTrackId || undefined)
        if (!activeRef.current) return
        setManualDirectorConflictAttempt((current) => current
          ? settleRegistrationConflictComparison(current, { succeeded: true })
          : current)
        setAutomaticRefreshError("")
        setAutomaticRefreshTrackId("")
      } catch (refreshError) {
        if (!activeRef.current) return
        const refreshMessage = errorMessage(refreshError, "최신 등록 정보를 다시 불러오지 못했습니다.")
        setManualDirectorConflictAttempt((current) => current
          ? settleRegistrationConflictComparison(current, { succeeded: false, error: refreshMessage })
          : current)
        setAutomaticRefreshError(refreshMessage)
        setAutomaticRefreshTrackId(request.preferredTrackId)
        onWarning(refreshMessage)
      } finally {
        if (activeRef.current) setAutomaticRefreshing(false)
      }
    })()
  }, [automaticRefreshRequest, onReload, onWarning])

  useEffect(() => {
    if (!visitCorrectionRequest || visitCorrectionAttemptedRef.current.has(visitCorrectionRequest.id)) return
    visitCorrectionAttemptedRef.current.add(visitCorrectionRequest.id)
    onOpenVisit(visitCorrectionRequest.trackId)
  }, [onOpenVisit, visitCorrectionRequest])

  useEffect(() => {
    const hasAutomaticActions = permissions.canManage
      && !detail.tracks.some((item) => item.migrationReviewRequired)
      && automaticActions.length > 0
    const generationState = advanceRegistrationAutomaticSavingGeneration(
      automaticGenerationRef.current,
      hasAutomaticActions,
    )
    automaticGenerationRef.current = generationState.generation
    if (!generationState.saving) {
      setAutomaticSaving(false)
      return
    }
    let cancelled = false

    async function applyAutomaticDefaults() {
      let saved = false
      let attemptedAny = false
      let visitCorrectionTrackId = ""
      setAutomaticSaving(true)
      try {
        for (const resolution of automaticActions) {
          if (cancelled) break
          const assignmentSource = resolution.shouldClear ? "clear_default" : "default"
          const visitGuardSignature = detail.consultations
            .filter((consultation) => (
              consultation.trackId === resolution.trackId
              && consultation.mode === "visit"
              && consultation.status === "scheduled"
            ))
            .map((consultation) => {
              const appointment = detail.appointments.find((item) => item.id === consultation.appointmentId)
              return `${consultation.id}:${consultation.appointmentId || ""}:${appointment?.updatedAt || ""}:${appointment?.status || ""}`
            })
            .sort()
            .join("|")
          const logicalKey = [
            detail.task.id,
            resolution.trackId,
            assignmentSource,
            resolution.profileId,
            resolution.ruleKey,
            detail.commonRevision,
            visitGuardSignature,
          ].join(":")
          const attemptKey = `${logicalKey}:retry:${retryVersion}`
          if (attemptedRef.current.has(attemptKey)) continue
          attemptedRef.current.add(attemptKey)
          if (!attemptedAny) {
            attemptedAny = true
            setAutomaticError("")
          }
          let requestKey = requestKeysRef.current.get(logicalKey)
          if (!requestKey) {
            requestKey = createRegistrationMutationRequestKey("registration-director-default", resolution.trackId)
            requestKeysRef.current.set(logicalKey, requestKey)
          }
          try {
            await assignRegistrationTrackDirector({
              trackId: resolution.trackId,
              directorProfileId: resolution.shouldClear ? null : resolution.profileId,
              assignmentSource,
              ruleKey: resolution.shouldClear ? null : resolution.ruleKey,
              expectedCommonRevision: detail.commonRevision,
              requestKey,
            })
            saved = true
          } catch (error) {
            const message = errorMessage(error, "상담 책임자 자동 배정을 저장하지 못했습니다.")
            if (message.includes("registration_common_revision_conflict")) {
              if (!activeRef.current) return
              const id = ++refreshRequestIdRef.current
              setAutomaticRefreshRequest({ id, preferredTrackId: "" })
              return
            }
            if (message.includes("registration_visit_reassign_requires_reschedule")) {
              if (!activeRef.current) return
              visitCorrectionTrackId = resolution.trackId
              setAutomaticError("방문상담 예약에서 담당 원장을 다시 확인하세요.")
              const id = ++visitCorrectionRequestIdRef.current
              setVisitCorrectionRequest({ id, trackId: resolution.trackId })
              onWarning("방문상담 예약 수정에서 담당 원장을 다시 확인하세요.")
              continue
            }
            if (isRegistrationDirectorCatalogRefreshError(message)) {
              if (!activeRef.current) return
              setCatalogRefreshRequired(true)
              setAutomaticError("담당자 기준이 변경되었습니다. 최신 담당자 정보를 다시 불러오세요.")
              onWarning("담당자 기준이 변경되었습니다. 담당자 정보를 다시 불러오세요.")
              return
            }
            if (activeRef.current) {
              setAutomaticError(message)
              onWarning(message)
            }
          }
        }
        if (saved && activeRef.current) {
          const id = ++refreshRequestIdRef.current
          setAutomaticRefreshRequest({ id, preferredTrackId: visitCorrectionTrackId })
        }
      } finally {
        if (
          activeRef.current
          && shouldSettleRegistrationAutomaticSavingGeneration(
            generationState.generation,
            automaticGenerationRef.current,
          )
        ) setAutomaticSaving(false)
      }
    }

    void applyAutomaticDefaults()
    return () => {
      cancelled = true
    }
  }, [automaticActions, detail.appointments, detail.commonRevision, detail.consultations, detail.task.id, detail.tracks, onWarning, permissions.canManage, retryVersion])

  const terminal = ["registered", "not_registered", "inquiry_closed"].includes(track.status)
  const canEdit = permissions.canManage && !terminal && !track.migrationReviewRequired
  const currentOptionMissing = Boolean(
    track.directorProfileId && !availableDirectors.some((profile) => profile.id === track.directorProfileId),
  )
  const selectedDirectorIsAvailable = availableDirectors.some((profile) => profile.id === directorProfileId)
  const directorSelectorLocked = catalogRefreshRequired
    || directorCatalogStatus === "error"
    || directorCatalogStatus === "partial"
    || Boolean(automaticRefreshError)
  useOwnedDirtyState(
    Boolean(manualDirectorConflictAttempt) || (!directorSelectorLocked && directorProfileId !== serverDirectorProfileId),
    onDirtyChange,
  )

  async function saveManualDirector() {
    if (!canEdit || !directorProfileId || !selectedDirectorIsAvailable || savingManual || automaticSaving || automaticRefreshError) return
    const logicalKey = `registration-director-manual:${track.id}:${directorProfileId}:${detail.commonRevision}`
    const attemptedDirector = {
      profileId: directorProfileId,
      label: availableDirectors.find((profile) => profile.id === directorProfileId)?.label || directorProfileId,
    }
    let requestKey = requestKeysRef.current.get(logicalKey)
    if (!requestKey) {
      requestKey = createRegistrationMutationRequestKey("registration-director-manual", track.id)
      requestKeysRef.current.set(logicalKey, requestKey)
    }
    setSavingManual(true)
    let committed = false
    try {
      await assignRegistrationTrackDirector({
        trackId: track.id,
        directorProfileId,
        assignmentSource: "manual",
        ruleKey: null,
        expectedCommonRevision: detail.commonRevision,
        requestKey,
      })
      committed = true
      onDirtyChange?.(false)
      await onReload(track.id)
      requestKeysRef.current.delete(logicalKey)
      setManualDirectorConflictAttempt(null)
    } catch (error) {
      const message = errorMessage(error, "상담 책임자를 저장하지 못했습니다.")
      if (committed) {
        setAutomaticRefreshError(COMMITTED_REFRESH_ERROR)
        setAutomaticRefreshTrackId(track.id)
        onWarning(COMMITTED_REFRESH_ERROR)
      } else if (message.includes("registration_common_revision_conflict")) {
        requestKeysRef.current.delete(logicalKey)
        const comparison = beginRegistrationConflictComparison(attemptedDirector)
        setManualDirectorConflictAttempt(comparison)
        try {
          await onReload(track.id)
          setManualDirectorConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: true }))
          onWarning("다른 사용자가 상담 책임자를 변경했습니다. 내 선택과 최신 저장 담당자를 비교하세요.")
        } catch {
          const refreshMessage = "다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다."
          setManualDirectorConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: false, error: refreshMessage }))
          setAutomaticRefreshError(refreshMessage)
          setAutomaticRefreshTrackId(track.id)
          onWarning("최신 정보 다시 불러오기를 눌러 주세요.")
        }
      } else if (message.includes("registration_visit_reassign_requires_reschedule")) {
        onOpenVisit(track.id)
        onWarning("방문상담 예약 수정에서 담당 원장을 다시 확인하세요.")
      } else if (isRegistrationDirectorCatalogRefreshError(message)) {
        setCatalogRefreshRequired(true)
        setAutomaticError("담당자 기준이 변경되었습니다. 최신 담당자 정보를 다시 불러오세요.")
        onWarning("담당자 기준이 변경되었습니다. 담당자 정보를 다시 불러오세요.")
      } else {
        onWarning(message)
      }
    } finally {
      setSavingManual(false)
    }
  }

  async function retryAutomaticRefresh() {
    if (!automaticRefreshError || automaticRefreshing) return
    const id = ++refreshRequestIdRef.current
    setAutomaticRefreshRequest({ id, preferredTrackId: automaticRefreshTrackId })
  }

  async function retryAutomaticDefaults() {
    if (!catalogRefreshRequired) {
      setRetryVersion((value) => value + 1)
      return
    }
    if (!onRetryDirectorCatalog || catalogRefreshing) return
    setCatalogRefreshing(true)
    try {
      const refreshed = await onRetryDirectorCatalog()
      if (refreshed === false) {
        setAutomaticError("최신 담당자 정보를 불러오지 못했습니다. 다시 시도하세요.")
        return
      }
      setCatalogRefreshRequired(false)
      setRetryVersion((value) => value + 1)
    } catch (error) {
      const message = errorMessage(error, "최신 담당자 정보를 불러오지 못했습니다. 다시 시도하세요.")
      setAutomaticError(message)
      onWarning(message)
    } finally {
      setCatalogRefreshing(false)
    }
  }

  const catalogNeedsRetry = directorCatalogStatus !== "loading"
    && (catalogRefreshRequired || resolutions.some((resolution) => resolution.status === "unavailable"))

  return (
    <section className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border px-3 py-2" aria-label={`${track.subject} 상담 책임자`}>
      <RegistrationRefreshRecovery pending={Boolean(automaticRefreshError)} retrying={automaticRefreshing} onRetry={() => void retryAutomaticRefresh()} ownerLabel={track.subject} />
      {manualDirectorConflictAttempt ? (
        <Alert className="w-full border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>상담 책임자 변경 충돌</AlertTitle>
          <AlertDescription className="grid justify-items-stretch gap-3 text-amber-950">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><div className="text-xs font-medium">내가 선택한 담당자</div><div>{manualDirectorConflictAttempt.attempted.label}</div></div>
              <div><div className="text-xs font-medium">최신 저장 담당자</div><div>{manualDirectorConflictAttempt.latestReady ? track.directorName || "미지정" : "최신 정보 다시 불러오기 필요"}</div></div>
            </div>
            {manualDirectorConflictAttempt.refreshError ? <p className="text-xs">{manualDirectorConflictAttempt.refreshError}</p> : null}
            {manualDirectorConflictAttempt.latestReady ? <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" size="sm" variant="outline" aria-label={`${track.subject} 최신 담당자 사용`} onClick={() => {
                setDirectorDraft({ trackId: track.id, baselineProfileId: serverDirectorProfileId, value: serverDirectorProfileId })
                setManualDirectorConflictAttempt(null)
              }}>최신 담당자 사용</Button>
              <Button type="button" size="sm" aria-label={`${track.subject} 내 담당자 선택 다시 적용`} onClick={() => {
                setDirectorDraft({ trackId: track.id, baselineProfileId: serverDirectorProfileId, value: manualDirectorConflictAttempt.attempted.profileId })
                setManualDirectorConflictAttempt(null)
              }}>내 선택 다시 적용</Button>
            </div> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <Label className="grid min-w-[13rem] flex-1 gap-1 text-xs text-muted-foreground">
        상담 책임자
        {canEdit ? (
          <RegistrationSelect
            className="h-9"
            aria-label={`${track.subject} 상담 책임자 선택`}
            value={directorProfileId}
            placeholder="원장 선택"
            options={[
              { value: "", label: "원장 선택" },
              ...(currentOptionMissing
                ? [{ value: track.directorProfileId || "", label: track.directorName || "현재 담당 원장" }]
                : []),
              ...availableDirectors.map((profile) => ({ value: profile.id, label: profile.label })),
            ]}
            onValueChange={(value) => {
              setManualDirectorConflictAttempt(null)
              setDirectorDraft({
                trackId: track.id,
                baselineProfileId: serverDirectorProfileId,
                value,
              })
            }}
            disabled={Boolean(manualDirectorConflictAttempt) || directorSelectorLocked || savingManual || automaticSaving}
          />
        ) : (
          <span className="flex h-9 items-center text-sm font-medium text-foreground">{track.directorName || "담당자 지정 필요"}</span>
        )}
      </Label>
      {canEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void saveManualDirector()}
          aria-label={`${track.subject} 상담 책임자 저장`}
          disabled={Boolean(manualDirectorConflictAttempt) || !directorProfileId || !selectedDirectorIsAvailable || directorSelectorLocked || directorProfileId === (track.directorProfileId || "") || savingManual || automaticSaving}
        >
          담당 저장
        </Button>
      ) : null}
      {automaticSaving ? <span role="status" className="text-xs text-muted-foreground">규칙 확인 중</span> : null}
      {!automaticSaving && directorCatalogStatus === "loading" ? (
        <span role="status" className="text-xs text-muted-foreground">담당자 정보 확인 중</span>
      ) : null}
      {automaticError ? (
        <div className="flex flex-wrap items-center gap-2">
          <span role="alert" className="text-xs text-destructive">{automaticError}</span>
          <Button type="button" variant="ghost" size="sm" aria-label={`${track.subject} ${catalogRefreshRequired ? "담당자 정보 다시 불러오기" : "자동 배정 다시 시도"}`} onClick={() => void retryAutomaticDefaults()} disabled={catalogRefreshing || Boolean(automaticRefreshError)}>
            {catalogRefreshRequired ? "담당자 정보 다시 불러오기" : "자동 배정 다시 시도"}
          </Button>
        </div>
      ) : null}
      {catalogNeedsRetry && !automaticError ? (
        <Button type="button" variant="ghost" size="sm" aria-label={`${track.subject} 담당자 정보 다시 불러오기`} onClick={() => void onRetryDirectorCatalog?.()} disabled={!onRetryDirectorCatalog || Boolean(automaticRefreshError)}>
          담당자 정보 다시 불러오기
        </Button>
      ) : null}
    </section>
  )
}

const REGISTRATION_HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatRegistrationDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "미정" : REGISTRATION_HISTORY_DATE_FORMATTER.format(date)
}

export type RegistrationMigrationAssignment = {
  group: "level_test" | "consultation" | "placement"
  trackId: string | null
  preserveAsCommonHistory: boolean
}

export type RegistrationMigrationTrackState = {
  trackId: string
  targetStatus:
    | "inquiry"
    | "level_test_scheduled"
    | "consultation_waiting"
    | "visit_consultation_scheduled"
    | "waiting"
    | "enrollment_decided"
    | "enrollment_processing"
    | "registered"
    | "not_registered"
    | "inquiry_closed"
  waitingKind?: Exclude<RegistrationWaitingKind, "">
  classId?: string
}

export type RegistrationTrackActionPermissions = {
  canManage: boolean
  canCompleteConsultation: boolean
  readOnly: boolean
}

type ActionPermissions = RegistrationTrackActionPermissions

type SubmissionKeys = {
  getOrCreate: (kind: string, entityId: string) => string
  clear: (kind: string, entityId: string) => void
}

export const REGISTRATION_TRACK_STATUS_LABELS: Record<OpsRegistrationTrackStatus, string> = {
  inquiry: "문의",
  migration_review: "과목 확인 필요",
  level_test_scheduled: "레벨테스트 예약",
  level_test_in_progress: "레벨테스트 진행",
  consultation_waiting: "전화상담 대기",
  visit_consultation_scheduled: "방문상담 예약",
  waiting: "대기",
  enrollment_decided: "등록 결정",
  enrollment_processing: "등록 처리",
  registered: "등록 완료",
  not_registered: "미등록 완료",
  inquiry_closed: "문의 완료",
}
const STATUS_LABELS = REGISTRATION_TRACK_STATUS_LABELS

export const REGISTRATION_DIRECTOR_VISIBLE_STATUSES = new Set<OpsRegistrationTrackStatus>([
  "inquiry",
  "level_test_scheduled",
  "level_test_in_progress",
  "consultation_waiting",
  "visit_consultation_scheduled",
])

const WAITING_KIND_OPTIONS: Array<{ value: Exclude<RegistrationWaitingKind, "">; label: string }> = [
  { value: "current_class", label: "현재 학기 수강반 대기" },
  { value: "current_term_opening", label: "현재 학기 개강반 대기" },
  { value: "next_term_opening", label: "다음 학기 개강반 대기" },
]

const MIGRATION_GROUPS = [
  {
    key: "level_test" as const,
    label: "레벨테스트 이력",
    presence: "levelTest" as const,
    fields: ["levelTestAt", "levelTestCompletedAt", "levelTestPlace", "levelTestMaterialLink", "levelTestResult"] as const,
  },
  {
    key: "consultation" as const,
    label: "상담 이력",
    presence: "consultation" as const,
    fields: ["visitConsultationAt", "consultationAt", "visitConsultationPlace"] as const,
  },
  {
    key: "placement" as const,
    label: "등록·배치 이력",
    presence: "placement" as const,
    fields: ["studentId", "classId", "textbookId", "classStartDate", "classStartSession", "admissionNoticeSent", "makeeduRegistered", "makeeduInvoiceSent", "paymentChecked"] as const,
  },
]

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function useSubmissionKeys(): SubmissionKeys {
  const keysRef = useRef(new Map<string, string>())
  return {
    getOrCreate(kind, entityId) {
      const logicalKey = `${kind}:${entityId}`
      const current = keysRef.current.get(logicalKey)
      if (current) return current
      const next = createRegistrationMutationRequestKey(kind, entityId)
      keysRef.current.set(logicalKey, next)
      return next
    },
    clear(kind, entityId) {
      keysRef.current.delete(`${kind}:${entityId}`)
    },
  }
}

function legacyText(
  legacy: OpsRegistrationMigrationLegacySnapshot | null,
  fields: ReadonlyArray<keyof OpsRegistrationMigrationLegacySnapshot>,
) {
  if (!legacy) return ""
  return fields
    .map((field) => legacy[field])
    .filter((value) => value === true || (typeof value === "string" && value.trim() !== ""))
    .map((value) => String(value))
    .join(" · ")
}

function hasLegacyLevelTestReservation(legacy: OpsRegistrationMigrationLegacySnapshot | null) {
  return Boolean(legacy?.levelTestAt && legacy.levelTestPlace)
}

function hasLegacyVisitReservation(legacy: OpsRegistrationMigrationLegacySnapshot | null) {
  return Boolean(legacy?.visitConsultationAt && legacy.visitConsultationPlace)
}

export function getRegistrationIdentityEditLock(detail: OpsRegistrationCaseDetail) {
  return Boolean(
    detail.enrollments.some((enrollment) => enrollment.status !== "planned")
    || detail.admissionBatches.length > 0
    || detail.admissionApplicationAccepted
    || detail.admissionApplicationMessageClaimActive
    || detail.task.registration?.admissionNoticeSent,
  )
}

function SubjectClassSelect({
  subject,
  value,
  onChange,
  classOptions,
  disabled,
}: {
  subject: RegistrationSubject
  value: string
  onChange: (value: string) => void
  classOptions: OpsClassOption[]
  disabled?: boolean
}) {
  const matchingClasses = classOptions.filter((option) => option.subject === subject)
  return (
    <RegistrationSelect
      aria-label={`${subject} 수업 선택`}
      className="h-9 w-full min-w-0"
      value={value}
      placeholder="수업 선택"
      options={[
        { value: "", label: "수업 선택" },
        ...matchingClasses.map((option) => ({ value: option.id, label: option.label })),
      ]}
      onValueChange={onChange}
      disabled={disabled}
    />
  )
}

function InquiryStageEditor({
  track,
  permissions,
  classOptions,
  onReload,
  onWarning,
  onOpenLevelTest,
  onDirtyChange,
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [waitingKind, setWaitingKind] = useState<RegistrationWaitingKind>("current_term_opening")
  const [classId, setClassId] = useState("")
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const [confirmingInquiryClose, setConfirmingInquiryClose] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const submissionKeys = useSubmissionKeys()
  useOwnedDirtyState(
    !refreshPending && (waitingKind !== "current_term_opening" || Boolean(classId)),
    onDirtyChange,
  )

  async function route(destination: "consultation_waiting" | "waiting" | "inquiry_closed") {
    if (saving || refreshPending || !permissions.canManage) return
    if (destination === "consultation_waiting" && !track.directorProfileId) {
      onWarning(`[${track.subject}] 상담 책임자를 먼저 지정하세요.`)
      return
    }
    if (destination === "waiting" && (!waitingKind || (waitingKind === "current_class" && !classId))) {
      setValidationError("대기 종류와 필요한 수업을 선택하세요.")
      focusFirstInvalid(sectionRef.current, waitingKind ? `[aria-label="${track.subject} 수업 선택"]` : `[aria-label="${track.subject} 대기 종류"]`)
      return
    }
    const kind = `registration-inquiry-${destination}`
    const requestKey = submissionKeys.getOrCreate(kind, track.id)
    setSaving(true)
    try {
      await routeRegistrationInquiry({
        trackId: track.id,
        destination,
        waitingKind: destination === "waiting" ? waitingKind : "",
        classId: destination === "waiting" && waitingKind === "current_class" ? classId : "",
        requestKey,
      })
      submissionKeys.clear(kind, track.id)
      onDirtyChange?.(false)
      setRefreshPending(true)
      try {
        await onReload()
        setRefreshPending(false)
      } catch {
        onWarning(COMMITTED_REFRESH_ERROR)
      }
    } catch (error) {
      onWarning(errorMessage(error, "문의 다음 단계를 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function retryRefresh() {
    setSaving(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={sectionRef} className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 문의 처리`}>
      <div>
        <h3 className="text-sm font-semibold">[{track.subject}] 문의 다음 단계</h3>
        <p className="text-xs text-muted-foreground">과목별로 다음 업무를 선택합니다.</p>
      </div>
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} ownerLabel={track.subject} />
      {permissions.canManage && !refreshPending ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <RegistrationSelect
              aria-label={`${track.subject} 대기 종류`}
              className="h-9"
              value={waitingKind}
              placeholder="대기 종류 선택"
              options={WAITING_KIND_OPTIONS}
              onValueChange={(value) => setWaitingKind(value as RegistrationWaitingKind)}
              disabled={saving}
            />
            {waitingKind === "current_class" ? (
              <SubjectClassSelect subject={track.subject} value={classId} onChange={setClassId} classOptions={classOptions} disabled={saving} />
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" aria-label={`${track.subject} 레벨테스트 예약`} onClick={onOpenLevelTest} disabled={saving}>
              레벨테스트 예약
            </Button>
            <Button type="button" variant="outline" aria-label={`${track.subject} 바로 상담`} onClick={() => void route("consultation_waiting")} disabled={saving || !track.directorProfileId} title={!track.directorProfileId ? "상담 책임자 지정 필요" : undefined}>
              바로 상담
            </Button>
            <Button type="button" variant="outline" aria-label={`${track.subject} 대기`} onClick={() => void route("waiting")} disabled={saving}>
              대기
            </Button>
            <Button type="button" variant="ghost" aria-label={`${track.subject} 문의만 완료`} onClick={() => setConfirmingInquiryClose(true)} disabled={saving}>
              문의만 완료
            </Button>
          </div>
        </>
      ) : !refreshPending ? <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 다음 단계를 결정할 수 있습니다.</p> : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
      <RegistrationTransitionConfirmDialog
        open={confirmingInquiryClose}
        title={`${track.subject} 문의 완료`}
        description="이 과목의 문의를 완료 처리합니다."
        confirmLabel="문의 완료"
        onOpenChange={setConfirmingInquiryClose}
        onConfirm={() => {
          setConfirmingInquiryClose(false)
          void route("inquiry_closed")
        }}
      />
    </section>
  )
}

function WaitingStageEditor({
  track,
  currentClassWaitClassId,
  permissions,
  classOptions,
  onReload,
  onWarning,
  onOpenLevelTest,
  onDirtyChange,
}: {
  track: OpsRegistrationTrackSummary
  currentClassWaitClassId: string
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [waitingKind, setWaitingKind] = useState<RegistrationWaitingKind>(track.waitingKind || "current_term_opening")
  const [classId, setClassId] = useState(currentClassWaitClassId)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const [confirmingWaitingClose, setConfirmingWaitingClose] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const submissionKeys = useSubmissionKeys()
  useOwnedDirtyState(
    !refreshPending && (
      waitingKind !== (track.waitingKind || "current_term_opening")
      || classId !== currentClassWaitClassId
      || Boolean(reason)
    ),
    onDirtyChange,
  )

  async function transition(action: "change_waiting_kind" | "record_retest_required" | "move_to_enrollment" | "close_not_registered") {
    if (saving || refreshPending || !permissions.canManage) return
    if (action === "change_waiting_kind" && (!waitingKind || (waitingKind === "current_class" && !classId))) {
      setValidationError("대기 종류와 필요한 수업을 선택하세요.")
      focusFirstInvalid(sectionRef.current, waitingKind ? `[aria-label="${track.subject} 수업 선택"]` : `[aria-label="${track.subject} 대기 종류"]`)
      return
    }
    if (action === "close_not_registered" && !reason.trim()) {
      setValidationError("대기 종료 사유를 입력하세요.")
      focusFirstInvalid(sectionRef.current, `[aria-label="${track.subject} 대기 종료 사유"]`)
      return
    }
    const kind = `registration-waiting-${action}`
    const requestKey = submissionKeys.getOrCreate(kind, track.id)
    setSaving(true)
    try {
      await transitionRegistrationWaiting({
        trackId: track.id,
        action,
        waitingKind: action === "change_waiting_kind" ? waitingKind : "",
        classId: action === "change_waiting_kind" && waitingKind === "current_class" ? classId : "",
        retakeDecision: action === "record_retest_required" ? "required" : action === "move_to_enrollment" ? "not_required" : "",
        reason: action === "close_not_registered" ? reason.trim() : "",
        requestKey,
      })
      submissionKeys.clear(kind, track.id)
      onDirtyChange?.(false)
      setRefreshPending(true)
      let reloaded = false
      try {
        await onReload()
        setRefreshPending(false)
        reloaded = true
      } catch {
        onWarning(COMMITTED_REFRESH_ERROR)
      }
      if (action === "record_retest_required" && reloaded) onOpenLevelTest()
    } catch (error) {
      onWarning(errorMessage(error, "대기 상태를 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function retryRefresh() {
    setSaving(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={sectionRef} data-registration-action-owner={`${track.subject}:waiting-close`} className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 대기 처리`}>
      <div>
        <h3 className="text-sm font-semibold">[{track.subject}] 대기 관리</h3>
        <p className="text-xs text-muted-foreground">등록 전환 시 레벨테스트 재응시 여부를 반드시 결정합니다.</p>
      </div>
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} ownerLabel={track.subject} />
      {permissions.canManage && !refreshPending ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <RegistrationSelect
              aria-label={`${track.subject} 대기 종류`}
              className="h-9"
              value={waitingKind}
              placeholder="대기 종류 선택"
              options={WAITING_KIND_OPTIONS}
              onValueChange={(value) => setWaitingKind(value as RegistrationWaitingKind)}
              disabled={saving}
            />
            {waitingKind === "current_class" ? <SubjectClassSelect subject={track.subject} value={classId} onChange={setClassId} classOptions={classOptions} disabled={saving} /> : null}
          </div>
          <Button type="button" aria-label={`${track.subject} 대기 종류 저장`} variant="outline" size="sm" onClick={() => void transition("change_waiting_kind")} disabled={saving}>
            대기 상태 변경
          </Button>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              aria-label={`${track.subject} ${track.levelTestRetakeDecision === "required" ? "레벨테스트 예약" : "레벨테스트 재응시 필요"}`}
              variant="outline"
              onClick={() => track.levelTestRetakeDecision === "required" ? onOpenLevelTest() : void transition("record_retest_required")}
              disabled={saving}
            >
              {track.levelTestRetakeDecision === "required" ? "레벨테스트 예약" : "레벨테스트 재응시 필요"}
            </Button>
            <Button type="button" aria-label={`${track.subject} 등록 전환`} onClick={() => void transition("move_to_enrollment")} disabled={saving}>
              재응시 없이 등록
            </Button>
          </div>
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
            <Input aria-label={`${track.subject} 대기 종료 사유`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="미등록 종료 사유" disabled={saving} />
            <Button type="button" data-registration-primary-action={`${track.subject}:waiting-close`} aria-label={`${track.subject} 대기 종료 미등록`} variant="ghost" onClick={() => setConfirmingWaitingClose(true)} disabled={saving || !reason.trim()}>
              대기 종료 · 미등록
            </Button>
          </div>
        </>
      ) : !refreshPending ? <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 대기 상태를 변경할 수 있습니다.</p> : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
      <RegistrationTransitionConfirmDialog
        open={confirmingWaitingClose}
        title={`${track.subject} 대기 종료`}
        description="대기를 종료하고 미등록으로 처리합니다."
        confirmLabel="대기 종료 · 미등록"
        onOpenChange={setConfirmingWaitingClose}
        onConfirm={() => {
          setConfirmingWaitingClose(false)
          void transition("close_not_registered")
        }}
      />
    </section>
  )
}

function TerminalStageEditor({
  track,
  permissions,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const reasonRef = useRef<HTMLInputElement | null>(null)
  const submissionKeys = useSubmissionKeys()
  useOwnedDirtyState(!refreshPending && Boolean(reason), onDirtyChange)

  async function reopen(destination: "inquiry" | "consultation_waiting") {
    if (!permissions.canManage || saving || refreshPending) return
    if (!reason.trim()) {
      setValidationError("재개 사유를 입력하세요.")
      window.requestAnimationFrame(() => reasonRef.current?.focus())
      return
    }
    if (destination === "consultation_waiting" && !track.directorProfileId) {
      onWarning(`[${track.subject}] 상담 책임자를 먼저 지정하세요.`)
      return
    }
    const kind = `registration-reopen-${destination}`
    const logicalDraft = JSON.stringify({ trackId: track.id, destination, reason: reason.trim() })
    const requestKey = submissionKeys.getOrCreate(kind, logicalDraft)
    setSaving(true)
    try {
      await reopenRegistrationTrack({
        trackId: track.id,
        destination,
        reason: reason.trim(),
        requestKey,
      })
      submissionKeys.clear(kind, logicalDraft)
      onDirtyChange?.(false)
      setRefreshPending(true)
      try {
        await onReload()
        setRefreshPending(false)
      } catch {
        onWarning(COMMITTED_REFRESH_ERROR)
      }
    } catch (error) {
      onWarning(errorMessage(error, "완료된 과목을 다시 열지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function retryRefresh() {
    setSaving(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid min-w-0 gap-3 rounded-md bg-muted/25 p-3" aria-label={`${track.subject} 완료 결과`}>
      <div>
        <h3 className="text-sm font-semibold">[{track.subject}] {STATUS_LABELS[track.status]}</h3>
        <p className="text-xs text-muted-foreground">추가 진행이 필요한 경우 사유를 남기고 다시 엽니다.</p>
      </div>
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} ownerLabel={track.subject} />
      {permissions.canManage && !refreshPending ? (
        <>
          <Input ref={reasonRef} aria-label={`${track.subject} 재개 사유`} value={reason} onChange={(event) => { setReason(event.target.value); setValidationError("") }} placeholder="재개 사유" disabled={saving} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" aria-label={`${track.subject} 문의로 다시 열기`} onClick={() => void reopen("inquiry")} disabled={saving}>
              문의로 다시 열기
            </Button>
            <Button type="button" aria-label={`${track.subject} 전화상담으로 다시 열기`} onClick={() => void reopen("consultation_waiting")} disabled={saving || !track.directorProfileId} title={!track.directorProfileId ? "상담 책임자 지정 필요" : undefined}>
              전화상담으로 다시 열기
            </Button>
          </div>
        </>
      ) : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </section>
  )
}

export function RegistrationTrackStageEditor({
  track,
  currentClassWaitClassId,
  permissions,
  classOptions,
  onReload,
  onWarning,
  onOpenLevelTest,
  onOpenVisit,
  activeConsultation,
  visitAppointment,
  onDirtyChange,
}: {
  track: OpsRegistrationTrackSummary
  currentClassWaitClassId: string
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
  onOpenVisit: () => void
  activeConsultation: OpsRegistrationConsultation | null
  visitAppointment: OpsRegistrationAppointment | null
  onDirtyChange?: (dirty: boolean) => void
}) {
  if (track.status === "inquiry") {
    return <InquiryStageEditor track={track} permissions={permissions} classOptions={classOptions} onReload={onReload} onWarning={onWarning} onOpenLevelTest={onOpenLevelTest} onDirtyChange={onDirtyChange} />
  }
  if (track.status === "waiting") {
    return <WaitingStageEditor track={track} currentClassWaitClassId={currentClassWaitClassId} permissions={permissions} classOptions={classOptions} onReload={onReload} onWarning={onWarning} onOpenLevelTest={onOpenLevelTest} onDirtyChange={onDirtyChange} />
  }
  if (track.status === "consultation_waiting") {
    return (
      <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 상담 대기`}>
        <div>
          <h3 className="text-sm font-semibold">[{track.subject}] 전화상담 대기</h3>
          <p className="text-xs text-muted-foreground">전화상담은 예약 없이 담당자가 순서대로 처리합니다.</p>
        </div>
        <dl className="grid gap-2 rounded-md bg-muted/35 p-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">전화상담 대기 기준일시</dt><dd className="mt-1 font-medium">{formatRegistrationDateTime(activeConsultation?.readyAt || "")}</dd></div>
        </dl>
        {permissions.canManage ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" aria-label={`${track.subject} 방문상담 예약`} variant="outline" onClick={onOpenVisit}>방문상담 예약</Button>
          </div>
        ) : null}
      </section>
    )
  }
  if (["level_test_scheduled", "level_test_in_progress"].includes(track.status)) {
    return (
      <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 레벨테스트 관리`}>
        <h3 className="text-sm font-semibold">[{track.subject}] {STATUS_LABELS[track.status]}</h3>
      </section>
    )
  }
  if (track.status === "visit_consultation_scheduled") {
    return (
      <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 방문상담 관리`}>
        <h3 className="text-sm font-semibold">[{track.subject}] 방문상담 예약</h3>
        {visitAppointment ? (
          <dl className="grid gap-2 rounded-md bg-muted/35 p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">방문상담 일시</dt><dd className="mt-1 font-medium">{formatRegistrationDateTime(visitAppointment.scheduledAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">방문상담 장소</dt><dd className="mt-1 font-medium">{visitAppointment.place || "미정"}</dd></div>
          </dl>
        ) : null}
      </section>
    )
  }
  if (["not_registered", "inquiry_closed"].includes(track.status)) {
    return <TerminalStageEditor track={track} permissions={permissions} onReload={onReload} onWarning={onWarning} onDirtyChange={onDirtyChange} />
  }
  if (["enrollment_decided", "enrollment_processing", "registered"].includes(track.status)) {
    return null
  }
  return null
}

export function RegistrationEnrollmentTrackEditor({
  detail,
  track,
  viewerId,
  permissions,
  classOptions,
  textbookOptions,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  detail: OpsRegistrationCaseDetail
  track: OpsRegistrationTrackSummary
  viewerId: string
  permissions: RegistrationTrackActionPermissions
  classOptions: OpsClassOption[]
  textbookOptions: OpsTextbookOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (scope: RegistrationEnrollmentDirtyScope, dirty: boolean) => void
}) {
  return (
    <RegistrationEnrollmentEditor
      key={`enrollment:${track.id}`}
      taskId={detail.task.id}
      viewerId={viewerId}
      track={track}
      enrollments={detail.enrollments}
      admissionBatches={detail.admissionBatches}
      classes={classOptions}
      textbooks={textbookOptions}
      permissions={permissions}
      onReload={onReload}
      onWarning={onWarning}
      onDirtyChange={onDirtyChange}
    />
  )
}

type ConsultationOutcomeDraft = {
  outcome: "enrollment" | "waiting" | "not_registered"
  waitingKind: RegistrationWaitingKind
  classId: string
}

export type RegistrationConsultationOutcomeEditorProps = {
  subject: RegistrationSubject
  consultation: OpsRegistrationConsultation
  active: boolean
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}

export function RegistrationConsultationOutcomeEditor({
  subject,
  consultation,
  active,
  classOptions,
  onReload,
  onWarning,
  onDirtyChange,
}: RegistrationConsultationOutcomeEditorProps): JSX.Element {
  const [draft, setDraft] = useState<ConsultationOutcomeDraft>({
    outcome: "enrollment",
    waitingKind: "current_term_opening",
    classId: "",
  })
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const sectionRef = useRef<HTMLElement | null>(null)
  const submissionKeys = useSubmissionKeys()
  const waitingIsValid = draft.outcome !== "waiting"
    || Boolean(draft.waitingKind && (draft.waitingKind !== "current_class" || draft.classId))
  useOwnedDirtyState(
    active && !refreshPending && (
      draft.outcome !== "enrollment"
      || draft.waitingKind !== "current_term_opening"
      || Boolean(draft.classId)
    ),
    onDirtyChange,
  )

  async function submit() {
    if (!active || saving || refreshPending) return
    if (!waitingIsValid) {
      setValidationError("대기 종류와 필요한 수업을 선택하세요.")
      focusFirstInvalid(sectionRef.current, draft.waitingKind ? `[aria-label="${subject} 수업 선택"]` : `[aria-label="${subject} 상담 결과 대기 종류"]`)
      return
    }
    const normalizedDraft = JSON.stringify({
      consultationId: consultation.id,
      outcome: draft.outcome,
      waitingKind: draft.outcome === "waiting" ? draft.waitingKind : "",
      classId: draft.outcome === "waiting" && draft.waitingKind === "current_class" ? draft.classId : "",
    })
    const kind = "consultation-complete"
    const requestKey = submissionKeys.getOrCreate(kind, normalizedDraft)
    setSaving(true)
    try {
      await completeRegistrationConsultation({
        consultationId: consultation.id,
        outcome: draft.outcome,
        waitingKind: draft.outcome === "waiting" ? draft.waitingKind : "",
        classId: draft.outcome === "waiting" && draft.waitingKind === "current_class" ? draft.classId : "",
        requestKey,
      })
    } catch (error) {
      onWarning(errorMessage(error, "상담 결과를 저장하지 못했습니다."))
      setSaving(false)
      return
    }

    submissionKeys.clear(kind, normalizedDraft)
    onDirtyChange?.(false)
    setRefreshPending(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning(COMMITTED_REFRESH_ERROR)
    } finally {
      setSaving(false)
    }
  }

  async function retryRefresh() {
    if (saving) return
    setSaving(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning("최신 상담 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={sectionRef} data-registration-action-owner={`${subject}:consultation-outcome-save`} className="grid gap-4 rounded-md border bg-background p-3" aria-label={subject + " 상담 결과"}>
      <div>
        <h4 className="text-sm font-semibold">[{subject}] {consultation.mode === "phone" ? "전화상담" : "방문상담"} 결과</h4>
        <p className="text-xs text-muted-foreground">완료 일시는 저장 시 자동 기록됩니다. 과목별 다음 단계를 선택하세요.</p>
      </div>

      {refreshPending ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-amber-950">
            <span>{COMMITTED_REFRESH_ERROR}</span>
            <Button type="button" size="sm" variant="outline" aria-label={`${subject} 최신 내용 다시 불러오기`} onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">상담 결과</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button type="button" aria-label={`${subject} 상담 결과 등록`} variant={draft.outcome === "enrollment" ? "default" : "outline"} aria-pressed={draft.outcome === "enrollment"} disabled={saving} onClick={() => setDraft((current) => ({ ...current, outcome: "enrollment" }))}>등록</Button>
              <Button type="button" aria-label={`${subject} 상담 결과 대기`} variant={draft.outcome === "waiting" ? "default" : "outline"} aria-pressed={draft.outcome === "waiting"} disabled={saving} onClick={() => setDraft((current) => ({ ...current, outcome: "waiting" }))}>대기</Button>
              <Button type="button" aria-label={`${subject} 상담 결과 미등록 완료`} className="col-span-2 sm:col-span-1" variant={draft.outcome === "not_registered" ? "default" : "outline"} aria-pressed={draft.outcome === "not_registered"} disabled={saving} onClick={() => setDraft((current) => ({ ...current, outcome: "not_registered" }))}>미등록 완료</Button>
            </div>
          </fieldset>
          {draft.outcome === "waiting" ? (
            <div className="grid gap-2">
              <Label className="grid gap-1.5">
                대기 종류
                <RegistrationSelect
                  aria-label={`${subject} 상담 결과 대기 종류`}
                  className="h-9"
                  value={draft.waitingKind}
                  placeholder="대기 종류 선택"
                  options={WAITING_KIND_OPTIONS}
                  onValueChange={(value) => {
                    setValidationError("")
                    setDraft((current) => ({ ...current, waitingKind: value as RegistrationWaitingKind, classId: "" }))
                  }}
                  disabled={saving}
                />
              </Label>
              {draft.waitingKind === "current_class" ? (
                <Label className="grid gap-1.5">
                  대기 수업
                  <SubjectClassSelect subject={subject} value={draft.classId} onChange={(classId) => { setValidationError(""); setDraft((current) => ({ ...current, classId })) }} classOptions={classOptions} disabled={saving} />
                </Label>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end">
          <Button type="button" data-registration-primary-action={`${subject}:consultation-outcome-save`} aria-label={`${subject} 상담 결과 저장`} onClick={() => void submit()} disabled={saving}>{saving ? "저장 중" : "상담 결과 저장"}</Button>
          </div>
        </>
      )}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </section>
  )
}

type ReviewTargetState = RegistrationMigrationTrackState["targetStatus"] | ""

export type RegistrationMigrationConflictAttempt = {
  assignments: Record<string, string>
  targetStates: Record<string, ReviewTargetState>
  waitingKinds: Record<string, RegistrationWaitingKind>
  classIds: Record<string, string>
  summaryLines: string[]
}

type RegistrationMigrationDirectorConflictAttempt = {
  trackId: string
  profileId: string
  label: string
}

export type RegistrationMigrationConflictState =
  | {
    kind: "director"
    taskId: string
    comparison: RegistrationConflictComparison<RegistrationMigrationDirectorConflictAttempt>
  }
  | {
    kind: "review"
    taskId: string
    comparison: RegistrationConflictComparison<RegistrationMigrationConflictAttempt>
  }

export type RegistrationMigrationDirtyScope = "director" | "review"

export function RegistrationMigrationConflictNotice({
  conflict,
  detail,
  retrying,
  canReapply,
  onRetry,
  onUseLatest,
  onReapply,
}: {
  conflict: RegistrationMigrationConflictState
  detail: OpsRegistrationCaseDetail
  retrying: boolean
  canReapply: boolean
  onRetry: () => void
  onUseLatest: () => void
  onReapply: () => void
}) {
  const { comparison } = conflict
  const directorAttempt = conflict.kind === "director" ? conflict.comparison.attempted : null
  const reviewAttempt = conflict.kind === "review" ? conflict.comparison.attempted : null
  const directorTrack = conflict.kind === "director"
    ? detail.tracks.find((item) => item.id === directorAttempt?.trackId) || null
    : null
  const subjectLabel = directorTrack?.subject || detail.tracks.map((item) => item.subject).join("·") || "과목"
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTitle>다른 사용자가 등록 정보를 먼저 저장했습니다.</AlertTitle>
      <AlertDescription className="grid justify-items-stretch gap-3 text-amber-950">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium">{conflict.kind === "director" ? "내가 선택한 담당자" : "내가 선택한 분리안"}</div>
            {conflict.kind === "director" ? (
              <div>{directorAttempt?.label}</div>
            ) : (
              <ul className="mt-1 grid gap-1 text-xs">
                {reviewAttempt?.summaryLines.map((line, index) => <li key={`attempt-${index}`}>{line}</li>)}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium">{conflict.kind === "director" ? "최신 저장 담당자" : "최신 저장 상태"}</div>
            {comparison.latestReady ? conflict.kind === "director" ? (
              <div>{directorTrack?.directorName || "미지정"}</div>
            ) : (
              <ul className="mt-1 grid gap-1 text-xs">
                <li>공통 정보 버전: {detail.commonRevision}</li>
                {detail.tracks.map((item) => <li key={`latest-track-${item.id}`}>{item.subject}: {STATUS_LABELS[item.status]} · {item.directorName || "담당자 미지정"}</li>)}
              </ul>
            ) : (
              <div>최신 정보 다시 불러오기 필요</div>
            )}
          </div>
        </div>
        {comparison.refreshError ? <p className="text-xs">{comparison.refreshError}</p> : null}
        {!comparison.latestReady ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" aria-label={`${subjectLabel} 충돌 최신 정보 다시 불러오기`} onClick={onRetry} disabled={retrying}>
              최신 정보 다시 불러오기
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" size="sm" variant="outline" aria-label={`${subjectLabel} ${conflict.kind === "director" ? "최신 담당자" : "최신 과목 분리 상태"} 사용`} onClick={onUseLatest}>
              {conflict.kind === "director" ? "최신 담당자 사용" : "최신 상태 사용"}
            </Button>
            {canReapply ? (
              <Button type="button" size="sm" aria-label={`${subjectLabel} ${conflict.kind === "director" ? "내 담당자 선택" : "내 과목 분리안"} 다시 적용`} onClick={onReapply}>
                {conflict.kind === "director" ? "내 선택 다시 적용" : "내 분리안 다시 적용"}
              </Button>
            ) : null}
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function RegistrationMigrationReviewEditor({
  detail,
  track,
  permissions,
  directorOptions,
  teacherOptions,
  classOptions,
  onRetryDirectorCatalog,
  onResolved,
  onWarning,
  onDirtyChange,
  conflictState,
  onConflictStateChange,
  directorConflictResetVersion,
  reviewConflictResetVersion,
}: {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  directorOptions: OpsProfileOption[]
  teacherOptions: OpsTeacherOption[]
  classOptions: OpsClassOption[]
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  onResolved: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (scope: RegistrationMigrationDirtyScope, dirty: boolean) => void
  conflictState: RegistrationMigrationConflictState | null
  onConflictStateChange: (conflict: RegistrationMigrationConflictState | null) => void
  directorConflictResetVersion: number
  reviewConflictResetVersion: number
}) {
  const reviewTracks = [
    track,
    ...detail.tracks.filter((item) => item.migrationReviewRequired && item.id !== track.id),
  ]
  const groups = MIGRATION_GROUPS.filter((group) => detail.migrationLegacy?.groups[group.presence])
  const requiresExplicitAssignments = reviewTracks.length > 1
  const reviewSubjectLabel = reviewTracks.map((item) => item.subject).join("·") || "과목"
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [targetStates, setTargetStates] = useState<Record<string, ReviewTargetState>>({})
  const [waitingKinds, setWaitingKinds] = useState<Record<string, RegistrationWaitingKind>>({})
  const [classIds, setClassIds] = useState<Record<string, string>>({})
  const [directorIds, setDirectorIds] = useState<Record<string, string>>(() => Object.fromEntries(reviewTracks.map((track) => [track.id, track.directorProfileId || ""])))
  const [savingDirectorId, setSavingDirectorId] = useState("")
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false)
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [directorRefreshPending, setDirectorRefreshPending] = useState(false)
  const [reviewRefreshPending, setReviewRefreshPending] = useState(false)
  const directorConflictResetVersionRef = useRef(directorConflictResetVersion)
  const reviewConflictResetVersionRef = useRef(reviewConflictResetVersion)
  const submissionKeys = useSubmissionKeys()
  const activeDirectorProfileIds = new Set(teacherOptions.map((teacher) => teacher.profileId).filter(Boolean))
  const availableDirectors = directorOptions.filter((profile) => profile.role === "admin" && activeDirectorProfileIds.has(profile.id))
  const hasLevelTestReservation = hasLegacyLevelTestReservation(detail.migrationLegacy)
  const hasVisitReservation = hasLegacyVisitReservation(detail.migrationLegacy)
  const directorBaseline = Object.fromEntries(reviewTracks.map((item) => [item.id, item.directorProfileId || ""]))
  const reviewFormDirty = Object.keys(assignments).length > 0
    || Object.keys(targetStates).length > 0
    || Object.keys(waitingKinds).length > 0
    || Object.keys(classIds).length > 0
  const directorDirty = JSON.stringify(directorIds) !== JSON.stringify(directorBaseline)
  useOwnedDirtyState(
    !directorRefreshPending && directorDirty,
    (dirty) => onDirtyChange?.("director", dirty),
  )
  useOwnedDirtyState(
    !reviewRefreshPending && reviewFormDirty,
    (dirty) => onDirtyChange?.("review", dirty),
  )
  useEffect(() => {
    if (directorConflictResetVersionRef.current === directorConflictResetVersion) return
    directorConflictResetVersionRef.current = directorConflictResetVersion
    setDirectorIds(directorBaseline)
  }, [directorConflictResetVersion, directorBaseline])
  useEffect(() => {
    if (reviewConflictResetVersionRef.current === reviewConflictResetVersion) return
    reviewConflictResetVersionRef.current = reviewConflictResetVersion
    setAssignments({})
    setTargetStates({})
    setWaitingKinds({})
    setClassIds({})
  }, [reviewConflictResetVersion])

  function groupIsAssignedTo(group: string, trackId: string) {
    if (!requiresExplicitAssignments) {
      return reviewTracks[0]?.id === trackId && groups.some((item) => item.key === group)
    }
    return assignments[group] === trackId
  }

  function targetIsValid(track: OpsRegistrationTrackSummary) {
    const target = targetStates[track.id]
    const legacyClassMatchesSubject = classOptions.some((option) => option.id === detail.migrationLegacy?.classId && option.subject === track.subject)
    if (!target) return false
    if (
      ["consultation_waiting", "visit_consultation_scheduled"].includes(target)
      && (!track.directorProfileId || !activeDirectorProfileIds.has(track.directorProfileId))
    ) return false
    if (target === "waiting") {
      const waitingKind = waitingKinds[track.id]
      if (!waitingKind) return false
      if (waitingKind === "current_class" && !classIds[track.id]) return false
    }
    if (target === "level_test_scheduled" && (!groupIsAssignedTo("level_test", track.id) || !hasLevelTestReservation)) return false
    if (target === "visit_consultation_scheduled" && (!groupIsAssignedTo("consultation", track.id) || !hasVisitReservation)) return false
    if (target === "enrollment_decided" && (!groupIsAssignedTo("placement", track.id) || !legacyClassMatchesSubject)) return false
    if (["enrollment_processing", "registered"].includes(target)) return false
    return true
  }

  const canResolve = permissions.canManage
    && !conflictState
    && !directorRefreshPending
    && !reviewRefreshPending
    && !detail.migrationLegacy?.snapshotMissing
    && (!requiresExplicitAssignments || groups.every((group) => Boolean(assignments[group.key])))
    && reviewTracks.every(targetIsValid)

  async function saveDirector(track: OpsRegistrationTrackSummary) {
    const directorProfileId = directorIds[track.id] || ""
    if (
      !permissions.canManage
      || directorRefreshPending
      || !directorProfileId
      || !availableDirectors.some((profile) => profile.id === directorProfileId)
      || savingDirectorId
      || conflictState
    ) return
    const attemptedDirector = {
      trackId: track.id,
      profileId: directorProfileId,
      label: availableDirectors.find((profile) => profile.id === directorProfileId)?.label || directorProfileId,
    }
    const kind = "migration-director"
    const migrationDirectorEntityKey = JSON.stringify({
      trackId: track.id,
      directorProfileId,
      commonRevision: detail.commonRevision,
    })
    const requestKey = submissionKeys.getOrCreate(kind, migrationDirectorEntityKey)
    setSavingDirectorId(track.id)
    try {
      await assignRegistrationTrackDirector({
        trackId: track.id,
        directorProfileId,
        assignmentSource: "manual",
        ruleKey: null,
        expectedCommonRevision: detail.commonRevision,
        requestKey,
      })
      submissionKeys.clear(kind, migrationDirectorEntityKey)
      onConflictStateChange(null)
      onDirtyChange?.("director", false)
      setDirectorRefreshPending(true)
      try {
        await onResolved()
        setDirectorRefreshPending(false)
      } catch {
        onWarning(COMMITTED_REFRESH_ERROR)
      }
    } catch (error) {
      const message = errorMessage(error, "상담 책임자를 저장하지 못했습니다.")
      if (message.includes("registration_common_revision_conflict")) {
        submissionKeys.clear(kind, migrationDirectorEntityKey)
        const nextConflict: RegistrationMigrationConflictState = {
          kind: "director",
          taskId: detail.task.id,
          comparison: beginRegistrationConflictComparison(attemptedDirector),
        }
        onConflictStateChange(nextConflict)
        try {
          await onResolved()
          onConflictStateChange({
            ...nextConflict,
            comparison: settleRegistrationConflictComparison(nextConflict.comparison, { succeeded: true }),
          })
          onWarning("다른 사용자가 상담 책임자를 변경했습니다. 내 선택과 최신 저장 담당자를 비교하세요.")
        } catch {
          const refreshMessage = "다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다."
          onConflictStateChange({
            ...nextConflict,
            comparison: settleRegistrationConflictComparison(nextConflict.comparison, { succeeded: false, error: refreshMessage }),
          })
          onWarning("다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다.")
        }
      } else if (isRegistrationDirectorCatalogRefreshError(message)) {
        setCatalogRefreshRequired(true)
        onWarning("담당자 기준이 변경되었습니다. 담당자 정보를 다시 불러오세요.")
      } else {
        onWarning(message)
      }
    } finally {
      setSavingDirectorId("")
    }
  }

  async function retryDirectorCatalog() {
    if (!onRetryDirectorCatalog || catalogRefreshing || directorRefreshPending) return
    setCatalogRefreshing(true)
    try {
      const refreshed = await onRetryDirectorCatalog()
      if (refreshed === false) {
        onWarning("최신 담당자 정보를 불러오지 못했습니다. 다시 시도하세요.")
        return
      }
      setCatalogRefreshRequired(false)
    } catch (error) {
      onWarning(errorMessage(error, "최신 담당자 정보를 불러오지 못했습니다. 다시 시도하세요."))
    } finally {
      setCatalogRefreshing(false)
    }
  }

  async function retryDirectorRefresh() {
    if (savingDirectorId) return
    setSavingDirectorId("refresh")
    try {
      await onResolved()
      setDirectorRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSavingDirectorId("")
    }
  }

  async function retryResolutionRefresh() {
    if (saving || savingDirectorId) return
    setSaving(true)
    try {
      await onResolved()
      setReviewRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  async function resolveReview() {
    if (!canResolve || saving || reviewRefreshPending) return
    const payloadAssignments: RegistrationMigrationAssignment[] = requiresExplicitAssignments
      ? groups.map((group) => ({
        group: group.key,
        trackId: assignments[group.key] === "common" ? null : assignments[group.key],
        preserveAsCommonHistory: assignments[group.key] === "common",
      }))
      : []
    const trackStates: RegistrationMigrationTrackState[] = reviewTracks.map((track) => ({
      trackId: track.id,
      targetStatus: targetStates[track.id] as RegistrationMigrationTrackState["targetStatus"],
      ...(targetStates[track.id] === "waiting" ? { waitingKind: waitingKinds[track.id] as Exclude<RegistrationWaitingKind, ""> } : {}),
      ...(targetStates[track.id] === "waiting" && waitingKinds[track.id] === "current_class" ? { classId: classIds[track.id] } : {}),
      ...(["enrollment_decided", "enrollment_processing", "registered"].includes(targetStates[track.id] || "")
        ? { classId: detail.migrationLegacy?.classId || "" }
        : {}),
    }))
    const kind = "migration-review"
    const migrationReviewEntityKey = JSON.stringify({
      taskId: detail.task.id,
      commonRevision: detail.commonRevision,
      assignments: payloadAssignments,
      trackStates,
    })
    const requestKey = submissionKeys.getOrCreate(kind, migrationReviewEntityKey)
    const attemptedReview: RegistrationMigrationConflictAttempt = {
      assignments: { ...assignments },
      targetStates: { ...targetStates },
      waitingKinds: { ...waitingKinds },
      classIds: { ...classIds },
      summaryLines: [
        ...groups.map((group) => {
          const targetId = requiresExplicitAssignments ? assignments[group.key] : reviewTracks[0]?.id
          const targetLabel = targetId === "common"
            ? "공통 이력"
            : reviewTracks.find((item) => item.id === targetId)?.subject || "선택 안 함"
          return `${group.label}: ${targetLabel}`
        }),
        ...reviewTracks.map((item) => {
          const target = targetStates[item.id]
          if (!target) return `${item.subject}: 단계 선택 안 함`
          if (target !== "waiting") return `${item.subject}: ${STATUS_LABELS[target]}`
          const waitingKind = WAITING_KIND_OPTIONS.find((option) => option.value === waitingKinds[item.id])?.label || "대기 종류 선택 안 함"
          const classLabel = classOptions.find((option) => option.id === classIds[item.id])?.label
          return `${item.subject}: ${STATUS_LABELS[target]} · ${waitingKind}${classLabel ? ` · ${classLabel}` : ""}`
        }),
      ],
    }

    setSaving(true)
    try {
      await resolveRegistrationMigrationReview({
        taskId: detail.task.id,
        assignments: payloadAssignments,
        trackStates,
        requestKey,
      })
      submissionKeys.clear(kind, migrationReviewEntityKey)
      onConflictStateChange(null)
      onDirtyChange?.("review", false)
      setReviewRefreshPending(true)
      try {
        await onResolved()
        setReviewRefreshPending(false)
      } catch {
        onWarning(COMMITTED_REFRESH_ERROR)
      }
    } catch (error) {
      const message = errorMessage(error, "과목 분리 확인을 저장하지 못했습니다.")
      if (message.includes("registration_common_revision_conflict")) {
        submissionKeys.clear(kind, migrationReviewEntityKey)
        const nextConflict: RegistrationMigrationConflictState = {
          kind: "review",
          taskId: detail.task.id,
          comparison: beginRegistrationConflictComparison(attemptedReview),
        }
        onConflictStateChange(nextConflict)
        try {
          await onResolved()
          onConflictStateChange({
            ...nextConflict,
            comparison: settleRegistrationConflictComparison(nextConflict.comparison, { succeeded: true }),
          })
          onWarning("다른 사용자가 등록 정보를 변경했습니다. 내 분리안과 최신 저장 상태를 비교하세요.")
        } catch {
          const refreshMessage = "다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다."
          onConflictStateChange({
            ...nextConflict,
            comparison: settleRegistrationConflictComparison(nextConflict.comparison, { succeeded: false, error: refreshMessage }),
          })
          onWarning("다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다.")
        }
      } else {
        onWarning(message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Alert role="region" className="border-amber-300 bg-amber-50/50 text-amber-950" aria-label="과목 분리 확인 필요">
      <AlertTitle className="text-amber-950">과목 분리 확인 필요</AlertTitle>
      <AlertDescription className="grid min-w-0 justify-items-stretch gap-4 text-amber-950">
        <p className="text-xs text-amber-900/75">기존 공통 기록을 한 과목에만 귀속하거나 공통 이력으로 남겨야 다음 업무를 진행할 수 있습니다.</p>
      <RegistrationRefreshRecovery pending={directorRefreshPending} retrying={Boolean(savingDirectorId)} onRetry={() => void retryDirectorRefresh()} ownerLabel={reviewSubjectLabel} />
      <RegistrationRefreshRecovery pending={reviewRefreshPending} retrying={saving} onRetry={() => void retryResolutionRefresh()} ownerLabel={reviewSubjectLabel} />

      {detail.migrationLegacy?.snapshotMissing ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive">
          기존 등록 이력 원본을 찾을 수 없습니다. 데이터 전환 상태를 확인하세요.
        </p>
      ) : null}

      {!requiresExplicitAssignments && groups.length > 0 ? (
        <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
          단일 과목 이력은 해당 과목에 자동으로 연결됩니다.
        </p>
      ) : null}

      {requiresExplicitAssignments ? groups.map((group) => (
        <div key={group.key} className="grid min-w-0 gap-1.5 rounded-md border bg-background p-3">
          <Label htmlFor={`migration-${group.key}`} className="text-sm font-medium">{group.label}</Label>
          <p className="truncate text-xs text-muted-foreground">{legacyText(detail.migrationLegacy, group.fields)}</p>
          <RegistrationSelect
            id={`migration-${group.key}`}
            aria-label={`${group.label} 귀속 대상 선택`}
            className="h-9"
            value={assignments[group.key] || ""}
            placeholder="귀속 대상 선택"
            options={[
              { value: "", label: "귀속 대상 선택" },
              ...reviewTracks.map((track) => ({ value: track.id, label: track.subject })),
              { value: "common", label: "공통 이력만 유지" },
            ]}
            onValueChange={(value) => setAssignments((current) => ({ ...current, [group.key]: value }))}
            disabled={Boolean(conflictState) || reviewRefreshPending || !permissions.canManage || saving}
          />
        </div>
      )) : null}

      {reviewTracks.map((track) => {
        const target = targetStates[track.id] || ""
        const waitingKind = waitingKinds[track.id] || ""
        return (
          <div key={track.id} className="grid min-w-0 gap-3 rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{track.subject}</h4>
              <Badge variant="outline">검토 필요</Badge>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[1fr_auto]">
              <Label className="grid gap-1.5">
                상담 책임자
                <RegistrationSelect
                  aria-label={`${track.subject} 상담 책임자 선택`}
                  className="h-9"
                  value={directorIds[track.id] || ""}
                  placeholder="원장 선택"
                  options={[
                    { value: "", label: "원장 선택" },
                    ...(directorIds[track.id] && !availableDirectors.some((profile) => profile.id === directorIds[track.id])
                      ? [{ value: directorIds[track.id], label: "활성 담당자 다시 선택", disabled: true }]
                      : []),
                    ...availableDirectors.map((profile) => ({ value: profile.id, label: profile.label })),
                  ]}
                  onValueChange={(value) => setDirectorIds((current) => ({ ...current, [track.id]: value }))}
                  disabled={Boolean(conflictState) || directorRefreshPending || !permissions.canManage || savingDirectorId === track.id}
                />
              </Label>
              <Button type="button" aria-label={`${track.subject} 상담 책임자 저장`} variant="outline" size="sm" className="self-end" onClick={() => void saveDirector(track)} disabled={Boolean(conflictState) || directorRefreshPending || !permissions.canManage || !availableDirectors.some((profile) => profile.id === directorIds[track.id]) || Boolean(savingDirectorId)}>
                책임자 저장
              </Button>
            </div>
            <Label className="grid gap-1.5">
              확인 후 단계
              <RegistrationSelect
                aria-label={`${track.subject} 확인 후 단계`}
                className="h-9"
                value={target}
                placeholder="단계 선택"
                options={[
                  { value: "", label: "단계 선택" },
                  { value: "inquiry", label: "문의" },
                  { value: "level_test_scheduled", label: "레벨테스트 예약", disabled: !groupIsAssignedTo("level_test", track.id) || !hasLevelTestReservation },
                  { value: "consultation_waiting", label: "전화상담 대기", disabled: !track.directorProfileId },
                  { value: "visit_consultation_scheduled", label: "방문상담 예약", disabled: !track.directorProfileId || !groupIsAssignedTo("consultation", track.id) || !hasVisitReservation },
                  { value: "waiting", label: "대기" },
                  { value: "enrollment_decided", label: "등록 결정" },
                  { value: "enrollment_processing", label: "등록 처리 (증빙 확인 필요)", disabled: true },
                  { value: "registered", label: "등록 완료 (증빙 확인 필요)", disabled: true },
                  { value: "not_registered", label: "미등록 완료" },
                  { value: "inquiry_closed", label: "문의 완료" },
                ]}
                onValueChange={(value) => setTargetStates((current) => ({ ...current, [track.id]: value as ReviewTargetState }))}
                disabled={Boolean(conflictState) || reviewRefreshPending || !permissions.canManage || saving}
              />
            </Label>
            {target === "level_test_scheduled" && !hasLevelTestReservation ? <p className="text-xs text-amber-900">예약 정보가 불완전해 새 예약이 필요합니다.</p> : null}
            {target === "visit_consultation_scheduled" && !hasVisitReservation ? <p className="text-xs text-amber-900">방문상담 예약 정보가 불완전해 새 예약이 필요합니다.</p> : null}
            {target === "waiting" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <RegistrationSelect
                  aria-label={`${track.subject} 대기 종류`}
                  className="h-9"
                  value={waitingKind}
                  placeholder="대기 종류 선택"
                  options={[
                    { value: "", label: "대기 종류 선택" },
                    ...WAITING_KIND_OPTIONS,
                  ]}
                  onValueChange={(value) => setWaitingKinds((current) => ({ ...current, [track.id]: value as RegistrationWaitingKind }))}
                  disabled={Boolean(conflictState) || reviewRefreshPending || saving}
                />
                {waitingKind === "current_class" ? <SubjectClassSelect subject={track.subject} value={classIds[track.id] || ""} onChange={(value) => setClassIds((current) => ({ ...current, [track.id]: value }))} classOptions={classOptions} disabled={Boolean(conflictState) || reviewRefreshPending || saving} /> : null}
              </div>
            ) : null}
          </div>
        )
      })}

      {permissions.canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          {catalogRefreshRequired ? (
            <Button type="button" variant="outline" aria-label={`${reviewSubjectLabel} 담당자 정보 다시 불러오기`} onClick={() => void retryDirectorCatalog()} disabled={directorRefreshPending || !onRetryDirectorCatalog || catalogRefreshing}>
              담당자 정보 다시 불러오기
            </Button>
          ) : null}
          <Button type="button" aria-label={`${reviewSubjectLabel} 과목 분리 확인 저장`} onClick={() => void resolveReview()} disabled={Boolean(conflictState) || reviewRefreshPending || !canResolve || saving || Boolean(savingDirectorId)}>
            과목 분리 확인 저장
          </Button>
        </div>
      ) : null}
      </AlertDescription>
    </Alert>
  )
}
