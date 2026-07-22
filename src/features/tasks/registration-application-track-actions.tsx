"use client"

import { useEffect, useMemo, useRef, useState, type JSX } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  RegistrationInquiryCommonFields,
  type RegistrationInquiryFieldName,
} from "./registration-application-inquiry-fields"
import { getRegistrationSchoolChoices } from "./registration-school-options"
import { RegistrationSubjectPicker } from "./registration-subject-picker"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import { getRegistrationSubjectPickerAvailability } from "./registration-intake-workflow"
import { sortAcademicSubjects } from "../../lib/academic-subject-registry.ts"
import type {
  OpsClassOption,
  OpsProfileOption,
  OpsSchoolOption,
  OpsTask,
  OpsTeacherOption,
  OpsTextbookOption,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import {
  beginRegistrationConflictComparison,
  getRegistrationCommonConflictRows,
  reconcileRegistrationEditorDraft,
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
import { isValidRegistrationMobilePhone } from "./registration-workflow"
import {
  assignRegistrationTrackDirector,
  completeRegistrationConsultation,
  createRegistrationMutationRequestKey,
  reopenRegistrationTrack,
  resolveRegistrationMigrationReview,
  routeRegistrationInquiry,
  syncRegistrationCaseSubjects,
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
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <span>{COMMITTED_REFRESH_ERROR}</span>
      <Button type="button" size="sm" variant="outline" aria-label={`${ownerLabel ? `${ownerLabel} ` : ""}최신 내용 다시 불러오기`} onClick={onRetry} disabled={retrying}>최신 내용 다시 불러오기</Button>
    </div>
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
        <div role="alert" className="grid w-full gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
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
        </div>
      ) : null}
      <Label className="grid min-w-[13rem] flex-1 gap-1 text-xs text-muted-foreground">
        상담 책임자
        {canEdit ? (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
            aria-label={`${track.subject} 상담 책임자 선택`}
            value={directorProfileId}
            onChange={(event) => {
              setManualDirectorConflictAttempt(null)
              setDirectorDraft({
                trackId: track.id,
                baselineProfileId: serverDirectorProfileId,
                value: event.target.value,
              })
            }}
            disabled={Boolean(manualDirectorConflictAttempt) || directorSelectorLocked || savingManual || automaticSaving}
          >
            <option value="">원장 선택</option>
            {currentOptionMissing ? <option value={track.directorProfileId || ""}>{track.directorName || "현재 담당 원장"}</option> : null}
            {availableDirectors.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
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

const LEVEL_TEST_STATUS_LABELS: Record<OpsRegistrationCaseDetail["levelTests"][number]["status"], string> = {
  scheduled: "예약",
  in_progress: "진행",
  completed: "완료",
  absent: "미응시",
  canceled: "취소",
}

const CONSULTATION_STATUS_LABELS: Record<OpsRegistrationConsultation["status"], string> = {
  waiting: "대기",
  scheduled: "예약",
  completed: "완료",
  canceled: "취소",
}

const CONSULTATION_OUTCOME_LABELS: Record<NonNullable<OpsRegistrationConsultation["outcome"]>, string> = {
  enrollment: "등록",
  waiting: "대기",
  not_registered: "미등록",
}

export function RegistrationLevelTestSummary({
  detail,
  trackId,
}: {
  detail: OpsRegistrationCaseDetail
  trackId: string | null
}) {
  return (
    <div className="grid gap-2">
      {detail.tracks.filter((track) => track.id === trackId).map((track) => {
        const attempt = detail.levelTests
          .filter((item) => item.trackId === track.id)
          .reduce<OpsRegistrationCaseDetail["levelTests"][number] | null>((latest, item) => (
            !latest || item.attemptNumber > latest.attemptNumber ? item : latest
          ), null)
        const appointment = attempt
          ? detail.appointments.find((item) => item.id === attempt.appointmentId) || null
          : null
        return (
          <div key={track.id} className="grid gap-1 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Badge variant="outline" className="w-fit">{track.subject}</Badge>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {appointment ? `${formatRegistrationDateTime(appointment.scheduledAt)} · ${appointment.place || "장소 미정"}` : "아직 입력 없음"}
            </span>
            <span className="text-xs text-muted-foreground">{attempt ? LEVEL_TEST_STATUS_LABELS[attempt.status] : "미진행"}</span>
            {attempt?.materialLink ? <a className="text-xs text-primary underline-offset-4 hover:underline sm:col-start-2" href={attempt.materialLink} target="_blank" rel="noreferrer">시험지·결과지 열기</a> : null}
          </div>
        )
      })}
    </div>
  )
}

export function RegistrationConsultationSummary({
  detail,
  trackId,
}: {
  detail: OpsRegistrationCaseDetail
  trackId: string | null
}) {
  return (
    <div className="grid gap-2">
      {detail.tracks.filter((track) => track.id === trackId).map((track) => {
        const consultation = detail.consultations
          .filter((item) => item.trackId === track.id)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null
        const appointment = consultation?.appointmentId
          ? detail.appointments.find((item) => item.id === consultation.appointmentId) || null
          : null
        const time = consultation?.mode === "phone"
          ? consultation.readyAt || consultation.completedAt || ""
          : appointment?.scheduledAt || consultation?.completedAt || ""
        const mode = consultation?.mode === "phone" ? "전화상담" : consultation ? "방문상담" : "상담"
        return (
          <div key={track.id} className="grid gap-1 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Badge variant="outline" className="w-fit">{track.subject}</Badge>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {track.directorName ? `${track.directorName} · ` : ""}{consultation ? `${mode} ${formatRegistrationDateTime(time)}` : "아직 입력 없음"}
            </span>
            <span className="text-xs text-muted-foreground">
              {consultation ? (consultation.outcome ? CONSULTATION_OUTCOME_LABELS[consultation.outcome] : CONSULTATION_STATUS_LABELS[consultation.status]) : "미진행"}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function RegistrationPlacementSummary({
  detail,
  classes,
  trackId,
}: {
  detail: OpsRegistrationCaseDetail
  classes: OpsClassOption[]
  trackId: string | null
}) {
  return (
    <div className="grid gap-2">
      {detail.tracks.filter((track) => track.id === trackId).map((track) => {
        const enrollments = detail.enrollments.filter((item) => item.trackId === track.id && item.status !== "canceled")
        const classNames = enrollments
          .map((enrollment) => classes.find((item) => item.id === enrollment.classId)?.label || enrollment.classId)
          .join(", ")
        const waitingLabel = WAITING_KIND_OPTIONS.find((option) => option.value === track.waitingKind)?.label || ""
        return (
          <div key={track.id} className="grid gap-1 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Badge variant="outline" className="w-fit">{track.subject}</Badge>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{classNames || waitingLabel || "아직 입력 없음"}</span>
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[track.status]}</span>
          </div>
        )
      })}
    </div>
  )
}

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

function toLocalDateTime(value: string | undefined) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const local = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  if (local && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return local[1]
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return local?.[1] || ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatRegistrationInquiryAt(value: string) {
  if (!value) return "기록된 문의 일시가 없습니다"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
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

export type RegistrationCommonDraft = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  campus: string
  inquiryAt: string
  requestNote: string
  priority: string
}

const REGISTRATION_COMMON_FIELD_LABELS: Record<keyof RegistrationCommonDraft, string> = {
  studentName: "학생명",
  schoolGrade: "학년",
  schoolName: "학교",
  parentPhone: "학부모 전화",
  studentPhone: "학생 전화",
  campus: "캠퍼스",
  inquiryAt: "문의 일시",
  requestNote: "요청 사항",
  priority: "우선순위",
}

export type RegistrationCommonSaveOutcome = "saved" | "conflict"

export function RegistrationCommonInfoSection({
  task,
  commonRevision,
  identityLocked,
  canEdit,
  schools = [],
  schoolCatalogStatus = "loading",
  schoolCatalogError = "",
  onRetrySchools,
  embedded = false,
  onSave,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  task: OpsTask
  commonRevision: number
  identityLocked: boolean
  canEdit: boolean
  schools?: OpsSchoolOption[]
  schoolCatalogStatus?: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  onRetrySchools?: () => void
  embedded?: boolean
  onSave: (draft: RegistrationCommonDraft, requestKey: string) => Promise<RegistrationCommonSaveOutcome>
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const registration = task.registration || {}
  const canonicalDraft: RegistrationCommonDraft = {
    studentName: task.studentName || "",
    schoolGrade: registration.schoolGrade || "",
    schoolName: registration.schoolName || "",
    parentPhone: registration.parentPhone || "",
    studentPhone: registration.studentPhone || "",
    campus: task.campus || "본관",
    inquiryAt: toLocalDateTime(registration.inquiryAt || task.createdAt),
    requestNote: registration.requestNote || "",
    priority: task.priority || "normal",
  }
  const [draft, setDraft] = useState<RegistrationCommonDraft>(() => canonicalDraft)
  const canonicalDraftKey = `${task.id}:${commonRevision}`
  const canonicalDraftValue = JSON.stringify(canonicalDraft)
  const canonicalDraftKeyRef = useRef(canonicalDraftKey)
  const submissionKeys = useSubmissionKeys()
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const [conflictAttempt, setConflictAttempt] = useState<RegistrationConflictComparison<RegistrationCommonDraft> | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(canonicalDraft) || Boolean(conflictAttempt)
  useOwnedDirtyState(dirty && !refreshPending, onDirtyChange)
  useEffect(() => {
    setDraft((current) => {
      const reconciled = reconcileRegistrationEditorDraft({
        currentDraft: current,
        previousCanonicalKey: canonicalDraftKeyRef.current,
        nextCanonicalKey: canonicalDraftKey,
        nextCanonicalDraft: JSON.parse(canonicalDraftValue) as RegistrationCommonDraft,
      })
      canonicalDraftKeyRef.current = reconciled.canonicalKey
      return reconciled.draft
    })
  }, [canonicalDraftKey, canonicalDraftValue])
  const valid = Boolean(
    draft.studentName.trim()
    && draft.schoolGrade.trim()
    && isValidRegistrationMobilePhone(draft.parentPhone)
    && draft.campus.trim()
    && draft.inquiryAt,
  )
  const conflictRows = conflictAttempt?.latestReady
    ? getRegistrationCommonConflictRows({
        attempted: conflictAttempt.attempted,
        latest: canonicalDraft,
        labels: REGISTRATION_COMMON_FIELD_LABELS,
      })
    : []

  function update<K extends keyof RegistrationCommonDraft>(field: K, value: RegistrationCommonDraft[K]) {
    setValidationError("")
    setConflictAttempt(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateSchoolGrade(nextGrade: string) {
    const catalogChoices = getRegistrationSchoolChoices({ schools, grade: nextGrade })
    setValidationError("")
    setConflictAttempt(null)
    setDraft((current) => ({
      ...current,
      schoolGrade: nextGrade,
      schoolName: identityLocked || schoolCatalogStatus !== "authoritative"
        ? current.schoolName
        : catalogChoices.some((choice) => choice.value === current.schoolName)
          ? current.schoolName
          : "",
    }))
  }

  function updateInquiryField(field: RegistrationInquiryFieldName, value: string) {
    if (field === "schoolGrade") {
      updateSchoolGrade(value)
      return
    }
    update(field, value)
  }

  async function submit() {
    if (!canEdit || saving || refreshPending || conflictAttempt) return
    if (!valid) {
      setValidationError("필수 문의 정보를 확인하고 올바르게 입력하세요.")
      const invalidField = !draft.studentName.trim()
        ? "student-name"
        : !draft.schoolGrade.trim()
          ? "school-grade"
          : !isValidRegistrationMobilePhone(draft.parentPhone)
            ? "parent-phone"
            : "student-name"
      focusFirstInvalid(sectionRef.current, `[data-common-field="${invalidField}"]`)
      return
    }
    const kind = "registration-common"
    const commonPayloadKey = JSON.stringify({
      taskId: task.id,
      commonRevision,
      studentName: draft.studentName.trim(),
      schoolGrade: draft.schoolGrade.trim(),
      schoolName: draft.schoolName.trim(),
      parentPhone: draft.parentPhone.trim(),
      studentPhone: draft.studentPhone.trim(),
      campus: draft.campus.trim(),
      inquiryAt: draft.inquiryAt,
      requestNote: draft.requestNote.trim(),
      priority: draft.priority,
    })
    const requestKey = submissionKeys.getOrCreate(kind, commonPayloadKey)
    const attemptedDraft = { ...draft }
    setSaving(true)
    try {
      const outcome = await onSave(attemptedDraft, requestKey)
      submissionKeys.clear(kind, commonPayloadKey)
      if (outcome === "conflict") {
        const comparison = beginRegistrationConflictComparison(attemptedDraft)
        setConflictAttempt(comparison)
        try {
          await onReload()
          setConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: true }))
          onWarning("다른 사용자가 공통 정보를 변경했습니다. 내 입력과 최신 저장 값을 비교하세요.")
        } catch {
          const refreshMessage = "다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다."
          setConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: false, error: refreshMessage }))
          onWarning(refreshMessage)
        }
      } else {
        setConflictAttempt(null)
        onDirtyChange?.(false)
        setRefreshPending(true)
        try {
          await onReload()
          setRefreshPending(false)
        } catch {
          onWarning(COMMITTED_REFRESH_ERROR)
        }
      }
    } catch (error) {
      const message = errorMessage(error, "공통 정보를 저장하지 못했습니다.")
      onWarning(message)
    } finally {
      setSaving(false)
    }
  }

  async function retryConflictRefresh() {
    if (saving || !conflictAttempt) return
    setSaving(true)
    try {
      await onReload()
      setConflictAttempt((current) => current
        ? settleRegistrationConflictComparison(current, { succeeded: true })
        : current)
    } catch (error) {
      const refreshMessage = errorMessage(error, "최신 공통 정보를 다시 불러오지 못했습니다.")
      setConflictAttempt((current) => current
        ? settleRegistrationConflictComparison(current, { succeeded: false, error: refreshMessage })
        : current)
      onWarning(refreshMessage)
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
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={sectionRef} className={embedded ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 rounded-md border p-3"} aria-label="등록 공통 정보">
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} />
      {conflictAttempt ? (
        <div role="alert" className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div>
            <div className="font-semibold">다른 사용자가 공통 정보를 먼저 저장했습니다.</div>
            <p className="text-xs">내가 입력한 값과 최신 저장 값을 확인한 뒤 사용할 내용을 선택하세요.</p>
          </div>
          {!conflictAttempt.latestReady ? (
            <div className="grid gap-2">
              <p className="text-xs">내 입력은 보존했습니다. 최신 저장 값을 불러온 뒤 비교할 수 있습니다.</p>
              {conflictAttempt.refreshError ? <p className="text-xs">{conflictAttempt.refreshError}</p> : null}
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => void retryConflictRefresh()} disabled={saving}>최신 정보 다시 불러오기</Button>
              </div>
            </div>
          ) : conflictRows.length > 0 ? (
            <div className="grid gap-2">
              {conflictRows.map((row) => (
                <dl key={row.field} className="grid gap-1 rounded-md border border-amber-200 bg-background p-2 sm:grid-cols-2">
                  <div><dt className="text-xs font-medium">{row.label} · 내가 입력한 값</dt><dd className="break-words">{row.attempted || "입력 없음"}</dd></div>
                  <div><dt className="text-xs font-medium">{row.label} · 최신 저장 값</dt><dd className="break-words">{row.latest || "입력 없음"}</dd></div>
                </dl>
              ))}
            </div>
          ) : <p className="text-xs">표시할 값 차이가 없습니다. 최신 값을 사용하세요.</p>}
          {conflictAttempt.latestReady ? <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setDraft({ ...canonicalDraft })
              setConflictAttempt(null)
            }}>최신 값 사용</Button>
            <Button type="button" size="sm" onClick={() => {
              setDraft({ ...conflictAttempt.attempted })
              setConflictAttempt(null)
              focusFirstInvalid(sectionRef.current, "[data-common-field]")
            }}>내 입력 다시 적용</Button>
          </div> : null}
        </div>
      ) : null}
      {!embedded || identityLocked ? <div className="flex flex-wrap items-center justify-between gap-2">
        {!embedded ? <h3 className="text-sm font-semibold">등록 공통 정보</h3> : null}
        {identityLocked ? <Badge variant="secondary">학생 연결 보정 필요</Badge> : null}
      </div> : null}
      <RegistrationInquiryCommonFields
        values={draft}
        inquiryAtLabel={formatRegistrationInquiryAt(draft.inquiryAt)}
        schoolChoices={getRegistrationSchoolChoices({
          schools,
          grade: draft.schoolGrade,
          currentSchoolName: draft.schoolName,
        })}
        schoolCatalogStatus={schoolCatalogStatus}
        schoolCatalogError={schoolCatalogError}
        disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
        disabledFields={{
          studentName: identityLocked,
          schoolName: identityLocked,
          parentPhone: identityLocked,
          studentPhone: identityLocked,
        }}
        onChange={updateInquiryField}
        onRetrySchools={onRetrySchools}
      />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => void submit()} disabled={saving || refreshPending || Boolean(conflictAttempt)}>
            공통 정보 저장
          </Button>
        </div>
      ) : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </section>
  )
}

export function RegistrationSubjectSyncSection({
  detail,
  canManage,
  subjectCapabilities,
  embedded = false,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  detail: OpsRegistrationCaseDetail
  canManage: boolean
  subjectCapabilities: readonly RegistrationSubjectCapability[]
  embedded?: boolean
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [subjects, setSubjects] = useState<RegistrationSubject[]>(() => detail.tracks.map((track) => track.subject))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [refreshPending, setRefreshPending] = useState(false)
  const submissionKeys = useSubmissionKeys()
  const removableSubjects = new Set(
    detail.tracks
      .filter((track) => track.status === "inquiry" && !track.migrationReviewRequired)
      .map((track) => track.subject),
  )
  const availability = getRegistrationSubjectPickerAvailability({
    capabilities: subjectCapabilities,
    grade: detail.task.registration?.schoolGrade || "",
    selectedSubjects: subjects,
  })
  const canonicalSubjects = sortAcademicSubjects(detail.tracks.map((track) => track.subject)).join("|")
  const disabledSubjects = new Set(availability.options.filter((subject) => (
    subjects.includes(subject)
    && (!removableSubjects.has(subject) || subjects.length === 1 || Boolean(availability.disabledReasonBySubject[subject]))
  )))
  useOwnedDirtyState(!refreshPending && sortAcademicSubjects(subjects).join("|") !== canonicalSubjects, onDirtyChange)

  function toggle(subject: RegistrationSubject, selected: boolean) {
    setSubjects((current) => selected
      ? sortAcademicSubjects([...current, subject]) as RegistrationSubject[]
      : current.filter((value) => value !== subject))
  }

  async function submit() {
    if (!canManage || saving || subjects.length === 0) return
    const kind = "registration-subjects"
    const subjectPayloadKey = JSON.stringify({
      taskId: detail.task.id,
      subjects: sortAcademicSubjects(subjects),
    })
    const requestKey = submissionKeys.getOrCreate(kind, subjectPayloadKey)
    setSaving(true)
    setError("")
    try {
      await syncRegistrationCaseSubjects({ taskId: detail.task.id, subjects, requestKey })
      submissionKeys.clear(kind, subjectPayloadKey)
      onDirtyChange?.(false)
      setRefreshPending(true)
      try {
        await onReload()
        setRefreshPending(false)
      } catch {
        setError(COMMITTED_REFRESH_ERROR)
        onWarning(COMMITTED_REFRESH_ERROR)
      }
    } catch (cause) {
      const message = errorMessage(cause, "과목 구성을 저장하지 못했습니다.")
      if (message.includes("registration_subject_removal_blocked")) {
        setError("이미 진행 이력이 있는 과목은 삭제할 수 없습니다. 해당 과목을 완료 처리하세요.")
      } else {
        setError(message)
      }
      onWarning(message)
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
      setError("")
    } catch {
      setError("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={embedded ? "grid min-w-0 gap-2" : "grid min-w-0 gap-2 rounded-md border p-3"} aria-label="문의 과목 편집">
      <RegistrationSubjectPicker
        value={subjects}
        options={availability.options}
        grade={detail.task.registration?.schoolGrade || ""}
        disabledReasonBySubject={availability.disabledReasonBySubject}
        disabled={!canManage || saving || refreshPending}
        disabledSubjects={disabledSubjects}
        onToggle={toggle}
        action={canManage && !refreshPending ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={saving || subjects.length === 0}>
            과목 저장
          </Button>
        ) : undefined}
      />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} />
    </section>
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
    <select aria-label={`${subject} 수업 선택`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      <option value="">수업 선택</option>
      {matchingClasses.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
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
    if (destination === "inquiry_closed" && !window.confirm(`[${track.subject}] 문의만 완료 처리할까요?`)) return

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
            <select aria-label={`${track.subject} 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKind(event.target.value as RegistrationWaitingKind)} disabled={saving}>
              {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
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
            <Button type="button" variant="ghost" aria-label={`${track.subject} 문의만 완료`} onClick={() => void route("inquiry_closed")} disabled={saving}>
              문의만 완료
            </Button>
          </div>
        </>
      ) : !refreshPending ? <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 다음 단계를 결정할 수 있습니다.</p> : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
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
    if (action === "close_not_registered" && !window.confirm(`[${track.subject}] 대기를 종료하고 미등록 처리할까요?`)) return

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
            <select aria-label={`${track.subject} 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKind(event.target.value as RegistrationWaitingKind)} disabled={saving}>
              {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
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
            <Button type="button" data-registration-primary-action={`${track.subject}:waiting-close`} aria-label={`${track.subject} 대기 종료 미등록`} variant="ghost" onClick={() => void transition("close_not_registered")} disabled={saving || !reason.trim()}>
              대기 종료 · 미등록
            </Button>
          </div>
        </>
      ) : !refreshPending ? <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 대기 상태를 변경할 수 있습니다.</p> : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
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
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span>{COMMITTED_REFRESH_ERROR}</span>
          <Button type="button" size="sm" variant="outline" aria-label={`${subject} 최신 내용 다시 불러오기`} onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
        </div>
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
                <select aria-label={`${subject} 상담 결과 대기 종류`} className="h-9 rounded-md border bg-background px-3 text-sm" value={draft.waitingKind} onChange={(event) => { setValidationError(""); setDraft((current) => ({ ...current, waitingKind: event.target.value as RegistrationWaitingKind, classId: "" })) }} disabled={saving}>
                  {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
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
    <div role="alert" className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">다른 사용자가 등록 정보를 먼저 저장했습니다.</p>
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
    </div>
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
    <section className="grid min-w-0 gap-4 rounded-md border border-amber-300 bg-amber-50/50 p-3" aria-label="과목 분리 확인 필요">
      <div>
        <h3 className="text-sm font-semibold text-amber-950">과목 분리 확인 필요</h3>
        <p className="text-xs text-amber-900/75">기존 공통 기록을 한 과목에만 귀속하거나 공통 이력으로 남겨야 다음 업무를 진행할 수 있습니다.</p>
      </div>
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
          <select
            id={`migration-${group.key}`}
            aria-label={`${group.label} 귀속 대상 선택`}
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={assignments[group.key] || ""}
            onChange={(event) => setAssignments((current) => ({ ...current, [group.key]: event.target.value }))}
            disabled={Boolean(conflictState) || reviewRefreshPending || !permissions.canManage || saving}
          >
            <option value="">귀속 대상 선택</option>
            {reviewTracks.map((track) => <option key={track.id} value={track.id}>{track.subject}</option>)}
            <option value="common">공통 이력만 유지</option>
          </select>
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
                <select
                  aria-label={`${track.subject} 상담 책임자 선택`}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={directorIds[track.id] || ""}
                  onChange={(event) => setDirectorIds((current) => ({ ...current, [track.id]: event.target.value }))}
                  disabled={Boolean(conflictState) || directorRefreshPending || !permissions.canManage || savingDirectorId === track.id}
                >
                  <option value="">원장 선택</option>
                  {directorIds[track.id] && !availableDirectors.some((profile) => profile.id === directorIds[track.id]) ? (
                    <option value={directorIds[track.id]} disabled>활성 담당자 다시 선택</option>
                  ) : null}
                  {availableDirectors.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </Label>
              <Button type="button" aria-label={`${track.subject} 상담 책임자 저장`} variant="outline" size="sm" className="self-end" onClick={() => void saveDirector(track)} disabled={Boolean(conflictState) || directorRefreshPending || !permissions.canManage || !availableDirectors.some((profile) => profile.id === directorIds[track.id]) || Boolean(savingDirectorId)}>
                책임자 저장
              </Button>
            </div>
            <Label className="grid gap-1.5">
              확인 후 단계
              <select
                aria-label={`${track.subject} 확인 후 단계`}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={target}
                onChange={(event) => setTargetStates((current) => ({ ...current, [track.id]: event.target.value as ReviewTargetState }))}
                disabled={Boolean(conflictState) || reviewRefreshPending || !permissions.canManage || saving}
              >
                <option value="">단계 선택</option>
                <option value="inquiry">문의</option>
                <option value="level_test_scheduled" disabled={!groupIsAssignedTo("level_test", track.id) || !hasLevelTestReservation}>레벨테스트 예약</option>
                <option value="consultation_waiting" disabled={!track.directorProfileId}>전화상담 대기</option>
                <option value="visit_consultation_scheduled" disabled={!track.directorProfileId || !groupIsAssignedTo("consultation", track.id) || !hasVisitReservation}>방문상담 예약</option>
                <option value="waiting">대기</option>
                <option value="enrollment_decided">등록 결정</option>
                <option value="enrollment_processing" disabled>등록 처리 (증빙 확인 필요)</option>
                <option value="registered" disabled>등록 완료 (증빙 확인 필요)</option>
                <option value="not_registered">미등록 완료</option>
                <option value="inquiry_closed">문의 완료</option>
              </select>
            </Label>
            {target === "level_test_scheduled" && !hasLevelTestReservation ? <p className="text-xs text-amber-900">예약 정보가 불완전해 새 예약이 필요합니다.</p> : null}
            {target === "visit_consultation_scheduled" && !hasVisitReservation ? <p className="text-xs text-amber-900">방문상담 예약 정보가 불완전해 새 예약이 필요합니다.</p> : null}
            {target === "waiting" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label={`${track.subject} 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKinds((current) => ({ ...current, [track.id]: event.target.value as RegistrationWaitingKind }))} disabled={Boolean(conflictState) || reviewRefreshPending || saving}>
                  <option value="">대기 종류 선택</option>
                  {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
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
    </section>
  )
}
