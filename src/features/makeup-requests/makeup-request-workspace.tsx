"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Filter, MessageSquare, Pencil, Plus, RotateCcw, Send, Settings, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DatePickerControl, TimePickerControl } from "@/components/ui/date-time-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/providers/auth-provider"
import {
  buildRoomAvailability,
  getAllowedApproverNames,
  getDefaultMakeupEndAt,
  MAKEUP_REQUEST_STATUS_LABELS,
} from "./makeup-request-model.js"
import {
  approveMakeupRequest,
  cancelCompletedMakeupRequest,
  createMakeupRequest,
  deleteMakeupRequest,
  getMakeupNotificationTriggerLabel,
  loadMakeupRequestWorkspaceData,
  MAKEUP_NOTIFICATION_CHANNEL_LABELS,
  MAKEUP_NOTIFICATION_TRIGGER_LABELS,
  rejectMakeupRequest,
  renderMakeupNotificationTemplate,
  requestMakeupRequestRevision,
  resubmitMakeupRequest,
  toggleMakeupNotificationSetting,
  updateMakeupNotificationTriggerContent,
  type GoogleChatChannel,
  type MakeupClassOption,
  type MakeupNotificationDelivery,
  type MakeupNotificationSetting,
  type MakeupRequest,
  type MakeupRequestInput,
  type MakeupRequestWorkspaceData,
} from "./makeup-request-service"

type MakeupRequestView = "mine" | "approvals" | "closed"
type MakeupRequestPeriodFilter = "all" | "today" | "week" | "month" | "custom"

const MAKEUP_REQUEST_ACTIVE_STATUSES = ["approval_pending", "revision_requested"] as Array<MakeupRequest["status"]>
const MAKEUP_REQUEST_CLOSED_STATUSES = ["completed", "rejected", "canceled"] as Array<MakeupRequest["status"]>

const MAKEUP_REQUEST_PERIOD_FILTERS: Array<{ key: MakeupRequestPeriodFilter; label: string }> = [
  { key: "all", label: "전체 기간" },
  { key: "today", label: "오늘" },
  { key: "week", label: "이번주" },
  { key: "month", label: "이번달" },
  { key: "custom", label: "직접입력" },
]

const EMPTY_INPUT: MakeupRequestInput = {
  classId: "",
  reason: "",
  cancelDate: "",
  makeupSlots: [{ id: "slot-1", date: "", startTime: "", endTime: "", classroom: "" }],
  makeupClassroom: "",
  approverTeacherCatalogId: "",
}

const STATUS_BADGE_VARIANT: Record<MakeupRequest["status"], "default" | "secondary" | "outline" | "destructive"> = {
  approval_pending: "secondary",
  revision_requested: "outline",
  rejected: "destructive",
  manager_pending: "default",
  completed: "outline",
  canceled: "outline",
}

const SUBJECT_SORT_ORDER = ["영어", "수학"]

const NOTIFICATION_DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: "발송",
  skipped: "건너뜀",
  failed: "실패",
  disabled: "꺼짐",
  deduped: "중복 차단",
}

const MAKEUP_NOTIFICATION_CHANNEL_ORDER: Array<MakeupNotificationSetting["channel"]> = [
  "dashboard_personal",
  "dashboard_management",
  "google_chat_executive",
  "google_chat_admin",
  "google_chat_english",
  "google_chat_math",
]

const MAKEUP_GOOGLE_CHAT_CHANNEL_MAP: Partial<Record<MakeupNotificationSetting["channel"], GoogleChatChannel>> = {
  google_chat_executive: "executive",
  google_chat_admin: "admin",
  google_chat_english: "english",
  google_chat_math: "math",
}

const MAKEUP_NOTIFICATION_TABLE_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: `minmax(160px, 0.95fr) repeat(${MAKEUP_NOTIFICATION_CHANNEL_ORDER.length}, minmax(118px, 1fr))`,
}

const EMPTY_NOTIFICATION_TEMPLATE_INPUT = {
  titleTemplate: "",
  bodyTemplate: "",
}

type MakeupGoogleChatWebhookInfo = {
  channelKey: MakeupNotificationSetting["channel"]
  channelLabel: string
  envName: string
  configured: boolean
  maskedUrl: string
}

type GoogleChatWebhookInfoResponse = {
  ok?: boolean
  envName?: string
  configured?: boolean
  maskedUrl?: string
  error?: string
}

const MAKEUP_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT: Record<string, string> = {
  프로세스: "신청 제출",
  상태: "결재자 승인 대기",
  수업: "대기고1A",
  과목: "영어",
  선생님: "강부희",
  사유: "개인 일정",
  휴강일: "2026-07-07",
  보강일시: "2026-07-08 10:00 - 2026-07-08 12:00",
  "보강 강의실": "별관 3강",
  보강강의실: "별관 3강",
  신청자: "임현준",
  상신일시: "2026-07-06 12:03",
  보완요청일시: "-",
  "보완 사유": "-",
  승인일시: "2026-07-06 12:06",
  "승인 메모": "-",
  반려일시: "-",
  "반려 사유": "-",
  승인취소일시: "2026-07-06 12:44",
  "승인취소 메모": "-",
  결재자: "강부희",
}

function getNotificationTemplateSetting(triggerKind: MakeupNotificationSetting["triggerKind"], settings: MakeupNotificationSetting[]) {
  const triggerSettings = settings.filter((item) => item.triggerKind === triggerKind)
  return triggerSettings.find((item) => item.channel === "dashboard_personal") || triggerSettings[0] || null
}

function getNotificationDeliveryTargetLabel(delivery: MakeupNotificationDelivery) {
  if (delivery.targetType === "google_chat") {
    return MAKEUP_NOTIFICATION_CHANNEL_LABELS[delivery.channel] || delivery.targetLabel || delivery.targetType
  }
  return delivery.targetLabel || delivery.targetType
}

function sortSubjectOptions(left: string, right: string) {
  const leftIndex = SUBJECT_SORT_ORDER.indexOf(left)
  const rightIndex = SUBJECT_SORT_ORDER.indexOf(right)
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
  if (leftIndex >= 0) return -1
  if (rightIndex >= 0) return 1
  return left.localeCompare(right, "ko")
}

function formatDateTime(value: string) {
  if (!value) return "-"
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : value
}

function toText(value: unknown) {
  return String(value || "").trim()
}

function getStatusLabel(status: MakeupRequest["status"]) {
  return (MAKEUP_REQUEST_STATUS_LABELS as Record<string, string>)[status] || status
}

function findSelectedClass(data: MakeupRequestWorkspaceData, input: MakeupRequestInput) {
  return data.classes.find((classItem) => classItem.id === input.classId) || null
}

function canUserManage(userRole: string) {
  return userRole === "admin" || userRole === "staff"
}

function getMakeupActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object") {
    const detail = [
      (error as { message?: unknown }).message,
      (error as { details?: unknown }).details,
      (error as { hint?: unknown }).hint,
      (error as { code?: unknown }).code,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ")
    if (detail) return detail
  }
  return fallback
}

function getRequestEvent(request: MakeupRequest, eventTypes: string[]) {
  const typeSet = new Set(eventTypes)
  return [...(request.events || [])]
    .filter((event) => typeSet.has(event.eventType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
}

function getRequestSlots(request: MakeupRequest) {
  return request.makeupSlots.length > 0
    ? request.makeupSlots
    : [{ id: "slot-1", startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom }]
}

function toDateKey(value: string | Date) {
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ""
}

function getDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function getMakeupRequestWeekRange(todayKey: string) {
  const today = getDateFromKey(todayKey) || new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: toDateKey(monday), end: toDateKey(sunday) }
}

function getMakeupRequestMonthRange(todayKey: string) {
  const today = getDateFromKey(todayKey) || new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return { start: toDateKey(start), end: toDateKey(end) }
}

function isDateKeyInRange(dateKey: string, startDateKey: string, endDateKey: string) {
  if (!dateKey) return false
  if (startDateKey && dateKey < startDateKey) return false
  if (endDateKey && dateKey > endDateKey) return false
  return true
}

function getMakeupRequestPeriodDateKeys(request: MakeupRequest) {
  const dateKeys = [
    toDateKey(request.cancelDate),
    ...getRequestSlots(request).flatMap((slot) => [
      toDateKey(slot.startAt || request.makeupStartAt),
      toDateKey(slot.endAt || request.makeupEndAt),
    ]),
  ].filter(Boolean)
  return [...new Set(dateKeys)]
}

function matchesMakeupRequestPeriodFilter(
  request: MakeupRequest,
  periodFilter: MakeupRequestPeriodFilter,
  todayKey: string,
  customStartDate: string,
  customEndDate: string,
) {
  if (periodFilter === "all") return true
  const dateKeys = getMakeupRequestPeriodDateKeys(request)
  if (dateKeys.length === 0) return false

  if (periodFilter === "today") return dateKeys.some((dateKey) => dateKey === todayKey)
  if (periodFilter === "week") {
    const range = getMakeupRequestWeekRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }
  if (periodFilter === "month") {
    const range = getMakeupRequestMonthRange(todayKey)
    return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, range.start, range.end))
  }

  const startDateKey = toDateKey(customStartDate)
  const endDateKey = toDateKey(customEndDate)
  if (!startDateKey && !endDateKey) return true
  return dateKeys.some((dateKey) => isDateKeyInRange(dateKey, startDateKey, endDateKey))
}

function getMakeupRequestTeacherFilterValue(request: MakeupRequest) {
  return request.teacherCatalogId ? `id:${request.teacherCatalogId}` : `name:${request.teacherLabel}`
}

function matchesMakeupRequestSelectionFilters(
  request: MakeupRequest,
  selectedSubjectFilter: string,
  selectedTeacherFilter: string,
  selectedClassFilter: string,
) {
  if (selectedSubjectFilter !== "all" && request.subject !== selectedSubjectFilter) return false
  if (selectedTeacherFilter !== "all" && getMakeupRequestTeacherFilterValue(request) !== selectedTeacherFilter) return false
  if (selectedClassFilter !== "all" && request.classId !== selectedClassFilter) return false
  return true
}

