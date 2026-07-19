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
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  updateRegistrationApplicationDirtyKeys,
  type RegistrationApplicationDirtyKey,
  type RegistrationApplicationSectionKey,
} from "./registration-application-model"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationShell } from "./registration-application-shell"
import {
  REGISTRATION_DIRECTOR_VISIBLE_STATUSES,
  REGISTRATION_TRACK_STATUS_LABELS,
  RegistrationCommonInfoSection,
  RegistrationConsultationOutcomeEditor,
  RegistrationConsultationSummary,
  RegistrationEnrollmentTrackEditor,
  RegistrationLevelTestSummary,
  RegistrationMigrationReviewEditor,
  RegistrationPlacementSummary,
  RegistrationSubjectProgress,
  RegistrationSubjectSyncSection,
  RegistrationTrackDirectorSection,
  RegistrationTrackStageEditor,
  getRegistrationIdentityEditLock,
  type RegistrationCommonDraft,
  type RegistrationTrackActionPermissions,
} from "./registration-application-track-actions"
import { RegistrationAppointmentEditor } from "./registration-appointment-editor"
import {
  RegistrationAdmissionPanel,
  type RegistrationAdmissionPanelProps,
} from "./registration-enrollment-editor"
import { RegistrationHistoryTimeline } from "./registration-history-timeline"
import type {
  OpsClassOption,
  OpsProfileOption,
  OpsTask,
  OpsTeacherOption,
  OpsTextbookOption,
} from "./ops-task-service"
import { type RegistrationDirectorCatalogStatus } from "./registration-director-default.js"
import {
  getRegistrationActionPermissions,
  getRegistrationAdmissionApplicationState,
  getRegistrationCurrentClassWaitClassId,
} from "./registration-track-model.js"
import {
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
  onRetryDirectorCatalog?: () => boolean | Promise<boolean>
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
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  detail: OpsRegistrationCaseDetail
  classOptions: OpsClassOption[]
  textbookOptions: OpsTextbookOption[]
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
      valueField("진행상태", REGISTRATION_TRACK_STATUS_LABELS[track.status]),
      valueField("상담 책임자", track.directorName || "미지정"),
    ]
  } else if (section === "level_test") {
    fields = [
      valueField("진행상태", latestLevelTest ? latestLevelTest.status : "기록 없음"),
      valueField("예약일시", formatDateTime(levelTestAppointment?.scheduledAt)),
      valueField("장소", levelTestAppointment?.place || "기록 없음"),
      valueField("시험 시작·완료 상태", latestLevelTest?.status || "기록 없음"),
      valueField("시험지·결과지 링크", latestLevelTest?.materialLink || "기록 없음"),
      valueField("결과", latestLevelTest?.status === "completed" ? "완료" : "기록 없음"),
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
    fields = [
      valueField("대기 종류", WAITING_KIND_LABELS[track.waitingKind]),
      valueField("대기 수업", track.waitingKind === "current_class" ? classItem?.label || "기록 없음" : "해당 없음"),
      valueField("등록 단계", REGISTRATION_TRACK_STATUS_LABELS[track.status]),
      valueField("수강 수업", classItem?.label || "기록 없음"),
      valueField("교재", textbook?.label || "기록 없음"),
      valueField("수업 시작일·회차", [latestEnrollment?.classStartDate, latestEnrollment?.classStartSession].filter(Boolean).join(" · ") || "기록 없음"),
      valueField("입학 처리 시작 행동", latestEnrollment?.admissionBatchId ? "입학 처리 진행" : "기록 없음"),
      valueField("문의 요청 사항", detail.task.registration?.requestNote || "기록 없음"),
    ]
  } else {
    fields = [
      valueField("진행상태", REGISTRATION_TRACK_STATUS_LABELS[track.status]),
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
  focused,
  children,
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  detail: OpsRegistrationCaseDetail
  classOptions: OpsClassOption[]
  textbookOptions: OpsTextbookOption[]
  focused: boolean
  children?: ReactNode
}) {
  const sectionState = context.state.sections[section]
  return (
    <article
      id={`registration-${section}-${context.track.id}`}
      aria-current={sectionState.current ? "step" : undefined}
      data-registration-track-id={context.track.id}
      data-registration-focus-track={focused ? context.track.id : undefined}
      className={[
        "grid min-w-0 gap-3 rounded-md border p-3",
        focused ? "border-primary/60 bg-primary/[0.025]" : "bg-background",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{context.track.subject}</h4>
        <Badge variant={sectionState.current ? "default" : "outline"}>
          {sectionState.current ? "현재 · " : ""}{REGISTRATION_TRACK_STATUS_LABELS[context.track.status]}
        </Badge>
      </div>
      <RegistrationTrackSectionValues
        section={section}
        context={context}
        detail={detail}
        classOptions={classOptions}
        textbookOptions={textbookOptions}
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
  onRetryDirectorCatalog,
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
  const dirtyKeysRef = useRef<Set<RegistrationApplicationDirtyKey>>(new Set())
  const dirtyProducersRef = useRef(new Map<RegistrationApplicationDirtyKey, Set<string>>())
  const onDirtyChangeRef = useRef(onDirtyChange)
  const appointmentEditorRef = useRef<HTMLDivElement | null>(null)
  const initialAppointmentAppliedRef = useRef("")
  const canManageCase = viewerRole === "admin" || viewerRole === "staff"
  const reviewTrack = detail.tracks.find((track) => track.migrationReviewRequired) || null
  const reviewBlocked = Boolean(reviewTrack)

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange
  }, [onDirtyChange])
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

  const permissionsByTrackId = useMemo(() => new Map(detail.tracks.map((track) => {
    const activeConsultation = detail.consultations.find((item) => (
      item.trackId === track.id
      && ((track.status === "consultation_waiting" && item.mode === "phone" && item.status === "waiting")
        || (track.status === "visit_consultation_scheduled" && item.mode === "visit" && item.status === "scheduled"))
    )) || null
    return [track.id, getRegistrationActionPermissions({ viewerId, viewerRole, track, activeConsultation }) as RegistrationTrackActionPermissions]
  })), [detail.consultations, detail.tracks, viewerId, viewerRole])
  const trackStates = detail.tracks.map((track) => getRegistrationApplicationTrackState({
    track,
    canManage: permissionsByTrackId.get(track.id)?.canManage || false,
    canCompleteConsultation: permissionsByTrackId.get(track.id)?.canCompleteConsultation || false,
  }))
  const trackContexts: TrackContext[] = detail.tracks.map((track) => {
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
  const admissionApplicationState = getRegistrationAdmissionApplicationState({
    tracks: detail.tracks,
    enrollments: detail.enrollments,
    admissionNoticeSent: Boolean(detail.task.registration?.admissionNoticeSent),
    admissionApplicationMessageStatus: detail.admissionApplicationMessageStatus,
    admissionApplicationMessageClaimActive: detail.admissionApplicationMessageClaimActive,
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
    tracks: detail.tracks,
    appointments: detail.appointments,
    levelTests: detail.levelTests,
    consultations: detail.consultations,
    actionableTrackIds: detail.tracks
      .filter((track) => permissionsByTrackId.get(track.id)?.canManage)
      .map((track) => track.id),
  })
  const appointmentActionSections = appointmentActionPlans.flatMap((plan) => (
    permissionsByTrackId.get(plan.ownerTrackId)?.canManage
      ? [plan.kind === "level_test" ? "level_test" as const : "consultation" as const]
      : []
  ))
  const caseEditableSections = getRegistrationApplicationCaseEditableSections({
    canManage: canManageCase,
    admissionMessageEditable: admissionEditable,
    admissionBatches: detail.admissionBatches,
    appointmentActionSections,
  })
  const sectionStates = getRegistrationApplicationSectionStates({
    tracks: trackStates,
    caseEditableSections,
  })
  const focusedState = trackStates.find((state) => state.trackId === focusTrackId) || null

  useEffect(() => {
    if (!focusTrackId || !focusedState) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`registration-${focusedState.currentSection}-${focusTrackId}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusTrackId, focusedState])

  useEffect(() => {
    if (!initialAppointmentId) {
      initialAppointmentAppliedRef.current = ""
      return
    }
    const initialKey = `${detail.task.id}:${initialAppointmentId}`
    if (initialAppointmentAppliedRef.current === initialKey) return
    const appointment = detail.appointments.find((item) => item.id === initialAppointmentId) || null
    if (!appointment) return
    const participantTrackIds = appointment.kind === "level_test"
      ? detail.levelTests.filter((item) => item.appointmentId === appointment.id).map((item) => item.trackId)
      : detail.consultations.filter((item) => item.appointmentId === appointment.id && item.mode === "visit").map((item) => item.trackId)
    const initialTrackId = focusTrackId && participantTrackIds.includes(focusTrackId)
      ? focusTrackId
      : participantTrackIds[0] || detail.tracks[0]?.id || ""
    const frame = window.requestAnimationFrame(() => {
      initialAppointmentAppliedRef.current = initialKey
      setAppointmentEditor({ kind: appointment.kind, appointmentId: appointment.id, initialTrackId })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detail.appointments, detail.consultations, detail.levelTests, detail.task.id, detail.tracks, focusTrackId, initialAppointmentId])

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
        try {
          await onReload()
          return "conflict_reloaded" as const
        } catch {
          throw new Error("다른 사용자의 변경은 감지했지만 최신 정보를 다시 불러오지 못했습니다. 최신 정보로 다시 시도하려면 창을 닫고 다시 여세요.")
        }
      }
      throw error
    }
    try {
      await onReload()
    } catch {
      return "committed_refresh_pending" as const
    }
    return "saved" as const
  }

  function openAppointment(context: TrackContext, kind: OpsRegistrationAppointment["kind"], appointmentId: string | null) {
    onFocusTrack(context.track.id)
    setAppointmentEditor({ kind, appointmentId, initialTrackId: context.track.id })
    onAppointmentOpenChange?.(appointmentId)
  }

  function closeAppointmentEditor() {
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

  function renderTrackActions(context: TrackContext, section: RegistrationApplicationSectionKey) {
    const { track, permissions, activeConsultation, visitAppointment } = context
    if (reviewBlocked) return null
    if (section === "placement" && ["enrollment_decided", "enrollment_processing", "registered"].includes(track.status)) {
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
          onDirtyChange={(dirty) => setDirty(`placement:enrollments-${track.id}`, dirty)}
        />
      )
    }
    if (context.state.currentSection !== section) return null
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

  function renderTrackFrames(section: RegistrationApplicationSectionKey) {
    return trackContexts.map((context) => (
      <RegistrationTrackSectionFrame
        key={`${section}:${context.track.id}`}
        section={section}
        context={context}
        detail={detail}
        classOptions={classOptions}
        textbookOptions={textbookOptions}
        focused={focusTrackId === context.track.id}
      >
        {section === "consultation" && REGISTRATION_DIRECTOR_VISIBLE_STATUSES.has(context.track.status) && !reviewBlocked ? (
          <RegistrationTrackDirectorSection
            task={task}
            detail={detail}
            track={context.track}
            permissions={context.permissions}
            directorOptions={directorOptions}
            teacherOptions={teacherOptions}
            directorCatalogStatus={directorCatalogStatus}
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
        {renderTrackActions(context, section)}
        {section === "consultation"
          && context.activeConsultation
          && context.permissions.canCompleteConsultation ? (
            <RegistrationConsultationOutcomeEditor
              key={`consultation:${context.activeConsultation.id}:${context.activeConsultation.updatedAt}`}
              subject={context.track.subject}
              consultation={context.activeConsultation}
              active
              classOptions={classOptions}
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty(`consultation:track-${context.track.id}`, dirty, `outcome:${context.activeConsultation?.id || context.track.id}`)}
            />
          ) : null}
      </RegistrationTrackSectionFrame>
    ))
  }

  function renderAppointmentActionPlans(kind: OpsRegistrationAppointment["kind"]) {
    const plans = appointmentActionPlans.filter((plan) => plan.kind === kind)
    if (plans.length === 0) return null
    return (
      <div className="grid gap-2" aria-label={kind === "level_test" ? "레벨테스트 예약 목록" : "방문상담 예약 목록"}>
        {plans.map((plan) => {
          const owner = trackContexts.find((context) => context.track.id === plan.ownerTrackId)
          if (!owner) return null
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
              <Button type="button" variant="outline" size="sm" onClick={() => openAppointment(owner, kind, plan.appointmentId)}>
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
  const appointmentParticipantIds = editorAppointment
    ? appointmentActivities.filter((item) => item.appointmentId === editorAppointment.id).map((item) => item.trackId)
    : appointmentEditor?.initialTrackId ? [appointmentEditor.initialTrackId] : []
  const appointmentEditorContent = appointmentEditor ? (
    <div ref={appointmentEditorRef} className="grid scroll-m-4 gap-2">
      <div className="flex flex-wrap gap-1" aria-label="예약 적용 과목">
        {detail.tracks.filter((track) => appointmentParticipantIds.includes(track.id)).map((track) => (
          <Badge key={track.id} variant="secondary">{track.subject}</Badge>
        ))}
      </div>
      <RegistrationAppointmentEditor
        key={`${appointmentEditor.kind}:${editorAppointment?.id || "new"}:${editorAppointment?.notificationRevision ?? "new"}`}
        kind={appointmentEditor.kind}
        taskId={detail.task.id}
        eligibleTracks={detail.tracks}
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
          setAppointmentEditor({ kind: "level_test", appointmentId: null, initialTrackId: trackId })
        } : undefined}
        notificationToken={notificationToken}
        onDirtyChange={(dirty) => setDirty(`${appointmentEditor.kind === "level_test" ? "level_test" : "consultation"}:appointment-${editorAppointment?.id || "new"}`, dirty)}
        onTrackDirtyChange={(trackId, dirty) => setDirty(`level_test:track-${trackId}`, dirty)}
      />
    </div>
  ) : null

  return (
    <RegistrationApplicationShell
      mode="detail"
      studentName={detail.task.studentName || detail.task.title}
      closeAction={closeAction}
      tracks={detail.tracks.map((track) => ({
        key: track.id,
        subject: track.subject,
        statusLabel: REGISTRATION_TRACK_STATUS_LABELS[track.status],
      }))}
      sectionStates={sectionStates}
      inquiry={(
        <RegistrationApplicationInquirySection
          mode="detail"
          inquiryAt={formatDateTime(detail.task.registration?.inquiryAt || detail.task.createdAt)}
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
              embedded
              onSave={saveCommon}
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty("inquiry:common", dirty)}
            />
          )}
          subjectSyncContent={(
            <RegistrationSubjectSyncSection
              key={`${detail.task.id}:${detail.tracks.map((track) => track.id).join(",")}`}
              detail={detail}
              canManage={canManageCase}
              embedded
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty("inquiry:subjects", dirty)}
            />
          )}
          exceptionContent={(
            <div className="grid gap-3">
              <RegistrationSubjectProgress detail={detail} selectedTrackId={focusTrackId} onSelectTrack={onFocusTrack} />
              {reviewTrack ? (
                <RegistrationMigrationReviewEditor
                  key={`${detail.task.id}:${detail.commonRevision}`}
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
                  onDirtyChange={(dirty) => setDirty(`inquiry:track-${reviewTrack.id}`, dirty)}
                />
              ) : null}
              {renderTrackFrames("inquiry")}
            </div>
          )}
        />
      )}
      levelTest={(
        <RegistrationApplicationLevelTestSection editable={sectionStates.level_test.editable}>
          <RegistrationLevelTestSummary detail={detail} />
          {renderTrackFrames("level_test")}
          {renderAppointmentActionPlans("level_test")}
          {appointmentEditor?.kind === "level_test" ? appointmentEditorContent : null}
        </RegistrationApplicationLevelTestSection>
      )}
      consultation={(
        <RegistrationApplicationConsultationSection editable={sectionStates.consultation.editable}>
          <RegistrationConsultationSummary detail={detail} />
          {renderTrackFrames("consultation")}
          {renderAppointmentActionPlans("visit_consultation")}
          {appointmentEditor?.kind === "visit_consultation" ? appointmentEditorContent : null}
        </RegistrationApplicationConsultationSection>
      )}
      placement={(
        <RegistrationApplicationPlacementSection
          editable={sectionStates.placement.editable}
          fields={(
            <div className="grid gap-3">
              <RegistrationPlacementSummary detail={detail} classes={classOptions} />
              {renderTrackFrames("placement")}
            </div>
          )}
        />
      )}
      admission={(
        <RegistrationApplicationAdmissionSection
          editable={sectionStates.admission.editable}
          fields={(
            <div className="grid gap-3">
              {renderTrackFrames("admission")}
              {detail.tracks.some((track) => track.status === "enrollment_decided") ? (
                <div className="flex flex-wrap gap-1" aria-label="입학신청서 발송 과목">
                  {detail.tracks.filter((track) => track.status === "enrollment_decided").map((track) => (
                    <Badge key={track.id} variant="outline">{track.subject}</Badge>
                  ))}
                </div>
              ) : null}
              <RegistrationAdmissionPanel
                taskId={detail.task.id}
                tracks={detail.tracks}
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
      history={<RegistrationHistoryTimeline detail={detail} profiles={profiles} />}
    />
  )
}
