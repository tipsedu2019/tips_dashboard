"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
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

import { RegistrationSelect } from "./registration-select"
import type {
  RegistrationObservationManagerDetail,
  RegistrationObservationMutationResult,
  RegistrationObservationSessionOption,
} from "./registration-observation-model"
import type {
  CancelRegistrationObservationInput,
  EnterRegistrationObservationInput,
  LoadRegistrationObservationSessionsInput,
  SaveRegistrationObservationBookingInput,
  WithdrawRegistrationObservationInput,
} from "./registration-observation-service"

// registration-observation-editor-model:start
export function canLoadRegistrationObservationWorkspace(input: {
  runtimeAvailable: boolean
  observationSummaryVisible: boolean
}) {
  return input.runtimeAvailable && input.observationSummaryVisible
}

export function canUseRegistrationObservationDetail(input: {
  activeTrackId: string | null
  detailTrackId: string | null
}) {
  return Boolean(input.activeTrackId && input.activeTrackId === input.detailTrackId)
}

export function canWithdrawRegistrationObservation(input: {
  workflowStatus: RegistrationObservationManagerDetail["track"]["workflowStatus"]
  currentObservation: Pick<
    RegistrationObservationManagerDetail["attempts"][number],
    "appointmentStatus" | "status"
  > | null
}) {
  return input.workflowStatus === "observation_requested"
    && input.currentObservation === null
}

function registrationObservationErrorRecord(error: unknown) {
  if (typeof error === "string") {
    return { name: "", code: "", message: error.trim(), details: "", hint: "" }
  }
  if (!error || typeof error !== "object") {
    return { name: "", code: "", message: "", details: "", hint: "" }
  }
  return {
    name: "name" in error ? String(error.name || "").trim() : "",
    code: "code" in error ? String(error.code || "").trim() : "",
    message: "message" in error ? String(error.message || "").trim() : "",
    details: "details" in error ? String(error.details || "").trim() : "",
    hint: "hint" in error ? String(error.hint || "").trim() : "",
  }
}

export function getRegistrationObservationUiErrorMessage(
  error: unknown,
  fallback: string,
) {
  const { name, code, message, details, hint } = registrationObservationErrorRecord(error)
  const diagnostic = [message, details, hint].filter(Boolean).join(" ")

  if (
    name === "AbortError"
    || name === "TimeoutError"
    || name === "RegistrationRequestTimeoutError"
    || code === "REGISTRATION_REQUEST_TIMEOUT"
    || code === "57014"
    || /\b(?:timed out|timeout|statement timeout|aborted)\b/i.test(diagnostic)
  ) {
    return "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
  }
  if (/failed to fetch|network(?: request)? (?:failed|error)|networkerror|load failed/i.test(diagnostic)) {
    return "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
  }
  if (diagnostic.includes("registration_observation_session_time_ambiguous")) {
    return "같은 시간의 청강 회차가 둘 이상입니다. 다른 회차를 선택해 주세요."
  }
  if (
    diagnostic.includes("registration_observation_session_invalid")
    || diagnostic.includes("registration_observation_legacy_session_invalid")
    || diagnostic.includes("registration_observation_session_identity_required")
    || diagnostic.includes("registration_observation_booking_revision_required")
    || diagnostic.includes("registration_observation_revision_combination_invalid")
  ) {
    return "청강 예약에 필요한 정보를 확인할 수 없습니다. 반과 회차를 다시 선택해 주세요."
  }
  if (diagnostic.includes("registration_observation_correction_reason_required")) {
    return "재청강 결정 정정 사유를 입력하세요."
  }
  if (code === "P0002" || diagnostic.includes("registration_observation_not_found")) {
    return "청강 정보를 찾을 수 없습니다. 화면을 새로고침해 주세요."
  }
  if (
    code === "40001"
    || diagnostic.includes("registration_observation_stale_revision")
    || diagnostic.includes("registration_observation_request_key_conflict")
    || diagnostic.includes("registration_observation_request_conflict")
    || diagnostic.includes("registration_observation_transition_rejected")
  ) {
    return "최신 청강 정보가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."
  }
  return fallback
}

type RegistrationObservationDialogCloseSource =
  | "on_open_change"
  | "close_button"
  | "escape"
  | "dialog_close"

