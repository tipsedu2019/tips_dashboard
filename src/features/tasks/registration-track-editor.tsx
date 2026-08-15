"use client"

import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GoogleChatDeliveryControl } from "@/features/notifications/notification-delivery-control"
import { supabase } from "@/lib/supabase"

import { RegistrationApplicationAdmissionSection } from "./registration-application-admission-section"
import { RegistrationAlimtalkPreviewDialog } from "./registration-alimtalk-preview-dialog"
import { RegistrationApplicationConsultationSection } from "./registration-application-consultation-section"
import {
  RegistrationApplicationInquirySection,
  RegistrationInquiryEditor,
  type RegistrationInquiryDraft,
} from "./registration-application-inquiry-section"
import { RegistrationApplicationLevelTestSection } from "./registration-application-level-test-section"
import {
  canManageRegistrationObservationTrack,
  getRegistrationApplicationAppointmentActionPlans,
  getRegistrationApplicationCaseEditableSections,
  getRegistrationEnrollmentDirtyKey,
  getRegistrationApplicationSectionStates,
  getRegistrationApplicationTrackState,
  getRegistrationConsultationModeDraft,
  getRegistrationObservationRefreshPlan,
  resolveRegistrationApplicationFocusPanelId,
  resolveRegistrationActiveTrackId,
  settleRegistrationConflictComparison,
  updateRegistrationApplicationDirtyKeys,
  type RegistrationApplicationDirtyKey,
  type RegistrationApplicationSectionKey,
  type RegistrationConsultationMode,
} from "./registration-application-model"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationHistoryAction } from "./registration-application-history-action"
import { RegistrationApplicationShell } from "./registration-application-shell"
import { RegistrationApplicationSubjectTabs } from "./registration-application-subject-tabs"
import {
  RegistrationObservationEditor,
  buildRegistrationObservationWithdrawalInput,
  canLoadRegistrationObservationWorkspace,
  canUseRegistrationObservationDetail,
  getRegistrationObservationUiErrorMessage,
  type RegistrationObservationActions,
} from "./registration-observation-editor"
import {
  RegistrationObservationFeedbackPanel,
  canEditRegistrationObservationFeedback,
  canKeepRegistrationObservationFeedbackHistoryMounted,
  getRegistrationObservationFeedbackMountPlan,
  getRegistrationObservationFeedbackRefreshPlan,
  loadRegistrationObservationFeedbackForOwnedPanel,
  shouldMountRegistrationObservationFeedbackOnly,
  type RegistrationObservationFeedbackActions,
} from "./registration-observation-feedback-panel"
import {
  REGISTRATION_DIRECTOR_VISIBLE_STATUSES,
  REGISTRATION_TRACK_STATUS_LABELS,
  RegistrationConsultationOutcomeEditor,
  RegistrationEnrollmentTrackEditor,
  RegistrationMigrationConflictNotice,
  RegistrationMigrationReviewEditor,
  RegistrationTrackDirectorSection,
  RegistrationWaitingDetailsEditor,
  canStartRegistrationObservation,
  getRegistrationIdentityEditLock,
  type RegistrationMigrationConflictState,
  type RegistrationMigrationDirtyScope,
  type RegistrationTrackActionPermissions,
  type RegistrationTrackDirectorSectionHandle,
} from "./registration-application-track-actions"
import { RegistrationAppointmentEditor } from "./registration-appointment-editor"
import { RegistrationSaveButton } from "./registration-save-button"
import { clearRegistrationEnrollmentDrafts } from "./registration-enrollment-editor"
import { RegistrationAdmissionPanel } from "./registration-enrollment-editor"
import type {
  RegistrationCustomerMessageClient,
  RegistrationCustomerMessageTarget,
} from "./registration-customer-message-contract"
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
import {
  getRegistrationObservationFeedbackErrorState,
  type RegistrationObservationAttempt,
  type RegistrationObservationFeedbackDetail,
  type RegistrationObservationManagerDetail,
  type RegistrationObservationRuntimeState,
} from "./registration-observation-model"
import {
  cancelRegistrationObservation,
  correctRegistrationObservationFeedback,
  decideRegistrationObservation,
  enterRegistrationObservation,
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerDetail,
  loadRegistrationObservationSessions,
  recordRegistrationObservationAttendance,
  saveRegistrationObservationBooking,
  submitRegistrationObservationFeedback,
  withdrawRegistrationObservation,
  type RegistrationObservationClient,
} from "./registration-observation-service"
import { ACADEMIC_SUBJECT_VALUES } from "../../lib/academic-subject-registry.ts"
import {
  getRegistrationActionPermissions,
  getRegistrationActiveConsultation,
  getRegistrationAdmissionApplicationState,
  getRegistrationCurrentClassWaitClassId,
  shouldRenderRegistrationConsultationOutcome,
} from "./registration-track-model.js"
import {
  ensureRegistrationWorkflowNotificationSourceIds,
  saveRegistrationCaseInquiry,
  saveRegistrationPhoneConsultation,
  setRegistrationWorkflowStatus,
  isOpsRegistrationWorkflowStatus,
  type OpsRegistrationAppointment,
  type OpsRegistrationCaseDetail,
  type OpsRegistrationObservationCaseDetail,
  type OpsRegistrationConsultation,
  type OpsRegistrationWorkflowStatus,
  type RegistrationAppointmentMutationResponse,
} from "./registration-track-service"
import { createRegistrationObservationAsyncOwnership } from "./registration-workspace-route"
import {
  dispatchRegistrationManagementNotificationSources,
  isRegistrationManagementNotificationWorkflowStatus,
} from "./registration-consultation-notification.js"
import {
  REGISTRATION_WORKFLOW_STATUS_LABELS,
  getRegistrationWorkflowViewKey,
  getRegistrationWorkflowStatusOptions,
  isRegistrationObservationWorkflowStatus,
} from "./registration-workflow-status.js"

const UNAVAILABLE_REGISTRATION_OBSERVATION_RUNTIME: RegistrationObservationRuntimeState = {
  available: false,
  runtimeVersion: 0,
}

const registrationObservationClient = supabase as unknown as RegistrationObservationClient
const registrationObservationActions: RegistrationObservationActions = {
  enterRegistrationObservation: (input) => enterRegistrationObservation(registrationObservationClient, input),
  loadRegistrationObservationSessions: (input) => loadRegistrationObservationSessions(registrationObservationClient, input),
  saveRegistrationObservationBooking: (input) => saveRegistrationObservationBooking(registrationObservationClient, input),
  cancelRegistrationObservation: (input) => cancelRegistrationObservation(registrationObservationClient, input),
  withdrawRegistrationObservation: (input) => withdrawRegistrationObservation(registrationObservationClient, input),
}
const registrationObservationFeedbackActions: RegistrationObservationFeedbackActions = {
  recordRegistrationObservationAttendance: (input) => (
    recordRegistrationObservationAttendance(registrationObservationClient, input)
  ),
  submitRegistrationObservationFeedback: (input) => (
    submitRegistrationObservationFeedback(registrationObservationClient, input)
  ),
  correctRegistrationObservationFeedback: (input) => (
    correctRegistrationObservationFeedback(registrationObservationClient, input)
  ),
  decideRegistrationObservation: (input) => (
    decideRegistrationObservation(registrationObservationClient, input)
  ),
}

