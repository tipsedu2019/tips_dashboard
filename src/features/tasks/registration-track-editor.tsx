"use client"

import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

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
  resolveRegistrationWorkspaceWorkflowStatus,
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
  canLoadRegistrationObservationWorkspace,
  canUseRegistrationObservationDetail,
  getRegistrationObservationUiErrorMessage,
  type RegistrationObservationActions,
} from "./registration-observation-editor"
import {
  RegistrationObservationFeedbackPanel,
  getRegistrationObservationFeedbackMountPlan,
  getRegistrationObservationFeedbackRefreshPlan,
  loadRegistrationObservationFeedbackForOwnedPanel,
  shouldMountRegistrationObservationFeedbackOnly,
  type RegistrationObservationFeedbackActions,
} from "./registration-observation-feedback-panel"
import {
  REGISTRATION_TRACK_STATUS_LABELS,
  RegistrationConsultationOutcomeEditor,
  RegistrationEnrollmentTrackEditor,
  RegistrationMigrationConflictNotice,
  RegistrationMigrationReviewEditor,
  RegistrationTrackDirectorSection,
  RegistrationWaitingDetailsEditor,
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
  decideRegistrationObservation,
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerDetail,
  loadRegistrationObservationSessions,
  recordRegistrationObservationAttendance,
  saveRegistrationObservationBooking,
  type RegistrationObservationClient,
} from "./registration-observation-service"
import { ACADEMIC_SUBJECT_VALUES } from "../../lib/academic-subject-registry.ts"
import {
  canManageRegistrationCase,
  getRegistrationActionPermissions,
  getRegistrationActiveConsultation,
  shouldRenderRegistrationConsultationOutcome,
} from "./registration-track-model.js"
import {
  cancelRegistrationAppointment,
  ensureRegistrationWorkflowNotificationSourceIds,
  saveRegistrationConsultationDetails,
  saveRegistrationPhoneConsultation,
  syncRegistrationCaseSubjects,
  setRegistrationWorkflowStatus,
  updateRegistrationCaseCommon,
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
  getRegistrationManagementNotificationReadiness,
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
  loadRegistrationObservationSessions: (input) => loadRegistrationObservationSessions(registrationObservationClient, input),
  saveRegistrationObservationBooking: (input) => saveRegistrationObservationBooking(registrationObservationClient, input),
  cancelRegistrationObservation: (input) => cancelRegistrationObservation(registrationObservationClient, input),
}
const registrationObservationFeedbackActions: RegistrationObservationFeedbackActions = {
  recordRegistrationObservationAttendance: (input) => (
    recordRegistrationObservationAttendance(registrationObservationClient, input)
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
  if (section === "admission") return false
  if (section === "inquiry") return track.migrationReviewRequired && reviewTrackId === track.id
  return section === "consultation"
    || (section === "placement" && (placementMode === "waiting" || placementMode === "registration"))
}

function getRegistrationTrackFocusPanelId(context: TrackContext) {
  const { track } = context
  const { currentSection } = context.state
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
  const [managementNotificationSending, setManagementNotificationSending] = useState(false)
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
  const [consultationSwitchPending, setConsultationSwitchPending] = useState(false)
  const [consultationCancelPending, setConsultationCancelPending] = useState(false)
  const activeConsultationDirectorRef = useRef<RegistrationTrackDirectorSectionHandle | null>(null)
  const dirtyKeysRef = useRef<Set<RegistrationApplicationDirtyKey>>(new Set())
  const dirtyProducersRef = useRef(new Map<RegistrationApplicationDirtyKey, Set<string>>())
  const onDirtyChangeRef = useRef(onDirtyChange)
  const initialFocusRequestRef = useRef({ taskId: detail.task.id, trackId: focusTrackId })
  const initialFocusAppliedRef = useRef("")
  if (initialFocusRequestRef.current.taskId !== detail.task.id) {
    initialFocusRequestRef.current = { taskId: detail.task.id, trackId: focusTrackId }
  }
  const canManageCase = canManageRegistrationCase(viewerRole)
  useEffect(() => {
    if (canManageCase) return
    setConsultationSwitchPending(false)
    setConsultationCancelPending(false)
  }, [canManageCase])
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
    () => orderedTracks.map((track) => ({
      ...track,
      workflowStatus: resolveRegistrationWorkspaceWorkflowStatus(track),
    })),
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
  const observationWorkflowActionable = Boolean(
    activeTrack && canManageActiveObservation,
  )
  const observationWorkspaceAvailable = Boolean(activeTrack && canLoadRegistrationObservationWorkspace({
    runtimeAvailable: observationRuntime.available && canManageActiveObservation,
    observationSummaryVisible: true,
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
    onWarning("")
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
    onWarning,
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
            && activeObservationDetail.currentObservation?.status === "scheduled"
            && activeObservationDetail.currentObservation.appointmentStatus === "scheduled"
            && customerMessageTarget.sourceId === activeObservationDetail.currentObservation.observationId
        : customerMessageTarget.messageKind === "level_test_booking"
          || customerMessageTarget.messageKind === "visit_consultation_booking"
          ? detail.appointments.some((appointment) => (
            appointment.id === customerMessageTarget.sourceId
            && appointment.status === "scheduled"
            && appointment.kind === (customerMessageTarget.messageKind === "level_test_booking"
              ? "level_test"
              : "visit_consultation")
          ))
        : detail.appointments.some((appointment) => appointment.id === customerMessageTarget.sourceId)
  ) ? customerMessageTarget : null
  const scheduledAppointmentWindowComplete = !detail.collectionWindows
    || detail.collectionWindows.scheduledAppointments.overflow === false
  const currentEnrollmentWindowComplete = !detail.collectionWindows
    || detail.collectionWindows.currentEnrollments.overflow === false
  const canManageAppointments = canManageCase && scheduledAppointmentWindowComplete
  const admissionEditable = canManageCase && currentEnrollmentWindowComplete
  const appointmentActionPlans = getRegistrationApplicationAppointmentActionPlans({
    tracks: genericTracks,
    appointments: detail.appointments,
    levelTests: detail.levelTests,
    consultations: detail.consultations,
    actionableTrackIds: genericTracks
      .filter(() => canManageAppointments)
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
  const activeFeedbackHistoryOnlyMode = activeDeepLinkedAttempt
    ? activeDeepLinkedAttempt.decisionKind !== null
    : activeFeedbackMountPlan?.historyOnly === true
  const activeFeedbackHistoryOnly = !activeDeepLinkedAttempt
    && shouldMountRegistrationObservationFeedbackOnly({
      historyOnly: activeFeedbackHistoryOnlyMode,
      workflowActionable: observationWorkflowActionable,
    })
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
  const observationSectionLockReason = !canManageActiveObservation
    ? "청강 예약을 처리할 권한이 없습니다"
    : observationWorkspaceAvailable
      ? ""
      : "청강 신청 기능을 사용할 수 없습니다. 등록 정보를 다시 불러와 주세요."
  const openSectionStates = Object.fromEntries(
    Object.entries(sectionStates).map(([section, state]) => [section, {
      ...state,
      current: state.current,
      upcoming: state.upcoming,
      editable: section === "history"
        ? false
        : section === "admission"
          ? admissionEditable
          : section === "level_test"
            ? canManageAppointments
          : section === "observation" ? canManageActiveObservation && observationWorkspaceAvailable : canManageCase,
      lockReason: section === "history"
        ? "저장 시 자동 기록됩니다"
        : section === "observation"
          ? observationSectionLockReason
          : !canManageCase
            ? "등록 정보를 수정할 권한이 없습니다"
            : section === "level_test" && !scheduledAppointmentWindowComplete
              ? "현재 예약 이력이 조회 범위를 넘어 이 영역만 잠겼습니다"
              : section === "admission" && !currentEnrollmentWindowComplete
                ? "현재 등록 실행 이력이 조회 범위를 넘어 이 영역만 잠겼습니다"
                : "",
    }]),
  ) as typeof sectionStates
  const splitPlacementState = (collectionComplete = true) => {
    const editable = canManageCase && collectionComplete
    return {
      current: true,
      editable,
      upcoming: false,
      lockReason: !canManageCase
        ? "등록 정보를 수정할 권한이 없습니다"
        : collectionComplete
          ? ""
          : "현재 등록 실행 이력이 조회 범위를 넘어 이 영역만 잠겼습니다",
    }
  }
  const waitingState = splitPlacementState()
  const registrationState = splitPlacementState(currentEnrollmentWindowComplete)
  const focusedContext = trackContexts.find((context) => context.track.id === activeTrackId) || null
  const workflowStatusOptions = activeGenericTrack
    ? getRegistrationWorkflowStatusOptions({
      viewerId,
      viewerRole,
      directorProfileId: activeGenericTrack.directorProfileId,
    })
    : []
  const notificationReadiness = getRegistrationManagementNotificationReadiness({
    workflowStatus: activeGenericTrack?.workflowStatus,
    studentName: detail.task.studentName,
    subject: activeGenericTrack?.subject,
    schoolGrade: detail.task.registration?.schoolGrade,
    inquiryAt: detail.task.registration?.inquiryAt,
  })
  async function changeWorkflowStatus(nextStatus: string) {
    if (!canManageCase) return
    if (!activeGenericTrack || nextStatus === activeGenericTrack.workflowStatus || workflowStatusSaving) return
    const nextOption = workflowStatusOptions.find((option) => option.value === nextStatus)
    if (!nextOption) return
    setWorkflowStatusSaving(true)
    try {
      await setRegistrationWorkflowStatus({
        trackId: activeGenericTrack.id,
        workflowStatus: nextOption.value as OpsRegistrationWorkflowStatus,
        expectedWorkflowRevision: activeGenericTrack.workflowRevision,
        requestKey: `registration-workflow-status:${activeGenericTrack.id}:${crypto.randomUUID()}`,
      })
      await onReload(activeGenericTrack.id)
    } catch (error) {
      onWarning(errorMessage(error, "진행상태를 변경하지 못했습니다. 최신 정보를 확인해 주세요."))
    } finally {
      setWorkflowStatusSaving(false)
    }
  }
  async function sendRegistrationManagementNotification() {
    if (
      !canManageCase
      || !activeGenericTrack
      || !notificationReadiness.ready
      || !notificationToken
      || managementNotificationSending
    ) return
    setManagementNotificationSending(true)
    try {
      const sourceEventIds = await ensureRegistrationWorkflowNotificationSourceIds({
        trackId: activeGenericTrack.id,
        workflowRevision: activeGenericTrack.workflowRevision,
        requestKey: crypto.randomUUID(),
      })
      if (sourceEventIds.length === 0) {
        throw new Error("registration_management_notification_source_missing")
      }
      const result = await dispatchRegistrationManagementNotificationSources(
        sourceEventIds,
        notificationToken,
      )
      if (result.failedSourceEventIds.length > 0 || result.googleChatEventIds.length === 0) {
        throw new Error("registration_management_notification_dispatch_failed")
      }
      setLatestGoogleChatEventId(
        result.googleChatEventIds[result.googleChatEventIds.length - 1] || null,
      )
    } catch (error) {
      const message = errorMessage(error, "")
      onWarning(message.includes("registration_management_notification_not_ready")
        ? `알림에 필요한 내용을 먼저 입력하세요: ${notificationReadiness.missingFields.join(", ")}`
        : "관리팀 구글챗 알림을 보내지 못했습니다. 발송 상태를 확인해 주세요.")
    } finally {
      setManagementNotificationSending(false)
    }
  }
  const subjectPanelIdsByTrackId = Object.fromEntries(orderedTracks.map((track) => {
    const context = trackContexts.find((candidate) => candidate.track.id === track.id)
    if (!context) return [track.id, ["registration-application-observation"]] as const
    return [context.track.id, [
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
      })).map((candidate) => `registration-${candidate.panel}-${context.track.id}`)] as const
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
        ? getRegistrationTrackFocusPanelId(focusedContext)
        : null,
    })
    if (!focusPanelId) return
    const frame = window.requestAnimationFrame(() => {
      initialFocusAppliedRef.current = detail.task.id
      document.getElementById(focusPanelId)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTrack, activeTrackId, deepLinkedObservationHistoryEligible, detail.task.id, focusTrackId, focusedContext, observationWorkspaceAvailable])

  async function saveInquiry(draft: RegistrationInquiryDraft, requestKey: string) {
    if (!canManageCase) throw new Error("등록 정보를 수정할 권한이 없습니다.")
    const writes = await Promise.allSettled([
      updateRegistrationCaseCommon({
        taskId: detail.task.id,
        studentName: draft.studentName.trim(),
        schoolGrade: draft.schoolGrade.trim(),
        schoolName: draft.schoolName.trim(),
        parentPhone: draft.parentPhone.trim(),
        studentPhone: draft.studentPhone.trim(),
        campus: draft.campus.trim(),
        inquiryAt: draft.inquiryAt,
        requestNote: draft.requestNote.trim(),
        priority: draft.priority,
        expectedCommonRevision: detail.commonRevision,
        requestKey: `${requestKey}:facts`,
      }),
      syncRegistrationCaseSubjects({
        taskId: detail.task.id,
        subjects: draft.subjects,
        requestKey: `${requestKey}:subjects`,
      }),
    ])
    const rejectedWrites = writes.filter((result): result is PromiseRejectedResult => (
      result.status === "rejected"
    ))
    if (rejectedWrites.some(({ reason }) => {
      const message = errorMessage(reason, "")
      return message.includes("registration_common_revision_conflict")
        || message.includes("registration_subjects_conflict")
    })) {
      return "conflict" as const
    }
    if (rejectedWrites.length === 0) return "saved" as const
    if (rejectedWrites.length === 2) throw rejectedWrites[0].reason

    onWarning(writes[0].status === "rejected"
      ? "과목은 저장됐지만 문의 정보는 저장하지 못했습니다. 성공한 저장은 유지하며 최신 내용을 다시 불러옵니다."
      : "문의 정보는 저장됐지만 과목은 저장하지 못했습니다. 성공한 저장은 유지하며 최신 내용을 다시 불러옵니다.")
    try {
      await onReload()
    } catch {
      onWarning("일부 변경은 저장됐지만 최신 내용을 다시 불러오지 못했습니다.")
    }
    return "partial" as const
  }

  function handleSubjectTabChange(trackId: string) {
    onFocusTrack(trackId)
  }

  async function handleAppointmentSaved(saved: RegistrationAppointmentMutationResponse) {
    if (!canManageAppointments) return
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
          permissions={permissions}
          classOptions={classOptions}
          onReload={onReload}
          onWarning={onWarning}
          onDirtyChange={(dirty) => setDirty(`placement:track-${track.id}`, dirty)}
          onOpenCustomerMessage={openCustomerMessage}
        />
      )
    }
    if (section === "placement" && placementMode === "registration") {
      return (
        <RegistrationEnrollmentTrackEditor
          detail={genericDetail}
          track={track}
          viewerId={viewerId || ""}
          permissions={currentEnrollmentWindowComplete
            ? permissions
            : { ...permissions, canManage: false, canCompleteConsultation: false, readOnly: true }}
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
    if (!canManageCase) return
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
        {section === "consultation" ? (
          <RegistrationTrackDirectorSection
            ref={activeTrackId === context.track.id ? activeConsultationDirectorRef : undefined}
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
              editable={Boolean(context.permissions.canManage || context.permissions.canCompleteConsultation || context.permissions.canEditConsultationResult)}
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
    savedMode: activeVisitAppointment
      ? "visit"
      : focusedContext?.latestConsultation?.mode === "visit" && focusedContext.latestConsultation.status !== "canceled"
        ? "visit"
        : "phone",
  }) : null
  const activeConsultationDirectorDirty = activeGenericTrack
    ? Boolean(consultationDirectorDirtyByTrackId[activeGenericTrack.id])
    : false

  function selectConsultationMode(mode: RegistrationConsultationMode) {
    if (!canManageAppointments || !activeGenericTrack || !activeConsultationMode) return
    const next = getRegistrationConsultationModeDraft({
      draftMode: mode,
      savedMode: activeConsultationMode.savedMode,
    })
    setConsultationModeDrafts((current) => ({ ...current, [activeGenericTrack.id]: next.mode }))
    setDirty(`consultation:mode-${activeGenericTrack.id}`, next.dirty)
  }

  async function saveActiveConsultationDirector() {
    if (!canManageCase) return false
    if (activeConsultationDirectorRef.current) {
      return activeConsultationDirectorRef.current.savePending()
    }
    return true
  }

  async function trySaveActiveConsultationDirector() {
    try {
      return await saveActiveConsultationDirector()
    } catch (error) {
      onWarning(errorMessage(error, "담당자 정보를 저장하지 못했습니다."))
      return false
    }
  }

  async function savePhoneConsultation() {
    if (!canManageCase || !activeGenericTrack || consultationSharedSaving) return
    if (activeVisitAppointment) {
      setConsultationSwitchPending(true)
      return
    }
    setConsultationSharedSaving(true)
    const directorWasDirty = activeConsultationDirectorDirty
    try {
      const directorSaved = await trySaveActiveConsultationDirector()
      try {
        await saveRegistrationPhoneConsultation({
          trackId: activeGenericTrack.id,
          requestKey: `registration-phone-consultation:${activeGenericTrack.id}:${crypto.randomUUID()}`,
        })
      } catch (error) {
        onWarning(directorWasDirty && directorSaved
          ? `담당자 정보는 저장되었지만 ${errorMessage(error, "전화상담 정보를 저장하지 못했습니다.")}`
          : errorMessage(error, "전화상담 정보를 저장하지 못했습니다."))
        return
      }
      setDirty(`consultation:mode-${activeGenericTrack.id}`, false)
      let refreshFailed = false
      try {
        await onReload(activeGenericTrack.id)
      } catch {
        refreshFailed = true
      }
      const partialWarnings = [
        ...(!directorSaved ? ["담당자 정보는 저장되지 않았습니다. 담당자를 입력한 뒤 관리 알림을 따로 보내세요."] : []),
        ...(refreshFailed ? ["최신 내용을 다시 불러오지 못했습니다."] : []),
      ]
      if (partialWarnings.length > 0) {
        onWarning(`전화상담은 저장되었습니다. ${partialWarnings.join(" ")}`)
      }
    } finally {
      setConsultationSharedSaving(false)
    }
  }

  async function confirmVisitToPhoneSwitch() {
    if (!canManageAppointments || !activeGenericTrack || !activeVisitAppointment || consultationSharedSaving) return
    setConsultationSharedSaving(true)
    const directorWasDirty = activeConsultationDirectorDirty
    try {
      const directorSaved = await trySaveActiveConsultationDirector()
      let saved: RegistrationAppointmentMutationResponse
      try {
        saved = await cancelRegistrationAppointment({
          appointmentId: activeVisitAppointment.id,
          expectedNotificationRevision: activeVisitAppointment.notificationRevision,
          reason: "전화상담으로 변경",
          requestKey: `registration-appointment-switch-to-phone:${activeVisitAppointment.id}:${crypto.randomUUID()}`,
        })
      } catch (error) {
        onWarning(directorWasDirty && directorSaved
          ? `담당자 정보는 저장되었지만 ${errorMessage(error, "방문상담 예약을 취소하지 못했습니다.")}`
          : errorMessage(error, "방문상담 예약을 취소하지 못했습니다."))
        return
      }
      setConsultationSwitchPending(false)
      let phoneSaved = false
      try {
        await saveRegistrationPhoneConsultation({
          trackId: activeGenericTrack.id,
          requestKey: `registration-phone-consultation:${activeGenericTrack.id}:${crypto.randomUUID()}`,
        })
        phoneSaved = true
        setDirty(`consultation:mode-${activeGenericTrack.id}`, false)
      } catch {
        // The canceled visit remains committed and is reloaded below.
      }
      let refreshFailed = false
      try {
        await handleAppointmentSaved(saved)
      } catch {
        refreshFailed = true
      }
      const partialWarnings = [
        ...(!phoneSaved ? ["전화상담 정보는 저장하지 못했습니다."] : []),
        ...(!directorSaved ? ["담당자 정보는 저장되지 않았습니다. 담당자를 입력한 뒤 관리 알림을 따로 보내세요."] : []),
        ...(refreshFailed ? ["최신 내용을 다시 불러오지 못했습니다."] : []),
      ]
      if (partialWarnings.length > 0) {
        onWarning(`방문상담 예약은 취소되었습니다. ${partialWarnings.join(" ")}`)
      }
    } finally {
      setConsultationSharedSaving(false)
    }
  }

  async function confirmPhoneConsultationCancellation() {
    if (!canManageCase || !phoneConsultation || consultationSharedSaving) return
    setConsultationSharedSaving(true)
    try {
      await saveRegistrationConsultationDetails({
        consultationId: phoneConsultation.id,
        status: "canceled",
        outcome: "",
        note: phoneConsultation.note || "",
        requestKey: `registration-phone-consultation-cancel:${phoneConsultation.id}:${crypto.randomUUID()}`,
      })
      setConsultationCancelPending(false)
      await onReload(phoneConsultation.trackId)
    } catch (error) {
      onWarning(errorMessage(error, "전화상담을 취소하지 못했습니다."))
    } finally {
      setConsultationSharedSaving(false)
    }
  }

  const activeObservationFeedbackPanel = observationFeedbackDetail?.observationId
    === activeFeedbackObservationId ? (
      <RegistrationObservationFeedbackPanel
        detail={observationFeedbackDetail}
        canRecordAttendance={!activeDeepLinkedAttemptTerminal
          && canManageCase
          && !activeFeedbackHistoryOnlyMode}
        canDecide={!activeDeepLinkedAttemptCanceled
          && !activeFeedbackHistoryOnlyMode
          && canManageCase}
        actions={registrationObservationFeedbackActions}
        onSaved={handleObservationFeedbackSaved}
        onReload={reloadObservationFeedback}
      />
    ) : observationFeedbackError ? (
      <p role="alert" className="text-sm text-destructive">{observationFeedbackError}</p>
    ) : observationFeedbackLoading ? (
      <p className="text-sm text-muted-foreground">청강 확인 정보를 불러오는 중입니다.</p>
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
                disabled={!canManageCase || workflowStatusSaving || workflowStatusOptions.length === 0}
                onChange={(event) => void changeWorkflowStatus(event.target.value)}
                className="h-10 min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 text-sm font-semibold text-primary outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={activeGenericTrack.workflowStatus}>{REGISTRATION_WORKFLOW_STATUS_LABELS[activeGenericTrack.workflowStatus]}</option>
                {workflowStatusOptions.filter((option) => option.value !== activeGenericTrack.workflowStatus).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {canManageCase && notificationReadiness.eventKey ? (
                <div className="grid gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      workflowStatusSaving
                      || managementNotificationSending
                      || !notificationToken
                      || !notificationReadiness.ready
                    }
                    onClick={() => void sendRegistrationManagementNotification()}
                  >
                    {managementNotificationSending ? "알림 보내는 중" : "관리팀 알림 보내기"}
                  </Button>
                  {!notificationReadiness.ready ? (
                    <p className="text-xs text-muted-foreground">
                      알림에 필요한 내용: {notificationReadiness.missingFields.join(", ")}
                    </p>
                  ) : !notificationToken ? (
                    <p className="text-xs text-muted-foreground">알림 연결을 확인한 뒤 보낼 수 있습니다.</p>
                  ) : null}
                  <GoogleChatDeliveryControl eventId={latestGoogleChatEventId} onWarning={onWarning} />
                </div>
              ) : null}
            </div>
          ) : null}
          {!scheduledAppointmentWindowComplete || !currentEnrollmentWindowComplete ? (
            <p role="alert" className="text-sm text-amber-700 md:col-span-2">
              일부 예약 또는 등록 실행 이력이 조회 범위를 넘었습니다. 해당 실행 영역만 잠기며 기본정보와 진행상태는 계속 수정할 수 있습니다.
            </p>
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
              canEdit={canManageCase}
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
              studentName={detail.task.studentName}
              eligibleTracks={genericTracks}
              initialTrackId={activeGenericTrack.id}
              appointment={activeLevelTestAppointment}
              activities={detail.levelTests}
              readOnly={!canManageAppointments}
              embedded
              subjectScoped
              visibleTrackId={activeGenericTrack.id}
              onSaved={handleAppointmentSaved}
              onWarning={onWarning}
              onReload={onReload}
              onDirtyChange={(dirty) => setDirty(`level_test:appointment-${activeLevelTestAppointment?.id || activeGenericTrack.id}`, dirty)}
              onTrackDirtyChange={(trackId, dirty) => setDirty(`level_test:track-${trackId}`, dirty)}
              canOpenCustomerMessage={canManageAppointments}
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
                    disabled={!canManageAppointments || consultationSharedSaving}
                  >전화상담</Button>
                  <Button
                    type="button"
                    aria-pressed={activeConsultationMode.mode === "visit"}
                    variant={activeConsultationMode.mode === "visit" ? "default" : "outline"}
                    className="h-10"
                    onClick={() => selectConsultationMode("visit")}
                    disabled={!canManageAppointments || consultationSharedSaving}
                  >방문상담</Button>
                </div>
              </fieldset>

              {activeConsultationMode.mode === "visit" ? (
                <RegistrationAppointmentEditor
                  key={`visit_consultation:${activeGenericTrack.id}:${activeVisitAppointment?.id || "new"}:${activeVisitAppointment?.notificationRevision ?? "new"}`}
                  kind="visit_consultation"
                  taskId={detail.task.id}
                  studentName={detail.task.studentName}
                  eligibleTracks={genericTracks}
                  initialTrackId={activeGenericTrack.id}
                  appointment={activeVisitAppointment}
                  activities={detail.consultations.filter((item) => item.mode === "visit")}
                  readOnly={!canManageAppointments}
                  embedded
                  subjectScoped
                  visibleTrackId={activeGenericTrack.id}
                  onSaved={async (saved) => {
                    if (!canManageCase) return
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
                  canOpenCustomerMessage={canManageAppointments}
                  onOpenCustomerMessage={openCustomerMessage}
                  canSendManagementNotification={canManageAppointments}
                />
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {phoneConsultation ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canManageCase || consultationSharedSaving}
                      onClick={() => {
                        if (!canManageCase) return
                        setConsultationCancelPending(true)
                      }}
                    >상담 취소</Button>
                  ) : null}
                  <RegistrationSaveButton
                    type="button"
                    dirty={activeConsultationDirectorDirty || !phoneConsultation}
                    saving={consultationSharedSaving}
                    blocked={!canManageCase}
                    actionLabel="상담 정보 저장"
                    cleanLabel={phoneConsultation ? "저장됨" : "상담 정보 저장"}
                    aria-label={`${activeGenericTrack.subject} 상담 정보 저장`}
                    onClick={() => void savePhoneConsultation()}
                  />
                </div>
              )}

              {consultationSwitchPending ? (
                <div role="alertdialog" aria-labelledby="registration-consultation-switch-title" className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
                  <h4 id="registration-consultation-switch-title" className="font-semibold">전화상담으로 변경할까요?</h4>
                  <p className="text-sm">기존 방문상담 예약 사실을 취소하고 전화상담 정보를 저장합니다. 알림은 자동으로 전송되지 않습니다.</p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" disabled={!canManageCase || consultationSharedSaving} onClick={() => setConsultationSwitchPending(false)}>돌아가기</Button>
                    <Button type="button" disabled={!canManageCase || consultationSharedSaving} onClick={() => void confirmVisitToPhoneSwitch()}>전화상담으로 변경</Button>
                  </div>
                </div>
              ) : null}

              {consultationCancelPending ? (
                <div role="alertdialog" aria-labelledby="registration-phone-consultation-cancel-title" className="grid gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-950">
                  <h4 id="registration-phone-consultation-cancel-title" className="font-semibold">전화상담을 취소할까요?</h4>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" disabled={!canManageCase || consultationSharedSaving} onClick={() => setConsultationCancelPending(false)}>돌아가기</Button>
                    <Button type="button" variant="destructive" disabled={!canManageCase || consultationSharedSaving} onClick={() => void confirmPhoneConsultationCancellation()}>상담 취소</Button>
                  </div>
                </div>
              ) : null}

              {renderTrackFrames("consultation")}
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
            <RegistrationAdmissionPanel
              taskId={detail.task.id}
              checklist={detail.admissionChecklist}
              permissions={{ canManage: admissionEditable, readOnly: !admissionEditable }}
              onWarning={onWarning}
            />
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
