"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type { OpsTask } from "./ops-task-service"
import {
  getRegistrationSummaryActionPermissions,
  getRegistrationTrackViewKey,
  type RegistrationTrackViewKey,
} from "./registration-track-model.js"
import type {
  OpsRegistrationTrackStatus,
  OpsRegistrationTrackSummary,
} from "./registration-track-service"

export type RegistrationTrackListItem = {
  key: string
  taskId: string
  trackId: string
  studentName: string
  subject: "영어" | "수학"
  status: OpsRegistrationTrackStatus
  viewKey: RegistrationTrackViewKey
  directorName: string
  directorProfileId: string | null
  stageEnteredAt: string
  phoneReadyAt: string | null
  migrationReviewRequired: boolean
  visitScheduledAt: string
  visitPlace: string
  task: OpsTask
  track: OpsRegistrationTrackSummary
}

type OpsTaskWithRegistrationTracks = OpsTask & {
  registrationTracks?: OpsRegistrationTrackSummary[]
}

// registration-track-list-adapter:start
export function buildRegistrationTrackListItems(tasks: OpsTask[]) {
  return tasks.flatMap((task) => {
    const registrationTracks = (task as OpsTaskWithRegistrationTracks).registrationTracks || []

    return registrationTracks.map((track) => ({
      key: `${task.id}:${track.id}`,
      taskId: task.id,
      trackId: track.id,
      studentName: task.studentName || task.title,
      subject: track.subject,
      status: track.status,
      viewKey: getRegistrationTrackViewKey(track.status),
      directorProfileId: track.directorProfileId,
      directorName: track.directorName,
      stageEnteredAt: track.stageEnteredAt,
      phoneReadyAt: track.phoneReadyAt,
      migrationReviewRequired: track.migrationReviewRequired,
      visitScheduledAt: track.visitScheduledAt || "",
      visitPlace: track.visitPlace || "",
      task,
      track,
    }))
  })
}

export function filterRegistrationTrackListItems(
  items: RegistrationTrackListItem[],
  viewKey: RegistrationTrackViewKey,
  query = "",
) {
  const normalizedQuery = normalizeRegistrationTrackSearchText(query)
  const filtered = items.filter((item) => (
    item.viewKey === viewKey
    && (!normalizedQuery || [
      item.studentName,
      item.subject,
      item.directorName,
      item.visitPlace,
      item.task.registration?.schoolGrade,
      item.task.registration?.schoolName,
      item.task.registration?.parentPhone,
      item.task.registration?.studentPhone,
      item.task.registration?.requestNote,
    ].some((value) => normalizeRegistrationTrackSearchText(value).includes(normalizedQuery)))
  ))
  if (viewKey !== "consulting") return filtered

  const phoneQueue = filtered
    .filter((item) => item.status === "consultation_waiting")
  const sortedPhoneQueue = sortRegistrationConsultationItems(phoneQueue)
  const scheduledVisits = filtered.filter((item) => item.status !== "consultation_waiting")

  return [...sortedPhoneQueue, ...scheduledVisits]
}

function normalizeRegistrationTrackSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "")
}

export function sortRegistrationConsultationItems<T extends Pick<RegistrationTrackListItem, "key" | "phoneReadyAt">>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.phoneReadyAt || "")
    const rightTime = Date.parse(right.phoneReadyAt || "")
    const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY
    const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY
    if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1
    return left.key.localeCompare(right.key)
  })
}

export function getRegistrationTrackTimeValue(
  item: Pick<RegistrationTrackListItem, "status" | "stageEnteredAt" | "phoneReadyAt" | "visitScheduledAt">,
) {
  if (item.status === "consultation_waiting") return item.phoneReadyAt || ""
  if (item.status === "visit_consultation_scheduled") return item.visitScheduledAt
  return item.stageEnteredAt
}
// registration-track-list-adapter:end

export type RegistrationTrackListAction = "complete_consultation"

type RegistrationTrackViewerRole = "admin" | "staff" | "assistant" | "teacher" | null

