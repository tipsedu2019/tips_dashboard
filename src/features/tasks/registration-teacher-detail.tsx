"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { RegistrationApplicationShell } from "./registration-application-shell"
import { RegistrationApplicationSubjectTabs } from "./registration-application-subject-tabs"
import { RegistrationApplicationProgressStepper } from "./registration-application-progress-stepper"
import { RegistrationApplicationHistoryAction } from "./registration-application-history-action"
import { RegistrationCustomerMessageCaseHistory } from "./registration-customer-message-case-history"
import { RegistrationAdmissionChecklist } from "./registration-admission-progress"
import { getRegistrationApplicationProgress, type RegistrationApplicationSectionKey, type RegistrationApplicationSectionState } from "./registration-application-model"
import { REGISTRATION_WORKFLOW_STATUS_LABELS, getRegistrationWorkflowViewKey } from "./registration-workflow-status.js"
import { getRegistrationEnrollmentTextbookIds } from "./registration-track-model.js"
import { RegistrationTeacherObservation, type RegistrationTeacherObservationReaders } from "./registration-teacher-observation"
import type { RegistrationCustomerMessageClient } from "./registration-customer-message-contract"
import type { RegistrationTeacherCaseData } from "./registration-teacher-detail-service"
import { isRegistrationTeacherPermissionError, registrationTeacherTime, RegistrationTeacherFact, RegistrationTeacherResultLink, registrationTeacherReminderLabel, registrationTeacherEnrollmentLabel, isRegistrationTeacherMutableEnrollment } from "./registration-teacher-detail-fields"

export type { RegistrationTeacherCaseData } from "./registration-teacher-detail-service"
export type RegistrationTeacherDetailProps = {
  data: RegistrationTeacherCaseData
  viewerKey: string
  enabled: boolean
  focusTrackId?: string | null
  initialAppointmentId?: string | null
  initialObservationId?: string | null
  onFocusTrack?: (trackId: string) => void
  readers: RegistrationTeacherObservationReaders
  customerHistoryClient: RegistrationCustomerMessageClient
  closeAction: ReactNode
  onPermissionDenied?: (error: unknown) => void
}

const Empty = () => <p className="text-sm text-muted-foreground">저장된 기록이 없습니다.</p>
const statusLabels: Record<string, string> = { scheduled: "예약", completed: "완료", canceled: "취소", in_progress: "진행 중", absent: "결시", waiting: "대기", planned: "등록 예정", waitlisted: "대기", enrolled: "수강", draft: "준비", invoiced: "청구서 발송", paid: "수납" }
const waitingLabels: Record<string, string> = { current_class: "현재 학기 수강반 대기", current_term_opening: "현재 학기 개강반 대기", next_term_opening: "다음 학기 개강반 대기" }
const outcomeLabels: Record<string, string> = { undecided: "미정", waiting: "대기", observation: "청강", enrollment: "등록", not_registered: "미등록" }
const retakeLabels: Record<string, string> = { required: "재시험 필요", not_required: "재시험 불필요" }
const sectionKeys: RegistrationApplicationSectionKey[] = ["inquiry", "level_test", "consultation", "placement", "observation", "admission", "history"]

export function RegistrationTeacherDetail(props: RegistrationTeacherDetailProps) {
  if (!props.enabled) return null
  return <TeacherCase key={`${props.viewerKey}:${props.data.detail.task.id}`} {...props} />
}