function getMakeupRequestViewRequests(
  requests: MakeupRequest[],
  view: MakeupRequestView,
  currentUserId: string,
) {
  if (view === "mine") {
    return requests.filter((request) => (
      (request.requesterId === currentUserId || request.teacherProfileId === currentUserId) &&
      MAKEUP_REQUEST_ACTIVE_STATUSES.includes(request.status)
    ))
  }
  if (view === "approvals") {
    return requests.filter((request) => request.approverProfileId === currentUserId && request.status === "approval_pending")
  }
  return requests.filter((request) => (
    MAKEUP_REQUEST_CLOSED_STATUSES.includes(request.status)
  ))
}

type MakeupRequestTableColumnKey =
  | "status"
  | "className"
  | "subject"
  | "teacher"
  | "requester"
  | "reason"
  | "cancelDate"
  | "makeupAt"
  | "makeupRoom"
  | "approver"
  | "submittedAt"
  | "revisionRequestedAt"
  | "approvedAt"
  | "rejectedAt"
  | "canceledAt"
  | "returnedReason"
  | "rejectedReason"
  | "finalNote"
  | "canceledNote"
  | "action"

type MakeupRequestCardColumnKey = Exclude<MakeupRequestTableColumnKey, "status" | "className" | "subject" | "teacher" | "action">

type MakeupRequestTableSort = {
  columnKey: MakeupRequestTableColumnKey
  direction: "asc" | "desc"
} | null

const MAKEUP_REQUEST_TABLE_COLUMNS: Array<{
  columnKey: MakeupRequestTableColumnKey
  label: string
  width: number
  minWidth: number
  align?: "left" | "right"
}> = [
  { columnKey: "status", label: "상태", width: 112, minWidth: 96 },
  { columnKey: "className", label: "수업", width: 150, minWidth: 120 },
  { columnKey: "subject", label: "과목", width: 94, minWidth: 78 },
  { columnKey: "teacher", label: "선생님", width: 118, minWidth: 96 },
  { columnKey: "reason", label: "사유", width: 220, minWidth: 150 },
  { columnKey: "cancelDate", label: "휴강일", width: 122, minWidth: 108 },
  { columnKey: "makeupAt", label: "보강일시", width: 250, minWidth: 170 },
  { columnKey: "makeupRoom", label: "보강 강의실", width: 150, minWidth: 120 },
  { columnKey: "requester", label: "신청자", width: 118, minWidth: 96 },
  { columnKey: "submittedAt", label: "상신일시", width: 160, minWidth: 132 },
  { columnKey: "revisionRequestedAt", label: "보완요청일시", width: 160, minWidth: 132 },
  { columnKey: "returnedReason", label: "보완 사유", width: 190, minWidth: 140 },
  { columnKey: "approvedAt", label: "승인일시", width: 160, minWidth: 132 },
  { columnKey: "finalNote", label: "승인 메모", width: 230, minWidth: 160 },
  { columnKey: "rejectedAt", label: "반려일시", width: 160, minWidth: 132 },
  { columnKey: "rejectedReason", label: "반려 사유", width: 190, minWidth: 140 },
  { columnKey: "canceledAt", label: "승인취소일시", width: 160, minWidth: 132 },
  { columnKey: "canceledNote", label: "승인취소 메모", width: 230, minWidth: 160 },
  { columnKey: "approver", label: "결재자", width: 118, minWidth: 96 },
  { columnKey: "action", label: "액션", width: 230, minWidth: 180, align: "right" },
]

const MAKEUP_NOTIFICATION_TEMPLATE_VARIABLES = [
  "프로세스",
  ...MAKEUP_REQUEST_TABLE_COLUMNS
    .map((column) => column.label)
    .filter((label) => label !== "액션"),
]

const hiddenOnCardColumnKeys = new Set<MakeupRequestTableColumnKey>(["className", "subject", "teacher"])
const MAKEUP_REQUEST_CARD_COLUMNS: Array<{ columnKey: MakeupRequestCardColumnKey; label: string }> = [
  { columnKey: "reason", label: "사유" },
  { columnKey: "cancelDate", label: "휴강일" },
  { columnKey: "makeupAt", label: "보강일시" },
  { columnKey: "makeupRoom", label: "보강 강의실" },
  { columnKey: "requester", label: "신청자" },
  { columnKey: "submittedAt", label: "상신일시" },
  { columnKey: "revisionRequestedAt", label: "보완요청일시" },
  { columnKey: "returnedReason", label: "보완 사유" },
  { columnKey: "approvedAt", label: "승인일시" },
  { columnKey: "finalNote", label: "승인 메모" },
  { columnKey: "rejectedAt", label: "반려일시" },
  { columnKey: "rejectedReason", label: "반려 사유" },
  { columnKey: "canceledAt", label: "승인취소일시" },
  { columnKey: "canceledNote", label: "승인취소 메모" },
  { columnKey: "approver", label: "결재자" },
]

function shouldShowCardColumn(columnKey: MakeupRequestCardColumnKey) {
  return columnKey === "canceledNote" || !hiddenOnCardColumnKeys.has(columnKey)
}

function getVisibleMakeupRequestCardColumns(request: MakeupRequest) {
  return MAKEUP_REQUEST_CARD_COLUMNS.filter((column) => {
    if (!shouldShowCardColumn(column.columnKey)) return false
    const value = getMakeupRequestCardValue(request, column.columnKey)
    return value !== "-"
  })
}

const MAKEUP_REQUEST_TABLE_COLUMN_WIDTHS = MAKEUP_REQUEST_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.width
  return widths
}, {} as Record<MakeupRequestTableColumnKey, number>)

const MAKEUP_REQUEST_TABLE_COLUMN_MIN_WIDTHS = MAKEUP_REQUEST_TABLE_COLUMNS.reduce((widths, column) => {
  widths[column.columnKey] = column.minWidth
  return widths
}, {} as Record<MakeupRequestTableColumnKey, number>)

function getMakeupRequestTableGridTemplate(columnWidths: Record<MakeupRequestTableColumnKey, number>) {
  return MAKEUP_REQUEST_TABLE_COLUMNS.map((column) => `${columnWidths[column.columnKey]}px`).join(" ")
}

function formatRequestSlotTime(slot: ReturnType<typeof getRequestSlots>[number], request: MakeupRequest) {
  const startAt = formatDateTime(slot.startAt || request.makeupStartAt)
  const endAt = formatDateTime(slot.endAt || request.makeupEndAt)
  if (startAt === "-" && endAt === "-") return "-"
  if (endAt === "-") return startAt
  return `${startAt} - ${endAt}`
}

function formatRequestSlotsTime(request: MakeupRequest) {
  return getRequestSlots(request)
    .map((slot) => formatRequestSlotTime(slot, request))
    .filter((value) => value && value !== "-")
    .join(" / ") || "-"
}

function formatRequestSlotsRooms(request: MakeupRequest) {
  return getRequestSlots(request)
    .map((slot) => slot.classroom || request.makeupClassroom)
    .filter(Boolean)
    .join(" / ") || "-"
}

function formatRequestEventDateTime(request: MakeupRequest, eventTypes: string[], fallback = "") {
  return formatDateTime(fallback || getRequestEvent(request, eventTypes)?.createdAt || "")
}

function getMakeupRequestTableValue(request: MakeupRequest, columnKey: MakeupRequestTableColumnKey) {
  switch (columnKey) {
    case "status":
      return getStatusLabel(request.status)
    case "className":
      return request.className || "-"
    case "subject":
      return request.subject || "-"
    case "teacher":
      return request.teacherLabel || "-"
    case "requester":
      return request.requesterLabel || "-"
    case "reason":
      return request.reason || "-"
    case "cancelDate":
      return request.cancelDate || "-"
    case "makeupAt":
      return formatRequestSlotsTime(request)
    case "makeupRoom":
      return formatRequestSlotsRooms(request)
    case "approver":
      return request.approverLabel || "-"
    case "submittedAt":
      return formatRequestEventDateTime(request, ["submitted", "resubmitted"], request.createdAt)
    case "revisionRequestedAt":
      return formatRequestEventDateTime(request, ["revision_requested"])
    case "approvedAt":
      return formatRequestEventDateTime(request, ["approved"], request.approvedAt)
    case "rejectedAt":
      return formatRequestEventDateTime(request, ["rejected"])
    case "canceledAt":
      return formatRequestEventDateTime(request, ["approval_canceled", "completed_canceled"], request.canceledAt)
    case "returnedReason":
      return request.returnedReason || "-"
    case "rejectedReason":
      return request.rejectedReason || "-"
    case "finalNote":
      return request.finalNote || "-"
    case "canceledNote":
      return getRequestEvent(request, ["approval_canceled", "completed_canceled"])?.note || "-"
    case "action":
      return ""
    default:
      return "-"
  }
}

function getMakeupRequestCardValue(request: MakeupRequest, columnKey: MakeupRequestCardColumnKey) {
  return getMakeupRequestTableValue(request, columnKey)
}

function hasMakeupRequestRoomCollision(request: MakeupRequest, data: MakeupRequestWorkspaceData) {
  return getRequestSlots(request).some((slot) => {
    const formSlot = toFormSlot({ ...slot, classroom: slot.classroom || request.makeupClassroom })
    return Boolean(getSlotRoomCollisionState(formSlot, data, request.id, request.subject)?.collisions.length)
  })
}

function handleOpenKeyDown(event: ReactKeyboardEvent, onOpenDetail: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return
  event.preventDefault()
  onOpenDetail()
}

type MakeupRequestActionControlsProps = {
  request: MakeupRequest
  data: MakeupRequestWorkspaceData
  currentUserId: string
  saving: boolean
  onEditForRevision: (request: MakeupRequest) => void
  onApprove: (request: MakeupRequest) => void
  onRequestRevision: (request: MakeupRequest, note: string) => void
  onReject: (request: MakeupRequest, note: string) => void
  onFinalCancel: (request: MakeupRequest) => void
  canForceDelete: boolean
  onForceDelete: (request: MakeupRequest) => void
  align?: "start" | "end"
}