type RegistrationTrackListProps = {
  items: RegistrationTrackListItem[]
  viewerId?: string | null
  viewerRole?: RegistrationTrackViewerRole
  loading?: boolean
  emptyLabel?: string
  disabled?: boolean
  onOpen: (taskId: string, trackId: string) => void
  onAction: (
    taskId: string,
    trackId: string,
    action: RegistrationTrackListAction,
  ) => void
  onEdit: (taskId: string, trackId: string) => void
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

const TRACK_MANAGEMENT_LABELS: Record<RegistrationTrackViewKey, string> = {
  inquiry: "문의 처리",
  level_test: "레벨테스트 관리",
  consulting: "상담 관리",
  waiting: "대기 관리",
  enrollment: "등록 관리",
  closed: "완료 확인",
}

const REGISTRATION_TRACK_INITIAL_RENDER_LIMIT = 40
const REGISTRATION_TRACK_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
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

function RegistrationTrackIdentity({ item }: { item: RegistrationTrackListItem }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{item.studentName}</span>
        <Badge variant="outline">{item.subject}</Badge>
        <RegistrationTrackStatusBadge status={item.status} />
      </div>
      <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {((item.task as OpsTaskWithRegistrationTracks).registrationTracks?.length || 0) > 1
          ? "같은 문의의 과목별 진행"
          : "단일 과목 문의"}
      </p>
    </div>
  )
}

function formatStageEnteredAt(value: string) {
  if (!value) return "미정"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "미정"
  return REGISTRATION_TRACK_DATE_FORMATTER.format(date)
}

function getRegistrationTrackTimeLabel(item: RegistrationTrackListItem) {
  return formatStageEnteredAt(getRegistrationTrackTimeValue(item))
}

function getRegistrationTrackPlaceLabel(item: RegistrationTrackListItem) {
  return item.status === "visit_consultation_scheduled" ? item.visitPlace || "장소 미정" : ""
}

