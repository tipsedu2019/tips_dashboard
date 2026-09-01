"use client"

import { type KeyboardEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

import { RegistrationSelect } from "./registration-select"
import {
  canOpenRegistrationCaseListItem,
  getRegistrationCaseLevelTestAppointments,
  getRegistrationObservationListSummary,
  type RegistrationCaseListViewItem,
} from "./registration-case-list-model"
import { getRegistrationSummaryActionPermissions } from "./registration-track-model.js"
import type { OpsClassOption, OpsTextbookOption } from "./ops-task-service"
import type { OpsRegistrationWorkflowStatus } from "./registration-track-service"
import type { RegistrationObservationTrackWorkflowStatus } from "./registration-observation-model"
import {
  REGISTRATION_WORKFLOW_STATUS_LABELS,
  getRegistrationInlineWorkflowStatusOptions,
  isRegistrationObservationWorkflowStatus,
} from "./registration-workflow-status.js"

export type RegistrationCaseListProps = {
  items: RegistrationCaseListViewItem[]
  viewerId?: string | null
  viewerRole?: "admin" | "staff" | "assistant" | "teacher" | null
  loading?: boolean
  emptyLabel?: string
  disabled?: boolean
  classes?: OpsClassOption[]
  textbooks?: OpsTextbookOption[]
  onOpen: (taskId: string, preferredTrackId: string) => void
  onEdit: (taskId: string, preferredTrackId: string) => void
  onStatusChange: (
    track: RegistrationCaseListViewItem["matchingTracks"][number],
    nextStatus: OpsRegistrationWorkflowStatus,
  ) => void
  canDelete: (item: RegistrationCaseListViewItem) => boolean
  onDelete: (item: RegistrationCaseListViewItem) => void
}

const REGISTRATION_CASE_VIEW_COLUMNS = {
  inquiry: ["학생", "빠른 처리", "연락처", "문의 일시", "요청 사항"],
  level_test: ["학생", "빠른 처리", "예약 일시", "장소", "레벨테스트 결과"],
  consultation_requested: ["학생", "빠른 처리", "상담 방식", "책임자", "예약 일시 · 장소"],
  consultation_completed: ["학생", "빠른 처리", "책임자", "완료 일시"],
  waiting: ["학생", "빠른 처리", "책임자", "대기 유형 · 수업", "진입 일시"],
  observation: ["학생", "상태", "예약 일시", "장소"],
  enrollment: ["학생", "빠른 처리", "수강 수업", "교재", "수업 시작"],
  payment: ["학생", "빠른 처리", "입학신청서", "메이크에듀", "청구서", "수납"],
  completed: ["학생", "빠른 처리", "책임자", "등록 수업", "완료 일시"],
} as const

const WAITING_KIND_LABELS = {
  current_class: "현재반 대기",
  current_term_opening: "신규반 대기",
  next_term_opening: "다음 개강 알림",
  "": "미정",
} as const

const REGISTRATION_CASE_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

const REGISTRATION_CASE_PILL_TONE_CLASS_NAMES = {
  neutral: "border-border/80 bg-muted/55 text-muted-foreground",
  primary: "border-primary/20 bg-primary/5 text-primary",
  success: "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  warning: "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
} as const

type RegistrationCasePillTone = keyof typeof REGISTRATION_CASE_PILL_TONE_CLASS_NAMES

function RegistrationCasePill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode
  tone?: RegistrationCasePillTone
  className?: string
}) {
  return (
    <span className={[
      "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 [overflow-wrap:anywhere]",
      REGISTRATION_CASE_PILL_TONE_CLASS_NAMES[tone],
      className,
    ].filter(Boolean).join(" ")}>
      {children}
    </span>
  )
}

function RegistrationCaseStudentIdentity({
  studentName,
  schoolGrade,
  schoolName,
}: {
  studentName: string
  schoolGrade?: string | null
  schoolName?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="min-w-0 font-medium">{studentName}</span>
      {schoolGrade ? <RegistrationCasePill>{schoolGrade}</RegistrationCasePill> : null}
      {schoolName ? <RegistrationCasePill>{schoolName}</RegistrationCasePill> : null}
    </div>
  )
}

