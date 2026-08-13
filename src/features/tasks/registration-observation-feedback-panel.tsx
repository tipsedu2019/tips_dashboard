"use client"

import { useEffect, useReducer, useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  completeRegistrationObservationRequestKey,
  getRegistrationObservationRequestKey,
} from "./registration-observation-editor"
import {
  getRegistrationObservationFeedbackErrorState,
  type RegistrationObservationDecisionKind,
  type RegistrationObservationFeedbackDetail,
  type RegistrationObservationManagerDetail,
} from "./registration-observation-model"
import { RegistrationSelect } from "./registration-select"
import type {
  CorrectRegistrationObservationFeedbackInput,
  DecideRegistrationObservationInput,
  RecordRegistrationObservationAttendanceInput,
  SubmitRegistrationObservationFeedbackInput,
} from "./registration-observation-service"

// registration-observation-feedback-panel-model:start
type RegistrationObservationFeedbackDraft = Readonly<{
  attendance: "attended" | "no_show" | ""
  suitabilityResult: "fit" | "unfit" | ""
  feedbackReason: string
  correctionReason: string
  decisionKind: RegistrationObservationDecisionKind | ""
}>

type RegistrationObservationFeedbackPanelState = Readonly<{
  detail: RegistrationObservationFeedbackDetail
  draft: RegistrationObservationFeedbackDraft
  saving: boolean
  errorMessage: string
  reloadRequired: boolean
  receipt: string
}>

type RegistrationObservationFeedbackPanelOutcome =
  | Readonly<{
      kind: "saving"
    }>
  | Readonly<{
      kind: "reloaded"
    }>
  | Readonly<{
      kind: "failed"
      errorMessage: string
      reloadRequired: boolean
    }>
  | Readonly<{
      kind: "committed"
      detail: RegistrationObservationFeedbackDetail
      receipt: string
    }>

export function createRegistrationObservationFeedbackPanelState(
  detail: RegistrationObservationFeedbackDetail,
): RegistrationObservationFeedbackPanelState {
  return {
    detail,
    draft: {
      attendance: detail.attendance || "",
      suitabilityResult: detail.suitabilityResult || "",
      feedbackReason: detail.feedbackReason || "",
      correctionReason: "",
      decisionKind: "",
    },
    saving: false,
    errorMessage: "",
    reloadRequired: false,
    receipt: "",
  }
}

export function canEditRegistrationObservationSuitability(
  detail: Pick<RegistrationObservationFeedbackDetail, "decisionKind">,
) {
  return detail.decisionKind === null
}

export function canEditRegistrationObservationFeedback(input: {
  canManageCase: boolean
  isAssignedTeacher: boolean
  decisionKind: RegistrationObservationFeedbackDetail["decisionKind"]
}) {
  return input.canManageCase
    || (input.decisionKind === null && input.isAssignedTeacher)
}

export function getRegistrationObservationFeedbackPanelAvailability(
  detail: Pick<RegistrationObservationFeedbackDetail, "status" | "startsAt" | "endsAt">,
  nowMs: number,
) {
  const startsAtMs = Date.parse(detail.startsAt)
  const endsAtMs = Date.parse(detail.endsAt)
  const validClock = Number.isFinite(nowMs)
    && Number.isFinite(startsAtMs)
    && Number.isFinite(endsAtMs)

  if (!validClock) {
    return {
      submitFeedback: false,
      submitNoShow: false,
      recordAttendance: false,
    } as const
  }

  return {
    submitFeedback: (
      detail.status === "scheduled"
      || detail.status === "attended_feedback_pending"
    ) && nowMs >= endsAtMs,
    submitNoShow: detail.status === "scheduled" && nowMs >= startsAtMs,
    recordAttendance: detail.status === "scheduled" && nowMs >= startsAtMs,
  } as const
}

export function canKeepRegistrationObservationFeedbackHistoryMounted(input: {
  canManageCase: boolean
  observationAttemptCount: number
}) {
  return input.canManageCase && input.observationAttemptCount > 0
}

export function shouldMountRegistrationObservationFeedbackOnly(input: {
  correctionOnly: boolean
  workflowActionable: boolean
}) {
  return input.correctionOnly && !input.workflowActionable
}