export type RegistrationTrackViewerRole = "admin" | "staff" | "assistant" | "teacher" | null

export type RegistrationApplicationProps = {
  task: OpsTask
  detail: OpsRegistrationObservationCaseDetail
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
  customerMessageClient: RegistrationCustomerMessageClient
  initialAppointmentId?: string | null
  onAppointmentOpenChange?: (appointmentId: string | null) => void
  onDirtyChange?: (dirty: boolean) => void
  notificationToken?: string
  observationRuntime?: RegistrationObservationRuntimeState
  deepLinkedAttempt?: RegistrationObservationAttempt | null
  closeAction: ReactNode
}

type TrackContext = {
  track: OpsRegistrationCaseDetail["tracks"][number]
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
  if (isRegistrationObservationWorkflowStatus(track.workflowStatus)) return false
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
  customerMessageClient,
  initialAppointmentId = null,
  onDirtyChange,
  notificationToken = "",
  observationRuntime = UNAVAILABLE_REGISTRATION_OBSERVATION_RUNTIME,
  deepLinkedAttempt = null,
  closeAction,
}: RegistrationApplicationProps) {
  const [customerMessageTarget, setCustomerMessageTarget] = useState<RegistrationCustomerMessageTarget | null>(null)
  const customerMessageTriggerRef = useRef<HTMLElement | null>(null)
  const customerMessageReloadGenerationRef = useRef(0)
  const customerMessageTaskIdRef = useRef(detail.task.id)
  const [migrationConflictState, setMigrationConflictState] = useState<RegistrationMigrationConflictState | null>(null)
  const [migrationConflictRetrying, setMigrationConflictRetrying] = useState(false)
  const [migrationDirectorResetVersion, setMigrationDirectorResetVersion] = useState(0)
  const [migrationReviewResetVersion, setMigrationReviewResetVersion] = useState(0)
  const [workflowStatusSaving, setWorkflowStatusSaving] = useState(false)
  const [latestGoogleChatEventId, setLatestGoogleChatEventId] = useState<string | null>(null)
  const [observationDetail, setObservationDetail] = useState<RegistrationObservationManagerDetail | null>(null)
  const [observationDetailLoading, setObservationDetailLoading] = useState(false)
  const [observationDetailError, setObservationDetailError] = useState("")
  const [observationFeedbackDetail, setObservationFeedbackDetail] = useState<RegistrationObservationFeedbackDetail | null>(null)
  const [observationFeedbackLoading, setObservationFeedbackLoading] = useState(false)
  const [observationFeedbackError, setObservationFeedbackError] = useState("")
  const observationManagerLoadOwnershipRef = useRef(createRegistrationObservationAsyncOwnership())
  const observationFeedbackLoadOwnershipRef = useRef(createRegistrationObservationAsyncOwnership())
  const activeObservationFeedbackKeyRef = useRef("")
  const activeObservationManagerKeyRef = useRef("")
  const activeObservationViewerIdRef = useRef(viewerId || "")
  const activeObservationRuntimeVersionRef = useRef(observationRuntime.runtimeVersion)
  activeObservationViewerIdRef.current = viewerId || ""
  activeObservationRuntimeVersionRef.current = observationRuntime.runtimeVersion
  const [consultationModeDrafts, setConsultationModeDrafts] = useState<Record<string, RegistrationConsultationMode>>({})
  const [consultationDirectorDirtyByTrackId, setConsultationDirectorDirtyByTrackId] = useState<Record<string, boolean>>({})
  const [consultationSharedSaving, setConsultationSharedSaving] = useState(false)
  const activeConsultationDirectorRef = useRef<RegistrationTrackDirectorSectionHandle | null>(null)
  const dirtyKeysRef = useRef<Set<RegistrationApplicationDirtyKey>>(new Set())
  const dirtyProducersRef = useRef(new Map<RegistrationApplicationDirtyKey, Set<string>>())
  const onDirtyChangeRef = useRef(onDirtyChange)
  const initialFocusRequestRef = useRef({ taskId: detail.task.id, trackId: focusTrackId })
  const initialFocusAppliedRef = useRef("")
  if (initialFocusRequestRef.current.taskId !== detail.task.id) {
    initialFocusRequestRef.current = { taskId: detail.task.id, trackId: focusTrackId }
  }
  const canManageCase = viewerRole === "admin" || viewerRole === "staff"
  const openCustomerMessage = useCallback((target: RegistrationCustomerMessageTarget) => {
    if (!canManageCase) return
    customerMessageTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setCustomerMessageTarget(target)
  }, [canManageCase])
  if (customerMessageTaskIdRef.current !== detail.task.id) {
    customerMessageTaskIdRef.current = detail.task.id
    customerMessageReloadGenerationRef.current += 1
  }
  const reloadAfterCustomerMessageSend = useCallback(async () => {
    if (!canManageCase) return
    const taskId = detail.task.id
    const generation = ++customerMessageReloadGenerationRef.current
    await onReload()
    if (
      generation !== customerMessageReloadGenerationRef.current
      || taskId !== customerMessageTaskIdRef.current
    ) return
  }, [canManageCase, detail.task.id, onReload])
  const orderedTracks = useMemo(() => [...detail.tracks].sort((left, right) => (
    ACADEMIC_SUBJECT_VALUES.indexOf(left.subject) - ACADEMIC_SUBJECT_VALUES.indexOf(right.subject)
    || left.id.localeCompare(right.id)
  )), [detail.tracks])
  const genericTracks = useMemo(
    () => orderedTracks.flatMap((track) => {
      if (!isOpsRegistrationWorkflowStatus(track.workflowStatus)) return []
      return [{ ...track, workflowStatus: track.workflowStatus }]
    }),
    [orderedTracks],
  )
  const genericDetail = useMemo<OpsRegistrationCaseDetail>(() => ({
    ...detail,
    tracks: genericTracks,
  }), [detail, genericTracks])
  const activeTrackId = resolveRegistrationActiveTrackId(orderedTracks, focusTrackId)
  const activeTrack = orderedTracks.find((track) => track.id === activeTrackId) || null
  const activeGenericTrack = genericTracks.find((track) => track.id === activeTrackId) || null
  const activeObservationTrackId = activeTrack?.id || null
  const activeDeepLinkedAttempt = deepLinkedAttempt
    && deepLinkedAttempt.taskId === detail.task.id
    && deepLinkedAttempt.trackId === activeTrack?.id
    ? deepLinkedAttempt
    : null
  const canManageActiveObservation = activeTrack
    ? canManageRegistrationObservationTrack({
        viewerId,
        viewerRole,
        directorProfileId: activeTrack.directorProfileId,
      })
    : false
  const activeDeepLinkedAttemptTerminal = Boolean(
    activeDeepLinkedAttempt
    && ["completed", "no_show", "canceled"].includes(activeDeepLinkedAttempt.status),
  )
  const activeDeepLinkedAttemptCanceled = activeDeepLinkedAttempt?.status === "canceled"
  const deepLinkedObservationHistoryEligible = activeDeepLinkedAttemptTerminal
    && canManageActiveObservation
  const activeObservationTrackIdRef = useRef(activeTrack?.id || null)
  const activeObservationTaskIdRef = useRef<string | null>(detail.task.id)
  activeObservationTrackIdRef.current = activeTrack?.id || null
  activeObservationTaskIdRef.current = detail.task.id
  const activeObservationDetail = canUseRegistrationObservationDetail({
    activeTrackId: activeTrack?.id || null,
    detailTrackId: observationDetail?.track.trackId || null,
  }) ? observationDetail : null
  const observationWorkflowActionable = Boolean(activeTrack && (
    canStartRegistrationObservation(activeTrack)
    || isRegistrationObservationWorkflowStatus(activeTrack.workflowStatus)
  ))
  const observationTrackEligible = Boolean(activeTrack && (
    observationWorkflowActionable
    || deepLinkedObservationHistoryEligible
    || canKeepRegistrationObservationFeedbackHistoryMounted({
      canManageCase,
      observationAttemptCount: activeTrack.observationAttemptCount,
    })
  ))
  const observationWorkspaceAvailable = Boolean(activeTrack && canLoadRegistrationObservationWorkspace({
    runtimeAvailable: observationRuntime.available && observationTrackEligible,
    observationSummaryVisible: activeTrack.observationSummaryVisible || deepLinkedObservationHistoryEligible,
  }))
  const activeObservationManagerKey = activeTrack && observationWorkspaceAvailable
    ? `${detail.task.id}:${activeTrack.id}:manager`
    : ""
  activeObservationManagerKeyRef.current = activeObservationManagerKey
  const reviewTrack = genericTracks.find((track) => track.migrationReviewRequired) || null
  const activeMigrationConflictState = migrationConflictState?.taskId === detail.task.id
    ? migrationConflictState
    : null

  useEffect(() => {
    setObservationDetail(null)
    setObservationDetailError("")
    if (
      !activeObservationTrackId
      || !activeObservationManagerKey
      || !observationWorkspaceAvailable
      || !viewerId
      || observationRuntime.runtimeVersion !== 1
    ) {
      observationManagerLoadOwnershipRef.current.invalidate()
      setObservationDetailLoading(false)
      return
    }
    const managerRequestContext = {
      targetKey: activeObservationManagerKey,
      viewerId,
      runtimeVersion: observationRuntime.runtimeVersion,
    } as const
    const managerOwnership = observationManagerLoadOwnershipRef.current
    const managerRequestToken = managerOwnership.begin(managerRequestContext)
    setObservationDetailLoading(true)
    void loadRegistrationObservationManagerDetail(registrationObservationClient, {
      trackId: activeObservationTrackId,
    }).then((nextDetail) => {
      const currentManagerRequestContext = {
        targetKey: activeObservationManagerKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (!observationManagerLoadOwnershipRef.current.owns(
        managerRequestToken,
        currentManagerRequestContext,
      )) return
      setObservationDetail(nextDetail)
      setObservationDetailLoading(false)
    }).catch((error) => {
      const currentManagerRequestContext = {
        targetKey: activeObservationManagerKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (!observationManagerLoadOwnershipRef.current.owns(
        managerRequestToken,
        currentManagerRequestContext,
      )) return
      setObservationDetailError(getRegistrationObservationUiErrorMessage(error, "청강 정보를 불러오지 못했습니다."))
      setObservationDetailLoading(false)
      observationManagerLoadOwnershipRef.current.invalidate(managerRequestToken)
    })
    return () => {
      managerOwnership.invalidate(managerRequestToken)
    }
  }, [
    activeObservationManagerKey,
    activeObservationTrackId,
    observationRuntime.runtimeVersion,
    observationWorkspaceAvailable,
    viewerId,
  ])

  useEffect(() => {
    const taskId = detail.task.id
    return () => {
      if (activeObservationTaskIdRef.current === taskId) {
        activeObservationTaskIdRef.current = null
        activeObservationTrackIdRef.current = null
      }
    }
  }, [detail.task.id])

  const handleObservationSaved = useCallback(async () => {
    if (
      !activeTrack
      || !activeObservationManagerKey
      || !observationWorkspaceAvailable
      || !viewerId
      || observationRuntime.runtimeVersion !== 1
    ) return
    const trackId = activeTrack.id
    const taskId = detail.task.id
    const refreshPlan = getRegistrationObservationRefreshPlan({
      savedTaskId: taskId,
      savedTrackId: trackId,
      activeTaskId: activeObservationTaskIdRef.current,
      activeTrackId: activeObservationTrackIdRef.current,
    })
    if (!refreshPlan.loadManagerDetail) {
      await onReload()
      return
    }
    const managerRequestContext = {
      targetKey: activeObservationManagerKey,
      viewerId,
      runtimeVersion: observationRuntime.runtimeVersion,
    } as const
    const managerRequestToken = observationManagerLoadOwnershipRef.current.begin(managerRequestContext)
    setObservationDetailLoading(true)
    setObservationDetailError("")
    try {
      const [nextDetail] = await Promise.all([
        loadRegistrationObservationManagerDetail(registrationObservationClient, { trackId }),
        onReload(refreshPlan.preferredTrackId),
      ])
      const currentManagerRequestContext = {
        targetKey: activeObservationManagerKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (!observationManagerLoadOwnershipRef.current.owns(
        managerRequestToken,
        currentManagerRequestContext,
      )) return
      const completionPlan = getRegistrationObservationRefreshPlan({
        savedTaskId: taskId,
        savedTrackId: trackId,
        activeTaskId: activeObservationTaskIdRef.current,
        activeTrackId: activeObservationTrackIdRef.current,
      })
      if (completionPlan.loadManagerDetail) setObservationDetail(nextDetail)
      setObservationDetailLoading(false)
    } catch (error) {
      const currentManagerRequestContext = {
        targetKey: activeObservationManagerKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (observationManagerLoadOwnershipRef.current.owns(
        managerRequestToken,
        currentManagerRequestContext,
      )) {
        setObservationDetailError(getRegistrationObservationUiErrorMessage(error, "청강 정보를 불러오지 못했습니다."))
        setObservationDetailLoading(false)
        observationManagerLoadOwnershipRef.current.invalidate(managerRequestToken)
      }
      throw error
    }
  }, [
    activeObservationManagerKey,
    activeTrack,
    detail.task.id,
    observationRuntime.runtimeVersion,
    observationWorkspaceAvailable,
    onReload,
    viewerId,
  ])

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
    setConsultationModeDrafts({})
    setConsultationDirectorDirtyByTrackId({})
    setConsultationSharedSaving(false)
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
    if (!isOpsRegistrationWorkflowStatus(track.workflowStatus)) {
      const canManageObservation = canManageRegistrationObservationTrack({
        viewerId,
        viewerRole,
        directorProfileId: track.directorProfileId,
      })
      return [track.id, {
        canManage: canManageObservation,
        canCompleteConsultation: false,
        readOnly: !canManageObservation,
      } satisfies RegistrationTrackActionPermissions] as const
    }
    const latestConsultation = detail.consultations
      .filter((item) => item.trackId === track.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] || null
    return [track.id, getRegistrationActionPermissions({ viewerId, viewerRole, track, activeConsultation: latestConsultation }) as RegistrationTrackActionPermissions]
  })), [detail.consultations, orderedTracks, viewerId, viewerRole])
  const trackStates = orderedTracks.map((track) => getRegistrationApplicationTrackState({
    track,
    canManage: permissionsByTrackId.get(track.id)?.canManage || false,
    canCompleteConsultation: permissionsByTrackId.get(track.id)?.canCompleteConsultation || false,
  }))
  const trackContexts: TrackContext[] = genericTracks.map((track) => {
    const activeConsultation = getRegistrationActiveConsultation({
      trackId: track.id,
      consultations: detail.consultations,
    })
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
  const activeCustomerMessageTarget = canManageCase && customerMessageTarget && (
    customerMessageTarget.messageKind === "admission_application"
      ? customerMessageTarget.sourceId === detail.task.id
      : customerMessageTarget.messageKind === "waiting_notice"
        ? orderedTracks.some((track) => track.id === customerMessageTarget.sourceId)
        : customerMessageTarget.messageKind === "observation_booking"
          ? activeObservationDetail?.track.taskId === detail.task.id
            && activeObservationDetail.currentObservation?.taskId === detail.task.id
            && activeObservationDetail.currentObservation.trackId === activeObservationDetail.track.trackId
            && activeObservationDetail.currentObservation.observationId === customerMessageTarget.sourceId
        : detail.appointments.some((appointment) => appointment.id === customerMessageTarget.sourceId)
  ) ? customerMessageTarget : null
  const admissionApplicationState = getRegistrationAdmissionApplicationState({
    tracks: genericTracks,
    enrollments: detail.enrollments,
    admissionNoticeSent: Boolean(detail.task.registration?.admissionNoticeSent),
    admissionApplicationMessageStatus: detail.admissionApplicationMessageStatus,
    admissionApplicationMessageClaimActive: detail.admissionApplicationMessageClaimActive,
  })
  const admissionTargetTracks = admissionApplicationState.targetTrackIds.flatMap((trackId) => {
    const track = genericTracks.find((item) => item.id === trackId)
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
    tracks: genericTracks,
    appointments: detail.appointments,
    levelTests: detail.levelTests,
    consultations: detail.consultations,
    actionableTrackIds: genericTracks
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
  const activeFeedbackMountPlan = getRegistrationObservationFeedbackMountPlan({
    managerDetail: activeObservationDetail,
    canManageObservation: canManageActiveObservation,
    canManageCase,
  })
  const activeFeedbackObservationId = activeDeepLinkedAttempt?.observationId
    || activeFeedbackMountPlan?.observationId
    || null
  const activeFeedbackCorrectionOnly = activeDeepLinkedAttempt
    ? activeDeepLinkedAttempt.decisionKind !== null
    : activeFeedbackMountPlan?.correctionOnly === true
  const activeFeedbackHistoryOnly = !activeDeepLinkedAttempt
    && shouldMountRegistrationObservationFeedbackOnly({
      correctionOnly: activeFeedbackCorrectionOnly,
      workflowActionable: observationWorkflowActionable,
    })
  const activeFeedbackTeacherProfileId = activeDeepLinkedAttempt?.teacherProfileId
    || activeObservationDetail?.currentObservation?.teacherProfileId
    || null
  const activeFeedbackOwnershipKey = activeTrack
    && activeFeedbackObservationId
    ? `${detail.task.id}:${activeTrack.id}:${activeFeedbackObservationId}`
    : ""
  activeObservationFeedbackKeyRef.current = activeFeedbackOwnershipKey

  useEffect(() => {
    const observationId = activeFeedbackObservationId
    const ownershipKey = activeObservationTrackId
      && observationId
      ? `${detail.task.id}:${activeObservationTrackId}:${observationId}`
      : ""
    setObservationFeedbackDetail(null)
    setObservationFeedbackError("")
    if (
      !ownershipKey
      || !observationId
      || !canManageActiveObservation
      || !observationWorkspaceAvailable
      || !viewerId
      || observationRuntime.runtimeVersion !== 1
    ) {
      observationFeedbackLoadOwnershipRef.current.invalidate()
      setObservationFeedbackLoading(false)
      return
    }
    const feedbackRequestContext = {
      targetKey: ownershipKey,
      viewerId,
      runtimeVersion: observationRuntime.runtimeVersion,
    } as const
    const feedbackOwnership = observationFeedbackLoadOwnershipRef.current
    const feedbackRequestToken = feedbackOwnership.begin(feedbackRequestContext)
    setObservationFeedbackLoading(true)
    void loadRegistrationObservationFeedback(
      registrationObservationClient,
      observationId,
    ).then((nextDetail) => {
      const currentFeedbackRequestContext = {
        targetKey: activeObservationFeedbackKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (!observationFeedbackLoadOwnershipRef.current.owns(
        feedbackRequestToken,
        currentFeedbackRequestContext,
      )) return
      setObservationFeedbackDetail(nextDetail)
      setObservationFeedbackLoading(false)
    }).catch((error) => {
      const currentFeedbackRequestContext = {
        targetKey: activeObservationFeedbackKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (!observationFeedbackLoadOwnershipRef.current.owns(
        feedbackRequestToken,
        currentFeedbackRequestContext,
      )) return
      setObservationFeedbackError(getRegistrationObservationFeedbackErrorState(error).message)
      setObservationFeedbackLoading(false)
      observationFeedbackLoadOwnershipRef.current.invalidate(feedbackRequestToken)
    })
    return () => {
      feedbackOwnership.invalidate(feedbackRequestToken)
    }
  }, [
    activeFeedbackObservationId,
    activeObservationTrackId,
    canManageActiveObservation,
    detail.task.id,
    observationRuntime.runtimeVersion,
    observationWorkspaceAvailable,
    viewerId,
  ])

  const refreshActiveObservationFeedback = useCallback(async (
    observationId: string = activeFeedbackObservationId || "",
  ) => {
    if (
      !canManageActiveObservation
      || !activeTrack
      || !observationId
      || !viewerId
      || observationRuntime.runtimeVersion !== 1
    ) return null
    const ownershipKey = `${detail.task.id}:${activeTrack.id}:${observationId}`
    const currentOwnershipKey = activeObservationFeedbackKeyRef.current
    const refreshPlan = getRegistrationObservationFeedbackRefreshPlan({
      requestedOwnershipKey: ownershipKey,
      currentOwnershipKey,
    })
    if (!refreshPlan.mutatePanelState) {
      return loadRegistrationObservationFeedbackForOwnedPanel({
        requestedOwnershipKey: ownershipKey,
        currentOwnershipKey,
        load: () => loadRegistrationObservationFeedback(
          registrationObservationClient,
          observationId,
          { force: true },
        ),
      })
    }
    const feedbackRequestContext = {
      targetKey: ownershipKey,
      viewerId,
      runtimeVersion: observationRuntime.runtimeVersion,
    } as const
    const feedbackRequestToken = observationFeedbackLoadOwnershipRef.current.begin(feedbackRequestContext)
    setObservationFeedbackLoading(true)
    setObservationFeedbackError("")
    const refreshedDetail = loadRegistrationObservationFeedbackForOwnedPanel({
      requestedOwnershipKey: ownershipKey,
      currentOwnershipKey,
      load: () => loadRegistrationObservationFeedback(
        registrationObservationClient,
        observationId,
        { force: true },
      ),
    })
    try {
      const nextDetail = await refreshedDetail
      if (!nextDetail) return null
      const currentFeedbackRequestContext = {
        targetKey: activeObservationFeedbackKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (observationFeedbackLoadOwnershipRef.current.owns(
        feedbackRequestToken,
        currentFeedbackRequestContext,
      )) setObservationFeedbackDetail(nextDetail)
      return nextDetail
    } catch (error) {
      const currentFeedbackRequestContext = {
        targetKey: activeObservationFeedbackKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (observationFeedbackLoadOwnershipRef.current.owns(
        feedbackRequestToken,
        currentFeedbackRequestContext,
      )) {
        setObservationFeedbackError(getRegistrationObservationFeedbackErrorState(error).message)
        setObservationFeedbackLoading(false)
        observationFeedbackLoadOwnershipRef.current.invalidate(feedbackRequestToken)
      }
      throw error
    } finally {
      const currentFeedbackRequestContext = {
        targetKey: activeObservationFeedbackKeyRef.current,
        viewerId: activeObservationViewerIdRef.current,
        runtimeVersion: activeObservationRuntimeVersionRef.current,
      } as const
      if (observationFeedbackLoadOwnershipRef.current.owns(
        feedbackRequestToken,
        currentFeedbackRequestContext,
      )) setObservationFeedbackLoading(false)
    }
  }, [
    activeFeedbackObservationId,
    activeTrack,
    canManageActiveObservation,
    detail.task.id,
    observationRuntime.runtimeVersion,
    viewerId,
  ])

  const handleObservationFeedbackSaved = useCallback(async (
    saved: RegistrationObservationFeedbackDetail,
  ) => {
    await handleObservationSaved()
    await refreshActiveObservationFeedback(saved.observationId)
  }, [handleObservationSaved, refreshActiveObservationFeedback])

  const reloadObservationFeedback = useCallback(async () => {
    if (!activeFeedbackObservationId) return
    await handleObservationSaved()
    await refreshActiveObservationFeedback(activeFeedbackObservationId)
  }, [activeFeedbackObservationId, handleObservationSaved, refreshActiveObservationFeedback])
  const canEnterObservationFromWorkflowStatus = Boolean(
    activeGenericTrack
    && canManageActiveObservation
    && observationRuntime.available
    && canStartRegistrationObservation(activeGenericTrack),
  )
  const observationSectionLockReason = !canManageActiveObservation
    ? "청강 예약을 처리할 권한이 없습니다"
    : observationWorkspaceAvailable
      ? ""
      : observationRuntime.available
        ? canEnterObservationFromWorkflowStatus
          ? "우측 진행상태에서 청강 예약 필요를 선택하세요"
          : "상담 완료 또는 대기 단계에서 청강 예약 필요를 선택하면 청강 회차를 예약할 수 있습니다."
        : "청강 신청 기능을 사용할 수 없습니다. 등록 정보를 다시 불러와 주세요."
  const openSectionStates = Object.fromEntries(
    Object.entries(sectionStates).map(([section, state]) => [section, {
      ...state,
      current: section !== "history",
      upcoming: false,
      editable: section === "history"
        ? false
        : section === "admission"
          ? admissionEditable
          : section === "observation" ? canManageActiveObservation && observationWorkspaceAvailable : canManageCase,
      lockReason: section === "history"
        ? "저장 시 자동 기록됩니다"
        : section === "observation"
          ? observationSectionLockReason
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
  const genericWorkflowStatusOptions = activeGenericTrack
    ? getRegistrationWorkflowStatusOptions({
      viewerId,
      viewerRole,
      directorProfileId: activeGenericTrack.directorProfileId,
    })
    : []
  const workflowStatusOptions = [
    ...genericWorkflowStatusOptions,
    ...(canEnterObservationFromWorkflowStatus
      ? [{ value: "observation_requested", label: REGISTRATION_WORKFLOW_STATUS_LABELS.observation_requested }]
      : []),
  ]
  const observationReturnWorkflowStatus = activeObservationDetail?.track.observationReturnWorkflowStatus
    ?? activeTrack?.observationReturnWorkflowStatus
    ?? null
  const observationHasCurrentAttempt = activeObservationDetail
    ? activeObservationDetail.currentObservation !== null
    : activeTrack?.observationCurrentId !== null
  const observationWorkflowStatusOptions = activeTrack
    && isRegistrationObservationWorkflowStatus(activeTrack.workflowStatus)
    && !observationHasCurrentAttempt
    && observationReturnWorkflowStatus
    && canManageActiveObservation
    ? [{
        value: observationReturnWorkflowStatus,
        label: REGISTRATION_WORKFLOW_STATUS_LABELS[observationReturnWorkflowStatus],
      }]
    : []
  async function changeWorkflowStatus(nextStatus: string) {
    if (!activeGenericTrack || nextStatus === activeGenericTrack.workflowStatus || workflowStatusSaving) return
    const nextOption = workflowStatusOptions.find((option) => option.value === nextStatus)
    if (!nextOption) return
    if (nextOption.value === "observation_requested") {
      if (!canEnterObservationFromWorkflowStatus) return
      setWorkflowStatusSaving(true)
      try {
        await registrationObservationActions.enterRegistrationObservation({
          trackId: activeGenericTrack.id,
          expectedWorkflowRevision: activeGenericTrack.workflowRevision,
          requestKey: `registration-observation-enter:${activeGenericTrack.id}:${crypto.randomUUID()}`,
        })
        await onReload(activeGenericTrack.id)
      } catch (error) {
        onWarning(getRegistrationObservationUiErrorMessage(
          error,
          "청강 진행상태를 변경하지 못했습니다. 최신 정보를 확인해 주세요.",
        ))
      } finally {
        setWorkflowStatusSaving(false)
      }
      return
    }
    if (
      isRegistrationObservationWorkflowStatus(activeGenericTrack.workflowStatus)
      || isRegistrationObservationWorkflowStatus(nextStatus)
    ) return
    setWorkflowStatusSaving(true)
    try {
      const savedStatus = await setRegistrationWorkflowStatus({
        trackId: activeGenericTrack.id,
        workflowStatus: nextOption.value as OpsRegistrationWorkflowStatus,
        expectedWorkflowRevision: activeGenericTrack.workflowRevision,
        requestKey: `registration-workflow-status:${activeGenericTrack.id}:${crypto.randomUUID()}`,
      })
      let managementNotificationFailed = false
      if (notificationToken && isRegistrationManagementNotificationWorkflowStatus(nextOption.value)) {
        try {
          const sourceEventIds = await ensureRegistrationWorkflowNotificationSourceIds({
            trackId: savedStatus.trackId,
            workflowRevision: savedStatus.workflowRevision,
          })
          const dispatchResult = await dispatchRegistrationManagementNotificationSources(
            sourceEventIds,
            notificationToken,
          )
          setLatestGoogleChatEventId(
            dispatchResult.googleChatEventIds[dispatchResult.googleChatEventIds.length - 1] || null,
          )
          managementNotificationFailed = sourceEventIds.length === 0
            || dispatchResult.failedSourceEventIds.length > 0
        } catch {
          managementNotificationFailed = true
        }
      }
      await onReload(activeGenericTrack.id)
      if (managementNotificationFailed) {
        onWarning("진행상태는 저장됐지만 관리팀 구글챗 알림은 전송하지 못했습니다.")
      }
    } catch (error) {
      onWarning(errorMessage(error, "진행상태를 변경하지 못했습니다. 최신 정보를 확인해 주세요."))
    } finally {
      setWorkflowStatusSaving(false)
    }
  }
  async function changeObservationWorkflowStatus(nextStatus: string) {
    if (
      !activeTrack
      || workflowStatusSaving
      || nextStatus === activeTrack.workflowStatus
    ) return
    const nextObservationStatus = observationWorkflowStatusOptions.find(
      (option) => option.value === nextStatus,
    )?.value
    if (!nextObservationStatus) return
    setWorkflowStatusSaving(true)
    try {
      await registrationObservationActions.withdrawRegistrationObservation(
        buildRegistrationObservationWithdrawalInput({
          trackId: activeTrack.id,
          workflowRevision: activeTrack.workflowRevision,
          exitKind: "return_to_previous",
          targetWorkflowStatus: nextObservationStatus,
          reason: "",
          requestKey: `registration-observation-withdraw:${activeTrack.id}:${crypto.randomUUID()}`,
          correction: null,
        }),
      )
      await onReload(activeTrack.id)
    } catch (error) {
      onWarning(getRegistrationObservationUiErrorMessage(
        error,
        "청강 진행상태를 변경하지 못했습니다. 최신 정보를 확인해 주세요.",
      ))
    } finally {
      setWorkflowStatusSaving(false)
    }
  }
  const migrationReviewPanelId = reviewTrack ? `registration-inquiry-${reviewTrack.id}` : null
  const subjectPanelIdsByTrackId = Object.fromEntries(orderedTracks.map((track) => {
    const context = trackContexts.find((candidate) => candidate.track.id === track.id)
    if (!context) return [track.id, ["registration-application-observation"]] as const
    return [context.track.id,
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
    ] as const
  }))

  useEffect(() => {
    if (!activeTrackId || focusTrackId === activeTrackId) return
    onFocusTrack(activeTrackId)
  }, [activeTrackId, focusTrackId, onFocusTrack])

  useEffect(() => {
    const initialFocusRequest = initialFocusRequestRef.current
    if (!focusTrackId || focusTrackId !== activeTrackId) return
    if (initialFocusRequest.taskId !== detail.task.id || initialFocusRequest.trackId !== focusTrackId) return
    if (initialFocusAppliedRef.current === detail.task.id) return
    const focusPanelId = resolveRegistrationApplicationFocusPanelId({
      focusTrackId,
      activeTrackId,
      observationFocusAvailable: Boolean(
        observationWorkspaceAvailable
        && activeTrack
        && (
          isRegistrationObservationWorkflowStatus(activeTrack.workflowStatus)
          || deepLinkedObservationHistoryEligible
        )
      ),
      genericFocusPanelId: focusedContext
        ? getRegistrationTrackFocusPanelId(focusedContext, reviewTrack?.id || null)
        : null,
    })
    if (!focusPanelId) return
    const frame = window.requestAnimationFrame(() => {
      initialFocusAppliedRef.current = detail.task.id
      document.getElementById(focusPanelId)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTrack, activeTrackId, deepLinkedObservationHistoryEligible, detail.task.id, focusTrackId, focusedContext, observationWorkspaceAvailable, reviewTrack?.id])

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
          onOpenCustomerMessage={openCustomerMessage}
        />
      )
    }
    if (track.migrationReviewRequired) return null
    if (section === "placement" && placementMode === "registration") {
      return (
        <RegistrationEnrollmentTrackEditor
          detail={genericDetail}
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

  function setConsultationDirectorDirty(trackId: string, dirty: boolean) {
    setConsultationDirectorDirtyByTrackId((current) => {
      if (Boolean(current[trackId]) === dirty) return current
      return { ...current, [trackId]: dirty }
    })
    setDirty(`consultation:track-${trackId}`, dirty, `director:${trackId}`)
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
                detail={genericDetail}
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
              detail={genericDetail}
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
            ref={activeTrackId === context.track.id ? activeConsultationDirectorRef : undefined}
            task={task}
            detail={genericDetail}
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
            onDirtyChange={(dirty) => setConsultationDirectorDirty(context.track.id, dirty)}
            sharedSave
          />
        ) : null}
        {renderTrackActions(context, section, placementMode)}
        {context.latestConsultation && shouldRenderRegistrationConsultationOutcome({
          section,
          consultation: context.latestConsultation,
          canEdit: Boolean(context.permissions.canManage || context.permissions.canCompleteConsultation || context.permissions.canEditConsultationResult),
        }) ? (
            <RegistrationConsultationOutcomeEditor
              key={`consultation:${context.latestConsultation.id}:${context.latestConsultation.updatedAt}`}
              subject={context.track.subject}
              consultation={context.latestConsultation}
              track={context.track}
              classOptions={classOptions}
              editable={Boolean(context.permissions.canCompleteConsultation || context.permissions.canEditConsultationResult)}
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
  const phoneConsultation = activeGenericTrack
    ? detail.consultations.find((item) => (
      item.trackId === activeGenericTrack.id && item.mode === "phone" && item.status !== "canceled"
    )) || null
    : null
  const activeConsultationMode = activeGenericTrack ? getRegistrationConsultationModeDraft({
    draftMode: consultationModeDrafts[activeGenericTrack.id] || null,
    hasVisitAppointment: Boolean(activeVisitAppointment),
  }) : null
  const activeConsultationDirectorDirty = activeGenericTrack
    ? Boolean(consultationDirectorDirtyByTrackId[activeGenericTrack.id])
    : false

  function selectConsultationMode(mode: RegistrationConsultationMode) {
    if (!activeGenericTrack || !activeConsultationMode || (mode === "phone" && activeConsultationMode.phoneDisabled)) return
    const next = getRegistrationConsultationModeDraft({
      draftMode: mode,
      hasVisitAppointment: Boolean(activeVisitAppointment),
    })
    setConsultationModeDrafts((current) => ({ ...current, [activeGenericTrack.id]: next.mode }))
    setDirty(`consultation:mode-${activeGenericTrack.id}`, next.dirty)
  }

  async function saveActiveConsultationDirector() {
    if (activeConsultationDirectorRef.current) {
      return activeConsultationDirectorRef.current.savePending()
    }
    if (activeGenericTrack?.directorProfileId) return true
    onWarning("상담 책임자를 선택하세요.")
    return false
  }

  async function savePhoneConsultation() {
    if (!activeGenericTrack || consultationSharedSaving) return
    setConsultationSharedSaving(true)
    try {
      const saved = await saveActiveConsultationDirector()
      if (!saved) return
      await saveRegistrationPhoneConsultation({
        trackId: activeGenericTrack.id,
        requestKey: `registration-phone-consultation:${activeGenericTrack.id}:${crypto.randomUUID()}`,
      })
      setDirty(`consultation:mode-${activeGenericTrack.id}`, false)
      await onReload(activeGenericTrack.id)
    } catch (error) {
      onWarning(errorMessage(error, "상담 정보를 저장하지 못했습니다."))
    } finally {
      setConsultationSharedSaving(false)
    }
  }

  const activeObservationFeedbackPanel = observationFeedbackDetail?.observationId
    === activeFeedbackObservationId ? (
      <RegistrationObservationFeedbackPanel
        detail={observationFeedbackDetail}
        canRecordAttendance={!activeDeepLinkedAttemptTerminal && canManageCase && !activeFeedbackCorrectionOnly}
        canEditFeedback={!activeDeepLinkedAttemptCanceled && (activeFeedbackCorrectionOnly
          ? canManageCase
          : canEditRegistrationObservationFeedback({
              canManageCase,
              isAssignedTeacher: Boolean(
                viewerId
                && viewerId === activeFeedbackTeacherProfileId
              ),
              decisionKind: observationFeedbackDetail.decisionKind,
            }))}
        canDecide={!activeDeepLinkedAttemptCanceled && !activeFeedbackCorrectionOnly && (
          canManageCase || Boolean(
            viewerId
            && viewerId === activeTrack?.directorProfileId
          )
        )}
        actions={registrationObservationFeedbackActions}
        onSaved={handleObservationFeedbackSaved}
        onReload={reloadObservationFeedback}
      />
    ) : observationFeedbackError ? (
      <p role="alert" className="text-sm text-destructive">{observationFeedbackError}</p>
    ) : observationFeedbackLoading ? (
      <p className="text-sm text-muted-foreground">청강 피드백을 불러오는 중입니다.</p>
    ) : null

  const registrationSection = (
    <RegistrationApplicationPlacementSection
      editable={registrationState.editable}
      fields={(
        <div className="grid gap-3">
          {renderTrackFrames("placement", "registration")}
        </div>
      )}
    />
  )

  return (
    <>
    <RegistrationApplicationShell
      mode="detail"
      studentName={detail.task.studentName || detail.task.title}
      closeAction={closeAction}
      historyAction={<RegistrationApplicationHistoryAction detail={genericDetail} profiles={profiles} />}
      subjectNavigation={(
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
          <RegistrationApplicationSubjectTabs
            tracks={orderedTracks.map((track) => ({
              id: track.id,
              subject: track.subject,
              statusLabel: REGISTRATION_WORKFLOW_STATUS_LABELS[track.workflowStatus] || REGISTRATION_TRACK_STATUS_LABELS[track.status],
              viewKey: getRegistrationWorkflowViewKey(track.workflowStatus),
            }))}
            value={activeTrackId}
            panelIdsByTrackId={subjectPanelIdsByTrackId}
            onValueChange={handleSubjectTabChange}
          />
          {activeGenericTrack ? (
            <div data-registration-workflow-status="" className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">진행상태</span>
              <select
                aria-label={`${activeGenericTrack.subject} 진행상태`}
                value={activeGenericTrack.workflowStatus}
                disabled={workflowStatusSaving || workflowStatusOptions.length === 0}
                onChange={(event) => void changeWorkflowStatus(event.target.value)}
                className="h-10 min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={activeGenericTrack.workflowStatus}>{REGISTRATION_WORKFLOW_STATUS_LABELS[activeGenericTrack.workflowStatus]}</option>
                {workflowStatusOptions.filter((option) => option.value !== activeGenericTrack.workflowStatus).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <GoogleChatDeliveryControl eventId={latestGoogleChatEventId} onWarning={onWarning} />
            </div>
          ) : activeTrack ? (
            <div data-registration-workflow-status="observation" className="grid min-w-0 gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">진행상태</span>
              <select
                aria-label={`${activeTrack.subject} 진행상태`}
                value={activeTrack.workflowStatus}
                disabled={workflowStatusSaving || observationWorkflowStatusOptions.length === 0}
                onChange={(event) => void changeObservationWorkflowStatus(event.target.value)}
                className="h-10 min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={activeTrack.workflowStatus}>{REGISTRATION_WORKFLOW_STATUS_LABELS[activeTrack.workflowStatus]}</option>
                {observationWorkflowStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
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
              detail={genericDetail}
              identityLocked={getRegistrationIdentityEditLock(genericDetail)}
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
          {activeGenericTrack ? (
            <RegistrationAppointmentEditor
              key={`level_test:${activeGenericTrack.id}:${activeLevelTestAppointment?.id || "new"}:${activeLevelTestAppointment?.notificationRevision ?? "new"}`}
              kind="level_test"
              taskId={detail.task.id}
              eligibleTracks={genericTracks}
              initialTrackId={activeGenericTrack.id}
              appointment={activeLevelTestAppointment}
              activities={detail.levelTests}
              embedded
              subjectScoped
              visibleTrackId={activeGenericTrack.id}
              onSaved={handleAppointmentSaved}
              onWarning={onWarning}
              onReload={onReload}
              notificationToken={notificationToken}
              onDirtyChange={(dirty) => setDirty(`level_test:appointment-${activeLevelTestAppointment?.id || activeGenericTrack.id}`, dirty)}
              onTrackDirtyChange={(trackId, dirty) => setDirty(`level_test:track-${trackId}`, dirty)}
              canOpenCustomerMessage={canManageCase}
              onOpenCustomerMessage={openCustomerMessage}
            />
          ) : null}
        </RegistrationApplicationLevelTestSection>
      )}
      consultation={(
        <RegistrationApplicationConsultationSection editable={openSectionStates.consultation.editable}>
          {activeGenericTrack && activeConsultationMode ? (
            <div className="grid gap-4">
              <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
                <legend className="text-sm font-medium">상담 방식</legend>
                <div role="group" aria-label={`${activeGenericTrack.subject} 상담 방식`} className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    aria-pressed={activeConsultationMode.mode === "phone"}
                    variant={activeConsultationMode.mode === "phone" ? "default" : "outline"}
                    className="h-10"
                    onClick={() => selectConsultationMode("phone")}
                    disabled={activeConsultationMode.phoneDisabled || consultationSharedSaving}
                  >전화상담</Button>
                  <Button
                    type="button"
                    aria-pressed={activeConsultationMode.mode === "visit"}
                    variant={activeConsultationMode.mode === "visit" ? "default" : "outline"}
                    className="h-10"
                    onClick={() => selectConsultationMode("visit")}
                    disabled={consultationSharedSaving}
                  >방문상담</Button>
                </div>
              </fieldset>

              {renderTrackFrames("consultation")}

              {activeConsultationMode.mode === "visit" ? (
                <RegistrationAppointmentEditor
                  key={`visit_consultation:${activeGenericTrack.id}:${activeVisitAppointment?.id || "new"}:${activeVisitAppointment?.notificationRevision ?? "new"}`}
                  kind="visit_consultation"
                  taskId={detail.task.id}
                  eligibleTracks={genericTracks}
                  initialTrackId={activeGenericTrack.id}
                  appointment={activeVisitAppointment}
                  activities={detail.consultations.filter((item) => item.mode === "visit")}
                  embedded
                  subjectScoped
                  visibleTrackId={activeGenericTrack.id}
                  onSaved={async (saved) => {
                    setDirty(`consultation:mode-${activeGenericTrack.id}`, false)
                    await handleAppointmentSaved(saved)
                  }}
                  onBeforeSave={saveActiveConsultationDirector}
                  externalDirty={activeConsultationDirectorDirty || activeConsultationMode.dirty}
                  actionLabel="상담 정보 저장"
                  saveAriaLabel={`${activeGenericTrack.subject} 상담 정보 저장`}
                  onWarning={onWarning}
                  onReload={onReload}
                  notificationToken={notificationToken}
                  onDirtyChange={(dirty) => setDirty(`consultation:appointment-${activeVisitAppointment?.id || activeGenericTrack.id}`, dirty)}
                  canOpenCustomerMessage={canManageCase}
                  onOpenCustomerMessage={openCustomerMessage}
                />
              ) : (
                <div className="flex justify-end">
                  <RegistrationSaveButton
                    type="button"
                    dirty={activeConsultationDirectorDirty || !phoneConsultation}
                    saving={consultationSharedSaving}
                    actionLabel="상담 정보 저장"
                    cleanLabel={phoneConsultation ? "저장됨" : activeGenericTrack.directorProfileId ? "상담 정보 저장" : "상담 책임자를 선택하세요"}
                    aria-label={`${activeGenericTrack.subject} 상담 정보 저장`}
                    onClick={() => void savePhoneConsultation()}
                  />
                </div>
              )}
            </div>
          ) : (
            renderTrackFrames("consultation")
          )}
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
      observation={observationWorkspaceAvailable ? (
        activeTrack && activeObservationDetail ? (
          activeFeedbackHistoryOnly ? activeObservationFeedbackPanel : (
            <RegistrationObservationEditor
              key={activeTrack.id}
              trackId={activeTrack.id}
              workflowRevision={activeTrack.workflowRevision}
              observationRevision={activeDeepLinkedAttempt?.revision
                ?? activeObservationDetail.currentObservation?.revision
                ?? null}
              appointmentNotificationRevision={activeDeepLinkedAttempt?.appointmentNotificationRevision
                ?? activeObservationDetail.currentObservation?.appointmentNotificationRevision
                ?? null}
              detail={activeObservationDetail}
              deepLinkedAttempt={activeDeepLinkedAttempt}
              actions={registrationObservationActions}
              onSaved={handleObservationSaved}
              onOpenCustomerMessage={canManageCase ? openCustomerMessage : undefined}
              feedbackPanel={activeObservationFeedbackPanel}
            />
          )
        ) : observationDetailError ? (
          <p role="alert" className="text-sm text-destructive">{observationDetailError}</p>
        ) : observationDetailLoading ? (
          <p className="text-sm text-muted-foreground">청강 정보를 불러오는 중입니다.</p>
        ) : null
      ) : (
        <p className="text-sm text-muted-foreground">
          {observationSectionLockReason}
        </p>
      )}
      registration={registrationSection}
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
                tracks={genericTracks}
                enrollments={detail.enrollments}
                batches={detail.admissionBatches}
                classes={classOptions}
                admissionNoticeSent={Boolean(detail.task.registration?.admissionNoticeSent)}
                admissionApplicationMessageStatus={detail.admissionApplicationMessageStatus}
                permissions={{ canManage: canManageCase, readOnly: !canManageCase }}
                onOpenCustomerMessage={openCustomerMessage}
                onReload={onReload}
                onWarning={onWarning}
                onDirtyChange={(scope, dirty) => setDirty(`admission:batch-${scope.batchId}`, dirty)}
              />
            </div>
          )}
        />
      )}
    />
    <RegistrationAlimtalkPreviewDialog
      open={Boolean(activeCustomerMessageTarget)}
      onOpenChange={(open) => {
        if (!open) setCustomerMessageTarget(null)
      }}
      target={activeCustomerMessageTarget}
      client={customerMessageClient}
      viewerRole={viewerRole || "assistant"}
      triggerRef={customerMessageTriggerRef}
      onSendSuccess={async () => {
        await reloadAfterCustomerMessageSend()
      }}
    />
    </>
  )
}