function RegistrationCaseTrackValue({
  track,
  children,
}: {
  track: RegistrationCaseListViewItem["matchingTracks"][number]
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <RegistrationCasePill tone="primary" className="shrink-0">{track.subject}</RegistrationCasePill>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function RegistrationCaseCompletionPill({
  complete,
  completeLabel,
  pendingLabel,
}: {
  complete: boolean
  completeLabel: string
  pendingLabel: string
}) {
  return <RegistrationCasePill tone={complete ? "success" : "neutral"}>{complete ? completeLabel : pendingLabel}</RegistrationCasePill>
}

function RegistrationTrackStatusBadge({ status }: { status: RegistrationObservationTrackWorkflowStatus }) {
  const completed = status === "registered" || status === "not_registered" || status === "inquiry_only"
  const attention = status === "waiting_current_class" || status === "waiting_new_class" || status === "waiting_next_opening"

  return (
    <RegistrationCasePill tone={completed ? "neutral" : attention ? "warning" : "primary"}>
      {REGISTRATION_WORKFLOW_STATUS_LABELS[status]}
    </RegistrationCasePill>
  )
}

function RegistrationTrackStatusControl({
  studentName,
  track,
  viewerId,
  viewerRole,
  disabled,
  onStatusChange,
}: {
  studentName: string
  track: RegistrationCaseListViewItem["matchingTracks"][number]
  viewerId?: string | null
  viewerRole?: RegistrationCaseListProps["viewerRole"]
  disabled: boolean
  onStatusChange: RegistrationCaseListProps["onStatusChange"]
}) {
  if (isRegistrationObservationWorkflowStatus(track.workflowStatus)) {
    return <RegistrationTrackStatusBadge status={track.workflowStatus} />
  }
  const options = getRegistrationInlineWorkflowStatusOptions({
    currentStatus: track.workflowStatus,
    viewerId,
    viewerRole,
    directorProfileId: track.directorProfileId,
  })
  const canChange = options.some((option) => option.value !== track.workflowStatus)

  if (!canChange) return <RegistrationTrackStatusBadge status={track.workflowStatus} />

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <RegistrationSelect
        aria-label={`${track.subject} ${studentName} 진행상태`}
        value={track.workflowStatus}
        placeholder={REGISTRATION_WORKFLOW_STATUS_LABELS[track.workflowStatus]}
        options={options}
        disabled={disabled}
        size="sm"
        onValueChange={(value) => {
          const nextStatus = options.find((option) => option.value === value)?.value
          if (nextStatus) onStatusChange(track, nextStatus)
        }}
        className="h-8 w-full min-w-0 border-transparent bg-transparent px-2 text-xs font-medium text-primary shadow-none hover:border-border hover:bg-muted/40 focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60"
      />
    </div>
  )
}

function formatRegistrationCaseTime(value: string) {
  if (!value) return "미정"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "미정"
  return REGISTRATION_CASE_DATE_FORMATTER.format(date)
}

function getRegistrationCaseConsultationMode(track: RegistrationCaseListViewItem["matchingTracks"][number]) {
  if (track.phoneReadyAt) return "phone"
  if (track.visitScheduledAt) return "visit"
  return ""
}

function getRegistrationCaseTrackTimeLabel(track: RegistrationCaseListViewItem["matchingTracks"][number]) {
  const mode = getRegistrationCaseConsultationMode(track)
  if (mode === "phone") return formatRegistrationCaseTime(track.phoneReadyAt || "")
  if (mode === "visit") return formatRegistrationCaseTime(track.visitScheduledAt || "")
  return "미정"
}

function RegistrationCaseCell({ label, children, cellRole }: { label: string; children: ReactNode; cellRole?: "cell" }) {
  return (
    <div role={cellRole} className="min-w-0 break-words [overflow-wrap:anywhere]">
      <div className="mb-1 text-[11px] text-muted-foreground lg:hidden">{label}</div>
      <div>{children || "미정"}</div>
    </div>
  )
}

function RegistrationCaseProcessCells({
  item,
  viewerId,
  viewerRole,
  disabled = false,
  classes = [],
  textbooks = [],
  onStatusChange,
  cellRole,
}: Pick<RegistrationCaseRowProps, "item" | "viewerId" | "viewerRole" | "disabled" | "classes" | "textbooks" | "onStatusChange" | "cellRole">) {
  const registration = item.task.registration
  const student = <RegistrationCaseStudentIdentity
    studentName={item.studentName}
    schoolGrade={registration?.schoolGrade}
    schoolName={registration?.schoolName}
  />
  const classLabelById = new Map(classes.map((classItem) => [classItem.id, classItem.label]))
  const textbookLabelById = new Map(textbooks.map((textbook) => [textbook.id, textbook.label]))
  const trackLines = (render: (track: RegistrationCaseListViewItem["matchingTracks"][number]) => ReactNode) => (
    <div className="grid gap-1">{item.matchingTracks.map((track) => <div key={track.trackId}>{render(track)}</div>)}</div>
  )
  const enrollmentRows = (track: RegistrationCaseListViewItem["matchingTracks"][number]) => track.enrollmentDetailRows || []
  const enrollmentClassLabel = (track: RegistrationCaseListViewItem["matchingTracks"][number]) => {
    const labels = enrollmentRows(track).map((row) => classLabelById.get(row.classId) || "수업 정보 확인 필요").filter(Boolean)
    return labels.length > 0 ? labels.join(", ") : item.task.className || "미정"
  }
  const enrollmentTextbookLabel = (track: RegistrationCaseListViewItem["matchingTracks"][number]) => {
    const labels = enrollmentRows(track).map((row) => row.textbookId ? textbookLabelById.get(row.textbookId) || "교재 정보 확인 필요" : "보유").filter(Boolean)
    return labels.length > 0 ? labels.join(", ") : registration?.textbookPreparation || "미정"
  }
  const enrollmentStartLabel = (track: RegistrationCaseListViewItem["matchingTracks"][number]) => {
    const labels = enrollmentRows(track).map((row) => [row.classStartDate, row.classStartSession].filter(Boolean).join(" · ")).filter(Boolean)
    return labels.length > 0 ? labels.join(", ") : [registration?.classStartDate, registration?.classStartSession].filter(Boolean).join(" · ") || "미정"
  }
  const status = (
    <RegistrationCaseCell label="빠른 처리" cellRole={cellRole}>
      <div className="grid gap-1">
        {item.matchingTracks.map((track) => (
          <div key={track.trackId} className="flex min-w-0 items-center gap-1.5">
            <RegistrationCasePill tone="primary" className="shrink-0">{track.subject}</RegistrationCasePill>
            <RegistrationTrackStatusControl
              studentName={item.studentName}
              track={track}
              viewerId={viewerId}
              viewerRole={viewerRole}
              disabled={disabled}
              onStatusChange={onStatusChange}
            />
          </div>
        ))}
      </div>
    </RegistrationCaseCell>
  )

  if (item.viewKey === "inquiry") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="연락처" cellRole={cellRole}><div>학부모 {registration?.parentPhone || "미정"}</div>{registration?.studentPhone ? <div className="text-muted-foreground">학생 {registration.studentPhone}</div> : null}</RegistrationCaseCell>
    <RegistrationCaseCell label="문의 일시" cellRole={cellRole}>{formatRegistrationCaseTime(registration?.inquiryAt || item.representativeTrack.stageEnteredAt)}</RegistrationCaseCell>
    <RegistrationCaseCell label="요청 사항" cellRole={cellRole}>{registration?.requestNote || "없음"}</RegistrationCaseCell>
  </>

  if (item.viewKey === "level_test") {
    const levelTestAppointments = getRegistrationCaseLevelTestAppointments(item.matchingTracks)
    const showSubjects = levelTestAppointments.length > 1
    return <>
      <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
      {status}
      <RegistrationCaseCell label="예약 일시" cellRole={cellRole}>{levelTestAppointments.length > 0 ? <div className="grid gap-1">{levelTestAppointments.map((appointment) => <div key={`${appointment.scheduledAt}:${appointment.place}`} className="flex min-w-0 flex-wrap items-center gap-1.5">{showSubjects ? <RegistrationCasePill tone="primary">{appointment.subjects.join(" · ")}</RegistrationCasePill> : null}<span>{formatRegistrationCaseTime(appointment.scheduledAt)}</span></div>)}</div> : "미정"}</RegistrationCaseCell>
      <RegistrationCaseCell label="장소" cellRole={cellRole}>{levelTestAppointments.length > 0 ? <div className="grid gap-1">{levelTestAppointments.map((appointment) => <div key={`${appointment.scheduledAt}:${appointment.place}`} className="flex min-w-0 flex-wrap items-center gap-1.5">{showSubjects ? <RegistrationCasePill tone="primary">{appointment.subjects.join(" · ")}</RegistrationCasePill> : null}<RegistrationCasePill>{appointment.place || "미정"}</RegistrationCasePill></div>)}</div> : <RegistrationCasePill>미정</RegistrationCasePill>}</RegistrationCaseCell>
      <RegistrationCaseCell label="레벨테스트 결과" cellRole={cellRole}>{registration?.levelTestMaterialLink ? <a href={registration.levelTestMaterialLink} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>결과 링크 열기</a> : <RegistrationCasePill tone={registration?.levelTestResult ? "primary" : "neutral"}>{registration?.levelTestResult || "미등록"}</RegistrationCasePill>}</RegistrationCaseCell>
    </>
  }

  if (item.viewKey === "consultation_requested") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="상담 방식" cellRole={cellRole}>{trackLines((track) => {
      const mode = getRegistrationCaseConsultationMode(track)
      return <RegistrationCaseTrackValue track={track}><RegistrationCasePill tone={mode ? "primary" : "neutral"}>{mode === "phone" ? "전화상담" : mode === "visit" ? "방문상담" : "미정"}</RegistrationCasePill></RegistrationCaseTrackValue>
    })}</RegistrationCaseCell>
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{track.directorName || "미지정"}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="예약 일시 · 장소" cellRole={cellRole}>{trackLines((track) => {
      const mode = getRegistrationCaseConsultationMode(track)
      if (mode === "phone") return <RegistrationCaseTrackValue track={track}>{getRegistrationCaseTrackTimeLabel(track)} · 전화상담</RegistrationCaseTrackValue>
      if (mode === "visit") return <RegistrationCaseTrackValue track={track}>{getRegistrationCaseTrackTimeLabel(track)} · <RegistrationCasePill>{track.visitPlace || "장소 미정"}</RegistrationCasePill></RegistrationCaseTrackValue>
      return <RegistrationCaseTrackValue track={track}>미정</RegistrationCaseTrackValue>
    })}</RegistrationCaseCell>
  </>

  if (item.viewKey === "consultation_completed") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{track.directorName || "미지정"}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 일시" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{formatRegistrationCaseTime(track.workflowStatusEnteredAt)}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
  </>

  if (item.viewKey === "waiting") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{track.directorName || "미지정"}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="대기 유형 · 수업" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}><RegistrationCasePill tone="warning">{WAITING_KIND_LABELS[track.waitingDetailKind || track.waitingKind]}</RegistrationCasePill> <RegistrationCasePill>{track.waitingDetailClassId ? classLabelById.get(track.waitingDetailClassId) || track.waitingDetailClassId : "수업 미지정"}</RegistrationCasePill></RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="진입 일시" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{formatRegistrationCaseTime(track.workflowStatusEnteredAt)}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
  </>

  if (item.viewKey === "observation") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="상태" cellRole={cellRole}>{trackLines((track) => {
      const summary = getRegistrationObservationListSummary(track)
      return <RegistrationCaseTrackValue track={track}><RegistrationCasePill tone={summary.label === "원장 확인 대기" ? "warning" : "primary"}>{summary.label}</RegistrationCasePill></RegistrationCaseTrackValue>
    })}</RegistrationCaseCell>
    <RegistrationCaseCell label="예약 일시" cellRole={cellRole}>{trackLines((track) => {
      const summary = getRegistrationObservationListSummary(track)
      return <RegistrationCaseTrackValue track={track}>{summary.scheduledAt ? formatRegistrationCaseTime(summary.scheduledAt) : "미정"}</RegistrationCaseTrackValue>
    })}</RegistrationCaseCell>
    <RegistrationCaseCell label="장소" cellRole={cellRole}>{trackLines((track) => {
      const summary = getRegistrationObservationListSummary(track)
      return <RegistrationCaseTrackValue track={track}><RegistrationCasePill>{summary.place || "미정"}</RegistrationCasePill></RegistrationCaseTrackValue>
    })}</RegistrationCaseCell>
  </>

  if (item.viewKey === "enrollment") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="수강 수업" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}><RegistrationCasePill tone="primary">{enrollmentClassLabel(track)}</RegistrationCasePill></RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="교재" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}><RegistrationCasePill>{enrollmentTextbookLabel(track)}</RegistrationCasePill></RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="수업 시작" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{enrollmentStartLabel(track)}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
  </>

  if (item.viewKey === "payment") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="입학신청서" cellRole={cellRole}><RegistrationCaseCompletionPill complete={Boolean(registration?.admissionNoticeSent)} completeLabel="발송 완료" pendingLabel="발송 전" /></RegistrationCaseCell>
    <RegistrationCaseCell label="메이크에듀" cellRole={cellRole}><RegistrationCaseCompletionPill complete={Boolean(registration?.makeeduRegistered)} completeLabel="등록 완료" pendingLabel="미등록" /></RegistrationCaseCell>
    <RegistrationCaseCell label="청구서" cellRole={cellRole}><RegistrationCaseCompletionPill complete={Boolean(registration?.makeeduInvoiceSent)} completeLabel="발송 완료" pendingLabel="발송 전" /></RegistrationCaseCell>
    <RegistrationCaseCell label="수납" cellRole={cellRole}><RegistrationCaseCompletionPill complete={Boolean(registration?.paymentChecked)} completeLabel="확인 완료" pendingLabel="확인 전" /></RegistrationCaseCell>
  </>

  return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{track.directorName || "미지정"}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="등록 수업" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}><RegistrationCasePill tone="primary">{enrollmentClassLabel(track)}</RegistrationCasePill></RegistrationCaseTrackValue>)}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 일시" cellRole={cellRole}>{trackLines((track) => <RegistrationCaseTrackValue track={track}>{formatRegistrationCaseTime(track.workflowStatusEnteredAt)}</RegistrationCaseTrackValue>)}</RegistrationCaseCell>
  </>
}