export function getRegistrationObservationFeedbackMountPlan(input: {
  managerDetail: Pick<
    RegistrationObservationManagerDetail,
    "currentObservation" | "latestDecisionObservation"
  > | null
  canManageObservation: boolean
  canManageCase: boolean
}) {
  if (!input.canManageObservation || !input.managerDetail) return null
  if (input.managerDetail.currentObservation) {
    return {
      observationId: input.managerDetail.currentObservation.observationId,
      correctionOnly: false,
    } as const
  }
  if (input.canManageCase && input.managerDetail.latestDecisionObservation) {
    return {
      observationId: input.managerDetail.latestDecisionObservation.observationId,
      correctionOnly: true,
    } as const
  }
  return null
}

export function updateRegistrationObservationFeedbackPanelDraft<
  K extends keyof RegistrationObservationFeedbackDraft,
>(
  state: RegistrationObservationFeedbackPanelState,
  field: K,
  value: RegistrationObservationFeedbackDraft[K],
): RegistrationObservationFeedbackPanelState {
  if (
    field === "suitabilityResult"
    && !canEditRegistrationObservationSuitability(state.detail)
  ) return state
  return {
    ...state,
    draft: { ...state.draft, [field]: value },
    errorMessage: state.reloadRequired ? state.errorMessage : "",
    reloadRequired: state.reloadRequired,
    receipt: "",
  }
}

export function applyRegistrationObservationFeedbackPanelOutcome(
  state: RegistrationObservationFeedbackPanelState,
  outcome: RegistrationObservationFeedbackPanelOutcome,
): RegistrationObservationFeedbackPanelState {
  if (outcome.kind === "saving") {
    return {
      ...state,
      saving: true,
      errorMessage: "",
      reloadRequired: false,
      receipt: "",
    }
  }
  if (outcome.kind === "reloaded") {
    return {
      ...state,
      saving: false,
      errorMessage: "",
      reloadRequired: false,
      receipt: "",
    }
  }
  if (outcome.kind === "failed") {
    return {
      ...state,
      saving: false,
      errorMessage: outcome.errorMessage,
      reloadRequired: outcome.reloadRequired,
    }
  }
  return {
    ...createRegistrationObservationFeedbackPanelState(outcome.detail),
    receipt: outcome.receipt,
  }
}

export function buildRegistrationObservationFeedbackSavePlan(
  state: RegistrationObservationFeedbackPanelState,
  requestKey: string,
  nowMs = Date.now(),
):
  | Readonly<{ ok: false; message: string }>
  | Readonly<{
      ok: true
      kind: "submit"
      input: SubmitRegistrationObservationFeedbackInput
    }>
  | Readonly<{
      ok: true
      kind: "correct"
      input: CorrectRegistrationObservationFeedbackInput
    }> {
  const { detail, draft } = state
  const feedbackReason = draft.feedbackReason.trim()

  if (detail.status === "completed") {
    const correctionReason = draft.correctionReason.trim()
    if (
      detail.decisionKind !== null
      && draft.suitabilityResult !== detail.suitabilityResult
    ) {
      return { ok: false, message: "결정 후에는 적합 여부를 변경할 수 없습니다." }
    }
    if (!draft.suitabilityResult || !feedbackReason || !correctionReason) {
      return { ok: false, message: "적합 여부, 피드백 사유와 정정 사유를 입력하세요." }
    }
    return {
      ok: true,
      kind: "correct",
      input: {
        observationId: detail.observationId,
        suitabilityResult: draft.suitabilityResult,
        feedbackReason,
        correctionReason,
        expectedObservationRevision: detail.revision,
        expectedFeedbackRevision: detail.feedbackRevision,
        expectedDecisionKind: detail.decisionKind,
        requestKey,
      },
    }
  }

  if (detail.status !== "scheduled" && detail.status !== "attended_feedback_pending") {
    return { ok: false, message: "현재 상태에서는 피드백을 저장할 수 없습니다." }
  }
  const attendance = detail.status === "attended_feedback_pending"
    ? "attended"
    : draft.attendance
  if (attendance !== "attended" && attendance !== "no_show") {
    return { ok: false, message: "참석 여부를 선택하세요." }
  }
  const availability = getRegistrationObservationFeedbackPanelAvailability(detail, nowMs)
  if (attendance === "no_show" && !availability.submitNoShow) {
    return { ok: false, message: "노쇼 처리는 수업 시작 후 저장할 수 있습니다." }
  }
  if (attendance === "attended" && !availability.submitFeedback) {
    return { ok: false, message: "참석 피드백은 수업 종료 후 저장할 수 있습니다." }
  }
  if (attendance === "no_show") {
    return {
      ok: true,
      kind: "submit",
      input: {
        observationId: detail.observationId,
        attendance,
        suitabilityResult: null,
        feedbackReason: null,
        expectedObservationRevision: detail.revision,
        expectedFeedbackRevision: detail.feedbackRevision,
        expectedAppointmentNotificationRevision: detail.appointmentNotificationRevision,
        requestKey,
      },
    }
  }
  if (!draft.suitabilityResult || !feedbackReason) {
    return { ok: false, message: "적합 여부와 피드백 사유를 입력하세요." }
  }
  return {
    ok: true,
    kind: "submit",
    input: {
      observationId: detail.observationId,
      attendance,
      suitabilityResult: draft.suitabilityResult,
      feedbackReason,
      expectedObservationRevision: detail.revision,
      expectedFeedbackRevision: detail.feedbackRevision,
      expectedAppointmentNotificationRevision: detail.appointmentNotificationRevision,
      requestKey,
    },
  }
}

