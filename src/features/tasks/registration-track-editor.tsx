"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { RegistrationApplicationAdmissionSection } from "./registration-application-admission-section"
import { RegistrationApplicationConsultationSection } from "./registration-application-consultation-section"
import { RegistrationApplicationInquirySection } from "./registration-application-inquiry-section"
import { RegistrationApplicationLevelTestSection } from "./registration-application-level-test-section"
import {
  getRegistrationApplicationAppointmentActionPlans,
  getRegistrationApplicationCaseEditableSections,
  getRegistrationApplicationProgress,
  getRegistrationEnrollmentDirtyKey,
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  resolveRegistrationActiveTrackId,
  resolveRegistrationAppointmentEditorSeedTrackIds,
  settleRegistrationConflictComparison,
  updateRegistrationApplicationDirtyKeys,
  type RegistrationApplicationDirtyKey,
  type RegistrationApplicationSectionKey,
} from "./registration-application-model"
import { RegistrationApplicationProgressStepper } from "./registration-application-progress-stepper"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationHistoryAction } from "./registration-application-history-action"
import { RegistrationApplicationShell } from "./registration-application-shell"
import { RegistrationApplicationSubjectTabs } from "./registration-application-subject-tabs"
import {
  REGISTRATION_DIRECTOR_VISIBLE_STATUSES,
  REGISTRATION_TRACK_STATUS_LABELS,
  RegistrationCommonInfoSection,
  RegistrationConsultationOutcomeEditor,
  RegistrationConsultationSummary,
  RegistrationEnrollmentTrackEditor,
  RegistrationLevelTestSummary,
  RegistrationMigrationConflictNotice,
  RegistrationMigrationReviewEditor,
  RegistrationSubjectSyncSection,
  RegistrationTrackDirectorSection,
  RegistrationTrackStageEditor,
  getRegistrationIdentityEditLock,
  type RegistrationCommonDraft,
  type RegistrationMigrationConflictState,
  type RegistrationMigrationDirtyScope,
  type RegistrationTrackActionPermissions,
} from "./registration-application-track-actions"
import { RegistrationAppointmentEditor } from "./registration-appointment-editor"
import { clearRegistrationEnrollmentDrafts } from "./registration-enrollment-editor"
import {
  RegistrationAdmissionPanel,
  type RegistrationAdmissionPanelProps,
} from "./registration-enrollment-editor"
import type {
  OpsClassOption,
  OpsProfileOption,
  OpsSchoolOption,
  OpsTask,
  OpsTeacherOption,
  OpsTextbookOption,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import { type RegistrationDirectorCatalogStatus } from "./registration-director-default.js"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import { ACADEMIC_SUBJECT_VALUES } from "../../lib/academic-subject-registry.ts"
import {
  getRegistrationActionPermissions,
  getRegistrationAdmissionApplicationState,
  getRegistrationCurrentClassWaitClassId,
} from "./registration-track-model.js"
import {
  loadAssignedScienceConsultationClassOptions,
  updateRegistrationCaseCommon,
  type OpsRegistrationAppointment,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationConsultation,
  type OpsRegistrationTrackSummary,
  type RegistrationAppointmentMutationResponse,
} from "./registration-track-service"

export type RegistrationTrackViewerRole = "admin" | "staff" | "assistant" | "teacher" | null

export type RegistrationApplicationProps = {
  task: OpsTask
  detail: OpsRegistrationCaseDetail
  focusTrackId: string | null
  viewerId: string | null
  viewerRole: RegistrationTrackViewerRole
  onFocusTrack: (trackId: string) => void
  onReload: (preferredTrackId?: string) => void | Promise<void>
  onWarning: (message: string) => void
  onAppointmentSaved?: (
    saved: RegistrationAppointmentMutationResponse,
  ) => void | Promise<void>
  profiles?: OpsProfileOption[]
  directorOptions?: OpsProfileOption[]
  teacherOptions?: OpsTeacherOption[]
  directorCatalogStatus?: RegistrationDirectorCatalogStatus
  subjectCapabilities: readonly RegistrationSubjectCapability[]
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
  schools?: OpsSchoolOption[]
  schoolCatalogStatus?: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  onRetrySchools?: () => void
  classOptions?: OpsClassOption[]
  textbookOptions?: OpsTextbookOption[]
  admissionActions: Pick<
    RegistrationAdmissionPanelProps,
    | "onSendAdmissionMessage"
    | "onCheckAdmissionMessage"
    | "onReconcileAdmissionMessage"
    | "onReleaseAdmissionMessageRetry"
  >
  initialAppointmentId?: string | null
  onAppointmentOpenChange?: (appointmentId: string | null) => void
  onDirtyChange?: (dirty: boolean) => void
  notificationToken?: string
  closeAction: ReactNode
}

type TrackContext = {
  track: OpsRegistrationTrackSummary
  permissions: RegistrationTrackActionPermissions
  state: ReturnType<typeof getRegistrationApplicationTrackState>
  activeConsultation: OpsRegistrationConsultation | null
  currentLevelTest: OpsRegistrationCaseDetail["levelTests"][number] | null
  latestLevelTest: OpsRegistrationCaseDetail["levelTests"][number] | null
  visitConsultation: OpsRegistrationConsultation | null
  visitAppointment: OpsRegistrationAppointment | null
}

type AppointmentEditorState = {
  kind: OpsRegistrationAppointment["kind"]
  appointmentId: string | null
  initialTrackId: string
}

type RegistrationPlacementMode = "waiting" | "registration"

const WAITING_KIND_LABELS = {
  "": "기록 없음",
  current_class: "현재 학기 수강반 대기",
  current_term_opening: "현재 학기 개강반 대기",
  next_term_opening: "다음 학기 개강반 대기",
} as const

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function sameRegistrationTrackIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((trackId, index) => trackId === right[index])
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "기록 없음"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function valueField(label: string, value: ReactNode) {
  return (
    <div key={label} className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]">{value || "기록 없음"}</dd>
    </div>
  )
}

