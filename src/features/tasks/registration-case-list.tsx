"use client"

import { useState, type KeyboardEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

import { RegistrationSelect } from "./registration-select"
import type { RegistrationCaseListViewItem } from "./registration-case-list-model"
import { getRegistrationSummaryActionPermissions } from "./registration-track-model.js"
import type { OpsRegistrationWorkflowStatus } from "./registration-track-service"
import { getRegistrationInlineWorkflowStatusOptions } from "./registration-workflow-status.js"

export type RegistrationCaseListProps = {
  items: RegistrationCaseListViewItem[]
  viewerId?: string | null
  viewerRole?: "admin" | "staff" | "assistant" | "teacher" | null
  loading?: boolean
  emptyLabel?: string
  disabled?: boolean
  onOpen: (taskId: string, preferredTrackId: string) => void
  onEdit: (taskId: string, preferredTrackId: string) => void
  onStatusChange: (
    track: RegistrationCaseListViewItem["matchingTracks"][number],
    nextStatus: OpsRegistrationWorkflowStatus,
  ) => void
  canDelete: (item: RegistrationCaseListViewItem) => boolean
  onDelete: (item: RegistrationCaseListViewItem) => void
}

const TRACK_STATUS_LABELS: Record<OpsRegistrationWorkflowStatus, string> = {
  inquiry: "등록 문의",
  level_test_requested: "레벨테스트 신청",
  consultation_requested: "상담 신청",
  consultation_completed: "상담 완료",
  waiting_current_class: "현재반 대기 신청",
  waiting_new_class: "신규반 대기 신청",
  waiting_next_opening: "다음 개강 알림 요청",
  enrollment_requested: "등록 신청",
  payment_in_progress: "수납 진행 중",
  registered: "등록 완료",
  not_registered: "미등록",
  inquiry_only: "문의만",
}

const REGISTRATION_CASE_VIEW_COLUMNS = {
  inquiry: ["학생", "진행상태", "학년 · 학교", "연락처", "문의 일시"],
  level_test: ["학생", "진행상태", "예약 일시", "장소", "결과"],
  consultation_requested: ["학생", "진행상태", "책임자", "기준 · 예약 일시", "장소"],
  consultation_completed: ["학생", "진행상태", "책임자", "완료 일시"],
  waiting: ["학생", "진행상태", "책임자", "단계 진입일시"],
  enrollment: ["학생", "진행상태", "수업 시작", "교재 준비"],
  payment: ["학생", "진행상태", "수업 시작", "교재 준비"],
  completed: ["학생", "진행상태", "책임자", "완료 일시"],
} as const

const REGISTRATION_CASE_INITIAL_RENDER_LIMIT = 40
const REGISTRATION_CASE_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function RegistrationTrackStatusBadge({ status }: { status: OpsRegistrationWorkflowStatus }) {
  const completed = status === "registered" || status === "not_registered" || status === "inquiry_only"
  const attention = status === "waiting_current_class" || status === "waiting_new_class" || status === "waiting_next_opening"

  return (
    <span className={`text-xs font-medium ${completed
      ? "text-muted-foreground"
      : attention
        ? "text-amber-700"
        : "text-primary"
    }`}>
      {TRACK_STATUS_LABELS[status]}
    </span>
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
        placeholder={TRACK_STATUS_LABELS[track.workflowStatus]}
        options={options}
        disabled={disabled}
        size="sm"
        onValueChange={(value) => onStatusChange(track, value as OpsRegistrationWorkflowStatus)}
        className="h-8 w-auto border-transparent bg-transparent px-2 text-xs font-medium text-primary shadow-none hover:border-border hover:bg-muted/40 focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60"
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

function getRegistrationCaseTrackTimeLabel(track: RegistrationCaseListViewItem["matchingTracks"][number]) {
  if (track.status === "consultation_waiting") return formatRegistrationCaseTime(track.phoneReadyAt || "")
  if (track.status === "visit_consultation_scheduled") return formatRegistrationCaseTime(track.visitScheduledAt)
  return formatRegistrationCaseTime(track.stageEnteredAt)
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
  onStatusChange,
  cellRole,
}: Pick<RegistrationCaseRowProps, "item" | "viewerId" | "viewerRole" | "disabled" | "onStatusChange" | "cellRole">) {
  const registration = item.task.registration
  const student = <div className="font-medium">{item.studentName}</div>
  const trackLines = (render: (track: RegistrationCaseListViewItem["matchingTracks"][number]) => ReactNode) => (
    <div className="grid gap-1">{item.matchingTracks.map((track) => <div key={track.trackId}>{render(track)}</div>)}</div>
  )
  const status = (
    <RegistrationCaseCell label="진행상태" cellRole={cellRole}>
      <div className="grid gap-1">
        {item.matchingTracks.map((track) => (
          <div key={track.trackId} className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-muted-foreground">{track.subject}</span>
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
    <RegistrationCaseCell label="학년 · 학교" cellRole={cellRole}>{[registration?.schoolGrade, registration?.schoolName].filter(Boolean).join(" · ")}</RegistrationCaseCell>
    <RegistrationCaseCell label="연락처" cellRole={cellRole}><div>학부모 {registration?.parentPhone || "미정"}</div>{registration?.studentPhone ? <div className="text-muted-foreground">학생 {registration.studentPhone}</div> : null}</RegistrationCaseCell>
    <RegistrationCaseCell label="문의 일시" cellRole={cellRole}>{formatRegistrationCaseTime(registration?.inquiryAt || item.representativeTrack.stageEnteredAt)}</RegistrationCaseCell>
  </>

  if (item.viewKey === "level_test") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="예약 일시" cellRole={cellRole}>{registration?.levelTestAt ? formatRegistrationCaseTime(registration.levelTestAt) : trackLines((track) => formatRegistrationCaseTime(track.stageEnteredAt))}</RegistrationCaseCell>
    <RegistrationCaseCell label="장소" cellRole={cellRole}>{registration?.levelTestPlace}</RegistrationCaseCell>
    <RegistrationCaseCell label="결과" cellRole={cellRole}>{registration?.levelTestResult || "미정"}</RegistrationCaseCell>
  </>

  if (item.viewKey === "consultation_requested") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => `${track.subject} · ${track.directorName || "미지정"}`)}</RegistrationCaseCell>
    <RegistrationCaseCell label="기준 · 예약 일시" cellRole={cellRole}>{trackLines((track) => `${track.subject} · ${getRegistrationCaseTrackTimeLabel(track)}`)}</RegistrationCaseCell>
    <RegistrationCaseCell label="장소" cellRole={cellRole}>{trackLines((track) => track.visitPlace || (track.status === "consultation_waiting" ? "전화상담" : "미정"))}</RegistrationCaseCell>
  </>

  if (item.viewKey === "consultation_completed") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => track.directorName || "미지정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 일시" cellRole={cellRole}>{trackLines((track) => formatRegistrationCaseTime(track.workflowStatusEnteredAt))}</RegistrationCaseCell>
  </>

  if (item.viewKey === "waiting") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => track.directorName || "미지정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="단계 진입일시" cellRole={cellRole}>{trackLines((track) => formatRegistrationCaseTime(track.stageEnteredAt))}</RegistrationCaseCell>
  </>

  if (item.viewKey === "enrollment") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="수업 시작" cellRole={cellRole}>{[registration?.classStartDate, registration?.classStartSession].filter(Boolean).join(" · ")}</RegistrationCaseCell>
    <RegistrationCaseCell label="교재 준비" cellRole={cellRole}>{registration?.textbookPreparation || "미정"}</RegistrationCaseCell>
  </>

  if (item.viewKey === "payment") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="수업 시작" cellRole={cellRole}>{[registration?.classStartDate, registration?.classStartSession].filter(Boolean).join(" · ")}</RegistrationCaseCell>
    <RegistrationCaseCell label="교재 준비" cellRole={cellRole}>{registration?.textbookPreparation || "미정"}</RegistrationCaseCell>
  </>

  return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    {status}
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => track.directorName || "미지정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 일시" cellRole={cellRole}>{trackLines((track) => formatRegistrationCaseTime(track.workflowStatusEnteredAt))}</RegistrationCaseCell>
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
  onOpen,
  onEdit,
  onStatusChange,
  canDelete,
  onDelete,
}: RegistrationCaseListProps) {
  const isEmpty = !loading && items.length === 0
  const itemSetKey = items.map((item) => item.taskId).join("|")
  const [windowState, setWindowState] = useState(() => ({ key: itemSetKey, count: REGISTRATION_CASE_INITIAL_RENDER_LIMIT }))
  const visibleCount = windowState.key === itemSetKey ? windowState.count : REGISTRATION_CASE_INITIAL_RENDER_LIMIT
  const visibleItems = items.slice(0, visibleCount)
  const hasMore = visibleItems.length < items.length
  const columns = items[0] ? REGISTRATION_CASE_VIEW_COLUMNS[items[0].viewKey] : REGISTRATION_CASE_VIEW_COLUMNS.inquiry
  const showActionColumn = items.some(canDelete)
  const gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr))${showActionColumn ? " minmax(5rem, auto)" : ""}`
  const openRegistrationCase = (item: RegistrationCaseListViewItem) => {
    if (disabled) return
    const permissions = getRegistrationSummaryActionPermissions({
      viewerId,
      viewerRole,
      track: item.representativeTrack.track,
    })
    if (permissions.canManage) onEdit(item.taskId, item.representativeTrack.trackId)
    else onOpen(item.taskId, item.representativeTrack.trackId)
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
            {visibleItems.map((item) => (
              <article
                key={item.taskId}
                data-registration-case-row=""
                tabIndex={0}
                className="grid min-w-0 cursor-pointer gap-3 overflow-hidden rounded-md border bg-background p-3 shadow-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50"
                role="listitem"
                aria-label={`${item.studentName} 등록 신청 열기`}
                onClick={() => openRegistrationCase(item)}
                onKeyDown={(event) => handleRegistrationCaseKeyDown(event, item)}
              >
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} canDelete={canDelete} onDelete={onDelete} showActionColumn={showActionColumn} />
              </article>
            ))}
          </div>
          <div data-testid="registration-case-desktop-list" className="hidden w-full min-w-0 overflow-hidden lg:block" role="table" aria-label="등록 신청 데이터테이블">
            <div className="grid min-w-0 border-b bg-muted/45 text-xs text-muted-foreground" style={{ gridTemplateColumns }} role="row">
              {columns.map((column) => <div key={column} className="px-3 py-2" role="columnheader">{column}</div>)}
              {showActionColumn ? <div className="px-3 py-2 text-right" role="columnheader">관리</div> : null}
            </div>
            {visibleItems.map((item) => (
              <div
                key={item.taskId}
                data-registration-case-row=""
                tabIndex={0}
                className="grid min-w-0 cursor-pointer items-center gap-3 border-b p-3 text-sm outline-none transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                style={{ gridTemplateColumns }}
                role="row"
                aria-label={`${item.studentName} 등록 신청 열기`}
                onClick={() => openRegistrationCase(item)}
                onKeyDown={(event) => handleRegistrationCaseKeyDown(event, item)}
              >
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} onOpen={onOpen} onEdit={onEdit} onStatusChange={onStatusChange} canDelete={canDelete} onDelete={onDelete} cellRole="cell" showActionColumn={showActionColumn} />
              </div>
            ))}
          </div>
          {hasMore ? (
            <div className="flex justify-center border-t p-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setWindowState((current) => ({
                key: itemSetKey,
                count: (current.key === itemSetKey ? current.count : REGISTRATION_CASE_INITIAL_RENDER_LIMIT) + REGISTRATION_CASE_INITIAL_RENDER_LIMIT,
              }))}>
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