export function getRegistrationObservationDialogClosePlan(input: {
  saving: boolean
  source: RegistrationObservationDialogCloseSource
}) {
  const shouldClose = !input.saving
  return {
    shouldClose,
    shouldPreventDefault: input.saving && input.source !== "on_open_change",
    shouldRestoreTriggerFocus: shouldClose,
  }
}

export function restoreRegistrationObservationDialogTriggerFocus(
  trigger: {
    focus: (options?: FocusOptions) => void
    isConnected: boolean
    disabled?: boolean
  } | null,
  schedule: (callback: () => void) => void,
  fallback: {
    focus: (options?: FocusOptions) => void
    isConnected: boolean
    disabled?: boolean
  } | null = null,
) {
  const focusTarget = () => trigger?.isConnected && !trigger.disabled
    ? trigger
    : fallback?.isConnected && !fallback.disabled
      ? fallback
      : null
  if (!focusTarget()) return false
  schedule(() => focusTarget()?.focus({ preventScroll: true }))
  return true
}

type RegistrationObservationBookingDraftInput = Readonly<{
  trackId: string
  workflowRevision: number
  observationId: string | null
  observationRevision: number | null
  appointmentNotificationRevision: number | null
  classId: string
  sessionAuthority: "normalized" | "legacy"
  classLessonSessionId: string | null
  legacySessionKey: string | null
  requestKey: string
}>

export function buildRegistrationObservationBookingInput(
  input: RegistrationObservationBookingDraftInput,
): SaveRegistrationObservationBookingInput {
  let session:
    | { sessionAuthority: "normalized"; classLessonSessionId: string; legacySessionKey: null }
    | { sessionAuthority: "legacy"; classLessonSessionId: null; legacySessionKey: string }
  if (input.sessionAuthority === "normalized") {
    if (!input.classLessonSessionId) {
      throw new Error("registration_observation_session_identity_required")
    }
    session = {
      sessionAuthority: "normalized",
      classLessonSessionId: input.classLessonSessionId,
      legacySessionKey: null,
    }
  } else {
    if (!input.legacySessionKey) {
      throw new Error("registration_observation_session_identity_required")
    }
    session = {
      sessionAuthority: "legacy",
      classLessonSessionId: null,
      legacySessionKey: input.legacySessionKey,
    }
  }
  if (input.observationId) {
    if (
      input.observationRevision === null
      || input.appointmentNotificationRevision === null
    ) {
      throw new Error("registration_observation_booking_revision_required")
    }
    return {
      trackId: input.trackId,
      observationId: input.observationId,
      classId: input.classId,
      ...session,
      expectedWorkflowRevision: null,
      expectedAppointmentNotificationRevision: input.appointmentNotificationRevision,
      expectedObservationRevision: input.observationRevision,
      requestKey: input.requestKey,
    }
  }
  return {
    trackId: input.trackId,
    observationId: null,
    classId: input.classId,
    ...session,
    expectedWorkflowRevision: input.workflowRevision,
    expectedAppointmentNotificationRevision: null,
    expectedObservationRevision: null,
    requestKey: input.requestKey,
  }
}

export function executeRegistrationObservationBooking(
  actions: Pick<RegistrationObservationActions, "saveRegistrationObservationBooking">,
  input: SaveRegistrationObservationBookingInput,
) {
  return actions.saveRegistrationObservationBooking(input)
}

export function buildRegistrationObservationCancelInput(input: {
  observationId: string
  observationRevision: number
  appointmentNotificationRevision: number
  requestKey: string
}): CancelRegistrationObservationInput {
  return {
    observationId: input.observationId,
    expectedAppointmentNotificationRevision: input.appointmentNotificationRevision,
    expectedObservationRevision: input.observationRevision,
    requestKey: input.requestKey,
  }
}

type RegistrationObservationWithdrawalCorrection = Readonly<{
  decisionKind: string | null
  observationId: string
  observationRevision: number
  feedbackRevision: number
}>

type RegistrationObservationWithdrawalDraftInput = Readonly<{
  trackId: string
  workflowRevision: number
  reason: string
  requestKey: string
  correction: RegistrationObservationWithdrawalCorrection | null
} & (
  | {
      exitKind: "return_to_previous"
      targetWorkflowStatus:
        | "consultation_completed"
        | "waiting_current_class"
        | "waiting_new_class"
        | "waiting_next_opening"
    }
  | {
      exitKind: "director_decision"
      targetWorkflowStatus:
        | "enrollment_requested"
        | "waiting_current_class"
        | "waiting_new_class"
        | "waiting_next_opening"
        | "not_registered"
    }
)>