function TeacherCase({ data, viewerKey, focusTrackId, initialAppointmentId, initialObservationId, onFocusTrack, readers, customerHistoryClient, closeAction, onPermissionDenied }: RegistrationTeacherDetailProps) {
  const { detail } = data
  const { task } = detail
  const historyNotice = data.eventWindow.hasEarlierEvents
    ? `최근 저장된 기록 ${data.eventWindow.recentLimit}건${data.eventWindow.anchorCount ? `과 등록·이관 기준 기록 ${data.eventWindow.anchorCount}건` : ""}을 조회했습니다. 이전 기록 일부는 표시되지 않습니다.`
    : undefined
  const tracks = [...detail.tracks].sort((a, b) => ["영어", "수학", "과학"].indexOf(a.subject) - ["영어", "수학", "과학"].indexOf(b.subject) || a.id.localeCompare(b.id))
  const routeTrackId = focusTrackId || tracks[0]?.id || ""
  const routeKey = `${routeTrackId}:${initialAppointmentId || ""}:${initialObservationId || ""}`
  const [selection, setSelection] = useState({ routeKey, trackId: routeTrackId })
  // URL navigation replaces the read target, while keeping the tab DOM/focus.
  // Derive the new target immediately so an old selection never starts a read.
  const selectedId = selection.routeKey === routeKey ? selection.trackId : routeTrackId
  useEffect(() => {
    setSelection(current => current.routeKey === routeKey ? current : { routeKey, trackId: routeTrackId })
  }, [routeKey, routeTrackId])
  const track = tracks.find(item => item.id === selectedId) || tracks[0] || null
  const common = task.registration || {}
  const legacy = detail.migrationLegacy
  const focusedObservationId = track?.id === routeTrackId ? initialObservationId : null
  const focusedAppointmentId = track?.id === routeTrackId ? initialAppointmentId : null
  const profileName = (id: string | null) => data.profiles.find(item => item.id === id)?.name || "이름 확인 불가"
  const className = (id?: string | null) => id ? data.classes.find(item => item.id === id)?.name || "수업명 확인 불가" : "미입력"
  const bookNames = (ids: string[]) => ids.map(id => data.textbooks.find(item => item.id === id)?.title || "교재명 확인 불가").join(", ") || "미입력"
  const tests = detail.levelTests.filter(item => item.trackId === track?.id)
  const consultations = detail.consultations.filter(item => item.trackId === track?.id)
  const enrollments = detail.enrollments.filter(item => item.trackId === track?.id)
  const mutableEnrollments = enrollments.filter(isRegistrationTeacherMutableEnrollment)
  const enrollmentRows = mutableEnrollments.length ? mutableEnrollments : track?.enrollmentDetailRows || []
  const enrollmentHistory = enrollments.filter(item => !isRegistrationTeacherMutableEnrollment(item))
  const historyClient = useMemo<RegistrationCustomerMessageClient>(() => ({
    ...customerHistoryClient,
    async listCaseHistory(input, signal) {
      try {
        if (!customerHistoryClient.listCaseHistory || input.taskId !== task.id) throw new Error("registration_teacher_history_unavailable")
        const result = await customerHistoryClient.listCaseHistory(input, signal)
        if (result.history.some(item => item.canCheck !== false || item.canCheckDelivery !== false)) throw new Error("registration_teacher_history_actions_forbidden")
        return result
      } catch (error) {
        if (!signal?.aborted && isRegistrationTeacherPermissionError(error)) onPermissionDenied?.(error)
        throw error
      }
    },
  }), [customerHistoryClient, onPermissionDenied, task.id])
  // These slots contain only facts and read navigation. "editable" here only
  // keeps the shell's fieldset from disabling retry/history navigation.
  const sectionStates = Object.fromEntries(sectionKeys.map(key => [key, { current: false, upcoming: false, editable: true, lockReason: "" }])) as Record<RegistrationApplicationSectionKey, RegistrationApplicationSectionState>
  const wrap = (key: string, children: ReactNode) => <div role={track ? "tabpanel" : undefined} id={`teacher-registration-${key}-${track?.id || "case"}`} aria-labelledby={track ? `registration-subject-tab-${track.id}` : undefined} className="grid min-w-0 gap-4 text-sm">{children}</div>
  const selectedAppointment = initialAppointmentId && detail.appointments.some(item => item.id === initialAppointmentId) ? initialAppointmentId : null
  return <RegistrationApplicationShell
    mode="detail" studentName={task.studentName || task.title} closeAction={closeAction}
    historyAction={<><RegistrationCustomerMessageCaseHistory taskId={task.id} client={historyClient} viewerKey={viewerKey} refreshKey={`${detail.commonRevision}:${task.updatedAt || ""}`} /><RegistrationApplicationHistoryAction detail={detail} profiles={data.profiles.map(item => ({ id: item.id, label: item.name }))} partialHistory={data.eventWindow.hasEarlierEvents} historyNotice={historyNotice} /></>}
    subjectNavigation={track ? <div className="grid gap-3"><RegistrationApplicationSubjectTabs tracks={tracks.map(item => ({ id: item.id, subject: item.subject, statusLabel: REGISTRATION_WORKFLOW_STATUS_LABELS[item.workflowStatus], viewKey: getRegistrationWorkflowViewKey(item.workflowStatus) }))} value={track.id} panelIdsByTrackId={Object.fromEntries(tracks.map(item => [item.id, ["level_test", "consultation", "waiting", "registration", "observation"].map(key => `teacher-registration-${key}-${item.id}`)]))} onValueChange={id => { setSelection({ routeKey, trackId: id }); onFocusTrack?.(id) }} /><p className="text-sm"><span className="text-muted-foreground">진행상태</span> · {REGISTRATION_WORKFLOW_STATUS_LABELS[track.workflowStatus]}</p></div> : undefined}
    progress={track ? <RegistrationApplicationProgressStepper steps={getRegistrationApplicationProgress(track.status, track.waitingKind, track.workflowStatus)} /> : undefined}
    sectionStates={sectionStates}
    inquiry={<div className="grid gap-4 text-sm"><dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><RegistrationTeacherFact label="학생명">{task.studentName}</RegistrationTeacherFact><RegistrationTeacherFact label="학년">{common.schoolGrade}</RegistrationTeacherFact><RegistrationTeacherFact label="학교">{common.schoolName}</RegistrationTeacherFact><RegistrationTeacherFact label="학부모 전화">{common.parentPhone}</RegistrationTeacherFact><RegistrationTeacherFact label="학생 전화">{common.studentPhone}</RegistrationTeacherFact><RegistrationTeacherFact label="문의일시">{registrationTeacherTime(common.inquiryAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="요청 사항">{common.requestNote}</RegistrationTeacherFact></dl>{legacy ? <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium">기존 이관 기록</summary>
      {legacy.snapshotMissing ? <p role="alert" className="mt-3 text-sm text-destructive">기존 등록 이력 원본을 찾을 수 없습니다.</p> : null}
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <RegistrationTeacherFact label="기존 시험 결과">{legacy.levelTestResult}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 시험일시">{registrationTeacherTime(legacy.levelTestAt)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 시험 완료일시">{registrationTeacherTime(legacy.levelTestCompletedAt)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 시험 장소">{legacy.levelTestPlace}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 결과 링크"><RegistrationTeacherResultLink value={legacy.levelTestMaterialLink} /></RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 전화상담 일시">{registrationTeacherTime(legacy.phoneConsultationAt)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 방문상담 일시">{registrationTeacherTime(legacy.visitConsultationAt)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 상담일시">{registrationTeacherTime(legacy.consultationAt)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 상담 장소">{legacy.visitConsultationPlace}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 학생 연결">{legacy.studentId ? "연결됨" : "미연결"}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 수업">{className(legacy.classId)}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 교재">{bookNames(legacy.textbookId ? [legacy.textbookId] : [])}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 수업 시작">{[legacy.classStartDate, legacy.classStartSession].filter(Boolean).join(" · ")}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 입학 안내">{legacy.admissionNoticeSent ? "완료" : "미완료"}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 메이크에듀 등록">{legacy.makeeduRegistered ? "완료" : "미완료"}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 청구서 발송">{legacy.makeeduInvoiceSent ? "완료" : "미완료"}</RegistrationTeacherFact>
        <RegistrationTeacherFact label="기존 수납 확인">{legacy.paymentChecked ? "완료" : "미완료"}</RegistrationTeacherFact>
      </dl>
    </details> : null}</div>}
    levelTest={wrap("level_test", <>{detail.collectionWindows.scheduledAppointments.overflow !== false ? <p className="text-xs text-muted-foreground">현재 예약 일부만 조회되었습니다.</p> : null}{tests.length ? tests.map(test => { const appointment = detail.appointments.find(item => item.id === test.appointmentId); return <dl key={test.id} data-selected-appointment={appointment?.id === selectedAppointment || undefined} className="grid gap-3 border-b pb-3 last:border-0 sm:grid-cols-2"><RegistrationTeacherFact label="레벨테스트">{test.attemptNumber}회 · {statusLabels[test.status]}</RegistrationTeacherFact><RegistrationTeacherFact label="예약 일시">{registrationTeacherTime(appointment?.scheduledAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="장소">{appointment?.place || "미입력"}</RegistrationTeacherFact><RegistrationTeacherFact label="완료 일시">{registrationTeacherTime(test.completedAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="결과 링크"><RegistrationTeacherResultLink value={test.materialLink} /></RegistrationTeacherFact>{registrationTeacherReminderLabel(appointment?.customerReminder) ? <RegistrationTeacherFact label="고객 리마인드">{registrationTeacherReminderLabel(appointment?.customerReminder)}</RegistrationTeacherFact> : null}</dl> }) : <Empty />}</>)}
    consultation={wrap("consultation", <>{detail.collectionWindows.scheduledAppointments.overflow !== false ? <p className="text-xs text-muted-foreground">현재 예약 일부만 조회되었습니다.</p> : null}<dl><RegistrationTeacherFact label="책임자">{track?.directorName || (track?.directorProfileId ? profileName(track.directorProfileId) : "미지정")}</RegistrationTeacherFact></dl>{consultations.length ? consultations.map(item => { const appointment = detail.appointments.find(row => row.id === item.appointmentId); return <dl key={item.id} className="grid gap-3 border-b pb-3 last:border-0 sm:grid-cols-2"><RegistrationTeacherFact label="상담 방식">{item.mode === "visit" ? "방문상담" : "전화상담"} · {statusLabels[item.status]}</RegistrationTeacherFact><RegistrationTeacherFact label="상담 책임자">{profileName(item.directorProfileId)}</RegistrationTeacherFact><RegistrationTeacherFact label="예약 일시">{registrationTeacherTime(appointment?.scheduledAt || item.readyAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="장소">{appointment?.place || "미입력"}</RegistrationTeacherFact><RegistrationTeacherFact label="완료 일시">{registrationTeacherTime(item.completedAt)}</RegistrationTeacherFact><RegistrationTeacherFact label="상담 결과">{item.outcome ? outcomeLabels[item.outcome] : "미입력"}</RegistrationTeacherFact><RegistrationTeacherFact label="상담 내용">{item.note || "미입력"}</RegistrationTeacherFact>{registrationTeacherReminderLabel(appointment?.customerReminder) ? <RegistrationTeacherFact label="고객 리마인드">{registrationTeacherReminderLabel(appointment?.customerReminder)}</RegistrationTeacherFact> : null}</dl> }) : <Empty />}</>)}
    waiting={wrap("waiting", track ? <dl className="grid gap-3 sm:grid-cols-2"><RegistrationTeacherFact label="대기 종류">{waitingLabels[track.waitingDetailKind || track.waitingKind]}</RegistrationTeacherFact><RegistrationTeacherFact label="대기 수업">{className(track.waitingDetailClassId)}</RegistrationTeacherFact><RegistrationTeacherFact label="재시험 여부">{retakeLabels[track.waitingDetailRetakeDecision || track.levelTestRetakeDecision]}</RegistrationTeacherFact></dl> : <Empty />)}
    registration={wrap("registration", <>{enrollmentRows?.length ? enrollmentRows.map((row, index) => <dl key={row.id || `${row.classId}:${index}`} className="grid gap-3 border-b pb-3 last:border-0 sm:grid-cols-3"><RegistrationTeacherFact label="등록 수업">{className(row.classId)}</RegistrationTeacherFact><RegistrationTeacherFact label="교재">{bookNames(getRegistrationEnrollmentTextbookIds(row))}</RegistrationTeacherFact><RegistrationTeacherFact label="수업 시작 일정">{[row.classStartDate, row.classStartSession].filter(Boolean).join(" · ")}</RegistrationTeacherFact></dl>) : <Empty />}{enrollmentHistory.length ? <details className="border-t pt-3"><summary className="cursor-pointer font-medium">수강 이력 {enrollmentHistory.length}건</summary><div className="mt-3 grid gap-3">{enrollmentHistory.map(row => <p key={row.id}>{className(row.classId)} · {registrationTeacherEnrollmentLabel(row)}{row.classStartDate ? ` · ${row.classStartDate} ${row.classStartSession || ""}` : ""}</p>)}</div></details> : null}{detail.collectionWindows.currentEnrollments.overflow !== false ? <p className="text-xs text-muted-foreground">현재 등록 실행 이력 일부만 조회되었습니다.</p> : null}</>)}
    observation={wrap("observation", track ? <RegistrationTeacherObservation key={`${track.id}:${focusedObservationId || ""}:${focusedAppointmentId || ""}`} taskId={task.id} trackId={track.id} initialObservationId={focusedObservationId} initialAppointmentId={focusedAppointmentId} readers={readers} onPermissionDenied={onPermissionDenied} /> : <Empty />)}
    admission={<RegistrationAdmissionChecklist checklist={detail.admissionChecklist} editable={false} savingItems={new Set()} onCheckedChange={() => undefined} />}
  />
}