function MakeupRequestActionControls({
  request,
  data,
  currentUserId,
  saving,
  onEditForRevision,
  onApprove,
  onRequestRevision,
  onReject,
  onFinalCancel,
  canForceDelete,
  onForceDelete,
  align = "end",
}: MakeupRequestActionControlsProps) {
  const hasRoomCollision = hasMakeupRequestRoomCollision(request, data)
  const canRevise = request.status === "revision_requested" && request.requesterId === currentUserId
  const canApprove = request.status === "approval_pending" && request.approverProfileId === currentUserId
  const canCancelApproval = request.status === "completed" && request.approverProfileId === currentUserId
  const canForceDeleteRequest = canForceDelete && MAKEUP_REQUEST_CLOSED_STATUSES.includes(request.status)

  if (!canRevise && !canApprove && !canCancelApproval && !canForceDeleteRequest) return null

  return (
    <div className={["flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "justify-start"].join(" ")}>
      {canRevise ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onEditForRevision(request)}>
          보완
        </Button>
      ) : null}
      {canApprove ? (
        <>
          <Button type="button" size="sm" disabled={hasRoomCollision || saving} onClick={() => onApprove(request)}>
            <Check className="size-4" aria-hidden="true" />
            승인
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const note = window.prompt("보완 요청 사유") || ""
              if (note) onRequestRevision(request, note)
            }}
          >
            보완 요청
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              const note = window.prompt("반려 사유") || ""
              if (note) onReject(request, note)
            }}
          >
            <X className="size-4" aria-hidden="true" />
            반려
          </Button>
        </>
      ) : null}
      {canCancelApproval ? (
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => onFinalCancel(request)}>
          <RotateCcw className="size-4" aria-hidden="true" />
          승인 취소
        </Button>
      ) : null}
      {canForceDeleteRequest ? (
        <Button type="button" size="sm" variant="destructive" disabled={saving} onClick={() => onForceDelete(request)}>
          <Trash2 className="size-4" aria-hidden="true" />
          삭제
        </Button>
      ) : null}
    </div>
  )
}

