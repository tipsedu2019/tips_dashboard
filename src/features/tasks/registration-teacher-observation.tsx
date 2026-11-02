"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { RegistrationObservationFeedbackPanel } from "./registration-observation-feedback-panel"
import { isRegistrationTeacherPermissionError, registrationTeacherTime, RegistrationTeacherFact } from "./registration-teacher-detail-fields"
import type { registrationTeacherDetailService, RegistrationTeacherTrackInput } from "./registration-teacher-detail-service"

export type RegistrationTeacherObservationReaders = Pick<typeof registrationTeacherDetailService, "loadObservationDetail" | "loadObservationAttempt" | "loadFeedback">
type ReadState<T> = { key: string; data?: T; failed?: boolean }
function useScopedRead<T>(key: string, load: (signal: AbortSignal) => Promise<T>, onPermissionDenied?: (error: unknown) => void) {
  const [version, setVersion] = useState(0)
  const requestKey = `${key}:${version}`
  const [state, setState] = useState<ReadState<T> | null>(null)
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    void load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key: requestKey, data })
    }).catch(error => {
      if (controller.signal.aborted) return
      setState({ key: requestKey, failed: true })
      if (isRegistrationTeacherPermissionError(error)) onPermissionDenied?.(error)
    })
    return () => controller.abort()
  }, [key, requestKey, load, onPermissionDenied])
  return { data: state?.key === requestKey ? state.data : undefined, failed: state?.key === requestKey && state.failed, retry: () => setVersion(value => value + 1) }
}
const labels: Record<string, string> = { scheduled: "청강 예정", attended_feedback_pending: "참석 확인됨", completed: "청강 기록 완료", no_show: "불참", canceled: "취소" }
function ReadFailure({ name, onRetry }: { name: string; onRetry: () => void }) {
  return <div role="alert" className="grid justify-items-start gap-2 text-sm text-destructive"><p>{name} 정보를 불러오지 못했습니다.</p><Button type="button" variant="outline" size="sm" onClick={onRetry}>{name} 다시 불러오기</Button></div>
}

export function RegistrationTeacherObservation({ taskId, trackId, initialObservationId, initialAppointmentId, readers, onPermissionDenied }: RegistrationTeacherTrackInput & {
  initialObservationId?: string | null
  initialAppointmentId?: string | null
  readers: RegistrationTeacherObservationReaders
  onPermissionDenied?: (error: unknown) => void
}) {
  const [selection, setSelection] = useState(initialObservationId || "")
  const load = useCallback(async (signal: AbortSignal) => {
    const result = await readers.loadObservationDetail({ taskId, trackId }, signal)
    if (result.track.taskId !== taskId || result.track.trackId !== trackId
      || result.attempts.some(item => item.taskId !== taskId || item.trackId !== trackId)
      || (result.currentObservation && (result.currentObservation.taskId !== taskId || result.currentObservation.trackId !== trackId))) throw new Error("registration_teacher_observation_scope_invalid")
    return result
  }, [readers, taskId, trackId])
  const detail = useScopedRead(`${taskId}:${trackId}`, load, onPermissionDenied)
  const selectedId = selection || detail.data?.currentObservation?.observationId || detail.data?.latestDecisionObservation?.observationId || detail.data?.attempts[0]?.observationId || ""
  const known = detail.data?.attempts.find(item => item.observationId === selectedId)
    || (detail.data?.currentObservation?.observationId === selectedId ? detail.data.currentObservation : null)
  const loadAttempt = useCallback(async (signal: AbortSignal) => {
    const result = await readers.loadObservationAttempt({ taskId, trackId, observationId: selectedId }, signal)
    if (result.taskId !== taskId || result.trackId !== trackId || result.observation.taskId !== taskId || result.observation.trackId !== trackId || result.observation.observationId !== selectedId) throw new Error("registration_teacher_observation_scope_invalid")
    return result.observation
  }, [readers, taskId, trackId, selectedId])
  const remoteAttempt = useScopedRead(detail.data && selectedId && !known ? `${taskId}:${trackId}:${selectedId}` : "", loadAttempt, onPermissionDenied)
  const candidate = known || (selectedId ? remoteAttempt.data : null)
  const targetMismatch = Boolean(candidate && initialObservationId === selectedId && initialAppointmentId
    && candidate.appointmentId !== initialAppointmentId)
  const attempt = targetMismatch ? null : candidate
  const loadFeedback = useCallback(async (signal: AbortSignal) => {
    const result = await readers.loadFeedback({ taskId, trackId, observationId: selectedId }, signal)
    if (result.taskId !== taskId || result.trackId !== trackId || result.observationId !== selectedId) throw new Error("registration_teacher_feedback_scope_invalid")
    return result
  }, [readers, taskId, trackId, selectedId])
  const feedback = useScopedRead(attempt ? `${taskId}:${trackId}:${selectedId}` : "", loadFeedback, onPermissionDenied)

  if (detail.failed) return <ReadFailure name="청강" onRetry={detail.retry} />
  if (!detail.data) return <p role="status" className="text-sm text-muted-foreground">청강 정보를 불러오는 중입니다.</p>
  if (targetMismatch) return <p role="alert" className="text-sm text-destructive">청강 대상 정보를 확인할 수 없습니다.</p>
  return <div className="grid min-w-0 gap-4">
    {detail.data.attempts.length > 1 ? <div className="flex flex-wrap gap-2" role="group" aria-label="청강 이력 선택">{detail.data.attempts.map(item => <Button type="button" key={item.observationId} variant={item.observationId === selectedId ? "secondary" : "outline"} size="sm" aria-pressed={item.observationId === selectedId} onClick={() => setSelection(item.observationId)}>{item.sessionDate} · {item.className} · {labels[item.status]}</Button>)}</div> : null}
    {remoteAttempt.failed ? <ReadFailure name="청강 이력" onRetry={remoteAttempt.retry} /> : attempt ? <>
      <p role="status" className="text-sm font-medium">{labels[attempt.status]}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><RegistrationTeacherFact label="청강 반">{attempt.className}</RegistrationTeacherFact><RegistrationTeacherFact label="회차">{attempt.sessionDate}</RegistrationTeacherFact><RegistrationTeacherFact label="수업 시각">{registrationTeacherTime(attempt.startsAt)} ~ {registrationTeacherTime(attempt.endsAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="선생님">{attempt.teacherName}</RegistrationTeacherFact><RegistrationTeacherFact label="강의실">{attempt.classroomName}</RegistrationTeacherFact><RegistrationTeacherFact label="캠퍼스">{attempt.campus}</RegistrationTeacherFact><RegistrationTeacherFact label="교재">{attempt.textbooks.map(item => item.title).join(", ") || "없음"}</RegistrationTeacherFact><RegistrationTeacherFact label="진도">{attempt.progress}</RegistrationTeacherFact></dl>
      {feedback.failed ? <ReadFailure name="청강 피드백" onRetry={feedback.retry} /> : feedback.data ? <RegistrationObservationFeedbackPanel detail={feedback.data} /> : <p role="status" className="text-sm text-muted-foreground">청강 피드백을 불러오는 중입니다.</p>}
    </> : selectedId ? <p role="status" className="text-sm text-muted-foreground">청강 이력을 불러오는 중입니다.</p> : <p className="text-sm text-muted-foreground">저장된 청강 기록이 없습니다.</p>}
    {detail.data.attempts.length === 20 ? <p className="text-xs text-muted-foreground">최근 청강 이력 20건을 표시합니다.</p> : null}
  </div>
}