export function buildRegistrationObservationDecisionPlan(
  state: RegistrationObservationFeedbackPanelState,
  requestKey: string,
):
  | Readonly<{ ok: false; message: string }>
  | Readonly<{ ok: true; input: DecideRegistrationObservationInput }> {
  const { detail, draft } = state
  if (detail.decisionKind !== null) {
    return { ok: false, message: "이미 원장 결정이 저장되었습니다." }
  }
  if (detail.status !== "completed" && detail.status !== "no_show") {
    return { ok: false, message: "피드백을 완료한 뒤 원장 결정을 저장하세요." }
  }
  if (!draft.decisionKind) return { ok: false, message: "원장 결정을 선택하세요." }
  return {
    ok: true,
    input: {
      observationId: detail.observationId,
      decisionKind: draft.decisionKind,
      waitingClassId: draft.decisionKind === "waiting_current_class" ? detail.classId : null,
      expectedObservationRevision: detail.revision,
      expectedFeedbackRevision: detail.feedbackRevision,
      expectedTrackWorkflowRevision: detail.trackWorkflowRevision,
      requestKey,
    },
  }
}

export async function executeRegistrationObservationDecision(input: {
  state: RegistrationObservationFeedbackPanelState
  actions: Pick<RegistrationObservationFeedbackActions, "decideRegistrationObservation">
  requestKey: string
  guard: { current: boolean }
  onSaved: (detail: RegistrationObservationFeedbackDetail) => void | Promise<void>
}) {
  if (input.guard.current) return { kind: "ignored" } as const
  const plan = buildRegistrationObservationDecisionPlan(input.state, input.requestKey)
  if (!plan.ok) return { kind: "invalid", message: plan.message } as const
  input.guard.current = true
  try {
    const detail = await input.actions.decideRegistrationObservation(plan.input)
    await input.onSaved(detail)
    return { kind: "committed", detail } as const
  } finally {
    input.guard.current = false
  }
}

export function formatRegistrationObservationFeedbackKst(timestamp: string) {
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime())) return ""
  const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000)
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth() + 1
  const day = kst.getUTCDate()
  const hours = String(kst.getUTCHours()).padStart(2, "0")
  const minutes = String(kst.getUTCMinutes()).padStart(2, "0")
  return `${year}. ${month}. ${day}. ${hours}:${minutes}`
}