export function buildRegistrationObservationWithdrawalInput(
  input: RegistrationObservationWithdrawalDraftInput,
): WithdrawRegistrationObservationInput {
  if (input.exitKind === "return_to_previous") {
    return {
      trackId: input.trackId,
      expectedWorkflowRevision: input.workflowRevision,
      exitKind: input.exitKind,
      targetWorkflowStatus: input.targetWorkflowStatus,
      decisionObservationId: null,
      expectedDecisionObservationRevision: null,
      expectedDecisionFeedbackRevision: null,
      reason: input.reason,
      requestKey: input.requestKey,
    }
  }
  const correction = input.correction?.decisionKind === "re_observation"
    ? input.correction
    : null
  return {
    trackId: input.trackId,
    expectedWorkflowRevision: input.workflowRevision,
    exitKind: input.exitKind,
    targetWorkflowStatus: input.targetWorkflowStatus,
    decisionObservationId: correction?.observationId || null,
    expectedDecisionObservationRevision: correction?.observationRevision ?? null,
    expectedDecisionFeedbackRevision: correction?.feedbackRevision ?? null,
    reason: input.reason,
    requestKey: input.requestKey,
  }
}

export function getRegistrationObservationWithdrawalCorrection(
  detail: Pick<RegistrationObservationManagerDetail, "latestDecisionObservation">,
) {
  const latestDecision = detail.latestDecisionObservation
  if (latestDecision?.decisionKind !== "re_observation") return null
  return {
    decisionKind: latestDecision.decisionKind,
    observationId: latestDecision.observationId,
    observationRevision: latestDecision.observationRevision,
    feedbackRevision: latestDecision.feedbackRevision,
  }
}

export type RegistrationObservationWithdrawalSubmitState = Readonly<{
  normalizedReason: string
  fieldError: string
  submitDisabled: boolean
}>

export function getRegistrationObservationWithdrawalSubmitState(input: {
  correction: RegistrationObservationWithdrawalCorrection | null
  reason: string
  saving: boolean
  mutationCommitted: boolean
}): RegistrationObservationWithdrawalSubmitState {
  const normalizedReason = input.reason.trim()
  const fieldError = input.correction?.decisionKind === "re_observation" && !normalizedReason
    ? "재청강 결정 정정 사유를 입력하세요."
    : ""
  return {
    normalizedReason,
    fieldError,
    submitDisabled: input.saving || input.mutationCommitted || Boolean(fieldError),
  }
}

export async function executeRegistrationObservationWithdrawal<T>(
  submitState: RegistrationObservationWithdrawalSubmitState,
  operation: (normalizedReason: string) => Promise<T>,
): Promise<T | null> {
  if (submitState.submitDisabled) return null
  return operation(submitState.normalizedReason)
}

export function getRegistrationObservationRequestKey(
  cache: Map<string, string>,
  scope: string,
  fingerprint: string,
  createKey: () => string,
) {
  const owner = `${scope}:${fingerprint}`
  const existing = cache.get(owner)
  if (existing) return existing
  const next = createKey()
  cache.set(owner, next)
  return next
}

export function completeRegistrationObservationRequestKey(input: {
  cache: Map<string, string>
  scope: string
  fingerprint: string
  requestKey: string
  refreshError: unknown | null
}) {
  if (input.refreshError !== null) return
  const owner = `${input.scope}:${input.fingerprint}`
  if (input.cache.get(owner) === input.requestKey) input.cache.delete(owner)
}

export function shouldLockRegistrationObservationMutation(
  result: Pick<RegistrationObservationMutationResult, "changed">,
) {
  return result.changed
}

export async function executeRegistrationObservationCommit<T>(
  operation: () => Promise<T>,
  onSaved: (result: T) => void | Promise<void>,
): Promise<{ result: T; refreshError: unknown | null }> {
  const result = await operation()
  try {
    await onSaved(result)
    return { result, refreshError: null }
  } catch (refreshError) {
    return { result, refreshError }
  }
}

