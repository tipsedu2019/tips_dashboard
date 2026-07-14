"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import type { OpsClassOption, OpsProfileOption, OpsTask, OpsTeacherOption, OpsTextbookOption } from "./ops-task-service"
import { RegistrationAppointmentEditor } from "./registration-appointment-editor"
import {
  advanceRegistrationAutomaticSavingGeneration,
  resolveRegistrationTrackDirectorDefaults,
  shouldSettleRegistrationAutomaticSavingGeneration,
  type RegistrationDirectorCatalogStatus,
} from "./registration-director-default.js"
import { RegistrationEnrollmentEditor } from "./registration-enrollment-editor"
import { getRegistrationActionPermissions } from "./registration-track-model.js"
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
  updateRegistrationCaseCommon,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationAppointment,
  type OpsRegistrationConsultation,
  type RegistrationAppointmentMutationResponse,
  type OpsRegistrationMigrationLegacySnapshot,
  type OpsRegistrationTrackStatus,
  type OpsRegistrationTrackSummary,
  type RegistrationSubject,
  type RegistrationWaitingKind,
} from "./registration-track-service"

type RegistrationTrackViewerRole = "admin" | "staff" | "assistant" | "teacher" | null

function isRegistrationDirectorCatalogRefreshError(message: string) {
  return message.includes("registration_director_refresh_required")
    || message.includes("registration_director_default_stale")
}

export type RegistrationTrackEditorProps = {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  selectedTrackId: string | null
  viewerId: string | null
  viewerRole: RegistrationTrackViewerRole
  onSelectTrack: (trackId: string) => void
  onReload: (preferredTrackId?: string) => void | Promise<void>
  onWarning: (message: string) => void
  onAppointmentSaved?: (saved: RegistrationAppointmentMutationResponse) => void | Promise<void>
  caseLevelActions?: ReactNode
  directorOptions?: OpsProfileOption[]
  teacherOptions?: OpsTeacherOption[]
  directorCatalogStatus?: RegistrationDirectorCatalogStatus
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  classOptions?: OpsClassOption[]
  textbookOptions?: OpsTextbookOption[]
  consultationOutcomeOpen?: boolean
  onConsultationOutcomeOpenChange?: (open: boolean) => void
  notificationToken?: string
}

function RegistrationTrackDirectorSection({
  task,
  detail,
  track,
  permissions,
  directorOptions,
  teacherOptions,
  directorCatalogStatus,
  onRetryDirectorCatalog,
  onOpenVisit,
  onReload,
  onWarning,
}: {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  directorOptions: OpsProfileOption[]
  teacherOptions: OpsTeacherOption[]
  directorCatalogStatus: RegistrationDirectorCatalogStatus
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  onOpenVisit: (trackId: string) => void
  onReload: (preferredTrackId?: string) => void | Promise<void>
  onWarning: (message: string) => void
}) {
  const activeDirectorProfileIds = useMemo(
    () => new Set(teacherOptions.map((teacher) => teacher.profileId).filter(Boolean)),
    [teacherOptions],
  )
  const availableDirectors = useMemo(
    () => directorOptions.filter((profile) => profile.role === "admin" && activeDirectorProfileIds.has(profile.id)),
    [activeDirectorProfileIds, directorOptions],
  )
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
    catalogStatus: directorCatalogStatus,
  }), [detail.tracks, directorCatalogStatus, directorOptions, task.registration?.inquiryAt, task.registration?.schoolGrade, teacherOptions])
  const automaticActions = useMemo(
    () => resolutions.filter((resolution) => resolution.shouldAssign || resolution.shouldClear),
    [resolutions],
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
        setAutomaticRefreshError("")
        setAutomaticRefreshTrackId("")
      } catch (refreshError) {
        if (!activeRef.current) return
        const refreshMessage = errorMessage(refreshError, "최신 등록 정보를 다시 불러오지 못했습니다.")
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

  async function saveManualDirector() {
    if (!canEdit || !directorProfileId || !selectedDirectorIsAvailable || savingManual || automaticSaving) return
    const logicalKey = `registration-director-manual:${track.id}:${directorProfileId}:${detail.commonRevision}`
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
      await onReload(track.id)
      requestKeysRef.current.delete(logicalKey)
    } catch (error) {
      const message = errorMessage(error, "상담 책임자를 저장하지 못했습니다.")
      if (committed) {
        setAutomaticRefreshError("상담 책임자 저장은 완료했지만 최신 정보를 다시 불러오지 못했습니다.")
        setAutomaticRefreshTrackId(track.id)
        onWarning("상담 책임자 저장은 완료했습니다. 최신 정보를 다시 불러오세요.")
      } else if (message.includes("registration_common_revision_conflict")) {
        try {
          await onReload(track.id)
          onWarning("다른 사용자의 변경을 반영했습니다. 담당 원장을 다시 확인하세요.")
        } catch {
          setAutomaticRefreshError("다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다.")
          setAutomaticRefreshTrackId(track.id)
          onWarning("창을 닫고 다시 열거나 최신 정보 다시 불러오기를 눌러 주세요.")
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
      <Label className="grid min-w-[13rem] flex-1 gap-1 text-xs text-muted-foreground">
        상담 책임자
        {canEdit ? (
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
            value={directorProfileId}
            onChange={(event) => setDirectorDraft({
              trackId: track.id,
              baselineProfileId: serverDirectorProfileId,
              value: event.target.value,
            })}
            disabled={savingManual || automaticSaving}
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
          disabled={!directorProfileId || !selectedDirectorIsAvailable || directorProfileId === (track.directorProfileId || "") || savingManual || automaticSaving}
        >
          담당 저장
        </Button>
      ) : null}
      {automaticSaving ? <span role="status" className="text-xs text-muted-foreground">규칙 확인 중</span> : null}
      {!automaticSaving && directorCatalogStatus === "loading" ? (
        <span role="status" className="text-xs text-muted-foreground">담당자 정보 확인 중</span>
      ) : null}
      {automaticError ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => void retryAutomaticDefaults()} disabled={catalogRefreshing}>
          {catalogRefreshRequired ? "담당자 정보 다시 불러오기" : "자동 배정 다시 시도"}
        </Button>
      ) : null}
      {automaticRefreshError ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => void retryAutomaticRefresh()} disabled={automaticRefreshing}>
          최신 정보 다시 불러오기
        </Button>
      ) : null}
      {catalogNeedsRetry && !automaticError ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => void onRetryDirectorCatalog?.()} disabled={!onRetryDirectorCatalog}>
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

