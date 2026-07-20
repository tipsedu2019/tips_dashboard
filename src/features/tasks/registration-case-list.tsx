"use client"

import { useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type { RegistrationCaseListViewItem } from "./registration-case-list-model"
import { getRegistrationSummaryActionPermissions } from "./registration-track-model.js"
import type { OpsRegistrationTrackStatus } from "./registration-track-service"

export type RegistrationCaseListAction = "complete_consultation"

export type RegistrationCaseListProps = {
  items: RegistrationCaseListViewItem[]
  viewerId?: string | null
  viewerRole?: "admin" | "staff" | "assistant" | "teacher" | null
  loading?: boolean
  emptyLabel?: string
  disabled?: boolean
  onOpen: (taskId: string, preferredTrackId: string) => void
  onEdit: (taskId: string, preferredTrackId: string) => void
  onAction: (
    taskId: string,
    trackId: string,
    action: RegistrationCaseListAction,
  ) => void
  canDelete: (item: RegistrationCaseListViewItem) => boolean
  onDelete: (item: RegistrationCaseListViewItem) => void
}

const TRACK_STATUS_LABELS: Record<OpsRegistrationTrackStatus, string> = {
  inquiry: "문의",
  migration_review: "과목 확인 필요",
  level_test_scheduled: "레벨테스트 예약",
  level_test_in_progress: "레벨테스트 진행",
  consultation_waiting: "전화상담 대기",
  visit_consultation_scheduled: "방문상담 예약",
  waiting: "대기",
  enrollment_decided: "등록 결정",
  enrollment_processing: "등록 처리",
  registered: "등록 완료",
  not_registered: "미등록 완료",
  inquiry_closed: "문의 완료",
}

const TRACK_MANAGEMENT_LABELS = {
  inquiry: "문의 처리",
  level_test: "레벨테스트 관리",
  consulting: "상담 관리",
  waiting: "대기 관리",
  enrollment: "등록 관리",
  closed: "완료 확인",
} as const

const REGISTRATION_CASE_VIEW_COLUMNS = {
  inquiry: ["학생", "학년 · 학교", "연락처", "문의 과목 · 일시"],
  level_test: ["학생 · 과목", "예약 일시", "장소", "진행 · 결과"],
  consulting: ["학생 · 과목", "상담 유형", "책임자", "기준 · 예약 일시", "장소"],
  waiting: ["학생 · 과목", "대기 종류", "책임자", "단계 진입일시"],
  enrollment: ["학생 · 과목", "등록 상태", "수업 시작", "교재 준비"],
  closed: ["학생 · 과목", "완료 상태", "책임자", "완료 일시"],
} as const

const REGISTRATION_CASE_INITIAL_RENDER_LIMIT = 40
const REGISTRATION_CASE_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

function RegistrationTrackStatusBadge({ status }: { status: OpsRegistrationTrackStatus }) {
  const completed = status === "registered" || status === "not_registered" || status === "inquiry_closed"
  const attention = status === "migration_review"

  return (
    <Badge
      variant={completed ? "secondary" : "outline"}
      className={attention ? "border-amber-300 bg-amber-50 text-amber-900" : undefined}
    >
      {TRACK_STATUS_LABELS[status]}
    </Badge>
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

function RegistrationCaseTracks({ item }: { item: RegistrationCaseListViewItem }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {item.tracks.map((track) => (
        <span key={track.trackId} className="flex min-w-0 items-center gap-1">
          <Badge variant="outline">{track.subject}</Badge>
          <RegistrationTrackStatusBadge status={track.status} />
        </span>
      ))}
    </div>
  )
}

function RegistrationCaseCell({ label, children, cellRole }: { label: string; children: ReactNode; cellRole?: "cell" }) {
  return (
    <div role={cellRole} className="min-w-0 break-words [overflow-wrap:anywhere]">
      <div className="mb-1 text-[11px] text-muted-foreground lg:hidden">{label}</div>
      <div>{children || "미정"}</div>
    </div>
  )
}

function RegistrationCaseProcessCells({ item, cellRole }: Pick<RegistrationCaseRowProps, "item" | "cellRole">) {
  const registration = item.task.registration
  const student = <><div className="font-medium">{item.studentName}</div><div className="mt-1"><RegistrationCaseTracks item={item} /></div></>
  const trackLines = (render: (track: RegistrationCaseListViewItem["matchingTracks"][number]) => ReactNode) => (
    <div className="grid gap-1">{item.matchingTracks.map((track) => <div key={track.trackId}>{render(track)}</div>)}</div>
  )

  if (item.viewKey === "inquiry") return <>
    <RegistrationCaseCell label="학생" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="학년 · 학교" cellRole={cellRole}>{[registration?.schoolGrade, registration?.schoolName].filter(Boolean).join(" · ")}</RegistrationCaseCell>
    <RegistrationCaseCell label="연락처" cellRole={cellRole}><div>학부모 {registration?.parentPhone || "미정"}</div>{registration?.studentPhone ? <div className="text-muted-foreground">학생 {registration.studentPhone}</div> : null}</RegistrationCaseCell>
    <RegistrationCaseCell label="문의 과목 · 일시" cellRole={cellRole}>{trackLines((track) => <><span className="font-medium">{track.subject}</span> · {formatRegistrationCaseTime(registration?.inquiryAt || track.stageEnteredAt)}</>)}</RegistrationCaseCell>
  </>

  if (item.viewKey === "level_test") return <>
    <RegistrationCaseCell label="학생 · 과목" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="예약 일시" cellRole={cellRole}>{registration?.levelTestAt ? formatRegistrationCaseTime(registration.levelTestAt) : trackLines((track) => formatRegistrationCaseTime(track.stageEnteredAt))}</RegistrationCaseCell>
    <RegistrationCaseCell label="장소" cellRole={cellRole}>{registration?.levelTestPlace}</RegistrationCaseCell>
    <RegistrationCaseCell label="진행 · 결과" cellRole={cellRole}>{registration?.levelTestResult || trackLines((track) => TRACK_STATUS_LABELS[track.status])}</RegistrationCaseCell>
  </>

  if (item.viewKey === "consulting") return <>
    <RegistrationCaseCell label="학생 · 과목" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="상담 유형" cellRole={cellRole}>{trackLines((track) => TRACK_STATUS_LABELS[track.status])}</RegistrationCaseCell>
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => `${track.subject} · ${track.directorName || "미지정"}`)}</RegistrationCaseCell>
    <RegistrationCaseCell label="기준 · 예약 일시" cellRole={cellRole}>{trackLines((track) => `${track.subject} · ${getRegistrationCaseTrackTimeLabel(track)}`)}</RegistrationCaseCell>
    <RegistrationCaseCell label="장소" cellRole={cellRole}>{trackLines((track) => track.visitPlace || (track.status === "consultation_waiting" ? "전화상담" : "미정"))}</RegistrationCaseCell>
  </>

  if (item.viewKey === "waiting") return <>
    <RegistrationCaseCell label="학생 · 과목" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="대기 종류" cellRole={cellRole}>{trackLines((track) => track.track.waitingKind || "미정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => track.directorName || "미지정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="단계 진입일시" cellRole={cellRole}>{trackLines((track) => formatRegistrationCaseTime(track.stageEnteredAt))}</RegistrationCaseCell>
  </>

  if (item.viewKey === "enrollment") return <>
    <RegistrationCaseCell label="학생 · 과목" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="등록 상태" cellRole={cellRole}>{trackLines((track) => TRACK_STATUS_LABELS[track.status])}</RegistrationCaseCell>
    <RegistrationCaseCell label="수업 시작" cellRole={cellRole}>{[registration?.classStartDate, registration?.classStartSession].filter(Boolean).join(" · ")}</RegistrationCaseCell>
    <RegistrationCaseCell label="교재 준비" cellRole={cellRole}>{registration?.textbookPreparation || "미정"}</RegistrationCaseCell>
  </>

  return <>
    <RegistrationCaseCell label="학생 · 과목" cellRole={cellRole}>{student}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 상태" cellRole={cellRole}>{trackLines((track) => TRACK_STATUS_LABELS[track.status])}</RegistrationCaseCell>
    <RegistrationCaseCell label="책임자" cellRole={cellRole}>{trackLines((track) => track.directorName || "미지정")}</RegistrationCaseCell>
    <RegistrationCaseCell label="완료 일시" cellRole={cellRole}>{trackLines((track) => formatRegistrationCaseTime(track.stageEnteredAt))}</RegistrationCaseCell>
  </>
}

type RegistrationCaseRowProps = Omit<RegistrationCaseListProps, "items" | "loading" | "emptyLabel"> & {
  item: RegistrationCaseListViewItem
  cellRole?: "cell"
}

function RegistrationCaseActions({
  item,
  viewerId,
  viewerRole,
  disabled,
  onOpen,
  onEdit,
  onAction,
  canDelete,
  onDelete,
  cellRole,
}: RegistrationCaseRowProps) {
  const representativePermissions = getRegistrationSummaryActionPermissions({
    viewerId,
    viewerRole,
    track: item.representativeTrack.track,
  })
  const managementActionLabel = TRACK_MANAGEMENT_LABELS[item.viewKey]

  return (
    <div role={cellRole} className="flex min-w-0 flex-wrap justify-end gap-1.5">
      {representativePermissions.canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${item.studentName} ${managementActionLabel}`}
          onClick={() => onEdit(item.taskId, item.representativeTrack.trackId)}
          disabled={disabled}
        >
          {managementActionLabel}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${item.studentName} 상세`}
          onClick={() => onOpen(item.taskId, item.representativeTrack.trackId)}
          disabled={disabled}
        >
          상세
        </Button>
      )}
      {item.matchingTracks.map((track) => {
        const permissions = getRegistrationSummaryActionPermissions({ viewerId, viewerRole, track: track.track })
        if (!permissions.canOpenConsultationCompletion) return null
        const consultationActionLabel = track.status === "consultation_waiting"
          ? "전화상담 완료"
          : "방문상담 완료"
        return (
          <Button
            key={track.trackId}
            type="button"
            size="sm"
            aria-label={`${track.subject} ${item.studentName} ${consultationActionLabel}`}
            onClick={() => {
              // This summary hint must be followed by a strict detail permission check before mutation.
              onAction(item.taskId, track.trackId, "complete_consultation")
            }}
            disabled={disabled}
          >
            {track.subject} {consultationActionLabel}
          </Button>
        )
      })}
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
  onOpen,
  onEdit,
  onAction,
  canDelete,
  onDelete,
  cellRole,
}: RegistrationCaseRowProps) {
  return (
    <>
      <RegistrationCaseProcessCells item={item} cellRole={cellRole} />
      <RegistrationCaseActions
        item={item}
        viewerId={viewerId}
        viewerRole={viewerRole}
        disabled={disabled}
        onOpen={onOpen}
        onEdit={onEdit}
        onAction={onAction}
        canDelete={canDelete}
        onDelete={onDelete}
        cellRole={cellRole}
      />
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
  onAction,
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
  const gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr)) minmax(11rem, auto)`

  return (
    <section className="min-w-0 overflow-hidden rounded-md border bg-background" aria-label="등록 신청 목록">
      {loading || isEmpty ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground" role="status" aria-live="polite">
          {loading ? "불러오는 중입니다." : emptyLabel}
        </div>
      ) : (
        <>
          <div data-testid="registration-case-mobile-list" className="grid min-w-0 gap-2 p-2 lg:hidden" role="list" aria-label="등록 신청 모바일 목록">
            {visibleItems.map((item) => (
              <article key={item.taskId} className="grid min-w-0 gap-3 overflow-hidden rounded-md border bg-background p-3 shadow-xs" role="listitem" aria-label={`${item.studentName} 등록 신청`}>
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} onOpen={onOpen} onEdit={onEdit} onAction={onAction} canDelete={canDelete} onDelete={onDelete} />
              </article>
            ))}
          </div>
          <div data-testid="registration-case-desktop-list" className="hidden w-full min-w-0 overflow-hidden lg:block" role="table" aria-label="등록 신청 데이터테이블">
            <div className="grid min-w-0 border-b bg-muted/45 text-xs text-muted-foreground" style={{ gridTemplateColumns }} role="row">
              {columns.map((column) => <div key={column} className="px-3 py-2" role="columnheader">{column}</div>)}
              <div className="px-3 py-2 text-right" role="columnheader">액션</div>
            </div>
            {visibleItems.map((item) => (
              <div key={item.taskId} className="grid min-w-0 items-center gap-3 border-b p-3 text-sm last:border-b-0 hover:bg-muted/30" style={{ gridTemplateColumns }} role="row">
                <RegistrationCaseListRow item={item} viewerId={viewerId} viewerRole={viewerRole} disabled={disabled} onOpen={onOpen} onEdit={onEdit} onAction={onAction} canDelete={canDelete} onDelete={onDelete} cellRole="cell" />
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