function MakeupRequestDetailCard({
  request,
  data,
  currentUserId,
  saving,
  onEditForRevision,
  onApprove,
  onRequestRevision,
  onReject,
  onFinalCancel,
  canForceDelete,
  onForceDelete,
  onOpenDetail,
  variant = "full",
}: MakeupRequestActionControlsProps & {
  onOpenDetail?: () => void
  variant?: "full" | "compact"
}) {
  const hasRoomCollision = hasMakeupRequestRoomCollision(request, data)
  const isCompact = variant === "compact"
  const detailColumns = getVisibleMakeupRequestCardColumns(request)
  const title = request.className || "휴보강 신청"
  const subtitle = [request.subject, request.teacherLabel].filter(Boolean).join(" · ")
  const headerText = (
    <span className="grid min-w-0 gap-0.5">
      <span className={["truncate font-semibold", isCompact ? "text-base" : "text-lg"].join(" ")}>{title}</span>
      {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
    </span>
  )

  return (
    <div className={["rounded-lg border bg-card text-card-foreground shadow-sm", isCompact ? "p-3" : "p-4"].join(" ")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        {onOpenDetail ? (
          <button
            type="button"
            aria-label="휴보강 신청 상세 열기"
            onClick={onOpenDetail}
            onKeyDown={(event) => handleOpenKeyDown(event, onOpenDetail)}
            className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {headerText}
          </button>
        ) : (
          <div className="min-w-0">{headerText}</div>
        )}
        <Badge variant={STATUS_BADGE_VARIANT[request.status]} className="shrink-0">
          {getStatusLabel(request.status)}
        </Badge>
      </div>
      {hasRoomCollision ? (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          보강 강의실 충돌 있음
        </div>
      ) : null}
      <div className={["mt-3 grid gap-2", isCompact ? "text-sm" : "sm:grid-cols-2"].join(" ")}>
        {detailColumns.map((column) => {
          const value = getMakeupRequestCardValue(request, column.columnKey)
          return (
            <div key={column.columnKey} className="min-w-0 rounded-md border bg-muted/10 px-3 py-2">
              <div className="text-[11px] font-medium text-muted-foreground">{column.label}</div>
              <div className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm">{value}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3">
        <MakeupRequestActionControls
          request={request}
          data={data}
          currentUserId={currentUserId}
          saving={saving}
          onEditForRevision={onEditForRevision}
          onApprove={onApprove}
          onRequestRevision={onRequestRevision}
          onReject={onReject}
          onFinalCancel={onFinalCancel}
          canForceDelete={canForceDelete}
          onForceDelete={onForceDelete}
          align="start"
        />
      </div>
    </div>
  )
}

function MakeupRequestCardList({
  requests,
  loading,
  data,
  currentUserId,
  saving,
  onOpenDetail,
  onEditForRevision,
  onApprove,
  onRequestRevision,
  onReject,
  onFinalCancel,
  canForceDelete,
  onForceDelete,
}: Omit<MakeupRequestActionControlsProps, "request" | "align"> & {
  requests: MakeupRequest[]
  loading: boolean
  onOpenDetail: (request: MakeupRequest) => void
}) {
  if (loading) {
    return (
      <div className="grid gap-2 md:hidden" role="list" aria-label="휴보강 신청 카드목록">
        <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          불러오는 중입니다.
        </div>
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="grid gap-2 md:hidden" role="list" aria-label="휴보강 신청 카드목록">
        <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          표시할 신청서가 없습니다.
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2 md:hidden" role="list" aria-label="휴보강 신청 카드목록">
      {requests.map((request) => (
        <div key={request.id} role="listitem">
          <MakeupRequestDetailCard
            request={request}
            data={data}
            currentUserId={currentUserId}
            saving={saving}
            onOpenDetail={() => onOpenDetail(request)}
            onEditForRevision={onEditForRevision}
            onApprove={onApprove}
            onRequestRevision={onRequestRevision}
            onReject={onReject}
            onFinalCancel={onFinalCancel}
            canForceDelete={canForceDelete}
            onForceDelete={onForceDelete}
            variant="compact"
          />
        </div>
      ))}
    </div>
  )
}

function MakeupRequestResizableHeaderCell({
  column,
  sort,
  onHeaderSelect,
  onResizeStart,
}: {
  column: (typeof MAKEUP_REQUEST_TABLE_COLUMNS)[number]
  sort: MakeupRequestTableSort
  onHeaderSelect: (columnKey: MakeupRequestTableColumnKey) => void
  onResizeStart: (key: MakeupRequestTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { columnKey, label, align } = column
  const isActiveSort = sort?.columnKey === columnKey
  const SortIcon = isActiveSort ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown
  const sortable = columnKey !== "action"

  return (
    <div
      role="columnheader"
      className={["relative min-w-0 border-r px-2 py-2 last:border-r-0", align === "right" ? "text-right" : ""].join(" ")}
    >
      <button
        type="button"
        disabled={!sortable}
        aria-label={`${label} 필터/정렬`}
        onClick={() => onHeaderSelect(columnKey)}
        className={[
          "flex w-full min-w-0 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-60",
          align === "right" ? "justify-end text-right" : "",
        ].join(" ")}
      >
        <span className="truncate">{label}</span>
        {sortable ? <SortIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        aria-label={`${label} 열 너비 조절`}
        onPointerDown={(event) => onResizeStart(columnKey, event)}
        className="absolute -right-1 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded-full hover:bg-primary/25 focus-visible:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}

function MakeupRequestDataCell({
  value,
  children,
  align = "left",
  onOpenDetail,
}: {
  value: string
  children?: ReactNode
  align?: "left" | "right"
  onOpenDetail?: () => void
}) {
  const content = children || <span className="block truncate" title={value}>{value}</span>
  return (
    <div role="cell" className={["min-w-0 border-r px-2 py-2 text-sm last:border-r-0", align === "right" ? "text-right" : ""].join(" ")}>
      {onOpenDetail ? (
        <button
          type="button"
          aria-label="휴보강 신청 상세 열기"
          title={value}
          onClick={onOpenDetail}
          onKeyDown={(event) => handleOpenKeyDown(event, onOpenDetail)}
          className={["block w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", align === "right" ? "text-right" : ""].join(" ")}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  )
}

type MakeupRequestSelectFilterOption = {
  value: string
  label: string
  count: number
}

function buildMakeupRequestSelectFilterOptions(
  requests: MakeupRequest[],
  resolveOption: (request: MakeupRequest) => { value: string; label: string },
) {
  const optionMap = new Map<string, MakeupRequestSelectFilterOption>()
  for (const request of requests) {
    const option = resolveOption(request)
    if (!option.value || !option.label) continue
    const current = optionMap.get(option.value)
    if (current) {
      current.count += 1
    } else {
      optionMap.set(option.value, { ...option, count: 1 })
    }
  }
  return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label, "ko", { numeric: true }))
}

function MakeupRequestFilterSelect({
  ariaLabel,
  value,
  allLabel,
  options,
  onChange,
}: {
  ariaLabel: string
  value: string
  allLabel: string
  options: MakeupRequestSelectFilterOption[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="h-8 w-[8rem] bg-background">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}{option.count ? ` ${option.count}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MakeupRequestPeriodFilterBar({
  value,
  startDate,
  endDate,
  onChange,
  onStartDateChange,
  onEndDateChange,
}: {
  value: MakeupRequestPeriodFilter
  startDate: string
  endDate: string
  onChange: (value: MakeupRequestPeriodFilter) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="휴보강 기간 필터">
      <div className="inline-flex max-w-full overflow-x-auto rounded-md border bg-background p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MAKEUP_REQUEST_PERIOD_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            aria-pressed={value === filter.key}
            aria-label={`${filter.label} 휴보강 보기`}
            onClick={() => onChange(filter.key)}
            className={[
              "shrink-0 rounded px-3 py-1.5 text-sm font-medium",
              value === filter.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {value === "custom" ? (
        <div className="grid min-w-[18rem] flex-1 gap-2 sm:max-w-sm sm:grid-cols-2">
          <DatePickerControl
            value={startDate}
            onChange={onStartDateChange}
            placeholder="시작일"
            ariaLabel="휴보강 기간 시작일"
          />
          <DatePickerControl
            value={endDate}
            onChange={onEndDateChange}
            placeholder="종료일"
            ariaLabel="휴보강 기간 종료일"
          />
        </div>
      ) : null}
    </div>
  )
}

function MakeupRequestDataTable({
  requests,
  loading,
  data,
  currentUserId,
  saving,
  onEditForRevision,
  onApprove,
  onRequestRevision,
  onReject,
  onFinalCancel,
  canForceDelete,
  onForceDelete,
  onOpenDetail,
}: {
  requests: MakeupRequest[]
  loading: boolean
  data: MakeupRequestWorkspaceData
  currentUserId: string
  saving: boolean
  onEditForRevision: (request: MakeupRequest) => void
  onApprove: (request: MakeupRequest) => void
  onRequestRevision: (request: MakeupRequest, note: string) => void
  onReject: (request: MakeupRequest, note: string) => void
  onFinalCancel: (request: MakeupRequest) => void
  canForceDelete: boolean
  onForceDelete: (request: MakeupRequest) => void
  onOpenDetail: (request: MakeupRequest) => void
}) {
  const [columnWidths, setColumnWidths] = useState<Record<MakeupRequestTableColumnKey, number>>(MAKEUP_REQUEST_TABLE_COLUMN_WIDTHS)
  const [makeupTableSort, setMakeupTableSort] = useState<MakeupRequestTableSort>(null)
  const [filterColumnKey, setFilterColumnKey] = useState<MakeupRequestTableColumnKey>("className")
  const [filterValue, setFilterValue] = useState("")
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState("all")
  const [selectedTeacherFilter, setSelectedTeacherFilter] = useState("all")
  const [selectedClassFilter, setSelectedClassFilter] = useState("all")
  const [makeupPeriodFilter, setMakeupPeriodFilter] = useState<MakeupRequestPeriodFilter>("all")
  const [makeupPeriodStartDate, setMakeupPeriodStartDate] = useState("")
  const [makeupPeriodEndDate, setMakeupPeriodEndDate] = useState("")
  const gridTemplateColumns = getMakeupRequestTableGridTemplate(columnWidths)
  const gridTemplateStyle = { "--makeup-request-grid-template": gridTemplateColumns } as CSSProperties
  const filterColumn = MAKEUP_REQUEST_TABLE_COLUMNS.find((column) => column.columnKey === filterColumnKey) || MAKEUP_REQUEST_TABLE_COLUMNS[1]
  const todayKey = useMemo(() => toDateKey(new Date()), [])

  const subjectFilterOptions = useMemo(() => (
    buildMakeupRequestSelectFilterOptions(requests, (request) => ({ value: request.subject, label: request.subject }))
      .sort((left, right) => sortSubjectOptions(left.label, right.label))
  ), [requests])

  const teacherFilterSourceRequests = useMemo(() => (
    selectedSubjectFilter === "all" ? requests : requests.filter((request) => request.subject === selectedSubjectFilter)
  ), [requests, selectedSubjectFilter])

  const teacherFilterOptions = useMemo(() => (
    buildMakeupRequestSelectFilterOptions(teacherFilterSourceRequests, (request) => ({
      value: getMakeupRequestTeacherFilterValue(request),
      label: request.teacherLabel,
    }))
  ), [teacherFilterSourceRequests])

  const classFilterSourceRequests = useMemo(() => (
    teacherFilterSourceRequests.filter((request) => (
      selectedTeacherFilter === "all" || getMakeupRequestTeacherFilterValue(request) === selectedTeacherFilter
    ))
  ), [selectedTeacherFilter, teacherFilterSourceRequests])

  const classFilterOptions = useMemo(() => (
    buildMakeupRequestSelectFilterOptions(classFilterSourceRequests, (request) => ({
      value: request.classId,
      label: request.className,
    }))
  ), [classFilterSourceRequests])

  const visibleRequests = useMemo(() => {
    const selectionFilteredRequests = requests
      .filter((request) => matchesMakeupRequestSelectionFilters(request, selectedSubjectFilter, selectedTeacherFilter, selectedClassFilter))
      .filter((request) => matchesMakeupRequestPeriodFilter(request, makeupPeriodFilter, todayKey, makeupPeriodStartDate, makeupPeriodEndDate))
    const normalizedFilter = filterValue.trim().toLocaleLowerCase("ko")
    const nextRequests = normalizedFilter
      ? selectionFilteredRequests.filter((request) => getMakeupRequestTableValue(request, filterColumnKey).toLocaleLowerCase("ko").includes(normalizedFilter))
      : [...selectionFilteredRequests]

    if (makeupTableSort) {
      nextRequests.sort((left, right) => {
        const leftValue = getMakeupRequestTableValue(left, makeupTableSort.columnKey)
        const rightValue = getMakeupRequestTableValue(right, makeupTableSort.columnKey)
        const result = leftValue.localeCompare(rightValue, "ko", { numeric: true })
        return makeupTableSort.direction === "asc" ? result : -result
      })
    }

    return nextRequests
  }, [
    filterColumnKey,
    filterValue,
    makeupPeriodEndDate,
    makeupPeriodFilter,
    makeupPeriodStartDate,
    makeupTableSort,
    requests,
    selectedClassFilter,
    selectedSubjectFilter,
    selectedTeacherFilter,
    todayKey,
  ])

  function handleHeaderSelect(columnKey: MakeupRequestTableColumnKey) {
    if (columnKey === "action") return
    setFilterColumnKey(columnKey)
    setMakeupTableSort((current) => {
      if (!current || current.columnKey !== columnKey) return { columnKey, direction: "asc" }
      if (current.direction === "asc") return { columnKey, direction: "desc" }
      return null
    })
  }

  function startColumnResize(key: MakeupRequestTableColumnKey, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[key]

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(MAKEUP_REQUEST_TABLE_COLUMN_MIN_WIDTHS[key], startWidth + moveEvent.clientX - startX)
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }))
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  return (
    <div className="grid gap-2">
      <Card className="gap-0 overflow-hidden rounded-lg py-0">
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2" aria-label="휴보강 전체 필터">
          <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="휴보강 선택 필터">
            <MakeupRequestFilterSelect
              ariaLabel="과목 필터"
              value={selectedSubjectFilter}
              allLabel="과목 전체"
              options={subjectFilterOptions}
              onChange={(value) => {
                setSelectedSubjectFilter(value)
                setSelectedTeacherFilter("all")
                setSelectedClassFilter("all")
              }}
            />
            <MakeupRequestFilterSelect
              ariaLabel="선생님 필터"
              value={selectedTeacherFilter}
              allLabel="선생님 전체"
              options={teacherFilterOptions}
              onChange={(value) => {
                setSelectedTeacherFilter(value)
                setSelectedClassFilter("all")
              }}
            />
            <MakeupRequestFilterSelect
              ariaLabel="수업 필터"
              value={selectedClassFilter}
              allLabel="수업 전체"
              options={classFilterOptions}
              onChange={setSelectedClassFilter}
            />
          </div>
          <MakeupRequestPeriodFilterBar
            value={makeupPeriodFilter}
            startDate={makeupPeriodStartDate}
            endDate={makeupPeriodEndDate}
            onChange={setMakeupPeriodFilter}
            onStartDateChange={setMakeupPeriodStartDate}
            onEndDateChange={setMakeupPeriodEndDate}
          />
          <div className="ml-auto flex min-w-[12rem] items-center gap-2 text-sm font-medium">
            <Filter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label={`${filterColumn.label} 필터`}
              value={filterValue}
              onChange={(event) => setFilterValue(event.target.value)}
              placeholder={`${filterColumn.label} 값 입력`}
              className="h-8 min-w-0 flex-1 sm:w-48"
            />
            {filterValue ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setFilterValue("")}>
                지우기
              </Button>
            ) : null}
          </div>
        </div>
        <div className="hidden md:block">
          <div className="overflow-x-auto" role="table" aria-label="휴보강 신청 데이터테이블">
            <div
              role="row"
              className="grid min-w-max border-b bg-muted/45 text-xs [grid-template-columns:var(--makeup-request-grid-template)]"
              style={gridTemplateStyle}
            >
              {MAKEUP_REQUEST_TABLE_COLUMNS.map((column) => (
                <MakeupRequestResizableHeaderCell
                  key={column.columnKey}
                  column={column}
                  sort={makeupTableSort}
                  onHeaderSelect={handleHeaderSelect}
                  onResizeStart={startColumnResize}
                />
              ))}
            </div>
            {loading ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
            ) : visibleRequests.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">표시할 신청서가 없습니다.</div>
            ) : visibleRequests.map((request) => {
              const hasRoomCollision = hasMakeupRequestRoomCollision(request, data)
              return (
                <div
                  key={request.id}
                  role="row"
                  className="grid min-w-max border-b last:border-b-0 hover:bg-muted/30 [grid-template-columns:var(--makeup-request-grid-template)]"
                  style={gridTemplateStyle}
                >
                  {MAKEUP_REQUEST_TABLE_COLUMNS.map((column) => {
                    const value = getMakeupRequestTableValue(request, column.columnKey)
                    if (column.columnKey === "status") {
                      return (
                        <MakeupRequestDataCell key={column.columnKey} value={value} onOpenDetail={() => onOpenDetail(request)}>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Badge variant={STATUS_BADGE_VARIANT[request.status]}>{value}</Badge>
                            {hasRoomCollision ? <span className="truncate text-xs text-destructive">충돌 있음</span> : null}
                          </div>
                        </MakeupRequestDataCell>
                      )
                    }
                    if (column.columnKey === "action") {
                      return (
                        <MakeupRequestDataCell key={column.columnKey} value="" align="right">
                          <MakeupRequestActionControls
                            request={request}
                            data={data}
                            currentUserId={currentUserId}
                            saving={saving}
                            onEditForRevision={onEditForRevision}
                            onApprove={onApprove}
                            onRequestRevision={onRequestRevision}
                            onReject={onReject}
                            onFinalCancel={onFinalCancel}
                            canForceDelete={canForceDelete}
                            onForceDelete={onForceDelete}
                          />
                        </MakeupRequestDataCell>
                      )
                    }
                    return (
                      <MakeupRequestDataCell
                        key={column.columnKey}
                        value={value}
                        align={column.align}
                        onOpenDetail={() => onOpenDetail(request)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </Card>
      <MakeupRequestCardList
        requests={visibleRequests}
        loading={loading}
        data={data}
        currentUserId={currentUserId}
        saving={saving}
        onOpenDetail={onOpenDetail}
        onEditForRevision={onEditForRevision}
        onApprove={onApprove}
        onRequestRevision={onRequestRevision}
        onReject={onReject}
        onFinalCancel={onFinalCancel}
        canForceDelete={canForceDelete}
        onForceDelete={onForceDelete}
      />
    </div>
  )
}

function createSlotId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildSlotDateTime(date = "", time = "") {
  if (!date || !time) return ""
  return `${date}T${time}:00+09:00`
}

function getDatePart(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ""
}

function getTimePart(value: string) {
  const match = value.match(/T(\d{2}:\d{2})/)
  return match ? match[1] : ""
}

function toFormSlot(slot: { id?: string; startAt?: string; endAt?: string; classroom?: string }) {
  return {
    id: slot.id || createSlotId(),
    date: getDatePart(slot.startAt || ""),
    startTime: getTimePart(slot.startAt || ""),
    endTime: getTimePart(slot.endAt || ""),
    classroom: slot.classroom || "",
  }
}

function isCompleteSlotDateTime(slot: MakeupRequestInput["makeupSlots"][number]) {
  return Boolean(slot.date && slot.startTime && slot.endTime)
}

function materializeSlot(slot: MakeupRequestInput["makeupSlots"][number]) {
  if (!isCompleteSlotDateTime(slot)) return null
  return {
    ...slot,
    startAt: buildSlotDateTime(slot.date, slot.startTime),
    endAt: buildSlotDateTime(slot.date, slot.endTime),
    classroom: slot.classroom || "",
  }
}

function materializeSlots(input: MakeupRequestInput) {
  return input.makeupSlots
    .map((slot) => materializeSlot(slot))
    .filter((slot): slot is NonNullable<ReturnType<typeof materializeSlot>> => Boolean(slot))
}

function getClassTeacherKey(classItem: MakeupClassOption) {
  return classItem.teacherCatalogId ? `id:${classItem.teacherCatalogId}` : `name:${classItem.teacher}`
}

function getSlotRoomAvailability(
  slot: MakeupRequestInput["makeupSlots"][number],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  const materializedSlot = materializeSlot(slot)
  return buildRoomAvailability({
    classrooms: data.classrooms,
    classes: data.classes,
    requests: data.requests,
    academicEvents: data.academicEvents,
    slots: materializedSlot ? [materializedSlot] : [],
    currentRequestId,
    subject,
  })
}

function getSlotRoomCollisionState(
  slot: MakeupRequestInput["makeupSlots"][number],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  const room = slot.classroom || ""
  if (!room) return null
  return getSlotRoomAvailability(slot, data, currentRequestId, subject).find((item) => item.name === room) || null
}

function hasSlotRoomCollision(
  slots: MakeupRequestInput["makeupSlots"],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  return slots.some((slot) => Boolean(getSlotRoomCollisionState(slot, data, currentRequestId, subject)?.collisions.length))
}

export function MakeupRequestWorkspace() {
  const { user, role, isAdmin, loading: authLoading, session } = useAuth()
  const [view, setView] = useState<MakeupRequestView>("mine")
  const [data, setData] = useState<MakeupRequestWorkspaceData>({
    schemaReady: true,
    requests: [],
    profiles: [],
    teachers: [],
    classes: [],
    classrooms: [],
    academicEvents: [],
    notificationSettings: [],
    notificationDeliveries: [],
  })
  const [input, setInput] = useState<MakeupRequestInput>(EMPTY_INPUT)
  const [selectedSubject, setSelectedSubject] = useState("")
  const [selectedTeacherKey, setSelectedTeacherKey] = useState("")
  const [editingRequestId, setEditingRequestId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [finalCancelRequest, setFinalCancelRequest] = useState<MakeupRequest | null>(null)
  const [finalCancelNote, setFinalCancelNote] = useState("")
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false)
  const [selectedNotificationSetting, setSelectedNotificationSetting] = useState<MakeupNotificationSetting | null>(null)
  const [notificationTemplateInput, setNotificationTemplateInput] = useState(EMPTY_NOTIFICATION_TEMPLATE_INPUT)
  const [selectedWebhookInfo, setSelectedWebhookInfo] = useState<MakeupGoogleChatWebhookInfo | null>(null)
  const [webhookUrlInput, setWebhookUrlInput] = useState("")
  const [webhookInfoLoading, setWebhookInfoLoading] = useState<MakeupNotificationSetting["channel"] | "">("")
  const [webhookInfoSaving, setWebhookInfoSaving] = useState(false)
  const [webhookInfoError, setWebhookInfoError] = useState("")
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [selectedDetailRequest, setSelectedDetailRequest] = useState<MakeupRequest | null>(null)

  const currentUserId = user?.id || ""
  const selectedClass = useMemo(() => findSelectedClass(data, input), [data, input])
  const isManager = canUserManage(role)
  const canForceDeleteClosedRequests = isAdmin
  const detailRequest = useMemo(() => (
    selectedDetailRequest
      ? data.requests.find((request) => request.id === selectedDetailRequest.id) || selectedDetailRequest
      : null
  ), [data.requests, selectedDetailRequest])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const nextData = await loadMakeupRequestWorkspaceData()
      setData(nextData)
      if (!nextData.schemaReady) {
        setError(nextData.error || "휴보강 신청서 DB 상태를 확인해 주세요.")
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "휴보강 신청서를 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading) {
      void refresh()
    }
  }, [authLoading, refresh])

  const allowedApproverNames = useMemo(() => (
    selectedClass ? getAllowedApproverNames(selectedClass) : []
  ), [selectedClass])

  const approverOptions = useMemo(() => (
    data.teachers.filter((teacher) => allowedApproverNames.includes(teacher.name))
  ), [allowedApproverNames, data.teachers])

  const subjectOptions = useMemo(() => (
    [...new Set(data.classes.map((classItem) => classItem.subject).filter(Boolean))]
      .sort(sortSubjectOptions)
  ), [data.classes])

  const teacherOptions = useMemo(() => {
    const optionMap = new Map<string, string>()
    data.classes
      .filter((classItem) => !selectedSubject || classItem.subject === selectedSubject)
      .forEach((classItem) => {
        const key = getClassTeacherKey(classItem)
        if (key) optionMap.set(key, classItem.teacher || "선생님 미지정")
      })
    return [...optionMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"))
  }, [data.classes, selectedSubject])

  const availableClasses = useMemo(() => (
    data.classes.filter((classItem) => (
      (!selectedSubject || classItem.subject === selectedSubject) &&
      (!selectedTeacherKey || getClassTeacherKey(classItem) === selectedTeacherKey)
    ))
  ), [data.classes, selectedSubject, selectedTeacherKey])

  const selectedRoomHasCollision = useMemo(() => (
    hasSlotRoomCollision(input.makeupSlots, data, editingRequestId, selectedClass?.subject || selectedSubject)
  ), [data, editingRequestId, input.makeupSlots, selectedClass?.subject, selectedSubject])

  const filteredRequests = useMemo(() => (
    getMakeupRequestViewRequests(data.requests, view, currentUserId)
  ), [currentUserId, data.requests, view])

  const viewCounts = useMemo(() => ({
    mine: getMakeupRequestViewRequests(data.requests, "mine", currentUserId).length,
    approvals: getMakeupRequestViewRequests(data.requests, "approvals", currentUserId).length,
    closed: getMakeupRequestViewRequests(data.requests, "closed", currentUserId).length,
  }), [currentUserId, data.requests])

  const notificationSettingsByTrigger = useMemo(() => {
    const grouped = new Map<string, MakeupNotificationSetting[]>()
    for (const setting of data.notificationSettings || []) {
      const list = grouped.get(setting.triggerKind) || []
      list.push(setting)
      grouped.set(setting.triggerKind, list)
    }
    return grouped
  }, [data.notificationSettings])

  const notificationTemplatePreview = useMemo(() => ({
    title: renderMakeupNotificationTemplate(notificationTemplateInput.titleTemplate, MAKEUP_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT),
    body: renderMakeupNotificationTemplate(notificationTemplateInput.bodyTemplate, MAKEUP_NOTIFICATION_TEMPLATE_PREVIEW_CONTEXT),
  }), [notificationTemplateInput])

  const patchInput = useCallback((patch: Partial<MakeupRequestInput>) => {
    setInput((current) => ({ ...current, ...patch }))
  }, [])

  const handleSubjectChange = useCallback((subject: string) => {
    setSelectedSubject(subject)
    setSelectedTeacherKey("")
    setInput((current) => ({
      ...current,
      classId: "",
      makeupClassroom: "",
      makeupSlots: current.makeupSlots.map((slot) => ({ ...slot, classroom: "" })),
      approverTeacherCatalogId: "",
    }))
  }, [])

  const handleTeacherChange = useCallback((teacherKey: string) => {
    setSelectedTeacherKey(teacherKey)
    setInput((current) => ({
      ...current,
      classId: "",
      makeupClassroom: "",
      makeupSlots: current.makeupSlots.map((slot) => ({ ...slot, classroom: "" })),
      approverTeacherCatalogId: "",
    }))
  }, [])

  const handleClassChange = useCallback((classId: string) => {
    const classItem = data.classes.find((item) => item.id === classId) || null
    const allowedNames = classItem ? getAllowedApproverNames(classItem) : []
    const firstApprover = data.teachers.find((teacher) => allowedNames.includes(teacher.name))
    setInput((current) => ({
      ...current,
      classId,
      approverTeacherCatalogId: firstApprover?.id || "",
    }))
    if (classItem) {
      setSelectedSubject(classItem.subject)
      setSelectedTeacherKey(getClassTeacherKey(classItem))
    }
  }, [data.classes, data.teachers])

  const patchMakeupSlot = useCallback((slotId: string, patch: Partial<MakeupRequestInput["makeupSlots"][number]>) => {
    setInput((current) => ({
      ...current,
      makeupSlots: current.makeupSlots.map((slot) => {
        if (slot.id !== slotId) return slot
        const nextSlot = { ...slot, ...patch }
        if ((patch.date || patch.startTime) && nextSlot.date && nextSlot.startTime && !patch.endTime) {
          const defaultEndAt = getDefaultMakeupEndAt(buildSlotDateTime(nextSlot.date, nextSlot.startTime), selectedClass || {})
          nextSlot.endTime = getTimePart(defaultEndAt) || nextSlot.endTime
        }
        return nextSlot
      }),
    }))
  }, [selectedClass])

  const addMakeupSlot = useCallback(() => {
    setInput((current) => ({
      ...current,
      makeupSlots: [
        ...current.makeupSlots,
        {
          id: createSlotId(),
          date: current.makeupSlots[current.makeupSlots.length - 1]?.date || current.cancelDate || "",
          startTime: "",
          endTime: "",
          classroom: "",
        },
      ],
    }))
  }, [])

  const removeMakeupSlot = useCallback((slotId: string) => {
    setInput((current) => ({
      ...current,
      makeupSlots: current.makeupSlots.length <= 1
        ? current.makeupSlots
        : current.makeupSlots.filter((slot) => slot.id !== slotId),
    }))
  }, [])

  const resetForm = useCallback(() => {
    setInput(EMPTY_INPUT)
    setSelectedSubject("")
    setSelectedTeacherKey("")
    setEditingRequestId("")
  }, [])

  const openRequestDialog = useCallback(() => {
    resetForm()
    setRequestDialogOpen(true)
  }, [resetForm])

  const closeRequestDialog = useCallback(() => {
    if (saving) return
    setRequestDialogOpen(false)
    resetForm()
  }, [resetForm, saving])

  const handleSubmit = useCallback(async () => {
    if (!currentUserId) {
      setError("로그인 세션을 확인할 수 없습니다.")
      return
    }
    if (!input.classId || !input.reason || !input.cancelDate || !input.approverTeacherCatalogId) {
      setError("필수 항목을 모두 입력해 주세요.")
      return
    }
    if (input.makeupSlots.length === 0 || input.makeupSlots.some((slot) => !isCompleteSlotDateTime(slot))) {
      setError("보강일시의 날짜, 시작시각, 종료시각을 모두 입력해 주세요.")
      return
    }
    if (input.makeupSlots.some((slot) => !slot.classroom)) {
      setError("각 보강일시의 강의실을 선택해 주세요.")
      return
    }
    if (selectedRoomHasCollision) {
      setError("충돌이 없는 보강 강의실을 선택해 주세요.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    try {
      const makeupSlots = materializeSlots(input)
      const payload = {
        ...input,
        makeupClassroom: makeupSlots[0]?.classroom || "",
        makeupSlots,
      }
      if (editingRequestId) {
        await resubmitMakeupRequest(editingRequestId, payload, currentUserId)
        setMessage("휴보강 신청서를 재상신했습니다.")
      } else {
        await createMakeupRequest(payload, currentUserId)
        setMessage("휴보강 신청서를 상신했습니다.")
      }
      resetForm()
      setRequestDialogOpen(false)
      await refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "휴보강 신청서 저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [currentUserId, editingRequestId, input, refresh, resetForm, selectedRoomHasCollision])

  const runAction = useCallback(async (action: () => Promise<void>, successMessage: string) => {
    setSaving(true)
    setError("")
    setMessage("")
    try {
      await action()
      setMessage(successMessage)
      await refresh()
      return true
    } catch (actionError) {
      setError(getMakeupActionErrorMessage(actionError, "요청 처리에 실패했습니다."))
      return false
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const closeFinalCancelDialog = useCallback(() => {
    if (saving) return
    setFinalCancelRequest(null)
    setFinalCancelNote("")
  }, [saving])

  const handleFinalCancel = useCallback(async () => {
    if (!finalCancelRequest) return
    const canceled = await runAction(
      () => cancelCompletedMakeupRequest(finalCancelRequest.id, currentUserId, finalCancelNote),
      "휴보강 승인을 취소했습니다.",
    )
    if (canceled) {
      setFinalCancelRequest(null)
      setFinalCancelNote("")
    }
  }, [currentUserId, finalCancelNote, finalCancelRequest, runAction])

  const handleForceDeleteRequest = useCallback(async (request: MakeupRequest) => {
    if (!canForceDeleteClosedRequests || !MAKEUP_REQUEST_CLOSED_STATUSES.includes(request.status)) {
      setError("운영자만 완료된 휴보강 이력을 삭제할 수 있습니다.")
      return
    }
    const confirmed = window.confirm(`${request.className || "휴보강 신청"} 이력 삭제할까요?`)
    if (!confirmed) return
    const deleted = await runAction(
      () => deleteMakeupRequest(request.id, currentUserId),
      "휴보강 이력을 삭제했습니다.",
    )
    if (deleted) {
      setSelectedDetailRequest(null)
    }
  }, [canForceDeleteClosedRequests, currentUserId, runAction])

  const handleToggleNotificationSetting = useCallback(async (setting: MakeupNotificationSetting) => {
    if (!isManager) {
      setError("관리 권한이 있는 계정만 알림 설정을 변경할 수 있습니다.")
      return
    }
    await runAction(
      () => toggleMakeupNotificationSetting(setting.triggerKind, setting.channel, !setting.enabled, currentUserId),
      "알림 설정을 저장했습니다.",
    )
  }, [currentUserId, isManager, runAction])

  const handleOpenWebhookInfo = useCallback(async (channel: MakeupNotificationSetting["channel"]) => {
    const googleChatChannel = MAKEUP_GOOGLE_CHAT_CHANNEL_MAP[channel]
    if (!googleChatChannel) return

    const channelLabel = MAKEUP_NOTIFICATION_CHANNEL_LABELS[channel]
    setSelectedWebhookInfo({
      channelKey: channel,
      channelLabel,
      envName: "",
      configured: false,
      maskedUrl: "",
    })
    setWebhookUrlInput("")
    setWebhookInfoError("")

    if (!session?.access_token) {
      setWebhookInfoError("로그인 세션을 확인할 수 없습니다.")
      return
    }

    setWebhookInfoLoading(channel)
    try {
      const response = await fetch(`/api/google-chat?channel=${encodeURIComponent(googleChatChannel)}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
      const payload = await response.json().catch(() => ({})) as GoogleChatWebhookInfoResponse
      if (!response.ok || !payload.ok) {
        throw new Error(toText(payload.error) || "웹훅 정보를 불러오지 못했습니다.")
      }
      setSelectedWebhookInfo({
        channelKey: channel,
        channelLabel,
        envName: toText(payload.envName),
        configured: Boolean(payload.configured),
        maskedUrl: toText(payload.maskedUrl),
      })
    } catch (error) {
      setWebhookInfoError(error instanceof Error ? error.message : "웹훅 정보를 불러오지 못했습니다.")
    } finally {
      setWebhookInfoLoading("")
    }
  }, [session?.access_token])

  const handleSaveWebhookInfo = useCallback(async () => {
    if (!selectedWebhookInfo) return
    if (!isManager) {
      setWebhookInfoError("관리 권한이 있는 계정만 웹훅 URL을 변경할 수 있습니다.")
      return
    }
    if (!session?.access_token) {
      setWebhookInfoError("로그인 세션을 확인할 수 없습니다.")
      return
    }

    const googleChatChannel = MAKEUP_GOOGLE_CHAT_CHANNEL_MAP[selectedWebhookInfo.channelKey]
    const webhookUrl = toText(webhookUrlInput)
    if (!googleChatChannel || !webhookUrl) {
      setWebhookInfoError("저장할 웹훅 URL을 입력해 주세요.")
      return
    }

    setWebhookInfoSaving(true)
    setWebhookInfoError("")
    try {
      const response = await fetch("/api/google-chat", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: googleChatChannel,
          webhookUrl,
        }),
      })
      const payload = await response.json().catch(() => ({})) as GoogleChatWebhookInfoResponse
      if (!response.ok || !payload.ok) {
        throw new Error(toText(payload.error) || "웹훅 URL을 저장하지 못했습니다.")
      }
      setSelectedWebhookInfo((current) => current ? {
        ...current,
        envName: toText(payload.envName),
        configured: Boolean(payload.configured),
        maskedUrl: toText(payload.maskedUrl),
      } : current)
      setWebhookUrlInput("")
      setMessage("웹훅 URL을 저장했습니다.")
    } catch (error) {
      setWebhookInfoError(error instanceof Error ? error.message : "웹훅 URL을 저장하지 못했습니다.")
    } finally {
      setWebhookInfoSaving(false)
    }
  }, [isManager, selectedWebhookInfo, session?.access_token, webhookUrlInput])

  const openNotificationTemplateEditor = useCallback((triggerKind: MakeupNotificationSetting["triggerKind"], settings: MakeupNotificationSetting[]) => {
    const setting = getNotificationTemplateSetting(triggerKind, settings)
    if (!setting) return
    setSelectedNotificationSetting(setting)
    setNotificationTemplateInput({
      titleTemplate: setting.titleTemplate,
      bodyTemplate: setting.bodyTemplate,
    })
  }, [])

  const closeNotificationTemplateEditor = useCallback(() => {
    if (saving) return
    setSelectedNotificationSetting(null)
    setNotificationTemplateInput(EMPTY_NOTIFICATION_TEMPLATE_INPUT)
  }, [saving])

  const handleSaveNotificationTemplate = useCallback(async () => {
    if (!selectedNotificationSetting) return
    if (!isManager) {
      setError("관리 권한이 있는 계정만 알림 내용을 변경할 수 있습니다.")
      return
    }
    const saved = await runAction(
      () => updateMakeupNotificationTriggerContent(
        selectedNotificationSetting.triggerKind,
        notificationTemplateInput.titleTemplate,
        notificationTemplateInput.bodyTemplate,
        currentUserId,
      ),
      "알림 내용을 저장했습니다.",
    )
    if (saved) {
      setSelectedNotificationSetting(null)
      setNotificationTemplateInput(EMPTY_NOTIFICATION_TEMPLATE_INPUT)
    }
  }, [currentUserId, isManager, notificationTemplateInput, runAction, selectedNotificationSetting])

  const handleEditForRevision = useCallback((request: MakeupRequest) => {
    const requestClass = data.classes.find((classItem) => classItem.id === request.classId) || null
    setEditingRequestId(request.id)
    setView("mine")
    if (requestClass) {
      setSelectedSubject(requestClass.subject)
      setSelectedTeacherKey(getClassTeacherKey(requestClass))
    }
    setInput({
      classId: request.classId,
      reason: request.reason,
      cancelDate: request.cancelDate,
      makeupSlots: request.makeupSlots.length > 0
        ? request.makeupSlots.map((slot) => toFormSlot({ ...slot, classroom: slot.classroom || request.makeupClassroom }))
        : [toFormSlot({ startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom })],
      makeupClassroom: request.makeupSlots[0]?.classroom || request.makeupClassroom,
      approverTeacherCatalogId: request.approverTeacherCatalogId,
    })
    setRequestDialogOpen(true)
  }, [data.classes])

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="휴보강 신청서 보기">
          {[
            { id: "mine", label: "신청" },
            { id: "approvals", label: "결재함" },
            { id: "closed", label: "승인/반려" },
          ].map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={view === tab.id ? "default" : "outline"}
              size="sm"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => setView(tab.id as MakeupRequestView)}
            >
              {tab.label}
              <Badge variant={view === tab.id ? "secondary" : "outline"}>{viewCounts[tab.id as MakeupRequestView]}</Badge>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" onClick={openRequestDialog}>
            <Plus className="size-4" aria-hidden="true" />
            신청
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setNotificationDialogOpen(true)}>
            <Settings className="size-4" aria-hidden="true" />
            알림 설정
          </Button>
        </div>
      </div>

      {message ? <div role="status" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">{message}</div> : null}
      {error ? <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid min-w-0 gap-4">
        <Dialog open={requestDialogOpen} onOpenChange={(open) => {
          if (open) setRequestDialogOpen(true)
          else closeRequestDialog()
        }}>
          <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{editingRequestId ? "휴보강 보완 재상신" : "휴보강 신청"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-subject">과목</Label>
                <Select value={selectedSubject} onValueChange={handleSubjectChange}>
                  <SelectTrigger id="makeup-subject">
                    <SelectValue placeholder="과목 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((subject) => (
                      <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-teacher">선생님</Label>
                <Select value={selectedTeacherKey} onValueChange={handleTeacherChange} disabled={!selectedSubject}>
                  <SelectTrigger id="makeup-teacher">
                    <SelectValue placeholder={selectedSubject ? "선생님 선택" : "과목 먼저"} />
                  </SelectTrigger>
                  <SelectContent>
                    {teacherOptions.map((teacher) => (
                      <SelectItem key={teacher.value} value={teacher.value}>{teacher.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-class">수업</Label>
                <Select value={input.classId} onValueChange={handleClassChange} disabled={!selectedTeacherKey}>
                  <SelectTrigger id="makeup-class">
                    <SelectValue placeholder={selectedTeacherKey ? "수업 선택" : "선생님 먼저"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableClasses.map((classItem) => (
                      <SelectItem key={classItem.id} value={classItem.id}>
                        {classItem.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="makeup-reason">사유</Label>
              <Textarea
                id="makeup-reason"
                value={input.reason}
                onChange={(event) => patchInput({ reason: event.target.value })}
                placeholder="휴강 및 보강 사유"
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cancel-date">휴강일</Label>
              <DatePickerControl
                id="cancel-date"
                value={input.cancelDate}
                onChange={(value) => patchInput({ cancelDate: value })}
                placeholder="휴강일 선택"
                ariaLabel="휴강일 선택"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>보강일시</Label>
                <Button type="button" variant="outline" size="sm" onClick={addMakeupSlot}>
                  <Plus className="size-4" aria-hidden="true" />
                  보강일시 추가
                </Button>
              </div>
              <div className="grid gap-2">
                {input.makeupSlots.map((slot, index) => {
                  const slotRoomAvailability = getSlotRoomAvailability(slot, data, editingRequestId, selectedClass?.subject || selectedSubject)
                  const selectedSlotRoomState = getSlotRoomCollisionState(slot, data, editingRequestId, selectedClass?.subject || selectedSubject)
                  const slotDateTimeReady = isCompleteSlotDateTime(slot)

                  return (
                    <div key={slot.id} className="rounded-md border bg-muted/15 p-2">
                      <div className="grid gap-2 md:grid-cols-[minmax(150px,1fr)_minmax(96px,0.55fr)_minmax(96px,0.55fr)_32px]">
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">날짜</span>
                          <DatePickerControl
                            value={slot.date || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { date: value })}
                            placeholder="날짜 선택"
                            ariaLabel={`보강일시 ${index + 1} 날짜`}
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">시작시각</span>
                          <TimePickerControl
                            value={slot.startTime || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { startTime: value })}
                            placeholder="시작"
                            ariaLabel={`보강일시 ${index + 1} 시작시각`}
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">종료시각</span>
                          <TimePickerControl
                            value={slot.endTime || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { endTime: value })}
                            placeholder="종료"
                            ariaLabel={`보강일시 ${index + 1} 종료시각`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="self-end justify-self-end"
                          onClick={() => removeMakeupSlot(slot.id || "")}
                          disabled={input.makeupSlots.length <= 1}
                          aria-label={`보강일시 ${index + 1} 삭제`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                        <div className="grid gap-1 md:col-span-3">
                          <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                            보강 강의실
                            <span>빈 강의실 우선</span>
                          </span>
                          <Select
                            value={slot.classroom || ""}
                            onValueChange={(value) => patchMakeupSlot(slot.id || "", { classroom: value })}
                            disabled={!slotDateTimeReady}
                          >
                            <SelectTrigger aria-label={`보강일시 ${index + 1} 강의실`}>
                              <SelectValue placeholder="강의실 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {slotRoomAvailability.map((room) => (
                                <SelectItem key={room.name} value={room.name} disabled={!room.available}>
                                  {room.name} · {room.available ? "빈 강의실" : "충돌"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {selectedSlotRoomState?.collisions.length ? (
                        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          {selectedSlotRoomState.collisions.map((collision) => `${collision.title || collision.detail} (${collision.source})`).join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="makeup-approver">결재자</Label>
              <Select value={input.approverTeacherCatalogId} onValueChange={(value) => patchInput({ approverTeacherCatalogId: value })}>
                <SelectTrigger id="makeup-approver">
                  <SelectValue placeholder={selectedClass ? "결재자 선택" : "수업을 먼저 선택"} />
                </SelectTrigger>
                <SelectContent>
                  {approverOptions.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}{teacher.profileId ? "" : " · 계정 연결 필요"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={() => void handleSubmit()} disabled={saving || loading || selectedRoomHasCollision}>
                <Send className="size-4" aria-hidden="true" />
                {editingRequestId ? "재상신" : "상신"}
              </Button>
              <Button type="button" variant="outline" onClick={closeRequestDialog} disabled={saving}>
                취소
              </Button>
            </div>
            </div>
          </DialogContent>
        </Dialog>

        <MakeupRequestDataTable
          requests={filteredRequests}
          loading={loading}
          data={data}
          currentUserId={currentUserId}
          saving={saving}
          onEditForRevision={handleEditForRevision}
          onApprove={(request) => {
            void runAction(() => approveMakeupRequest(request.id, currentUserId), "결재 승인 및 자동 처리를 완료했습니다.")
          }}
          onRequestRevision={(request, note) => {
            void runAction(() => requestMakeupRequestRevision(request.id, currentUserId, note), "보완 요청을 보냈습니다.")
          }}
          onReject={(request, note) => {
            void runAction(() => rejectMakeupRequest(request.id, currentUserId, note), "반려 처리했습니다.")
          }}
          onFinalCancel={(request) => {
            setFinalCancelRequest(request)
            setFinalCancelNote("")
          }}
          canForceDelete={canForceDeleteClosedRequests}
          onForceDelete={handleForceDeleteRequest}
          onOpenDetail={setSelectedDetailRequest}
        />
      </div>

      <Dialog open={Boolean(detailRequest)} onOpenChange={(open) => {
        if (!open) setSelectedDetailRequest(null)
      }}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>휴보강 상세</DialogTitle>
          </DialogHeader>
          {detailRequest ? (
            <MakeupRequestDetailCard
              request={detailRequest}
              data={data}
              currentUserId={currentUserId}
              saving={saving}
              onEditForRevision={(request) => {
                setSelectedDetailRequest(null)
                handleEditForRevision(request)
              }}
              onApprove={(request) => {
                void runAction(() => approveMakeupRequest(request.id, currentUserId), "결재 승인 및 자동 처리를 완료했습니다.")
              }}
              onRequestRevision={(request, note) => {
                void runAction(() => requestMakeupRequestRevision(request.id, currentUserId, note), "보완 요청을 보냈습니다.")
              }}
              onReject={(request, note) => {
                void runAction(() => rejectMakeupRequest(request.id, currentUserId, note), "반려 처리했습니다.")
              }}
              onFinalCancel={(request) => {
                setSelectedDetailRequest(null)
                setFinalCancelRequest(request)
                setFinalCancelNote("")
              }}
              canForceDelete={canForceDeleteClosedRequests}
              onForceDelete={handleForceDeleteRequest}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={notificationDialogOpen} onOpenChange={setNotificationDialogOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>알림 설정</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-2">
              <div className="overflow-x-auto rounded-md border" role="table" aria-label="휴보강 알림 설정 표">
                <div className="min-w-[880px]">
                  <div
                    role="row"
                    className="grid border-b bg-muted/40 text-xs font-medium text-muted-foreground"
                    style={MAKEUP_NOTIFICATION_TABLE_GRID_STYLE}
                  >
                    <div role="columnheader" className="border-r px-3 py-2">
                      프로세스
                    </div>
                    <div role="columnheader" className="col-span-6 px-3 py-2 text-center">
                      알림 위치
                    </div>
                  </div>
                  <div
                    role="row"
                    className="grid border-b bg-muted/20 text-xs font-medium text-muted-foreground"
                    style={MAKEUP_NOTIFICATION_TABLE_GRID_STYLE}
                  >
                    <div role="columnheader" className="border-r px-3 py-2" aria-label="프로세스" />
                    {MAKEUP_NOTIFICATION_CHANNEL_ORDER.map((channel) => {
                      const googleChatChannel = MAKEUP_GOOGLE_CHAT_CHANNEL_MAP[channel]
                      const channelLabel = MAKEUP_NOTIFICATION_CHANNEL_LABELS[channel]
                      return (
                        <div key={channel} role="columnheader" className="border-r px-3 py-2 last:border-r-0">
                          {googleChatChannel ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-auto min-h-0 w-full justify-start px-0 py-0 text-left text-xs font-medium text-muted-foreground hover:bg-transparent"
                              disabled={webhookInfoLoading === channel}
                              aria-label={`${channelLabel} 웹훅 URL 보기`}
                              title={`${channelLabel} 웹훅 URL 보기`}
                              onClick={() => void handleOpenWebhookInfo(channel)}
                            >
                              <span className="truncate">{channelLabel}</span>
                            </Button>
                          ) : channelLabel}
                        </div>
                      )
                    })}
                  </div>
                  {(Object.entries(MAKEUP_NOTIFICATION_TRIGGER_LABELS) as Array<[keyof typeof MAKEUP_NOTIFICATION_TRIGGER_LABELS, string]>).map(([triggerKind, triggerLabel]) => {
                    const settings = notificationSettingsByTrigger.get(triggerKind) || []
                    return (
                      <div
                        key={triggerKind}
                        role="row"
                        className="grid border-b last:border-b-0"
                        style={MAKEUP_NOTIFICATION_TABLE_GRID_STYLE}
                      >
                        <div role="rowheader" className="border-r bg-muted/10 px-3 py-2 text-sm font-medium">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="truncate">{triggerLabel}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-xs"
                              disabled={saving || !isManager || settings.length === 0}
                              aria-label={`${triggerLabel} 알림 내용 수정`}
                              onClick={() => openNotificationTemplateEditor(triggerKind, settings)}
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                              내용
                            </Button>
                          </div>
                        </div>
                        {MAKEUP_NOTIFICATION_CHANNEL_ORDER.map((channel) => {
                          const setting = settings.find((item) => item.channel === channel)
                          if (!setting) {
                            return (
                              <div key={`${triggerKind}-${channel}`} role="cell" className="border-r px-2 py-2 last:border-r-0">
                                <span className="block rounded-md border border-dashed px-2 py-1.5 text-center text-xs text-muted-foreground">-</span>
                              </div>
                            )
                          }
                          return (
                            <div key={`${setting.triggerKind}-${setting.channel}`} role="cell" className="border-r px-2 py-2 last:border-r-0">
                              <Button
                                type="button"
                                variant={setting.enabled ? "default" : "outline"}
                                size="sm"
                                className="h-8 w-full justify-center px-2 text-xs"
                                disabled={saving || !isManager}
                                aria-label={`${triggerLabel} ${MAKEUP_NOTIFICATION_CHANNEL_LABELS[channel]} 알림 ${setting.enabled ? "끄기" : "켜기"}`}
                                onClick={() => void handleToggleNotificationSetting(setting)}
                              >
                                {setting.enabled ? "켜짐" : "꺼짐"}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
              {selectedWebhookInfo || webhookInfoError ? (
                <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs">
                  {selectedWebhookInfo ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{selectedWebhookInfo.channelLabel}</span>
                        <Badge variant={selectedWebhookInfo.configured ? "default" : "outline"}>
                          {webhookInfoLoading === selectedWebhookInfo.channelKey ? "확인 중" : selectedWebhookInfo.configured ? "연결됨" : "미설정"}
                        </Badge>
                      </div>
                      <div className="grid gap-1">
                        <div className="text-muted-foreground">환경 변수</div>
                        <code className="break-all rounded bg-background px-2 py-1">{selectedWebhookInfo.envName || "-"}</code>
                      </div>
                      <div className="grid gap-1">
                        <div className="text-muted-foreground">웹훅 URL</div>
                        <code className="break-all rounded bg-background px-2 py-1">{selectedWebhookInfo.maskedUrl || "-"}</code>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="makeup-google-chat-webhook-url" className="text-xs text-muted-foreground">
                          웹훅 URL 수정
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="makeup-google-chat-webhook-url"
                            type="password"
                            value={webhookUrlInput}
                            onChange={(event) => setWebhookUrlInput(event.target.value)}
                            placeholder="새 구글챗 웹훅 URL 입력"
                            disabled={!isManager || webhookInfoSaving}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="shrink-0"
                            disabled={!isManager || webhookInfoSaving || !webhookUrlInput.trim()}
                            onClick={() => void handleSaveWebhookInfo()}
                          >
                            저장
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {webhookInfoError ? <div className="text-destructive">{webhookInfoError}</div> : null}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  발송 현황
                </div>
                <Badge variant="outline">{data.notificationDeliveries.length}</Badge>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {data.notificationDeliveries.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">최근 발송 기록이 없습니다.</div>
                ) : data.notificationDeliveries.map((delivery) => (
                  <div key={delivery.id} className="grid gap-1 border-b px-3 py-2 text-xs last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {getMakeupNotificationTriggerLabel(delivery.triggerKind)} · {MAKEUP_NOTIFICATION_CHANNEL_LABELS[delivery.channel]}
                      </span>
                      <Badge variant={delivery.status === "failed" ? "destructive" : delivery.status === "sent" ? "default" : "outline"}>
                        {NOTIFICATION_DELIVERY_STATUS_LABELS[delivery.status] || delivery.status}
                      </Badge>
                    </div>
                    <div className="truncate text-muted-foreground">
                      {getNotificationDeliveryTargetLabel(delivery)} · {formatDateTime(delivery.createdAt)}
                    </div>
                    {delivery.error ? <div className="truncate text-destructive">{delivery.error}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedNotificationSetting)} onOpenChange={(open) => {
        if (!open) closeNotificationTemplateEditor()
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>알림 내용 수정</DialogTitle>
            <DialogDescription>
              {selectedNotificationSetting
                ? getMakeupNotificationTriggerLabel(selectedNotificationSetting.triggerKind)
                : "알림 내용"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="makeup-notification-title-template">제목</Label>
              <Input
                id="makeup-notification-title-template"
                value={notificationTemplateInput.titleTemplate}
                onChange={(event) => setNotificationTemplateInput((current) => ({
                  ...current,
                  titleTemplate: event.target.value,
                }))}
                placeholder="알림 제목"
                disabled={saving || !isManager}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="makeup-notification-body-template">본문</Label>
              <Textarea
                id="makeup-notification-body-template"
                value={notificationTemplateInput.bodyTemplate}
                onChange={(event) => setNotificationTemplateInput((current) => ({
                  ...current,
                  bodyTemplate: event.target.value,
                }))}
                placeholder="알림 본문"
                className="min-h-24"
                disabled={saving || !isManager}
              />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <div className="text-sm font-medium">미리보기</div>
              <div className="grid gap-1 text-sm">
                <div className="font-medium">{notificationTemplatePreview.title || "-"}</div>
                <div className="whitespace-pre-wrap text-muted-foreground">{notificationTemplatePreview.body || "-"}</div>
              </div>
            </div>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">사용 가능 변수</div>
              <div className="flex flex-wrap gap-1">
                {MAKEUP_NOTIFICATION_TEMPLATE_VARIABLES.map((variable) => (
                  <Badge key={variable} variant="outline" className="font-mono">
                    {`{${variable}}`}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeNotificationTemplateEditor} disabled={saving}>
              취소
            </Button>
            <Button type="button" onClick={() => void handleSaveNotificationTemplate()} disabled={saving || !isManager}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(finalCancelRequest)} onOpenChange={(open) => {
        if (!open) closeFinalCancelDialog()
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>승인 취소</DialogTitle>
            <DialogDescription>
              수업일정과 캘린더 반영을 되돌립니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="makeup-final-cancel-note">취소 메모</Label>
            <Textarea
              id="makeup-final-cancel-note"
              value={finalCancelNote}
              onChange={(event) => setFinalCancelNote(event.target.value)}
              placeholder={finalCancelRequest?.className || "필요 시 메모"}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeFinalCancelDialog} disabled={saving}>
              닫기
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleFinalCancel()} disabled={saving || !finalCancelRequest}>
              <RotateCcw className="size-4" aria-hidden="true" />
              승인 취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
