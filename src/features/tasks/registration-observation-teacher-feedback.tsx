"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/providers/auth-provider"

import {
  getRegistrationObservationFeedbackErrorState,
  type RegistrationObservationFeedbackDetail,
  type RegistrationObservationFeedbackErrorState,
} from "./registration-observation-model"
import {
  loadRegistrationObservationFeedback,
  recordRegistrationObservationAttendance,
  submitRegistrationObservationFeedback,
  type RecordRegistrationObservationAttendanceInput,
  type SubmitRegistrationObservationFeedbackInput,
} from "./registration-observation-service"
import { RegistrationSelect } from "@/features/tasks/registration-select"

type RegistrationObservationTeacherFeedbackDraft = Readonly<{
  suitabilityResult: "fit" | "unfit" | ""
  feedbackReason: string
}>

type RegistrationObservationTeacherFeedbackAction =
  | "submit_feedback"
  | "no_show"
  | "record_attendance"

type RegistrationObservationTeacherFeedbackField =
  | "suitabilityResult"
  | "feedbackReason"

type RegistrationObservationTeacherFeedbackPlan =
  | Readonly<{
      ok: false
      message: string
      field: RegistrationObservationTeacherFeedbackField | null
    }>
  | Readonly<{
      ok: true
      kind: "submit_feedback"
      input: Omit<SubmitRegistrationObservationFeedbackInput, "requestKey">
    }>
  | Readonly<{
      ok: true
      kind: "record_attendance"
      input: Omit<RecordRegistrationObservationAttendanceInput, "requestKey">
    }>

// registration-observation-teacher-feedback-model:start
export function getRegistrationObservationTeacherFeedbackAvailability(
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

export function getRegistrationObservationTeacherFeedbackNextBoundary(
  detail: Pick<RegistrationObservationFeedbackDetail, "status" | "startsAt" | "endsAt">,
  nowMs: number,
) {
  const startsAtMs = Date.parse(detail.startsAt)
  const endsAtMs = Date.parse(detail.endsAt)
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(startsAtMs)
    || !Number.isFinite(endsAtMs)
  ) return null
  if (detail.status === "scheduled" && nowMs < startsAtMs) return startsAtMs
  if (
    (detail.status === "scheduled" || detail.status === "attended_feedback_pending")
    && nowMs < endsAtMs
  ) return endsAtMs
  return null
}

export function buildRegistrationObservationTeacherFeedbackPlan(input: {
  detail: RegistrationObservationFeedbackDetail
  draft: RegistrationObservationTeacherFeedbackDraft
  action: RegistrationObservationTeacherFeedbackAction
  nowMs: number
  allowAttendanceOnly: boolean
}): RegistrationObservationTeacherFeedbackPlan {
  const { detail, draft, action } = input
  const availability = getRegistrationObservationTeacherFeedbackAvailability(
    detail,
    input.nowMs,
  )

  if (action === "record_attendance") {
    if (!input.allowAttendanceOnly) {
      return {
        ok: false,
        message: "이 작업을 수행할 수 없습니다.",
        field: null,
      }
    }
    if (detail.status !== "scheduled") {
      return {
        ok: false,
        message: "현재 상태에서는 참석만 확인할 수 없습니다.",
        field: null,
      }
    }
    if (!availability.recordAttendance) {
      return {
        ok: false,
        message: "수업 시작 후 참석을 확인할 수 있습니다.",
        field: null,
      }
    }
    return {
      ok: true,
      kind: "record_attendance",
      input: {
        observationId: detail.observationId,
        expectedObservationRevision: detail.revision,
        expectedAppointmentNotificationRevision:
          detail.appointmentNotificationRevision,
      },
    }
  }

  if (action === "no_show") {
    if (detail.status !== "scheduled") {
      return {
        ok: false,
        message: "현재 상태에서는 노쇼로 처리할 수 없습니다.",
        field: null,
      }
    }
    if (!availability.submitNoShow) {
      return {
        ok: false,
        message: "수업 시작 후 노쇼로 처리할 수 있습니다.",
        field: null,
      }
    }
    return {
      ok: true,
      kind: "submit_feedback",
      input: {
        observationId: detail.observationId,
        attendance: "no_show",
        suitabilityResult: null,
        feedbackReason: null,
        expectedObservationRevision: detail.revision,
        expectedFeedbackRevision: detail.feedbackRevision,
        expectedAppointmentNotificationRevision:
          detail.appointmentNotificationRevision,
      },
    }
  }

  if (
    detail.status !== "scheduled"
    && detail.status !== "attended_feedback_pending"
  ) {
    return {
      ok: false,
      message: "현재 상태에서는 피드백을 저장할 수 없습니다.",
      field: null,
    }
  }
  if (!availability.submitFeedback) {
    return {
      ok: false,
      message: "수업 종료 후 피드백을 저장할 수 있습니다.",
      field: null,
    }
  }
  if (!draft.suitabilityResult) {
    return {
      ok: false,
      message: "적합 여부를 선택하세요.",
      field: "suitabilityResult",
    }
  }
  const feedbackReason = draft.feedbackReason.trim()
  if (!feedbackReason) {
    return {
      ok: false,
      message: "피드백 사유를 입력하세요.",
      field: "feedbackReason",
    }
  }
  return {
    ok: true,
    kind: "submit_feedback",
    input: {
      observationId: detail.observationId,
      attendance: "attended",
      suitabilityResult: draft.suitabilityResult,
      feedbackReason,
      expectedObservationRevision: detail.revision,
      expectedFeedbackRevision: detail.feedbackRevision,
      expectedAppointmentNotificationRevision:
        detail.appointmentNotificationRevision,
    },
  }
}