export function reconcileRegistrationObservationWithdrawalValue(input: {
  currentValue: string
  touched: boolean
  returnWorkflowStatus: RegistrationObservationManagerDetail["track"]["observationReturnWorkflowStatus"]
}) {
  if (input.touched) return input.currentValue
  return input.returnWorkflowStatus
    ? `return:${input.returnWorkflowStatus}`
    : "director:enrollment_requested"
}
// registration-observation-editor-model:end

export type RegistrationObservationActions = Readonly<{
  enterRegistrationObservation: (
    input: EnterRegistrationObservationInput,
  ) => Promise<RegistrationObservationMutationResult>
  loadRegistrationObservationSessions: (
    input: LoadRegistrationObservationSessionsInput,
  ) => Promise<readonly RegistrationObservationSessionOption[]>
  saveRegistrationObservationBooking: (
    input: SaveRegistrationObservationBookingInput,
  ) => Promise<RegistrationObservationMutationResult>
  cancelRegistrationObservation: (
    input: CancelRegistrationObservationInput,
  ) => Promise<RegistrationObservationMutationResult>
  withdrawRegistrationObservation: (
    input: WithdrawRegistrationObservationInput,
  ) => Promise<RegistrationObservationMutationResult>
}>

export type RegistrationObservationEditorProps = {
  trackId: string
  workflowRevision: number
  observationRevision: number | null
  appointmentNotificationRevision: number | null
  detail: RegistrationObservationManagerDetail
  actions: RegistrationObservationActions
  onSaved: (result: RegistrationObservationMutationResult) => void | Promise<void>
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function sessionValue(session: RegistrationObservationSessionOption) {
  return session.sessionAuthority === "normalized"
    ? `normalized:${session.classLessonSessionId}`
    : `legacy:${session.legacySessionKey}`
}

function sessionLabel(session: RegistrationObservationSessionOption) {
  const start = new Date(session.startsAt)
  const formatted = Number.isNaN(start.getTime())
    ? session.startsAt
    : new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(start)
  return `${formatted} · ${session.teacherName} · ${session.classroomName}`
}

function isObservationReturnTarget(target: string): target is
  | "consultation_completed"
  | "waiting_current_class"
  | "waiting_new_class"
  | "waiting_next_opening" {
  return target === "consultation_completed"
    || target === "waiting_current_class"
    || target === "waiting_new_class"
    || target === "waiting_next_opening"
}

function isObservationDirectorTarget(target: string): target is
  | "enrollment_requested"
  | "waiting_current_class"
  | "waiting_new_class"
  | "waiting_next_opening"
  | "not_registered" {
  return target === "enrollment_requested"
    || target === "waiting_current_class"
    || target === "waiting_new_class"
    || target === "waiting_next_opening"
    || target === "not_registered"
}

export function RegistrationObservationEditor({
  trackId,
  workflowRevision,
  observationRevision,
  appointmentNotificationRevision,
  detail,
  actions,
  onSaved,
}: RegistrationObservationEditorProps) {
  const current = detail.currentObservation
  const workflowStatus = detail.track.workflowStatus
  const canEnter = workflowStatus === "consultation_completed"
    || workflowStatus === "waiting_current_class"
    || workflowStatus === "waiting_new_class"
    || workflowStatus === "waiting_next_opening"
  const canBook = workflowStatus === "observation_requested"
  const readOnly = workflowStatus === "observation_feedback_pending"
    || workflowStatus === "observation_completed"
  const [classId, setClassId] = useState(current?.classId || "")
  const [sessions, setSessions] = useState<readonly RegistrationObservationSessionOption[]>([])
  const [sessionId, setSessionId] = useState(current ? sessionValue(current) : "")
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionError, setSessionError] = useState("")
  const [mutationError, setMutationError] = useState("")
  const [refreshError, setRefreshError] = useState("")
  const [saving, setSaving] = useState(false)
  const [committedCanonicalKey, setCommittedCanonicalKey] = useState("")
  const committedCanonicalKeyRef = useRef("")
  const requestKeysRef = useRef(new Map<string, string>())
  const saveDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const withdrawDialogTriggerRef = useRef<HTMLButtonElement>(null)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawValue, setWithdrawValue] = useState(() => (
    reconcileRegistrationObservationWithdrawalValue({
      currentValue: "director:enrollment_requested",
      touched: false,
      returnWorkflowStatus: detail.track.observationReturnWorkflowStatus,
    })
  ))
  const [withdrawValueTouched, setWithdrawValueTouched] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState("")
  const [receipt, setReceipt] = useState("")

  const canonicalMutationKey = JSON.stringify([
    trackId,
    workflowRevision,
    current?.observationId || null,
    current?.status || null,
    observationRevision,
    appointmentNotificationRevision,
  ])
  const mutationCommitted = committedCanonicalKey === canonicalMutationKey
  const withdrawAvailable = canWithdrawRegistrationObservation({
    workflowStatus,
    currentObservation: current,
  })
  const withdrawalCorrection = withdrawValue.startsWith("director:")
    ? getRegistrationObservationWithdrawalCorrection(detail)
    : null
  const withdrawSubmitState = getRegistrationObservationWithdrawalSubmitState({
    correction: withdrawalCorrection,
    reason: withdrawReason,
    saving,
    mutationCommitted,
  })
  const withdrawReasonErrorId = `registration-observation-withdraw-reason-error-${trackId}`

  function stableRequestKey(scope: string, fingerprint: string) {
    return getRegistrationObservationRequestKey(
      requestKeysRef.current,
      scope,
      fingerprint,
      () => `${scope}:${crypto.randomUUID()}`,
    )
  }

  function handleSaveConfirmOpenChange(open: boolean) {
    if (open) {
      setSaveConfirmOpen(true)
      return
    }
    const plan = getRegistrationObservationDialogClosePlan({
      saving,
      source: "on_open_change",
    })
    if (plan.shouldClose) setSaveConfirmOpen(false)
  }

  function handleWithdrawOpenChange(open: boolean) {
    if (open) {
      setWithdrawOpen(true)
      return
    }
    const plan = getRegistrationObservationDialogClosePlan({
      saving,
      source: "on_open_change",
    })
    if (plan.shouldClose) setWithdrawOpen(false)
  }

  function handleDialogEscape(event: Event) {
    const plan = getRegistrationObservationDialogClosePlan({
      saving,
      source: "escape",
    })
    if (plan.shouldPreventDefault) event.preventDefault()
  }

  function handleSaveDialogCloseAutoFocus(event: Event) {
    const focusRestored = restoreRegistrationObservationDialogTriggerFocus(
      saveDialogTriggerRef.current,
      (callback) => window.requestAnimationFrame(callback),
      document.getElementById(`registration-subject-tab-${trackId}`),
    )
    if (focusRestored) event.preventDefault()
  }

  function handleWithdrawDialogCloseAutoFocus(event: Event) {
    const focusRestored = restoreRegistrationObservationDialogTriggerFocus(
      withdrawDialogTriggerRef.current,
      (callback) => window.requestAnimationFrame(callback),
      document.getElementById(`registration-subject-tab-${trackId}`),
    )
    if (focusRestored) event.preventDefault()
  }

  useEffect(() => {
    setWithdrawValue((currentValue) => reconcileRegistrationObservationWithdrawalValue({
      currentValue,
      touched: withdrawValueTouched,
      returnWorkflowStatus: detail.track.observationReturnWorkflowStatus,
    }))
  }, [detail.track.observationReturnWorkflowStatus, withdrawValueTouched])

  const selectedSession = sessions.find((session) => sessionValue(session) === sessionId) || null
  const classOptions = detail.classes.map((classItem) => ({ value: classItem.id, label: classItem.name }))
  const sessionOptions = sessions.map((session) => ({ value: sessionValue(session), label: sessionLabel(session) }))

  useEffect(() => {
    if (!canBook || !classId) {
      setSessions([])
      setSessionsLoading(false)
      return
    }
    let active = true
    const from = new Date()
    const to = new Date(from)
    to.setDate(to.getDate() + 120)
    setSessionsLoading(true)
    setSessionError("")
    void actions.loadRegistrationObservationSessions({
      trackId,
      classId,
      dateFrom: dateKey(from),
      dateTo: dateKey(to),
    }).then((nextSessions) => {
      if (!active) return
      setSessions(nextSessions)
      setSessionId((value) => nextSessions.some((session) => sessionValue(session) === value) ? value : "")
    }).catch((error) => {
      if (!active) return
      setSessions([])
      setSessionError(getRegistrationObservationUiErrorMessage(error, "청강 회차를 불러오지 못했습니다."))
    }).finally(() => {
      if (active) setSessionsLoading(false)
    })
    return () => {
      active = false
    }
  }, [actions, canBook, classId, trackId])

  const prerequisiteError = useMemo(() => {
    if (current && (observationRevision === null || appointmentNotificationRevision === null)) {
      return "최신 예약 버전을 확인할 수 없습니다."
    }
    if (!classId) return "청강할 반을 선택하세요."
    if (sessionsLoading) return "청강 회차를 불러오는 중입니다."
    if (sessionError) return sessionError
    if (!selectedSession) return "청강 회차를 선택하세요."
    if (!selectedSession.teacherProfileId || !selectedSession.teacherName) return "담당 선생님 정보를 확인할 수 없습니다."
    if (!selectedSession.classroomCatalogId || !selectedSession.classroomName) return "강의실 정보를 확인할 수 없습니다."
    if (!selectedSession.campus) return "캠퍼스 정보를 확인할 수 없습니다."
    return ""
  }, [appointmentNotificationRevision, classId, current, observationRevision, selectedSession, sessionError, sessionsLoading])

  async function commit(
    operation: () => Promise<RegistrationObservationMutationResult>,
    request: Readonly<{ scope: string; fingerprint: string; requestKey: string }>,
  ) {
    if (saving || committedCanonicalKeyRef.current === canonicalMutationKey) return
    setSaving(true)
    setMutationError("")
    setRefreshError("")
    try {
      const committed = await executeRegistrationObservationCommit(async () => {
        const result = await operation()
        if (shouldLockRegistrationObservationMutation(result)) {
          committedCanonicalKeyRef.current = canonicalMutationKey
          setCommittedCanonicalKey(canonicalMutationKey)
        }
        setSaving(false)
        return result
      }, onSaved)
      completeRegistrationObservationRequestKey({
        cache: requestKeysRef.current,
        scope: request.scope,
        fingerprint: request.fingerprint,
        requestKey: request.requestKey,
        refreshError: committed.refreshError,
      })
      if (committed.refreshError) {
        setRefreshError("저장됐지만 최신 청강 정보를 불러오지 못했습니다. 화면을 닫았다가 다시 열어 확인해 주세요.")
      }
      return committed.result
    } catch (error) {
      setMutationError(getRegistrationObservationUiErrorMessage(error, "청강 정보를 저장하지 못했습니다."))
      return null
    } finally {
      setSaving(false)
    }
  }

  async function enter() {
    const fingerprint = JSON.stringify({ trackId, workflowRevision })
    const scope = "registration-observation-enter"
    const requestKey = stableRequestKey(scope, fingerprint)
    const result = await commit(() => actions.enterRegistrationObservation({
      trackId,
      expectedWorkflowRevision: workflowRevision,
      requestKey,
    }), { scope, fingerprint, requestKey })
    if (result) setReceipt("예약 필요")
  }

  async function saveBooking() {
    if (!selectedSession || prerequisiteError) return
    const fingerprint = JSON.stringify({
      trackId,
      workflowRevision,
      observationId: current?.observationId || null,
      observationRevision,
      appointmentNotificationRevision,
      classId,
      sessionAuthority: selectedSession.sessionAuthority,
      classLessonSessionId: selectedSession.classLessonSessionId,
      legacySessionKey: selectedSession.legacySessionKey,
    })
    const scope = "registration-observation-booking"
    const requestKey = stableRequestKey(scope, fingerprint)
    const result = await commit(() => executeRegistrationObservationBooking(actions,
      buildRegistrationObservationBookingInput({
        trackId,
        workflowRevision,
        observationId: current?.observationId || null,
        observationRevision,
        appointmentNotificationRevision,
        classId,
        sessionAuthority: selectedSession.sessionAuthority,
        classLessonSessionId: selectedSession.classLessonSessionId,
        legacySessionKey: selectedSession.legacySessionKey,
        requestKey,
      }),
    ), { scope, fingerprint, requestKey })
    if (!result) return
    setReceipt("예약 저장됨")
    setSaveConfirmOpen(false)
  }

  async function cancelBooking() {
    if (!current || observationRevision === null || appointmentNotificationRevision === null) return
    const fingerprint = JSON.stringify({
      observationId: current.observationId,
      observationRevision,
      appointmentNotificationRevision,
    })
    const scope = "registration-observation-cancel"
    const requestKey = stableRequestKey(scope, fingerprint)
    const result = await commit(() => actions.cancelRegistrationObservation(
      buildRegistrationObservationCancelInput({
        observationId: current.observationId,
        observationRevision,
        appointmentNotificationRevision,
        requestKey,
      }),
    ), { scope, fingerprint, requestKey })
    if (!result) return
    setReceipt("예약 필요")
  }

  async function withdraw() {
    const result = await executeRegistrationObservationWithdrawal(
      withdrawSubmitState,
      async (normalizedReason) => {
        const [kind, target] = withdrawValue.split(":")
        const correction = kind === "director" ? withdrawalCorrection : null
        const fingerprint = JSON.stringify({
          trackId,
          workflowRevision,
          kind,
          target,
          reason: normalizedReason,
          correction,
        })
        const scope = "registration-observation-withdraw"
        const withdrawRequestKey = stableRequestKey(scope, fingerprint)
        let input: WithdrawRegistrationObservationInput
        if (kind === "return" && isObservationReturnTarget(target)) {
          input = buildRegistrationObservationWithdrawalInput({
            trackId,
            workflowRevision,
            exitKind: "return_to_previous",
            targetWorkflowStatus: target,
            reason: normalizedReason,
            requestKey: withdrawRequestKey,
            correction: null,
          })
        } else if (kind === "director" && isObservationDirectorTarget(target)) {
          input = buildRegistrationObservationWithdrawalInput({
            trackId,
            workflowRevision,
            exitKind: "director_decision",
            targetWorkflowStatus: target,
            reason: normalizedReason,
            requestKey: withdrawRequestKey,
            correction,
          })
        } else {
          setMutationError("청강 철회 다음 단계를 다시 선택하세요.")
          return null
        }
        return commit(
          () => actions.withdrawRegistrationObservation(input),
          { scope, fingerprint, requestKey: withdrawRequestKey },
        )
      },
    )
    if (result) setWithdrawOpen(false)
  }

  if (canEnter) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">상담 이후 청강 예약을 진행할 수 있습니다.</p>
        <div><Button type="button" onClick={() => void enter()} disabled={saving || mutationCommitted}>{saving ? "진행 중" : "청강 진행"}</Button></div>
        {receipt ? <p role="status" className="text-sm font-medium text-primary">{receipt}</p> : null}
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        {refreshError ? <p role="alert" className="text-sm text-destructive">{refreshError}</p> : null}
      </div>
    )
  }

  const statusLabel = receipt === "예약 필요"
    ? "예약 필요"
    : workflowStatus === "observation_feedback_pending"
      ? "교사 피드백 대기"
      : workflowStatus === "observation_completed"
        ? "청강 완료"
        : current?.status === "scheduled"
          ? "청강 예약"
          : "예약 필요"

  return (
    <div className="grid gap-4">
      <p role="status" className="text-sm font-medium">{statusLabel}</p>

      {canBook ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`registration-observation-class-${trackId}`}>반</Label>
            <RegistrationSelect
              id={`registration-observation-class-${trackId}`}
              aria-label="청강 반"
              value={classId}
              placeholder="반 선택"
              options={classOptions}
              disabled={saving || mutationCommitted}
              onValueChange={(value) => {
                setClassId(value)
                setSessionId("")
              }}
            />
            {!classId ? <p className="text-xs text-destructive">청강할 반을 선택하세요.</p> : null}
          </div>

          {classId ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`registration-observation-session-${trackId}`}>회차</Label>
              <RegistrationSelect
                id={`registration-observation-session-${trackId}`}
                aria-label="청강 회차"
                value={sessionId}
                placeholder={sessionsLoading ? "불러오는 중" : "회차 선택"}
                options={sessionOptions}
                disabled={saving || mutationCommitted || sessionsLoading}
                onValueChange={setSessionId}
              />
              {prerequisiteError ? <p className="text-xs text-destructive">{prerequisiteError}</p> : null}
            </div>
          ) : null}

          {selectedSession ? (
            <dl className="grid gap-2 rounded-md bg-muted/45 p-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">선생님</dt><dd>{selectedSession.teacherName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">강의실</dt><dd>{selectedSession.classroomName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">캠퍼스</dt><dd>{selectedSession.campus}</dd></div>
              <div><dt className="text-xs text-muted-foreground">교재</dt><dd>{selectedSession.textbooks.map((textbook) => textbook.title).filter(Boolean).join(", ") || "없음"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">진도</dt><dd>{selectedSession.progress || "미정"}</dd></div>
            </dl>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button ref={saveDialogTriggerRef} type="button" onClick={() => setSaveConfirmOpen(true)} disabled={saving || mutationCommitted || Boolean(prerequisiteError)}>저장</Button>
            {current?.appointmentStatus === "scheduled" ? <Button type="button" variant="outline" onClick={() => void cancelBooking()} disabled={saving || mutationCommitted}>예약 취소</Button> : null}
            {withdrawAvailable ? <Button ref={withdrawDialogTriggerRef} type="button" variant="ghost" onClick={() => setWithdrawOpen(true)} disabled={saving || mutationCommitted}>청강 철회</Button> : null}
          </div>
          {current?.appointmentStatus === "scheduled" ? <p className="text-xs text-muted-foreground">예약을 취소한 뒤 청강을 철회할 수 있습니다.</p> : null}
        </div>
      ) : null}

      {readOnly ? <p className="text-sm text-muted-foreground">현재 상태는 이 화면에서 변경할 수 없습니다.</p> : null}
      {receipt === "예약 저장됨" ? (
        <div role="status" className="grid gap-1 text-sm">
          <p className="font-medium text-primary">예약 저장됨</p>
          <p className="text-muted-foreground">고객 안내: 미발송</p>
        </div>
      ) : receipt ? <p role="status" className="text-sm font-medium text-primary">{receipt}</p> : null}
      {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
      {refreshError ? <p role="alert" className="text-sm text-destructive">{refreshError}</p> : null}

      <Dialog open={saveConfirmOpen} onOpenChange={handleSaveConfirmOpenChange}>
        <DialogContent
          showCloseButton={!saving}
          onEscapeKeyDown={handleDialogEscape}
          onCloseAutoFocus={handleSaveDialogCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>청강 예약을 저장할까요?</DialogTitle>
            <DialogDescription>선택한 반과 회차로 청강 예약을 저장합니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving || mutationCommitted}>돌아가기</Button></DialogClose>
            <Button type="button" onClick={() => void saveBooking()} disabled={saving || mutationCommitted}>{saving ? "저장 중" : "저장"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={handleWithdrawOpenChange}>
        <DialogContent
          showCloseButton={!saving}
          onEscapeKeyDown={handleDialogEscape}
          onCloseAutoFocus={handleWithdrawDialogCloseAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>청강 진행을 철회할까요?</DialogTitle>
            <DialogDescription>이전 단계로 돌아가거나 원장 판단에 따른 다음 단계를 선택합니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`registration-observation-withdraw-${trackId}`}>다음 단계</Label>
              <RegistrationSelect
                id={`registration-observation-withdraw-${trackId}`}
                aria-label="청강 철회 다음 단계"
                value={withdrawValue}
                placeholder="다음 단계 선택"
                options={[
                  ...(detail.track.observationReturnWorkflowStatus ? [{
                    value: `return:${detail.track.observationReturnWorkflowStatus}`,
                    label: "이전 단계로 돌아가기",
                  }] : []),
                  { value: "director:enrollment_requested", label: "등록 신청" },
                  { value: "director:waiting_current_class", label: "현재반 대기" },
                  { value: "director:waiting_new_class", label: "신규반 대기" },
                  { value: "director:waiting_next_opening", label: "다음 개강 알림" },
                  { value: "director:not_registered", label: "미등록" },
                ]}
                disabled={saving || mutationCommitted}
                onValueChange={(value) => {
                  setWithdrawValueTouched(true)
                  setWithdrawValue(value)
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`registration-observation-withdraw-reason-${trackId}`}>사유</Label>
              <Input
                id={`registration-observation-withdraw-reason-${trackId}`}
                value={withdrawReason}
                onChange={(event) => setWithdrawReason(event.target.value)}
                disabled={saving || mutationCommitted}
                aria-invalid={Boolean(withdrawSubmitState.fieldError)}
                aria-describedby={withdrawSubmitState.fieldError ? withdrawReasonErrorId : undefined}
              />
              {withdrawSubmitState.fieldError ? <p id={withdrawReasonErrorId} role="alert" className="text-xs text-destructive">{withdrawSubmitState.fieldError}</p> : null}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving || mutationCommitted}>취소</Button></DialogClose>
            <Button type="button" onClick={() => void withdraw()} disabled={withdrawSubmitState.submitDisabled}>{saving ? "처리 중" : "철회"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
