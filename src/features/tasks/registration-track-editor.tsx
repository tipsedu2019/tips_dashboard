"use client"

import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"

import { RegistrationApplicationAdmissionSection } from "./registration-application-admission-section"
import { RegistrationApplicationConsultationSection } from "./registration-application-consultation-section"
import {
  RegistrationApplicationInquirySection,
  RegistrationInquiryEditor,
  type RegistrationInquiryDraft,
} from "./registration-application-inquiry-section"
import { RegistrationApplicationLevelTestSection } from "./registration-application-level-test-section"
import {
  getRegistrationApplicationAppointmentActionPlans,
  getRegistrationApplicationCaseEditableSections,
  getRegistrationEnrollmentDirtyKey,
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  resolveRegistrationActiveTrackId,
  settleRegistrationConflictComparison,
  updateRegistrationApplicationDirtyKeys,
  type RegistrationApplicationDirtyKey,
  type RegistrationApplicationSectionKey,
} from "./registration-application-model"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationHistoryAction } from "./registration-application-history-action"
import { RegistrationApplicationShell } from "./registration-application-shell"
import { RegistrationApplicationSubjectTabs } from "./registration-application-subject-tabs"
import {
  REGISTRATION_DIRECTOR_VISIBLE_STATUSES,
  REGISTRATION_TRACK_STATUS_LABELS,
  RegistrationConsultationOutcomeEditor,
  RegistrationEnrollmentTrackEditor,
  RegistrationMigrationConflictNotice,
  RegistrationMigrationReviewEditor,
  RegistrationTrackDirectorSection,
  RegistrationWaitingDetailsEditor,
  getRegistrationIdentityEditLock,
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
  saveRegistrationCaseInquiry,
  setRegistrationWorkflowStatus,
  type OpsRegistrationAppointment,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationConsultation,
  type OpsRegistrationTrackSummary,
  type RegistrationAppointmentMutationResponse,
} from "./registration-track-service"
import {
  REGISTRATION_WORKFLOW_STATUS_LABELS,
  getRegistrationWorkflowStatusOptions,
} from "./registration-workflow-status.js"

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
  latestConsultation: OpsRegistrationConsultation | null
  visitConsultation: OpsRegistrationConsultation | null
  visitAppointment: OpsRegistrationAppointment | null
}

type RegistrationPlacementMode = "waiting" | "registration"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function hasRegistrationTrackFrameContent({
  section,
  context,
  placementMode,
  reviewTrackId,
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  placementMode?: RegistrationPlacementMode
  reviewTrackId: string | null
}) {
  const { track } = context
  if (section === "admission") return false
  if (section === "inquiry") return track.migrationReviewRequired && reviewTrackId === track.id
  if (track.migrationReviewRequired) return section === "placement" && placementMode === "waiting"
  return section === "consultation"
    || (section === "placement" && (placementMode === "waiting" || placementMode === "registration"))
}

function getRegistrationTrackFocusPanelId(context: TrackContext, reviewTrackId: string | null) {
  const { track } = context
  const { currentSection } = context.state
  if (track.migrationReviewRequired) {
    return reviewTrackId ? `registration-inquiry-${reviewTrackId}` : null
  }
  if (currentSection === "admission" || currentSection === "level_test") return null
  const panelSection = currentSection === "placement"
    ? track.status === "waiting" ? "waiting" : "registration"
    : currentSection
  return `registration-${panelSection}-${track.id}`
}

