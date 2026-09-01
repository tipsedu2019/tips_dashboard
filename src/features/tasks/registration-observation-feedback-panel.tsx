"use client"

import { useEffect, useReducer, useRef } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

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
  DecideRegistrationObservationInput,
  RecordRegistrationObservationAttendanceInput,
} from "./registration-observation-service"

// registration-observation-feedback-panel-model:start
type RegistrationObservationFeedbackPanelState = Readonly<{
  detail: RegistrationObservationFeedbackDetail
  decisionKind: RegistrationObservationDecisionKind | ""
  saving: boolean
  errorMessage: string
  reloadRequired: boolean
  receipt: string
}>

type RegistrationObservationFeedbackPanelOutcome =
  | Readonly<{ kind: "saving" }>
  | Readonly<{ kind: "reloaded" }>
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
    decisionKind: "",
    saving: false,
    errorMessage: "",
    reloadRequired: false,
    receipt: "",
  }
}

export function getRegistrationObservationAttendanceAvailability(
  detail: Pick<RegistrationObservationFeedbackDetail, "status" | "startsAt">,
  nowMs: number,
) {
  const startsAtMs = Date.parse(detail.startsAt)
  return detail.status === "scheduled"
    && Number.isFinite(nowMs)
    && Number.isFinite(startsAtMs)
    && nowMs >= startsAtMs
}

export function canKeepRegistrationObservationFeedbackHistoryMounted(input: {
  canManageCase: boolean
  observationAttemptCount: number
}) {
  return input.canManageCase && input.observationAttemptCount > 0
}

export function shouldMountRegistrationObservationFeedbackOnly(input: {
  historyOnly: boolean
  workflowActionable: boolean
}) {
  return input.historyOnly && !input.workflowActionable
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
      historyOnly: false,
    } as const
  }
  if (input.canManageCase && input.managerDetail.latestDecisionObservation) {
    return {
      observationId: input.managerDetail.latestDecisionObservation.observationId,
      historyOnly: true,
    } as const
  }
  return null
}