type RegistrationCaseRowProps = Omit<RegistrationCaseListProps, "items" | "loading" | "emptyLabel"> & {
  item: RegistrationCaseListViewItem
  cellRole?: "cell"
  showActionColumn?: boolean
}

function RegistrationCaseActions({
  item,
  disabled,
  canDelete,
  onDelete,
  cellRole,
}: Pick<RegistrationCaseRowProps, "item" | "disabled" | "canDelete" | "onDelete" | "cellRole">) {
  return (
    <div
      role={cellRole}
      className="flex min-w-0 flex-wrap justify-end gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {canDelete(item) ? (
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={`${item.studentName} 등록 신청 삭제`} onClick={() => onDelete(item)} disabled={disabled}>삭제</Button>
      ) : null}
    </div>
  )
}

export function RegistrationCaseListRow({
  item,
  viewerId,
  viewerRole,
  disabled,
  classes,
  textbooks,
  onStatusChange,
  canDelete,
  onDelete,
  cellRole,
  showActionColumn = false,
}: RegistrationCaseRowProps) {
  return (
    <>
      <RegistrationCaseProcessCells
        item={item}
        viewerId={viewerId}
        viewerRole={viewerRole}
        disabled={disabled}
        classes={classes}
        textbooks={textbooks}
        onStatusChange={onStatusChange}
        cellRole={cellRole}
      />
      {showActionColumn ? <RegistrationCaseActions item={item} disabled={disabled} canDelete={canDelete} onDelete={onDelete} cellRole={cellRole} /> : null}
    </>
  )
}