function RegistrationTrackSectionFrame({
  section,
  context,
  selected,
  children,
  placementMode,
  labelledByTrackId,
  displaySubject,
}: {
  section: RegistrationApplicationSectionKey
  context: TrackContext
  selected: boolean
  children?: ReactNode
  placementMode?: RegistrationPlacementMode
  labelledByTrackId?: string
  displaySubject?: string
}) {
  const sectionState = context.state.sections[section]
  const placementCurrent = section !== "placement" || placementMode === "waiting"
    ? context.track.status === "waiting"
    : ["enrollment_decided", "enrollment_processing", "registered", "not_registered"].includes(context.track.status)
  const displayCurrent = section === "placement" ? placementCurrent : sectionState.current
  const panelSection = section === "placement" ? placementMode || "registration" : section
  const visibleChildren = Children.toArray(children)
  const hasVisibleContent = visibleChildren.length > 0
  return (
    <article
      role="tabpanel"
      id={`registration-${panelSection}-${context.track.id}`}
      aria-labelledby={`registration-subject-tab-${labelledByTrackId || context.track.id}`}
      hidden={!selected}
      aria-current={displayCurrent ? "step" : undefined}
      data-registration-track-id={context.track.id}
      data-registration-subject={displaySubject || context.track.subject}
      data-registration-focus-track={selected ? labelledByTrackId || context.track.id : undefined}
      data-registration-state={sectionState.current ? "current" : sectionState.editable ? "ready" : "locked"}
      className={[
        "min-w-0 scroll-mt-52 lg:scroll-mt-40",
        hasVisibleContent ? "grid gap-3" : "py-1",
      ].filter(Boolean).join(" ")}
    >
      {hasVisibleContent ? (
        <fieldset disabled={!sectionState.editable} className="m-0 min-w-0 border-0 p-0">
          {visibleChildren}
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">입력된 내용 없음</p>
      )}
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
  onDirtyChange,
  notificationToken = "",
  closeAction,
}: RegistrationApplicationProps) {
  const [migrationConflictState, setMigrationConflictState] = useState<RegistrationMigrationConflictState | null>(null)
  const [migrationConflictRetrying, setMigrationConflictRetrying] = useState(false)
  const [migrationDirectorResetVersion, setMigrationDirectorResetVersion] = useState(0)
  const [migrationReviewResetVersion, setMigrationReviewResetVersion] = useState(0)
  const [workflowStatusSaving, setWorkflowStatusSaving] = useState(false)
  const dirtyKeysRef = useRef<Set<RegistrationApplicationDirtyKey>>(new Set())
  const dirtyProducersRef = useRef(new Map<RegistrationApplicationDirtyKey, Set<string>>())
  const onDirtyChangeRef = useRef(onDirtyChange)
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
    const activeConsultation = detail.consultations.find((item) => (
      item.trackId === track.id
      && ((track.status === "consultation_waiting" && item.mode === "phone" && item.status === "waiting")
        || (track.status === "visit_consultation_scheduled" && item.mode === "visit" && item.status === "scheduled"))
    )) || null
    const visitConsultation = detail.consultations.find((item) => item.trackId === track.id && item.mode === "visit" && item.status === "scheduled") || null
    const latestConsultation = detail.consultations
      .filter((item) => item.trackId === track.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null
    return {
      track,
      permissions: permissionsByTrackId.get(track.id) || { canManage: false, canCompleteConsultation: false, readOnly: true },
      state: trackStates.find((state) => state.trackId === track.id)!,
      activeConsultation,
      latestConsultation,
      visitConsultation,
      visitAppointment: visitConsultation?.appointmentId
        ? detail.appointments.find((item) => item.id === visitConsultation.appointmentId) || null
        : null,
    }
  })
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
  const openSectionStates = Object.fromEntries(
    Object.entries(sectionStates).map(([section, state]) => [section, {
      ...state,
      current: section !== "history",
      upcoming: false,
      editable: section === "history" ? false : section === "admission" ? admissionEditable : canManageCase,
      lockReason: section === "history"
        ? "저장 시 자동 기록됩니다"
        : canManageCase ? "" : "등록 정보를 수정할 권한이 없습니다",
    }]),
  ) as typeof sectionStates
  const splitPlacementState = () => {
    return {
      current: true,
      editable: canManageCase,
      upcoming: false,
      lockReason: canManageCase ? "" : "등록 정보를 수정할 권한이 없습니다",
    }
  }
  const waitingState = splitPlacementState()
  const registrationState = splitPlacementState()
  const focusedContext = trackContexts.find((context) => context.track.id === activeTrackId) || null
  const workflowStatusOptions = activeTrack
    ? getRegistrationWorkflowStatusOptions({
      viewerId,
      viewerRole,
      directorProfileId: activeTrack.directorProfileId,
    })
    : []
  async function changeWorkflowStatus(nextStatus: string) {
    if (!activeTrack || nextStatus === activeTrack.workflowStatus || workflowStatusSaving) return
    setWorkflowStatusSaving(true)
    try {
      await setRegistrationWorkflowStatus({
        trackId: activeTrack.id,
        workflowStatus: nextStatus as typeof activeTrack.workflowStatus,
        expectedWorkflowRevision: activeTrack.workflowRevision,
        requestKey: `registration-workflow-status:${activeTrack.id}:${crypto.randomUUID()}`,
      })
      await onReload(activeTrack.id)
    } catch (error) {
      onWarning(errorMessage(error, "진행상태를 변경하지 못했습니다. 최신 정보를 확인해 주세요."))
    } finally {
      setWorkflowStatusSaving(false)
    }
  }
  const migrationReviewPanelId = reviewTrack ? `registration-inquiry-${reviewTrack.id}` : null
  const subjectPanelIdsByTrackId = Object.fromEntries(trackContexts.map((context) => [
    context.track.id,
    context.track.migrationReviewRequired
      ? migrationReviewPanelId ? [migrationReviewPanelId] : []
      : [
      { section: "inquiry" as const, panel: "inquiry" as const, placementMode: undefined },
      { section: "level_test" as const, panel: "level_test" as const, placementMode: undefined },
      { section: "consultation" as const, panel: "consultation" as const, placementMode: undefined },
      { section: "placement" as const, panel: "waiting" as const, placementMode: "waiting" as const },
      { section: "placement" as const, panel: "registration" as const, placementMode: "registration" as const },
    ].filter((candidate) => hasRegistrationTrackFrameContent({
      section: candidate.section,
      context,
      placementMode: candidate.placementMode,
      reviewTrackId: reviewTrack?.id || null,
    })).map((candidate) => `registration-${candidate.panel}-${context.track.id}`),
  ]))

  useEffect(() => {
    if (!activeTrackId || focusTrackId === activeTrackId) return
    onFocusTrack(activeTrackId)
  }, [activeTrackId, focusTrackId, onFocusTrack])

  useEffect(() => {
    const initialFocusRequest = initialFocusRequestRef.current
    if (!focusTrackId || !focusedContext || focusTrackId !== activeTrackId) return
    if (initialFocusRequest.taskId !== detail.task.id || initialFocusRequest.trackId !== focusTrackId) return
    if (initialFocusAppliedRef.current === detail.task.id) return
    const focusPanelId = getRegistrationTrackFocusPanelId(focusedContext, reviewTrack?.id || null)
    if (!focusPanelId) return
    const frame = window.requestAnimationFrame(() => {
      initialFocusAppliedRef.current = detail.task.id
      document.getElementById(focusPanelId)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTrackId, detail.task.id, focusTrackId, focusedContext, reviewTrack?.id])

  async function saveInquiry(draft: RegistrationInquiryDraft, requestKey: string) {
    try {
      await saveRegistrationCaseInquiry({
        ...draft,
        schoolName: draft.schoolName.trim(),
        parentPhone: draft.parentPhone.trim(),
        studentPhone: draft.studentPhone.trim(),
        campus: draft.campus.trim(),
        inquiryAt: draft.inquiryAt,
        requestNote: draft.requestNote.trim(),
        taskId: detail.task.id,
        expectedCommonRevision: detail.commonRevision,
        expectedSubjects: orderedTracks.map((track) => track.subject),
        requestKey,
      })
    } catch (error) {
      const message = errorMessage(error, "")
      if (
        message.includes("registration_common_revision_conflict")
        || message.includes("registration_subjects_conflict")
      ) {
        return "conflict" as const
      }
      throw error
    }
    return "saved" as const
  }

  function handleSubjectTabChange(trackId: string) {
    onFocusTrack(trackId)
  }

  async function handleAppointmentSaved(saved: RegistrationAppointmentMutationResponse) {
    await onAppointmentSaved?.(saved)
    await onReload()
    if (saved.requiresDirectorAssignmentTrackIds.length > 0) {
      onWarning("상담 책임자가 없는 과목을 먼저 지정하세요.")
    }
  }

  function renderTrackActions(context: TrackContext, section: RegistrationApplicationSectionKey, placementMode?: RegistrationPlacementMode) {
    const { track, permissions } = context
    if (section === "placement" && placementMode === "waiting") {
      return (
        <RegistrationWaitingDetailsEditor
          track={track}
          currentClassWaitClassId={getRegistrationCurrentClassWaitClassId({ trackId: track.id, waitingKind: track.waitingKind, enrollments: detail.enrollments })}
          permissions={permissions}
          classOptions={classOptions}
          onReload={onReload}
          onWarning={onWarning}
          onDirtyChange={(dirty) => setDirty(`placement:track-${track.id}`, dirty)}
        />
      )
    }
    if (track.migrationReviewRequired) return null
    if (section === "placement" && placementMode === "registration") {
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
    return null
  }

  function renderTrackFrames(section: RegistrationApplicationSectionKey, placementMode?: RegistrationPlacementMode) {
    return trackContexts
      .filter((context) => hasRegistrationTrackFrameContent({
        section,
        context,
        placementMode,
        reviewTrackId: reviewTrack?.id || null,
      }))
      .map((context) => {
        const sharedMigrationFrame = section === "inquiry" && reviewTrack?.id === context.track.id
        return (
        <RegistrationTrackSectionFrame
          key={`${section}:${context.track.id}`}
          section={section}
          context={context}
          selected={sharedMigrationFrame ? Boolean(activeTrack?.migrationReviewRequired) : activeTrackId === context.track.id}
          placementMode={placementMode}
          labelledByTrackId={sharedMigrationFrame ? activeTrack?.id || context.track.id : context.track.id}
          displaySubject={sharedMigrationFrame ? activeTrack?.subject || context.track.subject : context.track.subject}
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
            onOpenVisit={onFocusTrack}
            onReload={onReload}
            onWarning={onWarning}
            onDirtyChange={(dirty) => setDirty(`consultation:track-${context.track.id}`, dirty, `director:${context.track.id}`)}
          />
        ) : null}
        {renderTrackActions(context, section, placementMode)}
        {section === "consultation"
          && context.latestConsultation
          && (context.permissions.canManage || context.permissions.canCompleteConsultation) ? (
            <RegistrationConsultationOutcomeEditor
              key={`consultation:${context.latestConsultation.id}:${context.latestConsultation.updatedAt}`}
              subject={context.track.subject}
              consultation={context.latestConsultation}
              active
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty(`consultation:track-${context.track.id}`, dirty, `outcome:${context.latestConsultation?.id || context.track.id}`)}
            />
          ) : null}
        </RegistrationTrackSectionFrame>
        )
      })
  }

  const activeLevelTestPlan = activeAppointmentActionPlans.find((plan) => (
    plan.kind === "level_test" && plan.appointmentId === initialAppointmentId
  )) || activeAppointmentActionPlans.find((plan) => plan.kind === "level_test") || null
  const activeVisitPlan = activeAppointmentActionPlans.find((plan) => (
    plan.kind === "visit_consultation" && plan.appointmentId === initialAppointmentId
  )) || activeAppointmentActionPlans.find((plan) => plan.kind === "visit_consultation") || null
  const activeLevelTestAppointment = activeLevelTestPlan
    ? detail.appointments.find((item) => item.id === activeLevelTestPlan.appointmentId) || null
    : null
  const activeVisitAppointment = activeVisitPlan
    ? detail.appointments.find((item) => item.id === activeVisitPlan.appointmentId) || null
    : null

  return (
    <RegistrationApplicationShell
      mode="detail"
      studentName={detail.task.studentName || detail.task.title}
      closeAction={closeAction}
      historyAction={<RegistrationApplicationHistoryAction detail={detail} profiles={profiles} />}
      subjectNavigation={(
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
          <RegistrationApplicationSubjectTabs
            tracks={orderedTracks.map((track) => ({
              id: track.id,
              subject: track.subject,
              statusLabel: REGISTRATION_WORKFLOW_STATUS_LABELS[track.workflowStatus] || REGISTRATION_TRACK_STATUS_LABELS[track.status],
            }))}
            value={activeTrackId}
            panelIdsByTrackId={subjectPanelIdsByTrackId}
            onValueChange={handleSubjectTabChange}
          />
          {activeTrack ? (
            <label data-registration-workflow-status="" className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">진행상태</span>
              <select
                aria-label={`${activeTrack.subject} 진행상태`}
                value={activeTrack.workflowStatus}
                disabled={workflowStatusSaving || workflowStatusOptions.length === 0}
                onChange={(event) => void changeWorkflowStatus(event.target.value)}
                className="h-10 min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={activeTrack.workflowStatus}>{REGISTRATION_WORKFLOW_STATUS_LABELS[activeTrack.workflowStatus]}</option>
                {workflowStatusOptions.filter((option) => option.value !== activeTrack.workflowStatus).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}
      progress={null}
      sectionStates={openSectionStates}
      inquiry={(
        <RegistrationApplicationInquirySection
          mode="detail"
          editable={openSectionStates.inquiry.editable}
          lockReason={openSectionStates.inquiry.lockReason}
          editorContent={(
            <RegistrationInquiryEditor
              key={detail.task.id}
              detail={detail}
              identityLocked={getRegistrationIdentityEditLock(detail)}
              canEdit={canManageCase}
              subjectCapabilities={subjectCapabilities}
              schools={schools}
              schoolCatalogStatus={schoolCatalogStatus}
              schoolCatalogError={schoolCatalogError}
              onRetrySchools={onRetrySchools}
              onSave={saveInquiry}
              onReload={onReload}
              onWarning={onWarning}
              onDirtyChange={(dirty) => setDirty("inquiry:editor", dirty)}
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
        <RegistrationApplicationLevelTestSection editable={openSectionStates.level_test.editable}>
          {activeTrack ? (
            <RegistrationAppointmentEditor
              key={`level_test:${activeTrack.id}:${activeLevelTestAppointment?.id || "new"}:${activeLevelTestAppointment?.notificationRevision ?? "new"}`}
              kind="level_test"
              taskId={detail.task.id}
              eligibleTracks={orderedTracks}
              initialTrackId={activeTrack.id}
              appointment={activeLevelTestAppointment}
              activities={detail.levelTests}
              embedded
              subjectScoped
              visibleTrackId={activeTrack.id}
              onSaved={handleAppointmentSaved}
              onWarning={onWarning}
              onReload={onReload}
              notificationToken={notificationToken}
              onDirtyChange={(dirty) => setDirty(`level_test:appointment-${activeLevelTestAppointment?.id || activeTrack.id}`, dirty)}
              onTrackDirtyChange={(trackId, dirty) => setDirty(`level_test:track-${trackId}`, dirty)}
            />
          ) : null}
        </RegistrationApplicationLevelTestSection>
      )}
      consultation={(
        <RegistrationApplicationConsultationSection editable={openSectionStates.consultation.editable}>
          {renderTrackFrames("consultation")}
          {activeTrack ? (
            <RegistrationAppointmentEditor
              key={`visit_consultation:${activeTrack.id}:${activeVisitAppointment?.id || "new"}:${activeVisitAppointment?.notificationRevision ?? "new"}`}
              kind="visit_consultation"
              taskId={detail.task.id}
              eligibleTracks={orderedTracks}
              initialTrackId={activeTrack.id}
              appointment={activeVisitAppointment}
              activities={detail.consultations.filter((item) => item.mode === "visit")}
              embedded
              subjectScoped
              visibleTrackId={activeTrack.id}
              onSaved={handleAppointmentSaved}
              onWarning={onWarning}
              onReload={onReload}
              notificationToken={notificationToken}
              onDirtyChange={(dirty) => setDirty(`consultation:appointment-${activeVisitAppointment?.id || activeTrack.id}`, dirty)}
            />
          ) : null}
        </RegistrationApplicationConsultationSection>
      )}
      waitingState={waitingState}
      registrationState={registrationState}
      waiting={(
        <RegistrationApplicationPlacementSection
          editable={waitingState.editable}
          fields={(
            <div className="grid gap-3">
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
              {renderTrackFrames("placement", "registration")}
            </div>
          )}
        />
      )}
      admission={(
        <RegistrationApplicationAdmissionSection
          editable={openSectionStates.admission.editable}
          fields={(
            <div className="grid gap-3">
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