export function updateRegistrationObservationDecisionDraft(
  state: RegistrationObservationFeedbackPanelState,
  decisionKind: RegistrationObservationDecisionKind | "",
): RegistrationObservationFeedbackPanelState {
  return {
    ...state,
    decisionKind,
    errorMessage: state.reloadRequired ? state.errorMessage : "",
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

export function buildRegistrationObservationDecisionPlan(
  state: RegistrationObservationFeedbackPanelState,
  requestKey: string,
):
  | Readonly<{ ok: false; message: string }>
  | Readonly<{ ok: true; input: DecideRegistrationObservationInput }> {
  const { detail } = state
  if (detail.decisionKind !== null) {
    return { ok: false, message: "이미 원장 결정이 저장되었습니다." }
  }
  if (
    detail.status !== "attended_feedback_pending"
    && detail.status !== "completed"
    && detail.status !== "no_show"
  ) {
    return { ok: false, message: "참석 또는 불참을 확인한 뒤 원장 결정을 저장하세요." }
  }
  if (!state.decisionKind) {
    return { ok: false, message: "원장 결정을 선택하세요." }
  }
  return {
    ok: true,
    input: {
      observationId: detail.observationId,
      decisionKind: state.decisionKind,
      waitingClassId: state.decisionKind === "waiting_current_class" ? detail.classId : null,
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
  return `대리 입력 · ${detail.feedbackSubmittedByName.trim()} · ${submittedAt}`
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
  decideRegistrationObservation: (
    input: DecideRegistrationObservationInput,
  ) => Promise<RegistrationObservationFeedbackDetail>
}>

export type RegistrationObservationFeedbackPanelProps = Readonly<{
  detail: RegistrationObservationFeedbackDetail
  canRecordAttendance: boolean
  canDecide: boolean
  actions: RegistrationObservationFeedbackActions
  onSaved: (detail: RegistrationObservationFeedbackDetail) => void | Promise<void>
  onReload: () => void | Promise<void>
}>

type PanelReducerAction =
  | Readonly<{ type: "reset"; detail: RegistrationObservationFeedbackDetail }>
  | Readonly<{
      type: "decision"
      value: RegistrationObservationDecisionKind | ""
    }>
  | Readonly<{
      type: "outcome"
      outcome: RegistrationObservationFeedbackPanelOutcome
    }>

function panelReducer(
  state: RegistrationObservationFeedbackPanelState,
  action: PanelReducerAction,
) {
  if (action.type === "reset") {
    return createRegistrationObservationFeedbackPanelState(action.detail)
  }
  if (action.type === "decision") {
    return updateRegistrationObservationDecisionDraft(state, action.value)
  }
  return applyRegistrationObservationFeedbackPanelOutcome(state, action.outcome)
}

const STATUS_LABELS: Record<RegistrationObservationFeedbackDetail["status"], string> = {
  scheduled: "청강 예정",
  attended_feedback_pending: "참석 확인됨",
  completed: "청강 기록 완료",
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
  const attendanceAvailable = getRegistrationObservationAttendanceAvailability(
    state.detail,
    Date.now(),
  )
  const decisionEditable = canDecide
    && state.detail.decisionKind === null
    && (
      state.detail.status === "attended_feedback_pending"
      || state.detail.status === "completed"
      || state.detail.status === "no_show"
    )
  const hasLegacyFeedback = Boolean(
    state.detail.suitabilityResult
    || state.detail.feedbackReason
    || state.detail.feedbackSubmittedAt,
  )

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

  async function recordAttendance() {
    if (
      mutationGuardRef.current
      || state.reloadRequired
      || !canRecordAttendance
      || !getRegistrationObservationAttendanceAvailability(state.detail, Date.now())
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
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", ...errorState, errorMessage: errorState.message },
      })
    } finally {
      mutationGuardRef.current = false
    }
  }

  async function commitDecision() {
    if (state.reloadRequired) return
    const fingerprint = JSON.stringify({
      observationId: state.detail.observationId,
      revision: state.detail.revision,
      feedbackRevision: state.detail.feedbackRevision,
      trackWorkflowRevision: state.detail.trackWorkflowRevision,
      decisionKind: state.decisionKind,
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
        outcome: {
          kind: "committed",
          detail: result.detail,
          receipt: "원장 결정 저장됨",
        },
      })
    } catch (error) {
      const errorState = getRegistrationObservationFeedbackErrorState(error)
      dispatch({
        type: "outcome",
        outcome: { kind: "failed", ...errorState, errorMessage: errorState.message },
      })
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
    <section
      className="grid gap-4 border-t pt-4"
      aria-labelledby={`observation-review-${detail.observationId}`}
    >
      <div className="grid gap-1">
        <h3
          id={`observation-review-${detail.observationId}`}
          className="text-sm font-semibold"
        >
          청강 확인
        </h3>
        <p className="text-sm text-muted-foreground">
          {STATUS_LABELS[state.detail.status]} · {state.detail.className} · 담당 {state.detail.teacherName}
        </p>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">출석 이력</dt>
          <dd>
            {state.detail.attendance === "attended"
              ? "참석"
              : state.detail.attendance === "no_show"
                ? "불참"
                : "미확인"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">원장 결정</dt>
          <dd>
            {state.detail.decisionKind
              ? DECISION_LABELS[state.detail.decisionKind]
              : "미결정"}
          </dd>
        </div>
      </dl>

      {hasLegacyFeedback ? (
        <section className="grid gap-2 rounded-md border bg-muted/20 p-3" aria-label="기존 피드백 기록">
          <div className="grid gap-1">
            <h4 className="text-sm font-medium">기존 피드백 기록</h4>
            <p className="text-xs text-muted-foreground">과거 입력 내용은 기록으로만 표시됩니다.</p>
            {proxyLabel ? <p className="text-xs text-muted-foreground">{proxyLabel}</p> : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">적합 여부</dt>
              <dd>
                {state.detail.suitabilityResult === "fit"
                  ? "적합"
                  : state.detail.suitabilityResult === "unfit"
                    ? "부적합"
                    : "미입력"}
              </dd>
            </div>
            {state.detail.feedbackReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">기존 사유</dt>
                <dd className="whitespace-pre-wrap">{state.detail.feedbackReason}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {state.detail.status === "attended_feedback_pending" ? (
        <p className="text-sm text-muted-foreground">
          담당 강사의 Google Chat 보고를 확인한 뒤 원장 결정을 저장하세요.
        </p>
      ) : null}

      {canRecordAttendance && state.detail.status === "scheduled" ? (
        <div className="grid gap-2">
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void recordAttendance()}
              disabled={state.saving || state.reloadRequired || !attendanceAvailable}
            >
              {state.saving ? "저장 중" : "참석 확인"}
            </Button>
          </div>
          {!attendanceAvailable ? (
            <p className="text-sm text-muted-foreground">
              수업 시작 후 참석을 확인할 수 있습니다.
            </p>
          ) : null}
        </div>
      ) : null}

      {decisionEditable ? (
        <div className="grid gap-2">
          <Label htmlFor={`observation-decision-${detail.observationId}`}>원장 결정</Label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <RegistrationSelect
              id={`observation-decision-${detail.observationId}`}
              value={state.decisionKind}
              placeholder="결정 선택"
              options={Object.entries(DECISION_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              disabled={state.saving || state.reloadRequired}
              onValueChange={(value) => dispatch({
                type: "decision",
                value: value as RegistrationObservationDecisionKind,
              })}
            />
            <Button
              type="button"
              onClick={() => void commitDecision()}
              disabled={state.saving || state.reloadRequired || !state.decisionKind}
            >
              {state.saving ? "저장 중" : "결정 저장"}
            </Button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" className="grid gap-2">
        {state.receipt ? (
          <p role="status" className="text-sm font-medium text-primary">
            {state.receipt}
          </p>
        ) : null}
        {state.errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {state.errorMessage}
          </p>
        ) : null}
        {state.reloadRequired ? (
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reloadFeedback()}
              disabled={state.saving}
            >
              다시 불러오기
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
