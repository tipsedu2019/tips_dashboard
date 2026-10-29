"use client"

import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { RegistrationTeacherDetail } from "./registration-teacher-detail"
import { isRegistrationTeacherPermissionError } from "./registration-teacher-detail-fields"
import { registrationTeacherDetailService, type RegistrationTeacherCaseData } from "./registration-teacher-detail-service"

export type RegistrationTeacherDetailTarget = Readonly<{
  taskId: string
  trackId: string | null
  appointmentId: string | null
  observationId: string | null
  viewerId: string
}>

export function RegistrationTeacherDetailDialog({ target, viewerKey, onClose, onFocusTrack, onPermissionDenied, fallbackFocusRef }: {
  target: RegistrationTeacherDetailTarget
  viewerKey: string
  onClose: () => void
  onFocusTrack: (trackId: string) => void
  onPermissionDenied: (error: unknown) => void
  fallbackFocusRef: RefObject<HTMLInputElement | null>
}) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ data: RegistrationTeacherCaseData | null; failed: boolean }>({ data: null, failed: false })
  const deniedRef = useRef(onPermissionDenied)
  useEffect(() => { deniedRef.current = onPermissionDenied }, [onPermissionDenied])
  // Only construct the strict history adapter after the case reader has
  // validated the task. A malformed copied URL stays in the error boundary.
  const customerHistoryClient = useMemo(() => state.data
    ? registrationTeacherDetailService.customerHistoryClient(state.data.detail.task.id)
    : null, [state.data])
  useEffect(() => {
    const controller = new AbortController()
    void registrationTeacherDetailService.loadCase({ taskId: target.taskId }, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, failed: false })
    }).catch(error => {
      if (controller.signal.aborted) return
      setState({ data: null, failed: true })
      if (isRegistrationTeacherPermissionError(error)) deniedRef.current(error)
    })
    return () => controller.abort()
  }, [target.taskId, viewerKey, revision])

  const detail = state.data?.detail
  const appointment = detail?.appointments.find(item => item.id === target.appointmentId)
  const participants = appointment ? detail?.tracks.filter(track => appointment.kind === "level_test"
    ? detail.levelTests.some(test => test.appointmentId === appointment.id && test.trackId === track.id)
    : detail.consultations.some(consultation => consultation.appointmentId === appointment.id && consultation.mode === "visit" && consultation.trackId === track.id)) : []
  const focusTrackId = target.trackId || participants?.[0]?.id || null
  const invalidTarget = Boolean(detail && (
    (focusTrackId && !detail.tracks.some(track => track.id === focusTrackId))
    || (target.observationId && (!target.trackId || !target.appointmentId))
    || (target.appointmentId && !target.observationId && (!appointment || !participants?.some(track => track.id === focusTrackId)))
  ))

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent
      data-registration-teacher-detail=""
      restoreFocusToOpener
      restoreFocusFallbackRef={fallbackFocusRef}
      showCloseButton={false}
      className="z-[80] max-h-[calc(100dvh-1rem)] scroll-pb-24 overflow-x-hidden overflow-y-auto overscroll-contain sm:max-h-[92vh] sm:max-w-[min(96vw,84rem)]"
    >
      <DialogTitle className="sr-only">등록 신청서</DialogTitle>
      <DialogDescription className="sr-only">저장된 등록 학생 상세 내용을 확인합니다.</DialogDescription>
      {state.data && customerHistoryClient && !invalidTarget ? <RegistrationTeacherDetail
        data={state.data}
        enabled
        viewerKey={viewerKey}
        focusTrackId={focusTrackId}
        initialAppointmentId={target.appointmentId}
        initialObservationId={target.observationId}
        onFocusTrack={onFocusTrack}
        readers={registrationTeacherDetailService}
        customerHistoryClient={customerHistoryClient}
        onPermissionDenied={onPermissionDenied}
        closeAction={<Button type="button" variant="outline" onClick={onClose}>닫기</Button>}
      /> : <div className="grid gap-4">
        {state.failed || invalidTarget ? <div role="alert" className="text-sm text-destructive">{invalidTarget ? "선택한 과목 또는 예약 정보를 확인할 수 없습니다." : "등록 상세를 불러오지 못했습니다."}</div>
          : <div role="status" className="text-sm text-muted-foreground">등록 상세를 불러오는 중입니다.</div>}
        <div className="flex justify-end gap-2">
          {state.failed ? <Button type="button" variant="outline" onClick={() => { setState({ data: null, failed: false }); setRevision(value => value + 1) }}>다시 불러오기</Button> : null}
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>
}