function RegistrationTrackSectionValues({
  section,
  context,
  detail,
  classOptions,
  textbookOptions,
  placementMode,
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  detail: OpsRegistrationCaseDetail
  classOptions: OpsClassOption[]
  textbookOptions: OpsTextbookOption[]
  placementMode?: RegistrationPlacementMode
}) {
  const { track, latestLevelTest, activeConsultation, visitAppointment } = context
  const enrollments = detail.enrollments.filter((enrollment) => enrollment.trackId === track.id)
  const latestEnrollment = enrollments.reduce<typeof enrollments[number] | null>((latest, enrollment) => (
    !latest || enrollment.sortOrder >= latest.sortOrder ? enrollment : latest
  ), null)
  const classItem = classOptions.find((item) => item.id === latestEnrollment?.classId)
  const textbook = textbookOptions.find((item) => item.id === latestEnrollment?.textbookId)
  const levelTestAppointment = latestLevelTest
    ? detail.appointments.find((appointment) => appointment.id === latestLevelTest.appointmentId) || null
    : null

  let fields: ReactNode[]
  if (section === "inquiry") {
    fields = [
      valueField("상담 책임자", track.directorName || "미지정"),
    ]
  } else if (section === "level_test") {
    fields = [
      valueField("예약일시", formatDateTime(levelTestAppointment?.scheduledAt)),
      valueField("장소", levelTestAppointment?.place || "기록 없음"),
      valueField(`${track.subject} 결과 링크`, latestLevelTest?.materialLink || "기록 없음"),
    ]
  } else if (section === "consultation") {
    fields = [
      valueField("상담 책임자", track.directorName || "미지정"),
      valueField("전화상담 대기 기준일시", formatDateTime(activeConsultation?.mode === "phone" ? activeConsultation.readyAt : track.phoneReadyAt)),
      valueField("방문상담일시", formatDateTime(visitAppointment?.scheduledAt)),
      valueField("방문상담실", visitAppointment?.place || "기록 없음"),
      valueField("상담 결과", activeConsultation?.outcome || "기록 없음"),
    ]
  } else if (section === "placement") {
    fields = placementMode === "waiting" ? [
      valueField("대기 종류", WAITING_KIND_LABELS[track.waitingKind]),
      valueField("대기 수업", track.waitingKind === "current_class" ? classItem?.label || "기록 없음" : "해당 없음"),
    ] : [
      valueField("등록 단계", REGISTRATION_TRACK_STATUS_LABELS[track.status]),
      valueField("수강 수업", classItem?.label || "기록 없음"),
      valueField("교재", textbook?.label || "기록 없음"),
      valueField("수업 시작일·회차", [latestEnrollment?.classStartDate, latestEnrollment?.classStartSession].filter(Boolean).join(" · ") || "기록 없음"),
    ]
  } else {
    fields = [
      valueField("입학 처리 묶음", latestEnrollment?.admissionBatchId || "기록 없음"),
    ]
  }

  return <dl className="grid gap-2 sm:grid-cols-2">{fields}</dl>
}