export function getRegistrationObservationProxyLabel(
  detail: Pick<
    RegistrationObservationFeedbackDetail,
    "proxySubmitted" | "feedbackSubmittedByName" | "feedbackSubmittedAt"
  >,
) {
  if (
    detail.proxySubmitted !== true
    || !detail.feedbackSubmittedByName?.trim()
    || !detail.feedbackSubmittedAt
  ) return null
  const submittedAt = formatRegistrationObservationFeedbackKst(detail.feedbackSubmittedAt)
  if (!submittedAt) return null
  return `대리 입력 · ${detail.feedbackSubmittedByName} · ${submittedAt}`
}

export function getRegistrationObservationFeedbackRefreshPlan(input: {
  requestedOwnershipKey: string
  currentOwnershipKey: string
}) {
  const ownsPanel = Boolean(
    input.requestedOwnershipKey
    && input.requestedOwnershipKey === input.currentOwnershipKey,
  )
  return {
    ownsPanel,
    mutatePanelState: ownsPanel,
  }
}

export async function loadRegistrationObservationFeedbackForOwnedPanel<T>(input: {
  requestedOwnershipKey: string
  currentOwnershipKey: string
  load: () => Promise<T>
}): Promise<T | null> {
  const plan = getRegistrationObservationFeedbackRefreshPlan(input)
  if (!plan.ownsPanel) return null
  return input.load()
}

export async function executeRegistrationObservationFeedbackReload(input: {
  guard: { current: boolean }
  onReload: () => void | Promise<void>
  normalizeError: (error: unknown) => { message: string; reloadRequired: boolean }
}) {
  if (input.guard.current) return { kind: "ignored" } as const
  input.guard.current = true
  try {
    await input.onReload()
    return { kind: "reloaded" } as const
  } catch (error) {
    const errorState = input.normalizeError(error)
    return {
      kind: "failed",
      errorMessage: errorState.message,
      reloadRequired: true,
    } as const
  } finally {
    input.guard.current = false
  }
}
// registration-observation-feedback-panel-model:end

export type RegistrationObservationFeedbackActions = Readonly<{
  recordRegistrationObservationAttendance: (
    input: RecordRegistrationObservationAttendanceInput,
  ) => Promise<RegistrationObservationFeedbackDetail>
  submitRegistrationObservationFeedback: (
    input: SubmitRegistrationObservationFeedbackInput,
  ) => Promise<RegistrationObservationFeedbackDetail>
  correctRegistrationObservationFeedback: (
    input: CorrectRegistrationObservationFeedbackInput,
  ) => Promise<RegistrationObservationFeedbackDetail>
  decideRegistrationObservation: (
    input: DecideRegistrationObservationInput,
  ) => Promise<RegistrationObservationFeedbackDetail>
}>

export type RegistrationObservationFeedbackPanelProps = Readonly<{
  detail: RegistrationObservationFeedbackDetail
  canRecordAttendance: boolean
  canEditFeedback: boolean
  canDecide: boolean
  actions: RegistrationObservationFeedbackActions
  onSaved: (detail: RegistrationObservationFeedbackDetail) => void | Promise<void>
  onReload: () => void | Promise<void>
}>

type PanelReducerAction =
  | Readonly<{ type: "reset"; detail: RegistrationObservationFeedbackDetail }>
  | Readonly<{
      type: "draft"
      field: keyof RegistrationObservationFeedbackDraft
      value: RegistrationObservationFeedbackDraft[keyof RegistrationObservationFeedbackDraft]
    }>
  | Readonly<{ type: "outcome"; outcome: RegistrationObservationFeedbackPanelOutcome }>

function panelReducer(
  state: RegistrationObservationFeedbackPanelState,
  action: PanelReducerAction,
) {
  if (action.type === "reset") return createRegistrationObservationFeedbackPanelState(action.detail)
  if (action.type === "outcome") {
    return applyRegistrationObservationFeedbackPanelOutcome(state, action.outcome)
  }
  return updateRegistrationObservationFeedbackPanelDraft(state, action.field, action.value)
}

const STATUS_LABELS: Record<RegistrationObservationFeedbackDetail["status"], string> = {
  scheduled: "청강 예정",
  attended_feedback_pending: "피드백 대기",
  completed: "피드백 완료",
  no_show: "불참",
  canceled: "취소",
}