function RegistrationTrackActions({
  item,
  viewerId,
  viewerRole,
  disabled,
  onOpen,
  onAction,
  onEdit,
}: Pick<
  RegistrationTrackListProps,
  "viewerId" | "viewerRole" | "disabled" | "onOpen" | "onAction" | "onEdit"
> & { item: RegistrationTrackListItem }) {
  const permissions = getRegistrationSummaryActionPermissions({
    viewerId,
    viewerRole,
    track: item.track,
  })
  const managementActionLabel = TRACK_MANAGEMENT_LABELS[item.viewKey]
  const consultationActionLabel = item.status === "consultation_waiting"
    ? "전화상담 완료"
    : "방문상담 완료"

  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
      {permissions.canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`[${item.subject}] ${item.studentName} ${managementActionLabel}`}
          onClick={() => onEdit(item.taskId, item.trackId)}
          disabled={disabled}
        >
          {managementActionLabel}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`[${item.subject}] ${item.studentName} 상세`}
          onClick={() => onOpen(item.taskId, item.trackId)}
          disabled={disabled}
        >
          상세
        </Button>
      )}
      {permissions.canOpenConsultationCompletion ? (
        <Button
          type="button"
          size="sm"
          aria-label={`[${item.subject}] ${item.studentName} ${consultationActionLabel}`}
          onClick={() => {
            // This summary hint must be followed by a strict detail permission check before mutation.
            onAction(item.taskId, item.trackId, "complete_consultation")
          }}
          disabled={disabled}
        >
          {consultationActionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function RegistrationTrackList({
  items,
  viewerId = null,
  viewerRole = null,
  loading = false,
  emptyLabel = "표시할 등록 항목이 없습니다.",
  disabled = false,
  onOpen,
  onAction,
  onEdit,
}: RegistrationTrackListProps) {
  const isEmpty = !loading && items.length === 0
  const itemSetKey = items.map((item) => item.key).join("|")
  const [windowState, setWindowState] = useState(() => ({
    key: itemSetKey,
    count: REGISTRATION_TRACK_INITIAL_RENDER_LIMIT,
  }))
  const visibleCount = windowState.key === itemSetKey
    ? windowState.count
    : REGISTRATION_TRACK_INITIAL_RENDER_LIMIT
  const visibleItems = items.slice(0, visibleCount)
  const hasMore = visibleItems.length < items.length

  return (
    <section className="min-w-0 overflow-hidden rounded-md border bg-background" aria-label="과목별 등록 업무 목록">
      {loading || isEmpty ? (
        <div
          className="px-4 py-12 text-center text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {loading ? "불러오는 중입니다." : emptyLabel}
        </div>
      ) : (
        <>
      <div
        data-testid="registration-track-mobile-list"
        className="grid min-w-0 gap-2 p-2 lg:hidden"
        role="list"
        aria-label="과목별 등록 모바일 목록"
      >
        {visibleItems.map((item) => (
          <article
            key={item.key}
            className="grid min-w-0 gap-3 overflow-hidden rounded-md border bg-background p-3 shadow-xs [contain-intrinsic-size:auto_132px] [content-visibility:auto]"
            role="listitem"
            aria-label={`${item.studentName} ${item.subject} 등록 업무`}
          >
            <RegistrationTrackIdentity item={item} />
            <dl className="grid min-w-0 grid-cols-2 gap-3 border-t pt-2 text-xs">
              <div className="min-w-0">
                <dt className="text-muted-foreground">상담 책임자</dt>
                <dd className="mt-0.5 break-words font-medium [overflow-wrap:anywhere]">{item.directorName || "미지정"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{item.status === "consultation_waiting" ? "전화상담 대기 기준" : item.status === "visit_consultation_scheduled" ? "방문상담 일시" : "현재 단계 진입"}</dt>
                <dd className="mt-0.5 break-words font-medium [overflow-wrap:anywhere]">{getRegistrationTrackTimeLabel(item)}</dd>
                {item.status === "visit_consultation_scheduled" ? <dd className="mt-0.5 break-words text-muted-foreground [overflow-wrap:anywhere]">방문상담 장소 · {getRegistrationTrackPlaceLabel(item)}</dd> : null}
              </div>
            </dl>
            <div className="min-w-0 border-t pt-2">
              <RegistrationTrackActions
                item={item}
                viewerId={viewerId}
                viewerRole={viewerRole}
                disabled={disabled}
                onOpen={onOpen}
                onAction={onAction}
                onEdit={onEdit}
              />
            </div>
          </article>
        ))}
      </div>

      <div
        data-testid="registration-track-desktop-list"
        className="hidden w-full min-w-0 overflow-hidden lg:block"
        role="table"
        aria-label="과목별 등록 데이터테이블"
      >
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(7rem,0.65fr)_minmax(8rem,0.75fr)_minmax(13rem,1.2fr)] border-b bg-muted/45 text-xs text-muted-foreground"
          role="row"
        >
          <div className="px-3 py-2" role="columnheader">학생 · 과목</div>
          <div className="px-3 py-2" role="columnheader">상담 책임자</div>
          <div className="px-3 py-2" role="columnheader">일시</div>
          <div className="px-3 py-2 text-right" role="columnheader">액션</div>
        </div>
        {visibleItems.map((item) => (
          <div
            key={item.key}
            className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(7rem,0.65fr)_minmax(8rem,0.75fr)_minmax(13rem,1.2fr)] items-center border-b text-sm last:border-b-0 hover:bg-muted/30 [contain-intrinsic-size:auto_58px] [content-visibility:auto]"
            role="row"
          >
            <div className="min-w-0 px-3 py-2" role="cell">
              <RegistrationTrackIdentity item={item} />
            </div>
            <div className="min-w-0 break-words px-3 py-2 [overflow-wrap:anywhere]" role="cell">
              {item.directorName || "미지정"}
            </div>
            <div className="min-w-0 break-words px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]" role="cell">
              <span className="block">{item.status === "consultation_waiting" ? "전화상담 대기 · " : item.status === "visit_consultation_scheduled" ? "방문상담 일시 · " : ""}{getRegistrationTrackTimeLabel(item)}</span>
              {item.status === "visit_consultation_scheduled" ? <span className="block break-words [overflow-wrap:anywhere]">방문상담 장소 · {getRegistrationTrackPlaceLabel(item)}</span> : null}
            </div>
            <div className="min-w-0 px-3 py-2" role="cell">
              <RegistrationTrackActions
                item={item}
                viewerId={viewerId}
                viewerRole={viewerRole}
                disabled={disabled}
                onOpen={onOpen}
                onAction={onAction}
                onEdit={onEdit}
              />
            </div>
          </div>
        ))}
      </div>
          {hasMore ? (
            <div className="flex justify-center border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWindowState((current) => ({
                  key: itemSetKey,
                  count: (current.key === itemSetKey
                    ? current.count
                    : REGISTRATION_TRACK_INITIAL_RENDER_LIMIT) + REGISTRATION_TRACK_INITIAL_RENDER_LIMIT,
                }))}
              >
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