export function RegistrationCaseList({
  items,
  viewerId = null,
  viewerRole = null,
  loading = false,
  emptyLabel = "표시할 등록 신청이 없습니다.",
  disabled = false,
  classes = [],
  textbooks = [],
  onOpen,
  onEdit,
  onStatusChange,
  canDelete,
  onDelete,
}: RegistrationCaseListProps) {
  const isEmpty = !loading && items.length === 0
  const columns = items[0] ? REGISTRATION_CASE_VIEW_COLUMNS[items[0].viewKey] : REGISTRATION_CASE_VIEW_COLUMNS.inquiry
  const showActionColumn = items.some(canDelete)
  const gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr))${showActionColumn ? " minmax(5rem, auto)" : ""}`
  const openRegistrationCase = (item: RegistrationCaseListViewItem) => {
    if (disabled || !canOpenRegistrationCaseListItem(item)) return
    const targetTrack = item.viewKey === "observation"
      ? item.matchingTracks.find((track) => track.observationSummaryVisible) || item.representativeTrack
      : item.representativeTrack
    if (!targetTrack) return
    const permissions = getRegistrationSummaryActionPermissions({
      viewerId,
      viewerRole,
      track: targetTrack.track,
    })
    if (permissions.canManage) onEdit(item.taskId, targetTrack.trackId)
    else onOpen(item.taskId, targetTrack.trackId)
  }
  const handleRegistrationCaseKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    item: RegistrationCaseListViewItem,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    openRegistrationCase(item)
  }

  return (
    <section className="min-w-0 overflow-hidden bg-background lg:rounded-lg lg:border" aria-label="등록 신청 목록">
      {loading || isEmpty ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
          {loading ? "불러오는 중입니다." : emptyLabel}
        </div>
      ) : (
        <>
          <div data-testid="registration-case-mobile-list" className="grid min-w-0 gap-2 p-2 lg:hidden" role="list" aria-label="등록 신청 모바일 목록">
            {items.map((item) => {
              const entryAvailable = !disabled && canOpenRegistrationCaseListItem(item)
              return <article
                key={item.taskId}
                data-registration-case-row=""
                tabIndex={entryAvailable ? 0 : undefined}
                className={`grid min-w-0 gap-3 overflow-hidden rounded-md border bg-background p-3 shadow-xs outline-none transition-colors ${entryAvailable ? "cursor-pointer hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50" : ""}`}
                role="listitem"
                aria-label={`${item.studentName} 등록 신청${entryAvailable ? " 열기" : ""}`}
                onClick={entryAvailable ? () => openRegistrationCase(item) : undefined}
                onKeyDown={entryAvailable ? (event) => handleRegistrationCaseKeyDown(event, item) : undefined}
              >
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} classes={classes} textbooks={textbooks} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} canDelete={canDelete} onDelete={onDelete} showActionColumn={showActionColumn} />
              </article>
            })}
          </div>
          <div data-testid="registration-case-desktop-list" className="hidden w-full min-w-0 overflow-hidden lg:block" role="table" aria-label="등록 신청 데이터테이블">
            <div className="grid min-w-0 border-b bg-muted/45 text-xs text-muted-foreground" style={{ gridTemplateColumns }} role="row">
              {columns.map((column) => <div key={column} className="px-3 py-2" role="columnheader">{column}</div>)}
              {showActionColumn ? <div className="px-3 py-2 text-right" role="columnheader">관리</div> : null}
            </div>
            {items.map((item) => {
              const entryAvailable = !disabled && canOpenRegistrationCaseListItem(item)
              return <div
                key={item.taskId}
                data-registration-case-row=""
                tabIndex={entryAvailable ? 0 : undefined}
                className={`grid min-w-0 items-center gap-3 border-b p-3 text-sm outline-none transition-colors last:border-b-0 ${entryAvailable ? "cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50" : ""}`}
                style={{ gridTemplateColumns }}
                role="row"
                aria-label={`${item.studentName} 등록 신청${entryAvailable ? " 열기" : ""}`}
                onClick={entryAvailable ? () => openRegistrationCase(item) : undefined}
                onKeyDown={entryAvailable ? (event) => handleRegistrationCaseKeyDown(event, item) : undefined}
              >
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} classes={classes} textbooks={textbooks} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} canDelete={canDelete} onDelete={onDelete} cellRole="cell" showActionColumn={showActionColumn} />
              </div>
            })}
          </div>
        </>
      )}
    </section>
  )
}