function formatRegistrationObservationTeacherFeedbackKst(timestamp: string) {
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

export function getRegistrationObservationTeacherProxyLabel(
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
  const submittedAt = formatRegistrationObservationTeacherFeedbackKst(
    detail.feedbackSubmittedAt,
  )
  if (!submittedAt) return null
  return `대리 입력 · ${detail.feedbackSubmittedByName.trim()} · ${submittedAt}`
}

export async function executeRegistrationObservationTeacherFeedbackLoad<T>(input: {
  requestedOwnershipKey: string
  currentOwnershipKey: () => string
  load: () => Promise<T>
  normalizeError: (error: unknown) => RegistrationObservationFeedbackErrorState
}) {
  try {
    const detail = await input.load()
    if (input.currentOwnershipKey() !== input.requestedOwnershipKey) {
      return { kind: "stale" } as const
    }
    return { kind: "loaded", detail } as const
  } catch (error) {
    if (input.currentOwnershipKey() !== input.requestedOwnershipKey) {
      return { kind: "stale" } as const
    }
    const errorState = input.normalizeError(error)
    return {
      kind: "failed",
      errorMessage: errorState.message,
      reloadRequired: errorState.reloadRequired,
    } as const
  }
}

export async function executeRegistrationObservationTeacherFeedbackMutation(
  input: {
    detail: RegistrationObservationFeedbackDetail
    draft: RegistrationObservationTeacherFeedbackDraft
    action: RegistrationObservationTeacherFeedbackAction
    nowMs: number
    allowAttendanceOnly: boolean
    guard: { current: boolean }
    requestKeys: Map<string, string>
    createRequestKey: () => string
    currentOwnershipMatches: () => boolean
    recordAttendance: (
      input: RecordRegistrationObservationAttendanceInput,
    ) => Promise<RegistrationObservationFeedbackDetail>
    submitFeedback: (
      input: SubmitRegistrationObservationFeedbackInput,
    ) => Promise<RegistrationObservationFeedbackDetail>
    normalizeError: (
      error: unknown,
    ) => RegistrationObservationFeedbackErrorState
    onSaving: () => void
    onSaved: (
      detail: RegistrationObservationFeedbackDetail,
    ) => void | Promise<void>
    focusField: (field: RegistrationObservationTeacherFeedbackField) => void
  },
) {
  if (input.guard.current) return { kind: "ignored" } as const
  const plan = buildRegistrationObservationTeacherFeedbackPlan(input)
  if (!plan.ok) {
    if (plan.field) input.focusField(plan.field)
    return {
      kind: "invalid",
      errorMessage: plan.message,
      field: plan.field,
    } as const
  }

  const fingerprint = JSON.stringify([plan.kind, plan.input])
  let requestKey = input.requestKeys.get(fingerprint)
  if (!requestKey) {
    requestKey = input.createRequestKey()
    input.requestKeys.set(fingerprint, requestKey)
  }

  input.guard.current = true
  try {
    input.onSaving()
    const detail = plan.kind === "record_attendance"
      ? await input.recordAttendance({ ...plan.input, requestKey })
      : await input.submitFeedback({ ...plan.input, requestKey })
    if (!input.currentOwnershipMatches()) return { kind: "stale" } as const
    await input.onSaved(detail)
    if (!input.currentOwnershipMatches()) return { kind: "stale" } as const
    if (input.requestKeys.get(fingerprint) === requestKey) {
      input.requestKeys.delete(fingerprint)
    }
    return { kind: "committed", detail } as const
  } catch (error) {
    if (!input.currentOwnershipMatches()) return { kind: "stale" } as const
    const errorState = input.normalizeError(error)
    return {
      kind: "failed",
      errorMessage: errorState.message,
      reloadRequired: errorState.reloadRequired,
    } as const
  } finally {
    input.guard.current = false
  }
}
// registration-observation-teacher-feedback-model:end

type TeacherFeedbackState = Readonly<{
  ownershipKey: string
  detail: RegistrationObservationFeedbackDetail | null
  draft: RegistrationObservationTeacherFeedbackDraft
  loading: boolean
  saving: boolean
  errorMessage: string
  fieldError: RegistrationObservationTeacherFeedbackField | null
  reloadRequired: boolean
  receipt: string
}>

function createTeacherFeedbackDraft(
  detail: RegistrationObservationFeedbackDetail | null,
): RegistrationObservationTeacherFeedbackDraft {
  return {
    suitabilityResult: detail?.suitabilityResult || "",
    feedbackReason: detail?.feedbackReason || "",
  }
}

function createTeacherFeedbackState(
  ownershipKey: string,
  loading: boolean,
): TeacherFeedbackState {
  return {
    ownershipKey,
    detail: null,
    draft: createTeacherFeedbackDraft(null),
    loading,
    saving: false,
    errorMessage: "",
    fieldError: null,
    reloadRequired: false,
    receipt: "",
  }
}

const STATUS_LABELS: Record<RegistrationObservationFeedbackDetail["status"], string> = {
  scheduled: "청강 예정",
  attended_feedback_pending: "피드백 대기",
  completed: "피드백 완료",
  no_show: "노쇼",
  canceled: "취소",
}

type TeacherFeedbackViewProps = Readonly<{
  detail: RegistrationObservationFeedbackDetail | null
  draft: RegistrationObservationTeacherFeedbackDraft
  loading: boolean
  saving: boolean
  errorMessage: string
  fieldError: RegistrationObservationTeacherFeedbackField | null
  reloadRequired: boolean
  receipt: string
  nowMs: number
  canRecordAttendance: boolean
  suitabilityRef: RefObject<HTMLButtonElement | null>
  feedbackReasonRef: RefObject<HTMLTextAreaElement | null>
  errorRef: RefObject<HTMLParagraphElement | null>
  onDraftChange: (
    field: keyof RegistrationObservationTeacherFeedbackDraft,
    value: string,
  ) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onNoShow: () => void
  onRecordAttendance: () => void
  onReload: () => void
}>

export function RegistrationObservationTeacherFeedbackView({
  detail,
  draft,
  loading,
  saving,
  errorMessage,
  fieldError,
  reloadRequired,
  receipt,
  nowMs,
  canRecordAttendance,
  suitabilityRef,
  feedbackReasonRef,
  errorRef,
  onDraftChange,
  onSubmit,
  onNoShow,
  onRecordAttendance,
  onReload,
}: TeacherFeedbackViewProps) {
  if (loading && !detail) {
    return (
      <main
        data-testid="registration-observation-teacher-feedback"
        className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden px-4 sm:px-6"
      >
        <div role="status" aria-live="polite" className="rounded-xl border bg-background p-5 text-sm">
          청강 피드백을 불러오는 중입니다.
        </div>
      </main>
    )
  }

  if (!detail) {
    return (
      <main
        data-testid="registration-observation-teacher-feedback"
        className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden px-4 sm:px-6"
      >
        <section className="grid min-w-0 gap-4 rounded-xl border bg-background p-5">
          <h1 className="text-lg font-semibold">청강 피드백</h1>
          <p ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm text-destructive outline-none">
            {errorMessage || "청강 피드백을 불러오지 못했습니다."}
          </p>
          <div>
            <Button type="button" variant="outline" onClick={onReload} disabled={loading}>
              {loading ? "불러오는 중" : "다시 시도"}
            </Button>
          </div>
        </section>
      </main>
    )
  }

  const availability = getRegistrationObservationTeacherFeedbackAvailability(
    detail,
    nowMs,
  )
  const proxyLabel = getRegistrationObservationTeacherProxyLabel(detail)
  const feedbackActionable = detail.status === "scheduled"
    || detail.status === "attended_feedback_pending"
  const suitabilityErrorId = fieldError === "suitabilityResult"
    ? "teacher-feedback-suitability-error"
    : undefined
  const feedbackReasonErrorId = fieldError === "feedbackReason"
    ? "teacher-feedback-reason-error"
    : undefined
  const endsAtLabel = formatRegistrationObservationTeacherFeedbackKst(detail.endsAt)
  const endsAtTime = endsAtLabel.slice(endsAtLabel.lastIndexOf(" ") + 1)

  return (
    <main
      data-testid="registration-observation-teacher-feedback"
      className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden px-4 sm:px-6"
    >
      <section
        className="grid min-w-0 gap-5 overflow-hidden rounded-xl border bg-background p-4 sm:p-6"
        aria-labelledby="teacher-feedback-heading"
      >
        <header className="grid min-w-0 gap-1">
          <p className="text-sm font-medium text-primary">{STATUS_LABELS[detail.status]}</p>
          <h1 id="teacher-feedback-heading" className="break-words text-xl font-semibold">
            {detail.studentName} 청강 피드백
          </h1>
          <p className="break-words text-sm text-muted-foreground">
            {detail.subject} · {detail.studentGrade} · 담당 {detail.teacherName}
          </p>
          {proxyLabel ? (
            <p className="break-words text-xs text-muted-foreground">{proxyLabel}</p>
          ) : null}
        </header>

        <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">수업</dt>
            <dd className="break-words font-medium">{detail.className}</dd>
          </div>
          <div className="min-w-0 rounded-lg bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">일시</dt>
            <dd className="break-words font-medium">
              {formatRegistrationObservationTeacherFeedbackKst(detail.startsAt)}–
              {endsAtTime}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg bg-muted/40 p-3 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">강의실</dt>
            <dd className="break-words font-medium">{detail.classroomName}</dd>
          </div>
          {detail.attendance ? (
            <div className="min-w-0 rounded-lg bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">참석</dt>
              <dd className="break-words font-medium">
                {detail.attendance === "attended" ? "참석" : "노쇼"}
              </dd>
            </div>
          ) : null}
          {detail.suitabilityResult ? (
            <div className="min-w-0 rounded-lg bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">적합 여부</dt>
              <dd className="break-words font-medium">
                {detail.suitabilityResult === "fit" ? "적합" : "부적합"}
              </dd>
            </div>
          ) : null}
          {detail.feedbackReason ? (
            <div className="min-w-0 rounded-lg bg-muted/40 p-3 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">피드백 사유</dt>
              <dd className="break-words whitespace-pre-wrap font-medium">
                {detail.feedbackReason}
              </dd>
            </div>
          ) : null}
        </dl>

        {feedbackActionable ? (
          <form className="grid min-w-0 gap-4" onSubmit={onSubmit} noValidate>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="teacher-feedback-suitability">적합 여부</Label>
              <RegistrationSelect
                ref={suitabilityRef}
                id="teacher-feedback-suitability"
                value={draft.suitabilityResult}
                placeholder="적합 여부 선택"
                options={[
                  { value: "fit", label: "적합" },
                  { value: "unfit", label: "부적합" },
                ]}
                disabled={saving}
                required
                aria-invalid={fieldError === "suitabilityResult"}
                aria-describedby={suitabilityErrorId}
                onValueChange={(value) => onDraftChange("suitabilityResult", value)}
              />
              {suitabilityErrorId ? (
                <p id={suitabilityErrorId} className="break-words text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
            </div>

            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="teacher-feedback-reason">피드백 사유</Label>
              <Textarea
                ref={feedbackReasonRef}
                id="teacher-feedback-reason"
                value={draft.feedbackReason}
                disabled={saving}
                required
                rows={5}
                aria-invalid={fieldError === "feedbackReason"}
                aria-describedby={feedbackReasonErrorId}
                onChange={(event) => onDraftChange("feedbackReason", event.target.value)}
              />
              {feedbackReasonErrorId ? (
                <p id={feedbackReasonErrorId} className="break-words text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
            </div>

            {!availability.submitFeedback ? (
              <p className="break-words text-sm text-muted-foreground">
                수업 종료 후 참석 피드백을 저장할 수 있습니다.
              </p>
            ) : null}
            {detail.status === "scheduled" && !availability.submitNoShow ? (
              <p className="break-words text-sm text-muted-foreground">
                수업 시작 후 노쇼 또는 참석 확인을 사용할 수 있습니다.
              </p>
            ) : null}
            <p className="break-words text-xs text-muted-foreground">
              화면의 시각 안내는 참고용이며 저장 시 서버가 현재 수업 시각을 다시 확인합니다.
            </p>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                data-action="submit_feedback"
                type="submit"
                disabled={saving || !availability.submitFeedback}
                className="w-full whitespace-normal sm:w-auto"
              >
                {saving
                  ? "저장 중"
                  : detail.status === "scheduled"
                    ? "참석 및 피드백 저장"
                    : "피드백 저장"}
              </Button>
              {detail.status === "scheduled" ? (
                <Button
                  data-action="no_show"
                  type="button"
                  variant="outline"
                  disabled={saving || !availability.submitNoShow}
                  className="w-full whitespace-normal sm:w-auto"
                  onClick={onNoShow}
                >
                  노쇼로 처리
                </Button>
              ) : null}
              {canRecordAttendance && detail.status === "scheduled" ? (
                <Button
                  data-action="record_attendance"
                  type="button"
                  variant="outline"
                  disabled={saving || !availability.recordAttendance}
                  className="w-full whitespace-normal sm:w-auto"
                  onClick={onRecordAttendance}
                >
                  참석만 확인
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}

        <div aria-live="polite" className="grid min-w-0 gap-2">
          {receipt ? (
            <p role="status" className="break-words text-sm font-medium text-primary">
              {receipt}
            </p>
          ) : null}
          {errorMessage && !fieldError ? (
            <p
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="break-words text-sm text-destructive outline-none"
            >
              {errorMessage}
            </p>
          ) : null}
          {reloadRequired ? (
            <div>
              <Button type="button" variant="outline" disabled={saving} onClick={onReload}>
                다시 불러오기
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export function RegistrationObservationTeacherFeedback({
  observationId,
}: {
  observationId: string
}) {
  const { canManageAll, session } = useAuth()
  const ownershipKey = [
    session?.user.id || "anonymous",
    session?.expires_at || "no-session",
    observationId,
  ].join(":")
  const [state, setState] = useState<TeacherFeedbackState>(() => (
    createTeacherFeedbackState(ownershipKey, true)
  ))
  const [nowMs, setNowMs] = useState(() => Date.now())
  const ownershipRef = useRef(ownershipKey)
  const mutationResources = useMemo(() => ({
    ownershipKey,
    guard: { current: false },
    requestKeys: new Map<string, string>(),
  }), [ownershipKey])
  const suitabilityRef = useRef<HTMLButtonElement>(null)
  const feedbackReasonRef = useRef<HTMLTextAreaElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    ownershipRef.current = ownershipKey
  }, [ownershipKey])

  const loadFeedback = useCallback(async (force: boolean) => {
    const requestedOwnershipKey = ownershipKey
    const client = supabase
    const outcome = client
      ? await executeRegistrationObservationTeacherFeedbackLoad({
          requestedOwnershipKey,
          currentOwnershipKey: () => ownershipRef.current,
          load: () => loadRegistrationObservationFeedback(
            client,
            observationId,
            force ? { force: true } : {},
          ),
          normalizeError: getRegistrationObservationFeedbackErrorState,
        })
      : await Promise.resolve({
          kind: "failed" as const,
          errorMessage: getRegistrationObservationFeedbackErrorState(null).message,
          reloadRequired: false,
        })
    if (outcome.kind === "stale") return
    if (outcome.kind === "failed") {
      if (ownershipRef.current !== requestedOwnershipKey) return
      setState({
        ...createTeacherFeedbackState(requestedOwnershipKey, false),
        errorMessage: outcome.errorMessage,
        reloadRequired: outcome.reloadRequired,
      })
      return
    }
    if (ownershipRef.current !== requestedOwnershipKey) return
    setState({
      ownershipKey: requestedOwnershipKey,
      detail: outcome.detail,
      draft: createTeacherFeedbackDraft(outcome.detail),
      loading: false,
      saving: false,
      errorMessage: "",
      fieldError: null,
      reloadRequired: false,
      receipt: "",
    })
  }, [observationId, ownershipKey])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFeedback(false), 0)
    return () => window.clearTimeout(timer)
  }, [loadFeedback])

  const nextBoundary = state.detail
    ? getRegistrationObservationTeacherFeedbackNextBoundary(state.detail, nowMs)
    : null
  useEffect(() => {
    if (nextBoundary === null) return
    const delay = Math.min(
      Math.max(nextBoundary - Date.now() + 50, 0),
      2_147_483_647,
    )
    const timer = window.setTimeout(() => setNowMs(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [nextBoundary])

  useEffect(() => {
    if (
      state.ownershipKey === ownershipKey
      && state.errorMessage
      && !state.fieldError
    ) {
      errorRef.current?.focus({ preventScroll: true })
    }
  }, [ownershipKey, state.errorMessage, state.fieldError, state.ownershipKey])

  function updateDraft(
    field: keyof RegistrationObservationTeacherFeedbackDraft,
    value: string,
  ) {
    setState((current) => {
      if (current.ownershipKey !== ownershipKey) return current
      return {
        ...current,
        draft: { ...current.draft, [field]: value },
        errorMessage: current.reloadRequired ? current.errorMessage : "",
        fieldError: current.reloadRequired ? current.fieldError : null,
        receipt: "",
      }
    })
  }

  function focusField(field: RegistrationObservationTeacherFeedbackField) {
    const target = field === "suitabilityResult"
      ? suitabilityRef.current
      : feedbackReasonRef.current
    target?.focus({ preventScroll: true })
  }

  async function runMutation(action: RegistrationObservationTeacherFeedbackAction) {
    if (!state.detail || !supabase) return
    const client = supabase
    const requestedOwnershipKey = ownershipKey
    const resources = mutationResources
    const receipt = action === "record_attendance"
      ? "참석 확인됨"
      : action === "no_show"
        ? "노쇼 처리됨"
        : "피드백 저장됨"
    const outcome = await executeRegistrationObservationTeacherFeedbackMutation({
      detail: state.detail,
      draft: state.draft,
      action,
      nowMs,
      allowAttendanceOnly: canManageAll,
      guard: resources.guard,
      requestKeys: resources.requestKeys,
      createRequestKey: () => (
        `registration-observation-teacher-${action}:${crypto.randomUUID()}`
      ),
      currentOwnershipMatches: () => (
        ownershipRef.current === requestedOwnershipKey
        && resources.ownershipKey === requestedOwnershipKey
      ),
      recordAttendance: (input) => (
        recordRegistrationObservationAttendance(client, input)
      ),
      submitFeedback: (input) => (
        submitRegistrationObservationFeedback(client, input)
      ),
      normalizeError: getRegistrationObservationFeedbackErrorState,
      onSaving: () => {
        setState((current) => current.ownershipKey === requestedOwnershipKey
          ? {
              ...current,
              saving: true,
              errorMessage: "",
              fieldError: null,
              reloadRequired: false,
              receipt: "",
            }
          : current)
      },
      onSaved: (detail) => {
        setState((current) => current.ownershipKey === requestedOwnershipKey
          ? {
              ownershipKey: requestedOwnershipKey,
              detail,
              draft: createTeacherFeedbackDraft(detail),
              loading: false,
              saving: false,
              errorMessage: "",
              fieldError: null,
              reloadRequired: false,
              receipt,
            }
          : current)
      },
      focusField,
    })
    if (outcome.kind === "invalid") {
      setState((current) => current.ownershipKey === requestedOwnershipKey
        ? {
            ...current,
            saving: false,
            errorMessage: outcome.errorMessage,
            fieldError: outcome.field,
            reloadRequired: false,
            receipt: "",
          }
        : current)
    } else if (outcome.kind === "failed") {
      setState((current) => current.ownershipKey === requestedOwnershipKey
        ? {
            ...current,
            saving: false,
            errorMessage: outcome.errorMessage,
            fieldError: null,
            reloadRequired: outcome.reloadRequired,
            receipt: "",
          }
        : current)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void runMutation("submit_feedback")
  }

  function reloadFeedback() {
    setState(createTeacherFeedbackState(ownershipKey, true))
    void loadFeedback(true)
  }

  return (
    <RegistrationObservationTeacherFeedbackView
      detail={state.ownershipKey === ownershipKey ? state.detail : null}
      draft={state.draft}
      loading={state.ownershipKey === ownershipKey ? state.loading : true}
      saving={state.saving}
      errorMessage={state.errorMessage}
      fieldError={state.fieldError}
      reloadRequired={state.reloadRequired}
      receipt={state.receipt}
      nowMs={nowMs}
      canRecordAttendance={canManageAll}
      suitabilityRef={suitabilityRef}
      feedbackReasonRef={feedbackReasonRef}
      errorRef={errorRef}
      onDraftChange={updateDraft}
      onSubmit={handleSubmit}
      onNoShow={() => void runMutation("no_show")}
      onRecordAttendance={() => void runMutation("record_attendance")}
      onReload={reloadFeedback}
    />
  )
}