type ActionPermissions = {
  canManage: boolean
  canCompleteConsultation: boolean
  readOnly: boolean
}

type SubmissionKeys = {
  getOrCreate: (kind: string, entityId: string) => string
  clear: (kind: string, entityId: string) => void
}

const SUBJECTS: RegistrationSubject[] = ["영어", "수학"]

const STATUS_LABELS: Record<OpsRegistrationTrackStatus, string> = {
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

type RegistrationApplicationSectionKey = "inquiry" | "level_test" | "consultation" | "placement" | "admission"

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

function getRegistrationApplicationSection(status: OpsRegistrationTrackStatus): RegistrationApplicationSectionKey {
  if (["level_test_scheduled", "level_test_in_progress"].includes(status)) return "level_test"
  if (["consultation_waiting", "visit_consultation_scheduled"].includes(status)) return "consultation"
  if (["enrollment_processing", "registered"].includes(status)) return "admission"
  if (["waiting", "enrollment_decided", "not_registered", "inquiry_closed"].includes(status)) return "placement"
  return "inquiry"
}

function RegistrationApplicationSection({
  sectionKey,
  title,
  active,
  children,
}: {
  sectionKey: RegistrationApplicationSectionKey
  title: string
  active: boolean
  children: ReactNode
}) {
  return (
    <section
      id={`registration-application-${sectionKey}`}
      data-registration-current={active ? "true" : "false"}
      className={[
        "grid min-w-0 gap-3 border-t py-4 first:border-t-0 first:pt-0",
        active ? "-mx-3 border-l-2 border-l-primary bg-primary/5 px-3" : "",
      ].join(" ")}
    >
      <h3 className={active ? "text-sm font-semibold text-primary" : "text-sm font-semibold"}>{title}</h3>
      {children}
    </section>
  )
}

function RegistrationSubjectProgress({
  detail,
  selectedTrackId,
  onSelectTrack,
}: {
  detail: OpsRegistrationCaseDetail
  selectedTrackId: string | null
  onSelectTrack: (trackId: string) => void
}) {
  return (
    <div className="grid min-w-0 gap-2" aria-label="과목별 진행 현황">
      <span className="text-xs font-medium text-muted-foreground">과목별 진행</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {detail.tracks.map((track) => (
          <Button
            key={track.id}
            type="button"
            variant={track.id === selectedTrackId ? "secondary" : "outline"}
            className="h-auto min-w-0 justify-between gap-3 px-3 py-2"
            aria-pressed={track.id === selectedTrackId}
            onClick={() => onSelectTrack(track.id)}
          >
            <span>{track.subject}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{STATUS_LABELS[track.status]}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function RegistrationLevelTestSummary({ detail }: { detail: OpsRegistrationCaseDetail }) {
  return (
    <div className="grid gap-2">
      {detail.tracks.map((track) => {
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
            <span className="min-w-0 truncate">
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

function RegistrationConsultationSummary({ detail }: { detail: OpsRegistrationCaseDetail }) {
  return (
    <div className="grid gap-2">
      {detail.tracks.map((track) => {
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
            <span className="min-w-0 truncate">
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

function RegistrationPlacementSummary({
  detail,
  classes,
}: {
  detail: OpsRegistrationCaseDetail
  classes: OpsClassOption[]
}) {
  return (
    <div className="grid gap-2">
      {detail.tracks.map((track) => {
        const enrollments = detail.enrollments.filter((item) => item.trackId === track.id && item.status !== "canceled")
        const classNames = enrollments
          .map((enrollment) => classes.find((item) => item.id === enrollment.classId)?.label || enrollment.classId)
          .join(", ")
        const waitingLabel = WAITING_KIND_OPTIONS.find((option) => option.value === track.waitingKind)?.label || ""
        return (
          <div key={track.id} className="grid gap-1 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Badge variant="outline" className="w-fit">{track.subject}</Badge>
            <span className="min-w-0 truncate">{classNames || waitingLabel || "아직 입력 없음"}</span>
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[track.status]}</span>
          </div>
        )
      })}
    </div>
  )
}

const REGISTRATION_DIRECTOR_VISIBLE_STATUSES = new Set<OpsRegistrationTrackStatus>([
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

function requiredLabel(label: string, required = false) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className={required ? "text-xs font-semibold text-primary" : "text-xs font-normal text-muted-foreground"}>
        {required ? "필수" : "선택"}
      </span>
    </span>
  )
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

type CommonDraft = {
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

type CommonSaveOutcome = "saved" | "conflict_reloaded"

function RegistrationCommonInfoSection({
  task,
  commonRevision,
  identityLocked,
  canEdit,
  embedded = false,
  onSave,
  onWarning,
}: {
  task: OpsTask
  commonRevision: number
  identityLocked: boolean
  canEdit: boolean
  embedded?: boolean
  onSave: (draft: CommonDraft, requestKey: string) => Promise<CommonSaveOutcome>
  onWarning: (message: string) => void
}) {
  const registration = task.registration || {}
  const [draft, setDraft] = useState<CommonDraft>(() => ({
    studentName: task.studentName || "",
    schoolGrade: registration.schoolGrade || "",
    schoolName: registration.schoolName || "",
    parentPhone: registration.parentPhone || "",
    studentPhone: registration.studentPhone || "",
    campus: task.campus || "본관",
    inquiryAt: toLocalDateTime(registration.inquiryAt || task.createdAt),
    requestNote: registration.requestNote || "",
    priority: task.priority || "normal",
  }))
  const submissionKeys = useSubmissionKeys()
  const [saving, setSaving] = useState(false)
  const valid = Boolean(
    draft.studentName.trim()
    && draft.schoolGrade.trim()
    && isValidRegistrationMobilePhone(draft.parentPhone)
    && draft.campus.trim()
    && draft.inquiryAt,
  )

  function update<K extends keyof CommonDraft>(field: K, value: CommonDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function submit() {
    if (!canEdit || !valid || saving) return
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
    setSaving(true)
    try {
      const outcome = await onSave(draft, requestKey)
      submissionKeys.clear(kind, commonPayloadKey)
      if (outcome === "conflict_reloaded") {
        onWarning("다른 사용자가 공통 정보를 변경했습니다. 최신 정보로 다시 불러왔습니다.")
      }
    } catch (error) {
      const message = errorMessage(error, "공통 정보를 저장하지 못했습니다.")
      onWarning(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={embedded ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 rounded-md border p-3"} aria-label="등록 공통 정보">
      {!embedded || identityLocked ? <div className="flex flex-wrap items-center justify-between gap-2">
        {!embedded ? <h3 className="text-sm font-semibold">등록 공통 정보</h3> : null}
        {identityLocked ? <Badge variant="secondary">학생 연결 보정 필요</Badge> : null}
      </div> : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Label className="grid min-w-0 gap-1.5">
          {requiredLabel("학생명", true)}
          <Input value={draft.studentName} onChange={(event) => update("studentName", event.target.value)} disabled={!canEdit || identityLocked || saving} />
        </Label>
        <Label className="grid min-w-0 gap-1.5">
          {requiredLabel("학년", true)}
          <Input value={draft.schoolGrade} onChange={(event) => update("schoolGrade", event.target.value)} disabled={!canEdit || saving} />
        </Label>
        <Label className="grid min-w-0 gap-1.5">
          {requiredLabel("학교")}
          <Input value={draft.schoolName} onChange={(event) => update("schoolName", event.target.value)} disabled={!canEdit || identityLocked || saving} />
        </Label>
        <Label className="grid min-w-0 gap-1.5">
          {requiredLabel("학부모 전화", true)}
          <Input inputMode="tel" value={draft.parentPhone} onChange={(event) => update("parentPhone", event.target.value)} disabled={!canEdit || identityLocked || saving} />
        </Label>
        <Label className="grid min-w-0 gap-1.5">
          {requiredLabel("학생 전화")}
          <Input inputMode="tel" value={draft.studentPhone} onChange={(event) => update("studentPhone", event.target.value)} disabled={!canEdit || identityLocked || saving} />
        </Label>
        <Label className="grid min-w-0 gap-1.5 sm:col-span-2">
          {requiredLabel("요청 사항")}
          <Textarea value={draft.requestNote} onChange={(event) => update("requestNote", event.target.value)} disabled={!canEdit || saving} rows={3} />
        </Label>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => void submit()} disabled={!valid || saving}>
            공통 정보 저장
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function RegistrationSubjectSyncSection({
  detail,
  canManage,
  embedded = false,
  onReload,
  onWarning,
}: {
  detail: OpsRegistrationCaseDetail
  canManage: boolean
  embedded?: boolean
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
}) {
  const [subjects, setSubjects] = useState<RegistrationSubject[]>(() => detail.tracks.map((track) => track.subject))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submissionKeys = useSubmissionKeys()

  function toggle(subject: RegistrationSubject) {
    setSubjects((current) => current.includes(subject)
      ? current.filter((value) => value !== subject)
      : SUBJECTS.filter((value) => value === subject || current.includes(value)))
  }

  async function submit() {
    if (!canManage || saving || subjects.length === 0) return
    const kind = "registration-subjects"
    const subjectPayloadKey = JSON.stringify({
      taskId: detail.task.id,
      subjects: [...subjects].sort(),
    })
    const requestKey = submissionKeys.getOrCreate(kind, subjectPayloadKey)
    setSaving(true)
    setError("")
    try {
      await syncRegistrationCaseSubjects({ taskId: detail.task.id, subjects, requestKey })
      await onReload()
      submissionKeys.clear(kind, subjectPayloadKey)
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

  return (
    <section className={embedded ? "grid min-w-0 gap-2" : "grid min-w-0 gap-2 rounded-md border p-3"} aria-label="문의 과목 편집">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">문의 과목</h3>
        {canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={saving || subjects.length === 0}>
            과목 저장
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SUBJECTS.map((subject) => (
          <Button
            key={subject}
            type="button"
            variant={subjects.includes(subject) ? "secondary" : "outline"}
            aria-pressed={subjects.includes(subject)}
            onClick={() => toggle(subject)}
            disabled={!canManage || saving || (subjects.length === 1 && subjects.includes(subject))}
          >
            {subject}
          </Button>
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
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
    <select className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
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
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
}) {
  const [waitingKind, setWaitingKind] = useState<RegistrationWaitingKind>("current_term_opening")
  const [classId, setClassId] = useState("")
  const [saving, setSaving] = useState(false)
  const submissionKeys = useSubmissionKeys()

  async function route(destination: "consultation_waiting" | "waiting" | "inquiry_closed") {
    if (saving || !permissions.canManage) return
    if (destination === "consultation_waiting" && !track.directorProfileId) {
      onWarning(`[${track.subject}] 상담 책임자를 먼저 지정하세요.`)
      return
    }
    if (destination === "waiting" && (!waitingKind || (waitingKind === "current_class" && !classId))) {
      onWarning("대기 종류와 필요한 수업을 선택하세요.")
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
      await onReload()
    } catch (error) {
      onWarning(errorMessage(error, "문의 다음 단계를 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 문의 처리`}>
      <div>
        <h3 className="text-sm font-semibold">[{track.subject}] 문의 다음 단계</h3>
        <p className="text-xs text-muted-foreground">과목별로 다음 업무를 선택합니다.</p>
      </div>
      {permissions.canManage ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKind(event.target.value as RegistrationWaitingKind)} disabled={saving}>
              {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {waitingKind === "current_class" ? (
              <SubjectClassSelect subject={track.subject} value={classId} onChange={setClassId} classOptions={classOptions} disabled={saving} />
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={onOpenLevelTest} disabled={saving}>
              레벨테스트 예약
            </Button>
            <Button type="button" variant="outline" onClick={() => void route("consultation_waiting")} disabled={saving || !track.directorProfileId} title={!track.directorProfileId ? "상담 책임자 지정 필요" : undefined}>
              바로 상담
            </Button>
            <Button type="button" variant="outline" onClick={() => void route("waiting")} disabled={saving}>
              대기
            </Button>
            <Button type="button" variant="ghost" onClick={() => void route("inquiry_closed")} disabled={saving}>
              문의만 완료
            </Button>
          </div>
        </>
      ) : <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 다음 단계를 결정할 수 있습니다.</p>}
    </section>
  )
}

function WaitingStageEditor({
  track,
  permissions,
  classOptions,
  onReload,
  onWarning,
  onOpenLevelTest,
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
}) {
  const [waitingKind, setWaitingKind] = useState<RegistrationWaitingKind>(track.waitingKind || "current_term_opening")
  const [classId, setClassId] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const submissionKeys = useSubmissionKeys()

  async function transition(action: "change_waiting_kind" | "record_retest_required" | "move_to_enrollment" | "close_not_registered") {
    if (saving || !permissions.canManage) return
    if (action === "change_waiting_kind" && (!waitingKind || (waitingKind === "current_class" && !classId))) {
      onWarning("대기 종류와 필요한 수업을 선택하세요.")
      return
    }
    if (action === "close_not_registered" && !reason.trim()) {
      onWarning("대기 종료 사유를 입력하세요.")
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
      await onReload()
      if (action === "record_retest_required") onOpenLevelTest()
    } catch (error) {
      onWarning(errorMessage(error, "대기 상태를 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 대기 처리`}>
      <div>
        <h3 className="text-sm font-semibold">[{track.subject}] 대기 관리</h3>
        <p className="text-xs text-muted-foreground">등록 전환 시 레벨테스트 재응시 여부를 반드시 결정합니다.</p>
      </div>
      {permissions.canManage ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKind(event.target.value as RegistrationWaitingKind)} disabled={saving}>
              {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {waitingKind === "current_class" ? <SubjectClassSelect subject={track.subject} value={classId} onChange={setClassId} classOptions={classOptions} disabled={saving} /> : null}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void transition("change_waiting_kind")} disabled={saving}>
            대기 상태 변경
          </Button>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => track.levelTestRetakeDecision === "required" ? onOpenLevelTest() : void transition("record_retest_required")}
              disabled={saving}
            >
              {track.levelTestRetakeDecision === "required" ? "레벨테스트 예약" : "레벨테스트 재응시 필요"}
            </Button>
            <Button type="button" onClick={() => void transition("move_to_enrollment")} disabled={saving}>
              재응시 없이 등록
            </Button>
          </div>
          <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
            <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="미등록 종료 사유" disabled={saving} />
            <Button type="button" variant="ghost" onClick={() => void transition("close_not_registered")} disabled={saving || !reason.trim()}>
              대기 종료 · 미등록
            </Button>
          </div>
        </>
      ) : <p className="text-sm text-muted-foreground">관리 권한이 있는 사용자만 대기 상태를 변경할 수 있습니다.</p>}
    </section>
  )
}

function TerminalStageEditor({
  track,
  permissions,
  onReload,
  onWarning,
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const submissionKeys = useSubmissionKeys()

  async function reopen(destination: "inquiry" | "consultation_waiting") {
    if (!permissions.canManage || saving || !reason.trim()) return
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
      await onReload()
    } catch (error) {
      onWarning(errorMessage(error, "완료된 과목을 다시 열지 못했습니다."))
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
      {permissions.canManage ? (
        <>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="재개 사유" disabled={saving} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => void reopen("inquiry")} disabled={saving || !reason.trim()}>
              문의로 다시 열기
            </Button>
            <Button type="button" onClick={() => void reopen("consultation_waiting")} disabled={saving || !reason.trim() || !track.directorProfileId} title={!track.directorProfileId ? "상담 책임자 지정 필요" : undefined}>
              전화상담으로 다시 열기
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

function RegistrationTrackStageEditor({
  track,
  permissions,
  classOptions,
  onReload,
  onWarning,
  onOpenLevelTest,
  onOpenLevelTestHistory,
  onOpenVisit,
  onOpenOutcome,
  hasLevelTestHistory,
  activeConsultation,
  visitAppointment,
}: {
  track: OpsRegistrationTrackSummary
  permissions: ActionPermissions
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onOpenLevelTest: () => void
  onOpenLevelTestHistory: () => void
  onOpenVisit: () => void
  onOpenOutcome: () => void
  hasLevelTestHistory: boolean
  activeConsultation: OpsRegistrationConsultation | null
  visitAppointment: OpsRegistrationAppointment | null
}) {
  if (track.status === "inquiry") {
    return <InquiryStageEditor track={track} permissions={permissions} classOptions={classOptions} onReload={onReload} onWarning={onWarning} onOpenLevelTest={onOpenLevelTest} />
  }
  if (track.status === "waiting") {
    return <WaitingStageEditor track={track} permissions={permissions} classOptions={classOptions} onReload={onReload} onWarning={onWarning} onOpenLevelTest={onOpenLevelTest} />
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
            {hasLevelTestHistory ? <Button type="button" variant="ghost" onClick={onOpenLevelTestHistory}>레벨테스트 결과 보기</Button> : null}
            <Button type="button" variant="outline" onClick={onOpenVisit}>방문상담 예약</Button>
            {permissions.canCompleteConsultation ? <Button type="button" onClick={onOpenOutcome}>전화상담 완료</Button> : null}
          </div>
        ) : null}
      </section>
    )
  }
  if (["level_test_scheduled", "level_test_in_progress"].includes(track.status)) {
    return (
      <section className="grid min-w-0 gap-3 rounded-md border p-3" aria-label={`${track.subject} 레벨테스트 관리`}>
        <h3 className="text-sm font-semibold">[{track.subject}] {STATUS_LABELS[track.status]}</h3>
        {permissions.canManage ? <Button type="button" variant="outline" onClick={onOpenLevelTest}>예약 및 과목별 결과 관리</Button> : null}
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
        {permissions.canManage ? (
          <div className="flex flex-wrap gap-2">
            {hasLevelTestHistory ? <Button type="button" variant="ghost" onClick={onOpenLevelTestHistory}>레벨테스트 결과 보기</Button> : null}
            <Button type="button" variant="outline" onClick={onOpenVisit}>방문상담 예약 수정</Button>
            {permissions.canCompleteConsultation ? <Button type="button" onClick={onOpenOutcome}>방문상담 완료</Button> : null}
          </div>
        ) : null}
      </section>
    )
  }
  if (["not_registered", "inquiry_closed"].includes(track.status)) {
    return <TerminalStageEditor track={track} permissions={permissions} onReload={onReload} onWarning={onWarning} />
  }
  if (["enrollment_decided", "enrollment_processing", "registered"].includes(track.status)) {
    return null
  }
  return null
}

type ConsultationOutcomeDraft = {
  outcome: "enrollment" | "waiting" | "not_registered"
  waitingKind: RegistrationWaitingKind
  classId: string
}

export function RegistrationConsultationOutcomeDialog({
  subject,
  consultation,
  open,
  onOpenChange,
  classOptions,
  onReload,
  onWarning,
}: {
  subject: RegistrationSubject
  consultation: OpsRegistrationConsultation
  open: boolean
  onOpenChange: (open: boolean) => void
  classOptions: OpsClassOption[]
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
}) {
  const [draft, setDraft] = useState<ConsultationOutcomeDraft>({
    outcome: "enrollment",
    waitingKind: "current_term_opening",
    classId: "",
  })
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const submissionKeys = useSubmissionKeys()
  const waitingIsValid = draft.outcome !== "waiting"
    || Boolean(draft.waitingKind && (draft.waitingKind !== "current_class" || draft.classId))

  async function submit() {
    if (saving || refreshPending || !waitingIsValid) return
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
    setRefreshPending(true)
    try {
      await onReload()
      onOpenChange(false)
    } catch {
      onWarning("상담 결과 저장은 완료되었습니다. 최신 내용 다시 불러오기를 눌러 중복 처리를 막아 주세요.")
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
      onOpenChange(false)
    } catch {
      onWarning("최신 상담 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && refreshPending) return
      onOpenChange(nextOpen)
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>[{subject}] {consultation.mode === "phone" ? "전화상담" : "방문상담"} 결과</DialogTitle>
          <DialogDescription>완료 일시는 저장 시 자동 기록됩니다. 과목별 다음 단계를 선택하세요.</DialogDescription>
        </DialogHeader>

        {refreshPending ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span>상담 결과 저장은 완료되었습니다.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void retryRefresh()} disabled={saving}>최신 내용 다시 불러오기</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">상담 결과</legend>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant={draft.outcome === "enrollment" ? "default" : "outline"} onClick={() => setDraft((current) => ({ ...current, outcome: "enrollment" }))}>등록</Button>
                <Button type="button" variant={draft.outcome === "waiting" ? "default" : "outline"} onClick={() => setDraft((current) => ({ ...current, outcome: "waiting" }))}>대기</Button>
                <Button type="button" variant={draft.outcome === "not_registered" ? "default" : "outline"} onClick={() => setDraft((current) => ({ ...current, outcome: "not_registered" }))}>미등록 완료</Button>
              </div>
            </fieldset>
            {draft.outcome === "waiting" ? (
              <div className="grid gap-2">
                <Label className="grid gap-1.5">
                  대기 종류
                  <select className="h-9 rounded-md border bg-background px-3 text-sm" value={draft.waitingKind} onChange={(event) => setDraft((current) => ({ ...current, waitingKind: event.target.value as RegistrationWaitingKind, classId: "" }))}>
                    {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Label>
                {draft.waitingKind === "current_class" ? (
                  <Label className="grid gap-1.5">
                    대기 수업
                    <SubjectClassSelect subject={subject} value={draft.classId} onChange={(classId) => setDraft((current) => ({ ...current, classId }))} classOptions={classOptions} />
                  </Label>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {!refreshPending ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
            <Button type="button" onClick={() => void submit()} disabled={saving || !waitingIsValid}>상담 결과 저장</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type ReviewTargetState = RegistrationMigrationTrackState["targetStatus"] | ""

export function RegistrationMigrationReviewEditor({
  detail,
  permissions,
  directorOptions,
  teacherOptions,
  classOptions,
  onRetryDirectorCatalog,
  onResolved,
  onWarning,
}: {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  permissions: ActionPermissions
  directorOptions: OpsProfileOption[]
  teacherOptions: OpsTeacherOption[]
  classOptions: OpsClassOption[]
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  onResolved: () => void | Promise<void>
  onWarning: (message: string) => void
}) {
  const reviewTracks = detail.tracks.filter((track) => track.migrationReviewRequired)
  const groups = MIGRATION_GROUPS.filter((group) => detail.migrationLegacy?.groups[group.presence])
  const requiresExplicitAssignments = reviewTracks.length > 1
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [targetStates, setTargetStates] = useState<Record<string, ReviewTargetState>>({})
  const [waitingKinds, setWaitingKinds] = useState<Record<string, RegistrationWaitingKind>>({})
  const [classIds, setClassIds] = useState<Record<string, string>>({})
  const [directorIds, setDirectorIds] = useState<Record<string, string>>(() => Object.fromEntries(reviewTracks.map((track) => [track.id, track.directorProfileId || ""])))
  const [savingDirectorId, setSavingDirectorId] = useState("")
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false)
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const submissionKeys = useSubmissionKeys()
  const activeDirectorProfileIds = new Set(teacherOptions.map((teacher) => teacher.profileId).filter(Boolean))
  const availableDirectors = directorOptions.filter((profile) => profile.role === "admin" && activeDirectorProfileIds.has(profile.id))
  const hasLevelTestReservation = hasLegacyLevelTestReservation(detail.migrationLegacy)
  const hasVisitReservation = hasLegacyVisitReservation(detail.migrationLegacy)

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
    && !detail.migrationLegacy?.snapshotMissing
    && (!requiresExplicitAssignments || groups.every((group) => Boolean(assignments[group.key])))
    && reviewTracks.every(targetIsValid)

  async function saveDirector(track: OpsRegistrationTrackSummary) {
    const directorProfileId = directorIds[track.id] || ""
    if (
      !permissions.canManage
      || !directorProfileId
      || !availableDirectors.some((profile) => profile.id === directorProfileId)
      || savingDirectorId
    ) return
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
      await onResolved()
      submissionKeys.clear(kind, migrationDirectorEntityKey)
    } catch (error) {
      const message = errorMessage(error, "상담 책임자를 저장하지 못했습니다.")
      if (message.includes("registration_common_revision_conflict")) {
        submissionKeys.clear(kind, migrationDirectorEntityKey)
        try {
          await onResolved()
          onWarning("다른 사용자의 변경을 반영했습니다. 상담 책임자와 과목 분리 상태를 다시 확인하세요.")
        } catch {
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
    if (!onRetryDirectorCatalog || catalogRefreshing) return
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

  async function resolveReview() {
    if (!canResolve || saving) return
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

    setSaving(true)
    try {
      await resolveRegistrationMigrationReview({
        taskId: detail.task.id,
        assignments: payloadAssignments,
        trackStates,
        requestKey,
      })
      await onResolved()
      submissionKeys.clear(kind, migrationReviewEntityKey)
    } catch (error) {
      const message = errorMessage(error, "과목 분리 확인을 저장하지 못했습니다.")
      if (message.includes("registration_common_revision_conflict")) {
        submissionKeys.clear(kind, migrationReviewEntityKey)
        try {
          await onResolved()
          onWarning("다른 사용자의 변경을 반영했습니다. 과목 분리 상태를 다시 확인하세요.")
        } catch {
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
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={assignments[group.key] || ""}
            onChange={(event) => setAssignments((current) => ({ ...current, [group.key]: event.target.value }))}
            disabled={!permissions.canManage || saving}
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
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={directorIds[track.id] || ""}
                  onChange={(event) => setDirectorIds((current) => ({ ...current, [track.id]: event.target.value }))}
                  disabled={!permissions.canManage || saving || savingDirectorId === track.id}
                >
                  <option value="">원장 선택</option>
                  {directorIds[track.id] && !availableDirectors.some((profile) => profile.id === directorIds[track.id]) ? (
                    <option value={directorIds[track.id]} disabled>활성 담당자 다시 선택</option>
                  ) : null}
                  {availableDirectors.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </Label>
              <Button type="button" variant="outline" size="sm" className="self-end" onClick={() => void saveDirector(track)} disabled={!permissions.canManage || !availableDirectors.some((profile) => profile.id === directorIds[track.id]) || saving || Boolean(savingDirectorId)}>
                책임자 저장
              </Button>
            </div>
            <Label className="grid gap-1.5">
              확인 후 단계
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={target}
                onChange={(event) => setTargetStates((current) => ({ ...current, [track.id]: event.target.value as ReviewTargetState }))}
                disabled={!permissions.canManage || saving}
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
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={waitingKind} onChange={(event) => setWaitingKinds((current) => ({ ...current, [track.id]: event.target.value as RegistrationWaitingKind }))} disabled={saving}>
                  <option value="">대기 종류 선택</option>
                  {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {waitingKind === "current_class" ? <SubjectClassSelect subject={track.subject} value={classIds[track.id] || ""} onChange={(value) => setClassIds((current) => ({ ...current, [track.id]: value }))} classOptions={classOptions} disabled={saving} /> : null}
              </div>
            ) : null}
          </div>
        )
      })}

      {permissions.canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          {catalogRefreshRequired ? (
            <Button type="button" variant="outline" onClick={() => void retryDirectorCatalog()} disabled={!onRetryDirectorCatalog || catalogRefreshing}>
              담당자 정보 다시 불러오기
            </Button>
          ) : null}
          <Button type="button" onClick={() => void resolveReview()} disabled={!canResolve || saving || Boolean(savingDirectorId)}>
            과목 분리 확인 저장
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export function RegistrationTrackEditor({
  task,
  detail,
  selectedTrackId,
  onSelectTrack,
  onReload,
  onWarning,
  onAppointmentSaved,
  caseLevelActions,
  viewerId,
  viewerRole,
  directorOptions = [],
  teacherOptions = [],
  directorCatalogStatus = "loading",
  onRetryDirectorCatalog,
  classOptions = [],
  textbookOptions = [],
  consultationOutcomeOpen = false,
  onConsultationOutcomeOpenChange,
  notificationToken = "",
}: RegistrationTrackEditorProps) {
  const [appointmentEditor, setAppointmentEditor] = useState<{
    kind: "level_test" | "visit_consultation"
    appointmentId: string | null
  } | null>(null)
  const [localConsultationOutcomeOpen, setLocalConsultationOutcomeOpen] = useState(false)
  const selectedTrack = detail.tracks.find((track) => track.id === selectedTrackId) || detail.tracks[0] || null
  const reviewBlocked = detail.tracks.some((track) => track.migrationReviewRequired)
  const activeConsultation = selectedTrack
    ? detail.consultations.find((item) => (
      item.trackId === selectedTrack.id
      && ((selectedTrack.status === "consultation_waiting" && item.mode === "phone" && item.status === "waiting")
        || (selectedTrack.status === "visit_consultation_scheduled" && item.mode === "visit" && item.status === "scheduled"))
    )) || null
    : null
  const permissions = getRegistrationActionPermissions({ viewerId, viewerRole, track: selectedTrack, activeConsultation }) as ActionPermissions
  const selectedLevelTests = selectedTrack
    ? detail.levelTests.filter((item) => item.trackId === selectedTrack.id)
    : []
  const selectedLevelTest = selectedLevelTests
    .find((item) => ["scheduled", "in_progress"].includes(item.status)) || null
  const selectedLevelTestHistory = selectedLevelTests
    .reduce<typeof selectedLevelTests[number] | null>((latest, item) => (
      !latest || item.attemptNumber > latest.attemptNumber ? item : latest
    ), null)
  const selectedVisitConsultation = selectedTrack
    ? detail.consultations.find((item) => item.trackId === selectedTrack.id && item.mode === "visit" && item.status === "scheduled") || null
    : null
  const visitAppointment = selectedVisitConsultation?.appointmentId
    ? detail.appointments.find((item) => item.id === selectedVisitConsultation.appointmentId) || null
    : null
  const editorAppointment = appointmentEditor?.appointmentId
    ? detail.appointments.find((item) => item.id === appointmentEditor.appointmentId) || null
    : null
  const appointmentActivitySignature = appointmentEditor?.kind === "level_test"
    ? detail.levelTests
      .filter((item) => !editorAppointment || item.appointmentId === editorAppointment.id)
      .map((item) => `${item.id}:${item.status}`)
      .join("|")
    : detail.consultations
      .filter((item) => item.mode === "visit" && (!editorAppointment || item.appointmentId === editorAppointment.id))
      .map((item) => `${item.id}:${item.status}`)
      .join("|")
  const outcomeDialogOpen = consultationOutcomeOpen || localConsultationOutcomeOpen
  const shouldShowDirector = Boolean(
    selectedTrack
    && REGISTRATION_DIRECTOR_VISIBLE_STATUSES.has(selectedTrack.status),
  )

  function setOutcomeDialogOpen(open: boolean) {
    setLocalConsultationOutcomeOpen(open)
    onConsultationOutcomeOpenChange?.(open)
  }

  async function handleAppointmentSaved(saved: RegistrationAppointmentMutationResponse) {
    await onAppointmentSaved?.(saved)
    await onReload()
    setAppointmentEditor(null)
    if (saved.requiresDirectorAssignmentTrackIds.length > 0) {
      onWarning("상담 책임자가 없는 과목을 먼저 지정하세요.")
    }
  }

  async function saveCommon(draft: CommonDraft, requestKey: string) {
    try {
      await updateRegistrationCaseCommon({
        ...draft,
        schoolName: draft.schoolName.trim(),
        parentPhone: draft.parentPhone.trim(),
        studentPhone: draft.studentPhone.trim(),
        campus: draft.campus.trim(),
        inquiryAt: draft.inquiryAt,
        requestNote: draft.requestNote.trim(),
        taskId: detail.task.id,
        expectedCommonRevision: detail.commonRevision,
        requestKey,
      })
    } catch (error) {
      if (errorMessage(error, "").includes("registration_common_revision_conflict")) {
        try {
          await onReload()
          return "conflict_reloaded" as const
        } catch {
          throw new Error("다른 사용자의 변경은 감지했지만 최신 정보를 다시 불러오지 못했습니다. 최신 정보로 다시 시도하려면 창을 닫고 다시 여세요.")
        }
      }
      throw error
    }
    await onReload()
    return "saved" as const
  }

  const selectedSection = selectedTrack ? getRegistrationApplicationSection(selectedTrack.status) : "inquiry"
  const selectedStageEditor = !reviewBlocked && selectedTrack ? (
    <RegistrationTrackStageEditor
      key={`stage:${selectedTrack.id}:${selectedTrack.status}:${selectedTrack.waitingKind}`}
      track={selectedTrack}
      permissions={permissions}
      classOptions={classOptions}
      onReload={onReload}
      onWarning={onWarning}
      onOpenLevelTest={() => setAppointmentEditor({
        kind: "level_test",
        appointmentId: selectedLevelTest?.appointmentId || null,
      })}
      onOpenLevelTestHistory={() => setAppointmentEditor({
        kind: "level_test",
        appointmentId: selectedLevelTestHistory?.appointmentId || null,
      })}
      onOpenVisit={() => setAppointmentEditor({
        kind: "visit_consultation",
        appointmentId: selectedVisitConsultation?.appointmentId || null,
      })}
      onOpenOutcome={() => setOutcomeDialogOpen(true)}
      hasLevelTestHistory={Boolean(selectedLevelTestHistory?.status === "completed")}
      activeConsultation={activeConsultation}
      visitAppointment={visitAppointment}
    />
  ) : null
  const selectedEnrollmentEditor = selectedTrack
    && ["enrollment_decided", "enrollment_processing", "registered"].includes(selectedTrack.status) ? (
      <RegistrationEnrollmentEditor
        key={`enrollment:${selectedTrack.id}:${selectedTrack.status}:${detail.enrollments.map((enrollment) => `${enrollment.id}:${enrollment.status}:${enrollment.admissionBatchId || ""}:${enrollment.makeeduRegistered}`).join("|")}`}
        taskId={detail.task.id}
        viewerId={viewerId || ""}
        track={selectedTrack}
        enrollments={detail.enrollments}
        admissionBatches={detail.admissionBatches}
        classes={classOptions}
        textbooks={textbookOptions}
        permissions={permissions}
        onReload={onReload}
        onWarning={onWarning}
      />
    ) : null

  return (
    <div className="grid min-w-0 gap-4">
      <section className="grid min-w-0 rounded-md border px-3" aria-label="등록 신청서">
        <RegistrationApplicationSection sectionKey="inquiry" title="문의 정보" active={selectedSection === "inquiry"}>
          <RegistrationCommonInfoSection
            key={`${detail.task.id}:${detail.commonRevision}`}
            task={detail.task}
            commonRevision={detail.commonRevision}
            identityLocked={getRegistrationIdentityEditLock(detail)}
            canEdit={permissions.canManage}
            embedded
            onSave={saveCommon}
            onWarning={onWarning}
          />
          <RegistrationSubjectSyncSection
            key={`${detail.task.id}:${detail.tracks.map((track) => track.id).join(",")}`}
            detail={detail}
            canManage={permissions.canManage}
            embedded
            onReload={onReload}
            onWarning={onWarning}
          />
          <RegistrationSubjectProgress detail={detail} selectedTrackId={selectedTrack?.id || null} onSelectTrack={onSelectTrack} />
          {reviewBlocked ? (
            <RegistrationMigrationReviewEditor
              key={`${detail.task.id}:${detail.commonRevision}:${detail.tracks.map((track) => `${track.id}:${track.directorProfileId || ""}`).join(",")}`}
              task={task}
              detail={detail}
              permissions={permissions}
              directorOptions={directorOptions}
              teacherOptions={teacherOptions}
              classOptions={classOptions}
              onRetryDirectorCatalog={onRetryDirectorCatalog}
              onResolved={onReload}
              onWarning={onWarning}
            />
          ) : selectedTrack && selectedSection === "inquiry" ? (
            <div data-registration-track-action={selectedTrack.id}>{selectedStageEditor}</div>
          ) : null}
        </RegistrationApplicationSection>

        <RegistrationApplicationSection sectionKey="level_test" title="레벨테스트" active={selectedSection === "level_test"}>
          <RegistrationLevelTestSummary detail={detail} />
          {selectedTrack && selectedSection === "level_test" ? (
            <div data-registration-track-action={selectedTrack.id}>{selectedStageEditor}</div>
          ) : null}
        </RegistrationApplicationSection>

        <RegistrationApplicationSection sectionKey="consultation" title="상담" active={selectedSection === "consultation"}>
          <RegistrationConsultationSummary detail={detail} />
          {selectedTrack && !reviewBlocked && shouldShowDirector ? (
            <RegistrationTrackDirectorSection
              task={task}
              detail={detail}
              track={selectedTrack}
              permissions={permissions}
              directorOptions={directorOptions}
              teacherOptions={teacherOptions}
              directorCatalogStatus={directorCatalogStatus}
              onRetryDirectorCatalog={onRetryDirectorCatalog}
              onOpenVisit={(trackId) => {
                const visitConsultation = detail.consultations.find((item) => (
                  item.trackId === trackId && item.mode === "visit" && item.status === "scheduled"
                )) || null
                onSelectTrack(trackId)
                setAppointmentEditor({
                  kind: "visit_consultation",
                  appointmentId: visitConsultation?.appointmentId || null,
                })
              }}
              onReload={onReload}
              onWarning={onWarning}
            />
          ) : null}
          {selectedTrack && selectedSection === "consultation" ? (
            <div data-registration-track-action={selectedTrack.id}>{selectedStageEditor}</div>
          ) : null}
        </RegistrationApplicationSection>

        <RegistrationApplicationSection sectionKey="placement" title="등록·대기 정보" active={selectedSection === "placement"}>
          <RegistrationPlacementSummary detail={detail} classes={classOptions} />
          {selectedTrack && selectedEnrollmentEditor ? (
            <div data-registration-track-action={selectedTrack.id}>{selectedEnrollmentEditor}</div>
          ) : selectedTrack && selectedSection === "placement" ? (
            <div data-registration-track-action={selectedTrack.id}>{selectedStageEditor}</div>
          ) : null}
        </RegistrationApplicationSection>

        <RegistrationApplicationSection sectionKey="admission" title="입학 처리" active={selectedSection === "admission"}>
          {caseLevelActions || <p className="text-sm text-muted-foreground">등록 결정 후 입학 처리 항목이 열립니다.</p>}
        </RegistrationApplicationSection>
      </section>
      {appointmentEditor?.kind === "level_test" && selectedTrack ? (
        <RegistrationAppointmentEditor
          key={`level_test:${editorAppointment?.id || "new"}:${editorAppointment?.notificationRevision ?? "new"}:${appointmentActivitySignature}`}
          kind="level_test"
          taskId={detail.task.id}
          eligibleTracks={detail.tracks}
          initialTrackId={selectedTrack.id}
          appointment={editorAppointment}
          activities={detail.levelTests}
          onSaved={handleAppointmentSaved}
          onWarning={onWarning}
          onReload={onReload}
          onClose={() => setAppointmentEditor(null)}
          onRebook={() => setAppointmentEditor({ kind: "level_test", appointmentId: null })}
          notificationToken={notificationToken}
        />
      ) : null}
      {appointmentEditor?.kind === "visit_consultation" && selectedTrack ? (
        <RegistrationAppointmentEditor
          key={`visit_consultation:${editorAppointment?.id || "new"}:${editorAppointment?.notificationRevision ?? "new"}:${appointmentActivitySignature}`}
          kind="visit_consultation"
          taskId={detail.task.id}
          eligibleTracks={detail.tracks}
          initialTrackId={selectedTrack.id}
          appointment={editorAppointment}
          activities={detail.consultations.filter((item) => item.mode === "visit")}
          onSaved={handleAppointmentSaved}
          onWarning={onWarning}
          onReload={onReload}
          onClose={() => setAppointmentEditor(null)}
          notificationToken={notificationToken}
        />
      ) : null}
      {selectedTrack && activeConsultation ? (
        <RegistrationConsultationOutcomeDialog
          key={`${activeConsultation.id}:${activeConsultation.status}`}
          subject={selectedTrack.subject}
          consultation={activeConsultation}
          open={outcomeDialogOpen && permissions.canCompleteConsultation}
          onOpenChange={setOutcomeDialogOpen}
          classOptions={classOptions}
          onReload={onReload}
          onWarning={onWarning}
        />
      ) : null}
    </div>
  )
}