function RegistrationTrackSectionFrame({
  section,
  context,
  detail,
  classOptions,
  textbookOptions,
  selected,
  children,
  placementMode,
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  detail: OpsRegistrationCaseDetail
  classOptions: OpsClassOption[]
  textbookOptions: OpsTextbookOption[]
  selected: boolean
  children?: ReactNode
  placementMode?: RegistrationPlacementMode
}) {
  const sectionState = context.state.sections[section]
  const placementCurrent = section !== "placement" || placementMode === "waiting"
    ? context.track.status === "waiting"
    : ["enrollment_decided", "enrollment_processing", "registered", "not_registered"].includes(context.track.status)
  const displayCurrent = section === "placement" ? placementCurrent : sectionState.current
  return (
    <article
      role="tabpanel"
      id={`registration-${section}-${context.track.id}`}
      aria-labelledby={`registration-subject-tab-${context.track.id}`}
      hidden={!selected}
      aria-current={displayCurrent ? "step" : undefined}
      data-registration-track-id={context.track.id}
      data-registration-subject={context.track.subject}
      data-registration-focus-track={selected ? context.track.id : undefined}
      data-registration-state={sectionState.current ? "current" : sectionState.editable ? "ready" : "locked"}
      className={[
        "grid min-w-0 gap-3 rounded-md border p-3",
        selected ? "border-primary/60 bg-primary/[0.025]" : "bg-background",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{context.track.subject}</h4>
        <Badge variant={displayCurrent ? "default" : "outline"}>
          {displayCurrent ? "현재 · " : ""}{REGISTRATION_TRACK_STATUS_LABELS[context.track.status]}
        </Badge>
      </div>
      <RegistrationTrackSectionValues
        section={section}
        context={context}
        detail={detail}
        classOptions={classOptions}
        textbookOptions={textbookOptions}
        placementMode={placementMode}
      />
      {sectionState.lockReason ? (
        <p className="text-xs text-muted-foreground">{sectionState.lockReason}</p>
      ) : null}
      <fieldset disabled={!sectionState.editable} className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </article>
  )
}

export function RegistrationApplication({
  task,
  detail,
  focusTrackId,
  viewerId,
  viewerRole,
  onFocusTrack,
  onReload,
  onWarning,
  onAppointmentSaved,
  profiles = [],
  directorOptions = [],
  teacherOptions = [],
  directorCatalogStatus = "loading",
  subjectCapabilities,
  onRetryDirectorCatalog,
  schools = [],
  schoolCatalogStatus = "loading",
  schoolCatalogError = "",
  onRetrySchools,
  classOptions = [],
  textbookOptions = [],
  admissionActions,
  initialAppointmentId = null,
  onAppointmentOpenChange,
  onDirtyChange,
  notificationToken = "",
  closeAction,
}: RegistrationApplicationProps) {
  const [appointmentEditor, setAppointmentEditor] = useState<AppointmentEditorState | null>(null)
  const [appointmentDraftParticipantTrackIds, setAppointmentDraftParticipantTrackIds] = useState<string[]>([])
  const [migrationConflictState, setMigrationConflictState] = useState<RegistrationMigrationConflictState | null>(null)
  const [migrationConflictRetrying, setMigrationConflictRetrying] = useState(false)
  const [migrationDirectorResetVersion, setMigrationDirectorResetVersion] = useState(0)
  const [migrationReviewResetVersion, setMigrationReviewResetVersion] = useState(0)
  const [scienceConsultationClassOptions, setScienceConsultationClassOptions] = useState<OpsClassOption[]>([])
  const dirtyKeysRef = useRef<Set<RegistrationApplicationDirtyKey>>(new Set())
  const dirtyProducersRef = useRef(new Map<RegistrationApplicationDirtyKey, Set<string>>())
  const onDirtyChangeRef = useRef(onDirtyChange)
  const appointmentEditorRef = useRef<HTMLDivElement | null>(null)
  const initialAppointmentAppliedRef = useRef("")
  const initialFocusRequestRef = useRef({ taskId: detail.task.id, trackId: focusTrackId })
  const initialFocusAppliedRef = useRef("")
  if (initialFocusRequestRef.current.taskId !== detail.task.id) {
    initialFocusRequestRef.current = { taskId: detail.task.id, trackId: focusTrackId }
  }
  const canManageCase = viewerRole === "admin" || viewerRole === "staff"
  const orderedTracks = useMemo(() => [...detail.tracks].sort((left, right) => (
    ACADEMIC_SUBJECT_VALUES.indexOf(left.subject) - ACADEMIC_SUBJECT_VALUES.indexOf(right.subject)
    || left.id.localeCompare(right.id)
  )), [detail.tracks])
  const activeTrackId = resolveRegistrationActiveTrackId(orderedTracks, focusTrackId)
  const activeTrack = orderedTracks.find((track) => track.id === activeTrackId) || null
  const reviewTrack = orderedTracks.find((track) => track.migrationReviewRequired) || null
  const activeMigrationConflictState = migrationConflictState?.taskId === detail.task.id
    ? migrationConflictState
    : null

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange
  }, [onDirtyChange])
  useEffect(() => () => {
    clearRegistrationEnrollmentDrafts(detail.task.id)
  }, [detail.task.id])
  useEffect(() => {
    dirtyKeysRef.current = new Set()
    dirtyProducersRef.current = new Map()
    onDirtyChangeRef.current?.(false)
  }, [detail.task.id])
  const setDirty = useCallback((key: RegistrationApplicationDirtyKey, dirty: boolean, producer: string = key) => {
    const producers = new Set(dirtyProducersRef.current.get(key) || [])
    if (dirty) producers.add(producer)
    else producers.delete(producer)
    if (producers.size > 0) dirtyProducersRef.current.set(key, producers)
    else dirtyProducersRef.current.delete(key)
    const next = updateRegistrationApplicationDirtyKeys(dirtyKeysRef.current, key, producers.size > 0)
    if (next === dirtyKeysRef.current) return
    dirtyKeysRef.current = next
    onDirtyChangeRef.current?.(next.size > 0)
  }, [])
  useEffect(() => {
    setMigrationConflictState(null)
    setMigrationConflictRetrying(false)
    setMigrationDirectorResetVersion(0)
    setMigrationReviewResetVersion(0)
  }, [detail.task.id])
  useEffect(() => {
    setDirty("inquiry:migration-conflict", Boolean(activeMigrationConflictState))
  }, [activeMigrationConflictState, setDirty])

  async function retryMigrationConflictRefresh() {
    if (!activeMigrationConflictState || migrationConflictRetrying) return
    setMigrationConflictRetrying(true)
    try {
      await onReload()
      setMigrationConflictState((current) => {
        if (!current) return current
        if (current.kind === "director") {
          return {
            ...current,
            comparison: settleRegistrationConflictComparison(current.comparison, { succeeded: true }),
          }
        }
        return {
          ...current,
          comparison: settleRegistrationConflictComparison(current.comparison, { succeeded: true }),
        }
      })
    } catch (error) {
      const message = errorMessage(error, "최신 등록 정보를 다시 불러오지 못했습니다.")
      setMigrationConflictState((current) => {
        if (!current) return current
        if (current.kind === "director") {
          return {
            ...current,
            comparison: settleRegistrationConflictComparison(current.comparison, { succeeded: false, error: message }),
          }
        }
        return {
          ...current,
          comparison: settleRegistrationConflictComparison(current.comparison, { succeeded: false, error: message }),
        }
      })
      onWarning(message)
    } finally {
      setMigrationConflictRetrying(false)
    }
  }

  function useLatestMigrationConflict() {
    if (activeMigrationConflictState?.kind === "director") {
      setMigrationDirectorResetVersion((current) => current + 1)
    } else if (activeMigrationConflictState?.kind === "review") {
      setMigrationReviewResetVersion((current) => current + 1)
    }
    setMigrationConflictState(null)
  }

  function reapplyMigrationConflict() {
    setMigrationConflictState(null)
  }

  const permissionsByTrackId = useMemo(() => new Map(orderedTracks.map((track) => {
    const activeConsultation = detail.consultations.find((item) => (
      item.trackId === track.id
      && ((track.status === "consultation_waiting" && item.mode === "phone" && item.status === "waiting")
        || (track.status === "visit_consultation_scheduled" && item.mode === "visit" && item.status === "scheduled"))
    )) || null
    return [track.id, getRegistrationActionPermissions({ viewerId, viewerRole, track, activeConsultation }) as RegistrationTrackActionPermissions]
  })), [detail.consultations, orderedTracks, viewerId, viewerRole])
  const trackStates = orderedTracks.map((track) => getRegistrationApplicationTrackState({
    track,
    canManage: permissionsByTrackId.get(track.id)?.canManage || false,
    canCompleteConsultation: permissionsByTrackId.get(track.id)?.canCompleteConsultation || false,
  }))
  const trackContexts: TrackContext[] = orderedTracks.map((track) => {
    const levelTests = detail.levelTests.filter((item) => item.trackId === track.id)
    const latestLevelTest = levelTests.reduce<typeof levelTests[number] | null>((latest, item) => (
      !latest || item.attemptNumber > latest.attemptNumber ? item : latest
    ), null)
    const activeConsultation = detail.consultations.find((item) => (
      item.trackId === track.id
      && ((track.status === "consultation_waiting" && item.mode === "phone" && item.status === "waiting")
        || (track.status === "visit_consultation_scheduled" && item.mode === "visit" && item.status === "scheduled"))
    )) || null
    const visitConsultation = detail.consultations.find((item) => item.trackId === track.id && item.mode === "visit" && item.status === "scheduled") || null
    return {
      track,
      permissions: permissionsByTrackId.get(track.id) || { canManage: false, canCompleteConsultation: false, readOnly: true },
      state: trackStates.find((state) => state.trackId === track.id)!,
      activeConsultation,
      currentLevelTest: levelTests.find((item) => ["scheduled", "in_progress"].includes(item.status)) || null,
      latestLevelTest,
      visitConsultation,
      visitAppointment: visitConsultation?.appointmentId
        ? detail.appointments.find((item) => item.id === visitConsultation.appointmentId) || null
        : null,
    }
  })
  const assignedScienceConsultationId = trackContexts.find((context) => (
    viewerRole === "teacher"
    && context.track.subject === "과학"
    && context.permissions.canCompleteConsultation
  ))?.activeConsultation?.id || ""
  useEffect(() => {
    let active = true
    setScienceConsultationClassOptions([])
    if (!assignedScienceConsultationId || !viewerId) return () => { active = false }
    void loadAssignedScienceConsultationClassOptions({ viewerId, consultationId: assignedScienceConsultationId })
      .then((options) => {
        if (active) setScienceConsultationClassOptions(options.filter((item) => item.subject === "과학"))
      })
      .catch(() => {
        if (!active) return
        setScienceConsultationClassOptions([])
        onWarning("과학 수업 목록을 불러오지 못했습니다.")
      })
    return () => { active = false }
  }, [assignedScienceConsultationId, onWarning, viewerId])
  const admissionApplicationState = getRegistrationAdmissionApplicationState({
    tracks: orderedTracks,
    enrollments: detail.enrollments,
    admissionNoticeSent: Boolean(detail.task.registration?.admissionNoticeSent),
    admissionApplicationMessageStatus: detail.admissionApplicationMessageStatus,
    admissionApplicationMessageClaimActive: detail.admissionApplicationMessageClaimActive,
  })
  const admissionTargetTracks = admissionApplicationState.targetTrackIds.flatMap((trackId) => {
    const track = detail.tracks.find((item) => item.id === trackId)
    return track ? [track] : []
  })
  const admissionMessageRecoveryAvailable = Boolean(
    detail.admissionApplicationMessageId
    && ["pending", "unknown", "failed_hold"].includes(detail.admissionApplicationMessageStatus),
  )
  const admissionEditable = canManageCase && (
    admissionApplicationState.canSend
    || admissionApplicationState.syncNeeded
    || admissionMessageRecoveryAvailable
  )
  const appointmentActionPlans = getRegistrationApplicationAppointmentActionPlans({
    tracks: orderedTracks,
    appointments: detail.appointments,
    levelTests: detail.levelTests,
    consultations: detail.consultations,
    actionableTrackIds: orderedTracks
      .filter((track) => permissionsByTrackId.get(track.id)?.canManage)
      .map((track) => track.id),
  })
  const activeTrackStates = trackStates.filter((state) => state.trackId === activeTrackId)
  const activeAppointmentActionPlans = appointmentActionPlans.filter((plan) => (
    activeTrackId ? plan.participantTrackIds.includes(activeTrackId) : false
  ))
  const sectionStates = getRegistrationApplicationSectionStates({
    tracks: activeTrackStates,
    caseEditableSections: getRegistrationApplicationCaseEditableSections({
      canManage: canManageCase,
      admissionMessageEditable: admissionEditable,
      admissionBatches: detail.admissionBatches,
      appointmentActionSections: activeAppointmentActionPlans.map((plan) => plan.kind === "level_test" ? "level_test" : "consultation"),
    }),
  })
  const activeProgress = getRegistrationApplicationProgress(activeTrack?.status || "inquiry", activeTrack?.waitingKind || "")
  const splitPlacementState = (key: "waiting" | "registration") => {
    const progressState = activeProgress.find((step) => step.key === key)?.state || "upcoming"
    const current = progressState === "current" || progressState === "terminal"
    return {
      current,
      editable: current && sectionStates.placement.editable,
      upcoming: progressState === "upcoming",
      lockReason: current && sectionStates.placement.editable
        ? ""
        : progressState === "upcoming"
          ? "현재 진행 단계가 아닙니다"
          : "완료된 단계입니다",
    }
  }
  const waitingState = splitPlacementState("waiting")
  const registrationState = splitPlacementState("registration")
  const focusedState = trackStates.find((state) => state.trackId === activeTrackId) || null
  const subjectPanelIdsByTrackId = Object.fromEntries(orderedTracks.map((track) => [
    track.id,
    ["inquiry", "level_test", "consultation", "placement", "admission"]
      .map((section) => `registration-${section}-${track.id}`),
  ]))

  useEffect(() => {
    if (!activeTrackId || focusTrackId === activeTrackId) return
    onFocusTrack(activeTrackId)
  }, [activeTrackId, focusTrackId, onFocusTrack])

  useEffect(() => {
    const initialFocusRequest = initialFocusRequestRef.current
    if (!focusTrackId || !focusedState || focusTrackId !== activeTrackId) return
    if (initialFocusRequest.taskId !== detail.task.id || initialFocusRequest.trackId !== focusTrackId) return
    if (initialFocusAppliedRef.current === detail.task.id) return
    const frame = window.requestAnimationFrame(() => {
      initialFocusAppliedRef.current = detail.task.id
      document.getElementById(`registration-${focusedState.currentSection}-${activeTrackId}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTrackId, detail.task.id, focusTrackId, focusedState])

  useEffect(() => {
    if (!initialAppointmentId) {
      initialAppointmentAppliedRef.current = ""
      return
    }
    const initialKey = `${detail.task.id}:${initialAppointmentId}`
    if (initialAppointmentAppliedRef.current === initialKey) return
    const appointment = detail.appointments.find((item) => item.id === initialAppointmentId) || null
    if (!appointment) return
    const fallbackTrackId = focusTrackId && orderedTracks.some((track) => track.id === focusTrackId)
      ? focusTrackId
      : orderedTracks[0]?.id || ""
    const initialAppointmentParticipantTrackIds = resolveRegistrationAppointmentEditorSeedTrackIds(
      appointmentActionPlans,
      appointment.id,
      null,
    )
    const initialTrackId = focusTrackId && initialAppointmentParticipantTrackIds.includes(focusTrackId)
      ? focusTrackId
      : initialAppointmentParticipantTrackIds[0] || fallbackTrackId
    const frame = window.requestAnimationFrame(() => {
      initialAppointmentAppliedRef.current = initialKey
      setAppointmentDraftParticipantTrackIds(initialAppointmentParticipantTrackIds)
      setAppointmentEditor({ kind: appointment.kind, appointmentId: appointment.id, initialTrackId })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appointmentActionPlans, detail.appointments, detail.task.id, focusTrackId, initialAppointmentId, orderedTracks])

  useEffect(() => {
    if (!appointmentEditor) return
    const frame = window.requestAnimationFrame(() => {
      appointmentEditorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appointmentEditor])

  async function saveCommon(draft: RegistrationCommonDraft, requestKey: string) {
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
        return "conflict" as const
      }
      throw error
    }
    return "saved" as const
  }

  function openAppointment(context: TrackContext, kind: OpsRegistrationAppointment["kind"], appointmentId: string | null) {
    onFocusTrack(context.track.id)
    const appointmentParticipantTrackIds = resolveRegistrationAppointmentEditorSeedTrackIds(
      appointmentActionPlans,
      appointmentId,
      context.track.id,
    )
    setAppointmentDraftParticipantTrackIds(appointmentParticipantTrackIds)
    setAppointmentEditor({ kind, appointmentId, initialTrackId: context.track.id })
    onAppointmentOpenChange?.(appointmentId)
  }

  function handleSubjectTabChange(trackId: string) {
    onFocusTrack(trackId)
  }

  function closeAppointmentEditor() {
    setAppointmentDraftParticipantTrackIds([])
    setAppointmentEditor(null)
    onAppointmentOpenChange?.(null)
  }

  async function handleAppointmentSaved(saved: RegistrationAppointmentMutationResponse) {
    await onAppointmentSaved?.(saved)
    await onReload()
    closeAppointmentEditor()
    if (saved.requiresDirectorAssignmentTrackIds.length > 0) {
      onWarning("상담 책임자가 없는 과목을 먼저 지정하세요.")
    }
  }

  const handleAppointmentParticipantTrackIdsChange = useCallback((trackIds: readonly string[]) => {
    const nextTrackIds = Array.from(new Set(trackIds)).sort()
    setAppointmentDraftParticipantTrackIds((currentTrackIds) => (
      sameRegistrationTrackIds(currentTrackIds, nextTrackIds) ? currentTrackIds : nextTrackIds
    ))
  }, [])

  function renderTrackActions(context: TrackContext, section: RegistrationApplicationSectionKey, placementMode?: RegistrationPlacementMode) {
    const { track, permissions, activeConsultation, visitAppointment } = context
    if (track.migrationReviewRequired) return null
    if (section === "placement" && placementMode === "registration" && ["enrollment_decided", "enrollment_processing", "registered"].includes(track.status)) {
      return (
        <RegistrationEnrollmentTrackEditor
          detail={detail}
          track={track}
          viewerId={viewerId || ""}
          permissions={permissions}
          classOptions={classOptions}
          textbookOptions={textbookOptions}
          onReload={onReload}
          onWarning={onWarning}
          onDirtyChange={(scope, dirty) => setDirty(getRegistrationEnrollmentDirtyKey(track.id, scope), dirty)}
        />
      )
    }
    if (context.state.currentSection !== section) return null
    if (section === "placement" && placementMode === "waiting" && track.status !== "waiting") return null
    if (section === "placement" && placementMode === "registration" && track.status === "waiting") return null
    if (section === "admission") return null
    return (
      <RegistrationTrackStageEditor
        key={`stage:${track.id}:${track.stageEnteredAt}`}
        track={track}
        currentClassWaitClassId={getRegistrationCurrentClassWaitClassId({ trackId: track.id, waitingKind: track.waitingKind, enrollments: detail.enrollments })}
        permissions={permissions}
        classOptions={classOptions}
        onReload={onReload}
        onWarning={onWarning}
        onOpenLevelTest={() => openAppointment(context, "level_test", null)}
        onOpenVisit={() => openAppointment(context, "visit_consultation", null)}
        activeConsultation={activeConsultation}
        visitAppointment={visitAppointment}
        onDirtyChange={(dirty) => setDirty(`${section}:track-${track.id}`, dirty)}
      />
    )
  }

  function renderTrackFrames(section: RegistrationApplicationSectionKey, placementMode?: RegistrationPlacementMode) {
    return trackContexts.map((context) => (
      <RegistrationTrackSectionFrame
        key={`${section}:${context.track.id}`}
        section={section}
        context={context}
        detail={detail}
        classOptions={classOptions}
        textbookOptions={textbookOptions}
        selected={activeTrackId === context.track.id}
        placementMode={placementMode}
      >
        {section === "inquiry" && reviewTrack?.id === context.track.id ? (
          <>
            {activeMigrationConflictState ? (
              <RegistrationMigrationConflictNotice
                conflict={activeMigrationConflictState}
                detail={detail}
                retrying={migrationConflictRetrying}
                canReapply={Boolean(reviewTrack)}
                onRetry={() => void retryMigrationConflictRefresh()}
                onUseLatest={useLatestMigrationConflict}
                onReapply={reapplyMigrationConflict}
              />
            ) : null}
            <RegistrationMigrationReviewEditor
              key={detail.task.id}
              task={task}
              detail={detail}
              track={reviewTrack}
              permissions={permissionsByTrackId.get(reviewTrack.id) || { canManage: false, canCompleteConsultation: false, readOnly: true }}
              directorOptions={directorOptions}
              teacherOptions={teacherOptions}
              classOptions={classOptions}
              onRetryDirectorCatalog={onRetryDirectorCatalog}
              onResolved={onReload}
              onWarning={onWarning}
              conflictState={activeMigrationConflictState}
              onConflictStateChange={setMigrationConflictState}
              directorConflictResetVersion={migrationDirectorResetVersion}
              reviewConflictResetVersion={migrationReviewResetVersion}
              onDirtyChange={(scope: RegistrationMigrationDirtyScope, dirty) => setDirty(
                `inquiry:track-${reviewTrack.id}`,
                dirty,
                `migration-${scope}:${reviewTrack.id}`,
              )}
            />
          </>
        ) : null}
        {section === "consultation" && REGISTRATION_DIRECTOR_VISIBLE_STATUSES.has(context.track.status) && !context.track.migrationReviewRequired ? (
          <RegistrationTrackDirectorSection
            task={task}
            detail={detail}
            track={context.track}
            permissions={context.permissions}
            directorOptions={directorOptions}
            teacherOptions={teacherOptions}
            directorCatalogStatus={directorCatalogStatus}
            subjectCapabilities={subjectCapabilities}
            onRetryDirectorCatalog={onRetryDirectorCatalog}
            onOpenVisit={(trackId) => {
              const target = trackContexts.find((item) => item.track.id === trackId)
              if (target) openAppointment(target, "visit_consultation", target.visitConsultation?.appointmentId || null)
            }}
            onReload={onReload}
            onWarning={onWarning}
            onDirtyChange={(dirty) => setDirty(`consultation:track-${context.track.id}`, dirty, `director:${context.track.id}`)}
          />
        ) : null}
        {renderTrackActions(context, section, placementMode)}
        {section === "consultation"
          && context.activeConsultation
          && context.permissions.canCompleteConsultation ? (
            <RegistrationConsultationOutcomeEditor
              key={`consultation:${context.activeConsultation.id}:${context.activeConsultation.updatedAt}`}
              subject={context.track.subject}
              consultation={context.activeConsultation}
              active
              classOptions={viewerRole === "teacher"
                && context.permissions.canCompleteConsultation
                && context.track.subject === "과학"
                ? scienceConsultationClassOptions
                : classOptions}
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty(`consultation:track-${context.track.id}`, dirty, `outcome:${context.activeConsultation?.id || context.track.id}`)}
            />
          ) : null}
      </RegistrationTrackSectionFrame>
    ))
  }

  function renderAppointmentActionPlans(kind: OpsRegistrationAppointment["kind"]) {
    const plans = activeAppointmentActionPlans.filter((plan) => plan.kind === kind)
    if (plans.length === 0) return null
    return (
      <div className="grid gap-2" aria-label={kind === "level_test" ? "레벨테스트 예약 목록" : "방문상담 예약 목록"}>
        {plans.map((plan) => {
          const owner = trackContexts.find((context) => context.track.id === activeTrackId)
          if (!owner) return null
          const participantSubjectLabel = plan.participantSubjects.join("·") || "과목"
          const label = kind === "level_test"
            ? plan.status === "completed" ? "레벨테스트 결과 보기" : "예약 및 과목별 결과 관리"
            : "방문상담 예약 수정"
          return (
            <div key={plan.appointmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="flex flex-wrap gap-1" aria-label={`${label} 적용 과목`}>
                {plan.participantSubjects.map((subject) => (
                  <Badge key={subject} variant="secondary">{subject}</Badge>
                ))}
              </div>
              <Button
                type="button"
                data-registration-appointment-plan-action=""
                data-registration-appointment-subjects={plan.participantSubjects.join("|")}
                aria-label={`${participantSubjectLabel} ${label}`}
                variant="outline"
                size="sm"
                onClick={() => openAppointment(owner, kind, plan.appointmentId)}
              >
                {label}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  const editorAppointment = appointmentEditor?.appointmentId
    ? detail.appointments.find((item) => item.id === appointmentEditor.appointmentId) || null
    : null
  const appointmentActivities = appointmentEditor?.kind === "level_test"
    ? detail.levelTests
    : detail.consultations.filter((item) => item.mode === "visit")
  const appointmentEditorParticipantTrackIds = appointmentEditor ? appointmentDraftParticipantTrackIds : []
  const appointmentEditorContent = appointmentEditor ? (
    <div
      ref={appointmentEditorRef}
      hidden={!(activeTrackId && appointmentEditorParticipantTrackIds.includes(activeTrackId))}
      data-registration-appointment-focus={editorAppointment?.id || ""}
      className="grid scroll-m-4 gap-2"
    >
      <RegistrationAppointmentEditor
        key={`${appointmentEditor.kind}:${editorAppointment?.id || "new"}:${editorAppointment?.notificationRevision ?? "new"}`}
        kind={appointmentEditor.kind}
        taskId={detail.task.id}
        eligibleTracks={orderedTracks}
        initialTrackId={appointmentEditor.initialTrackId}
        appointment={editorAppointment}
        activities={appointmentActivities}
        embedded
        onSaved={handleAppointmentSaved}
        onWarning={onWarning}
        onReload={onReload}
        onClose={closeAppointmentEditor}
        onRebook={appointmentEditor.kind === "level_test" ? (trackId) => {
          onFocusTrack(trackId)
          onAppointmentOpenChange?.(null)
          setAppointmentDraftParticipantTrackIds([trackId])
          setAppointmentEditor({ kind: "level_test", appointmentId: null, initialTrackId: trackId })
        } : undefined}
        notificationToken={notificationToken}
        onDirtyChange={(dirty) => setDirty(`${appointmentEditor.kind === "level_test" ? "level_test" : "consultation"}:appointment-${editorAppointment?.id || "new"}`, dirty)}
        onTrackDirtyChange={(trackId, dirty) => setDirty(`level_test:track-${trackId}`, dirty)}
        onParticipantTrackIdsChange={handleAppointmentParticipantTrackIdsChange}
      />
    </div>
  ) : null

  return (
    <RegistrationApplicationShell
      mode="detail"
      studentName={detail.task.studentName || detail.task.title}
      closeAction={closeAction}
      historyAction={<RegistrationApplicationHistoryAction detail={detail} profiles={profiles} />}
      tracks={orderedTracks.map((track) => ({
        key: track.id,
        subject: track.subject,
        statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status],
      }))}
      progress={<RegistrationApplicationProgressStepper steps={getRegistrationApplicationProgress(activeTrack?.status || "inquiry", activeTrack?.waitingKind || "")} />}
      sectionStates={sectionStates}
      inquiry={(
        <RegistrationApplicationInquirySection
          mode="detail"
          editable={sectionStates.inquiry.editable}
          lockReason={sectionStates.inquiry.lockReason}
          onDirtyChange={(scope, dirty) => setDirty(`inquiry:${scope}`, dirty)}
          commonInfoContent={(
            <RegistrationCommonInfoSection
              key={detail.task.id}
              task={detail.task}
              commonRevision={detail.commonRevision}
              identityLocked={getRegistrationIdentityEditLock(detail)}
              canEdit={canManageCase}
              schools={schools}
              schoolCatalogStatus={schoolCatalogStatus}
              schoolCatalogError={schoolCatalogError}
              onRetrySchools={onRetrySchools}
              embedded
              onSave={saveCommon}
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty("inquiry:common", dirty)}
            />
          )}
          subjectSyncContent={(
            <RegistrationSubjectSyncSection
              key={`${detail.task.id}:${orderedTracks.map((track) => track.id).join(",")}`}
              detail={detail}
              canManage={canManageCase}
              subjectCapabilities={subjectCapabilities}
              embedded
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty("inquiry:subjects", dirty)}
            />
          )}
          exceptionContent={(
            <div className="grid gap-3">
              {renderTrackFrames("inquiry")}
            </div>
          )}
        />
      )}
      levelTest={(
        <RegistrationApplicationLevelTestSection editable={sectionStates.level_test.editable}>
          <RegistrationApplicationSubjectTabs tracks={orderedTracks.map((track) => ({ id: track.id, subject: track.subject, statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status] }))} value={activeTrackId} panelIdsByTrackId={subjectPanelIdsByTrackId} onValueChange={handleSubjectTabChange} />
          <RegistrationLevelTestSummary detail={detail} trackId={activeTrackId} />
          {renderTrackFrames("level_test")}
          {renderAppointmentActionPlans("level_test")}
          {appointmentEditor?.kind === "level_test" ? appointmentEditorContent : null}
        </RegistrationApplicationLevelTestSection>
      )}
      consultation={(
        <RegistrationApplicationConsultationSection editable={sectionStates.consultation.editable}>
          <RegistrationApplicationSubjectTabs tracks={orderedTracks.map((track) => ({ id: track.id, subject: track.subject, statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status] }))} value={activeTrackId} panelIdsByTrackId={subjectPanelIdsByTrackId} onValueChange={handleSubjectTabChange} />
          <RegistrationConsultationSummary detail={detail} trackId={activeTrackId} />
          {renderTrackFrames("consultation")}
          {renderAppointmentActionPlans("visit_consultation")}
          {appointmentEditor?.kind === "visit_consultation" ? appointmentEditorContent : null}
        </RegistrationApplicationConsultationSection>
      )}
      waitingState={waitingState}
      registrationState={registrationState}
      waiting={(
        <RegistrationApplicationPlacementSection
          editable={waitingState.editable}
          fields={(
            <div className="grid gap-3">
              <RegistrationApplicationSubjectTabs tracks={orderedTracks.map((track) => ({ id: track.id, subject: track.subject, statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status] }))} value={activeTrackId} panelIdsByTrackId={subjectPanelIdsByTrackId} onValueChange={handleSubjectTabChange} />
              {renderTrackFrames("placement", "waiting")}
            </div>
          )}
        />
      )}
      registration={(
        <RegistrationApplicationPlacementSection
          editable={registrationState.editable}
          fields={(
            <div className="grid gap-3">
              <RegistrationApplicationSubjectTabs tracks={orderedTracks.map((track) => ({ id: track.id, subject: track.subject, statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status] }))} value={activeTrackId} panelIdsByTrackId={subjectPanelIdsByTrackId} onValueChange={handleSubjectTabChange} />
              {renderTrackFrames("placement", "registration")}
            </div>
          )}
        />
      )}
      admission={(
        <RegistrationApplicationAdmissionSection
          editable={sectionStates.admission.editable}
          fields={(
            <div className="grid gap-3">
              <RegistrationApplicationSubjectTabs tracks={orderedTracks.map((track) => ({ id: track.id, subject: track.subject, statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status] }))} value={activeTrackId} panelIdsByTrackId={subjectPanelIdsByTrackId} onValueChange={handleSubjectTabChange} />
              {renderTrackFrames("admission")}
              {admissionTargetTracks.length > 0 ? (
                <div className="flex flex-wrap gap-1" aria-label="입학신청서 발송 과목">
                  {admissionTargetTracks.map((track) => (
                    <Badge key={track.id} variant="outline">{track.subject}</Badge>
                  ))}
                </div>
              ) : null}
              <RegistrationAdmissionPanel
                taskId={detail.task.id}
                tracks={orderedTracks}
                enrollments={detail.enrollments}
                batches={detail.admissionBatches}
                classes={classOptions}
                admissionNoticeSent={Boolean(detail.task.registration?.admissionNoticeSent)}
                admissionApplicationMessageId={detail.admissionApplicationMessageId}
                admissionApplicationMessageStatus={detail.admissionApplicationMessageStatus}
                admissionApplicationMessageClaimActive={detail.admissionApplicationMessageClaimActive}
                admissionApplicationMessageUpdatedAt={detail.admissionApplicationMessageUpdatedAt}
                permissions={{ canManage: canManageCase, readOnly: !canManageCase }}
                {...admissionActions}
                onReload={onReload}
                onWarning={onWarning}
                onDirtyChange={(scope, dirty) => setDirty(scope.kind === "message_evidence"
                  ? "admission:message"
                  : `admission:batch-${scope.batchId}`, dirty)}
              />
            </div>
          )}
        />
      )}
    />
  )
}
