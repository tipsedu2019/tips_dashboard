"use client"

import type {
  RegistrationObservationDecisionKind,
  RegistrationObservationFeedbackDetail,
  RegistrationObservationManagerDetail,
} from "./registration-observation-model"

// registration-observation-feedback-panel-model:start
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

// registration-observation-feedback-panel-model:end

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

export function RegistrationObservationFeedbackPanel({ detail }: Readonly<{
  detail: RegistrationObservationFeedbackDetail
}>) {
  const proxyLabel = getRegistrationObservationProxyLabel(detail)
  const hasLegacyFeedback = Boolean(
    detail.suitabilityResult
    || detail.feedbackReason
    || detail.feedbackSubmittedAt,
  )

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
          기존 청강 이력
        </h3>
        <p className="text-sm text-muted-foreground">
          {STATUS_LABELS[detail.status]} · {detail.className} · 담당 {detail.teacherName}
        </p>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">출석 이력</dt>
          <dd>
            {detail.attendance === "attended"
              ? "참석"
              : detail.attendance === "no_show"
                ? "불참"
                : "미확인"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">원장 결정</dt>
          <dd>
            {detail.decisionKind
              ? DECISION_LABELS[detail.decisionKind]
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
                {detail.suitabilityResult === "fit"
                  ? "적합"
                  : detail.suitabilityResult === "unfit"
                    ? "부적합"
                    : "미입력"}
              </dd>
            </div>
            {detail.feedbackReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">기존 사유</dt>
                <dd className="whitespace-pre-wrap">{detail.feedbackReason}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
    </section>
  )
}