const DECISION_LABELS: Record<RegistrationObservationDecisionKind, string> = {
  enrollment: "등록",
  waiting_current_class: "현재반 대기",
  waiting_new_class: "신규반 대기",
  waiting_next_opening: "다음 개강 대기",
  not_registered: "미등록",
  re_observation: "재청강",
}

export function RegistrationObservationFeedbackPanel({
  detail,
  canRecordAttendance,
  canEditFeedback,
  canDecide,
  actions,
  onSaved,
  onReload,
}: RegistrationObservationFeedbackPanelProps) {
  const [state, dispatch] = useReducer(
    panelReducer,
    detail,
    createRegistrationObservationFeedbackPanelState,
  )
  const requestKeysRef = useRef(new Map<string, string>())
  const mutationGuardRef = useRef(false)
  const proxyLabel = getRegistrationObservationProxyLabel(state.detail)
  const availability = getRegistrationObservationFeedbackPanelAvailability(
    state.detail,
    Date.now(),
  )
  const feedbackEditable = canEditFeedback && (
    state.detail.status === "scheduled"
    || state.detail.status === "attended_feedback_pending"
    || state.detail.status === "completed"
  )
  const decisionEditable = canDecide
    && state.detail.decisionKind === null
    && (state.detail.status === "completed" || state.detail.status === "no_show")
  const feedbackCommitAvailable = state.detail.status === "completed"
    || (state.draft.attendance === "no_show"
      ? availability.submitNoShow
      : availability.submitFeedback)

  useEffect(() => {
    dispatch({ type: "reset", detail })
  }, [detail])

  function stableRequest(scope: string, fingerprint: string) {
    return getRegistrationObservationRequestKey(
      requestKeysRef.current,
      scope,
      fingerprint,
      () => `${scope}:${crypto.randomUUID()}`,
    )
  }

  function updateDraft<K extends keyof RegistrationObservationFeedbackDraft>(
    field: K,
    value: RegistrationObservationFeedbackDraft[K],
  ) {
    dispatch({ type: "draft", field, value })
  }

  async function commitFeedback() {
    if (mutationGuardRef.current) return
    const fingerprint = JSON.stringify({
      observationId: state.detail.observationId,
      revision: state.detail.revision,
      feedbackRevision: state.detail.feedbackRevision,
      attendance: state.draft.attendance,
      suitabilityResult: state.draft.suitabilityResult,
      feedbackReason: state.draft.feedbackReason.trim(),
      correctionReason: state.draft.correctionReason.trim(),
    })
    const scope = "registration-observation-feedback"
    const requestKey = stableRequest(scope, fingerprint)
    const plan = buildRegistrationObservationFeedbackSavePlan(state, requestKey)
    if (!plan.ok) {
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", errorMessage: plan.message, reloadRequired: false },
      })
      return
    }
    mutationGuardRef.current = true
    dispatch({ type: "outcome", outcome: { kind: "saving" } })
    try {
      const saved = plan.kind === "correct"
        ? await actions.correctRegistrationObservationFeedback(plan.input)
        : await actions.submitRegistrationObservationFeedback(plan.input)
      await onSaved(saved)
      completeRegistrationObservationRequestKey({
        cache: requestKeysRef.current,
        scope,
        fingerprint,
        requestKey,
        refreshError: null,
      })
      dispatch({
        type: "outcome",
        outcome: { kind: "committed", detail: saved, receipt: "피드백 저장됨" },
      })
    } catch (error) {
      const errorState = getRegistrationObservationFeedbackErrorState(error)
      dispatch({ type: "outcome", outcome: { kind: "failed", ...errorState, errorMessage: errorState.message } })
    } finally {
      mutationGuardRef.current = false
    }
  }

  async function recordAttendance() {
    if (
      mutationGuardRef.current
      || state.detail.status !== "scheduled"
      || !getRegistrationObservationFeedbackPanelAvailability(state.detail, Date.now()).recordAttendance
    ) return
    const fingerprint = JSON.stringify({
      observationId: state.detail.observationId,
      revision: state.detail.revision,
      appointmentNotificationRevision: state.detail.appointmentNotificationRevision,
    })
    const scope = "registration-observation-attendance"
    const requestKey = stableRequest(scope, fingerprint)
    mutationGuardRef.current = true
    dispatch({ type: "outcome", outcome: { kind: "saving" } })
    try {
      const saved = await actions.recordRegistrationObservationAttendance({
        observationId: state.detail.observationId,
        expectedObservationRevision: state.detail.revision,
        expectedAppointmentNotificationRevision: state.detail.appointmentNotificationRevision,
        requestKey,
      })
      await onSaved(saved)
      completeRegistrationObservationRequestKey({
        cache: requestKeysRef.current,
        scope,
        fingerprint,
        requestKey,
        refreshError: null,
      })
      dispatch({
        type: "outcome",
        outcome: { kind: "committed", detail: saved, receipt: "참석 확인됨" },
      })
    } catch (error) {
      const errorState = getRegistrationObservationFeedbackErrorState(error)
      dispatch({ type: "outcome", outcome: { kind: "failed", ...errorState, errorMessage: errorState.message } })
    } finally {
      mutationGuardRef.current = false
    }
  }

  async function commitDecision() {
    const fingerprint = JSON.stringify({
      observationId: state.detail.observationId,
      revision: state.detail.revision,
      feedbackRevision: state.detail.feedbackRevision,
      trackWorkflowRevision: state.detail.trackWorkflowRevision,
      decisionKind: state.draft.decisionKind,
    })
    const scope = "registration-observation-decision"
    const requestKey = stableRequest(scope, fingerprint)
    const plan = buildRegistrationObservationDecisionPlan(state, requestKey)
    if (!plan.ok) {
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", errorMessage: plan.message, reloadRequired: false },
      })
      return
    }
    dispatch({ type: "outcome", outcome: { kind: "saving" } })
    try {
      const result = await executeRegistrationObservationDecision({
        state,
        actions,
        requestKey,
        guard: mutationGuardRef,
        onSaved,
      })
      if (result.kind !== "committed") return
      completeRegistrationObservationRequestKey({
        cache: requestKeysRef.current,
        scope,
        fingerprint,
        requestKey,
        refreshError: null,
      })
      dispatch({
        type: "outcome",
        outcome: { kind: "committed", detail: result.detail, receipt: "원장 결정 저장됨" },
      })
    } catch (error) {
      const errorState = getRegistrationObservationFeedbackErrorState(error)
      dispatch({ type: "outcome", outcome: { kind: "failed", ...errorState, errorMessage: errorState.message } })
    }
  }

  async function reloadFeedback() {
    if (mutationGuardRef.current) return
    dispatch({ type: "outcome", outcome: { kind: "saving" } })
    const outcome = await executeRegistrationObservationFeedbackReload({
      guard: mutationGuardRef,
      onReload,
      normalizeError: getRegistrationObservationFeedbackErrorState,
    })
    if (outcome.kind === "ignored") return
    dispatch({ type: "outcome", outcome })
  }

  return (
    <section className="grid gap-4 border-t pt-4" aria-labelledby={`observation-feedback-${detail.observationId}`}>
      <div className="grid gap-1">
        <h3 id={`observation-feedback-${detail.observationId}`} className="text-sm font-semibold">청강 피드백</h3>
        <p className="text-sm text-muted-foreground">
          {STATUS_LABELS[state.detail.status]} · {state.detail.className} · 담당 {state.detail.teacherName}
        </p>
        {proxyLabel ? <p className="text-xs text-muted-foreground">{proxyLabel}</p> : null}
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">참석</dt><dd>{state.detail.attendance === "attended" ? "참석" : state.detail.attendance === "no_show" ? "불참" : "미확인"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">적합 여부</dt><dd>{state.detail.suitabilityResult === "fit" ? "적합" : state.detail.suitabilityResult === "unfit" ? "부적합" : "미입력"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">원장 결정</dt><dd>{state.detail.decisionKind ? DECISION_LABELS[state.detail.decisionKind] : "미결정"}</dd></div>
        {state.detail.feedbackReason ? <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">피드백 사유</dt><dd className="whitespace-pre-wrap">{state.detail.feedbackReason}</dd></div> : null}
      </dl>

      {feedbackEditable ? (
        <div className="grid gap-3">
          {state.detail.status === "scheduled" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`observation-attendance-${detail.observationId}`}>참석 여부</Label>
              <RegistrationSelect
                id={`observation-attendance-${detail.observationId}`}
                value={state.draft.attendance}
                placeholder="참석 여부 선택"
                options={[{ value: "attended", label: "참석" }, { value: "no_show", label: "불참" }]}
                disabled={state.saving}
                onValueChange={(value) => updateDraft("attendance", value as RegistrationObservationFeedbackDraft["attendance"])}
              />
            </div>
          ) : null}
          {state.detail.status !== "scheduled" || state.draft.attendance === "attended" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`observation-suitability-${detail.observationId}`}>적합 여부</Label>
                <RegistrationSelect
                  id={`observation-suitability-${detail.observationId}`}
                  value={state.draft.suitabilityResult}
                  placeholder="적합 여부 선택"
                  options={[{ value: "fit", label: "적합" }, { value: "unfit", label: "부적합" }]}
                  disabled={state.saving || !canEditRegistrationObservationSuitability(state.detail)}
                  onValueChange={(value) => updateDraft("suitabilityResult", value as RegistrationObservationFeedbackDraft["suitabilityResult"])}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`observation-feedback-reason-${detail.observationId}`}>피드백 사유</Label>
                <Textarea
                  id={`observation-feedback-reason-${detail.observationId}`}
                  value={state.draft.feedbackReason}
                  disabled={state.saving}
                  onChange={(event) => updateDraft("feedbackReason", event.target.value)}
                />
              </div>
            </>
          ) : null}
          {state.detail.status === "completed" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`observation-correction-reason-${detail.observationId}`}>정정 사유</Label>
              <Textarea
                id={`observation-correction-reason-${detail.observationId}`}
                value={state.draft.correctionReason}
                disabled={state.saving}
                onChange={(event) => updateDraft("correctionReason", event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void commitFeedback()} disabled={state.saving || !feedbackCommitAvailable}>
              {state.saving ? "저장 중" : state.detail.status === "completed" ? "피드백 정정" : "피드백 저장"}
            </Button>
            {canRecordAttendance && state.detail.status === "scheduled" ? (
              <Button type="button" variant="outline" onClick={() => void recordAttendance()} disabled={state.saving || !availability.recordAttendance}>
                참석만 확인
              </Button>
            ) : null}
          </div>
          {state.detail.status === "scheduled" && !availability.recordAttendance ? (
            <p className="text-sm text-muted-foreground">수업 시작 후 노쇼 또는 참석 확인을 사용할 수 있습니다.</p>
          ) : null}
          {state.draft.attendance !== "no_show" && !availability.submitFeedback ? (
            <p className="text-sm text-muted-foreground">수업 종료 후 참석 피드백을 저장할 수 있습니다.</p>
          ) : null}
        </div>
      ) : null}

      {decisionEditable ? (
        <div className="grid gap-2">
          <Label htmlFor={`observation-decision-${detail.observationId}`}>원장 결정</Label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <RegistrationSelect
              id={`observation-decision-${detail.observationId}`}
              value={state.draft.decisionKind}
              placeholder="결정 선택"
              options={Object.entries(DECISION_LABELS).map(([value, label]) => ({ value, label }))}
              disabled={state.saving}
              onValueChange={(value) => updateDraft("decisionKind", value as RegistrationObservationFeedbackDraft["decisionKind"])}
            />
            <Button type="button" onClick={() => void commitDecision()} disabled={state.saving || !state.draft.decisionKind}>
              {state.saving ? "저장 중" : "결정 저장"}
            </Button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="grid gap-2">
        {state.receipt ? <p role="status" className="text-sm font-medium text-primary">{state.receipt}</p> : null}
        {state.errorMessage ? <p role="alert" className="text-sm text-destructive">{state.errorMessage}</p> : null}
        {state.reloadRequired ? (
          <div><Button type="button" variant="outline" onClick={() => void reloadFeedback()} disabled={state.saving}>다시 불러오기</Button></div>
        ) : null}
      </div>
    </section>
  )
}
